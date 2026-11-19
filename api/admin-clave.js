// POST /api/admin-clave — el dueño asigna una contraseña nueva a un cliente que la olvidó.
import { manejador, leerCuerpo, tokenBearer, ErrorUsuario } from './_lib/http.js';
import { usuarioDesdeToken, perfil, cambiarPasswordUsuario } from './_lib/supabase.js';

export default manejador(['POST'], async (req) => {
    const actor = await usuarioDesdeToken(tokenBearer(req));
    if (actor?.rol !== 'duenio') throw new ErrorUsuario('Solo el dueño puede hacer esto.', 403);
    const { usuarioId, password } = await leerCuerpo(req);
    if (String(password || '').length < 6) throw new ErrorUsuario('La contraseña debe tener al menos 6 caracteres.');
    const destino = await perfil(usuarioId);
    if (!destino) throw new ErrorUsuario('Usuario no encontrado.', 404);
    if (destino.rol === 'duenio' && destino.id !== actor.id) throw new ErrorUsuario('No se puede modificar a otro dueño.', 403);
    await cambiarPasswordUsuario(destino.id, String(password));
    return { ok: true };
});
