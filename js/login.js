// js/login.js - Ingreso y registro.

document.addEventListener('DOMContentLoaded', async () => {
    UI.iniciarPagina('login');
    await Auth.asegurarAdminInicial();

    const parametros = new URLSearchParams(location.search);
    const destino = Auth.destinoSeguro(parametros.get('next'));

    const irADestino = (usuario) => {
        location.replace(destino || (Auth.esStaff(usuario) ? 'admin.html' : 'index.html'));
    };

    const yaIngreso = Auth.usuarioActual();
    if (yaIngreso) { irADestino(yaIngreso); return; }

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

    function mostrarError(id, mensaje) {
        const el = document.getElementById(id);
        el.textContent = mensaje;
        el.hidden = !mensaje;
    }

    // Evita envíos dobles mientras se procesa (el cifrado de la contraseña es asincrónico).
    async function conBoton(formulario, textoOcupado, tarea) {
        const boton = formulario.querySelector('button[type="submit"]');
        const textoOriginal = boton.textContent;
        boton.disabled = true;
        boton.textContent = textoOcupado;
        try { await tarea(); } finally {
            boton.disabled = false;
            boton.textContent = textoOriginal;
        }
    }

    document.getElementById('form-login').addEventListener('submit', (e) => {
        e.preventDefault();
        mostrarError('login-error', '');
        conBoton(e.target, 'Ingresando…', async () => {
            const resultado = await Auth.login(
                document.getElementById('login-email').value,
                document.getElementById('login-password').value
            );
            if (resultado.exito) irADestino(resultado.usuario);
            else mostrarError('login-error', resultado.mensaje);
        });
    });

    document.getElementById('form-registro').addEventListener('submit', (e) => {
        e.preventDefault();
        mostrarError('reg-error', '');
        const password = document.getElementById('reg-password').value;
        if (password !== document.getElementById('reg-password2').value) {
            mostrarError('reg-error', 'Las contraseñas no coinciden.');
            return;
        }
        conBoton(e.target, 'Creando cuenta…', async () => {
            const resultado = await Auth.registrar({
                nombre: document.getElementById('reg-nombre').value,
                email: document.getElementById('reg-email').value,
                telefono: document.getElementById('reg-telefono').value,
                password
            });
            if (resultado.exito) irADestino(resultado.usuario);
            else mostrarError('reg-error', resultado.mensaje);
        });
    });
});
