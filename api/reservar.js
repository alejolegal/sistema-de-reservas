// POST /api/reservar — crea la reserva (bloquea el horario) e inicia el cobro de la seña.
import { manejador, leerCuerpo, ipCliente, tokenBearer, urlSitio, ErrorUsuario } from './_lib/http.js';
import { rpc, actualizarReserva, usuarioDesdeToken, ajustes, publica } from './_lib/supabase.js';
import { modoPago, crearPreferencia } from './_lib/mercadopago.js';

export default manejador(['POST'], async (req) => {
    const b = await leerCuerpo(req);
    const usuario = await usuarioDesdeToken(tokenBearer(req));
    const metodo = b.metodo === 'transferencia' ? 'transferencia' : 'mercadopago';

    const reserva = await rpc('crear_reserva', {
        p: {
            cancha_id: String(b.canchaId || ''),
            fecha: String(b.fecha || ''),
            hora: String(b.hora || ''),
            horas: Number(b.horas) || 1,
            nombre: String(b.nombre || usuario?.nombre || '').slice(0, 80),
            telefono: String(b.telefono || usuario?.telefono || '').slice(0, 20),
            email: String(b.email || usuario?.email || '').slice(0, 120),
            usuario_id: usuario?.id || null,
            metodo,
            ip: ipCliente(req)
        }
    });

    const respuesta = { reserva: publica(reserva), token: reserva.token, pago: { modo: metodo === 'transferencia' ? 'transferencia' : modoPago() } };

    if (metodo === 'mercadopago' && modoPago() === 'mercadopago') {
        try {
            const cfg = await ajustes();
            const pref = await crearPreferencia({ reserva, sitio: urlSitio(req), nombreComplejo: cfg.nombreComplejo || 'Complejo' });
            await actualizarReserva(reserva.id, { mp_preference_id: pref.id, mp_init_point: pref.initPoint });
            respuesta.pago.url = pref.initPoint;
        } catch (error) {
            console.error('No se pudo crear la preferencia de Mercado Pago', error);
            await actualizarReserva(reserva.id, { estado: 'vencida', motivo: 'No se pudo iniciar el pago', cancelada_en: new Date().toISOString() });
            throw new ErrorUsuario('No pudimos conectar con Mercado Pago. Probá de nuevo en un momento.', 502);
        }
    }
    return respuesta;
});
