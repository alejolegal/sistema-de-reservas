// POST /api/pago-demo — SOLO en modo demostración (sin credenciales de Mercado Pago):
// simula un pago aprobado para poder mostrar el circuito completo.
import { manejador, leerCuerpo, ErrorUsuario } from './_lib/http.js';
import { rpc, reservaPorId, publica } from './_lib/supabase.js';
import { modoPago } from './_lib/mercadopago.js';

export default manejador(['POST'], async (req) => {
    if (modoPago() !== 'demo') throw new ErrorUsuario('El modo demostración está desactivado: los pagos son reales.', 403);
    const { id, token } = await leerCuerpo(req);
    const r = await reservaPorId(id);
    if (!r || r.token !== token) throw new ErrorUsuario('Reserva no encontrada.', 404);
    if (r.metodo_pago !== 'mercadopago') throw new ErrorUsuario('Esta reserva no se paga con Mercado Pago.');
    if (r.estado !== 'pendiente_pago') throw new ErrorUsuario(r.estado === 'confirmada' ? 'La reserva ya está pagada.' : 'El plazo para pagar venció. Hacé una nueva reserva.');
    const resultado = await rpc('confirmar_pago', { p_id: r.id, p_payment_id: `DEMO-${r.codigo}`, p_pago_estado: 'demo' });
    return { resultado: resultado.resultado, reserva: publica(resultado.reserva) };
});
