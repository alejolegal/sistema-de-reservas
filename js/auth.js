// js/auth.js - Registro, ingreso, roles y perfiles.
// NOTA: mientras los datos vivan en el navegador (localStorage), la seguridad de
// roles es solo de interfaz. La protección real llega con el backend (Supabase + RLS).

const Auth = (() => {
    const ROLES_DUENIO = ['admin', 'duenio'];
    const ROLES_STAFF = ['admin', 'duenio', 'empleado'];
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const PASSWORD_MIN = 6;
    const PAGINAS_PERMITIDAS = ['index.html', 'perfil.html', 'admin.html', 'torneos.html'];

    const normalizarEmail = (e) => String(e || '').trim().toLowerCase();
    const crearHash = (password, sal) => Utils.hash(`${sal}:${password}`);
    const sanitizar = ({ passHash, sal, password, ...publico }) => publico;

    const esStaff = (u) => !!u && ROLES_STAFF.includes(u.rol);
    const esDuenio = (u) => !!u && ROLES_DUENIO.includes(u.rol);

    // Si todavía no existe un administrador, se crea uno inicial que DEBE cambiar su contraseña.
    async function asegurarAdminInicial() {
        const usuarios = Store.usuarios();
        if (usuarios.some((u) => ROLES_DUENIO.includes(u.rol))) return;
        const sal = Utils.sal();
        usuarios.push({
            id: 'admin_default',
            nombre: 'Administrador General',
            email: 'admin@complejo.com',
            telefono: '1100000000',
            sal,
            passHash: await crearHash('admin1234', sal),
            puntos: 0,
            rol: 'admin',
            cambiarPassword: true,
            creado: new Date().toISOString()
        });
        Store.guardarUsuarios(usuarios);
    }

    async function verificarPassword(usuario, password) {
        if (usuario.passHash) return (await crearHash(password, usuario.sal || '')) === usuario.passHash;
        // Usuarios creados por versiones anteriores (contraseña sin cifrar): se migran al ingresar.
        return usuario.password !== undefined && usuario.password === password;
    }

    async function registrar({ nombre, email, telefono, password }) {
        nombre = String(nombre || '').trim();
        email = normalizarEmail(email);
        telefono = Utils.digitos(telefono);

        if (nombre.length < 2) return { exito: false, mensaje: 'Ingresá tu nombre y apellido.' };
        if (!EMAIL_RE.test(email)) return { exito: false, mensaje: 'Ingresá un correo electrónico válido.' };
        if (telefono.length < 8 || telefono.length > 13) return { exito: false, mensaje: 'Ingresá un teléfono válido (solo números, con característica).' };
        if (String(password || '').length < PASSWORD_MIN) return { exito: false, mensaje: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.` };

        await asegurarAdminInicial();
        const usuarios = Store.usuarios();
        if (usuarios.some((u) => normalizarEmail(u.email) === email)) {
            return { exito: false, mensaje: 'Ese correo electrónico ya está registrado.' };
        }

        const sal = Utils.sal();
        const nuevo = {
            id: Utils.uid('user'),
            nombre,
            email,
            telefono,
            sal,
            passHash: await crearHash(password, sal),
            puntos: 0,
            rol: 'cliente', // el rol nunca se elige desde el registro público
            creado: new Date().toISOString()
        };
        usuarios.push(nuevo);
        Store.guardarUsuarios(usuarios);
        Store.iniciarSesion(nuevo.id);
        return { exito: true, usuario: sanitizar(nuevo) };
    }

    async function login(email, password) {
        await asegurarAdminInicial();
        email = normalizarEmail(email);
        const usuarios = Store.usuarios();
        const usuario = usuarios.find((u) => normalizarEmail(u.email) === email);

        if (!usuario || !(await verificarPassword(usuario, String(password || '')))) {
            return { exito: false, mensaje: 'Correo o contraseña incorrectos.' };
        }

        if (!usuario.passHash) {
            const eraClaveInicial = ROLES_DUENIO.includes(usuario.rol) && password === 'admin';
            usuario.sal = Utils.sal();
            usuario.passHash = await crearHash(password, usuario.sal);
            delete usuario.password;
            if (eraClaveInicial) usuario.cambiarPassword = true;
            Store.guardarUsuarios(usuarios);
        }

        Store.iniciarSesion(usuario.id);
        return { exito: true, usuario: sanitizar(usuario) };
    }

    function usuarioActual() {
        const id = Store.sesionId();
        if (!id) return null;
        const usuario = Store.usuarios().find((u) => u.id === id);
        return usuario ? sanitizar(usuario) : null;
    }

    async function actualizarPerfil(usuarioId, { nombre, telefono, passwordActual, passwordNueva }) {
        nombre = String(nombre || '').trim();
        telefono = Utils.digitos(telefono);
        if (nombre.length < 2) return { exito: false, mensaje: 'Ingresá tu nombre y apellido.' };
        if (telefono.length < 8 || telefono.length > 13) return { exito: false, mensaje: 'Ingresá un teléfono válido.' };

        const usuarios = Store.usuarios();
        const usuario = usuarios.find((u) => u.id === usuarioId);
        if (!usuario) return { exito: false, mensaje: 'Usuario no encontrado.' };

        if (passwordNueva) {
            if (passwordNueva.length < PASSWORD_MIN) return { exito: false, mensaje: `La nueva contraseña debe tener al menos ${PASSWORD_MIN} caracteres.` };
            if (!(await verificarPassword(usuario, String(passwordActual || '')))) {
                return { exito: false, mensaje: 'La contraseña actual no es correcta.' };
            }
            usuario.sal = Utils.sal();
            usuario.passHash = await crearHash(passwordNueva, usuario.sal);
            delete usuario.password;
            delete usuario.cambiarPassword;
        }

        usuario.nombre = nombre;
        usuario.telefono = telefono;
        Store.guardarUsuarios(usuarios);
        return { exito: true, mensaje: 'Tus datos se actualizaron correctamente.' };
    }

    // Solo el dueño puede ascender un cliente a empleado (o devolverlo a cliente).
    function cambiarRol(actor, usuarioId, nuevoRol) {
        if (!esDuenio(actor)) return { exito: false, mensaje: 'No tiene permisos para esta acción.' };
        if (!['cliente', 'empleado'].includes(nuevoRol)) return { exito: false, mensaje: 'Rol no válido.' };
        const usuarios = Store.usuarios();
        const usuario = usuarios.find((u) => u.id === usuarioId);
        if (!usuario || ROLES_DUENIO.includes(usuario.rol)) return { exito: false, mensaje: 'No se puede modificar ese usuario.' };
        usuario.rol = nuevoRol;
        Store.guardarUsuarios(usuarios);
        return { exito: true };
    }

    // Solo se aceptan destinos internos conocidos (evita redirecciones a sitios externos).
    function destinoSeguro(valor) {
        return PAGINAS_PERMITIDAS.includes(valor) ? valor : null;
    }

    function irALogin() {
        const actual = location.pathname.split('/').pop() || 'index.html';
        const next = destinoSeguro(actual);
        location.replace(`login.html${next ? `?next=${encodeURIComponent(next)}` : ''}`);
    }

    function requerirSesion() {
        const usuario = usuarioActual();
        if (!usuario) irALogin();
        return usuario;
    }

    function requerirStaff() {
        const usuario = usuarioActual();
        if (!usuario) { irALogin(); return null; }
        if (!esStaff(usuario)) { location.replace('index.html'); return null; }
        return usuario;
    }

    function logout() {
        Store.cerrarSesion();
        location.href = 'index.html';
    }

    return {
        esStaff, esDuenio, destinoSeguro,
        asegurarAdminInicial, registrar, login, usuarioActual, actualizarPerfil, cambiarRol,
        requerirSesion, requerirStaff, logout
    };
})();
