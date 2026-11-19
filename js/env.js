// js/env.js - Conexión pública con Supabase.
// La "anon key" es PÚBLICA por diseño: la seguridad la dan las reglas (RLS) de la base.
// Las claves secretas (Supabase service role, Mercado Pago) viven solo en Vercel.
window.ENV = Object.freeze({
    SUPABASE_URL: 'https://uqmxigfvjnoidcxkubhy.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxbXhpZ2Z2am5vaWRjeGt1Ymh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMjMyMjcsImV4cCI6MjExMDY5OTIyN30.f43fzTIale6kpmdvb3VDluEtFCDDtCoFrKB00H8cP6U'
});
