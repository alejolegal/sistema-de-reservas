// POST /api/verificar-pago — al volver de Mercado Pago, consulta el pago por si el aviso
// automático (webhook) todavía no llegó. Así la confirmación es inmediata.
import { manejador, leerCuerpo, ErrorUsuario } from './_lib/http.js';
import { rpc, reservaPorId, registrarEvento, publica } from './_lib/supabase.js';
import { modoPago, pagoAprobadoDeReserva } from './_lib/mercadopago.js';

export default manejador(['POST'], async (req) => {
    const { id, token } = await leerCuerpo(req);
    let r = await reservaPorId(id);
    if (!r || r.token !== token) throw new ErrorUsuario('Reserva no encontrada.', 404);

    const esperandoPago = r.metodo_pago === 'mercadopago' && !r.mp_payment_id && ['pendiente_pago', 'vencida'].includes(r.estado);
    if (esperandoPago && modoPago() === 'mercadopago') {
        const pago = await pagoAprobadoDeReserva(r.id);
        if (pago) {
            await registrarEvento('verificar-pago', r.id, { id: pago.id, status: pago.status, monto: pago.transaction_amount });
            const resultado = await rpc('confirmar_pago', { p_id: r.id, p_payment_id: String(pago.id), p_pago_estado: 'aprobado' });
            r = resultado.reserva;
        }
    }
    return { reserva: publica(r) };
});
