# Un Show Más · Sistema de reservas de canchas

Reservas online de canchas con **seña por Mercado Pago**, **base de datos en la nube** (Supabase)
y **panel de gestión** para el dueño. Pensado para que cualquiera, aunque no sepa de tecnología,
reserve en un minuto desde el celular.

## Qué hace

**Para los clientes**
- Elegir cancha, día y horario; ver al instante qué está libre (actualizado cada 30 s).
- Reservar **sin crear cuenta** (nombre + WhatsApp) o con cuenta (suma puntos e historial).
- Pagar la seña con **Mercado Pago**; el turno se confirma solo cuando se acredita el pago.
- Comprobante con código, cuenta regresiva para pagar, "Agendar" en Google Calendar,
  "Avisarle al grupo" por WhatsApp, "Cómo llegar" y **cancelación con devolución automática** de la seña.
- "Mis reservas" funciona aun sin cuenta (guarda las reservas hechas desde ese celular).
- Se puede instalar en la pantalla del celular como una app.

**Para el dueño (panel `/admin`)**
- **Grilla del día** (canchas × horarios) que se actualiza **en vivo** cuando alguien reserva.
- Cargar reservas de mostrador/teléfono con un toque sobre el horario libre.
- Registrar el **cobro del resto**, la asistencia ("no vinieron") y notas internas.
- **Turnos fijos semanales**: se reservan solos las próximas 8 semanas (renovación nocturna).
- **Estadísticas**: facturación por día, mapa de calor de ocupación, por cancha, origen de las
  reservas, mejores clientes y comparación con el período anterior.
- **Clientes**: todos los que reservaron (con o sin cuenta), con WhatsApp directo, historial y roles.
- Canchas, precios, horarios, días cerrados, seña, promo 2.ª hora, política de devolución, etc.
- Exportar todo a CSV/Excel o JSON.

## Arquitectura

```
Navegador (HTML + CSS + JS, sin compilación)
   │  lee disponibilidad, inicia sesión ─────────────► Supabase (Postgres + Auth + Realtime)
   │                                                     · RLS: cada uno ve solo lo suyo
   │  reservar / pagar / cancelar ──► Vercel Functions   · restricción anti-superposición
   │                                   (/api, Node)  ──► · pg_cron: vence pendientes y genera turnos fijos
   │                                        │
   └──── checkout ──► Mercado Pago ◄────────┘ (preferencias, webhook, devoluciones)
```

- **La regla anti-reservas-dobles vive en la base** (`EXCLUDE USING gist`): aunque dos personas
  paguen el mismo horario en el mismo segundo, entra una sola.
- Un turno queda "esperando pago" 15 min (configurable). Si no se paga, se libera solo.
- Si un pago llega tarde y el horario ya se ocupó, la reserva queda marcada "seña a devolver"
  y aparece un aviso en el panel.
- Todas las fechas son **hora de Argentina**, sin importar el reloj del celular.

```
index.html        Reservar                 reserva.html  Comprobante (vuelta de Mercado Pago)
perfil.html       Mis reservas / cuenta    login.html    Ingreso y registro
admin.html        Panel de gestión         torneos.html  Próximamente
js/   env.js (conexión pública) · utils.js · db.js · config.js · auth.js · booking.js · ui.js
      app.js · reserva.js · perfil.js · login.js · admin*.js
api/  reservar · pago-demo · verificar-pago · mp-webhook · cancelar · admin-clave · estado
      _lib/ (supabase, mercadopago, http)
supabase/migrations/   esquema SQL completo (tablas, reglas, funciones, tareas automáticas)
vendor/                supabase-js 2.119.0 (copia local, sin CDN)
```

## Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Para qué | Estado |
|---|---|---|
| `SUPABASE_URL` | Dirección del proyecto Supabase | ✅ cargada |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servidor de Supabase (secreta) | ✅ cargada |
| `MP_ACCESS_TOKEN` | Access Token de **producción** de Mercado Pago del complejo | ⏳ falta (ver guía) |
| `MP_WEBHOOK_SECRET` | Opcional: valida la firma de los avisos de Mercado Pago | opcional |
| `SITIO_URL` | Opcional: dominio propio (ej. `https://reservas.unshowmas.com.ar`) | opcional |

Sin `MP_ACCESS_TOKEN` el sistema funciona en **modo demostración**: todo el circuito anda,
pero el pago se simula (con un cartel bien visible). Al cargar el token, pasa a cobrar de verdad.

👉 **Guía paso a paso para conectar Mercado Pago:** [`docs/GUIA-MERCADOPAGO.md`](docs/GUIA-MERCADOPAGO.md)
👉 **Guía de uso para el dueño:** [`docs/GUIA-DUENO.md`](docs/GUIA-DUENO.md)

## Desarrollo local

```bash
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/dev.mjs
```

Abre `http://localhost:3000` (sirve las páginas y las funciones de `/api` igual que Vercel).

## Base de datos desde cero

En un proyecto nuevo de Supabase, ejecutar en orden los archivos de `supabase/migrations/`
(SQL Editor). Después, en *Authentication → Providers → Email*, desactivar "Confirm email"
(o configurar un SMTP propio). Para nombrar al dueño: registrarse en la web y ejecutar

```sql
update perfiles set rol = 'duenio' where email = 'correo-del-dueño@ejemplo.com';
```

## Seguridad

- Las claves secretas (Supabase service role, Mercado Pago) viven **solo** en Vercel.
  La clave `anon` de `js/env.js` es pública por diseño; la protección la da RLS.
- Los clientes no pueden leer reservas ajenas, ni cambiarse el rol o los puntos, ni crear
  reservas sin pasar por el servidor (probado).
- Cada aviso de Mercado Pago se verifica consultando el pago directamente a Mercado Pago.
- ⚠️ **El Access Token de Mercado Pago que estuvo publicado en el repositorio anterior debe
  revocarse** desde el panel de desarrolladores de Mercado Pago (renovar credenciales).
