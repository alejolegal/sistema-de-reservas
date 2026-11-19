// js/app.js - Página principal: catálogo de canchas y flujo de reserva.

(() => {
    const seleccion = {}; // { [canchaId]: { fecha, hora, horas } }
    const feeds = {};     // temporizadores del carrusel "reservas del día", uno por cancha

    document.addEventListener('DOMContentLoaded', () => {
        UI.iniciarPagina('inicio');
        renderHero();
        renderPanelUsuario();
        renderBannerPromo();
        renderReglas();
        renderCatalogo();

        document.getElementById('catalogo-canchas').addEventListener('click', alHacerClic);
        // Refresca los horarios cada minuto (turnos que vencen, transferencias liberadas).
        setInterval(() => Config.canchasActivas().forEach((c) => actualizarCard(c.id)), 60000);
    });

    // ---------- Secciones estáticas ----------
    function renderHero() {
        document.getElementById('hero-nombre').textContent = Config.get().nombreComplejo;
    }

    function renderPanelUsuario() {
        const panel = document.getElementById('panel-usuario');
        const usuario = Auth.usuarioActual();
        panel.hidden = !usuario;
        if (!usuario) return;
        panel.innerHTML = `
            <div>
                <p class="user-name">Hola, <strong>${Utils.esc(usuario.nombre)}</strong>${Auth.esStaff(usuario) ? ` <span class="role-badge">${Utils.esc(usuario.rol)}</span>` : ''}</p>
                <p class="user-points">Tus puntos acumulados: <strong>${usuario.puntos || 0} pts</strong></p>
            </div>
            <div class="user-actions">
                <a href="perfil.html" class="btn btn-secundario">Mis reservas</a>
                ${Auth.esStaff(usuario) ? '<a href="admin.html" class="btn">Panel de gestión</a>' : ''}
            </div>`;
    }

    function renderBannerPromo() {
        const cfg = Config.get();
        const contenedor = document.getElementById('aviso-promo');
        const activa = cfg.descuentoActivo && cfg.descuentoSegundaHora > 0 && cfg.maxHorasReserva >= 2;
        contenedor.innerHTML = activa
            ? `<div class="banner-promo"><strong>Promoción vigente:</strong> alquilá 2 horas seguidas y obtené <span class="chip-promo">${cfg.descuentoSegundaHora}% de descuento</span> en la segunda hora.</div>`
            : '';
    }

    function renderReglas() {
        const cfg = Config.get();
        const pago = cfg.pagoMercadoPago && cfg.pagoTransferencia
            ? `Con Mercado Pago el turno queda confirmado al instante. Si elegís transferencia, tenés ${cfg.minutosRetencionTransferencia} minutos para enviar el comprobante; si no, el turno se libera solo.`
            : cfg.pagoTransferencia
                ? `Transferí la seña al alias indicado y enviá el comprobante dentro de los ${cfg.minutosRetencionTransferencia} minutos; si no, el turno se libera solo.`
                : 'El turno queda confirmado al instante al pagar la seña con Mercado Pago.';
        document.getElementById('lista-reglas').innerHTML = `
            <li><strong>Seña obligatoria de ${Utils.moneda(cfg.montoSenia)}.</strong> ${pago}</li>
            <li><strong>Cancelaciones:</strong> podés cancelar sin penalidad hasta ${cfg.limiteHorasCancelacion} horas antes del partido desde <em>Mi perfil</em>.</li>
            <li><strong>Puntualidad:</strong> llegá 10 minutos antes para agilizar el ingreso. Cada hora reservada suma ${cfg.puntosPorHora} puntos.</li>`;
    }

    // ---------- Catálogo ----------
    function estadoDe(canchaId) {
        const hoy = Utils.hoyISO();
        const s = (seleccion[canchaId] ||= { fecha: hoy, hora: null, horas: 1 });
        if (s.fecha < hoy) { s.fecha = hoy; s.hora = null; }
        if (s.horas > Config.get().maxHorasReserva) s.horas = 1;
        return s;
    }

    function renderCatalogo() {
        const contenedor = document.getElementById('catalogo-canchas');
        const canchas = Config.canchasActivas();

        if (!canchas.length) {
            contenedor.innerHTML = '<p class="vacio">Por el momento no hay canchas disponibles para reservar. Escribinos por WhatsApp.</p>';
            return;
        }
        contenedor.innerHTML = canchas.map((c) => `<article class="cancha-card" data-cancha="${Utils.esc(c.id)}"></article>`).join('');
        canchas.forEach((c) => actualizarCard(c.id));
    }

    function actualizarCard(canchaId, enfocar = null) {
        const tarjeta = document.querySelector(`[data-cancha="${CSS.escape(canchaId)}"]`);
        const cancha = Config.canchaPorId(canchaId);
        if (!tarjeta || !cancha) return;

        const indice = Config.canchasActivas().findIndex((c) => c.id === canchaId);
        const scroll = tarjeta.querySelector('.dias-slider')?.scrollLeft || 0;
        const { html, itemsFeed } = htmlCard(cancha, indice);

        tarjeta.innerHTML = html;
        const slider = tarjeta.querySelector('.dias-slider');
        if (slider) slider.scrollLeft = scroll;
        iniciarFeed(canchaId, itemsFeed);

        if (enfocar) tarjeta.querySelector(enfocar)?.focus();
    }

    function htmlCard(cancha, indice) {
        const cfg = Config.get();
        const s = estadoDe(cancha.id);
        const ctx = Booking.contexto();
        const hoy = Utils.hoyISO();
        const cerrado = ctx.cerradas.includes(s.fecha);

        // Días
        const dias = Array.from({ length: cfg.diasAnticipacion }, (_, i) => {
            const iso = Utils.sumarDias(hoy, i);
            const etiqueta = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : Utils.fechaCorta(iso);
            const clases = ['btn-dia', iso === s.fecha ? 'active' : '', ctx.cerradas.includes(iso) ? 'cerrado' : ''].join(' ');
            return `<button type="button" class="${clases}" data-action="dia" data-fecha="${iso}" aria-pressed="${iso === s.fecha}"${ctx.cerradas.includes(iso) ? ' title="Complejo cerrado"' : ''}>${etiqueta}</button>`;
        }).join('');

        // Horarios
        const elegidas = s.hora ? (Booking.horasConsecutivas(s.hora, s.horas) || [s.hora]) : [];
        const horarios = Config.horarios().map((hora) => {
            const estado = Booking.estadoHora(ctx, cancha.id, s.fecha, hora);
            if (estado === 'libre') {
                const marcado = elegidas.includes(hora);
                return `<button type="button" class="slot libre${marcado ? ' seleccionado' : ''}" data-action="hora" data-hora="${hora}" aria-pressed="${marcado}">${hora}</button>`;
            }
            const texto = estado === 'ocupado' ? 'Ocupado' : 'No disponible';
            return `<button type="button" class="slot ${estado}" disabled aria-label="${hora}, ${texto}">${hora}<small>${texto}</small></button>`;
        }).join('');

        // Duración
        let duracion = '';
        if (cfg.maxHorasReserva > 1) {
            const opciones = Array.from({ length: cfg.maxHorasReserva }, (_, i) => {
                const n = i + 1;
                const promo = cfg.descuentoActivo && n === 2 && cfg.descuentoSegundaHora > 0 ? ` <em>-${cfg.descuentoSegundaHora}% 2.ª hora</em>` : '';
                return `<button type="button" class="opcion-duracion${s.horas === n ? ' active' : ''}" data-action="horas" data-horas="${n}" aria-pressed="${s.horas === n}">${n} ${n === 1 ? 'hora' : 'horas'}${promo}</button>`;
            }).join('');
            duracion = `<p class="etiqueta-campo">Duración del turno</p><div class="duracion">${opciones}</div>`;
        }

        // Feed social (nombre abreviado por privacidad)
        const usuarios = Store.usuarios();
        const delDia = ctx.reservas.filter((r) => r.estado === 'activa' && r.canchaId === cancha.id && r.fecha === s.fecha);
        const itemsFeed = delDia.map((r) => {
            const u = usuarios.find((x) => x.id === r.usuarioId);
            const nombre = Utils.nombreCorto(u ? u.nombre : r.cliente?.nombre);
            return `<div class="feed-item"><span class="avatar" aria-hidden="true">${Utils.esc(nombre.charAt(0))}</span><span><strong>${Utils.esc(nombre)}</strong> juega a las <strong>${Booking.rangoHorario(r).split(' a ')[0]} hs</strong></span></div>`;
        });
        const feed = itemsFeed.length
            ? `<div class="feed" data-feed>${itemsFeed[0]}</div>`
            : '<div class="feed feed-vacio">Todavía no hay turnos reservados este día</div>';

        const cuerpo = cerrado
            ? `<div class="aviso-cerrado"><strong>Complejo cerrado</strong><p>No hay alquileres disponibles para esta fecha (feriado o mantenimiento). Elegí otro día.</p></div>`
            : `<p class="etiqueta-campo">Horarios disponibles</p>
               <div class="horarios-grid">${horarios}</div>
               ${duracion}
               ${htmlResumen(cancha, s)}
               <button type="button" class="btn btn-block" data-action="reservar"${s.hora ? '' : ' disabled'}>${s.hora ? 'Reservar este turno' : 'Elegí un horario'}</button>`;

        const html = `
            <div class="cancha-head tema-${indice % 3}">
                <span class="chip">${Utils.esc(cancha.tipo)}</span>
                <h3>${Utils.esc(cancha.nombre)}</h3>
                <p class="price">${Utils.moneda(cancha.precioHora)}<span> por hora</span></p>
            </div>
            <div class="cancha-body">
                <p class="senia-info">Seña para reservar: <strong>${Utils.moneda(cfg.montoSenia)}</strong></p>
                ${feed}
                <p class="etiqueta-campo">Elegí el día</p>
                <div class="dias-slider" role="group" aria-label="Días disponibles">${dias}</div>
                ${cuerpo}
            </div>`;
        return { html, itemsFeed };
    }

    function htmlResumen(cancha, s) {
        if (!s.hora) return '<p class="resumen resumen-vacio">Tocá un horario libre para ver el precio.</p>';
        const horas = Booking.horasConsecutivas(s.hora, s.horas) || [s.hora];
        const precio = Booking.calcularPrecio(cancha, horas.length);
        const rango = Booking.rangoHorario({ horas });
        return `
            <dl class="resumen">
                <div><dt>Turno</dt><dd>${Utils.fechaLarga(s.fecha)}, ${rango}</dd></div>
                <div><dt>Total${precio.descuento ? ' (con descuento)' : ''}</dt><dd>${Utils.moneda(precio.total)}</dd></div>
                <div><dt>Seña a pagar ahora</dt><dd>${Utils.moneda(precio.senia)}</dd></div>
                <div><dt>Resto, en la cancha</dt><dd>${Utils.moneda(precio.saldo)}</dd></div>
            </dl>`;
    }

    // Un solo temporizador por tarjeta: se limpia antes de cada renderizado.
    function iniciarFeed(canchaId, items) {
        clearInterval(feeds[canchaId]);
        if (items.length < 2) return;
        const el = document.querySelector(`[data-cancha="${CSS.escape(canchaId)}"] [data-feed]`);
        if (!el) return;
        let i = 0;
        feeds[canchaId] = setInterval(() => {
            if (!document.body.contains(el)) { clearInterval(feeds[canchaId]); return; }
            i = (i + 1) % items.length;
            el.innerHTML = items[i];
        }, 4000);
    }

    // ---------- Interacción ----------
    function alHacerClic(evento) {
        const boton = evento.target.closest('[data-action]');
        if (!boton || boton.disabled) return;
        const canchaId = boton.closest('[data-cancha]').dataset.cancha;
        const s = estadoDe(canchaId);
        const accion = boton.dataset.action;

        if (accion === 'dia') {
            s.fecha = boton.dataset.fecha;
            s.hora = null;
            actualizarCard(canchaId, `[data-action="dia"][data-fecha="${s.fecha}"]`);
        } else if (accion === 'hora') {
            elegirHora(canchaId, s, boton.dataset.hora);
        } else if (accion === 'horas') {
            elegirDuracion(canchaId, s, Number(boton.dataset.horas));
        } else if (accion === 'reservar') {
            abrirReserva(canchaId);
        }
    }

    function elegirHora(canchaId, s, hora) {
        if (s.hora === hora) {
            s.hora = null;
        } else {
            const v = Booking.validarSeleccion(Booking.contexto(), { canchaId, fecha: s.fecha, hora, cantidadHoras: s.horas });
            if (!v.ok) {
                UI.toast(s.horas > 1 ? `No se pueden reservar ${s.horas} horas seguidas desde las ${hora}. ${v.mensaje}` : v.mensaje, 'aviso');
                return;
            }
            s.hora = hora;
        }
        actualizarCard(canchaId, `[data-action="hora"][data-hora="${hora}"]`);
    }

    function elegirDuracion(canchaId, s, horas) {
        s.horas = horas;
        if (s.hora) {
            const v = Booking.validarSeleccion(Booking.contexto(), { canchaId, fecha: s.fecha, hora: s.hora, cantidadHoras: horas });
            if (!v.ok) {
                UI.toast(`Ese horario no admite ${horas} horas seguidas. ${v.mensaje} Elegí otro horario.`, 'aviso');
                s.hora = null;
            }
        }
        actualizarCard(canchaId, `[data-action="horas"][data-horas="${horas}"]`);
    }

    // ---------- Reserva y pago ----------
    function abrirReserva(canchaId) {
        const usuario = Auth.usuarioActual();
        if (!usuario) {
            UI.modal({
                titulo: 'Ingresá para reservar',
                cuerpo: '<p>Para reservar necesitás una cuenta. Es gratis y toma menos de un minuto; además sumás puntos con cada turno.</p>',
                botones: [
                    { texto: 'Ahora no', clase: 'btn-secundario' },
                    { texto: 'Ingresar o crear cuenta', accion: () => { location.href = 'login.html?next=index.html'; return false; } }
                ]
            });
            return;
        }

        const cfg = Config.get();
        const s = estadoDe(canchaId);
        const validacion = Booking.validarSeleccion(Booking.contexto(), { canchaId, fecha: s.fecha, hora: s.hora, cantidadHoras: s.horas });
        if (!validacion.ok) {
            UI.alerta('No se puede reservar', Utils.esc(validacion.mensaje));
            s.hora = null;
            actualizarCard(canchaId);
            return;
        }
        if (!cfg.pagoMercadoPago && !cfg.pagoTransferencia) {
            UI.alerta('Reservas online no disponibles', 'Por el momento no hay medios de pago habilitados. Escribinos por WhatsApp para reservar.');
            return;
        }

        const cancha = validacion.cancha;
        const precio = Booking.calcularPrecio(cancha, validacion.horas.length);
        const rango = Booking.rangoHorario({ horas: validacion.horas });
        const primero = cfg.pagoMercadoPago ? 'mercadopago' : 'transferencia';

        const metodoMP = cfg.pagoMercadoPago ? `
            <label class="metodo">
                <input type="radio" name="metodo" value="mercadopago" ${primero === 'mercadopago' ? 'checked' : ''}>
                <span><strong>Mercado Pago${cfg.modoPruebaPago ? ' (modo prueba)' : ''}</strong>
                <small>Tarjeta o dinero en cuenta. El turno queda confirmado al instante.</small></span>
            </label>` : '';
        const metodoTR = cfg.pagoTransferencia ? `
            <label class="metodo">
                <input type="radio" name="metodo" value="transferencia" ${primero === 'transferencia' ? 'checked' : ''}>
                <span><strong>Transferencia bancaria</strong>
                <small>Tenés ${cfg.minutosRetencionTransferencia} minutos para enviar el comprobante por WhatsApp.</small></span>
            </label>` : '';
        const pruebas = cfg.modoPruebaPago && cfg.pagoMercadoPago ? `
            <details class="prueba"><summary>Datos de tarjeta para probar el pago</summary>
                <p>Tarjeta: <code>5031 7557 3453 0604</code> · Vencimiento: <code>11/30</code> · CVV: <code>123</code></p>
            </details>` : '';

        UI.modal({
            titulo: 'Confirmá tu reserva',
            cuerpo: `
                <p class="modal-cancha">${Utils.esc(cancha.nombre)}</p>
                <dl class="resumen">
                    <div><dt>Turno</dt><dd>${Utils.fechaLarga(s.fecha)}, ${rango}</dd></div>
                    <div><dt>Total</dt><dd>${Utils.moneda(precio.total)}</dd></div>
                    <div><dt>Seña a pagar ahora</dt><dd>${Utils.moneda(precio.senia)}</dd></div>
                    <div><dt>Resto, en la cancha</dt><dd>${Utils.moneda(precio.saldo)}</dd></div>
                </dl>
                <fieldset class="metodos"><legend>¿Cómo querés pagar la seña?</legend>${metodoMP}${metodoTR}</fieldset>
                ${pruebas}`,
            botones: [
                { texto: 'Volver', clase: 'btn-secundario' },
                {
                    texto: `Pagar seña ${Utils.moneda(precio.senia)}`,
                    accion: (ctl) => {
                        const metodo = ctl.el.querySelector('input[name="metodo"]:checked')?.value || primero;
                        ctl.cerrar();
                        procesarReserva({ canchaId, fecha: s.fecha, hora: s.hora, cantidadHoras: validacion.horas.length, metodo, usuario });
                        return false;
                    }
                }
            ]
        });
    }

    async function procesarReserva({ canchaId, fecha, hora, cantidadHoras, metodo, usuario }) {
        if (metodo === 'mercadopago') {
            // TODO (backend): crear la preferencia de Checkout Pro en un servidor con el Access Token
            // en variables de entorno, redirigir a init_point y confirmar la reserva desde el webhook.
            const proceso = UI.modal({
                titulo: 'Procesando el pago',
                cuerpo: '<div class="spinner" aria-hidden="true"></div><p class="centrado">Conectando con Mercado Pago…</p>',
                cerrable: false
            });
            await Utils.esperar(1400);
            proceso.cerrar();
        }

        const resultado = Booking.crearReserva({ usuarioId: usuario.id, canchaId, fecha, hora, cantidadHoras, metodoPago: metodo });
        estadoDe(canchaId).hora = null;
        actualizarCard(canchaId);
        renderPanelUsuario();

        if (!resultado.exito) {
            UI.alerta('No se pudo completar la reserva', Utils.esc(resultado.mensaje));
            return;
        }
        mostrarConfirmacion(resultado.reserva, usuario);
    }

    function mostrarConfirmacion(reserva, usuario) {
        const cfg = Config.get();
        const detalle = `
            <dl class="resumen">
                <div><dt>Cancha</dt><dd>${Utils.esc(reserva.nombreCancha)}</dd></div>
                <div><dt>Turno</dt><dd>${Utils.fechaLarga(reserva.fecha)}, ${Booking.rangoHorario(reserva)}</dd></div>
                <div><dt>Resto a pagar en la cancha</dt><dd>${Utils.moneda(reserva.saldoRestante)}</dd></div>
            </dl>`;

        if (reserva.estado === 'activa') {
            UI.modal({
                titulo: '¡Reserva confirmada!',
                cuerpo: `<div class="ok-mark" aria-hidden="true">✓</div>${detalle}
                    <p class="muted">Sumaste <strong>${reserva.puntosOtorgados} puntos</strong>. Podés ver o cancelar tu reserva desde <em>Mi perfil</em>.</p>`,
                botones: [{ texto: 'Entendido' }]
            });
            return;
        }

        const vence = Utils.horaLocal(new Date(reserva.venceEn));
        const mensaje = `Hola, soy ${usuario.nombre}. Te envío el comprobante de la seña de mi turno del ${Utils.fechaLarga(reserva.fecha)}, ${Booking.rangoHorario(reserva)}, en ${reserva.nombreCancha}.`;
        const ctl = UI.modal({
            titulo: 'Turno reservado: falta el pago',
            cuerpo: `${detalle}
                <p>Transferí la seña de <strong>${Utils.moneda(reserva.montoSenia)}</strong> a este alias <strong>antes de las ${vence} hs</strong>:</p>
                <div class="alias-box"><span>${Utils.esc(cfg.alias)}</span><button type="button" class="btn-copiar" data-copiar>Copiar</button></div>
                <p class="muted">Luego enviá el comprobante por WhatsApp. Si no lo recibimos a tiempo, el turno se libera automáticamente.</p>
                <a class="btn btn-whatsapp btn-block" href="${Utils.esc(Utils.linkWhatsApp(cfg.whatsapp, mensaje))}" target="_blank" rel="noopener">Enviar comprobante por WhatsApp</a>`,
            botones: [{ texto: 'Entendido', clase: 'btn-secundario' }]
        });
        ctl.el.querySelector('[data-copiar]').addEventListener('click', async (e) => {
            const copiado = await Utils.copiar(cfg.alias);
            e.target.textContent = copiado ? '¡Copiado!' : 'Copialo a mano';
        });
    }
})();
