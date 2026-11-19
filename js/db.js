// js/db.js - Conexión con Supabase (base de datos) y con las funciones del servidor (/api).

const Db = (() => {
    const sb = window.supabase.createClient(window.ENV.SUPABASE_URL, window.ENV.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });

    const MENSAJES = [
        [/Failed to fetch|NetworkError|Load failed|fetch/i, 'No hay conexión. Revisá internet y probá de nuevo.'],
        [/JWT expired/i, 'Tu sesión venció. Volvé a ingresar.'],
        [/permission denied|row-level security/i, 'No tenés permisos para esta acción.'],
        [/duplicate key/i, 'Ese dato ya existe.']
    ];

    function traducir(error) {
        if (!error) return 'Ocurrió un error inesperado.';
        if (error.code === 'P0001') return error.message;
        const texto = error.message || String(error);
        const regla = MENSAJES.find(([re]) => re.test(texto));
        return regla ? regla[1] : texto;
    }

    // Ejecuta una consulta de supabase-js y lanza un Error con mensaje en español.
    async function q(consulta) {
        const { data, error } = await consulta;
        if (error) throw new Error(traducir(error));
        return data;
    }

    // Trae todas las filas (de a 1000) de una consulta. constructor(desde, hasta) => consulta
    async function todas(constructor) {
        const filas = [];
        for (let desde = 0; ; desde += 1000) {
            const lote = await q(constructor().range(desde, desde + 999));
            filas.push(...lote);
            if (lote.length < 1000) return filas;
        }
    }

    const rpc = (nombre, args) => q(sb.rpc(nombre, args));

    async function token() {
        const { data } = await sb.auth.getSession();
        return data?.session?.access_token || null;
    }

    // Llamada a las funciones del servidor (Vercel). Adjunta la sesión si existe.
    async function api(ruta, cuerpo, metodo = 'POST') {
        const jwt = await token();
        let res;
        try {
            res = await fetch(`/api/${ruta}`, {
                method: metodo,
                headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
                body: metodo === 'GET' ? undefined : JSON.stringify(cuerpo || {})
            });
        } catch (_) {
            throw new Error('No hay conexión. Revisá internet y probá de nuevo.');
        }
        const datos = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(datos.error || 'El servidor no respondió. Probá de nuevo en unos segundos.');
        return datos;
    }

    return { sb, q, todas, rpc, api, traducir };
})();
