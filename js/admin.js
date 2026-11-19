// js/admin.js - Panel de gestión del complejo.

(() => {
    let usuario = null;
    let verTodas = false;

    const ETIQUETAS = {
        activa: ['Confirmada', 'badge-activa'],
        pendiente_pago: ['Pendiente de pago', 'badge-pendiente'],
        cancelada: ['Cancelada', 'badge-cancelada'],
        completada: ['Jugada', 'badge-completada']
    };
    const METODOS = { mercadopago: 'Mercado Pago', transferencia: 'Transferencia', manual: 'Manual' };
    const $ = (id) => document.getElementById(id);

    document.addEventListener('DOMContentLoaded', () => {
        UI.iniciarPagina('admin');
        usuario = Auth.requerirStaff();
        if (!usuario) return;

        $('contenido').hidden = false;
        $('aviso-password').hidden = !usuario.cambiarPassword;
        $('admin-fecha-hoy').textContent = Utils.fechaLarga(Utils.hoyISO());

        $('f-fecha').value = Utils.hoyISO();
        $('rep-desde').value = Utils.sumarDias(Utils.hoyISO(), -30);
        $('rep-hasta').value = Utils.hoyISO();

        iniciarPestanas();
        iniciarEventos();
        refrescarTodo();
        setInterval(() => { renderKpis(); renderAgenda(); }, 60000);
    });

    function refrescarTodo() {
        renderKpis();
        renderFiltroCanchas();
        renderAgenda();
        renderCierres();
        renderCanchas();
        renderFormularios();
        renderClientes();
        renderReporte();
    }

    // ---------- Pestañas ----------
    function iniciarPestanas() {
        const pestanas = Array.from(document.querySelectorAll('.admin-tab'));
        const activar = (clave) => {
            pestanas.forEach((t) => {
                const activa = t.dataset.tab === clave;
                t.classList.toggle('active', activa);
                t.setAttribute('aria-selected', String(activa));
                $(`panel-${t.dataset.tab}`).hidden = !activa;
            });
            try { sessionStorage.setItem('adminTab', clave); } catch (_) { /* opcional */ }
        };
        pestanas.forEach((t) => t.addEventListener('click', () => activar(t.dataset.tab)));
        let guardada = null;
        try { guardada = sessionStorage.getItem('adminTab'); } catch (_) { /* opcional */ }
        activar(pestanas.some((t) => t.dataset.tab === guardada) ? guardada : 'agenda');
    }

    // ---------- KPIs ----------
    function renderKpis() {
        const hoy = Utils.hoyISO();
        const reservas = Booking.obtenerReservas();
        const deHoy = reservas.filter((r) => r.fecha === hoy && ['activa', 'completada'].includes(r.estado));
        const pendientes = reservas.filter((r) => r.estado === 'pendiente_pago');
        const proximas = reservas.filter((r) => r.estado === 'activa' && r.fecha >= hoy);
        const horasHoy = deHoy.reduce((s, r) => s + r.cantidadHoras, 0);
        const capacidad = Config.canchasActivas().length * Config.horarios().length;
        const ocupacion = capacidad ? Math.round((horasHoy / capacidad) * 100) : 0;
        const ingresoHoy = deHoy.reduce((s, r) => s + r.precioTotal, 0);

        const kpi = (valor, etiqueta, extra = '') => `<div class="kpi ${extra}"><strong>${valor}</strong><span>${etiqueta}</span></div>`;
        $('kpis').innerHTML =
            kpi(deHoy.length, 'Turnos de hoy') +
            kpi(`${ocupacion}%`, 'Ocupación de hoy') +
            kpi(Utils.moneda(ingresoHoy), 'Facturación de hoy') +
            kpi(pendientes.length, 'Pagos por confirmar', pendientes.length ? 'kpi-alerta' : '') +
            kpi(proximas.length, 'Próximos turnos');
    }

    // ---------- Agenda ----------
    function renderFiltroCanchas() {
        const select = $('f-cancha');
        const actual = select.value;
        select.innerHTML = '<option value="">Todas</option>' +
            Config.get().canchas.map((c) => `<option value="${Utils.esc(c.id)}">${Utils.esc(c.nombre)}</option>`).join('');
        select.value = Array.from(select.options).some((o) => o.value === actual) ? actual : '';
    }

    function renderAgenda() {
        const fecha = $('f-fecha').value;
        const cancha = $('f-cancha').value;
        const estado = $('f-estado').value;
        const texto = $('f-buscar').value.trim().toLowerCase();
        const usuarios = Store.usuarios();
        $('btn-todas').textContent = verTodas ? 'Ver solo la fecha elegida' : 'Ver todas las fechas';
        $('f-fecha').disabled = verTodas;

        const filas = Booking.obtenerReservas()
            .map((r) => {
                const cliente = r.usuarioId ? usuarios.find((u) => u.id === r.usuarioId) : null;
                return { r, nombre: cliente ? cliente.nombre : (r.cliente?.nombre || 'Cliente'), telefono: cliente ? cliente.telefono : (r.cliente?.telefono || '') };
            })
            .filter(({ r, nombre, telefono }) =>
                (verTodas || !fecha || r.fecha === fecha) &&
                (!cancha || r.canchaId === cancha) &&
                (!estado || r.estado === estado) &&
                (!texto || nombre.toLowerCase().includes(texto) || telefono.includes(texto)))
            .sort((a, b) => Booking.inicio(a.r) - Booking.inicio(b.r));

        if (!filas.length) {
            $('lista-agenda').innerHTML = '<p class="vacio">No hay reservas con estos filtros.</p>';
            return;
        }

        const cuerpo = filas.map(({ r, nombre, telefono }) => {
            const [etiqueta, clase] = ETIQUETAS[r.estado] || [r.estado, ''];
            const wa = Utils.linkWhatsApp(telefono, `Hola ${nombre}, te escribimos de ${Config.get().nombreComplejo} por tu turno del ${Utils.fechaLarga(r.fecha)}, ${Booking.rangoHorario(r)}.`);
            const acciones = [];
            if (r.estado === 'pendiente_pago') acciones.push(`<button type="button" class="btn btn-sm" data-accion="confirmar" data-id="${Utils.esc(r.id)}">Confirmar pago</button>`);
            if (['activa', 'pendiente_pago'].includes(r.estado)) acciones.push(`<button type="button" class="btn btn-peligro btn-sm" data-accion="cancelar" data-id="${Utils.esc(r.id)}">Cancelar</button>`);
            if (r.estado === 'cancelada' && Booking.fin(r) > new Date()) acciones.push(`<button type="button" class="btn btn-secundario btn-sm" data-accion="reactivar" data-id="${Utils.esc(r.id)}">Reactivar</button>`);
            if (wa) acciones.push(`<a class="btn btn-whatsapp btn-sm" href="${Utils.esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>`);

            return `<tr>
                <td data-label="Turno"><strong>${Utils.fechaCorta(r.fecha)}</strong><br>${Booking.rangoHorario(r)}</td>
                <td data-label="Cancha">${Utils.esc(r.nombreCancha)}</td>
                <td data-label="Cliente"><strong>${Utils.esc(nombre)}</strong><br><small>${Utils.esc(telefono)}</small></td>
                <td data-label="Pago">${Utils.moneda(r.precioTotal)}<br><small>Seña ${Utils.moneda(r.montoSenia)} · ${METODOS[r.metodoPago] || '-'}</small></td>
                <td data-label="Estado"><span class="badge ${clase}">${etiqueta}</span></td>
                <td data-label="Acciones" class="celda-acciones">${acciones.join('')}</td>
            </tr>`;
        }).join('');

        $('lista-agenda').innerHTML = `
            <table class="tabla">
                <thead><tr><th>Turno</th><th>Cancha</th><th>Cliente</th><th>Pago</th><th>Estado</th><th>Acciones</th></tr></thead>
                <tbody>${cuerpo}</tbody>
            </table>`;
    }

    async function accionReserva(accion, id) {
        const reserva = Booking.obtenerReservas().find((r) => r.id === id);
        if (!reserva) return;
        const detalle = `${Utils.esc(reserva.nombreCancha)}, ${Utils.fechaLarga(reserva.fecha)} (${Booking.rangoHorario(reserva)})`;

        if (accion === 'cancelar') {
            const ok = await UI.confirmar('¿Cancelar este turno?', `${detalle}<br>El horario quedará libre y se descontarán los puntos otorgados.`, { textoOk: 'Sí, cancelar', textoCancelar: 'Volver', peligro: true });
            if (!ok) return;
        }
        if (accion === 'confirmar') {
            const ok = await UI.confirmar('¿Confirmar el pago?', `${detalle}<br>Confirmá que recibiste la seña de ${Utils.moneda(reserva.montoSenia)}.`, { textoOk: 'Sí, confirmar' });
            if (!ok) return;
        }
        const resultado = Booking.cambiarEstado(id, accion === 'cancelar' ? 'cancelada' : 'activa', usuario);
        UI.toast(resultado.mensaje, resultado.exito ? 'ok' : 'error');
        renderKpis();
        renderAgenda();
        renderClientes();
    }

    // ---------- Nueva reserva manual ----------
    function abrirReservaManual() {
        const canchas = Config.canchasActivas();
        if (!canchas.length) { UI.alerta('Sin canchas', 'Primero activá o agregá una cancha.'); return; }
        const cfg = Config.get();
        const horarios = Config.horarios();

        const ctl = UI.modal({
            titulo: 'Nueva reserva (mostrador o teléfono)',
            clase: 'modal-ancho',
            cuerpo: `
                <form id="form-manual" class="form-grid" novalidate>
                    <div class="field"><label for="m-nombre">Nombre del cliente</label><input type="text" id="m-nombre" required></div>
                    <div class="field"><label for="m-tel">Teléfono (opcional)</label><input type="tel" id="m-tel" inputmode="numeric"></div>
                    <div class="field"><label for="m-cancha">Cancha</label>
                        <select id="m-cancha">${canchas.map((c) => `<option value="${Utils.esc(c.id)}">${Utils.esc(c.nombre)}</option>`).join('')}</select></div>
                    <div class="field"><label for="m-fecha">Fecha</label><input type="date" id="m-fecha" value="${$('f-fecha').value || Utils.hoyISO()}" min="${Utils.hoyISO()}"></div>
                    <div class="field"><label for="m-hora">Horario</label>
                        <select id="m-hora"></select></div>
                    <div class="field"><label for="m-horas">Duración</label>
                        <select id="m-horas">${Array.from({ length: cfg.maxHorasReserva }, (_, i) => `<option value="${i + 1}">${i + 1} hora${i ? 's' : ''}</option>`).join('')}</select></div>
                    <div class="field"><label for="m-senia">Seña cobrada ($)</label><input type="number" id="m-senia" min="0" step="100" value="0"></div>
                </form>
                <p id="m-resumen" class="resumen-linea"></p>
                <p id="m-error" class="error-msg" role="alert" hidden></p>`,
            botones: [
                { texto: 'Cancelar', clase: 'btn-secundario' },
                {
                    texto: 'Crear reserva',
                    accion: () => {
                        const error = $('m-error');
                        const resultado = Booking.crearReserva({
                            canchaId: $('m-cancha').value,
                            fecha: $('m-fecha').value,
                            hora: $('m-hora').value,
                            cantidadHoras: Number($('m-horas').value),
                            metodoPago: 'manual',
                            cliente: { nombre: $('m-nombre').value, telefono: $('m-tel').value },
                            montoSenia: $('m-senia').value,
                            creadaPor: usuario.id
                        });
                        if (!resultado.exito) { error.textContent = resultado.mensaje; error.hidden = false; return false; }
                        UI.toast('Reserva creada correctamente.');
                        $('f-fecha').value = resultado.reserva.fecha;
                        verTodas = false;
                        renderKpis();
                        renderAgenda();
                    }
                }
            ]
        });

        const actualizar = () => {
            const ctx = Booking.contexto();
            const canchaId = $('m-cancha').value;
            const fecha = $('m-fecha').value;
            const previa = $('m-hora').value;
            $('m-hora').innerHTML = horarios.map((h) => {
                const estado = Utils.esFechaValida(fecha) ? Booking.estadoHora(ctx, canchaId, fecha, h) : 'libre';
                return `<option value="${h}"${estado === 'libre' ? '' : ' disabled'}>${h}${estado === 'libre' ? '' : estado === 'ocupado' ? ' (ocupado)' : estado === 'cerrado' ? ' (cerrado)' : ' (pasó)'}</option>`;
            }).join('');
            if (previa && !$('m-hora').querySelector(`option[value="${previa}"]:disabled`)) $('m-hora').value = previa;
            else { const libre = $('m-hora').querySelector('option:not([disabled])'); if (libre) $('m-hora').value = libre.value; }
            const cancha = Config.canchaPorId(canchaId);
            const n = Number($('m-horas').value);
            if (cancha) {
                const p = Booking.calcularPrecio(cancha, n);
                $('m-resumen').textContent = `Total: ${Utils.moneda(p.total)}${p.descuento ? ' (con descuento por 2 horas)' : ''}. Seña sugerida: ${Utils.moneda(p.senia)}.`;
            }
        };
        ['m-cancha', 'm-fecha', 'm-horas'].forEach((id) => ctl.el.querySelector(`#${id}`).addEventListener('change', actualizar));
        actualizar();
    }

    // ---------- Calendario ----------
    function renderCierres() {
        const hoy = Utils.hoyISO();
        const fechas = Store.fechasCerradas().filter((f) => f >= hoy).sort();
        $('lista-cierres').innerHTML = fechas.length
            ? fechas.map((f) => `<span class="chip-cierre">${Utils.fechaLarga(f)} <button type="button" data-quitar-cierre="${f}" aria-label="Reabrir ${Utils.fechaLarga(f)}">×</button></span>`).join('')
            : '<p class="vacio">No hay fechas de cierre programadas.</p>';
    }

    async function agregarCierre(evento) {
        evento.preventDefault();
        const fecha = $('cierre-fecha').value;
        if (!Utils.esFechaValida(fecha) || fecha < Utils.hoyISO()) { UI.toast('Elegí una fecha válida desde hoy en adelante.', 'error'); return; }
        const cerradas = Store.fechasCerradas();
        if (cerradas.includes(fecha)) { UI.toast('Esa fecha ya está cerrada.', 'aviso'); return; }

        const afectadas = Booking.obtenerReservas().filter((r) => r.fecha === fecha && Booking.ESTADOS_VIGENTES.includes(r.estado));
        if (afectadas.length) {
            const ok = await UI.confirmar('Ya hay turnos en esa fecha',
                `Hay ${afectadas.length} reserva(s) vigente(s) ese día. Cerrar la fecha <strong>no las cancela</strong>: tendrás que avisarles y cancelarlas desde la Agenda. ¿Cerrar igual?`,
                { textoOk: 'Cerrar igual', textoCancelar: 'Volver' });
            if (!ok) return;
        }
        Store.guardarFechasCerradas([...cerradas, fecha].sort());
        $('cierre-fecha').value = '';
        UI.toast('Fecha cerrada. Ya no se puede reservar ese día.');
        renderCierres();
    }

    // ---------- Canchas ----------
    function renderCanchas() {
        $('lista-canchas').innerHTML = Config.get().canchas.map((c) => `
            <form class="cancha-edit" data-cancha-id="${Utils.esc(c.id)}" novalidate>
                <div class="field"><label>Nombre<input type="text" name="nombre" value="${Utils.esc(c.nombre)}" required maxlength="40"></label></div>
                <div class="field"><label>Tipo<input type="text" name="tipo" value="${Utils.esc(c.tipo)}" maxlength="24" placeholder="Ej: Fútbol 5"></label></div>
                <div class="field"><label>Precio por hora ($)<input type="number" name="precioHora" value="${c.precioHora}" min="0" step="500" required></label></div>
                <label class="check"><input type="checkbox" name="activa" ${c.activa ? 'checked' : ''}> Disponible para reservar</label>
                <div class="cancha-acciones">
                    <button type="submit" class="btn btn-sm">Guardar</button>
                    <button type="button" class="btn btn-peligro btn-sm" data-borrar-cancha="${Utils.esc(c.id)}">Eliminar</button>
                </div>
            </form>`).join('');
    }

    function guardarCancha(formulario) {
        const id = formulario.dataset.canchaId;
        const datos = new FormData(formulario);
        const nombre = String(datos.get('nombre') || '').trim();
        const precio = Number(datos.get('precioHora'));
        if (nombre.length < 2) { UI.toast('El nombre de la cancha es obligatorio.', 'error'); return; }
        if (!Number.isFinite(precio) || precio < 0) { UI.toast('Ingresá un precio válido.', 'error'); return; }

        const canchas = Config.get().canchas.map((c) => c.id === id
            ? { ...c, nombre, tipo: String(datos.get('tipo') || '').trim(), precioHora: precio, activa: datos.get('activa') === 'on' }
            : c);
        Config.guardar({ canchas });
        UI.toast('Cancha actualizada.');
        renderFiltroCanchas();
        renderCanchas();
    }

    function nuevaCancha() {
        const ctl = UI.modal({
            titulo: 'Agregar cancha',
            cuerpo: `
                <form class="form-grid" novalidate>
                    <div class="field"><label for="n-nombre">Nombre</label><input type="text" id="n-nombre" maxlength="40" placeholder="Ej: Cancha de Fútbol 5 (2)" required></div>
                    <div class="field"><label for="n-tipo">Tipo</label><input type="text" id="n-tipo" maxlength="24" placeholder="Ej: Fútbol 5"></div>
                    <div class="field"><label for="n-precio">Precio por hora ($)</label><input type="number" id="n-precio" min="0" step="500" required></div>
                </form>
                <p id="n-error" class="error-msg" role="alert" hidden></p>`,
            botones: [
                { texto: 'Cancelar', clase: 'btn-secundario' },
                {
                    texto: 'Agregar',
                    accion: () => {
                        const nombre = $('n-nombre').value.trim();
                        const precio = Number($('n-precio').value);
                        if (nombre.length < 2 || !Number.isFinite(precio) || precio < 0 || $('n-precio').value === '') {
                            $('n-error').textContent = 'Completá el nombre y un precio válido.';
                            $('n-error').hidden = false;
                            return false;
                        }
                        Config.guardar({ canchas: [...Config.get().canchas, { id: Config.nuevoIdCancha(nombre), nombre, tipo: $('n-tipo').value.trim(), precioHora: precio, activa: true }] });
                        UI.toast('Cancha agregada.');
                        renderFiltroCanchas();
                        renderCanchas();
                    }
                }
            ]
        });
        ctl.el.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
    }

    async function borrarCancha(id) {
        const cfg = Config.get();
        if (cfg.canchas.length <= 1) { UI.toast('Tiene que quedar al menos una cancha.', 'error'); return; }
        const cancha = Config.canchaPorId(id);
        const futuras = Booking.obtenerReservas().filter((r) => r.canchaId === id && Booking.ESTADOS_VIGENTES.includes(r.estado) && Booking.fin(r) > new Date());
        if (futuras.length) {
            UI.alerta('No se puede eliminar', `"${Utils.esc(cancha.nombre)}" tiene ${futuras.length} reserva(s) vigente(s). Cancelalas primero, o desmarcá "Disponible para reservar" para ocultarla.`);
            return;
        }
        const ok = await UI.confirmar('¿Eliminar la cancha?', `Se eliminará "${Utils.esc(cancha.nombre)}". El historial de reservas se conserva.`, { textoOk: 'Eliminar', peligro: true });
        if (!ok) return;
        Config.guardar({ canchas: cfg.canchas.filter((c) => c.id !== id) });
        UI.toast('Cancha eliminada.');
        renderFiltroCanchas();
        renderCanchas();
    }

    // ---------- Formularios de ajustes ----------
    function renderFormularios() {
        const c = Config.get();
        $('h-apertura').value = c.horaApertura;
        $('h-cierre').value = c.horaCierre;
        $('h-dias').value = c.diasAnticipacion;
        $('h-max').value = c.maxHorasReserva;
        $('h-tolerancia').value = c.toleranciaMinutos;

        $('r-nombre').value = c.nombreComplejo;
        $('r-senia').value = c.montoSenia;
        $('r-cancelacion').value = c.limiteHorasCancelacion;
        $('r-puntos').value = c.puntosPorHora;
        $('r-descuento').value = c.descuentoSegundaHora;
        $('r-descuento-activo').checked = c.descuentoActivo;
        $('r-mp').checked = c.pagoMercadoPago;
        $('r-transf').checked = c.pagoTransferencia;
        $('r-prueba').checked = c.modoPruebaPago;
        $('r-alias').value = c.alias;
        $('r-retencion').value = c.minutosRetencionTransferencia;
        $('r-whatsapp').value = c.whatsapp;
    }

    function guardarHorarios(evento) {
        evento.preventDefault();
        const apertura = Number($('h-apertura').value);
        const cierre = Number($('h-cierre').value);
        if (!(apertura >= 0 && apertura <= 23) || !(cierre >= 1 && cierre <= 24) || cierre <= apertura) {
            UI.toast('El cierre debe ser posterior a la apertura (entre 0 y 24 hs).', 'error');
            return;
        }
        Config.guardar({
            horaApertura: apertura, horaCierre: cierre,
            diasAnticipacion: Number($('h-dias').value), maxHorasReserva: Number($('h-max').value),
            toleranciaMinutos: Number($('h-tolerancia').value)
        });
        UI.toast('Horarios actualizados.');
        renderFormularios();
        renderKpis();
    }

    function guardarReglas(evento) {
        evento.preventDefault();
        const error = $('reglas-error');
        const nombre = $('r-nombre').value.trim();
        const mp = $('r-mp').checked;
        const transf = $('r-transf').checked;
        const mensaje = nombre.length < 2 ? 'Ingresá el nombre del complejo.'
            : !mp && !transf ? 'Dejá habilitado al menos un medio de pago.'
            : transf && !$('r-alias').value.trim() ? 'Ingresá el alias para recibir transferencias.'
            : null;
        error.textContent = mensaje || '';
        error.hidden = !mensaje;
        if (mensaje) return;

        Config.guardar({
            nombreComplejo: nombre,
            montoSenia: Number($('r-senia').value),
            limiteHorasCancelacion: Number($('r-cancelacion').value),
            puntosPorHora: Number($('r-puntos').value),
            descuentoSegundaHora: Number($('r-descuento').value),
            descuentoActivo: $('r-descuento-activo').checked,
            pagoMercadoPago: mp, pagoTransferencia: transf, modoPruebaPago: $('r-prueba').checked,
            alias: $('r-alias').value.trim(),
            minutosRetencionTransferencia: Number($('r-retencion').value),
            whatsapp: $('r-whatsapp').value
        });
        UI.toast('Reglas guardadas.');
        UI.montarEncabezado('admin');
        renderFormularios();
    }

    // ---------- Clientes ----------
    function renderClientes() {
        const texto = $('c-buscar').value.trim().toLowerCase();
        const reservas = Booking.obtenerReservas();
        const lista = Store.usuarios()
            .filter((u) => !texto || [u.nombre, u.email, u.telefono].some((v) => String(v || '').toLowerCase().includes(texto)))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

        if (!lista.length) { $('lista-clientes').innerHTML = '<p class="vacio">No se encontraron clientes.</p>'; return; }

        const cuerpo = lista.map((u) => {
            const propias = reservas.filter((r) => r.usuarioId === u.id && ['activa', 'completada'].includes(r.estado));
            const wa = Utils.linkWhatsApp(u.telefono, `Hola ${u.nombre}, te escribimos de ${Config.get().nombreComplejo}.`);
            const esDuenio = Auth.esDuenio(u);
            const rol = esDuenio ? '<span class="badge badge-activa">Dueño</span>'
                : Auth.esDuenio(usuario)
                    ? `<select data-rol="${Utils.esc(u.id)}" aria-label="Rol de ${Utils.esc(u.nombre)}"><option value="cliente"${u.rol === 'cliente' ? ' selected' : ''}>Cliente</option><option value="empleado"${u.rol === 'empleado' ? ' selected' : ''}>Empleado</option></select>`
                    : (u.rol === 'empleado' ? 'Empleado' : 'Cliente');
            return `<tr>
                <td data-label="Cliente"><strong>${Utils.esc(u.nombre)}</strong><br><small>${Utils.esc(u.email)}</small></td>
                <td data-label="Teléfono">${Utils.esc(u.telefono)}</td>
                <td data-label="Turnos">${propias.length}</td>
                <td data-label="Puntos">${u.puntos || 0}</td>
                <td data-label="Rol">${rol}</td>
                <td data-label="Contacto">${wa ? `<a class="btn btn-whatsapp btn-sm" href="${Utils.esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : '-'}</td>
            </tr>`;
        }).join('');

        $('lista-clientes').innerHTML = `
            <table class="tabla">
                <thead><tr><th>Cliente</th><th>Teléfono</th><th>Turnos</th><th>Puntos</th><th>Rol</th><th>Contacto</th></tr></thead>
                <tbody>${cuerpo}</tbody>
            </table>`;
    }

    // ---------- Reportes ----------
    function datosReporte() {
        const desde = $('rep-desde').value;
        const hasta = $('rep-hasta').value;
        const reservas = Booking.obtenerReservas().filter((r) => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta));
        return { desde, hasta, reservas, validas: reservas.filter((r) => ['activa', 'completada'].includes(r.estado)) };
    }

    function renderReporte() {
        const { desde, hasta, reservas, validas } = datosReporte();
        const total = validas.reduce((s, r) => s + r.precioTotal, 0);
        const senias = validas.reduce((s, r) => s + r.montoSenia, 0);
        const horas = validas.reduce((s, r) => s + r.cantidadHoras, 0);
        const canceladas = reservas.filter((r) => r.estado === 'cancelada').length;

        const porCancha = Config.get().canchas.map((c) => {
            const del = validas.filter((r) => r.canchaId === c.id);
            return { nombre: c.nombre, turnos: del.length, horas: del.reduce((s, r) => s + r.cantidadHoras, 0), ingresos: del.reduce((s, r) => s + r.precioTotal, 0) };
        });
        const franjas = {};
        validas.forEach((r) => r.horas.forEach((h) => { franjas[h] = (franjas[h] || 0) + 1; }));
        const top = Object.entries(franjas).sort((a, b) => b[1] - a[1]).slice(0, 5);

        $('reporte-contenido').innerHTML = `
            <p class="muted">Período: ${desde ? Utils.fechaCorta(desde) : 'inicio'} al ${hasta ? Utils.fechaCorta(hasta) : 'hoy'}. Se cuentan turnos confirmados y jugados.</p>
            <div class="kpis kpis-chicos">
                <div class="kpi"><strong>${validas.length}</strong><span>Turnos</span></div>
                <div class="kpi"><strong>${horas}</strong><span>Horas alquiladas</span></div>
                <div class="kpi"><strong>${Utils.moneda(total)}</strong><span>Facturación estimada</span></div>
                <div class="kpi"><strong>${Utils.moneda(senias)}</strong><span>Señas</span></div>
                <div class="kpi"><strong>${canceladas}</strong><span>Cancelados</span></div>
            </div>
            <div class="tabla-wrap"><table class="tabla">
                <thead><tr><th>Cancha</th><th>Turnos</th><th>Horas</th><th>Facturación</th></tr></thead>
                <tbody>${porCancha.map((f) => `<tr><td data-label="Cancha">${Utils.esc(f.nombre)}</td><td data-label="Turnos">${f.turnos}</td><td data-label="Horas">${f.horas}</td><td data-label="Facturación">${Utils.moneda(f.ingresos)}</td></tr>`).join('')}</tbody>
            </table></div>
            <h3 class="sub-titulo">Horarios más pedidos</h3>
            ${top.length ? `<ol class="top-lista">${top.map(([h, n]) => `<li><strong>${h} hs</strong> <span>${n} turno(s)</span></li>`).join('')}</ol>` : '<p class="vacio">Sin datos en el período.</p>'}`;
    }

    function descargarCsv() {
        const { reservas } = datosReporte();
        const usuarios = Store.usuarios();
        const filas = [['Fecha', 'Horario', 'Cancha', 'Cliente', 'Teléfono', 'Estado', 'Método', 'Total', 'Seña', 'Saldo']];
        reservas.sort((a, b) => Booking.inicio(a) - Booking.inicio(b)).forEach((r) => {
            const u = r.usuarioId ? usuarios.find((x) => x.id === r.usuarioId) : null;
            filas.push([r.fecha, Booking.rangoHorario(r), r.nombreCancha, u ? u.nombre : r.cliente?.nombre || '', u ? u.telefono : r.cliente?.telefono || '',
                (ETIQUETAS[r.estado] || [r.estado])[0], METODOS[r.metodoPago] || '', r.precioTotal, r.montoSenia, r.saldoRestante ?? '']);
        });
        // El BOM permite que Excel abra bien las tildes.
        Utils.descargar(`reservas_${Utils.hoyISO()}.csv`, '﻿' + filas.map((f) => f.map(Utils.csvCelda).join(';')).join('\r\n'), 'text/csv');
    }

    // ---------- Respaldo ----------
    function exportar() {
        Utils.descargar(`respaldo_${Utils.hoyISO()}.json`, JSON.stringify(Store.exportarTodo(), null, 2), 'application/json');
        UI.toast('Respaldo descargado.');
    }

    async function importar(archivo) {
        if (!archivo) return;
        let datos;
        try { datos = JSON.parse(await archivo.text()); } catch (_) { UI.alerta('Archivo no válido', 'No se pudo leer el archivo de respaldo.'); return; }
        const ok = await UI.confirmar('¿Restaurar este respaldo?', 'Se reemplazarán <strong>todos</strong> los datos actuales (reservas, clientes y configuración) por los del archivo.', { textoOk: 'Restaurar', peligro: true });
        if (!ok) return;
        if (!Store.importarTodo(datos)) { UI.alerta('Archivo no válido', 'El archivo no tiene el formato de un respaldo del sistema.'); return; }
        Config.recargar();
        UI.toast('Respaldo restaurado.');
        setTimeout(() => location.reload(), 900);
    }

    async function restablecer() {
        const ok = await UI.confirmar('¿Restablecer la configuración?', 'Se restauran precios, horarios, reglas y canchas a los valores originales. Las reservas y los clientes <strong>no</strong> se borran.', { textoOk: 'Restablecer', peligro: true });
        if (!ok) return;
        Config.restablecer();
        UI.toast('Configuración restablecida.');
        refrescarTodo();
        UI.montarEncabezado('admin');
    }

    // ---------- Eventos ----------
    function iniciarEventos() {
        ['f-fecha', 'f-cancha', 'f-estado'].forEach((id) => $(id).addEventListener('change', renderAgenda));
        $('f-buscar').addEventListener('input', renderAgenda);
        $('btn-todas').addEventListener('click', () => { verTodas = !verTodas; renderAgenda(); });
        $('btn-nueva-reserva').addEventListener('click', abrirReservaManual);

        $('lista-agenda').addEventListener('click', (e) => {
            const b = e.target.closest('[data-accion]');
            if (b) accionReserva(b.dataset.accion, b.dataset.id);
        });

        $('form-cierre').addEventListener('submit', agregarCierre);
        $('lista-cierres').addEventListener('click', (e) => {
            const b = e.target.closest('[data-quitar-cierre]');
            if (!b) return;
            Store.guardarFechasCerradas(Store.fechasCerradas().filter((f) => f !== b.dataset.quitarCierre));
            UI.toast('Fecha reabierta.');
            renderCierres();
        });

        $('btn-nueva-cancha').addEventListener('click', nuevaCancha);
        $('lista-canchas').addEventListener('submit', (e) => { e.preventDefault(); guardarCancha(e.target); });
        $('lista-canchas').addEventListener('click', (e) => {
            const b = e.target.closest('[data-borrar-cancha]');
            if (b) borrarCancha(b.dataset.borrarCancha);
        });

        $('form-horarios').addEventListener('submit', guardarHorarios);
        $('form-reglas').addEventListener('submit', guardarReglas);

        $('c-buscar').addEventListener('input', renderClientes);
        $('lista-clientes').addEventListener('change', (e) => {
            const s = e.target.closest('[data-rol]');
            if (!s) return;
            const r = Auth.cambiarRol(usuario, s.dataset.rol, s.value);
            UI.toast(r.exito ? 'Rol actualizado.' : r.mensaje, r.exito ? 'ok' : 'error');
            renderClientes();
        });

        ['rep-desde', 'rep-hasta'].forEach((id) => $(id).addEventListener('change', renderReporte));
        $('btn-csv').addEventListener('click', descargarCsv);
        $('btn-imprimir').addEventListener('click', () => window.print());

        $('btn-exportar').addEventListener('click', exportar);
        $('input-importar').addEventListener('change', (e) => { importar(e.target.files[0]); e.target.value = ''; });
        $('btn-restablecer').addEventListener('click', restablecer);
    }
})();
