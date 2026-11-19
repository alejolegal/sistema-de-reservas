# Un Show Más - Sistema de reservas

Sitio estático (HTML + CSS + JavaScript, sin dependencias ni compilación).

## Cómo probarlo
Abrir `index.html` con doble clic, o servir la carpeta: `python3 -m http.server 8000`.
Para publicarlo: subir la carpeta a Vercel / Netlify / GitHub Pages (sin configuración).

## Acceso de administración inicial
- Correo: `admin@complejo.com`
- Contraseña: `admin1234` (el sistema pide cambiarla desde **Mi perfil**)

## Estructura
```
index.html  login.html  perfil.html  admin.html  torneos.html
css/   main.css (base) · components.css (público) · admin.css (panel)
js/    store.js    único acceso a localStorage (se reemplaza al migrar a Supabase)
       config.js   parámetros editables del complejo (sin credenciales)
       utils.js    fechas locales, formato, escape HTML, hash
       auth.js     registro, ingreso, roles, perfil
       booking.js  reglas de negocio (disponibilidad, precios, cancelación, puntos)
       ui.js       encabezado, modales, avisos
       app.js · login.js · perfil.js · admin.js   lógica de cada página
assets/logo-mark.svg   logo original
```

## Limitaciones conocidas (próximas etapas)
1. Los datos viven en el navegador: no se comparten entre dispositivos. Migrar a Supabase (reemplazar `store.js`).
2. El pago con Mercado Pago es una **simulación** (modo prueba). El cobro real requiere un servidor con el Access Token
   en variables de entorno (Vercel Function / Supabase Edge Function) y un webhook de confirmación.
3. La seguridad de roles es solo de interfaz hasta contar con backend (Supabase Auth + RLS).
4. **Revocar el Access Token de Mercado Pago que estuvo publicado en el repositorio anterior.**
