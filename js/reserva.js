// js/reserva.js - Comprobante de una reserva: estado del pago, datos del turno y acciones.
// Funciona con el enlace privado (?id=...&t=...), aunque la persona no tenga cuenta.

(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    const token = params.get('t');
    let reserva = null;
    let reloj = null;
    let intentosVerificacion = 0;

    document.addEventListener('DOMContentLoaded', () => UI.arrancar('perfil', iniciar));

    async function iniciar() {
        if (!id || !token) return noEncontrada();
        await Config.cargarEstadoServidor();
        await cargar();
        if (!reserva) return;
        Booking.recordar(id, token);

        // Volvió de Mercado Pago: confirmamos el pago sin esperar al aviso automático.
        const volvioDeMP = params.has('payment_id') || params.has('collection_status') || params.has('status');
        if (reserva.estado === 'pendiente_pago' && reserva.metodo_pago === 'mercadopago' && (volvioDeMP || Config.servidor().modoPago === 'mercadopago')) {
            verificarPago();
        }
        if (params.has('nuevo') && reserva.estado === 'confirmada') festejar();
        history.replaceState(null, '', Booking.linkReserva(reserva, token));
    }

    async function cargar() {
        try {
            const r = await Db.rpc('ver_reserva', { p_id: id, p_token: token });
            if (!r) return noEncontrada();
            reserva = r;
            render();
        } catch (e) {
            UI.toast(e.message, 'error');
        }
    }

    async function verificarPago() {
        try {
            const { reserva: r } = await Db.api('verificar-pago', { id, token });
            const cambio = r.estado !== reserva.estado;
            reserva = { ...reserva, ...r };
            render();
            if (cambio && r.estado === 'confirmada') festejar();
        } catch (_) { /* reintenta abajo */ }
        if (reserva.estado === 'pendiente_pago' && ++intentosVerificacion < 15) setTimeout(verificarPago, 4000);
    }

    function noEncontrada() {
        const main = document.getElementById('contenido');
        main.innerHTML = `<div class="estado-vacio"><div class="estado-icono" aria-hidden="true">?</div>
            <h1>No encontramos esa reserva</h1><p class="muted">Revisá que el enlace esté completo.</p>
            <a class="btn" href="perfil.html">Ver mis reservas</a></div>`;
    }

    function festejar() {
        const el = document.querySelector('.estado-hero');
        if (el) el.classList.add('festejo');
        if (navigator.vibrate) navigator.vibrate(60);
    }

    function render() {
        const cfg = Config.get();
        const r = reserva;
        const visible = Booking.estadoVisible(r);
        const saldo = Booking.saldo(r);
        clearInterval(reloj);

        const HEROES = {
            confirmada: ['ok', '✓', '¡Turno confirmado!', 'Te esperamos. Llegá 10 minutos antes.'],
            jugada: ['neutro', '⚽', 'Turno jugado', '¡Gracias por venir!'],
            pendiente_pago: ['espera', '⏳', r.metodo_pago === 'transferencia' ? 'Falta la transferencia' : 'Esperando el pago', ''],
            vencida: ['mal', '✕', 'Se venció el plazo de pago', 'El horario se liberó. Podés reservar de nuevo.'],
            cancelada: ['mal', '✕', 'Reserva cancelada', r.motivo || '']
        };
        const [tono, icono, titulo, sub] = HEROES[visible] || HEROES.cancelada;
        let subtitulo = sub;
        if (r.pago_estado === 'reembolsado') subtitulo += ' La seña fue devuelta al mismo medio de pago.';
        if (r.pago_estado === 'reembolso_pendiente') subtitulo = `${r.motivo || ''} El complejo te va a devolver la seña.`;

        const filas = [
            ['Cancha', Utils.esc(r.cancha_nombre)],
            ['Día', Utils.esc(Utils.fechaLarga(r.fecha))],
            ['Horario', Booking.rango(r)],
            ['A nombre de', Utils.esc(r.cliente_nombre)],
            ['Total del turno', Utils.moneda(r.precio_total)],
            r.monto_senia ? ['Seña', `${Utils.moneda(r.monto_senia)} <small>· ${Utils.esc(Booking.PAGOS[r.pago_estado] || '')}</small>`] : null,
            ['Resto a pagar en la cancha', `<strong>${Utils.moneda(saldo)}</strong>`]
        ].filter(Boolean);

        let pago = '';
        if (r.estado === 'pendiente_pago') {
            pago = `<div class="pago-pendiente">
                <p>Tu horario está guardado por <strong class="cuenta-regresiva" data-vence="${Utils.esc(r.vence_en)}">--:--</strong>. Si no se paga a tiempo, se libera.</p>
                ${r.metodo_pago === 'transferencia' ? htmlTransferencia(r) : htmlPagarMP(r)}
            </div>`;
        }

        const acciones = [];
        if (r.estado === 'confirmada' && !Booking.terminada(r)) {
            acciones.push(`<a class="btn btn-secundario" href="${Utils.esc(Booking.linkCalendario(r))}" target="_blank" rel="noopener">📅 Agendar</a>`);
            acciones.push(`<a class="btn btn-whatsapp" href="${Utils.esc(Utils.linkCompartir(`⚽ ¡Jugamos! ${Utils.fechaLarga(r.fecha)} de ${Booking.rango(r)} en ${r.cancha_nombre} (${cfg.nombreComplejo}).${cfg.direccion ? ` 📍 ${cfg.direccion}` : ''}`))}" target="_blank" rel="noopener">Avisarle al grupo</a>`);
        }
        if (cfg.direccion) acciones.push(`<a class="btn btn-secundario" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cfg.direccion)}" target="_blank" rel="noopener">📍 Cómo llegar</a>`);
        if (cfg.whatsapp) acciones.push(`<a class="btn btn-secundario" href="${Utils.esc(Utils.linkWhatsApp(cfg.whatsapp, `Hola, te escribo por mi reserva ${r.codigo} (${Utils.fechaLarga(r.fecha)}, ${Booking.rango(r)}).`))}" target="_blank" rel="noopener">Hablar con el complejo</a>`);

        const permiso = Booking.puedeCancelar(r);
        const cancelar = Booking.vigente(r)
            ? permiso.ok
                ? `<button type="button" class="btn-link peligro" data-cancelar>Cancelar esta reserva</button>`
                : `<p class="hint">${Utils.esc(permiso.motivo)} Si necesitás cambiarla, escribinos por WhatsApp.</p>`
            : '';

        document.getElementById('contenido').innerHTML = `
            <section class="estado-hero tono-${tono}">
                <div class="estado-icono" aria-hidden="true">${icono}</div>
                <h1>${titulo}</h1>
                ${subtitulo ? `<p>${Utils.esc(subtitulo)}</p>` : ''}
            </section>
            ${pago}
            <article class="ticket">
                <header class="ticket-cabecera">
                    <div><span class="muted">Reserva</span><strong class="ticket-codigo">${Utils.esc(r.codigo)}</strong></div>
                    <span class="badge ${Booking.etiqueta(r).clase}">${Booking.etiqueta(r).texto}</span>
                </header>
                <dl class="ticket-datos">${filas.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
            </article>
            ${acciones.length ? `<div class="acciones-reserva">${acciones.join('')}</div>` : ''}
            <div class="pie-reserva">
                ${cancelar}
                <p class="hint">Guardá este enlace: con él podés ver o cancelar tu reserva. También la encontrás en <a href="perfil.html">Mis reservas</a> desde este celular.</p>
                <a class="btn btn-block" href="index.html">Reservar otro turno</a>
            </div>`;

        const cuenta = document.querySelector('.cuenta-regresiva');
        if (cuenta) {
            const tick = () => {
                const resto = Date.parse(cuenta.dataset.vence) - Date.now();
                if (resto <= 0) { clearInterval(reloj); cuenta.textContent = '00:00'; setTimeout(cargar, 1500); return; }
                cuenta.textContent = `${Utils.pad(Math.floor(resto / 60000))}:${Utils.pad(Math.floor((resto % 60000) / 1000))}`;
            };
            tick();
            reloj = setInterval(tick, 1000);
        }
        document.querySelector('[data-cancelar]')?.addEventListener('click', cancelarReserva);
        document.querySelector('[data-copiar]')?.addEventListener('click', async (e) => {
            e.target.textContent = (await Utils.copiar(cfg.alias)) ? '¡Copiado!' : 'Copialo a mano';
        });
        document.querySelector('[data-pagar-demo]')?.addEventListener('click', pagarDemo);
    }

    function htmlPagarMP(r) {
        if (Config.servidor().modoPago === 'demo') {
            return '<button type="button" class="btn btn-mp btn-block" data-pagar-demo>Pagar la seña (demostración)</button>';
        }
        return r.mp_init_point
            ? `<a class="btn btn-mp btn-block" href="${Utils.esc(r.mp_init_point)}">Pagar ${Utils.moneda(r.monto_senia)} con Mercado Pago</a>
               <p class="hint centrado">¿Ya pagaste? Puede tardar unos segundos en confirmarse; esta pantalla se actualiza sola.</p>`
            : '';
    }

    function htmlTransferencia(r) {
        const cfg = Config.get();
        const texto = `Hola, soy ${r.cliente_nombre}. Te mando el comprobante de la seña de la reserva ${r.codigo} (${Utils.fechaLarga(r.fecha)}, ${Booking.rango(r)}, ${r.cancha_nombre}).`;
        return `<p>Transferí <strong>${Utils.moneda(r.monto_senia)}</strong> a este alias:</p>
            <div class="alias-box"><span>${Utils.esc(cfg.alias)}</span><button type="button" class="btn-copiar" data-copiar>Copiar</button></div>
            ${cfg.whatsapp ? `<a class="btn btn-whatsapp btn-block" href="${Utils.esc(Utils.linkWhatsApp(cfg.whatsapp, texto))}" target="_blank" rel="noopener">Enviar comprobante por WhatsApp</a>` : ''}`;
    }

    async function pagarDemo(e) {
        try {
            await UI.conBoton(e.currentTarget, 'Procesando…', () => Db.api('pago-demo', { id, token }));
            await cargar();
            festejar();
        } catch (err) {
            UI.toast(err.message, 'error');
            cargar();
        }
    }

    async function cancelarReserva() {
        const cfg = Config.get();
        const pagada = Booking.senaPagada(reserva);
        const detalle = pagada
            ? cfg.politicaReembolso === 'reembolso'
                ? `Te devolvemos la seña de ${Utils.moneda(reserva.monto_senia)} al mismo medio de pago.`
                : 'La seña no se devuelve.'
            : 'El horario queda libre para otra persona.';
        const ok = await UI.confirmar('¿Cancelar la reserva?', detalle, { textoOk: 'Sí, cancelar', textoCancelar: 'No, la mantengo', peligro: true });
        if (!ok) return;
        try {
            const r = await Db.api('cancelar', { id, token });
            UI.toast(r.mensaje);
            await cargar();
        } catch (e) {
            UI.alerta('No se pudo cancelar', Utils.esc(e.message));
        }
    }
})();
