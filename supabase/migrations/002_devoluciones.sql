-- El personal registra que devolvió a mano una seña (pagos que no se pudieron aplicar).
create or replace function public.staff_marcar_devuelta(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_staff() then raise exception 'No tenés permisos para esta acción.' using errcode = 'P0001'; end if;
  update public.reservas
     set pago_estado = 'reembolsado',
         notas = trim(both E'\n' from coalesce(notas, '') || E'\nSeña devuelta a mano el ' || to_char(public.hoy_ar(), 'DD/MM/YYYY') || '.')
   where id = p_id and pago_estado = 'reembolso_pendiente';
end $$;
revoke execute on function public.staff_marcar_devuelta(uuid) from public, anon;
grant execute on function public.staff_marcar_devuelta(uuid) to authenticated;
