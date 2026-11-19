// js/auth.js - Cuentas de usuario (Supabase Auth) y roles.
// La seguridad real la aplica la base de datos (RLS): esto solo adapta la interfaz.

const Auth = (() => {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const PASSWORD_MIN = 6;
    const PAGINAS_PERMITIDAS = ['index.html', 'perfil.html', 'admin.html', 'torneos.html'];
    let usuario = null; // perfil + email

    const esStaff = (u = usuario) => !!u && ['empleado', 'duenio'].includes(u.rol);
    const esDuenio = (u = usuario) => !!u && u.rol === 'duenio';

    function traducir(error) {
        const t = String(error?.message || error || '');
        if (/Invalid login credentials/i.test(t)) return 'Correo o contraseña incorrectos.';
        if (/already registered|already been registered|User already/i.test(t)) return 'Ese correo ya tiene una cuenta. Probá ingresar.';
        if (/Password should be/i.test(t)) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
        if (/rate limit|too many/i.test(t)) return 'Demasiados intentos. Esperá un minuto y probá de nuevo.';
        if (/invalid.*email|email.*invalid/i.test(t)) return 'Ingresá un correo electrónico válido.';
        if (/should be different/i.test(t)) return 'La nueva contraseña tiene que ser distinta de la actual.';
        return Db.traducir(error);
    }

    async function cargarPerfil(user) {
        if (!user) { usuario = null; return null; }
        const perfil = await Db.q(Db.sb.from('perfiles').select('*').eq('id', user.id).maybeSingle());
        usuario = perfil ? { ...perfil, email: perfil.email || user.email } : null;
        return usuario;
    }

    async function iniciar() {
        const { data } = await Db.sb.auth.getSession();
        await cargarPerfil(data?.session?.user || null);
        return usuario;
    }

    async function login(email, password) {
        const { data, error } = await Db.sb.auth.signInWithPassword({ email: String(email || '').trim().toLowerCase(), password: String(password || '') });
        if (error) return { exito: false, mensaje: traducir(error) };
        await cargarPerfil(data.user);
        return { exito: true, usuario };
    }

    async function registrar({ nombre, email, telefono, password }) {
        nombre = String(nombre || '').trim();
        email = String(email || '').trim().toLowerCase();
        telefono = Utils.digitos(telefono);
        if (nombre.length < 2) return { exito: false, mensaje: 'Ingresá tu nombre y apellido.' };
        if (!EMAIL_RE.test(email)) return { exito: false, mensaje: 'Ingresá un correo electrónico válido.' };
        if (telefono.length < 8 || telefono.length > 13) return { exito: false, mensaje: 'Ingresá un WhatsApp válido (con característica, sin 0 ni 15).' };
        if (String(password || '').length < PASSWORD_MIN) return { exito: false, mensaje: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.` };

        const { data, error } = await Db.sb.auth.signUp({ email, password, options: { data: { nombre, telefono } } });
        if (error) return { exito: false, mensaje: traducir(error) };
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            return { exito: false, mensaje: 'Ese correo ya tiene una cuenta. Probá ingresar.' };
        }
        if (!data.session) {
            const r = await login(email, password);
            if (!r.exito) return r;
        }
        await cargarPerfil(data.user);
        return { exito: true, usuario };
    }

    async function actualizarPerfil({ nombre, telefono }) {
        nombre = String(nombre || '').trim();
        telefono = Utils.digitos(telefono);
        if (nombre.length < 2) return { exito: false, mensaje: 'Ingresá tu nombre y apellido.' };
        if (telefono.length < 8 || telefono.length > 13) return { exito: false, mensaje: 'Ingresá un WhatsApp válido.' };
        try {
            await Db.q(Db.sb.from('perfiles').update({ nombre, telefono }).eq('id', usuario.id));
            usuario = { ...usuario, nombre, telefono };
            return { exito: true, mensaje: 'Tus datos se actualizaron.' };
        } catch (e) {
            return { exito: false, mensaje: e.message };
        }
    }

    async function cambiarPassword(actual, nueva) {
        if (String(nueva || '').length < PASSWORD_MIN) return { exito: false, mensaje: `La nueva contraseña debe tener al menos ${PASSWORD_MIN} caracteres.` };
        const verificacion = await Db.sb.auth.signInWithPassword({ email: usuario.email, password: String(actual || '') });
        if (verificacion.error) return { exito: false, mensaje: 'La contraseña actual no es correcta.' };
        const { error } = await Db.sb.auth.updateUser({ password: nueva });
        if (error) return { exito: false, mensaje: traducir(error) };
        return { exito: true, mensaje: 'Contraseña actualizada.' };
    }

    const destinoSeguro = (valor) => (PAGINAS_PERMITIDAS.includes(valor) ? valor : null);

    function irALogin() {
        const actual = location.pathname.split('/').pop() || 'index.html';
        const next = destinoSeguro(actual);
        location.replace(`login.html${next ? `?next=${encodeURIComponent(next)}` : ''}`);
    }

    function requerirStaff() {
        if (!usuario) { irALogin(); return null; }
        if (!esStaff()) { location.replace('index.html'); return null; }
        return usuario;
    }

    async function logout() {
        await Db.sb.auth.signOut();
        usuario = null;
        location.href = 'index.html';
    }

    return {
        iniciar, login, registrar, logout, actualizarPerfil, cambiarPassword, requerirStaff, destinoSeguro,
        recargar: async () => cargarPerfil((await Db.sb.auth.getUser()).data?.user || null),
        usuario: () => usuario, esStaff, esDuenio
    };
})();
