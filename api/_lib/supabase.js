// Acceso a Supabase desde el servidor con la clave de servicio (nunca llega al navegador).
import { ErrorUsuario } from './http.js';

const URL_BASE = () => {
    const url = process.env.SUPABASE_URL;
    if (!url) throw new Error('Falta la variable de entorno SUPABASE_URL');
    return url.replace(/\/$/, '');
};
const CLAVE = () => {
    const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!clave) throw new Error('Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY');
    return clave;
};

async function pedir(ruta, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(`${URL_BASE()}${ruta}`, {
        method,
        headers: {
            apikey: CLAVE(),
            Authorization: `Bearer ${CLAVE()}`,
            'Content-Type': 'application/json',
            ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const texto = await res.text();
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
    if (!res.ok) {
        // Errores de negocio lanzados desde la base (RAISE ... ERRCODE P0001) se muestran tal cual.
        if (datos && datos.code === 'P0001') throw new ErrorUsuario(datos.message, 409);
        const err = new Error(`Supabase ${res.status}: ${typeof datos === 'string' ? datos : JSON.stringify(datos)}`);
        err.status = res.status;
        throw err;
    }
    return datos;
}

export const rpc = (nombre, args = {}) => pedir(`/rest/v1/rpc/${nombre}`, { method: 'POST', body: args });

export async function reservaPorId(id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
    const filas = await pedir(`/rest/v1/reservas?id=eq.${id}&select=*`);
    return filas?.[0] || null;
}

export async function actualizarReserva(id, cambios) {
    const filas = await pedir(`/rest/v1/reservas?id=eq.${id}`, {
        method: 'PATCH', body: cambios, headers: { Prefer: 'return=representation' }
    });
    return filas?.[0] || null;
}

export async function ajustes() {
    const filas = await pedir('/rest/v1/ajustes?id=eq.1&select=datos');
    return filas?.[0]?.datos || {};
}

export async function perfil(id) {
    const filas = await pedir(`/rest/v1/perfiles?id=eq.${id}&select=*`);
    return filas?.[0] || null;
}

export async function registrarEvento(origen, reservaId, datos) {
    try {
        await pedir('/rest/v1/eventos_pago', { method: 'POST', body: { origen, reserva_id: reservaId || null, datos } });
    } catch (error) {
        console.error('No se pudo registrar el evento de pago', error);
    }
}

// Valida el token de sesión de un usuario y devuelve su perfil (o null).
export async function usuarioDesdeToken(jwt) {
    if (!jwt) return null;
    const res = await fetch(`${URL_BASE()}/auth/v1/user`, {
        headers: { apikey: CLAVE(), Authorization: `Bearer ${jwt}` }
    });
    if (!res.ok) return null;
    const usuario = await res.json();
    return usuario?.id ? await perfil(usuario.id) : null;
}

export async function cambiarPasswordUsuario(id, password) {
    return pedir(`/auth/v1/admin/users/${id}`, { method: 'PUT', body: { password } });
}

// Proyección pública de una reserva (sin datos internos)
export function publica(r) {
    if (!r) return null;
    const { origen_ip, token, notas, creada_por, ...resto } = r;
    return resto;
}
