// js/utils.js - Utilidades compartidas: hora argentina, formato, seguridad básica.
//
// HORA: todo el sistema trabaja en hora de Argentina (UTC-3, sin horario de verano),
// sin importar la zona ni el reloj del celular de quien entra. Se usan fechas "de pared":
// objetos Date cuyos campos UTC (getUTCHours, etc.) son la hora argentina.

const Utils = (() => {
    const OFFSET_AR = -3 * 3600000;
    const pad = (n) => String(n).padStart(2, '0');
    const MAPA_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

    const esc = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => MAPA_HTML[c]);
    const capitalizar = (t) => t.charAt(0).toUpperCase() + t.slice(1);
    const digitos = (t) => String(t ?? '').replace(/\D/g, '');

    // ---------- Tiempo ----------
    const ahora = () => new Date(Date.now() + OFFSET_AR);                       // pared AR
    const deInstante = (iso) => new Date(Date.parse(iso) + OFFSET_AR);          // timestamptz -> pared AR
    const aInstante = (pared) => new Date(pared.getTime() - OFFSET_AR);         // pared AR -> instante real

    const fechaISO = (d = ahora()) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const hoyISO = () => fechaISO(ahora());

    function crearFecha(iso, hora = 0) {
        const [y, m, d] = String(iso).split('-').map(Number);
        const h = typeof hora === 'number' ? hora : Number(String(hora).split(':')[0]) || 0;
        return new Date(Date.UTC(y, m - 1, d, h, 0, 0));
    }

    function sumarDias(iso, n) {
        const d = crearFecha(iso);
        d.setUTCDate(d.getUTCDate() + n);
        return fechaISO(d);
    }

    const diferenciaDias = (a, b) => Math.round((crearFecha(b) - crearFecha(a)) / 86400000);
    const diaSemana = (iso) => crearFecha(iso).getUTCDay(); // 0 = domingo
    const esFechaValida = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && fechaISO(crearFecha(iso)) === iso;

    const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

    const fmt = (iso, opciones) => crearFecha(iso).toLocaleDateString('es-AR', { ...opciones, timeZone: 'UTC' });
    const fechaCorta = (iso) => capitalizar(fmt(iso, { weekday: 'short', day: 'numeric', month: 'numeric' }).replace('.', ''));
    const fechaLarga = (iso) => capitalizar(fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' }));
    const fechaMedia = (iso) => capitalizar(fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, ''));

    function fechaAmigable(iso) {
        const dif = diferenciaDias(hoyISO(), iso);
        if (dif === 0) return 'Hoy';
        if (dif === 1) return 'Mañana';
        if (dif === -1) return 'Ayer';
        return fechaLarga(iso);
    }

    const hhmm = (h) => `${pad(h)}:00`;
    const horaDe = (pared) => `${pad(pared.getUTCHours())}:${pad(pared.getUTCMinutes())}`;

    // ---------- Formato ----------
    const moneda = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;
    const numero = (n) => Math.round(Number(n) || 0).toLocaleString('es-AR');

    function nombreCorto(nombre) {
        const partes = String(nombre || 'Cliente').trim().split(/\s+/);
        return partes.length > 1 ? `${partes[0]} ${partes[1].charAt(0).toUpperCase()}.` : partes[0];
    }

    function iniciales(nombre) {
        const p = String(nombre || '?').trim().split(/\s+/);
        return (p[0].charAt(0) + (p[1] ? p[1].charAt(0) : '')).toUpperCase();
    }

    // Normaliza teléfonos argentinos para wa.me (54 9 + número sin 0 ni 15)
    function telefonoWhatsapp(tel) {
        let d = digitos(tel).replace(/^0+/, '');
        if (!d) return '';
        if (d.startsWith('549')) return d;
        if (d.startsWith('54')) d = d.slice(2);
        return `549${d}`;
    }

    function linkWhatsApp(tel, texto = '') {
        const numero = telefonoWhatsapp(tel);
        if (!numero) return '';
        return `https://wa.me/${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
    }

    const linkCompartir = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`;

    // Clave para agrupar clientes por teléfono (últimos 10 dígitos)
    const claveTelefono = (tel) => digitos(tel).replace(/^0+/, '').replace(/^549?/, '').slice(-10);

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
    const csv = (filas) => '﻿' + filas.map((f) => f.map(csvCelda).join(';')).join('\r\n');

    // localStorage con tolerancia a fallos (modo incógnito, almacenamiento bloqueado)
    const local = {
        leer(clave, defecto) {
            try { const v = localStorage.getItem(clave); return v === null ? defecto : JSON.parse(v); } catch (_) { return defecto; }
        },
        guardar(clave, valor) {
            try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (_) { /* opcional */ }
        }
    };

    function debounce(fn, ms = 250) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }

    return {
        pad, esc, capitalizar, digitos,
        ahora, deInstante, aInstante, fechaISO, hoyISO, crearFecha, sumarDias, diferenciaDias, diaSemana, esFechaValida,
        DIAS, DIAS_CORTOS, fechaCorta, fechaLarga, fechaMedia, fechaAmigable, hhmm, horaDe,
        moneda, numero, nombreCorto, iniciales, telefonoWhatsapp, linkWhatsApp, linkCompartir, claveTelefono,
        esperar, copiar, descargar, csv, local, debounce
    };
})();
