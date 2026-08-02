-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 003 — Inversiones de socios
--  Ejecutar en:  Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001 y 002 aplicadas. Es idempotente: se puede reejecutar.
--
--  Crea la tabla `aportaciones` que relaciona usuario_id + proyecto_id + monto,
--  y siembra a Giovanni Morales (Socio Director) con sus tres inversiones:
--      $5,000  -> San Juan Opico
--      $32,000 -> Chalchuapa
--      $2,000  -> San Martín
--      ---------------------------
--      $39,000 total
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Tabla de aportaciones ──────────────────────────────────────────────
create table if not exists public.aportaciones (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.usuarios(id)  on delete cascade,
  proyecto_id  uuid not null references public.proyectos(id) on delete cascade,
  monto        numeric(14,2) not null default 0 check (monto >= 0),
  fecha        date default current_date,
  nota         text default '',
  created_at   timestamptz default now()
);

create index if not exists idx_aportaciones_usuario  on public.aportaciones (usuario_id);
create index if not exists idx_aportaciones_proyecto on public.aportaciones (proyecto_id);

-- Un socio puede aportar varias veces al mismo proyecto, pero para que la
-- semilla sea reejecutable sin duplicar se usa una clave única por
-- (usuario, proyecto, monto, fecha).
create unique index if not exists uq_aportacion_semilla
  on public.aportaciones (usuario_id, proyecto_id, monto, fecha);

-- ── 2. RLS: lectura para autenticados, escritura solo administradores ─────
alter table public.aportaciones enable row level security;

drop policy if exists "lectura_autenticados" on public.aportaciones;
drop policy if exists "escritura_admin"      on public.aportaciones;

create policy "lectura_autenticados" on public.aportaciones
  for select to authenticated using (true);

create policy "escritura_admin" on public.aportaciones
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ── 3. Giovanni Morales como Socio Director ───────────────────────────────
-- No tiene cuenta en auth.users todavía, así que se crea solo su ficha en
-- `usuarios`. Cuando se registre con este mismo correo, el trigger de la
-- migración 001 respeta la fila existente (usa WHERE NOT EXISTS) y conserva
-- su rol y sus aportaciones.

-- 3a. Corrección de correo: una versión anterior de esta migración usó
--     giovanni.morales@mmcapital.com. Si esa fila existe se le cambia el
--     correo en lugar de crear un duplicado, así conserva sus aportaciones
--     y NO se suman $39,000 por partida doble.
update public.usuarios
   set email = 'ingeovannimorales@gmail.com'
 where lower(email) = 'giovanni.morales@mmcapital.com'
   and not exists (
     select 1 from public.usuarios u2
      where lower(u2.email) = 'ingeovannimorales@gmail.com'
   );

-- 3b. Si quedaron las dos filas (porque ambas ya existían), se traspasan las
--     aportaciones a la ficha correcta y se elimina la antigua.
do $$
declare v_viejo uuid; v_nuevo uuid;
begin
  select id into v_viejo from public.usuarios where lower(email) = 'giovanni.morales@mmcapital.com' limit 1;
  select id into v_nuevo from public.usuarios where lower(email) = 'ingeovannimorales@gmail.com'    limit 1;

  if v_viejo is not null and v_nuevo is not null and v_viejo <> v_nuevo then
    -- Mueve solo las que no dupliquen la clave única (usuario, proyecto, monto, fecha)
    update public.aportaciones a
       set usuario_id = v_nuevo
     where a.usuario_id = v_viejo
       and not exists (
         select 1 from public.aportaciones b
          where b.usuario_id = v_nuevo
            and b.proyecto_id = a.proyecto_id
            and b.monto = a.monto
            and b.fecha = a.fecha
       );
    delete from public.aportaciones where usuario_id = v_viejo;   -- sobrantes duplicados
    delete from public.usuarios     where id = v_viejo;
    raise notice 'Ficha antigua de Giovanni fusionada en ingeovannimorales@gmail.com';
  end if;
end $$;

insert into public.usuarios (id, email, nombre_completo, rol)
select gen_random_uuid(), 'ingeovannimorales@gmail.com', 'Giovanni Morales', 'socio_director'
where not exists (
  select 1 from public.usuarios where lower(email) = 'ingeovannimorales@gmail.com'
);

-- Si ya existía, se asegura su rol y nombre
update public.usuarios
   set rol = 'socio_director',
       nombre_completo = coalesce(nullif(trim(nombre_completo), ''), 'Giovanni Morales')
 where lower(email) = 'ingeovannimorales@gmail.com';

-- ── 4. Sus tres inversiones ───────────────────────────────────────────────
-- Los proyectos se buscan por nombre (ILIKE) porque sus UUID se generaron en
-- la migración 001 y no se conocen de antemano.
with socio as (
  select id from public.usuarios
   where lower(email) = 'ingeovannimorales@gmail.com'
   limit 1
),
inversiones(patron, monto) as (
  values
    ('%opico%',      5000::numeric),
    ('%chalchuapa%', 32000::numeric),
    ('%martin%',     2000::numeric)
)
insert into public.aportaciones (usuario_id, proyecto_id, monto, fecha, nota)
select
  s.id,
  p.id,
  i.monto,
  current_date,
  'Aportación inicial registrada en la migración 003'
from socio s
cross join inversiones i
join lateral (
  select pr.id
    from public.proyectos pr
   -- translate() quita las tildes sin necesitar la extensión unaccent:
   -- así '%martin%' sí encuentra "Proyecto San Martín".
   where translate(pr.nombre, 'áéíóúüÁÉÍÓÚÜñÑ', 'aeiouuAEIOUUnN') ilike i.patron
   order by pr.created_at
   limit 1
) p on true
on conflict (usuario_id, proyecto_id, monto, fecha) do nothing;

-- ── 5. Realtime ───────────────────────────────────────────────────────────
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.aportaciones';
  exception when others then
    raise notice 'Realtime para aportaciones omitido: %', sqlerrm;
  end;
end $$;

commit;

-- ── Comprobación: debe devolver 3 filas sumando 39000 ─────────────────────
select
  u.nombre_completo,
  p.nombre as proyecto,
  a.monto
from public.aportaciones a
join public.usuarios  u on u.id = a.usuario_id
join public.proyectos p on p.id = a.proyecto_id
where lower(u.email) = 'ingeovannimorales@gmail.com'
order by a.monto desc;
