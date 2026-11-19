// js/utils.js - Utilidades compartidas (fechas locales, formato, seguridad básica).

const Utils = (() => {
    const pad = (n) => String(n).padStart(2, '0');
    const MAPA_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

    // Escapa texto antes de insertarlo en HTML (previene XSS con nombres de usuarios).
    const esc = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => MAPA_HTML[c]);
    const capitalizar = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    const digitos = (t) => String(t ?? '').replace(/\D/g, '');

    // Fechas en HORA LOCAL (toISOString usa UTC y en Argentina "adelanta" el día desde las 21 hs).
    function fechaISO(d = new Date()) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function crearFecha(iso, hhmm = '00:00') {
        const [y, m, d] = String(iso).split('-').map(Number);
        const [h, mi] = String(hhmm).split(':').map(Number);
        return new Date(y, m - 1, d, h || 0, mi || 0, 0, 0);
    }

    function sumarDias(iso, n) {
        const d = crearFecha(iso);
        d.setDate(d.getDate() + n);
        return fechaISO(d);
    }

    const hoyISO = () => fechaISO(new Date());

    function esFechaValida(iso) {
        return /^\d{4}-\d{2}-\d{2}$/.test(iso) && fechaISO(crearFecha(iso)) === iso;
    }

    function fechaCorta(iso) {
        const t = crearFecha(iso).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' });
        return capitalizar(t.replace('.', ''));
    }

    function fechaLarga(iso) {
        return capitalizar(crearFecha(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }));
    }

    const horaLocal = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    function moneda(n) {
        return `${Config.get().moneda} ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
    }

    // "Juan Pérez" -> "Juan P." (no se expone el nombre completo de otros clientes)
    function nombreCorto(nombre) {
        const partes = String(nombre || 'Cliente').trim().split(/\s+/);
        return partes.length > 1 ? `${partes[0]} ${partes[1].charAt(0).toUpperCase()}.` : partes[0];
    }

    const uid = (prefijo) => `${prefijo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

    // Normaliza teléfonos argentinos para wa.me (54 9 + número sin 0 inicial).
    function telefonoWhatsapp(tel) {
        const d = digitos(tel).replace(/^0+/, '');
        if (!d) return '';
        if (d.startsWith('549')) return d;
        if (d.startsWith('54')) return `549${d.slice(2)}`;
        return `549${d}`;
    }

    function linkWhatsApp(tel, texto = '') {
        const numero = telefonoWhatsapp(tel);
        if (!numero) return '';
        return `https://wa.me/${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
    }

    function sal() {
        const bytes = new Uint8Array(16);
        (window.crypto || {}).getRandomValues
            ? window.crypto.getRandomValues(bytes)
            : bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    async function hash(texto) {
        if (window.crypto && window.crypto.subtle) {
            const buffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
            return 'sha256:' + Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
        }
        // Respaldo para navegadores sin Web Crypto (contextos no seguros).
        let h = 2166136261;
        for (let i = 0; i < texto.length; i++) {
            h ^= texto.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return 'fnv:' + (h >>> 0).toString(16);
    }

    const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function copiar(texto) {
        try {
            await navigator.clipboard.writeText(texto);
            return true;
        } catch (error) {
            const campo = document.createElement('textarea');
            campo.value = texto;
            campo.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(campo);
            campo.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (_) { /* sin portapapeles */ }
            campo.remove();
            return ok;
        }
    }

    function descargar(nombre, contenido, mime = 'text/plain') {
        const blob = new Blob([contenido], { type: `${mime};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const csvCelda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    return {
        pad, esc, capitalizar, digitos,
        fechaISO, crearFecha, sumarDias, hoyISO, esFechaValida, fechaCorta, fechaLarga, horaLocal,
        moneda, nombreCorto, uid, telefonoWhatsapp, linkWhatsApp,
        sal, hash, esperar, copiar, descargar, csvCelda
    };
})();
