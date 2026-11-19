// js/admin.js - Panel de gestión: núcleo, grilla del día, agenda, detalle de turnos y reservas de mostrador.
// Los otros módulos (turnos fijos, estadísticas, ajustes) se registran con Admin.registrar().

const Admin = (() => {
    const $ = (id) => document.getElementById(id);
    const modulos = {};
    let pestanaActual = 'grilla';
    let fechaGrilla = null;
    let clientesConocidos = null;

    document.addEventListener('DOMContentLoaded', () => UI.arrancar('admin', iniciar));

    async function iniciar() {
        if (!Auth.requerirStaff()) return;
        const u = Auth.usuario();
        $('contenido').hidden = false;
        $('admin-saludo').textContent = `Hola, ${u.nombre.split(' ')[0] || 'equipo'}`;
        if (!Auth.esDuenio()) document.querySelectorAll('[data-duenio]').forEach((el) => el.remove());

        fechaGrilla = Utils.hoyISO();
        $('g-fecha').value = fechaGrilla;
        $('f-desde').value = Utils.hoyISO();
        $('f-hasta').value = Utils.sumarDias(Utils.hoyISO(), 14);
        renderFiltroCanchas();

        iniciarEventos();
        iniciarPestanas();
        avisoModo();
        refrescar();
        tiempoReal();
        setInterval(() => { if (!document.hidden) refrescar(); }, 60000);
    }

    const registrar = (tab, modulo) => { modulos[tab] = modulo; };

    async function avisoModo() {
        const s = await Config.cargarEstadoServidor();
        const aviso = $('aviso-modo');
        if (s.modoPago === 'demo') {
            aviso.innerHTML = '<strong>Modo demostración:</strong> los pagos con Mercado Pago son simulados (no se cobra dinero). Para cobrar de verdad hay que conectar la cuenta de Mercado Pago del complejo. <a href="#" data-ir="ajustes">Ver cómo</a>';
            aviso.hidden = false;
        } else if (s.credencialesDePrueba) {
            aviso.innerHTML = '<strong>Mercado Pago en modo prueba:</strong> están cargadas credenciales de prueba (TEST-). Cambialas por las de producción para cobrar de verdad.';
            aviso.hidden = false;
        } else if (s.modoPago === 'sin_servidor') {
            aviso.innerHTML = '<strong>Sin conexión con el servidor de pagos.</strong> Revisá que las variables de entorno estén cargadas en Vercel.';
            aviso.hidden = false;
        } else {
            aviso.hidden = true;
        }
    }

    // ---------- Datos ----------
    const reservasEntre = (desde, hasta, extra = (q) => q) => Db.todas(() =>
        extra(Db.sb.from('reservas').select('*').gte('fecha', desde).lte('fecha', hasta)).order('fecha').order('hora_inicio'));

    async function refrescar() {
        await Promise.allSettled([renderKpis(), renderGrilla(), revisarDevoluciones()]);
        if (pestanaActual !== 'grilla' && modulos[pestanaActual]?.render) modulos[pestanaActual].render();
    }

    async function revisarDevoluciones() {
        const pendientes = await Db.q(Db.sb.from('reservas').select('id', { count: 'exact', head: false }).eq('pago_estado', 'reembolso_pendiente'));
        const aviso = $('aviso-devoluciones');
        aviso.hidden = !pendientes.length;
        if (pendientes.length) {
            aviso.innerHTML = `<strong>${pendientes.length} seña(s) para devolver a mano.</strong> Son pagos que no se pudieron aplicar a un turno. <a href="#" data-ver-devoluciones>Ver cuáles</a>`;
        }
    }

    // ---------- Pestañas ----------
    function iniciarPestanas() {
        const pestanas = Array.from(document.querySelectorAll('.admin-tab'));
        let guardada = null;
        try { guardada = sessionStorage.getItem('adminTab'); } catch (_) { /* opcional */ }
        activar(pestanas.some((t) => t.dataset.tab === guardada) ? guardada : 'grilla');
        pestanas.forEach((t) => t.addEventListener('click', () => activar(t.dataset.tab)));
    }

    function activar(clave) {
        pestanaActual = clave;
        document.querySelectorAll('.admin-tab').forEach((t) => {
            const activa = t.dataset.tab === clave;
            t.classList.toggle('active', activa);
            t.setAttribute('aria-selected', String(activa));
            $(`panel-${t.dataset.tab}`).hidden = !activa;
        });
        try { sessionStorage.setItem('adminTab', clave); } catch (_) { /* opcional */ }
        if (clave === 'agenda') renderAgenda();
        else if (modulos[clave]?.render) modulos[clave].render();
    }

    // ---------- KPIs ----------
    async function renderKpis() {
        const hoy = Utils.hoyISO();
        const reservas = await reservasEntre(hoy, Utils.sumarDias(hoy, 6), (q) => q.in('estado', ['confirmada', 'pendiente_pago']));
        const deHoy = reservas.filter((r) => r.fecha === hoy && r.estado === 'confirmada');
        const horasHoy = deHoy.reduce((s, r) => s + r.horas, 0);
        const capacidad = Config.canchasActivas().length * Config.horarios().length;
        const ocupacion = capacidad ? Math.round((horasHoy / capacidad) * 100) : 0;
        const facturacion = deHoy.reduce((s, r) => s + r.precio_total, 0);
        const aCobrar = deHoy.filter((r) => !r.saldo_cobrado).reduce((s, r) => s + Booking.saldo(r), 0);
        const pendientes = reservas.filter((r) => r.estado === 'pendiente_pago').length;
        const semana = reservas.filter((r) => r.estado === 'confirmada').length;

        const kpi = (valor, etiqueta, extra = '') => `<div class="kpi ${extra}"><strong>${valor}</strong><span>${etiqueta}</span></div>`;
        $('kpis').innerHTML =
            kpi(deHoy.length, 'Turnos hoy') +
            kpi(`${ocupacion}%`, 'Ocupación hoy') +
            kpi(Utils.moneda(facturacion), 'Facturación hoy') +
            kpi(Utils.moneda(aCobrar), 'Falta cobrar hoy', aCobrar ? 'kpi-info' : '') +
            kpi(pendientes, 'Esperando pago', pendientes ? 'kpi-alerta' : '') +
            kpi(semana, 'Turnos próximos 7 días');
    }

    // ---------- Grilla del día ----------
    async function renderGrilla() {
        const fecha = fechaGrilla;
        $('g-titulo').textContent = `${Utils.fechaAmigable(fecha)}${Utils.fechaAmigable(fecha) === Utils.fechaLarga(fecha) ? '' : ` · ${Utils.fechaLarga(fecha)}`}`;
        const [reservas, cierre] = await Promise.all([
            reservasEntre(fecha, fecha, (q) => q.in('estado', ['confirmada', 'pendiente_pago'])),
            Db.q(Db.sb.from('fechas_cerradas').select('*').eq('fecha', fecha).maybeSingle())
        ]);
        const activas = reservas.filter((r) => r.estado === 'confirmada' || !r.vence_en || Date.parse(r.vence_en) > Date.now());
        const canchas = Config.get().canchas.filter((c) => c.activa || activas.some((r) => r.cancha_id === c.id));
        const horas = Config.horarios();
        const ahora = Utils.ahora();

        // Resumen del día
        const confirmadas = activas.filter((r) => r.estado === 'confirmada');
        const total = confirmadas.reduce((s, r) => s + r.precio_total, 0);
        const cobradoSenias = confirmadas.filter(Booking.senaPagada).reduce((s, r) => s + r.monto_senia, 0);
        const falta = confirmadas.filter((r) => !r.saldo_cobrado).reduce((s, r) => s + Booking.saldo(r), 0);
        $('g-resumen').innerHTML = cierre
            ? `<div class="alert alert-error"><strong>Complejo cerrado este día.</strong> ${Utils.esc(cierre.motivo || '')}</div>`
            : `<span><strong>${confirmadas.length}</strong> turnos</span><span><strong>${Utils.moneda(total)}</strong> facturación</span><span><strong>${Utils.moneda(cobradoSenias)}</strong> en señas online</span><span class="${falta ? 'falta' : ''}"><strong>${Utils.moneda(falta)}</strong> por cobrar en la cancha</span>`;

        if (!canchas.length) { $('grilla').innerHTML = '<p class="vacio">No hay canchas activas.</p>'; return; }

        const cubiertas = new Set();
        const filas = horas.map((h) => {
            const pasado = Utils.crearFecha(fecha, h + 1) <= ahora;
            const actual = Utils.crearFecha(fecha, h) <= ahora && !pasado;
            const celdas = canchas.map((c) => {
                const clave = `${c.id}|${h}`;
                if (cubiertas.has(clave)) return '';
                const r = activas.find((x) => x.cancha_id === c.id && x.hora_inicio === h);
                if (r) {
                    for (let i = 1; i < r.horas; i++) cubiertas.add(`${c.id}|${h + i}`);
                    return `<td rowspan="${r.horas}" class="celda-turno">${htmlTurno(r)}</td>`;
                }
                if (cierre || pasado) return `<td class="celda-libre pasado"><span aria-hidden="true">—</span></td>`;
                return `<td class="celda-libre"><button type="button" class="btn-libre" data-libre data-cancha="${Utils.esc(c.id)}" data-hora="${h}" aria-label="Reservar ${Utils.esc(c.nombre)} a las ${Utils.hhmm(h)}">+ ${Utils.hhmm(h)}</button></td>`;
            }).join('');
            return `<tr class="${actual ? 'hora-actual' : ''}${pasado ? ' hora-pasada' : ''}"><th scope="row">${Utils.hhmm(h)}</th>${celdas}</tr>`;
        }).join('');

        $('grilla').innerHTML = `<table class="grilla" style="--cols:${canchas.length}">
            <thead><tr><th scope="col"><span class="sr-only">Hora</span></th>${canchas.map((c) => `<th scope="col">${Utils.esc(c.nombre)}${c.activa ? '' : ' <small>(oculta)</small>'}</th>`).join('')}</tr></thead>
            <tbody>${filas}</tbody></table>`;
    }

    function htmlTurno(r) {
        const chips = [];
        if (r.estado === 'pendiente_pago') chips.push('<span class="mini mini-ambar">Esperando pago</span>');
        else if (r.turno_fijo_id) chips.push('<span class="mini mini-azul">Fijo</span>');
        if (r.estado === 'confirmada' && Booking.senaPagada(r)) chips.push('<span class="mini mini-verde">Seña ✓</span>');
        if (r.estado === 'confirmada') {
            chips.push(r.saldo_cobrado ? '<span class="mini mini-verde">Cobrado ✓</span>' : `<span class="mini">Cobrar ${Utils.moneda(Booking.saldo(r))}</span>`);
        }
        if (r.asistencia === 'ausente') chips.push('<span class="mini mini-rojo">No vino</span>');
        return `<button type="button" class="turno estado-${r.estado}${r.turno_fijo_id ? ' es-fijo' : ''}" data-reserva="${Utils.esc(r.id)}">
            <strong>${Utils.esc(r.cliente_nombre)}</strong>
            <small>${Booking.rango(r)}</small>
            <span class="chips">${chips.join('')}</span>
        </button>`;
    }

    // ---------- Agenda ----------
    function renderFiltroCanchas() {
        $('f-cancha').innerHTML = '<option value="">Todas</option>' + Config.todas().map((c) => `<option value="${Utils.esc(c.id)}">${Utils.esc(c.nombre)}</option>`).join('');
    }

    let agendaPendiente = null;
    async function renderAgenda() {
        const desde = $('f-desde').value || Utils.hoyISO();
        const hasta = $('f-hasta').value || desde;
        const cancha = $('f-cancha').value;
        const estado = $('f-estado').value;
        const texto = $('f-buscar').value.trim().toLowerCase();
        const pedido = Symbol('agenda');
        agendaPendiente = pedido;

        let reservas;
        try {
            reservas = estado === 'devolver'
                ? await Db.q(Db.sb.from('reservas').select('*').eq('pago_estado', 'reembolso_pendiente').order('fecha'))
                : await reservasEntre(desde, hasta, (q) => (cancha ? q.eq('cancha_id', cancha) : q));
        } catch (e) {
            $('lista-agenda').innerHTML = `<p class="vacio">${Utils.esc(e.message)}</p>`;
            return;
        }
        if (agendaPendiente !== pedido) return;

        const filas = reservas.filter((r) => {
            if (estado === 'vigentes' && !Booking.vigente(r)) return false;
            if (estado === 'saldo' && !(r.estado === 'confirmada' && !r.saldo_cobrado && Booking.saldo(r) > 0)) return false;
            if (['pendiente_pago', 'confirmada', 'cancelada', 'vencida'].includes(estado) && r.estado !== estado) return false;
            if (texto && ![r.cliente_nombre, r.cliente_telefono, r.codigo, r.cliente_email].some((v) => String(v || '').toLowerCase().includes(texto))) return false;
            return true;
        });

        if (!filas.length) { $('lista-agenda').innerHTML = '<p class="vacio">No hay reservas con estos filtros.</p>'; return; }
        $('lista-agenda').innerHTML = `
            <table class="tabla tabla-clic">
                <thead><tr><th>Turno</th><th>Cancha</th><th>Cliente</th><th>Pago</th><th>Estado</th></tr></thead>
                <tbody>${filas.map((r) => {
                    const e = Booking.etiqueta(r);
                    return `<tr data-reserva="${Utils.esc(r.id)}" tabindex="0">
                        <td data-label="Turno"><strong>${Utils.esc(Utils.fechaCorta(r.fecha))}</strong><br>${Booking.rango(r)}</td>
                        <td data-label="Cancha">${Utils.esc(r.cancha_nombre)}</td>
                        <td data-label="Cliente"><strong>${Utils.esc(r.cliente_nombre)}</strong><br><small>${Utils.esc(r.cliente_telefono)} · ${Utils.esc(r.codigo)}</small></td>
                        <td data-label="Pago">${Utils.moneda(r.precio_total)}<br><small>${Utils.esc(Booking.METODOS[r.metodo_pago] || '')} · ${Utils.esc(Booking.PAGOS[r.pago_estado] || '')}</small></td>
                        <td data-label="Estado"><span class="badge ${e.clase}">${e.texto}</span>${r.estado === 'confirmada' && !r.saldo_cobrado && Booking.saldo(r) ? `<br><small>Saldo ${Utils.moneda(Booking.saldo(r))}</small>` : ''}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>`;
    }

    // ---------- Detalle de un turno ----------
    async function detalle(id) {
        let r;
        try { r = await Db.q(Db.sb.from('reservas').select('*').eq('id', id).single()); } catch (e) { UI.toast(e.message, 'error'); return; }
        const cfg = Config.get();
        const e = Booking.etiqueta(r);
        const saldo = Booking.saldo(r);
        const vigente = Booking.vigente(r);
        const wa = Utils.linkWhatsApp(r.cliente_telefono, `Hola ${r.cliente_nombre.split(' ')[0]}, te escribimos de ${cfg.nombreComplejo} por tu turno del ${Utils.fechaLarga(r.fecha)} de ${Booking.rango(r)} (${r.cancha_nombre}).`);
        const link = `${location.origin}/${Booking.linkReserva(r)}`;

        const filas = [
            ['Turno', `${Utils.esc(Utils.fechaLarga(r.fecha))}, ${Booking.rango(r)}`],
            ['Cancha', Utils.esc(r.cancha_nombre)],
            ['Cliente', `${Utils.esc(r.cliente_nombre)}${r.cliente_telefono ? `<br><small>${Utils.esc(r.cliente_telefono)}</small>` : ''}${r.cliente_email ? `<br><small>${Utils.esc(r.cliente_email)}</small>` : ''}${r.usuario_id ? ' <span class="mini mini-azul">Con cuenta</span>' : ''}`],
            ['Total', `${Utils.moneda(r.precio_total)}${r.descuento ? ` <small>(promo -${Utils.moneda(r.descuento)})</small>` : ''}`],
            ['Seña', `${Utils.moneda(r.monto_senia)} <small>· ${Utils.esc(Booking.METODOS[r.metodo_pago] || '')} · ${Utils.esc(Booking.PAGOS[r.pago_estado] || '')}</small>`],
            r.estado === 'confirmada' ? ['Resto a cobrar', `<strong>${Utils.moneda(saldo)}</strong>${r.saldo_cobrado ? ' <span class="mini mini-verde">Cobrado ✓</span>' : ''}`] : null,
            r.mp_payment_id ? ['Pago Mercado Pago', `N.º ${Utils.esc(r.mp_payment_id)}`] : null,
            r.motivo ? ['Nota del sistema', Utils.esc(r.motivo)] : null,
            ['Código', `${Utils.esc(r.codigo)} · <small>creada ${Utils.esc(Utils.fechaCorta(Utils.fechaISO(Utils.deInstante(r.creada))))} ${Utils.horaDe(Utils.deInstante(r.creada))}</small>`]
        ].filter(Boolean);

        const botones = [];
        if (r.estado === 'pendiente_pago' && r.metodo_pago === 'transferencia') botones.push('<button type="button" class="btn btn-sm" data-acc="confirmar">Confirmar transferencia</button>');
        if (r.estado === 'pendiente_pago' && r.metodo_pago === 'mercadopago') botones.push('<button type="button" class="btn btn-sm btn-secundario" data-acc="confirmar">Marcar como pagada</button>');
        if (r.estado === 'confirmada') {
            botones.push(r.saldo_cobrado
                ? '<button type="button" class="btn btn-sm btn-secundario" data-acc="saldo-no">Desmarcar cobro</button>'
                : `<button type="button" class="btn btn-sm btn-verde" data-acc="saldo-si">Cobré el resto (${Utils.moneda(saldo)})</button>`);
            if (Booking.inicio(r) <= Utils.ahora()) {
                botones.push(`<button type="button" class="btn btn-sm btn-secundario" data-acc="presente"${r.asistencia === 'presente' ? ' disabled' : ''}>Vinieron ✓</button>`);
                botones.push(`<button type="button" class="btn btn-sm btn-secundario" data-acc="ausente"${r.asistencia === 'ausente' ? ' disabled' : ''}>No vinieron</button>`);
            }
        }
        if (['cancelada', 'vencida'].includes(r.estado) && !Booking.terminada(r)) botones.push('<button type="button" class="btn btn-sm btn-secundario" data-acc="reactivar">Reactivar turno</button>');
        if (r.pago_estado === 'reembolso_pendiente') botones.push('<button type="button" class="btn btn-sm btn-secundario" data-acc="devuelta">Ya devolví la seña</button>');
        if (vigente) botones.push('<button type="button" class="btn btn-sm btn-peligro" data-acc="cancelar">Cancelar turno</button>');

        const ctl = UI.modal({
            titulo: 'Detalle del turno',
            clase: 'modal-ancho',
            cuerpo: `
                <p><span class="badge ${e.clase}">${e.texto}</span>${r.turno_fijo_id ? ' <span class="mini mini-azul">Turno fijo</span>' : ''}</p>
                <dl class="ticket-datos compacto">${filas.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
                ${botones.length ? `<div class="acciones-detalle">${botones.join('')}</div>` : ''}
                <div class="field"><label for="d-notas">Notas internas (no las ve el cliente)</label><textarea id="d-notas" maxlength="500">${Utils.esc(r.notas || '')}</textarea></div>
                <div class="acciones-detalle">
                    ${wa ? `<a class="btn btn-sm btn-whatsapp" href="${Utils.esc(wa)}" target="_blank" rel="noopener">WhatsApp al cliente</a>` : ''}
                    <button type="button" class="btn btn-sm btn-secundario" data-acc="link">Copiar link del comprobante</button>
                </div>`,
            botones: [{ texto: 'Cerrar', clase: 'btn-secundario', accion: async () => { await guardarNotas(r); } }]
        });

        ctl.el.addEventListener('click', async (ev) => {
            const b = ev.target.closest('[data-acc]');
            if (!b) return;
            const acc = b.dataset.acc;
            if (acc === 'link') { b.textContent = (await Utils.copiar(link)) ? '¡Copiado!' : link; return; }
            const ok = await accionTurno(r, acc, b);
            if (ok) { await guardarNotas(r); ctl.cerrar(); refrescar(); if (pestanaActual === 'agenda') renderAgenda(); }
        });

        async function guardarNotas(reserva) {
            const notas = ctl.el.querySelector('#d-notas')?.value ?? reserva.notas;
            if (notas !== (reserva.notas || '')) {
                try { await Db.q(Db.sb.from('reservas').update({ notas }).eq('id', reserva.id)); reserva.notas = notas; UI.toast('Nota guardada.'); } catch (err) { UI.toast(err.message, 'error'); }
            }
        }
    }

    async function accionTurno(r, acc, boton) {
        try {
            if (acc === 'confirmar' || acc === 'reactivar') {
                await UI.conBoton(boton, 'Guardando…', () => Db.rpc('staff_confirmar', { p_id: r.id }));
                UI.toast(acc === 'confirmar' ? 'Pago confirmado. El turno quedó firme.' : 'Turno reactivado.');
            } else if (acc === 'saldo-si' || acc === 'saldo-no') {
                await Db.q(Db.sb.from('reservas').update({ saldo_cobrado: acc === 'saldo-si', asistencia: acc === 'saldo-si' ? 'presente' : r.asistencia }).eq('id', r.id));
                UI.toast(acc === 'saldo-si' ? 'Cobro registrado.' : 'Cobro desmarcado.');
            } else if (acc === 'presente' || acc === 'ausente') {
                await Db.q(Db.sb.from('reservas').update({ asistencia: acc }).eq('id', r.id));
                UI.toast(acc === 'presente' ? 'Asistencia registrada.' : 'Marcado como ausente.');
            } else if (acc === 'devuelta') {
                await Db.rpc('staff_marcar_devuelta', { p_id: r.id });
                UI.toast('Listo, quedó registrada la devolución.');
            } else if (acc === 'cancelar') {
                return await cancelarTurno(r);
            }
            return true;
        } catch (e) {
            UI.alerta('No se pudo completar', Utils.esc(e.message));
            return false;
        }
    }

    function cancelarTurno(r) {
        return new Promise((resolve) => {
            const pagada = Booking.senaPagada(r) && r.pago_estado !== 'confirmado_admin';
            const transferida = r.pago_estado === 'confirmado_admin';
            UI.modal({
                titulo: '¿Cancelar este turno?',
                cuerpo: `<p>${Utils.esc(r.cliente_nombre)} · ${Utils.esc(Utils.fechaLarga(r.fecha))}, ${Booking.rango(r)}. El horario queda libre.</p>
                    ${pagada ? `<label class="check"><input type="checkbox" id="c-reembolso" checked> Devolver la seña de ${Utils.moneda(r.monto_senia)} por Mercado Pago (automático)</label>` : ''}
                    ${transferida ? `<p class="hint">La seña fue por transferencia: si corresponde, devolvela a mano.</p>` : ''}
                    <div class="field"><label for="c-motivo">Motivo (opcional, lo ve el cliente)</label><input type="text" id="c-motivo" maxlength="140" placeholder="Ej: lluvia, cancha en mantenimiento"></div>`,
                botones: [
                    { texto: 'Volver', clase: 'btn-secundario', accion: () => { resolve(false); } },
                    {
                        texto: 'Cancelar turno', clase: 'btn-peligro',
                        accion: async (ctl, boton) => {
                            try {
                                const res = await UI.conBoton(boton, 'Cancelando…', () => Db.api('cancelar', {
                                    id: r.id,
                                    reembolsar: !!ctl.el.querySelector('#c-reembolso')?.checked,
                                    motivo: ctl.el.querySelector('#c-motivo').value.trim()
                                }));
                                UI.toast(res.mensaje);
                                resolve(true);
                            } catch (e) {
                                UI.toast(e.message, 'error');
                                resolve(false);
                            }
                        }
                    }
                ],
                onCerrar: () => resolve(false)
            });
        });
    }

    // ---------- Nueva reserva (mostrador / teléfono) ----------
    async function cargarClientesConocidos() {
        if (clientesConocidos) return clientesConocidos;
        const filas = await Db.q(Db.sb.from('reservas').select('cliente_nombre, cliente_telefono').order('creada', { ascending: false }).limit(1000));
        const mapa = new Map();
        filas.forEach((f) => { const k = Utils.claveTelefono(f.cliente_telefono) || f.cliente_nombre.toLowerCase(); if (!mapa.has(k)) mapa.set(k, f); });
        clientesConocidos = [...mapa.values()];
        return clientesConocidos;
    }

    async function nuevaReserva(pre = {}) {
        const canchas = Config.canchasActivas();
        if (!canchas.length) { UI.alerta('Sin canchas', 'Primero activá o agregá una cancha.'); return; }
        const cfg = Config.get();
        const conocidos = await cargarClientesConocidos().catch(() => []);
        const fecha = pre.fecha || fechaGrilla || Utils.hoyISO();

        const ctl = UI.modal({
            titulo: 'Nueva reserva',
            clase: 'modal-ancho',
            cuerpo: `
                <form id="form-manual" class="form-grid" novalidate>
                    <div class="field"><label for="m-nombre">Nombre del cliente</label><input type="text" id="m-nombre" list="m-clientes" required autocomplete="off" value="${Utils.esc(pre.nombre || '')}"></div>
                    <div class="field"><label for="m-tel">WhatsApp</label><input type="tel" id="m-tel" inputmode="numeric" value="${Utils.esc(pre.telefono || '')}"></div>
                    <div class="field"><label for="m-cancha">Cancha</label><select id="m-cancha">${canchas.map((c) => `<option value="${Utils.esc(c.id)}"${c.id === pre.cancha ? ' selected' : ''}>${Utils.esc(c.nombre)}</option>`).join('')}</select></div>
                    <div class="field"><label for="m-fecha">Fecha</label><input type="date" id="m-fecha" value="${fecha}" min="${Utils.hoyISO()}"></div>
                    <div class="field"><label for="m-hora">Horario</label><select id="m-hora"></select></div>
                    <div class="field"><label for="m-horas">Duración</label><select id="m-horas">${Array.from({ length: cfg.maxHorasReserva }, (_, i) => `<option value="${i + 1}">${i + 1} hora${i ? 's' : ''}</option>`).join('')}</select></div>
                    <div class="field"><label for="m-senia">Seña que ya cobraste ($)</label><input type="number" id="m-senia" min="0" step="500" value="0"></div>
                    <div class="field field-check"><label class="check"><input type="checkbox" id="m-fijo"> Repetir todas las semanas (turno fijo)</label></div>
                </form>
                <datalist id="m-clientes">${conocidos.map((c) => `<option value="${Utils.esc(c.cliente_nombre)}" label="${Utils.esc(c.cliente_telefono)}"></option>`).join('')}</datalist>
                <p id="m-resumen" class="resumen-linea"></p>
                <p id="m-error" class="error-msg" role="alert" hidden></p>`,
            botones: [
                { texto: 'Cancelar', clase: 'btn-secundario' },
                { texto: 'Guardar reserva', accion: (c, boton) => guardarManual(c, boton) }
            ]
        });

        const el = (id) => ctl.el.querySelector(`#${id}`);
        el('m-nombre').addEventListener('change', () => {
            const c = conocidos.find((x) => x.cliente_nombre === el('m-nombre').value);
            if (c && !el('m-tel').value) el('m-tel').value = c.cliente_telefono;
        });

        async function actualizar() {
            const canchaId = el('m-cancha').value;
            const f = el('m-fecha').value;
            const previa = el('m-hora').value || (pre.hora !== undefined ? String(pre.hora) : '');
            if (!Utils.esFechaValida(f)) return;
            let ctx;
            try { ctx = await Booking.cargarContexto(f, f); } catch (e) { return; }
            el('m-hora').innerHTML = Config.horarios().map((h) => {
                const est = Booking.estadoHora(ctx, canchaId, f, h);
                const etiqueta = { libre: '', ocupado: ' (ocupado)', fijo: ' (turno fijo)', reservando: ' (reservando)', vencido: ' (pasó)', cerrado: ' (cerrado)' }[est];
                return `<option value="${h}"${est === 'libre' ? '' : ' disabled'}>${Utils.hhmm(h)}${etiqueta}</option>`;
            }).join('');
            const opcion = el('m-hora').querySelector(`option[value="${previa}"]:not([disabled])`) || el('m-hora').querySelector('option:not([disabled])');
            if (opcion) el('m-hora').value = opcion.value;
            const cancha = Config.canchaPorId(canchaId);
            const p = Booking.calcularPrecio(cancha, Number(el('m-horas').value));
            el('m-resumen').textContent = `Total ${Utils.moneda(p.total)}${p.descuento ? ' (con promo)' : ''}. ${el('m-fijo').checked ? `Se reservará todos los ${Utils.DIAS[Utils.diaSemana(f)]} a esta hora.` : ''}`;
        }
        ['m-cancha', 'm-fecha', 'm-horas', 'm-fijo'].forEach((id) => el(id).addEventListener('change', actualizar));
        actualizar();
        el('m-nombre').focus();
    }

    async function guardarManual(ctl, boton) {
        const el = (id) => ctl.el.querySelector(`#${id}`);
        const error = el('m-error');
        const mostrar = (m) => { error.textContent = m; error.hidden = !m; };
        const nombre = el('m-nombre').value.trim();
        if (nombre.length < 2) { mostrar('Ingresá el nombre del cliente.'); return false; }
        if (!el('m-hora').value) { mostrar('No hay horarios libres para esa cancha y fecha.'); return false; }
        const datos = {
            cancha_id: el('m-cancha').value, fecha: el('m-fecha').value, hora: Number(el('m-hora').value),
            horas: Number(el('m-horas').value), nombre, telefono: Utils.digitos(el('m-tel').value)
        };
        try {
            await UI.conBoton(boton, 'Guardando…', async () => {
                if (el('m-fijo').checked) {
                    const res = await AdminFijos.crear({ ...datos, dia_semana: Utils.diaSemana(datos.fecha), desde: datos.fecha });
                    UI.toast(`Turno fijo creado: ${res.creadas} turno(s) reservados.`);
                } else {
                    await Db.rpc('crear_reserva', { p: { ...datos, hora: Utils.hhmm(datos.hora), metodo: 'manual', senia: Number(el('m-senia').value) || 0 } });
                    UI.toast('Reserva guardada.');
                }
            });
        } catch (e) {
            mostrar(e.message);
            return false;
        }
        clientesConocidos = null;
        fechaGrilla = datos.fecha;
        $('g-fecha').value = fechaGrilla;
        refrescar();
        return true;
    }

    // ---------- Tiempo real ----------
    function tiempoReal() {
        const indicador = $('estado-vivo');
        const actualizar = Utils.debounce(refrescar, 600);
        Db.sb.channel('panel-reservas')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas' }, (p) => {
                const r = p.new || {};
                const recien = r.confirmada_en && Date.now() - Date.parse(r.confirmada_en) < 60000;
                if (r.estado === 'confirmada' && recien && r.metodo_pago === 'mercadopago') {
                    UI.toast(`💰 Nueva reserva pagada: ${r.cliente_nombre} · ${r.cancha_nombre} · ${Utils.fechaCorta(r.fecha)} ${Utils.hhmm(r.hora_inicio)}`);
                    if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
                } else if (p.eventType === 'INSERT' && r.estado === 'pendiente_pago') {
                    UI.toast(`⏳ ${r.cliente_nombre} está pagando ${r.cancha_nombre} · ${Utils.fechaCorta(r.fecha)} ${Utils.hhmm(r.hora_inicio)}`, 'aviso');
                }
                actualizar();
            })
            .subscribe((estado) => {
                indicador.classList.toggle('conectado', estado === 'SUBSCRIBED');
                indicador.title = estado === 'SUBSCRIBED' ? 'Conectado: las reservas nuevas aparecen solas' : 'Reconectando…';
            });
    }

    // ---------- Eventos ----------
    function iniciarEventos() {
        $('btn-nueva-reserva').addEventListener('click', () => nuevaReserva());
        document.querySelector('.navegador-dia').addEventListener('click', (e) => {
            const b = e.target.closest('[data-dia]');
            if (!b) return;
            fechaGrilla = b.dataset.dia === 'hoy' ? Utils.hoyISO() : Utils.sumarDias(fechaGrilla, Number(b.dataset.dia));
            $('g-fecha').value = fechaGrilla;
            renderGrilla();
        });
        $('g-fecha').addEventListener('change', () => {
            if (!Utils.esFechaValida($('g-fecha').value)) return;
            fechaGrilla = $('g-fecha').value;
            renderGrilla();
        });
        $('grilla').addEventListener('click', (e) => {
            const turno = e.target.closest('[data-reserva]');
            if (turno) { detalle(turno.dataset.reserva); return; }
            const libre = e.target.closest('[data-libre]');
            if (libre) nuevaReserva({ cancha: libre.dataset.cancha, hora: Number(libre.dataset.hora), fecha: fechaGrilla });
        });

        ['f-desde', 'f-hasta', 'f-cancha', 'f-estado'].forEach((id) => $(id).addEventListener('change', renderAgenda));
        $('f-buscar').addEventListener('input', Utils.debounce(renderAgenda, 300));
        $('lista-agenda').addEventListener('click', (e) => { const f = e.target.closest('[data-reserva]'); if (f) detalle(f.dataset.reserva); });
        $('lista-agenda').addEventListener('keydown', (e) => { const f = e.target.closest('[data-reserva]'); if (f && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); detalle(f.dataset.reserva); } });

        document.addEventListener('click', (e) => {
            if (e.target.closest('[data-ver-devoluciones]')) { e.preventDefault(); $('f-estado').value = 'devolver'; activar('agenda'); }
            const ir = e.target.closest('[data-ir]');
            if (ir) { e.preventDefault(); activar(ir.dataset.ir); }
        });
    }

    return { $, registrar, refrescar, detalle, nuevaReserva, reservasEntre, activar, renderFiltroCanchas, cargarClientesConocidos };
})();
