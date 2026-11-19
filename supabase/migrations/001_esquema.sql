-- =====================================================================
-- Un Show Más · Sistema de reservas · Esquema de base de datos (Supabase)
-- Se ejecuta una sola vez sobre un proyecto vacío (SQL Editor o API).
-- Todas las fechas y horas de los turnos son hora de Argentina (UTC-3).
-- =====================================================================

create extension if not exists btree_gist;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
-- Utilidades de tiempo (Argentina no tiene horario de verano)
-- ---------------------------------------------------------------------
create or replace function public.ahora_ar() returns timestamp
language sql stable as $$ select (now() at time zone 'America/Argentina/Buenos_Aires') $$;

create or replace function public.hoy_ar() returns date
language sql stable as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;

-- Instante (timestamptz) en que empieza un turno
create or replace function public.inicio_turno(p_fecha date, p_hora int) returns timestamptz
language sql immutable as $$
  select ((p_fecha + make_interval(hours => p_hora))::timestamp at time zone 'America/Argentina/Buenos_Aires')
$$;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table public.ajustes (
  id          int primary key default 1 check (id = 1),
  datos       jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now()
);

create table public.canchas (
  id          text primary key,
  nombre      text not null check (length(trim(nombre)) >= 2),
  tipo        text not null default '',
  precio_hora integer not null check (precio_hora >= 0),
  activa      boolean not null default true,
  archivada   boolean not null default false,
  orden       integer not null default 0,
  creada      timestamptz not null default now()
);

create table public.fechas_cerradas (
  fecha  date primary key,
  motivo text not null default ''
);

create table public.perfiles (
  id       uuid primary key references auth.users (id) on delete cascade,
  nombre   text not null default '',
  telefono text not null default '',
  email    text,
  rol      text not null default 'cliente' check (rol in ('cliente', 'empleado', 'duenio')),
  puntos   integer not null default 0 check (puntos >= 0),
  creado   timestamptz not null default now()
);

create table public.turnos_fijos (
  id               uuid primary key default gen_random_uuid(),
  cancha_id        text not null references public.canchas (id) on update cascade,
  dia_semana       smallint not null check (dia_semana between 0 and 6), -- 0 = domingo
  hora_inicio      smallint not null check (hora_inicio between 0 and 23),
  horas            smallint not null default 1 check (horas between 1 and 6),
  cliente_nombre   text not null check (length(trim(cliente_nombre)) >= 2),
  cliente_telefono text not null default '',
  usuario_id       uuid references public.perfiles (id) on delete set null,
  desde            date not null default public.hoy_ar(),
  hasta            date,
  activo           boolean not null default true,
  notas            text not null default '',
  creado_por       uuid default auth.uid(),
  creado           timestamptz not null default now(),
  check (hora_inicio + horas <= 24),
  check (hasta is null or hasta >= desde)
);

create table public.reservas (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  token             uuid not null default gen_random_uuid(), -- secreto para que un invitado gestione su reserva
  usuario_id        uuid references public.perfiles (id) on delete set null,
  cliente_nombre    text not null,
  cliente_telefono  text not null default '',
  cliente_email     text,
  cancha_id         text not null references public.canchas (id) on update cascade,
  cancha_nombre     text not null,
  fecha             date not null,
  hora_inicio       smallint not null check (hora_inicio between 0 and 23),
  horas             smallint not null check (horas between 1 and 6),
  franja            int4range generated always as (int4range(hora_inicio, hora_inicio + horas)) stored,
  precio_total      integer not null default 0,
  descuento         integer not null default 0,
  monto_senia       integer not null default 0,
  estado            text not null default 'pendiente_pago'
                    check (estado in ('pendiente_pago', 'confirmada', 'cancelada', 'vencida')),
  metodo_pago       text not null check (metodo_pago in ('mercadopago', 'transferencia', 'manual', 'fijo')),
  pago_estado       text not null default 'pendiente'
                    check (pago_estado in ('pendiente', 'aprobado', 'demo', 'en_cancha', 'manual',
                                           'confirmado_admin', 'reembolsado', 'reembolso_pendiente', 'sin_reembolso')),
  mp_preference_id  text,
  mp_init_point     text,
  mp_payment_id     text,
  vence_en          timestamptz,
  saldo_cobrado     boolean not null default false,
  asistencia        text check (asistencia in ('presente', 'ausente')),
  turno_fijo_id     uuid references public.turnos_fijos (id) on delete set null,
  puntos_otorgados  integer not null default 0,
  motivo            text,
  notas             text not null default '',
  creada_por        uuid,
  origen_ip         text,
  creada            timestamptz not null default now(),
  confirmada_en     timestamptz,
  cancelada_en      timestamptz,
  check (hora_inicio + horas <= 24),
  -- LA regla de oro: una cancha no puede tener dos turnos vigentes superpuestos.
  constraint sin_superposicion exclude using gist (
    cancha_id with =, fecha with =, franja with &&
  ) where (estado in ('pendiente_pago', 'confirmada'))
);

create index reservas_fecha_idx on public.reservas (fecha);
create index reservas_usuario_idx on public.reservas (usuario_id);
create index reservas_telefono_idx on public.reservas (cliente_telefono);
create index reservas_pendientes_idx on public.reservas (vence_en) where estado = 'pendiente_pago';
create unique index reservas_fijo_fecha_idx on public.reservas (turno_fijo_id, fecha) where turno_fijo_id is not null;

-- Registro de todo lo que llega de Mercado Pago (auditoría)
create table public.eventos_pago (
  id         bigserial primary key,
  recibido   timestamptz not null default now(),
  origen     text not null,
  reserva_id uuid,
  datos      jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select rol from public.perfiles where id = auth.uid()), 'anonimo')
$$;

create or replace function public.es_staff() returns boolean
language sql stable as $$ select public.mi_rol() in ('empleado', 'duenio') $$;

create or replace function public.es_duenio() returns boolean
language sql stable as $$ select public.mi_rol() = 'duenio' $$;

-- Llamadas del servidor (service_role), de pg_cron o desde la consola de Supabase
create or replace function public.es_sistema() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      or session_user in ('postgres', 'supabase_admin')
$$;

-- Perfil automático al registrarse
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre, telefono, email)
  values (
    new.id,
    coalesce(trim(new.raw_user_meta_data ->> 'nombre'), ''),
    regexp_replace(coalesce(new.raw_user_meta_data ->> 'telefono', ''), '\D', '', 'g'),
    lower(new.email)
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger al_crear_usuario after insert on auth.users
for each row execute function public.crear_perfil();

-- ---------------------------------------------------------------------
-- Puntos: se otorgan al confirmar y se descuentan al cancelar
-- ---------------------------------------------------------------------
create or replace function public.gestionar_puntos() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_por_hora int := coalesce(((select datos from public.ajustes where id = 1) ->> 'puntosPorHora')::int, 10);
begin
  if new.usuario_id is not null and new.estado = 'confirmada' and coalesce(new.puntos_otorgados, 0) = 0 then
    new.puntos_otorgados := v_por_hora * new.horas;
    update public.perfiles set puntos = puntos + new.puntos_otorgados where id = new.usuario_id;
  elsif tg_op = 'UPDATE' and new.estado in ('cancelada', 'vencida') and coalesce(old.puntos_otorgados, 0) > 0 then
    update public.perfiles set puntos = greatest(0, puntos - old.puntos_otorgados) where id = old.usuario_id;
    new.puntos_otorgados := 0;
  end if;
  if tg_op = 'UPDATE' and new.estado = 'confirmada' and old.estado <> 'confirmada' then
    new.confirmada_en := coalesce(new.confirmada_en, now());
  end if;
  return new;
end $$;

create trigger puntos_reserva before insert or update of estado on public.reservas
for each row execute function public.gestionar_puntos();

-- ---------------------------------------------------------------------
-- Vencimiento de reservas impagas (se llama antes de reservar y cada minuto)
-- ---------------------------------------------------------------------
create or replace function public.vencer_pendientes() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.reservas
     set estado = 'vencida', motivo = 'Plazo de pago vencido', cancelada_en = now()
   where estado = 'pendiente_pago' and vence_en is not null and vence_en < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Disponibilidad pública (sin datos personales salvo el nombre abreviado)
-- ---------------------------------------------------------------------
create or replace function public.ocupacion(p_desde date, p_hasta date)
returns table (cancha_id text, fecha date, hora_inicio smallint, horas smallint, estado text, nombre_corto text, fijo boolean)
language sql stable security definer set search_path = public as $$
  select r.cancha_id, r.fecha, r.hora_inicio, r.horas, r.estado,
         case when r.estado = 'confirmada' and coalesce((select (datos ->> 'mostrarNombres')::boolean from ajustes where id = 1), true)
              then split_part(trim(r.cliente_nombre), ' ', 1)
                   || coalesce(' ' || nullif(upper(left(split_part(trim(r.cliente_nombre), ' ', 2), 1)), '') || '.', '')
         end,
         r.turno_fijo_id is not null
    from public.reservas r
   where r.fecha between p_desde and least(p_hasta, p_desde + 62)
     and (r.estado = 'confirmada' or (r.estado = 'pendiente_pago' and (r.vence_en is null or r.vence_en > now())))
$$;

-- Vista de una reserva para quien tiene el enlace (invitados)
create or replace function public.ver_reserva(p_id uuid, p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(r) - 'origen_ip' - 'token' - 'notas' - 'creada_por'
    from public.reservas r where r.id = p_id and r.token = p_token
$$;

-- ---------------------------------------------------------------------
-- Crear una reserva (web: desde el servidor · mostrador: personal)
-- p: { cancha_id, fecha, hora, horas, nombre, telefono, email, usuario_id,
--      metodo, senia (solo manual), notas, ip }
-- ---------------------------------------------------------------------
create or replace function public.crear_reserva(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg        jsonb := (select datos from public.ajustes where id = 1);
  v_staff    boolean := public.es_staff();
  v_sistema  boolean := public.es_sistema();
  v_metodo   text := coalesce(p ->> 'metodo', 'mercadopago');
  v_fecha    date;
  v_hora     int;
  v_horas    int;
  v_cancha   public.canchas;
  v_hoy      date := public.hoy_ar();
  v_apertura int := coalesce((cfg ->> 'horaApertura')::int, 9);
  v_cierre   int := coalesce((cfg ->> 'horaCierre')::int, 24);
  v_max      int := coalesce((cfg ->> 'maxHorasReserva')::int, 2);
  v_dias     int := coalesce((cfg ->> 'diasAnticipacion')::int, 7);
  v_tol      int := coalesce((cfg ->> 'toleranciaMinutos')::int, 25);
  v_total    int;
  v_desc     int := 0;
  v_senia    int;
  v_estado   text;
  v_pago     text;
  v_vence    timestamptz;
  v_nombre   text := trim(coalesce(p ->> 'nombre', ''));
  v_tel      text := regexp_replace(coalesce(p ->> 'telefono', ''), '\D', '', 'g');
  v_usuario  uuid := nullif(p ->> 'usuario_id', '')::uuid;
  v_ip       text := p ->> 'ip';
  v_r        public.reservas;
begin
  if not (v_sistema or v_staff) then
    raise exception 'No tenés permisos para crear reservas directamente.' using errcode = 'P0001';
  end if;
  if v_metodo not in ('mercadopago', 'transferencia', 'manual') then
    raise exception 'Método de pago no válido.' using errcode = 'P0001';
  end if;
  if v_metodo = 'manual' and not v_staff then
    raise exception 'Solo el personal puede cargar reservas manuales.' using errcode = 'P0001';
  end if;
  if v_metodo = 'mercadopago' and not coalesce((cfg ->> 'pagoMercadoPago')::boolean, true) then
    raise exception 'El pago con Mercado Pago no está habilitado.' using errcode = 'P0001';
  end if;
  if v_metodo = 'transferencia' and not coalesce((cfg ->> 'pagoTransferencia')::boolean, false) then
    raise exception 'El pago por transferencia no está habilitado.' using errcode = 'P0001';
  end if;

  begin
    v_fecha := (p ->> 'fecha')::date;
    v_hora  := split_part(p ->> 'hora', ':', 1)::int;
    v_horas := coalesce((p ->> 'horas')::int, 1);
  exception when others then
    raise exception 'Los datos del turno no son válidos.' using errcode = 'P0001';
  end;

  if length(v_nombre) < 2 then raise exception 'Ingresá el nombre y apellido.' using errcode = 'P0001'; end if;
  if v_metodo <> 'manual' and (length(v_tel) < 8 or length(v_tel) > 13) then
    raise exception 'Ingresá un WhatsApp válido (con característica, sin 0 ni 15).' using errcode = 'P0001';
  end if;

  select * into v_cancha from public.canchas where id = p ->> 'cancha_id' and activa and not archivada;
  if not found then raise exception 'La cancha elegida no está disponible.' using errcode = 'P0001'; end if;

  if v_fecha < v_hoy then raise exception 'No se pueden reservar fechas que ya pasaron.' using errcode = 'P0001'; end if;
  if not v_staff and v_fecha > v_hoy + (v_dias - 1) then
    raise exception 'Solo se puede reservar con hasta % días de anticipación.', v_dias using errcode = 'P0001';
  end if;
  if exists (select 1 from public.fechas_cerradas where fecha = v_fecha) then
    raise exception 'El complejo está cerrado ese día.' using errcode = 'P0001';
  end if;
  if v_horas < 1 or v_horas > v_max then
    raise exception 'Se pueden reservar entre 1 y % hora(s) seguidas.', v_max using errcode = 'P0001';
  end if;
  if v_hora < v_apertura or v_hora + v_horas > v_cierre then
    raise exception 'El turno está fuera del horario del complejo.' using errcode = 'P0001';
  end if;
  if public.inicio_turno(v_fecha, v_hora) + make_interval(mins => v_tol) < now() then
    raise exception 'Ese horario ya pasó.' using errcode = 'P0001';
  end if;

  perform public.vencer_pendientes();

  -- Anti-abuso: nadie puede "trabar" muchos turnos sin pagar
  if not v_staff and v_metodo <> 'manual' and (
       (select count(*) from public.reservas where estado = 'pendiente_pago' and cliente_telefono = v_tel) >= 2
    or (v_ip is not null and (select count(*) from public.reservas where estado = 'pendiente_pago' and origen_ip = v_ip) >= 4)
  ) then
    raise exception 'Tenés reservas esperando el pago. Completá ese pago o esperá unos minutos.' using errcode = 'P0001';
  end if;

  v_total := v_cancha.precio_hora * v_horas;
  if coalesce((cfg ->> 'descuentoActivo')::boolean, false) and v_horas >= 2 then
    v_desc := round(v_cancha.precio_hora * coalesce((cfg ->> 'descuentoSegundaHora')::numeric, 0) / 100);
  end if;
  v_total := v_total - v_desc;
  v_senia := least(coalesce((cfg ->> 'montoSenia')::int, 5000), v_total);

  if v_metodo = 'manual' then
    v_senia  := least(greatest(coalesce((p ->> 'senia')::int, 0), 0), v_total);
    v_estado := 'confirmada';
    v_pago   := 'manual';
  elsif v_metodo = 'transferencia' then
    v_estado := 'pendiente_pago';
    v_pago   := 'pendiente';
    v_vence  := now() + make_interval(mins => coalesce((cfg ->> 'minutosRetencionTransferencia')::int, 30));
  else
    v_estado := 'pendiente_pago';
    v_pago   := 'pendiente';
    v_vence  := now() + make_interval(mins => coalesce((cfg ->> 'minutosRetencionMP')::int, 15));
  end if;

  begin
    insert into public.reservas (
      usuario_id, cliente_nombre, cliente_telefono, cliente_email, cancha_id, cancha_nombre,
      fecha, hora_inicio, horas, precio_total, descuento, monto_senia, estado, metodo_pago, pago_estado,
      vence_en, notas, creada_por, origen_ip
    ) values (
      v_usuario, v_nombre, v_tel, nullif(lower(trim(coalesce(p ->> 'email', ''))), ''), v_cancha.id, v_cancha.nombre,
      v_fecha, v_hora, v_horas, v_total, v_desc, v_senia, v_estado, v_metodo, v_pago,
      v_vence, coalesce(p ->> 'notas', ''), coalesce(auth.uid(), nullif(p ->> 'creada_por', '')::uuid), v_ip
    ) returning * into v_r;
  exception when exclusion_violation then
    raise exception 'Ese horario se acaba de ocupar. Elegí otro.' using errcode = 'P0001';
  end;

  return to_jsonb(v_r);
end $$;

-- ---------------------------------------------------------------------
-- Confirmar un pago aprobado (servidor: webhook de Mercado Pago o demo)
-- ---------------------------------------------------------------------
create or replace function public.confirmar_pago(p_id uuid, p_payment_id text, p_pago_estado text default 'aprobado')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.reservas;
begin
  if not public.es_sistema() then raise exception 'Sin permisos.' using errcode = 'P0001'; end if;
  select * into v_r from public.reservas where id = p_id for update;
  if not found then raise exception 'Reserva no encontrada.' using errcode = 'P0001'; end if;

  if v_r.estado = 'confirmada' then
    update public.reservas set mp_payment_id = coalesce(mp_payment_id, p_payment_id) where id = p_id returning * into v_r;
    return jsonb_build_object('resultado', 'ya_confirmada', 'reserva', to_jsonb(v_r));
  end if;

  if v_r.estado = 'cancelada' and v_r.motivo like 'Cancelada%' then
    -- Pagó una reserva que ya se había cancelado a mano: se marca para devolver.
    update public.reservas set mp_payment_id = p_payment_id, pago_estado = 'reembolso_pendiente',
           motivo = 'Pago recibido sobre una reserva cancelada: devolver la seña'
     where id = p_id returning * into v_r;
    return jsonb_build_object('resultado', 'devolver', 'reserva', to_jsonb(v_r));
  end if;

  begin
    update public.reservas
       set estado = 'confirmada', pago_estado = p_pago_estado, mp_payment_id = p_payment_id,
           vence_en = null, motivo = null, cancelada_en = null
     where id = p_id returning * into v_r;
    return jsonb_build_object('resultado', 'confirmada', 'reserva', to_jsonb(v_r));
  exception when exclusion_violation then
    -- Pagó tarde y el horario ya lo tomó otra persona.
    update public.reservas set mp_payment_id = p_payment_id, pago_estado = 'reembolso_pendiente',
           motivo = 'El pago llegó después del plazo y el horario ya estaba ocupado: devolver la seña'
     where id = p_id returning * into v_r;
    return jsonb_build_object('resultado', 'devolver', 'reserva', to_jsonb(v_r));
  end;
end $$;

-- ---------------------------------------------------------------------
-- Acciones del personal
-- ---------------------------------------------------------------------
-- Confirmar una transferencia o reactivar un turno cancelado/vencido
create or replace function public.staff_confirmar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_r public.reservas;
begin
  if not public.es_staff() then raise exception 'No tenés permisos para esta acción.' using errcode = 'P0001'; end if;
  select * into v_r from public.reservas where id = p_id for update;
  if not found then raise exception 'Reserva no encontrada.' using errcode = 'P0001'; end if;
  if v_r.estado = 'confirmada' then return to_jsonb(v_r); end if;
  if public.inicio_turno(v_r.fecha, v_r.hora_inicio + v_r.horas) <= now() then
    raise exception 'El turno ya terminó.' using errcode = 'P0001';
  end if;
  begin
    update public.reservas
       set estado = 'confirmada', vence_en = null, motivo = null, cancelada_en = null,
           pago_estado = case when metodo_pago = 'transferencia' and pago_estado = 'pendiente' then 'confirmado_admin' else pago_estado end
     where id = p_id returning * into v_r;
  exception when exclusion_violation then
    raise exception 'No se puede: otro turno ya ocupa ese horario.' using errcode = 'P0001';
  end;
  return to_jsonb(v_r);
end $$;

-- Ascender a empleado / devolver a cliente (solo el dueño)
create or replace function public.cambiar_rol(p_usuario uuid, p_rol text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_duenio() then raise exception 'Solo el dueño puede cambiar roles.' using errcode = 'P0001'; end if;
  if p_rol not in ('cliente', 'empleado') then raise exception 'Rol no válido.' using errcode = 'P0001'; end if;
  if p_usuario = auth.uid() then raise exception 'No podés cambiar tu propio rol.' using errcode = 'P0001'; end if;
  update public.perfiles set rol = p_rol where id = p_usuario and rol <> 'duenio';
end $$;

-- ---------------------------------------------------------------------
-- Turnos fijos semanales: genera las reservas de las próximas semanas
-- ---------------------------------------------------------------------
create or replace function public.generar_turnos_fijos(p_dias int default 56) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg      jsonb := (select datos from public.ajustes where id = 1);
  t        record;
  d        date;
  v_hoy    date := public.hoy_ar();
  v_total  int;
  v_desc   int;
  v_creadas int := 0;
  v_conf   jsonb := '[]'::jsonb;
begin
  if not (public.es_sistema() or public.es_staff()) then raise exception 'Sin permisos.' using errcode = 'P0001'; end if;

  for t in
    select tf.*, c.nombre as c_nombre, c.precio_hora
      from public.turnos_fijos tf join public.canchas c on c.id = tf.cancha_id
     where tf.activo and not c.archivada
  loop
    for d in
      select g::date from generate_series(greatest(t.desde, v_hoy), least(coalesce(t.hasta, v_hoy + p_dias), v_hoy + p_dias), interval '1 day') g
       where extract(dow from g) = t.dia_semana
    loop
      continue when exists (select 1 from public.reservas where turno_fijo_id = t.id and fecha = d);
      continue when exists (select 1 from public.fechas_cerradas where fecha = d);
      continue when public.inicio_turno(d, t.hora_inicio + t.horas) <= now();

      v_desc := 0;
      if coalesce((cfg ->> 'descuentoActivo')::boolean, false) and t.horas >= 2 then
        v_desc := round(t.precio_hora * coalesce((cfg ->> 'descuentoSegundaHora')::numeric, 0) / 100);
      end if;
      v_total := t.precio_hora * t.horas - v_desc;

      begin
        insert into public.reservas (
          usuario_id, cliente_nombre, cliente_telefono, cancha_id, cancha_nombre, fecha, hora_inicio, horas,
          precio_total, descuento, monto_senia, estado, metodo_pago, pago_estado, turno_fijo_id, creada_por
        ) values (
          t.usuario_id, t.cliente_nombre, t.cliente_telefono, t.cancha_id, t.c_nombre, d, t.hora_inicio, t.horas,
          v_total, v_desc, 0, 'confirmada', 'fijo', 'en_cancha', t.id, t.creado_por
        );
        v_creadas := v_creadas + 1;
      exception when exclusion_violation then
        v_conf := v_conf || jsonb_build_object('turno_fijo_id', t.id, 'cliente', t.cliente_nombre, 'fecha', d);
      end;
    end loop;
  end loop;

  return jsonb_build_object('creadas', v_creadas, 'conflictos', v_conf);
end $$;

-- Dar de baja un turno fijo: cancela sus próximos turnos
create or replace function public.baja_turno_fijo(p_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.es_staff() then raise exception 'No tenés permisos para esta acción.' using errcode = 'P0001'; end if;
  update public.turnos_fijos set activo = false, hasta = least(coalesce(hasta, public.hoy_ar()), public.hoy_ar()) where id = p_id;
  update public.reservas set estado = 'cancelada', motivo = 'Turno fijo dado de baja', cancelada_en = now()
   where turno_fijo_id = p_id and estado = 'confirmada' and public.inicio_turno(fecha, hora_inicio) > now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Seguridad por filas (RLS)
-- ---------------------------------------------------------------------
alter table public.ajustes         enable row level security;
alter table public.canchas         enable row level security;
alter table public.fechas_cerradas enable row level security;
alter table public.perfiles        enable row level security;
alter table public.turnos_fijos    enable row level security;
alter table public.reservas        enable row level security;
alter table public.eventos_pago    enable row level security;

create policy "ajustes: lectura pública" on public.ajustes for select using (true);
create policy "ajustes: edita el dueño" on public.ajustes for update using (public.es_duenio()) with check (public.es_duenio());

create policy "canchas: lectura pública" on public.canchas for select using (true);
create policy "canchas: gestiona el dueño" on public.canchas for all using (public.es_duenio()) with check (public.es_duenio());

create policy "cierres: lectura pública" on public.fechas_cerradas for select using (true);
create policy "cierres: gestiona el personal" on public.fechas_cerradas for all using (public.es_staff()) with check (public.es_staff());

create policy "perfiles: cada uno ve el suyo; el personal ve todos" on public.perfiles
  for select using (id = auth.uid() or public.es_staff());
create policy "perfiles: cada uno edita el suyo" on public.perfiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy "turnos fijos: personal" on public.turnos_fijos for all using (public.es_staff()) with check (public.es_staff());

create policy "reservas: el cliente ve las suyas; el personal ve todas" on public.reservas
  for select using (usuario_id = auth.uid() or public.es_staff());
create policy "reservas: el personal edita cobro, asistencia y notas" on public.reservas
  for update using (public.es_staff()) with check (public.es_staff());

-- Permisos por columna: nadie se puede subir los puntos ni cambiar el rol
revoke insert, update, delete on public.perfiles from anon, authenticated;
grant update (nombre, telefono) on public.perfiles to authenticated;

revoke insert, update, delete on public.reservas from anon, authenticated;
grant update (saldo_cobrado, asistencia, notas) on public.reservas to authenticated;

revoke all on public.eventos_pago from anon, authenticated;
revoke insert, delete on public.ajustes from anon, authenticated;

-- Funciones: quién puede llamar a cada una
revoke execute on function public.crear_reserva(jsonb) from public, anon;
revoke execute on function public.confirmar_pago(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.vencer_pendientes() from public, anon, authenticated;
revoke execute on function public.generar_turnos_fijos(int) from public, anon;
revoke execute on function public.staff_confirmar(uuid) from public, anon;
revoke execute on function public.cambiar_rol(uuid, text) from public, anon;
revoke execute on function public.baja_turno_fijo(uuid) from public, anon;
revoke execute on function public.crear_perfil() from public, anon, authenticated;
revoke execute on function public.gestionar_puntos() from public, anon, authenticated;

grant execute on function public.crear_reserva(jsonb) to authenticated, service_role;
grant execute on function public.confirmar_pago(uuid, text, text) to service_role;
grant execute on function public.vencer_pendientes() to service_role;
grant execute on function public.generar_turnos_fijos(int) to authenticated, service_role;
grant execute on function public.staff_confirmar(uuid) to authenticated;
grant execute on function public.cambiar_rol(uuid, text) to authenticated;
grant execute on function public.baja_turno_fijo(uuid) to authenticated;
grant execute on function public.ocupacion(date, date) to anon, authenticated;
grant execute on function public.ver_reserva(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Tiempo real: el panel se actualiza solo cuando entra una reserva
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.reservas;

-- ---------------------------------------------------------------------
-- Tareas automáticas
-- ---------------------------------------------------------------------
select cron.schedule('vencer-pendientes', '* * * * *', $$ select public.vencer_pendientes(); $$);
select cron.schedule('generar-turnos-fijos', '15 7 * * *', $$ select public.generar_turnos_fijos(56); $$); -- 04:15 hs Argentina

-- ---------------------------------------------------------------------
-- Datos iniciales
-- ---------------------------------------------------------------------
insert into public.ajustes (id, datos) values (1, '{
  "nombreComplejo": "Un Show Más",
  "montoSenia": 5000,
  "descuentoActivo": true,
  "descuentoSegundaHora": 50,
  "limiteHorasCancelacion": 3,
  "politicaReembolso": "reembolso",
  "minutosRetencionMP": 15,
  "minutosRetencionTransferencia": 30,
  "puntosPorHora": 10,
  "horaApertura": 9,
  "horaCierre": 24,
  "toleranciaMinutos": 25,
  "diasAnticipacion": 7,
  "maxHorasReserva": 2,
  "whatsapp": "5491122334455",
  "alias": "",
  "direccion": "",
  "instagram": "",
  "avisoPublico": "",
  "mostrarNombres": true,
  "pagoMercadoPago": true,
  "pagoTransferencia": false
}'::jsonb) on conflict (id) do nothing;

insert into public.canchas (id, nombre, tipo, precio_hora, orden) values
  ('f5', 'Cancha de Fútbol 5', 'Fútbol 5', 25000, 1),
  ('f7', 'Cancha de Fútbol 7', 'Fútbol 7', 35000, 2),
  ('padel', 'Cancha de Pádel', 'Pádel', 18000, 3)
on conflict (id) do nothing;
