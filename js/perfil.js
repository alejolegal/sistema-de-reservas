// js/perfil.js - "Mis reservas": con cuenta (datos, puntos, historial) o sin cuenta
// (las reservas hechas desde este celular, guardadas con su enlace privado).

(() => {
    document.addEventListener('DOMContentLoaded', () => UI.arrancar('perfil', iniciar));

    async function iniciar() {
        const usuario = Auth.usuario();
        document.getElementById('seccion-cuenta').hidden = !usuario;
        document.getElementById('seccion-invitado').hidden = !!usuario;
        document.getElementById('seccion-datos').hidden = !usuario;
        if (usuario) {
            renderResumen();
            document.getElementById('input-nombre').value = usuario.nombre;
            document.getElementById('input-telefono').value = usuario.telefono;
            document.getElementById('form-perfil').addEventListener('submit', guardarPerfil);
            document.getElementById('form-password').addEventListener('submit', guardarPassword);
        }
        await renderReservas();
    }

    function renderResumen(reservas = []) {
        const u = Auth.usuario();
        const jugadas = reservas.filter((r) => r.estado === 'confirmada').length;
        document.getElementById('perfil-saludo-nombre').textContent = u.nombre.split(' ')[0];
        document.getElementById('perfil-puntos-val').textContent = Utils.numero(u.puntos);
        document.getElementById('perfil-total-alquileres').textContent = jugadas;
    }

    async function guardarPerfil(e) {
        e.preventDefault();
        const error = document.getElementById('perfil-error');
        const r = await UI.conBoton(e.target.querySelector('[type="submit"]'), 'Guardando…', () => Auth.actualizarPerfil({
            nombre: document.getElementById('input-nombre').value,
            telefono: document.getElementById('input-telefono').value
        }));
        error.textContent = r.exito ? '' : r.mensaje;
        error.hidden = r.exito;
        if (r.exito) { UI.toast(r.mensaje); UI.montarEncabezado('perfil'); renderResumen(); }
    }

    async function guardarPassword(e) {
        e.preventDefault();
        const error = document.getElementById('password-error');
        const r = await UI.conBoton(e.target.querySelector('[type="submit"]'), 'Guardando…', () => Auth.cambiarPassword(
            document.getElementById('input-password-actual').value, document.getElementById('input-password').value));
        error.textContent = r.exito ? '' : r.mensaje;
        error.hidden = r.exito;
        if (r.exito) { e.target.reset(); UI.toast(r.mensaje); }
    }

    function ordenar(reservas) {
        const vigentes = reservas.filter(Booking.vigente).sort((a, b) => Booking.inicio(a) - Booking.inicio(b));
        const resto = reservas.filter((r) => !Booking.vigente(r)).sort((a, b) => Booking.inicio(b) - Booking.inicio(a));
        return { vigentes, resto };
    }

    async function renderReservas() {
        const usuario = Auth.usuario();
        const contenedor = document.getElementById('lista-mis-reservas');
        let reservas = [];
        try {
            const locales = await Booking.cargarRecordadas();
            if (usuario) {
                const propias = await Db.q(Db.sb.from('reservas').select('*').eq('usuario_id', usuario.id).order('fecha', { ascending: false }).limit(200));
                const ids = new Set(propias.map((r) => r.id));
                reservas = [...propias, ...locales.filter((r) => !ids.has(r.id))];
                renderResumen(propias);
            } else {
                reservas = locales;
            }
        } catch (e) {
            contenedor.innerHTML = `<p class="vacio">${Utils.esc(e.message)}</p>`;
            return;
        }

        const { vigentes, resto } = ordenar(reservas);
        if (!reservas.length) {
            contenedor.innerHTML = `<div class="vacio"><p>${usuario ? 'Todavía no tenés reservas.' : 'No hay reservas hechas desde este celular.'}</p><a class="btn" href="index.html">Reservar un turno</a></div>`;
            return;
        }
        const tarjeta = (r) => {
            const e = Booking.etiqueta(r);
            return `<a class="reserva-card ${Booking.vigente(r) && r.estado === 'confirmada' ? 'destacada' : ''}" href="${Utils.esc(Booking.linkReserva(r))}">
                <header><strong>${Utils.esc(r.cancha_nombre)}</strong><span class="badge ${e.clase}">${e.texto}</span></header>
                <p class="reserva-cuando">${Utils.esc(Utils.fechaAmigable(r.fecha))} · ${Booking.rango(r)}</p>
                <p class="reserva-montos">Código ${Utils.esc(r.codigo)} · Resto en la cancha: ${Utils.moneda(Booking.saldo(r))}</p>
            </a>`;
        };
        contenedor.innerHTML = `
            ${vigentes.length ? `<h3 class="sub-titulo">Próximos turnos</h3><div class="lista-reservas">${vigentes.map(tarjeta).join('')}</div>` : '<p class="vacio">No tenés turnos próximos. <a href="index.html">Reservá uno</a>.</p>'}
            ${resto.length ? `<details class="historial"><summary>Historial (${resto.length})</summary><div class="lista-reservas">${resto.map(tarjeta).join('')}</div></details>` : ''}`;
    }
})();
