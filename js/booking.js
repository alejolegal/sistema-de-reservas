// js/booking.js - Reglas de negocio de las reservas.
// Toda la validación vive acá (no solo en la interfaz): disponibilidad, fechas cerradas,
// horarios, cancelaciones, retención de transferencias y puntos.

const Booking = (() => {
    const ESTADOS_OCUPAN = ['activa', 'pendiente_pago'];
    const ESTADOS_VIGENTES = ESTADOS_OCUPAN;

    const fallo = (mensaje) => ({ ok: false, mensaje });

    // ---------- Normalización y estados automáticos ----------

    // Convierte reservas de versiones anteriores ("15:00 y 16:00") al formato actual (horas: [...]).
    function normalizar(r) {
        let migrada = false;
        if (!Array.isArray(r.horas) || r.horas.length === 0) {
            r.horas = String(r.horaInicio || '')
                .split(/\s+y\s+/i)
                .map((h) => h.replace(/\s*hs\.?$/i, '').trim())
                .filter(Boolean);
            migrada = true;
        }
        r.horaInicio = r.horas[0] || '';
        r.cantidadHoras = r.horas.length || 1;
        r.puntosOtorgados = Number(r.puntosOtorgados) || 0;
        r.montoSenia = Number(r.montoSenia) || 0;
        r.precioTotal = Number(r.precioTotal) || 0;
        return migrada;
    }

    const inicio = (r) => Utils.crearFecha(r.fecha, r.horas[0]);

    function fin(r) {
        const d = Utils.crearFecha(r.fecha, r.horas[r.horas.length - 1]);
        d.setHours(d.getHours() + 1);
        return d;
    }

    // "18:00 a 19:00 hs"
    function rangoHorario(r) {
        const ultima = r.horas[r.horas.length - 1] || '00:00';
        const hFin = (Number(ultima.split(':')[0]) + 1) % 24;
        return `${r.horas[0]} a ${Utils.pad(hFin)}:00 hs`;
    }

    // Lee las reservas aplicando los cambios automáticos de estado:
    //  - transferencia sin pagar a tiempo  -> cancelada (se libera el turno)
    //  - turno que ya terminó              -> completada
    function obtenerReservas() {
        const lista = Store.reservasCrudas();
        const ahora = new Date();
        let cambios = false;

        lista.forEach((r) => {
            if (normalizar(r)) cambios = true;
            if (r.estado === 'pendiente_pago' && ((r.venceEn && new Date(r.venceEn) < ahora) || fin(r) <= ahora)) {
                r.estado = 'cancelada';
                r.motivo = 'Plazo de pago vencido';
                r.canceladaEn = ahora.toISOString();
                cambios = true;
            } else if (r.estado === 'activa' && fin(r) <= ahora) {
                r.estado = 'completada';
                cambios = true;
            }
        });

        if (cambios) Store.guardarReservas(lista);
        return lista;
    }

    const contexto = () => ({
        reservas: obtenerReservas(),
        cerradas: Store.fechasCerradas(),
        ahora: new Date()
    });

    // ---------- Disponibilidad y precios ----------

    // 'libre' | 'ocupado' | 'vencido' | 'cerrado'
    function estadoHora(ctx, canchaId, fecha, hora) {
        if (ctx.cerradas.includes(fecha)) return 'cerrado';
        const ocupado = ctx.reservas.some((r) =>
            r.canchaId === canchaId && r.fecha === fecha
            && ESTADOS_OCUPAN.includes(r.estado) && r.horas.includes(hora));
        if (ocupado) return 'ocupado';
        const limite = Utils.crearFecha(fecha, hora);
        limite.setMinutes(limite.getMinutes() + Config.get().toleranciaMinutos);
        return ctx.ahora > limite ? 'vencido' : 'libre';
    }

    function horasConsecutivas(hora, cantidad) {
        const horarios = Config.horarios();
        const indice = horarios.indexOf(hora);
        if (indice === -1) return null;
        const tramo = horarios.slice(indice, indice + cantidad);
        return tramo.length === cantidad ? tramo : null;
    }

    function calcularPrecio(cancha, cantidadHoras) {
        const cfg = Config.get();
        let total = cancha.precioHora * cantidadHoras;
        let descuento = 0;
        if (cfg.descuentoActivo && cantidadHoras >= 2) {
            descuento = cancha.precioHora * (cfg.descuentoSegundaHora / 100);
            total -= descuento;
        }
        const senia = Math.min(cfg.montoSenia, total);
        return {
            total: Math.round(total),
            descuento: Math.round(descuento),
            senia: Math.round(senia),
            saldo: Math.round(total - senia)
        };
    }

    function validarSeleccion(ctx, { canchaId, fecha, hora, cantidadHoras = 1, esStaff = false }) {
        const cfg = Config.get();
        const cancha = Config.canchaPorId(canchaId);
        if (!cancha || !cancha.activa) return fallo('La cancha seleccionada no está disponible.');
        if (!Utils.esFechaValida(fecha)) return fallo('La fecha elegida no es válida.');

        const hoy = Utils.fechaISO(ctx.ahora);
        if (fecha < hoy) return fallo('No se pueden reservar turnos en fechas que ya pasaron.');
        if (!esStaff && fecha > Utils.sumarDias(hoy, cfg.diasAnticipacion - 1)) {
            return fallo(`Solo se puede reservar con hasta ${cfg.diasAnticipacion} días de anticipación.`);
        }
        if (ctx.cerradas.includes(fecha)) return fallo('El complejo permanece cerrado en esa fecha.');

        const n = Number(cantidadHoras);
        if (!Number.isInteger(n) || n < 1 || n > cfg.maxHorasReserva) {
            return fallo(`Se pueden reservar entre 1 y ${cfg.maxHorasReserva} hora(s) seguidas.`);
        }
        if (!hora) return fallo('Elegí un horario.');

        const horas = horasConsecutivas(hora, n);
        if (!horas) return fallo(n > 1 ? 'El turno supera el horario de cierre del complejo.' : 'El horario elegido no es válido.');

        for (const h of horas) {
            const estado = estadoHora(ctx, canchaId, fecha, h);
            if (estado === 'ocupado') return fallo(`El horario de las ${h} hs ya está ocupado.`);
            if (estado === 'vencido') return fallo(`El horario de las ${h} hs ya pasó.`);
        }
        return { ok: true, cancha, horas };
    }

    // ---------- Puntos ----------

    function sumarPuntos(usuarioId, cantidad) {
        if (!usuarioId || !cantidad) return;
        const usuarios = Store.usuarios();
        const usuario = usuarios.find((u) => u.id === usuarioId);
        if (!usuario) return;
        usuario.puntos = Math.max(0, (usuario.puntos || 0) + cantidad);
        Store.guardarUsuarios(usuarios);
    }

    function otorgarPuntos(r) {
        if (!r.usuarioId || r.puntosOtorgados) return;
        r.puntosOtorgados = Math.round(Config.get().puntosPorHora * r.cantidadHoras);
        sumarPuntos(r.usuarioId, r.puntosOtorgados);
    }

    function devolverPuntos(r) {
        if (r.usuarioId && r.puntosOtorgados) sumarPuntos(r.usuarioId, -r.puntosOtorgados);
        r.puntosOtorgados = 0;
    }

    // ---------- Operaciones ----------

    // metodoPago: 'mercadopago' | 'transferencia' | 'manual' (cargada por el personal)
    function crearReserva({
        usuarioId = null, canchaId, fecha, hora, cantidadHoras = 1,
        metodoPago = 'mercadopago', cliente = null, montoSenia = null, creadaPor = null, extra = {}
    }) {
        const cfg = Config.get();
        const manual = metodoPago === 'manual';

        if (!['mercadopago', 'transferencia', 'manual'].includes(metodoPago)) return { exito: false, mensaje: 'Método de pago no válido.' };
        if (metodoPago === 'mercadopago' && !cfg.pagoMercadoPago) return { exito: false, mensaje: 'El pago con Mercado Pago no está habilitado.' };
        if (metodoPago === 'transferencia' && !cfg.pagoTransferencia) return { exito: false, mensaje: 'El pago por transferencia no está habilitado.' };

        if (manual) {
            if (!cliente || String(cliente.nombre || '').trim().length < 2) return { exito: false, mensaje: 'Ingresá el nombre del cliente.' };
        } else if (!usuarioId || !Store.usuarios().some((u) => u.id === usuarioId)) {
            return { exito: false, mensaje: 'Tenés que iniciar sesión para reservar.' };
        }

        const validacion = validarSeleccion(contexto(), { canchaId, fecha, hora, cantidadHoras, esStaff: manual });
        if (!validacion.ok) return { exito: false, mensaje: validacion.mensaje };

        const { cancha, horas } = validacion;
        const precio = calcularPrecio(cancha, horas.length);
        const senia = manual && montoSenia !== null
            ? Math.min(Math.max(0, Number(montoSenia) || 0), precio.total)
            : precio.senia;

        const estado = metodoPago === 'transferencia' ? 'pendiente_pago' : 'activa';
        const reserva = {
            id: Utils.uid('res'),
            usuarioId: manual ? null : usuarioId,
            cliente: manual ? { nombre: String(cliente.nombre).trim(), telefono: Utils.digitos(cliente.telefono) } : null,
            canchaId,
            nombreCancha: cancha.nombre,
            tipoCancha: cancha.tipo,
            fecha,
            horas,
            horaInicio: horas[0],
            cantidadHoras: horas.length,
            precioTotal: precio.total,
            montoSenia: senia,
            saldoRestante: Math.round(precio.total - senia),
            estado,
            metodoPago,
            // 'aprobado_test' = simulación hasta integrar el cobro real con Mercado Pago (requiere servidor)
            pagoEstado: manual ? 'manual' : metodoPago === 'mercadopago' ? 'aprobado_test' : 'pendiente',
            venceEn: estado === 'pendiente_pago'
                ? new Date(Date.now() + cfg.minutosRetencionTransferencia * 60000).toISOString() : null,
            puntosOtorgados: 0,
            creadaPor,
            fechaCreacion: new Date().toISOString(),
            ...extra
        };

        if (estado === 'activa') otorgarPuntos(reserva);

        const lista = obtenerReservas();
        lista.push(reserva);
        Store.guardarReservas(lista);
        return { exito: true, reserva };
    }

    // Solo el personal: confirmar pago / reactivar ('activa') o cancelar ('cancelada').
    function cambiarEstado(reservaId, nuevoEstado, actor) {
        if (!Auth.esStaff(actor)) return { exito: false, mensaje: 'No tenés permisos para esta acción.' };
        if (!['activa', 'cancelada'].includes(nuevoEstado)) return { exito: false, mensaje: 'Estado no válido.' };

        const lista = obtenerReservas();
        const r = lista.find((x) => x.id === reservaId);
        if (!r) return { exito: false, mensaje: 'Reserva no encontrada.' };
        if (r.estado === nuevoEstado) return { exito: true, mensaje: 'Sin cambios.' };

        if (nuevoEstado === 'activa') {
            if (r.estado === 'completada') return { exito: false, mensaje: 'El turno ya se jugó.' };
            if (fin(r) <= new Date()) return { exito: false, mensaje: 'El turno ya finalizó y no se puede habilitar.' };
            const cerrado = Store.fechasCerradas().includes(r.fecha);
            const conflicto = lista.some((o) =>
                o.id !== r.id && o.canchaId === r.canchaId && o.fecha === r.fecha
                && ESTADOS_OCUPAN.includes(o.estado) && o.horas.some((h) => r.horas.includes(h)));
            if (conflicto) return { exito: false, mensaje: 'No se puede habilitar: otro turno ya ocupa ese horario.' };
            if (cerrado) return { exito: false, mensaje: 'El complejo está cerrado en esa fecha.' };

            if (r.metodoPago === 'transferencia') r.pagoEstado = 'confirmado_admin';
            r.estado = 'activa';
            r.venceEn = null;
            r.motivo = null;
            otorgarPuntos(r);
        } else {
            r.estado = 'cancelada';
            r.motivo = 'Cancelada por el complejo';
            r.canceladaEn = new Date().toISOString();
            devolverPuntos(r);
        }

        Store.guardarReservas(lista);
        return { exito: true, mensaje: nuevoEstado === 'activa' ? 'El turno quedó confirmado.' : 'El turno fue cancelado y el horario quedó libre.' };
    }

    // Indica si un usuario puede cancelar (y por qué no, si no puede).
    function puedeCancelar(r, usuario) {
        const staff = Auth.esStaff(usuario);
        if (!usuario || (!staff && r.usuarioId !== usuario.id)) return { ok: false, motivo: 'Esta reserva no te pertenece.' };
        if (!ESTADOS_OCUPAN.includes(r.estado)) return { ok: false, motivo: 'Esta reserva ya no se puede cancelar.' };
        if (!staff && r.estado === 'activa') {
            const limite = Config.get().limiteHorasCancelacion;
            const horasRestantes = (inicio(r) - new Date()) / 3600000;
            if (horasRestantes < limite) {
                return { ok: false, motivo: `Solo se puede cancelar hasta ${limite} horas antes del turno.` };
            }
        }
        return { ok: true };
    }

    function cancelarReserva(reservaId, usuario) {
        const lista = obtenerReservas();
        const r = lista.find((x) => x.id === reservaId);
        if (!r) return { exito: false, mensaje: 'Reserva no encontrada.' };

        const permiso = puedeCancelar(r, usuario);
        if (!permiso.ok) return { exito: false, mensaje: permiso.motivo };

        r.estado = 'cancelada';
        r.motivo = Auth.esStaff(usuario) && r.usuarioId !== usuario.id ? 'Cancelada por el complejo' : 'Cancelada por el cliente';
        r.canceladaEn = new Date().toISOString();
        devolverPuntos(r);
        Store.guardarReservas(lista);
        return { exito: true, mensaje: 'Reserva cancelada. El horario quedó libre.' };
    }

    const reservasDeUsuario = (usuarioId) => obtenerReservas().filter((r) => r.usuarioId === usuarioId);

    return {
        ESTADOS_VIGENTES,
        obtenerReservas, contexto, estadoHora, horasConsecutivas, calcularPrecio, validarSeleccion,
        crearReserva, cambiarEstado, cancelarReserva, puedeCancelar, reservasDeUsuario,
        inicio, fin, rangoHorario
    };
})();
