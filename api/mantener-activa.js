// GET /api/mantener-activa — Vercel la ejecuta una vez por día (ver "crons" en vercel.json).
// Hace una consulta mínima para que el plan gratis de Supabase nunca pause la base por inactividad.
// También vence turnos impagos, por si la tarea interna de la base estuviera detenida.
import { manejador } from './_lib/http.js';
import { ajustes, rpc } from './_lib/supabase.js';

export default manejador(['GET'], async () => {
    const cfg = await ajustes();
    const vencidas = await rpc('vencer_pendientes').catch(() => null);
    return { ok: true, complejo: cfg.nombreComplejo || null, vencidas, hora: new Date().toISOString() };
});
