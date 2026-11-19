// POST /api/cancelar — cancela una reserva y, si corresponde, devuelve la seña por Mercado Pago.
// Puede cancelar: el cliente (con su sesión o con el enlace de su reserva) dentro del plazo,
// o el personal del complejo en cualquier momento (eligiendo si se devuelve la seña).
import { manejador, leerCuerpo, tokenBearer, ErrorUsuario } from './_lib/http.js';
import { reservaPorId, actualizarReserva, usuarioDesdeToken, ajustes, registrarEvento, publica } from './_lib/supabase.js';
import { modoPago, reembolsar } from './_lib/mercadopago.js';

const AR = -3 * 3600000;
const inicioTurno = (r) => Date.parse(`${r.fecha}T${String(r.hora_inicio).padStart(2, '0')}:00:00Z`) - AR;

export default manejador(['POST'], async (req) => {
    const b = await leerCuerpo(req);
    const r = await reservaPorId(b.id);
    if (!r) throw new ErrorUsuario('Reserva no encontrada.', 404);

    const usuario = await usuarioDesdeToken(tokenBearer(req));
    const staff = ['empleado', 'duenio'].includes(usuario?.rol);
    const duenioDeLaReserva = (usuario && r.usuario_id === usuario.id) || (b.token && b.token === r.token);
    if (!staff && !duenioDeLaReserva) throw new ErrorUsuario('No tenés permisos para cancelar esta reserva.', 403);
    if (!['confirmada', 'pendiente_pago'].includes(r.estado)) throw new ErrorUsuario('Esta reserva ya no se puede cancelar.');

    const cfg = await ajustes();
    const limite = Number(cfg.limiteHorasCancelacion ?? 3);
    const horasRestantes = (inicioTurno(r) - Date.now()) / 3600000;
    if (!staff && horasRestantes <= 0) throw new ErrorUsuario('El turno ya empezó.');
    if (!staff && r.estado === 'confirmada' && horasRestantes < limite) {
        throw new ErrorUsuario(`Solo se puede cancelar hasta ${limite} horas antes del turno. Escribinos por WhatsApp.`);
    }

    // ¿Se devuelve la seña?
    const pagada = ['aprobado', 'demo'].includes(r.pago_estado);
    const devolver = pagada && (staff ? b.reembolsar !== false : cfg.politicaReembolso !== 'sin_reembolso');
    let pagoEstado = r.pago_estado;
    let aviso = null;

    if (pagada && !devolver) pagoEstado = 'sin_reembolso';
    if (devolver) {
        if (r.pago_estado === 'demo' || modoPago() === 'demo') {
            pagoEstado = 'reembolsado';
        } else {
            try {
                const devolucion = await reembolsar(r.mp_payment_id);
                await registrarEvento('reembolso', r.id, { id: devolucion?.id, status: devolucion?.status, monto: devolucion?.amount });
                pagoEstado = 'reembolsado';
            } catch (error) {
                console.error('Falló la devolución en Mercado Pago', error);
                await registrarEvento('reembolso-fallido', r.id, { error: String(error.message).slice(0, 500) });
                pagoEstado = 'reembolso_pendiente';
                aviso = 'La reserva se canceló, pero la devolución automática falló. El complejo la va a hacer a mano.';
            }
        }
    }

    const motivo = staff && !duenioDeLaReserva
        ? `Cancelada por el complejo${b.motivo ? `: ${String(b.motivo).slice(0, 140)}` : ''}`
        : 'Cancelada por el cliente';
    const actualizada = await actualizarReserva(r.id, {
        estado: 'cancelada', motivo, cancelada_en: new Date().toISOString(), pago_estado: pagoEstado, vence_en: null
    });

    return {
        reserva: publica(actualizada),
        devuelta: pagoEstado === 'reembolsado',
        mensaje: aviso || (pagoEstado === 'reembolsado'
            ? 'Reserva cancelada. La seña se devuelve al mismo medio de pago (puede tardar unos días en verse).'
            : 'Reserva cancelada. El horario quedó libre.')
    };
});
