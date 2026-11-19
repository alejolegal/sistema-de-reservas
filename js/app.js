// js/app.js - Página principal: elegir cancha, día y horario, y pagar la seña.

(() => {
    const seleccion = {}; // { [canchaId]: { fecha, hora, horas } }
    const feeds = {};
    let ctx = null;
    let cargando = false;

    document.addEventListener('DOMContentLoaded', () => UI.arrancar('inicio', iniciar));

    async function iniciar() {
        Config.cargarEstadoServidor().then(renderReglas);
        renderHero();
        renderPanelUsuario();
        renderBannerPromo();
        renderReglas();
        renderCatalogo();
        await refrescar();

        document.getElementById('catalogo-canchas').addEventListener('click', alHacerClic);
        setInterval(refrescar, 30000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) refrescar(); });
    }

    // Trae la ocupación real de la base y redibuja las tarjetas.
    async function refrescar() {
        if (cargando) return;
        cargando = true;
        try {
            const hoy = Utils.hoyISO();
            ctx = await Booking.cargarContexto(hoy, Utils.sumarDias(hoy, Config.get().diasAnticipacion - 1));
            Config.canchasActivas().forEach((c) => actualizarCard(c.id));
        } catch (error) {
            UI.toast(error.message, 'error');
        } finally {
            cargando = false;
        }
    }

    // ---------- Secciones fijas ----------
    function renderHero() {
        const cfg = Config.get();
        document.getElementById('hero-nombre').textContent = cfg.nombreComplejo;
        const tipos = [...new Set(Config.canchasActivas().map((c) => c.tipo).filter(Boolean))];
        if (tipos.length) document.getElementById('hero-sub').textContent = `${tipos.join(', ')}. Elegí el día, tocá un horario libre y asegurá tu turno en un minuto.`;
        const aviso = document.getElementById('aviso-publico');
        aviso.hidden = !cfg.avisoPublico;
        aviso.textContent = cfg.avisoPublico;
    }

    function renderPanelUsuario() {
        const panel = document.getElementById('panel-usuario');
        const usuario = Auth.usuario();
        panel.hidden = !usuario;
        if (!usuario) return;
        panel.innerHTML = `
            <div>
                <p class="user-name">Hola, <strong>${Utils.esc(usuario.nombre.split(' ')[0])}</strong>${Auth.esStaff() ? ` <span class="role-badge">${usuario.rol === 'duenio' ? 'Dueño' : 'Empleado'}</span>` : ''}</p>
                <p class="user-points">Tenés <strong>${Utils.numero(usuario.puntos)} puntos</strong></p>
            </div>
            <div class="user-actions">
                <a href="perfil.html" class="btn btn-secundario">Mis reservas</a>
                ${Auth.esStaff() ? '<a href="admin.html" class="btn">Panel de gestión</a>' : ''}
            </div>`;
    }

    function renderBannerPromo() {
        const cfg = Config.get();
        const activa = cfg.descuentoActivo && cfg.descuentoSegundaHora > 0 && cfg.maxHorasReserva >= 2;
        document.getElementById('aviso-promo').innerHTML = activa
            ? `<div class="banner-promo"><strong>Promo:</strong> reservá 2 horas seguidas y la segunda tiene <span class="chip-promo">${cfg.descuentoSegundaHora}% OFF</span></div>`
            : '';
    }

    function renderReglas() {
        const cfg = Config.get();
        const demo = Config.servidor().modoPago === 'demo';
        const pago = cfg.pagoMercadoPago
            ? `Pagás la seña con Mercado Pago (tarjeta, débito o dinero en cuenta) y el turno queda confirmado al instante.${demo ? ' <span class="chip-demo">Modo demostración: no se cobra dinero real</span>' : ''}`
            : `Transferí la seña y mandá el comprobante dentro de los ${cfg.minutosRetencionTransferencia} minutos.`;
        const reembolso = cfg.politicaReembolso === 'reembolso'
            ? `Si cancelás hasta ${cfg.limiteHorasCancelacion} horas antes, <strong>te devolvemos la seña</strong> automáticamente.`
            : `Podés cancelar hasta ${cfg.limiteHorasCancelacion} horas antes para liberar el horario (la seña no se devuelve).`;
        document.getElementById('lista-reglas').innerHTML = `
            <li><strong>Seña de ${Utils.moneda(cfg.montoSenia)}.</strong> ${pago} El resto se paga en la cancha.</li>
            <li><strong>Cancelaciones:</strong> ${reembolso} Se hace desde <a href="perfil.html">Mis reservas</a>.</li>
            ${cfg.puntosPorHora > 0 ? `<li><strong>Sumá puntos:</strong> con <a href="login.html?tab=registro">tu cuenta</a> cada hora suma ${cfg.puntosPorHora} puntos.</li>` : ''}`;
        const fijo = document.getElementById('cta-fijo');
        if (cfg.whatsapp) {
            fijo.hidden = false;
            fijo.querySelector('a').href = Utils.linkWhatsApp(cfg.whatsapp, `Hola, quiero un turno fijo semanal en ${cfg.nombreComplejo}.`);
        }
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
        contenedor.innerHTML = canchas.map((c) => `
            <article class="cancha-card" data-cancha="${Utils.esc(c.id)}">
                <div class="cancha-head"><span class="chip">${Utils.esc(c.tipo)}</span><h3>${Utils.esc(c.nombre)}</h3></div>
                <div class="cancha-body"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton corto"></div></div>
            </article>`).join('');
    }

    function actualizarCard(canchaId, enfocar = null) {
        const tarjeta = document.querySelector(`[data-cancha="${CSS.escape(canchaId)}"]`);
        const cancha = Config.canchaPorId(canchaId);
        if (!tarjeta || !cancha || !ctx) return;
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
        const hoy = Utils.hoyISO();
        const cerrado = ctx.cerradas.has(s.fecha);

        if (s.hora !== null && Booking.estadoHora(ctx, cancha.id, s.fecha, s.hora) !== 'libre') s.hora = null;

        const dias = Array.from({ length: cfg.diasAnticipacion }, (_, i) => {
            const iso = Utils.sumarDias(hoy, i);
            const etiqueta = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : Utils.fechaCorta(iso);
            const libres = ctx.cerradas.has(iso) ? 0 : Config.horarios().filter((h) => Booking.estadoHora(ctx, cancha.id, iso, h) === 'libre').length;
            const clases = ['btn-dia', iso === s.fecha ? 'active' : '', ctx.cerradas.has(iso) ? 'cerrado' : '', !libres && !ctx.cerradas.has(iso) ? 'lleno' : ''].join(' ');
            const pie = ctx.cerradas.has(iso) ? 'Cerrado' : libres ? `${libres} libres` : 'Completo';
            return `<button type="button" class="${clases}" data-action="dia" data-fecha="${iso}" aria-pressed="${iso === s.fecha}">${etiqueta}<small>${pie}</small></button>`;
        }).join('');

        const elegidas = s.hora !== null ? (Booking.horasConsecutivas(s.hora, s.horas) || [s.hora]) : [];
        const horarios = Config.horarios().map((h) => {
            const estado = Booking.estadoHora(ctx, cancha.id, s.fecha, h);
            const hora = Utils.hhmm(h);
            if (estado === 'libre') {
                const marcado = elegidas.includes(h);
                return `<button type="button" class="slot libre${marcado ? ' seleccionado' : ''}" data-action="hora" data-hora="${h}" aria-pressed="${marcado}">${hora}</button>`;
            }
            const texto = { ocupado: 'Ocupado', fijo: 'Turno fijo', reservando: 'Reservando', vencido: 'Pasó', cerrado: 'Cerrado' }[estado];
            return `<button type="button" class="slot ${estado}" disabled aria-label="${hora}, ${texto}">${hora}<small>${texto}</small></button>`;
        }).join('');

        let duracion = '';
        if (cfg.maxHorasReserva > 1) {
            duracion = `<p class="etiqueta-campo">¿Cuánto tiempo?</p><div class="duracion">${Array.from({ length: cfg.maxHorasReserva }, (_, i) => {
                const n = i + 1;
                const promo = cfg.descuentoActivo && n === 2 && cfg.descuentoSegundaHora > 0 ? `<em>2.ª hora -${cfg.descuentoSegundaHora}%</em>` : '';
                return `<button type="button" class="opcion-duracion${s.horas === n ? ' active' : ''}" data-action="horas" data-horas="${n}" aria-pressed="${s.horas === n}">${n} ${n === 1 ? 'hora' : 'horas'}${promo}</button>`;
            }).join('')}</div>`;
        }

        const delDia = ctx.ocupacion.filter((o) => o.cancha_id === cancha.id && o.fecha === s.fecha && o.estado === 'confirmada' && o.nombre_corto)
            .sort((a, b) => a.hora_inicio - b.hora_inicio);
        const itemsFeed = delDia.map((o) => `<div class="feed-item"><span class="avatar" aria-hidden="true">${Utils.esc(o.nombre_corto.charAt(0))}</span><span><strong>${Utils.esc(o.nombre_corto)}</strong> juega a las <strong>${Utils.hhmm(o.hora_inicio)} hs</strong></span></div>`);
        const libresHoy = Config.horarios().filter((h) => Booking.estadoHora(ctx, cancha.id, s.fecha, h) === 'libre').length;
        const feed = itemsFeed.length ? `<div class="feed" data-feed aria-live="off">${itemsFeed[0]}</div>`
            : `<div class="feed feed-vacio">${libresHoy ? '¡Todavía está todo libre este día!' : 'No quedan horarios este día'}</div>`;

        const cuerpo = cerrado
            ? `<div class="aviso-cerrado"><strong>Complejo cerrado</strong><p>${Utils.esc(ctx.cerradas.get(s.fecha) || 'No hay alquileres este día.')} Elegí otra fecha.</p></div>`
            : `<p class="etiqueta-campo">Horarios · ${Utils.esc(Utils.fechaAmigable(s.fecha))}</p>
               ${libresHoy ? `<div class="horarios-grid">${horarios}</div>` : `<div class="horarios-grid">${horarios}</div><p class="hint centrado">Este día está completo. Probá otro día.</p>`}
               ${duracion}
               ${htmlResumen(cancha, s)}
               <button type="button" class="btn btn-block btn-reservar" data-action="reservar"${s.hora !== null ? '' : ' disabled'}>${s.hora !== null ? 'Reservar este turno' : 'Tocá un horario libre'}</button>`;

        const html = `
            <div class="cancha-head tema-${indice % 3}">
                <span class="chip">${Utils.esc(cancha.tipo)}</span>
                <h3>${Utils.esc(cancha.nombre)}</h3>
                <p class="price">${Utils.moneda(cancha.precioHora)}<span> por hora</span></p>
            </div>
            <div class="cancha-body">
                ${feed}
                <p class="etiqueta-campo">Elegí el día</p>
                <div class="dias-slider" role="group" aria-label="Días disponibles">${dias}</div>
                ${cuerpo}
            </div>`;
        return { html, itemsFeed };
    }

    function htmlResumen(cancha, s) {
        if (s.hora === null) return '';
        const tramo = Booking.horasConsecutivas(s.hora, s.horas) || [s.hora];
        const p = Booking.calcularPrecio(cancha, tramo.length);
        return `
            <dl class="resumen">
                <div><dt>Turno</dt><dd>${Booking.rango({ hora_inicio: tramo[0], horas: tramo.length })}</dd></div>
                <div><dt>Total${p.descuento ? ' <span class="chip-promo chico">promo</span>' : ''}</dt><dd>${Utils.moneda(p.total)}</dd></div>
                <div><dt>Seña ahora</dt><dd>${Utils.moneda(p.senia)}</dd></div>
                <div><dt>Resto en la cancha</dt><dd>${Utils.moneda(p.saldo)}</dd></div>
            </dl>`;
    }

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
        if (!boton || boton.disabled || !ctx) return;
        const canchaId = boton.closest('[data-cancha]').dataset.cancha;
        const s = estadoDe(canchaId);
        const accion = boton.dataset.action;

        if (accion === 'dia') {
            s.fecha = boton.dataset.fecha;
            s.hora = null;
            actualizarCard(canchaId, `[data-action="dia"][data-fecha="${s.fecha}"]`);
        } else if (accion === 'hora') {
            const hora = Number(boton.dataset.hora);
            if (s.hora === hora) {
                s.hora = null;
            } else {
                const v = Booking.validarSeleccion(ctx, { canchaId, fecha: s.fecha, hora, horas: s.horas });
                if (!v.ok) {
                    UI.toast(s.horas > 1 ? `Desde las ${Utils.hhmm(hora)} no hay ${s.horas} horas seguidas libres. Probá con 1 hora u otro horario.` : v.mensaje, 'aviso');
                    return;
                }
                s.hora = hora;
            }
            actualizarCard(canchaId, `[data-action="hora"][data-hora="${hora}"]`);
            if (s.hora !== null) document.querySelector(`[data-cancha="${CSS.escape(canchaId)}"] .btn-reservar`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (accion === 'horas') {
            const horas = Number(boton.dataset.horas);
            s.horas = horas;
            if (s.hora !== null && !Booking.validarSeleccion(ctx, { canchaId, fecha: s.fecha, hora: s.hora, horas }).ok) {
                UI.toast(`Desde las ${Utils.hhmm(s.hora)} no hay ${horas} horas seguidas libres. Elegí otro horario.`, 'aviso');
                s.hora = null;
            }
            actualizarCard(canchaId, `[data-action="horas"][data-horas="${horas}"]`);
        } else if (accion === 'reservar') {
            abrirReserva(canchaId);
        }
    }

    // ---------- Reserva y pago ----------
    function abrirReserva(canchaId) {
        const cfg = Config.get();
        const s = estadoDe(canchaId);
        const v = Booking.validarSeleccion(ctx, { canchaId, fecha: s.fecha, hora: s.hora, horas: s.horas });
        if (!v.ok) { UI.alerta('No se puede reservar', Utils.esc(v.mensaje)); s.hora = null; actualizarCard(canchaId); return; }
        if (!cfg.pagoMercadoPago && !cfg.pagoTransferencia) {
            UI.alerta('Reservas online pausadas', 'Por el momento reservamos solo por WhatsApp.');
            return;
        }
        if (Config.servidor().modoPago === 'sin_servidor') {
            UI.alerta('Sin conexión con el servidor', 'No pudimos conectar con el sistema de pagos. Probá de nuevo en unos minutos o escribinos por WhatsApp.');
            return;
        }

        const usuario = Auth.usuario();
        const guardados = Utils.local.leer('datosCliente', {});
        const p = Booking.calcularPrecio(v.cancha, v.tramo.length);
        const rango = Booking.rango({ hora_inicio: v.tramo[0], horas: v.tramo.length });
        const metodos = [cfg.pagoMercadoPago && 'mercadopago', cfg.pagoTransferencia && 'transferencia'].filter(Boolean);

        const datos = usuario
            ? `<div class="quien"><span class="avatar" aria-hidden="true">${Utils.esc(Utils.iniciales(usuario.nombre))}</span><div><strong>${Utils.esc(usuario.nombre)}</strong><br><small>${Utils.esc(usuario.telefono)}</small></div></div>`
            : `<div class="form-grid compacto">
                    <div class="field"><label for="r-nombre">Nombre y apellido</label><input type="text" id="r-nombre" autocomplete="name" required maxlength="80" value="${Utils.esc(guardados.nombre || '')}"></div>
                    <div class="field"><label for="r-tel">WhatsApp</label><input type="tel" id="r-tel" autocomplete="tel" inputmode="numeric" required placeholder="Ej: 3415551234" value="${Utils.esc(guardados.telefono || '')}"></div>
               </div>
               <p class="hint">Con característica, sin 0 ni 15. ¿Tenés cuenta? <a href="login.html?next=index.html">Ingresá</a> y sumá puntos.</p>`;

        const opciones = metodos.length > 1 ? `
            <fieldset class="metodos"><legend>¿Cómo pagás la seña?</legend>
                <label class="metodo"><input type="radio" name="metodo" value="mercadopago" checked>
                    <span><strong>Mercado Pago</strong><small>Tarjeta, débito o dinero en cuenta. Se confirma al instante.</small></span></label>
                <label class="metodo"><input type="radio" name="metodo" value="transferencia">
                    <span><strong>Transferencia</strong><small>Tenés ${cfg.minutosRetencionTransferencia} min para mandar el comprobante.</small></span></label>
            </fieldset>` : '';

        const politica = cfg.politicaReembolso === 'reembolso'
            ? `Si cancelás hasta ${cfg.limiteHorasCancelacion} hs antes, te devolvemos la seña.`
            : `La seña no se devuelve si cancelás.`;

        UI.modal({
            titulo: 'Confirmá tu turno',
            cuerpo: `
                <div class="ticket-mini">
                    <strong>${Utils.esc(v.cancha.nombre)}</strong>
                    <span>${Utils.esc(Utils.fechaAmigable(s.fecha))}${Utils.diferenciaDias(Utils.hoyISO(), s.fecha) > 1 ? '' : ` (${Utils.esc(Utils.fechaCorta(s.fecha))})`} · ${rango}</span>
                </div>
                ${datos}
                <dl class="resumen">
                    <div><dt>Total del turno</dt><dd>${Utils.moneda(p.total)}</dd></div>
                    <div><dt>Seña a pagar ahora</dt><dd class="destacado">${Utils.moneda(p.senia)}</dd></div>
                    <div><dt>Resto, en la cancha</dt><dd>${Utils.moneda(p.saldo)}</dd></div>
                </dl>
                ${opciones}
                <p class="hint">${politica}</p>
                <p id="r-error" class="error-msg" role="alert" hidden></p>`,
            botones: [
                { texto: 'Volver', clase: 'btn-secundario' },
                {
                    texto: metodos[0] === 'mercadopago' ? `Pagar ${Utils.moneda(p.senia)} con Mercado Pago` : 'Reservar y transferir',
                    clase: metodos[0] === 'mercadopago' ? 'btn-mp' : '',
                    accion: (ctl, boton) => confirmar(ctl, boton, { canchaId, fecha: s.fecha, hora: s.hora, horas: v.tramo.length })
                }
            ]
        });
    }

    async function confirmar(ctl, boton, turno) {
        const usuario = Auth.usuario();
        const error = ctl.el.querySelector('#r-error');
        const metodo = ctl.el.querySelector('input[name="metodo"]:checked')?.value || (Config.get().pagoMercadoPago ? 'mercadopago' : 'transferencia');
        const nombre = usuario ? usuario.nombre : ctl.el.querySelector('#r-nombre').value.trim();
        const telefono = usuario ? usuario.telefono : Utils.digitos(ctl.el.querySelector('#r-tel').value);

        const mostrar = (m) => { error.textContent = m; error.hidden = !m; };
        if (!usuario) {
            if (nombre.length < 2 || !nombre.includes(' ')) { mostrar('Escribí tu nombre y apellido.'); ctl.el.querySelector('#r-nombre').focus(); return false; }
            if (telefono.length < 8 || telefono.length > 13) { mostrar('Revisá el WhatsApp: con característica, sin 0 ni 15 (ej: 3415551234).'); ctl.el.querySelector('#r-tel').focus(); return false; }
            Utils.local.guardar('datosCliente', { nombre, telefono });
        }
        mostrar('');

        try {
            const r = await UI.conBoton(boton, 'Reservando…', () => Db.api('reservar', { ...turno, hora: Utils.hhmm(turno.hora), nombre, telefono, metodo }));
            Booking.recordar(r.reserva.id, r.token);
            seleccion[turno.canchaId].hora = null;
            const destino = Booking.linkReserva(r.reserva, r.token);

            if (r.pago.modo === 'mercadopago' && r.pago.url) {
                ctl.cerrar();
                UI.modal({ titulo: 'Te llevamos a Mercado Pago', cuerpo: '<div class="spinner" aria-hidden="true"></div><p class="centrado">Tu turno está guardado. Completá el pago para confirmarlo.</p>', cerrable: false });
                location.href = r.pago.url;
            } else if (r.pago.modo === 'demo') {
                ctl.cerrar();
                pagoDemo(r.reserva, r.token, destino);
            } else {
                location.href = destino;
            }
        } catch (e) {
            mostrar(e.message);
            refrescar();
        }
        return false;
    }

    // Pantalla de pago simulada (solo mientras no esté conectada la cuenta real de Mercado Pago)
    function pagoDemo(reserva, token, destino) {
        UI.modal({
            titulo: 'Pago de demostración',
            cerrable: false,
            cuerpo: `
                <div class="mp-demo">
                    <div class="mp-demo-marca">Mercado Pago <span>DEMO</span></div>
                    <p class="mp-demo-monto">${Utils.moneda(reserva.monto_senia)}</p>
                    <p class="muted centrado">Seña · ${Utils.esc(reserva.cancha_nombre)}</p>
                </div>
                <p class="hint centrado">El sistema todavía no tiene conectada la cuenta de Mercado Pago del complejo, así que este pago es <strong>simulado</strong>: no se cobra dinero. Cuando se conecte, acá se abre el checkout real.</p>`,
            botones: [
                { texto: 'Abandonar pago', clase: 'btn-secundario', accion: () => { location.href = destino; return false; } },
                {
                    texto: 'Simular pago aprobado', clase: 'btn-mp',
                    accion: async (ctl, boton) => {
                        try {
                            await UI.conBoton(boton, 'Procesando…', () => Db.api('pago-demo', { id: reserva.id, token }));
                            location.href = `${destino}&nuevo=1`;
                        } catch (e) {
                            UI.toast(e.message, 'error');
                        }
                        return false;
                    }
                }
            ]
        });
    }
})();
