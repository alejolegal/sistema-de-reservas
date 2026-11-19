// js/config.js - Configuración del complejo (se edita desde el panel y vive en la base).
// Acá NO hay credenciales: los tokens de Mercado Pago están solo en el servidor (Vercel).

const CONFIG_DEFAULT = Object.freeze({
    nombreComplejo: 'Un Show Más',
    montoSenia: 5000,
    descuentoActivo: true,
    descuentoSegundaHora: 50,
    limiteHorasCancelacion: 3,
    politicaReembolso: 'reembolso',   // 'reembolso' | 'sin_reembolso'
    minutosRetencionMP: 15,
    minutosRetencionTransferencia: 30,
    puntosPorHora: 10,
    horaApertura: 9,
    horaCierre: 24,
    toleranciaMinutos: 25,
    diasAnticipacion: 7,
    maxHorasReserva: 2,
    whatsapp: '',
    alias: '',
    direccion: '',
    instagram: '',
    avisoPublico: '',
    mostrarNombres: true,
    pagoMercadoPago: true,
    pagoTransferencia: false
});

const Config = (() => {
    let actual = { ...CONFIG_DEFAULT, canchas: [] };
    let todasLasCanchas = [];
    let estadoServidor = { modoPago: 'desconocido', servidor: false };

    const aBool = (v, d) => (v === undefined || v === null ? d : v === true || String(v) === 'true');
    const aNum = (v, d, min = 0, max = Infinity) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
    };
    const aEntero = (v, d, min = 0, max = Infinity) => Math.floor(aNum(v, d, min, max));

    function normalizar(c = {}) {
        const d = CONFIG_DEFAULT;
        const apertura = aEntero(c.horaApertura, d.horaApertura, 0, 23);
        return {
            nombreComplejo: String(c.nombreComplejo || d.nombreComplejo).trim().slice(0, 40),
            montoSenia: aEntero(c.montoSenia, d.montoSenia, 0),
            descuentoActivo: aBool(c.descuentoActivo, d.descuentoActivo),
            descuentoSegundaHora: aNum(c.descuentoSegundaHora, d.descuentoSegundaHora, 0, 100),
            limiteHorasCancelacion: aNum(c.limiteHorasCancelacion, d.limiteHorasCancelacion, 0, 168),
            politicaReembolso: c.politicaReembolso === 'sin_reembolso' ? 'sin_reembolso' : 'reembolso',
            minutosRetencionMP: aEntero(c.minutosRetencionMP, d.minutosRetencionMP, 5, 60),
            minutosRetencionTransferencia: aEntero(c.minutosRetencionTransferencia, d.minutosRetencionTransferencia, 5, 1440),
            puntosPorHora: aEntero(c.puntosPorHora, d.puntosPorHora, 0),
            horaApertura: apertura,
            horaCierre: aEntero(c.horaCierre, d.horaCierre, apertura + 1, 24),
            toleranciaMinutos: aEntero(c.toleranciaMinutos, d.toleranciaMinutos, 0, 59),
            diasAnticipacion: aEntero(c.diasAnticipacion, d.diasAnticipacion, 1, 60),
            maxHorasReserva: aEntero(c.maxHorasReserva, d.maxHorasReserva, 1, 4),
            whatsapp: Utils.digitos(c.whatsapp ?? d.whatsapp),
            alias: String(c.alias ?? d.alias).trim(),
            direccion: String(c.direccion ?? '').trim().slice(0, 120),
            instagram: String(c.instagram ?? '').trim().replace(/^@/, '').slice(0, 40),
            avisoPublico: String(c.avisoPublico ?? '').trim().slice(0, 280),
            mostrarNombres: aBool(c.mostrarNombres, d.mostrarNombres),
            pagoMercadoPago: aBool(c.pagoMercadoPago, d.pagoMercadoPago),
            pagoTransferencia: aBool(c.pagoTransferencia, d.pagoTransferencia)
        };
    }

    const canchaDesdeFila = (f) => ({
        id: f.id, nombre: f.nombre, tipo: f.tipo || '', precioHora: Number(f.precio_hora) || 0,
        activa: !!f.activa, archivada: !!f.archivada, orden: f.orden || 0
    });

    async function cargar() {
        const [ajustes, canchas] = await Promise.all([
            Db.q(Db.sb.from('ajustes').select('datos').eq('id', 1).maybeSingle()),
            Db.q(Db.sb.from('canchas').select('*').order('orden').order('nombre'))
        ]);
        todasLasCanchas = canchas.map(canchaDesdeFila);
        actual = { ...normalizar(ajustes?.datos || {}), canchas: todasLasCanchas.filter((c) => !c.archivada) };
        return actual;
    }

    async function cargarEstadoServidor() {
        try {
            const res = await fetch('/api/estado', { cache: 'no-store' });
            estadoServidor = res.ok ? await res.json() : { modoPago: 'sin_servidor', servidor: false };
        } catch (_) {
            estadoServidor = { modoPago: 'sin_servidor', servidor: false };
        }
        return estadoServidor;
    }

    // Guarda cambios de ajustes (solo el dueño, lo controla la base)
    async function guardar(parcial) {
        const { canchas, ...resto } = actual;
        const datos = normalizar({ ...resto, ...parcial });
        await Db.q(Db.sb.from('ajustes').update({ datos, actualizado: new Date().toISOString() }).eq('id', 1));
        actual = { ...datos, canchas };
        return actual;
    }

    const get = () => actual;
    const horarios = () => {
        const lista = [];
        for (let h = actual.horaApertura; h < actual.horaCierre; h++) lista.push(h);
        return lista;
    };
    const canchaPorId = (id) => todasLasCanchas.find((c) => c.id === id) || null;
    const canchasActivas = () => actual.canchas.filter((c) => c.activa);

    function nuevoIdCancha(nombre) {
        const base = String(nombre || 'cancha').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cancha';
        let id = base;
        let n = 2;
        while (todasLasCanchas.some((c) => c.id === id)) id = `${base}-${n++}`;
        return id;
    }

    return {
        DEFAULT: CONFIG_DEFAULT, normalizar, cargar, cargarEstadoServidor, guardar, get, horarios, canchaPorId,
        canchasActivas, nuevoIdCancha, todas: () => todasLasCanchas, servidor: () => estadoServidor
    };
})();
