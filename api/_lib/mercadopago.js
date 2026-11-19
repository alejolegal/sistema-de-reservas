// Integración con Mercado Pago (Checkout Pro).
// Se activa sola cuando existe la variable de entorno MP_ACCESS_TOKEN.
// Sin token, el sistema funciona en "modo demostración": el pago se simula.
import crypto from 'node:crypto';

const API = 'https://api.mercadopago.com';

export const modoPago = () => (process.env.MP_ACCESS_TOKEN ? 'mercadopago' : 'demo');
export const esPrueba = () => String(process.env.MP_ACCESS_TOKEN || '').startsWith('TEST-');

async function mp(ruta, { method = 'GET', body, idempotencia } = {}) {
    const res = await fetch(`${API}${ruta}`, {
        method,
        headers: {
            Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
            ...(idempotencia ? { 'X-Idempotency-Key': idempotencia } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const datos = await res.json().catch(() => null);
    if (!res.ok) {
        const err = new Error(`Mercado Pago ${res.status}: ${JSON.stringify(datos)}`);
        err.status = res.status;
        err.datos = datos;
        throw err;
    }
    return datos;
}

const PAD = (n) => String(n).padStart(2, '0');

export async function crearPreferencia({ reserva, sitio, nombreComplejo }) {
    const urlVuelta = `${sitio}/reserva.html?id=${reserva.id}&t=${reserva.token}`;
    const titulo = `Seña ${reserva.cancha_nombre} · ${reserva.fecha} ${PAD(reserva.hora_inicio)}:00 hs`;
    const vence = reserva.vence_en ? new Date(reserva.vence_en) : new Date(Date.now() + 15 * 60000);
    const [nombre, ...apellido] = String(reserva.cliente_nombre).trim().split(/\s+/);

    const preferencia = await mp('/checkout/preferences', {
        method: 'POST',
        idempotencia: `pref-${reserva.id}`,
        body: {
            items: [{
                id: reserva.codigo,
                title: titulo.slice(0, 250),
                description: `Reserva ${reserva.codigo} en ${nombreComplejo}`,
                category_id: 'services',
                quantity: 1,
                currency_id: 'ARS',
                unit_price: Number(reserva.monto_senia)
            }],
            payer: {
                name: nombre,
                surname: apellido.join(' ') || undefined,
                email: reserva.cliente_email || undefined,
                phone: reserva.cliente_telefono ? { number: reserva.cliente_telefono } : undefined
            },
            external_reference: reserva.id,
            back_urls: { success: urlVuelta, pending: urlVuelta, failure: urlVuelta },
            auto_return: 'approved',
            notification_url: `${sitio}/api/mp-webhook`,
            statement_descriptor: String(nombreComplejo || 'RESERVA').normalize('NFD').replace(/[^\w ]/g, '').slice(0, 13).toUpperCase(),
            binary_mode: true, // aprobado o rechazado, sin pagos "en proceso" que traben el turno
            expires: true,
            expiration_date_from: new Date(Date.now() - 60000).toISOString(),
            expiration_date_to: vence.toISOString(),
            payment_methods: {
                // Efectivo en Rapipago/Pago Fácil tarda días en acreditarse: no sirve para un turno.
                excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }],
                installments: 1
            },
            metadata: { reserva_id: reserva.id, codigo: reserva.codigo }
        }
    });

    return {
        id: preferencia.id,
        // Con credenciales de prueba se usa el checkout de prueba.
        initPoint: esPrueba() ? (preferencia.sandbox_init_point || preferencia.init_point) : preferencia.init_point
    };
}

export const obtenerPago = (id) => mp(`/v1/payments/${encodeURIComponent(id)}`);

export async function pagoAprobadoDeReserva(reservaId) {
    const datos = await mp(`/v1/payments/search?external_reference=${encodeURIComponent(reservaId)}&sort=date_created&criteria=desc`);
    return (datos?.results || []).find((p) => p.status === 'approved') || null;
}

export async function reembolsar(paymentId) {
    return mp(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
        method: 'POST',
        idempotencia: `refund-${paymentId}`,
        body: {}
    });
}

// Verificación opcional de la firma del aviso (si se configuró MP_WEBHOOK_SECRET).
// Igualmente, cada aviso se confirma consultando el pago directamente a Mercado Pago.
export function firmaValida(req, dataId) {
    const secreto = process.env.MP_WEBHOOK_SECRET;
    if (!secreto) return true;
    const firma = String(req.headers['x-signature'] || '');
    const requestId = String(req.headers['x-request-id'] || '');
    const partes = Object.fromEntries(firma.split(',').map((p) => p.trim().split('=')));
    if (!partes.ts || !partes.v1) return false;
    const manifiesto = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${partes.ts};`;
    const esperado = crypto.createHmac('sha256', secreto).update(manifiesto).digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(partes.v1));
    } catch {
        return false;
    }
}
