// GET /api/estado — informa cómo se cobra (Mercado Pago real o demostración).
import { manejador } from './_lib/http.js';
import { modoPago, esPrueba } from './_lib/mercadopago.js';

export default manejador(['GET'], async () => ({
    modoPago: modoPago(),
    credencialesDePrueba: modoPago() === 'mercadopago' && esPrueba(),
    servidor: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}));
