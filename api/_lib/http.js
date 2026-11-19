// Utilidades HTTP compartidas por las funciones del servidor (Vercel Functions).

export class ErrorUsuario extends Error {
    constructor(mensaje, status = 400) {
        super(mensaje);
        this.status = status;
    }
}

export function responder(res, status, datos) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(datos));
}

export async function leerCuerpo(req) {
    if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === 'string') {
            try { return JSON.parse(req.body || '{}'); } catch { return {}; }
        }
        return req.body;
    }
    const partes = [];
    for await (const parte of req) partes.push(parte);
    const texto = Buffer.concat(partes).toString('utf8');
    try { return texto ? JSON.parse(texto) : {}; } catch { return {}; }
}

export function ipCliente(req) {
    const reenviada = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return reenviada || req.socket?.remoteAddress || null;
}

export function tokenBearer(req) {
    const h = String(req.headers.authorization || '');
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

// URL pública del sitio (para volver de Mercado Pago y recibir avisos)
export function urlSitio(req) {
    if (process.env.SITIO_URL) return process.env.SITIO_URL.replace(/\/$/, '');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
}

// Envuelve un manejador: métodos permitidos, errores prolijos y en español.
export function manejador(metodos, fn) {
    return async (req, res) => {
        if (!metodos.includes(req.method)) {
            res.setHeader('Allow', metodos.join(', '));
            return responder(res, 405, { error: 'Método no permitido.' });
        }
        try {
            const datos = await fn(req, res);
            if (!res.writableEnded) responder(res, 200, datos ?? { ok: true });
        } catch (error) {
            if (error instanceof ErrorUsuario) return responder(res, error.status, { error: error.message });
            console.error(error);
            return responder(res, 500, { error: 'Ocurrió un error inesperado. Probá de nuevo en unos segundos.' });
        }
    };
}
