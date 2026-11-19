// js/booking.js - Reglas de negocio del lado del cliente: disponibilidad, precios y estados.
// La validación definitiva (y la regla anti-reservas-dobles) la hace la base de datos.

const Booking = (() => {
    // ---------- Estados ----------
    const ESTADOS = {
        confirmada: { texto: 'Confirmada', clase: 'badge-activa' },
        jugada: { texto: 'Jugada', clase: 'badge-completada' },
        pendiente_pago: { texto: 'Esperando pago', clase: 'badge-pendiente' },
        cancelada: { texto: 'Cancelada', clase: 'badge-cancelada' },
        vencida: { texto: 'Pago vencido', clase: 'badge-cancelada' }
    };
    const METODOS = { mercadopago: 'Mercado Pago', transferencia: 'Transferencia', manual: 'Mostrador', fijo: 'Turno fijo' };
    const PAGOS = {
        pendiente: 'Pago pendiente', aprobado: 'Seña pagada (Mercado Pago)', demo: 'Seña pagada (demostración)',
        en_cancha: 'Se paga en la cancha', manual: 'Cargada en el mostrador', confirmado_admin: 'Transferencia confirmada',
        reembolsado: 'Seña devuelta', reembolso_pendiente: 'Devolución pendiente', sin_reembolso: 'Seña no devuelta'
    };

    const inicio = (r) => Utils.crearFecha(r.fecha, r.hora_inicio);
    const fin = (r) => Utils.crearFecha(r.fecha, r.hora_inicio + r.horas);
    const rango = (r) => `${Utils.hhmm(r.hora_inicio)} a ${Utils.hhmm((r.hora_inicio + r.horas) % 24)} hs`;
    const terminada = (r) => fin(r) <= Utils.ahora();

    // Estado "visible": una confirmada que ya terminó se muestra como jugada.
    const estadoVisible = (r) => (r.estado === 'confirmada' && terminada(r) ? 'jugada' : r.estado);
    const etiqueta = (r) => ESTADOS[estadoVisible(r)] || { texto: r.estado, clase: '' };
    const senaPagada = (r) => ['aprobado', 'demo', 'confirmado_admin'].includes(r.pago_estado);
    const saldo = (r) => Math.max(0, (r.precio_total || 0) - (senaPagada(r) || r.metodo_pago === 'manual' ? r.monto_senia || 0 : 0));
    const vigente = (r) => ['confirmada', 'pendiente_pago'].includes(r.estado) && !terminada(r);

    // ---------- Disponibilidad ----------
    // ctx = { ocupacion: [...filas de la función ocupacion()], cerradas: Set, ahora }
    async function cargarContexto(desde, hasta) {
        const [ocupacion, cerradas] = await Promise.all([
            Db.rpc('ocupacion', { p_desde: desde, p_hasta: hasta }),
            Db.q(Db.sb.from('fechas_cerradas').select('fecha, motivo').gte('fecha', desde).lte('fecha', hasta))
        ]);
        return {
            ocupacion,
            cerradas: new Map(cerradas.map((c) => [c.fecha, c.motivo || ''])),
            ahora: Utils.ahora()
        };
    }

    // Devuelve la fila que ocupa esa hora (o null)
    const ocupante = (ctx, canchaId, fecha, hora) => ctx.ocupacion.find((o) =>
        o.cancha_id === canchaId && o.fecha === fecha && hora >= o.hora_inicio && hora < o.hora_inicio + o.horas) || null;

    // 'libre' | 'ocupado' | 'fijo' | 'reservando' | 'vencido' | 'cerrado'
    function estadoHora(ctx, canchaId, fecha, hora) {
        if (ctx.cerradas.has(fecha)) return 'cerrado';
        const o = ocupante(ctx, canchaId, fecha, hora);
        if (o) return o.estado === 'pendiente_pago' ? 'reservando' : o.fijo ? 'fijo' : 'ocupado';
        const limite = Utils.crearFecha(fecha, hora);
        limite.setUTCMinutes(limite.getUTCMinutes() + Config.get().toleranciaMinutos);
        return ctx.ahora > limite ? 'vencido' : 'libre';
    }

    function horasConsecutivas(hora, cantidad) {
        const lista = Config.horarios();
        const i = lista.indexOf(hora);
        if (i === -1) return null;
        const tramo = lista.slice(i, i + cantidad);
        return tramo.length === cantidad ? tramo : null;
    }

    function calcularPrecio(cancha, horas) {
        const cfg = Config.get();
        let total = cancha.precioHora * horas;
        let descuento = 0;
        if (cfg.descuentoActivo && horas >= 2) descuento = Math.round(cancha.precioHora * cfg.descuentoSegundaHora / 100);
        total -= descuento;
        const senia = Math.min(cfg.montoSenia, total);
        return { total, descuento, senia, saldo: total - senia };
    }

    function validarSeleccion(ctx, { canchaId, fecha, hora, horas = 1 }) {
        const cfg = Config.get();
        const cancha = Config.canchaPorId(canchaId);
        if (!cancha || !cancha.activa) return { ok: false, mensaje: 'La cancha elegida no está disponible.' };
        if (ctx.cerradas.has(fecha)) return { ok: false, mensaje: 'El complejo está cerrado ese día.' };
        if (hora === null || hora === undefined) return { ok: false, mensaje: 'Elegí un horario.' };
        if (horas < 1 || horas > cfg.maxHorasReserva) return { ok: false, mensaje: `Se pueden reservar entre 1 y ${cfg.maxHorasReserva} horas seguidas.` };
        const tramo = horasConsecutivas(hora, horas);
        if (!tramo) return { ok: false, mensaje: 'El turno se pasa del horario de cierre.' };
        for (const h of tramo) {
            const e = estadoHora(ctx, canchaId, fecha, h);
            if (e === 'vencido') return { ok: false, mensaje: `Las ${Utils.hhmm(h)} ya pasaron.` };
            if (e !== 'libre') return { ok: false, mensaje: `Las ${Utils.hhmm(h)} ya están ocupadas.` };
        }
        return { ok: true, cancha, tramo };
    }

    // ¿El cliente puede cancelar por su cuenta? (el servidor vuelve a controlarlo)
    function puedeCancelar(r) {
        if (!vigente(r)) return { ok: false, motivo: 'Esta reserva ya no se puede cancelar.' };
        if (r.estado === 'pendiente_pago') return { ok: true };
        const limite = Config.get().limiteHorasCancelacion;
        const horas = (inicio(r) - Utils.ahora()) / 3600000;
        if (horas < limite) return { ok: false, motivo: `Solo se puede cancelar hasta ${limite} horas antes del turno.` };
        return { ok: true };
    }

    // ---------- Reservas guardadas en este dispositivo (para quien reserva sin cuenta) ----------
    const CLAVE_LOCAL = 'misReservas';
    function recordar(id, token) {
        const lista = Utils.local.leer(CLAVE_LOCAL, []).filter((x) => x.id !== id);
        lista.unshift({ id, token, guardada: Date.now() });
        Utils.local.guardar(CLAVE_LOCAL, lista.slice(0, 30));
    }
    const recordadas = () => Utils.local.leer(CLAVE_LOCAL, []);
    async function cargarRecordadas() {
        const lista = recordadas();
        const filas = await Promise.all(lista.map((x) => Db.rpc('ver_reserva', { p_id: x.id, p_token: x.token })
            .then((r) => (r ? { ...r, token: x.token } : null)).catch(() => null)));
        return filas.filter(Boolean);
    }

    const linkReserva = (r, token = r.token) => `reserva.html?id=${encodeURIComponent(r.id)}&t=${encodeURIComponent(token)}`;

    // Enlace para agendar el turno en Google Calendar
    function linkCalendario(r) {
        const cfg = Config.get();
        const f = (d) => Utils.aInstante(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const p = new URLSearchParams({
            action: 'TEMPLATE',
            text: `${r.cancha_nombre} · ${cfg.nombreComplejo}`,
            dates: `${f(inicio(r))}/${f(fin(r))}`,
            details: `Reserva ${r.codigo}. Resto a pagar en la cancha: ${Utils.moneda(saldo(r))}.`,
            location: cfg.direccion || cfg.nombreComplejo
        });
        return `https://calendar.google.com/calendar/render?${p}`;
    }

    return {
        ESTADOS, METODOS, PAGOS, inicio, fin, rango, terminada, estadoVisible, etiqueta, senaPagada, saldo, vigente,
        cargarContexto, ocupante, estadoHora, horasConsecutivas, calcularPrecio, validarSeleccion, puedeCancelar,
        recordar, recordadas, cargarRecordadas, linkReserva, linkCalendario
    };
})();
