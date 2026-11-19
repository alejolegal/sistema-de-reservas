// js/login.js - Ingreso y registro.

document.addEventListener('DOMContentLoaded', () => UI.arrancar('login', async () => {
    const parametros = new URLSearchParams(location.search);
    const destino = Auth.destinoSeguro(parametros.get('next'));
    const irADestino = () => location.replace(destino || (Auth.esStaff() ? 'admin.html' : 'index.html'));

    if (Auth.usuario()) { irADestino(); return; }

    const pestanas = {
        login: { boton: document.getElementById('tab-login'), panel: document.getElementById('form-login') },
        registro: { boton: document.getElementById('tab-registro'), panel: document.getElementById('form-registro') }
    };
    function cambiarPestana(clave) {
        Object.entries(pestanas).forEach(([k, { boton, panel }]) => {
            const activa = k === clave;
            boton.classList.toggle('active', activa);
            boton.setAttribute('aria-selected', String(activa));
            boton.tabIndex = activa ? 0 : -1;
            panel.hidden = !activa;
        });
    }
    Object.entries(pestanas).forEach(([clave, { boton }]) => boton.addEventListener('click', () => cambiarPestana(clave)));
    cambiarPestana(parametros.get('tab') === 'registro' ? 'registro' : 'login');

    const guardados = Utils.local.leer('datosCliente', {});
    if (guardados.nombre) document.getElementById('reg-nombre').value = guardados.nombre;
    if (guardados.telefono) document.getElementById('reg-telefono').value = guardados.telefono;

    function mostrarError(id, mensaje) {
        const el = document.getElementById(id);
        el.textContent = mensaje;
        el.hidden = !mensaje;
    }

    document.getElementById('form-login').addEventListener('submit', async (e) => {
        e.preventDefault();
        mostrarError('login-error', '');
        const r = await UI.conBoton(e.target.querySelector('[type="submit"]'), 'Ingresando…', () =>
            Auth.login(document.getElementById('login-email').value, document.getElementById('login-password').value));
        if (r.exito) irADestino(); else mostrarError('login-error', r.mensaje);
    });

    document.getElementById('form-registro').addEventListener('submit', async (e) => {
        e.preventDefault();
        mostrarError('reg-error', '');
        const password = document.getElementById('reg-password').value;
        if (password !== document.getElementById('reg-password2').value) { mostrarError('reg-error', 'Las contraseñas no coinciden.'); return; }
        const r = await UI.conBoton(e.target.querySelector('[type="submit"]'), 'Creando cuenta…', () => Auth.registrar({
            nombre: document.getElementById('reg-nombre').value,
            email: document.getElementById('reg-email').value,
            telefono: document.getElementById('reg-telefono').value,
            password
        }));
        if (r.exito) irADestino(); else mostrarError('reg-error', r.mensaje);
    });

    document.querySelectorAll('form [type="submit"]').forEach((b) => { b.disabled = false; });

    document.getElementById('olvide').addEventListener('click', () => {
        const cfg = Config.get();
        const wa = cfg.whatsapp ? Utils.linkWhatsApp(cfg.whatsapp, 'Hola, olvidé la contraseña de mi cuenta para reservar. Mi correo es: ') : '';
        UI.modal({
            titulo: '¿Olvidaste tu contraseña?',
            cuerpo: `<p>Escribinos por WhatsApp con el correo de tu cuenta y te damos una contraseña nueva en el momento.</p>
                ${wa ? `<a class="btn btn-whatsapp btn-block" href="${Utils.esc(wa)}" target="_blank" rel="noopener">Escribir por WhatsApp</a>` : ''}
                <p class="hint">Recordá que también podés reservar sin cuenta, solo con tu nombre y WhatsApp.</p>`,
            botones: [{ texto: 'Cerrar', clase: 'btn-secundario' }]
        });
    });
}));
