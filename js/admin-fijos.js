// js/admin-fijos.js - Turnos fijos semanales: "los pibes del martes a las 21".
// Cada turno fijo genera reservas reales para las próximas 8 semanas (se renueva solo cada noche).

const AdminFijos = (() => {
    const $ = (id) => document.getElementById(id);

    // datos: { cancha_id, dia_semana, hora, horas, nombre, telefono, desde, hasta?, notas? }
    async function crear(datos) {
        const fila = await Db.q(Db.sb.from('turnos_fijos').insert({
            cancha_id: datos.cancha_id,
            dia_semana: datos.dia_semana,
            hora_inicio: datos.hora,
            horas: datos.horas,
            cliente_nombre: datos.nombre,
            cliente_telefono: Utils.digitos(datos.telefono),
            desde: datos.desde,
            hasta: datos.hasta || null,
            notas: datos.notas || ''
        }).select().single());
        const res = await Db.rpc('generar_turnos_fijos', { p_dias: 56 });
        const conflictos = (res.conflictos || []).filter((c) => c.turno_fijo_id === fila.id);
        if (conflictos.length) {
            UI.alerta('Algunas fechas ya estaban ocupadas',
                `El turno fijo se creó, pero estas fechas ya tenían otra reserva y no se pudieron tomar:<br><strong>${conflictos.map((c) => Utils.esc(Utils.fechaCorta(c.fecha))).join(', ')}</strong>.<br>Revisalas en la grilla.`);
        }
        return { creadas: res.creadas || 0, conflictos };
    }

    async function render() {
        const contenedor = $('lista-fijos');
        let fijos, proximas;
        try {
            [fijos, proximas] = await Promise.all([
                Db.q(Db.sb.from('turnos_fijos').select('*').order('activo', { ascending: false }).order('dia_semana').order('hora_inicio')),
                Admin.reservasEntre(Utils.hoyISO(), Utils.sumarDias(Utils.hoyISO(), 60), (q) => q.not('turno_fijo_id', 'is', null))
            ]);
        } catch (e) {
            contenedor.innerHTML = `<p class="vacio">${Utils.esc(e.message)}</p>`;
            return;
        }
        if (!fijos.length) {
            contenedor.innerHTML = `<div class="vacio"><p>Todavía no hay turnos fijos.</p><p class="hint">Ideal para los grupos que juegan siempre el mismo día: el horario queda reservado solo, semana a semana.</p></div>`;
            return;
        }

        contenedor.innerHTML = `<div class="tabla-wrap"><table class="tabla">
            <thead><tr><th>Cliente</th><th>Cuándo</th><th>Cancha</th><th>Vigencia</th><th>Próximo</th><th>Acciones</th></tr></thead>
            <tbody>${fijos.map((f) => {
                const cancha = Config.canchaPorId(f.cancha_id);
                const suyas = proximas.filter((r) => r.turno_fijo_id === f.id && !Booking.terminada(r));
                const proxima = suyas.find((r) => r.estado === 'confirmada');
                const salteadas = suyas.filter((r) => r.estado === 'cancelada').length;
                const wa = Utils.linkWhatsApp(f.cliente_telefono, `Hola ${f.cliente_nombre.split(' ')[0]}, te escribimos de ${Config.get().nombreComplejo} por tu turno fijo de los ${Utils.DIAS[f.dia_semana]} a las ${Utils.hhmm(f.hora_inicio)}.`);
                return `<tr class="${f.activo ? '' : 'inactivo'}">
                    <td data-label="Cliente"><strong>${Utils.esc(f.cliente_nombre)}</strong><br><small>${Utils.esc(f.cliente_telefono)}</small>${f.notas ? `<br><small>${Utils.esc(f.notas)}</small>` : ''}</td>
                    <td data-label="Cuándo">${Utils.capitalizar(Utils.DIAS[f.dia_semana])}s<br>${Booking.rango(f)}</td>
                    <td data-label="Cancha">${Utils.esc(cancha?.nombre || f.cancha_id)}</td>
                    <td data-label="Vigencia">${f.activo ? '<span class="badge badge-activa">Activo</span>' : '<span class="badge badge-cancelada">De baja</span>'}<br><small>Desde ${Utils.esc(Utils.fechaCorta(f.desde))}${f.hasta ? ` hasta ${Utils.esc(Utils.fechaCorta(f.hasta))}` : ''}</small></td>
                    <td data-label="Próximo">${proxima ? `${Utils.esc(Utils.fechaAmigable(proxima.fecha))}` : '—'}${salteadas ? `<br><small>${salteadas} semana(s) salteada(s)</small>` : ''}</td>
                    <td data-label="Acciones" class="celda-acciones">
                        ${wa ? `<a class="btn btn-whatsapp btn-sm" href="${Utils.esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
                        ${f.activo ? `<button type="button" class="btn btn-peligro btn-sm" data-baja="${Utils.esc(f.id)}">Dar de baja</button>` : ''}
                    </td>
                </tr>`;
            }).join('')}</tbody></table></div>`;
    }

    function nuevo() {
        const canchas = Config.canchasActivas();
        const cfg = Config.get();
        const ctl = UI.modal({
            titulo: 'Nuevo turno fijo',
            clase: 'modal-ancho',
            cuerpo: `
                <form class="form-grid" novalidate>
                    <div class="field"><label for="tf-nombre">Cliente o grupo</label><input type="text" id="tf-nombre" maxlength="80" placeholder="Ej: Los pibes del martes" required></div>
                    <div class="field"><label for="tf-tel">WhatsApp del responsable</label><input type="tel" id="tf-tel" inputmode="numeric"></div>
                    <div class="field"><label for="tf-cancha">Cancha</label><select id="tf-cancha">${canchas.map((c) => `<option value="${Utils.esc(c.id)}">${Utils.esc(c.nombre)}</option>`).join('')}</select></div>
                    <div class="field"><label for="tf-dia">Día</label><select id="tf-dia">${Utils.DIAS.map((d, i) => `<option value="${i}">${Utils.capitalizar(d)}</option>`).join('')}</select></div>
                    <div class="field"><label for="tf-hora">Hora</label><select id="tf-hora">${Config.horarios().map((h) => `<option value="${h}"${h === 21 ? ' selected' : ''}>${Utils.hhmm(h)}</option>`).join('')}</select></div>
                    <div class="field"><label for="tf-horas">Duración</label><select id="tf-horas">${Array.from({ length: cfg.maxHorasReserva }, (_, i) => `<option value="${i + 1}">${i + 1} hora${i ? 's' : ''}</option>`).join('')}</select></div>
                    <div class="field"><label for="tf-desde">Empieza</label><input type="date" id="tf-desde" value="${Utils.hoyISO()}" min="${Utils.hoyISO()}"></div>
                    <div class="field"><label for="tf-hasta">Termina (opcional)</label><input type="date" id="tf-hasta" min="${Utils.hoyISO()}"></div>
                    <div class="field"><label for="tf-notas">Notas</label><input type="text" id="tf-notas" maxlength="140" placeholder="Ej: pagan por mes"></div>
                </form>
                <p class="hint">Se reservan automáticamente las próximas 8 semanas y se paga en la cancha (sin seña online).</p>
                <p id="tf-error" class="error-msg" role="alert" hidden></p>`,
            botones: [
                { texto: 'Cancelar', clase: 'btn-secundario' },
                {
                    texto: 'Crear turno fijo',
                    accion: async (c, boton) => {
                        const el = (id) => c.el.querySelector(`#${id}`);
                        const error = el('tf-error');
                        const nombre = el('tf-nombre').value.trim();
                        if (nombre.length < 2) { error.textContent = 'Ingresá el nombre del cliente o grupo.'; error.hidden = false; return false; }
                        const hora = Number(el('tf-hora').value);
                        const horas = Number(el('tf-horas').value);
                        if (hora + horas > cfg.horaCierre) { error.textContent = 'El turno se pasa del horario de cierre.'; error.hidden = false; return false; }
                        try {
                            const res = await UI.conBoton(boton, 'Creando…', () => crear({
                                cancha_id: el('tf-cancha').value, dia_semana: Number(el('tf-dia').value), hora, horas,
                                nombre, telefono: el('tf-tel').value, desde: el('tf-desde').value || Utils.hoyISO(),
                                hasta: el('tf-hasta').value || null, notas: el('tf-notas').value.trim()
                            }));
                            UI.toast(`Turno fijo creado: ${res.creadas} turno(s) reservados.`);
                            render();
                            Admin.refrescar();
                        } catch (e) {
                            error.textContent = e.message;
                            error.hidden = false;
                            return false;
                        }
                    }
                }
            ]
        });
        ctl.el.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
        // Día por defecto: hoy
        ctl.el.querySelector('#tf-dia').value = String(Utils.diaSemana(Utils.hoyISO()));
    }

    async function baja(id) {
        const ok = await UI.confirmar('¿Dar de baja el turno fijo?', 'Se cancelan sus próximos turnos y esos horarios quedan libres para reservar.', { textoOk: 'Dar de baja', peligro: true });
        if (!ok) return;
        try {
            const n = await Db.rpc('baja_turno_fijo', { p_id: id });
            UI.toast(`Turno fijo dado de baja. Se liberaron ${n} turno(s).`);
            render();
            Admin.refrescar();
        } catch (e) {
            UI.toast(e.message, 'error');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('btn-nuevo-fijo')?.addEventListener('click', nuevo);
        document.getElementById('lista-fijos')?.addEventListener('click', (e) => {
            const b = e.target.closest('[data-baja]');
            if (b) baja(b.dataset.baja);
        });
    });

    Admin.registrar('fijos', { render });
    return { crear, render };
})();
