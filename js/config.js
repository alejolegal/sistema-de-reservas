// js/config.js - Configuración del complejo (editable desde el panel de gestión).
// IMPORTANTE: acá NO hay credenciales. Los tokens de Mercado Pago deben vivir
// únicamente en un servidor (variables de entorno), nunca en el navegador.

const CONFIG_DEFAULT = Object.freeze({
    nombreComplejo: 'Un Show Más',
    moneda: '$',
    montoSenia: 5000,
    descuentoActivo: true,
    descuentoSegundaHora: 50,
    limiteHorasCancelacion: 3,
    minutosRetencionTransferencia: 30,
    puntosPorHora: 10,
    horaApertura: 9,        // primer turno empieza a esta hora
    horaCierre: 24,         // el último turno termina a esta hora (24 = medianoche)
    toleranciaMinutos: 25,  // se puede reservar un turno hasta X min después de iniciado
    diasAnticipacion: 7,    // cuántos días hacia adelante se puede reservar
    maxHorasReserva: 2,
    whatsapp: '5491122334455',
    alias: 'UN.SHOW.MAS.MP',
    pagoMercadoPago: true,
    pagoTransferencia: true,
    modoPruebaPago: true,   // mientras no haya integración real con Mercado Pago
    canchas: [
        { id: 'f5', nombre: 'Cancha de Fútbol 5', tipo: 'Fútbol 5', precioHora: 25000, activa: true },
        { id: 'f7', nombre: 'Cancha de Fútbol 7', tipo: 'Fútbol 7', precioHora: 35000, activa: true },
        { id: 'padel', nombre: 'Cancha de Pádel', tipo: 'Pádel', precioHora: 18000, activa: true }
    ]
});

const Config = (() => {
    let actual = null;

    const aBool = (v) => v === true || String(v) === 'true';
    const aNum = (v, defecto, min = 0) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= min ? n : defecto;
    };
    const aEntero = (v, defecto, min = 0, max = Infinity) =>
        Math.min(max, Math.max(min, Math.floor(aNum(v, defecto, min))));

    // Valida y completa cualquier configuración (guardada, importada o parcial).
    function normalizar(c = {}) {
        const d = CONFIG_DEFAULT;
        const apertura = aEntero(c.horaApertura, d.horaApertura, 0, 23);
        const cierre = aEntero(c.horaCierre, d.horaCierre, apertura + 1, 24);
        const origen = Array.isArray(c.canchas) && c.canchas.length ? c.canchas : d.canchas;

        const canchas = origen.map((x) => ({
            id: String(x.id),
            nombre: String(x.nombre || 'Cancha').trim(),
            tipo: String(x.tipo || '').trim(),
            precioHora: aNum(x.precioHora, 0),
            activa: x.activa === undefined ? true : aBool(x.activa)
        }));

        // El nombre largo era el valor por defecto de versiones anteriores.
        const nombreGuardado = String(c.nombreComplejo || '').trim();
        const nombre = nombreGuardado && nombreGuardado !== 'Complejo Deportivo Un Show Más'
            ? nombreGuardado : d.nombreComplejo;

        return {
            nombreComplejo: nombre,
            moneda: String(c.moneda || d.moneda).trim().slice(0, 4),
            montoSenia: aNum(c.montoSenia, d.montoSenia),
            descuentoActivo: c.descuentoActivo === undefined ? d.descuentoActivo : aBool(c.descuentoActivo),
            descuentoSegundaHora: aNum(c.descuentoSegundaHora, d.descuentoSegundaHora) > 100
                ? 100 : aNum(c.descuentoSegundaHora, d.descuentoSegundaHora),
            limiteHorasCancelacion: aNum(c.limiteHorasCancelacion, d.limiteHorasCancelacion),
            minutosRetencionTransferencia: aEntero(c.minutosRetencionTransferencia, d.minutosRetencionTransferencia, 5, 1440),
            puntosPorHora: aNum(c.puntosPorHora ?? c.puntosPorReserva, d.puntosPorHora),
            horaApertura: apertura,
            horaCierre: cierre,
            toleranciaMinutos: aEntero(c.toleranciaMinutos, d.toleranciaMinutos, 0, 59),
            diasAnticipacion: aEntero(c.diasAnticipacion, d.diasAnticipacion, 1, 60),
            maxHorasReserva: aEntero(c.maxHorasReserva, d.maxHorasReserva, 1, 4),
            whatsapp: String(c.whatsapp ?? d.whatsapp).replace(/\D/g, ''),
            alias: String(c.alias ?? d.alias).trim(),
            pagoMercadoPago: c.pagoMercadoPago === undefined ? d.pagoMercadoPago : aBool(c.pagoMercadoPago),
            pagoTransferencia: c.pagoTransferencia === undefined ? d.pagoTransferencia : aBool(c.pagoTransferencia),
            modoPruebaPago: c.modoPruebaPago === undefined ? d.modoPruebaPago : aBool(c.modoPruebaPago),
            canchas
        };
    }

    function cargar() {
        // Se descarta cualquier credencial que versiones anteriores hayan guardado (mpAccessToken).
        actual = normalizar(Store.leer(Store.CLAVES.config, {}));
        Store.guardar(Store.CLAVES.config, actual);
    }

    function get() {
        if (!actual) cargar();
        return actual;
    }

    function guardar(parcial) {
        actual = normalizar({ ...get(), ...parcial });
        Store.guardar(Store.CLAVES.config, actual);
        return actual;
    }

    function restablecer() {
        actual = normalizar({});
        Store.guardar(Store.CLAVES.config, actual);
        return actual;
    }

    const horarios = () => {
        const { horaApertura, horaCierre } = get();
        const lista = [];
        for (let h = horaApertura; h < horaCierre; h++) lista.push(`${String(h).padStart(2, '0')}:00`);
        return lista;
    };

    const canchaPorId = (id) => get().canchas.find((c) => c.id === id) || null;
    const canchasActivas = () => get().canchas.filter((c) => c.activa);

    function nuevoIdCancha(nombre) {
        const base = String(nombre || 'cancha').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cancha';
        let id = base;
        let n = 2;
        while (get().canchas.some((c) => c.id === id)) id = `${base}-${n++}`;
        return id;
    }

    return { get, guardar, restablecer, horarios, canchaPorId, canchasActivas, nuevoIdCancha, recargar: cargar };
})();
