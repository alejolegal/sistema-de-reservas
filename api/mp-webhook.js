// POST /api/mp-webhook — Mercado Pago avisa acá cada vez que cambia un pago.
// Nunca se confía en el contenido del aviso: se consulta el pago a Mercado Pago.
import { manejador, leerCuerpo, responder } from './_lib/http.js';
import { rpc, reservaPorId, registrarEvento, actualizarReserva } from './_lib/supabase.js';
import { modoPago, obtenerPago, firmaValida } from './_lib/mercadopago.js';

export default manejador(['POST', 'GET'], async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const cuerpo = req.method === 'POST' ? await leerCuerpo(req) : {};
    const tipo = url.searchParams.get('type') || url.searchParams.get('topic') || cuerpo.type || cuerpo.topic || '';
    const dataId = url.searchParams.get('data.id') || cuerpo?.data?.id || url.searchParams.get('id') || '';

    if (modoPago() !== 'mercadopago' || tipo !== 'payment' || !dataId) {
        return responder(res, 200, { ok: true, ignorado: true });
    }
    if (!firmaValida(req, dataId)) {
        await registrarEvento('webhook-firma-invalida', null, { tipo, dataId });
        return responder(res, 401, { error: 'Firma inválida' });
    }

    const pago = await obtenerPago(dataId);
    const reservaId = pago.external_reference;
    await registrarEvento('webhook', reservaId, {
        id: pago.id, status: pago.status, detalle: pago.status_detail, monto: pago.transaction_amount, metodo: pago.payment_method_id
    });

    if (pago.status === 'approved' && reservaId) {
        const r = await reservaPorId(reservaId);
        if (!r) return { ok: true, sinReserva: true };
        if (Number(pago.transaction_amount) + 0.01 < Number(r.monto_senia)) {
            await registrarEvento('monto-insuficiente', r.id, { pagado: pago.transaction_amount, esperado: r.monto_senia });
            return { ok: true, montoInsuficiente: true };
        }
        const resultado = await rpc('confirmar_pago', { p_id: r.id, p_payment_id: String(pago.id), p_pago_estado: 'aprobado' });
        return { ok: true, resultado: resultado.resultado };
    }
    if (['refunded', 'charged_back'].includes(pago.status) && reservaId) {
        const r = await reservaPorId(reservaId);
        if (r && r.estado !== 'confirmada' && r.pago_estado !== 'reembolsado') {
            await actualizarReserva(r.id, { pago_estado: 'reembolsado' });
        }
    }
    return { ok: true };
});
