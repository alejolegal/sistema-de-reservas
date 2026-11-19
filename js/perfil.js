// js/perfil.js - Perfil del cliente: datos personales, puntos y reservas.

(() => {
    let usuario = null;

    const ETIQUETAS = {
        activa: ['Confirmada', 'badge-activa'],
        pendiente_pago: ['Pendiente de pago', 'badge-pendiente'],
        cancelada: ['Cancelada', 'badge-cancelada'],
        completada: ['Jugada', 'badge-completada']
    };

    document.addEventListener('DOMContentLoaded', () => {
        UI.iniciarPagina('perfil');
        usuario = Auth.requerirSesion();
        if (!usuario) return;

        document.getElementById('contenido').hidden = false;
        renderResumen();
        renderFormulario();
        renderReservas();

        document.getElementById('form-perfil').addEventListener('submit', guardarPerfil);
        document.getElementById('lista-mis-reservas').addEventListener('click', alHacerClic);
    });

    function refrescarUsuario() {
        usuario = Auth.usuarioActual();
    }

    function renderResumen() {
        const reservas = Booking.reservasDeUsuario(usuario.id);
        const jugables = reservas.filter((r) => r.estado === 'activa' || r.estado === 'completada').length;
        document.getElementById('perfil-saludo-nombre').textContent = usuario.nombre;
        document.getElementById('perfil-puntos-val').textContent = usuario.puntos || 0;
        document.getElementById('perfil-total-alquileres').textContent = jugables;

        const aviso = document.getElementById('aviso-password');
        aviso.hidden = !usuario.cambiarPassword;
    }

    function renderFormulario() {
        document.getElementById('input-nombre').value = usuario.nombre;
        document.getElementById('input-telefono').value = usuario.telefono;
    }

    async function guardarPerfil(evento) {
        evento.preventDefault();
        const boton = evento.target.querySelector('button[type="submit"]');
        const error = document.getElementById('perfil-error');
        error.hidden = true;
        boton.disabled = true;

        const resultado = await Auth.actualizarPerfil(usuario.id, {
            nombre: document.getElementById('input-nombre').value,
            telefono: document.getElementById('input-telefono').value,
            passwordActual: document.getElementById('input-password-actual').value,
            passwordNueva: document.getElementById('input-password').value
        });
        boton.disabled = false;

        if (!resultado.exito) {
            error.textContent = resultado.mensaje;
            error.hidden = false;
            return;
        }
        document.getElementById('input-password-actual').value = '';
        document.getElementById('input-password').value = '';
        refrescarUsuario();
        renderResumen();
        UI.montarEncabezado('perfil');
        UI.toast(resultado.mensaje);
    }

    function ordenar(reservas) {
        const ahora = new Date();
        const vigentes = reservas.filter((r) => Booking.ESTADOS_VIGENTES.includes(r.estado) && Booking.fin(r) > ahora)
            .sort((a, b) => Booking.inicio(a) - Booking.inicio(b));
        const resto = reservas.filter((r) => !vigentes.includes(r))
            .sort((a, b) => Booking.inicio(b) - Booking.inicio(a));
        return [...vigentes, ...resto];
    }

    function renderReservas() {
        const contenedor = document.getElementById('lista-mis-reservas');
        const reservas = ordenar(Booking.reservasDeUsuario(usuario.id));
        const cfg = Config.get();

        if (!reservas.length) {
            contenedor.innerHTML = `<p class="vacio">Todavía no tenés reservas. <a href="index.html">Reservá tu primer turno</a>.</p>`;
            return;
        }

        contenedor.innerHTML = reservas.map((r) => {
            const [texto, clase] = ETIQUETAS[r.estado] || [r.estado, ''];
            const vigente = Booking.ESTADOS_VIGENTES.includes(r.estado);
            const permiso = vigente ? Booking.puedeCancelar(r, usuario) : { ok: false };

            let pie = '';
            if (r.estado === 'pendiente_pago') {
                const mensaje = `Hola, soy ${usuario.nombre}. Te envío el comprobante de la seña de mi turno del ${Utils.fechaLarga(r.fecha)}, ${Booking.rangoHorario(r)}, en ${r.nombreCancha}.`;
                pie = `<p class="reserva-nota">Transferí la seña al alias <strong>${Utils.esc(cfg.alias)}</strong> antes de las <strong>${Utils.horaLocal(new Date(r.venceEn))} hs</strong> y enviá el comprobante.</p>
                       <a class="btn btn-whatsapp btn-sm" href="${Utils.esc(Utils.linkWhatsApp(cfg.whatsapp, mensaje))}" target="_blank" rel="noopener">Enviar comprobante</a>`;
            }
            if (vigente) {
                pie += permiso.ok
                    ? `<button type="button" class="btn btn-peligro btn-sm" data-cancelar="${Utils.esc(r.id)}">Cancelar turno</button>`
                    : `<p class="reserva-nota">${Utils.esc(permiso.motivo)} Si necesitás cambiarlo, <a href="${Utils.esc(Utils.linkWhatsApp(cfg.whatsapp, 'Hola, necesito modificar una reserva.'))}" target="_blank" rel="noopener">escribinos por WhatsApp</a>.</p>`;
            }
            if (r.estado === 'cancelada' && r.motivo) pie = `<p class="reserva-nota">${Utils.esc(r.motivo)}.</p>`;

            return `
                <article class="reserva-card ${r.estado === 'activa' ? 'destacada' : ''}">
                    <header>
                        <strong>${Utils.esc(r.nombreCancha)}</strong>
                        <span class="badge ${clase}">${texto}</span>
                    </header>
                    <p class="reserva-cuando">${Utils.fechaLarga(r.fecha)} · ${Booking.rangoHorario(r)}</p>
                    <p class="reserva-montos">Seña: ${Utils.moneda(r.montoSenia)} · Resto en la cancha: ${Utils.moneda(r.saldoRestante ?? Math.max(0, r.precioTotal - r.montoSenia))}</p>
                    ${pie ? `<div class="reserva-acciones">${pie}</div>` : ''}
                </article>`;
        }).join('');
    }

    async function alHacerClic(evento) {
        const boton = evento.target.closest('[data-cancelar]');
        if (!boton) return;
        const limite = Config.get().limiteHorasCancelacion;
        const ok = await UI.confirmar(
            '¿Cancelar este turno?',
            `El horario quedará libre para otros clientes. Recordá que solo se puede cancelar hasta ${limite} horas antes del partido.`,
            { textoOk: 'Sí, cancelar turno', textoCancelar: 'No, mantenerlo', peligro: true }
        );
        if (!ok) return;

        const resultado = Booking.cancelarReserva(boton.dataset.cancelar, usuario);
        UI.toast(resultado.mensaje, resultado.exito ? 'ok' : 'error');
        refrescarUsuario();
        renderResumen();
        renderReservas();
    }
})();
