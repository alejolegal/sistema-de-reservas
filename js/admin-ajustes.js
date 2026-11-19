// js/admin-ajustes.js - Clientes, canchas, horarios, días cerrados, ajustes, cobros y exportación.

(() => {
    const $ = (id) => document.getElementById(id);

    // =====================================================================
    // CLIENTES
    // =====================================================================
    let clientes = [];

    async function cargarClientes() {
        const [perfiles, reservas] = await Promise.all([
            Db.todas(() => Db.sb.from('perfiles').select('*').order('creado')),
            Db.todas(() => Db.sb.from('reservas').select('cliente_nombre, cliente_telefono, cliente_email, usuario_id, estado, fecha, hora_inicio, horas, precio_total, asistencia').order('fecha'))
        ]);
        const mapa = new Map();
        const claveDe = (tel, nombre) => Utils.claveTelefono(tel) || `n:${String(nombre).toLowerCase()}`;

        perfiles.forEach((p) => {
            mapa.set(claveDe(p.telefono, p.nombre), {
                nombre: p.nombre, telefono: p.telefono, email: p.email, perfil: p,
                turnos: 0, horas: 0, gastado: 0, ausencias: 0, cancelaciones: 0, ultimo: null
            });
        });
        reservas.forEach((r) => {
            const k = claveDe(r.cliente_telefono, r.cliente_nombre);
            const c = mapa.get(k) || { nombre: r.cliente_nombre, telefono: r.cliente_telefono, email: r.cliente_email, perfil: null, turnos: 0, horas: 0, gastado: 0, ausencias: 0, cancelaciones: 0, ultimo: null };
            if (r.estado === 'confirmada') {
                c.turnos++; c.horas += r.horas; c.gastado += r.precio_total;
                if (!c.ultimo || r.fecha > c.ultimo) c.ultimo = r.fecha;
            }
            if (r.estado === 'cancelada') c.cancelaciones++;
            if (r.asistencia === 'ausente') c.ausencias++;
            if (!c.email && r.cliente_email) c.email = r.cliente_email;
            mapa.set(k, c);
        });
        clientes = [...mapa.values()].sort((a, b) => b.turnos - a.turnos || a.nombre.localeCompare(b.nombre, 'es'));
    }

    async function renderClientes(recargar = true) {
        const contenedor = $('lista-clientes');
        if (recargar) {
            try { await cargarClientes(); } catch (e) { contenedor.innerHTML = `<p class="vacio">${Utils.esc(e.message)}</p>`; return; }
        }
        const texto = $('c-buscar').value.trim().toLowerCase();
        const lista = clientes.filter((c) => !texto || [c.nombre, c.email, c.telefono].some((v) => String(v || '').toLowerCase().includes(texto)));
        if (!lista.length) { contenedor.innerHTML = '<p class="vacio">No se encontraron clientes.</p>'; return; }

        const duenio = Auth.esDuenio();
        contenedor.innerHTML = `<table class="tabla">
            <thead><tr><th>Cliente</th><th>Turnos</th><th>Último</th><th>Facturó</th><th>Ausencias</th><th>Cuenta</th><th>Acciones</th></tr></thead>
            <tbody>${lista.slice(0, 300).map((c, i) => {
                const p = c.perfil;
                let cuenta = '<small class="muted">Sin cuenta</small>';
                if (p) {
                    if (p.rol === 'duenio') cuenta = '<span class="badge badge-activa">Dueño</span>';
                    else if (duenio) cuenta = `<select data-rol="${Utils.esc(p.id)}" aria-label="Rol de ${Utils.esc(c.nombre)}"><option value="cliente"${p.rol === 'cliente' ? ' selected' : ''}>Cliente</option><option value="empleado"${p.rol === 'empleado' ? ' selected' : ''}>Empleado</option></select>`;
                    else cuenta = p.rol === 'empleado' ? 'Empleado' : 'Cliente';
                    cuenta += `<br><small>${Utils.numero(p.puntos)} pts</small>`;
                }
                const wa = Utils.linkWhatsApp(c.telefono, `Hola ${c.nombre.split(' ')[0]}, te escribimos de ${Config.get().nombreComplejo}.`);
                return `<tr>
                    <td data-label="Cliente"><strong>${Utils.esc(c.nombre)}</strong><br><small>${Utils.esc(c.telefono)}${c.email ? ` · ${Utils.esc(c.email)}` : ''}</small></td>
                    <td data-label="Turnos">${c.turnos}</td>
                    <td data-label="Último">${c.ultimo ? Utils.esc(Utils.fechaCorta(c.ultimo)) : '—'}</td>
                    <td data-label="Facturó">${Utils.moneda(c.gastado)}</td>
                    <td data-label="Ausencias">${c.ausencias ? `<span class="mini mini-rojo">${c.ausencias}</span>` : '0'}</td>
                    <td data-label="Cuenta">${cuenta}</td>
                    <td data-label="Acciones" class="celda-acciones">
                        ${wa ? `<a class="btn btn-whatsapp btn-sm" href="${Utils.esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
                        <button type="button" class="btn btn-secundario btn-sm" data-reservar="${i}">Reservar</button>
                        ${p && duenio && p.rol !== 'duenio' ? `<button type="button" class="btn btn-secundario btn-sm" data-clave="${Utils.esc(p.id)}">Nueva contraseña</button>` : ''}
                    </td>
                </tr>`;
            }).join('')}</tbody></table>
            ${lista.length > 300 ? `<p class="hint">Mostrando 300 de ${lista.length}. Usá el buscador.</p>` : ''}`;
        contenedor.dataset.lista = '';
        contenedor._lista = lista;
    }

    function nuevaClave(usuarioId) {
        const sugerida = String(Math.floor(100000 + Math.random() * 900000));
        UI.modal({
            titulo: 'Asignar contraseña nueva',
            cuerpo: `<p>Para clientes que olvidaron su contraseña. Pasásela por WhatsApp y que la cambie desde "Mis reservas".</p>
                <div class="field"><label for="nc-clave">Contraseña nueva</label><input type="text" id="nc-clave" value="${sugerida}" minlength="6"></div>
                <p id="nc-error" class="error-msg" role="alert" hidden></p>`,
            botones: [
                { texto: 'Cancelar', clase: 'btn-secundario' },
                {
                    texto: 'Guardar',
                    accion: async (ctl, boton) => {
                        const password = ctl.el.querySelector('#nc-clave').value.trim();
                        try {
                            await UI.conBoton(boton, 'Guardando…', () => Db.api('admin-clave', { usuarioId, password }));
                            UI.toast('Contraseña actualizada. Pasásela al cliente.');
                        } catch (e) {
                            const err = ctl.el.querySelector('#nc-error');
                            err.textContent = e.message; err.hidden = false;
                            return false;
                        }
                    }
                }
            ]
        });
    }

    function exportarClientes() {
        const filas = [['Nombre', 'WhatsApp', 'Correo', 'Turnos', 'Horas', 'Facturó', 'Último turno', 'Ausencias', 'Cancelaciones', 'Cuenta', 'Puntos']];
        clientes.forEach((c) => filas.push([c.nombre, c.telefono, c.email || '', c.turnos, c.horas, c.gastado, c.ultimo || '', c.ausencias, c.cancelaciones, c.perfil ? c.perfil.rol : 'sin cuenta', c.perfil?.puntos ?? '']));
        Utils.descargar(`clientes_${Utils.hoyISO()}.csv`, Utils.csv(filas), 'text/csv');
    }

    // =====================================================================
    // CANCHAS, HORARIOS Y DÍAS CERRADOS
    // =====================================================================
    async function renderCanchas() {
        const canchas = Config.get().canchas;
        $('lista-canchas').innerHTML = canchas.map((c, i) => `
            <form class="cancha-edit" data-cancha-id="${Utils.esc(c.id)}" novalidate>
                <div class="field"><label>Nombre<input type="text" name="nombre" value="${Utils.esc(c.nombre)}" required maxlength="40"></label></div>
                <div class="field"><label>Tipo<input type="text" name="tipo" value="${Utils.esc(c.tipo)}" maxlength="24" placeholder="Ej: Fútbol 5"></label></div>
                <div class="field"><label>Precio por hora ($)<input type="number" name="precio" value="${c.precioHora}" min="0" step="500" required></label></div>
                <label class="check"><input type="checkbox" name="activa" ${c.activa ? 'checked' : ''}> Se puede reservar</label>
                <div class="cancha-acciones">
                    <button type="button" class="btn btn-secundario btn-sm" data-mover="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
                    <button type="button" class="btn btn-secundario btn-sm" data-mover="1" ${i === canchas.length - 1 ? 'disabled' : ''} aria-label="Bajar">↓</button>
                    <button type="submit" class="btn btn-sm">Guardar</button>
                    <button type="button" class="btn btn-peligro btn-sm" data-borrar>Eliminar</button>
                </div>
            </form>`).join('') || '<p class="vacio">No hay canchas. Agregá la primera.</p>';
        renderHorarios();
        renderCierres();
    }

    async function recargarConfig() {
        await Config.cargar();
        Admin.renderFiltroCanchas();
        UI.montarEncabezado('admin');
        renderCanchas();
    }

    async function guardarCancha(form) {
        const d = new FormData(form);
        const nombre = String(d.get('nombre') || '').trim();
        const precio = Number(d.get('precio'));
        if (nombre.length < 2) { UI.toast('El nombre es obligatorio.', 'error'); return; }
        if (!Number.isFinite(precio) || precio < 0) { UI.toast('Ingresá un precio válido.', 'error'); return; }
        try {
            await Db.q(Db.sb.from('canchas').update({ nombre, tipo: String(d.get('tipo') || '').trim(), precio_hora: Math.round(precio), activa: d.get('activa') === 'on' }).eq('id', form.dataset.canchaId));
            UI.toast('Cancha actualizada.');
            await recargarConfig();
        } catch (e) { UI.toast(e.message, 'error'); }
    }

    async function moverCancha(id, paso) {
        const canchas = [...Config.get().canchas];
        const i = canchas.findIndex((c) => c.id === id);
        const j = i + paso;
        if (j < 0 || j >= canchas.length) return;
        [canchas[i], canchas[j]] = [canchas[j], canchas[i]];
        try {
            await Promise.all(canchas.map((c, k) => Db.q(Db.sb.from('canchas').update({ orden: k + 1 }).eq('id', c.id))));
            await recargarConfig();
        } catch (e) { UI.toast(e.message, 'error'); }
    }

    async function borrarCancha(id) {
        const cancha = Config.canchaPorId(id);
        const futuras = await Db.q(Db.sb.from('reservas').select('id').eq('cancha_id', id).in('estado', ['confirmada', 'pendiente_pago']).gte('fecha', Utils.hoyISO()).limit(1));
        if (futuras.length) {
            UI.alerta('No se puede eliminar', `"${Utils.esc(cancha.nombre)}" tiene turnos próximos. Cancelalos primero, o destildá "Se puede reservar" para ocultarla.`);
            return;
        }
        const ok = await UI.confirmar('¿Eliminar la cancha?', `Se elimina "${Utils.esc(cancha.nombre)}". El historial de reservas y las estadísticas se conservan.`, { textoOk: 'Eliminar', peligro: true });
        if (!ok) return;
        try {
            await Db.q(Db.sb.from('canchas').update({ archivada: true, activa: false }).eq('id', id));
            UI.toast('Cancha eliminada.');
            await recargarConfig();
        } catch (e) { UI.toast(e.message, 'error'); }
    }

    function nuevaCancha() {
        UI.modal({
            titulo: 'Agregar cancha',
            cuerpo: `<form class="form-grid" novalidate onsubmit="return false">
                    <div class="field"><label for="n-nombre">Nombre</label><input type="text" id="n-nombre" maxlength="40" placeholder="Ej: Cancha de Fútbol 5 (2)" required></div>
                    <div class="field"><label for="n-tipo">Tipo</label><input type="text" id="n-tipo" maxlength="24" placeholder="Ej: Fútbol 5"></div>
                    <div class="field"><label for="n-precio">Precio por hora ($)</label><input type="number" id="n-precio" min="0" step="500" required></div>
                </form><p id="n-error" class="error-msg" role="alert" hidden></p>`,
            botones: [
                { texto: 'Cancelar', clase: 'btn-secundario' },
                {
                    texto: 'Agregar',
                    accion: async (ctl, boton) => {
                        const nombre = ctl.el.querySelector('#n-nombre').value.trim();
                        const precio = Number(ctl.el.querySelector('#n-precio').value);
                        const err = ctl.el.querySelector('#n-error');
                        if (nombre.length < 2 || !Number.isFinite(precio) || precio < 0 || ctl.el.querySelector('#n-precio').value === '') {
                            err.textContent = 'Completá el nombre y un precio válido.'; err.hidden = false; return false;
                        }
                        try {
                            await UI.conBoton(boton, 'Agregando…', () => Db.q(Db.sb.from('canchas').insert({
                                id: Config.nuevoIdCancha(nombre), nombre, tipo: ctl.el.querySelector('#n-tipo').value.trim(),
                                precio_hora: Math.round(precio), orden: Config.get().canchas.length + 1
                            })));
                            UI.toast('Cancha agregada.');
                            await recargarConfig();
                        } catch (e) { err.textContent = e.message; err.hidden = false; return false; }
                    }
                }
            ]
        });
    }

    function renderHorarios() {
        const c = Config.get();
        $('h-apertura').value = c.horaApertura;
        $('h-cierre').value = c.horaCierre;
        $('h-dias').value = c.diasAnticipacion;
        $('h-max').value = c.maxHorasReserva;
        $('h-tolerancia').value = c.toleranciaMinutos;
    }

    async function guardarHorarios(e) {
        e.preventDefault();
        const apertura = Number($('h-apertura').value);
        const cierre = Number($('h-cierre').value);
        if (!(apertura >= 0 && apertura <= 23) || !(cierre >= 1 && cierre <= 24) || cierre <= apertura) {
            UI.toast('El cierre tiene que ser después de la apertura (entre 0 y 24).', 'error');
            return;
        }
        try {
            await UI.conBoton(e.submitter, 'Guardando…', () => Config.guardar({
                horaApertura: apertura, horaCierre: cierre, diasAnticipacion: Number($('h-dias').value),
                maxHorasReserva: Number($('h-max').value), toleranciaMinutos: Number($('h-tolerancia').value)
            }));
            UI.toast('Horarios actualizados.');
            renderHorarios();
            Admin.refrescar();
        } catch (err) { UI.toast(err.message, 'error'); }
    }

    async function renderCierres() {
        try {
            const fechas = await Db.q(Db.sb.from('fechas_cerradas').select('*').gte('fecha', Utils.hoyISO()).order('fecha'));
            $('lista-cierres').innerHTML = fechas.length
                ? fechas.map((f) => `<span class="chip-cierre">${Utils.esc(Utils.fechaLarga(f.fecha))}${f.motivo ? ` · ${Utils.esc(f.motivo)}` : ''} <button type="button" data-reabrir="${f.fecha}" aria-label="Reabrir ${Utils.esc(Utils.fechaLarga(f.fecha))}">×</button></span>`).join('')
                : '<p class="vacio">No hay días cerrados próximos.</p>';
        } catch (e) { $('lista-cierres').innerHTML = `<p class="vacio">${Utils.esc(e.message)}</p>`; }
    }

    async function agregarCierre(e) {
        e.preventDefault();
        const fecha = $('cierre-fecha').value;
        if (!Utils.esFechaValida(fecha) || fecha < Utils.hoyISO()) { UI.toast('Elegí una fecha de hoy en adelante.', 'error'); return; }
        const afectadas = await Db.q(Db.sb.from('reservas').select('id').eq('fecha', fecha).in('estado', ['confirmada', 'pendiente_pago']));
        if (afectadas.length) {
            const ok = await UI.confirmar('Ya hay turnos ese día',
                `Hay ${afectadas.length} turno(s) reservados. Cerrar el día <strong>no los cancela</strong>: avisales y cancelalos desde la grilla (con devolución de seña). ¿Cerrar igual?`,
                { textoOk: 'Cerrar igual' });
            if (!ok) return;
        }
        try {
            await Db.q(Db.sb.from('fechas_cerradas').upsert({ fecha, motivo: $('cierre-motivo').value.trim() }));
            $('cierre-fecha').value = '';
            $('cierre-motivo').value = '';
            UI.toast('Día cerrado. Ya no se puede reservar.');
            renderCierres();
            Admin.refrescar();
        } catch (err) { UI.toast(err.message, 'error'); }
    }

    // =====================================================================
    // AJUSTES Y COBROS
    // =====================================================================
    async function renderAjustes() {
        const c = Config.get();
        $('a-senia').value = c.montoSenia;
        $('a-cancelacion').value = c.limiteHorasCancelacion;
        $('a-politica').value = c.politicaReembolso;
        $('a-retencion-mp').value = c.minutosRetencionMP;
        $('a-descuento').value = c.descuentoSegundaHora;
        $('a-descuento-activo').checked = c.descuentoActivo;
        $('a-puntos').value = c.puntosPorHora;
        $('a-nombres').checked = c.mostrarNombres;
        $('a-mp').checked = c.pagoMercadoPago;
        $('a-transf').checked = c.pagoTransferencia;
        $('a-alias').value = c.alias;
        $('a-retencion').value = c.minutosRetencionTransferencia;
        $('a-nombre').value = c.nombreComplejo;
        $('a-whatsapp').value = c.whatsapp;
        $('a-direccion').value = c.direccion;
        $('a-instagram').value = c.instagram;
        $('a-aviso').value = c.avisoPublico;
        renderEstadoCobros();
    }

    async function renderEstadoCobros() {
        const s = await Config.cargarEstadoServidor();
        const host = $('estado-cobros');
        const real = s.modoPago === 'mercadopago' && !s.credencialesDePrueba;
        const titulo = real ? '✅ Mercado Pago conectado: se cobra de verdad'
            : s.modoPago === 'mercadopago' ? '🧪 Mercado Pago con credenciales de PRUEBA'
            : s.modoPago === 'demo' ? '🟡 Modo demostración (los pagos son simulados)'
            : '⚠️ Sin conexión con el servidor de pagos';
        host.className = `card-box estado-cobros ${real ? 'ok' : 'pendiente'}`;
        host.innerHTML = `<h2 class="perfil-sec-title">${titulo}</h2>
            ${real ? '<p>Las señas se acreditan en la cuenta de Mercado Pago del complejo. Las devoluciones por cancelación salen de esa misma cuenta, automáticamente.</p>'
            : `<p>Para cobrar de verdad hay que conectar la cuenta de Mercado Pago del complejo (una sola vez, lleva 5 minutos):</p>
               <ol class="pasos-lista">
                   <li>Entrar a <strong>mercadopago.com.ar/developers</strong> con la cuenta del complejo → <em>Tus integraciones</em> → <em>Crear aplicación</em> (tipo: Pagos online · Checkout Pro).</li>
                   <li>En la aplicación, ir a <em>Credenciales de producción</em> y copiar el <strong>Access Token</strong> (empieza con <code>APP_USR-</code>).</li>
                   <li>En <strong>Vercel</strong> → el proyecto → <em>Settings</em> → <em>Environment Variables</em>: crear <code>MP_ACCESS_TOKEN</code> con ese valor (marcar "Sensitive").</li>
                   <li>En Vercel → <em>Deployments</em> → <em>Redeploy</em>. Listo: este cartel pasa a verde.</li>
               </ol>
               <p class="hint">El token es secreto: nunca se pega en la página ni se manda por WhatsApp.</p>`}`;
    }

    async function guardarAjustes(e) {
        e.preventDefault();
        const error = $('ajustes-error');
        const nombre = $('a-nombre').value.trim();
        const mp = $('a-mp').checked;
        const transf = $('a-transf').checked;
        const mensaje = nombre.length < 2 ? 'Ingresá el nombre del complejo.'
            : !mp && !transf ? 'Dejá al menos un medio de pago (o las reservas online quedan pausadas).'
            : transf && !$('a-alias').value.trim() ? 'Ingresá el alias para recibir transferencias.'
            : null;
        error.textContent = mensaje || '';
        error.hidden = !mensaje;
        if (mensaje) return;
        try {
            await UI.conBoton(e.submitter, 'Guardando…', () => Config.guardar({
                montoSenia: Number($('a-senia').value), limiteHorasCancelacion: Number($('a-cancelacion').value),
                politicaReembolso: $('a-politica').value, minutosRetencionMP: Number($('a-retencion-mp').value),
                descuentoSegundaHora: Number($('a-descuento').value), descuentoActivo: $('a-descuento-activo').checked,
                puntosPorHora: Number($('a-puntos').value), mostrarNombres: $('a-nombres').checked,
                pagoMercadoPago: mp, pagoTransferencia: transf, alias: $('a-alias').value.trim(),
                minutosRetencionTransferencia: Number($('a-retencion').value), nombreComplejo: nombre,
                whatsapp: $('a-whatsapp').value, direccion: $('a-direccion').value, instagram: $('a-instagram').value,
                avisoPublico: $('a-aviso').value
            }));
            UI.toast('Ajustes guardados. Ya se ven en la web.');
            UI.iniciarPagina('admin');
            renderAjustes();
        } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
        }
    }

    async function exportarReservas() {
        const reservas = await Db.todas(() => Db.sb.from('reservas').select('*').order('fecha').order('hora_inicio'));
        const filas = [['Fecha', 'Horario', 'Cancha', 'Cliente', 'WhatsApp', 'Correo', 'Estado', 'Origen', 'Pago', 'Total', 'Seña', 'Saldo', 'Saldo cobrado', 'Asistencia', 'Código', 'Creada']];
        reservas.forEach((r) => filas.push([r.fecha, Booking.rango(r), r.cancha_nombre, r.cliente_nombre, r.cliente_telefono, r.cliente_email || '',
            Booking.etiqueta(r).texto, Booking.METODOS[r.metodo_pago] || '', Booking.PAGOS[r.pago_estado] || '', r.precio_total, r.monto_senia,
            Booking.saldo(r), r.saldo_cobrado ? 'Sí' : 'No', r.asistencia || '', r.codigo, r.creada]));
        Utils.descargar(`todas_las_reservas_${Utils.hoyISO()}.csv`, Utils.csv(filas), 'text/csv');
    }

    async function exportarJson() {
        const [ajustes, canchas, cierres, fijos, reservas, perfiles] = await Promise.all([
            Db.q(Db.sb.from('ajustes').select('*')),
            Db.q(Db.sb.from('canchas').select('*')),
            Db.q(Db.sb.from('fechas_cerradas').select('*')),
            Db.q(Db.sb.from('turnos_fijos').select('*')),
            Db.todas(() => Db.sb.from('reservas').select('*').order('creada')),
            Db.todas(() => Db.sb.from('perfiles').select('*').order('creado'))
        ]);
        const datos = { version: 2, exportado: new Date().toISOString(), ajustes, canchas, fechas_cerradas: cierres, turnos_fijos: fijos, reservas, perfiles };
        Utils.descargar(`copia_completa_${Utils.hoyISO()}.json`, JSON.stringify(datos, null, 2), 'application/json');
    }

    // =====================================================================
    document.addEventListener('DOMContentLoaded', () => {
        $('c-buscar').addEventListener('input', Utils.debounce(() => renderClientes(false), 200));
        $('btn-clientes-csv').addEventListener('click', exportarClientes);
        $('lista-clientes').addEventListener('change', async (e) => {
            const s = e.target.closest('[data-rol]');
            if (!s) return;
            try {
                await Db.rpc('cambiar_rol', { p_usuario: s.dataset.rol, p_rol: s.value });
                UI.toast(s.value === 'empleado' ? 'Ahora es empleado: puede usar el panel.' : 'Rol actualizado.');
            } catch (err) { UI.toast(err.message, 'error'); }
            renderClientes();
        });
        $('lista-clientes').addEventListener('click', (e) => {
            const r = e.target.closest('[data-reservar]');
            if (r) {
                const c = $('lista-clientes')._lista[Number(r.dataset.reservar)];
                Admin.nuevaReserva({ nombre: c.nombre, telefono: c.telefono });
            }
            const k = e.target.closest('[data-clave]');
            if (k) nuevaClave(k.dataset.clave);
        });

        if (!$('lista-canchas')) return; // empleado: no ve estas secciones
        $('btn-nueva-cancha').addEventListener('click', nuevaCancha);
        $('lista-canchas').addEventListener('submit', (e) => { e.preventDefault(); guardarCancha(e.target); });
        $('lista-canchas').addEventListener('click', (e) => {
            const form = e.target.closest('[data-cancha-id]');
            if (!form) return;
            const mover = e.target.closest('[data-mover]');
            if (mover) moverCancha(form.dataset.canchaId, Number(mover.dataset.mover));
            if (e.target.closest('[data-borrar]')) borrarCancha(form.dataset.canchaId);
        });
        $('form-horarios').addEventListener('submit', guardarHorarios);
        $('form-cierre').addEventListener('submit', agregarCierre);
        $('lista-cierres').addEventListener('click', async (e) => {
            const b = e.target.closest('[data-reabrir]');
            if (!b) return;
            try {
                await Db.q(Db.sb.from('fechas_cerradas').delete().eq('fecha', b.dataset.reabrir));
                UI.toast('Día reabierto.');
                renderCierres();
                Admin.refrescar();
            } catch (err) { UI.toast(err.message, 'error'); }
        });
        $('form-ajustes').addEventListener('submit', guardarAjustes);
        $('btn-exportar-reservas').addEventListener('click', () => exportarReservas().catch((err) => UI.toast(err.message, 'error')));
        $('btn-exportar-json').addEventListener('click', () => exportarJson().catch((err) => UI.toast(err.message, 'error')));
    });

    Admin.registrar('clientes', { render: () => renderClientes(true) });
    Admin.registrar('canchas', { render: renderCanchas });
    Admin.registrar('ajustes', { render: renderAjustes });
})();
