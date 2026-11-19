// js/admin-estadisticas.js - Estadísticas del negocio: facturación, ocupación, horarios pico, clientes.

const AdminEstadisticas = (() => {
    const $ = (id) => document.getElementById(id);
    let periodo = '30';
    let ultimo = null;

    function rango() {
        const hoy = Utils.hoyISO();
        if (periodo === 'mes' || periodo === 'mes-1') {
            const base = Utils.crearFecha(hoy);
            if (periodo === 'mes-1') base.setUTCMonth(base.getUTCMonth() - 1);
            base.setUTCDate(1);
            const desde = Utils.fechaISO(base);
            base.setUTCMonth(base.getUTCMonth() + 1);
            base.setUTCDate(0);
            return { desde, hasta: Utils.fechaISO(base) };
        }
        const n = Number(periodo);
        return { desde: Utils.sumarDias(hoy, -(n - 1)), hasta: hoy };
    }

    const confirmadas = (lista) => lista.filter((r) => r.estado === 'confirmada');

    function calcular(reservas, desde, hasta, cerradas) {
        const ok = confirmadas(reservas);
        const dias = Utils.diferenciaDias(desde, hasta) + 1;
        const diasAbiertos = Array.from({ length: dias }, (_, i) => Utils.sumarDias(desde, i)).filter((d) => !cerradas.has(d));
        const capacidad = Config.canchasActivas().length * Config.horarios().length * diasAbiertos.length;
        const horas = ok.reduce((s, r) => s + r.horas, 0);
        const canceladas = reservas.filter((r) => r.estado === 'cancelada').length;
        const tomadas = ok.length + canceladas;
        return {
            turnos: ok.length,
            horas,
            facturacion: ok.reduce((s, r) => s + r.precio_total, 0),
            seniasOnline: ok.filter((r) => ['aprobado', 'demo'].includes(r.pago_estado)).reduce((s, r) => s + r.monto_senia, 0),
            ocupacion: capacidad ? (horas / capacidad) * 100 : 0,
            cancelacion: tomadas ? (canceladas / tomadas) * 100 : 0,
            ausentes: ok.filter((r) => r.asistencia === 'ausente').length,
            clientes: new Set(ok.map((r) => Utils.claveTelefono(r.cliente_telefono) || r.cliente_nombre.toLowerCase())).size,
            diasAbiertos
        };
    }

    function delta(actual, anterior, sufijo = '%', invertir = false) {
        if (!anterior) return '';
        const d = ((actual - anterior) / anterior) * 100;
        if (!Number.isFinite(d) || Math.abs(d) < 0.5) return '<em class="delta">= igual que el período anterior</em>';
        const mejor = invertir ? d < 0 : d > 0;
        return `<em class="delta ${mejor ? 'sube' : 'baja'}">${d > 0 ? '▲' : '▼'} ${Math.abs(Math.round(d))}${sufijo} vs. período anterior</em>`;
    }

    async function render() {
        const contenedor = $('estadisticas');
        const { desde, hasta } = rango();
        const largo = Utils.diferenciaDias(desde, hasta) + 1;
        const antDesde = Utils.sumarDias(desde, -largo);
        const antHasta = Utils.sumarDias(desde, -1);
        contenedor.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton corto"></div>';

        let reservas, anteriores, cierres;
        try {
            [reservas, anteriores, cierres] = await Promise.all([
                Admin.reservasEntre(desde, hasta),
                Admin.reservasEntre(antDesde, antHasta),
                Db.q(Db.sb.from('fechas_cerradas').select('fecha').gte('fecha', antDesde).lte('fecha', hasta))
            ]);
        } catch (e) {
            contenedor.innerHTML = `<p class="vacio">${Utils.esc(e.message)}</p>`;
            return;
        }
        const cerradas = new Set(cierres.map((c) => c.fecha));
        const m = calcular(reservas, desde, hasta, cerradas);
        const a = calcular(anteriores, antDesde, antHasta, cerradas);
        ultimo = { desde, hasta, reservas };
        const ok = confirmadas(reservas);

        const kpi = (valor, etiqueta, extra = '') => `<div class="kpi"><strong>${valor}</strong><span>${etiqueta}</span>${extra}</div>`;
        const kpis = `<div class="kpis kpis-chicos">
            ${kpi(Utils.moneda(m.facturacion), 'Facturación', delta(m.facturacion, a.facturacion))}
            ${kpi(m.turnos, 'Turnos jugados o reservados', delta(m.turnos, a.turnos))}
            ${kpi(`${Math.round(m.ocupacion)}%`, 'Ocupación de las canchas', delta(m.ocupacion, a.ocupacion))}
            ${kpi(Utils.moneda(m.seniasOnline), 'Señas cobradas online')}
            ${kpi(m.clientes, 'Clientes distintos', delta(m.clientes, a.clientes))}
            ${kpi(`${Math.round(m.cancelacion)}%`, 'Cancelaciones', delta(m.cancelacion, a.cancelacion, '%', true))}
            ${kpi(m.ausentes, 'Turnos sin presentarse')}
        </div>`;

        if (!ok.length) {
            contenedor.innerHTML = `<p class="muted">Del ${Utils.esc(Utils.fechaCorta(desde))} al ${Utils.esc(Utils.fechaCorta(hasta))}.</p>${kpis}<p class="vacio">Todavía no hay turnos confirmados en este período.</p>`;
            return;
        }

        contenedor.innerHTML = `
            <p class="muted">Del ${Utils.esc(Utils.fechaLarga(desde))} al ${Utils.esc(Utils.fechaLarga(hasta))}. Se cuentan los turnos confirmados (jugados y por jugar).</p>
            ${kpis}
            <div class="graficos">
                <figure class="card-box grafico grafico-ancho"><figcaption><h3>Facturación por día</h3></figcaption>${barrasPorDia(ok, desde, hasta)}</figure>
                <figure class="card-box grafico grafico-ancho"><figcaption><h3>¿Cuándo se llenan las canchas?</h3><p class="muted">Porcentaje de ocupación por día de la semana y horario.</p></figcaption>${mapaCalor(ok, m.diasAbiertos)}</figure>
                <figure class="card-box grafico"><figcaption><h3>Por cancha</h3></figcaption>${porCancha(ok)}</figure>
                <figure class="card-box grafico"><figcaption><h3>Cómo reservan</h3></figcaption>${porOrigen(ok)}</figure>
                <figure class="card-box grafico grafico-ancho"><figcaption><h3>Mejores clientes</h3></figcaption>${topClientes(reservas)}</figure>
            </div>`;
        activarTooltips(contenedor);
    }

    // ---------- Gráficos (HTML + CSS, sin librerías) ----------
    function barrasPorDia(ok, desde, hasta) {
        const dias = Utils.diferenciaDias(desde, hasta) + 1;
        const valores = Array.from({ length: dias }, (_, i) => {
            const fecha = Utils.sumarDias(desde, i);
            const del = ok.filter((r) => r.fecha === fecha);
            return { fecha, total: del.reduce((s, r) => s + r.precio_total, 0), turnos: del.length };
        });
        const max = Math.max(...valores.map((v) => v.total), 1);
        const mostrarEtiqueta = (i) => dias <= 14 || i % Math.ceil(dias / 10) === 0;
        const mejor = valores.reduce((a, b) => (b.total > a.total ? b : a));
        return `<div class="barras" role="img" aria-label="Facturación diaria. Mejor día: ${Utils.esc(Utils.fechaCorta(mejor.fecha))} con ${Utils.moneda(mejor.total)}">
            <div class="barras-eje"><span>${Utils.moneda(max)}</span><span>${Utils.moneda(max / 2)}</span><span>$ 0</span></div>
            <div class="barras-area">${valores.map((v, i) => `
                <div class="barra-col" tabindex="0" data-tip="${Utils.esc(`${Utils.fechaMedia(v.fecha)}: ${Utils.moneda(v.total)} · ${v.turnos} turno(s)`)}">
                    <div class="barra" style="height:${(v.total / max) * 100}%"></div>
                    <span class="barra-etq">${mostrarEtiqueta(i) ? Utils.esc(dias <= 14 ? Utils.fechaMedia(v.fecha).replace(/ \w+$/, '') : v.fecha.slice(8)) : ''}</span>
                </div>`).join('')}
            </div>
        </div>
        <p class="hint">Mejor día: <strong>${Utils.esc(Utils.fechaLarga(mejor.fecha))}</strong> (${Utils.moneda(mejor.total)}).</p>`;
    }

    function mapaCalor(ok, diasAbiertos) {
        const horas = Config.horarios();
        const canchas = Math.max(Config.canchasActivas().length, 1);
        const orden = [1, 2, 3, 4, 5, 6, 0]; // lunes a domingo
        const cuantosDias = (dow) => diasAbiertos.filter((d) => Utils.diaSemana(d) === dow).length;
        const ocupado = {};
        ok.forEach((r) => {
            const dow = Utils.diaSemana(r.fecha);
            for (let i = 0; i < r.horas; i++) ocupado[`${dow}|${r.hora_inicio + i}`] = (ocupado[`${dow}|${r.hora_inicio + i}`] || 0) + 1;
        });
        let pico = { pct: 0 };
        const filas = orden.map((dow) => {
            const n = cuantosDias(dow) * canchas;
            const celdas = horas.map((h) => {
                const pct = n ? Math.min(100, ((ocupado[`${dow}|${h}`] || 0) / n) * 100) : 0;
                if (pct > pico.pct) pico = { pct, dow, h };
                const nivel = pct === 0 ? 0 : Math.min(5, Math.ceil(pct / 20));
                return `<td class="calor n${nivel}" tabindex="0" data-tip="${Utils.esc(`${Utils.capitalizar(Utils.DIAS[dow])} ${Utils.hhmm(h)}: ${Math.round(pct)}% ocupado`)}"><span class="sr-only">${Math.round(pct)}%</span></td>`;
            }).join('');
            return `<tr><th scope="row">${Utils.DIAS_CORTOS[dow]}</th>${celdas}</tr>`;
        }).join('');
        return `<div class="calor-wrap"><table class="mapa-calor">
                <thead><tr><th></th>${horas.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
                <tbody>${filas}</tbody></table></div>
            <div class="calor-leyenda"><span>Libre</span>${[0, 1, 2, 3, 4, 5].map((n) => `<i class="calor n${n}"></i>`).join('')}<span>Lleno</span></div>
            ${pico.pct ? `<p class="hint">Horario más pedido: <strong>${Utils.esc(Utils.DIAS[pico.dow])} a las ${Utils.hhmm(pico.h)}</strong> (${Math.round(pico.pct)}% ocupado). Los horarios claros son ideales para promociones.</p>` : ''}`;
    }

    function barrasHorizontales(items, formato) {
        const max = Math.max(...items.map((i) => i.valor), 1);
        return `<ul class="barras-h">${items.map((i) => `
            <li tabindex="0" data-tip="${Utils.esc(i.tip || `${i.nombre}: ${formato(i.valor)}`)}">
                <div class="barras-h-fila"><span>${Utils.esc(i.nombre)}</span><strong>${formato(i.valor)}</strong></div>
                <div class="barras-h-pista"><div class="barras-h-barra" style="width:${(i.valor / max) * 100}%"></div></div>
            </li>`).join('')}</ul>`;
    }

    function porCancha(ok) {
        const mapa = {};
        ok.forEach((r) => {
            const m = (mapa[r.cancha_id] ||= { nombre: r.cancha_nombre, valor: 0, horas: 0, turnos: 0 });
            m.valor += r.precio_total; m.horas += r.horas; m.turnos += 1;
        });
        const items = Object.values(mapa).sort((a, b) => b.valor - a.valor)
            .map((m) => ({ ...m, tip: `${m.nombre}: ${Utils.moneda(m.valor)} · ${m.turnos} turnos · ${m.horas} horas` }));
        return barrasHorizontales(items, Utils.moneda);
    }

    function porOrigen(ok) {
        const nombres = { mercadopago: 'Online con Mercado Pago', transferencia: 'Online con transferencia', manual: 'Mostrador / teléfono', fijo: 'Turnos fijos' };
        const mapa = {};
        ok.forEach((r) => { mapa[r.metodo_pago] = (mapa[r.metodo_pago] || 0) + 1; });
        const total = ok.length;
        const items = Object.entries(mapa).sort((a, b) => b[1] - a[1])
            .map(([k, v]) => ({ nombre: nombres[k] || k, valor: v, tip: `${nombres[k] || k}: ${v} turnos (${Math.round((v / total) * 100)}%)` }));
        return barrasHorizontales(items, (v) => `${v} · ${Math.round((v / total) * 100)}%`);
    }

    function topClientes(reservas) {
        const mapa = new Map();
        reservas.forEach((r) => {
            const k = Utils.claveTelefono(r.cliente_telefono) || r.cliente_nombre.toLowerCase();
            const c = mapa.get(k) || { nombre: r.cliente_nombre, telefono: r.cliente_telefono, turnos: 0, horas: 0, gastado: 0, ausencias: 0, cancelaciones: 0 };
            if (r.estado === 'confirmada') { c.turnos++; c.horas += r.horas; c.gastado += r.precio_total; }
            if (r.asistencia === 'ausente') c.ausencias++;
            if (r.estado === 'cancelada') c.cancelaciones++;
            mapa.set(k, c);
        });
        const top = [...mapa.values()].filter((c) => c.turnos).sort((a, b) => b.gastado - a.gastado).slice(0, 10);
        return `<div class="tabla-wrap"><table class="tabla">
            <thead><tr><th>#</th><th>Cliente</th><th>Turnos</th><th>Horas</th><th>Facturó</th><th>Cancel. / ausencias</th></tr></thead>
            <tbody>${top.map((c, i) => `<tr>
                <td data-label="#">${i + 1}</td>
                <td data-label="Cliente"><strong>${Utils.esc(c.nombre)}</strong><br><small>${Utils.esc(c.telefono)}</small></td>
                <td data-label="Turnos">${c.turnos}</td>
                <td data-label="Horas">${c.horas}</td>
                <td data-label="Facturó">${Utils.moneda(c.gastado)}</td>
                <td data-label="Cancel. / ausencias">${c.cancelaciones} / ${c.ausencias}</td>
            </tr>`).join('')}</tbody></table></div>`;
    }

    // Tooltip flotante para las barras y el mapa de calor (mouse, dedo y teclado)
    function activarTooltips(raiz) {
        let tip = document.getElementById('tooltip-grafico');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'tooltip-grafico';
            tip.className = 'tooltip-grafico';
            tip.setAttribute('role', 'status');
            document.body.appendChild(tip);
        }
        const mostrar = (el) => {
            tip.textContent = el.dataset.tip;
            tip.hidden = false;
            const r = el.getBoundingClientRect();
            const ancho = tip.offsetWidth;
            tip.style.left = `${Math.min(window.innerWidth - ancho - 8, Math.max(8, r.left + r.width / 2 - ancho / 2))}px`;
            tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8) + window.scrollY}px`;
        };
        const ocultar = () => { tip.hidden = true; };
        ocultar();
        raiz.querySelectorAll('[data-tip]').forEach((el) => {
            el.addEventListener('mouseenter', () => mostrar(el));
            el.addEventListener('focus', () => mostrar(el));
            el.addEventListener('click', () => mostrar(el));
            el.addEventListener('mouseleave', ocultar);
            el.addEventListener('blur', ocultar);
        });
    }

    function descargarCsv() {
        if (!ultimo) return;
        const filas = [['Fecha', 'Horario', 'Cancha', 'Cliente', 'WhatsApp', 'Estado', 'Origen', 'Pago', 'Total', 'Seña', 'Saldo', 'Saldo cobrado', 'Asistencia', 'Código']];
        ultimo.reservas.forEach((r) => filas.push([
            r.fecha, Booking.rango(r), r.cancha_nombre, r.cliente_nombre, r.cliente_telefono, Booking.etiqueta(r).texto,
            Booking.METODOS[r.metodo_pago] || r.metodo_pago, Booking.PAGOS[r.pago_estado] || r.pago_estado,
            r.precio_total, r.monto_senia, Booking.saldo(r), r.saldo_cobrado ? 'Sí' : 'No', r.asistencia || '', r.codigo
        ]));
        Utils.descargar(`reservas_${ultimo.desde}_a_${ultimo.hasta}.csv`, Utils.csv(filas), 'text/csv');
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('e-periodo')?.addEventListener('click', (e) => {
            const b = e.target.closest('[data-periodo]');
            if (!b) return;
            periodo = b.dataset.periodo;
            document.querySelectorAll('#e-periodo [data-periodo]').forEach((x) => x.classList.toggle('active', x === b));
            render();
        });
        document.getElementById('btn-csv')?.addEventListener('click', descargarCsv);
        document.getElementById('btn-imprimir')?.addEventListener('click', () => window.print());
    });

    Admin.registrar('estadisticas', { render });
    return { render };
})();
