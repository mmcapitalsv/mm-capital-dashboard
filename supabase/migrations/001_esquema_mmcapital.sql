-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración de esquema
--  Ejecutar en:  Supabase Dashboard -> SQL Editor -> New query -> Run
--
--  Corrige lo detectado contra la base real:
--   · checklist_hitos NO tenía columna de título (era imposible guardar la tarea)
--   · proyectos NO tenía porcentaje_avance / imagen_url / fecha_entrega / tag
--   · usuarios.nombre_completo es NOT NULL -> todo INSERT lo rellena con COALESCE
--   · las tablas estaban vacías, por eso el frontend caía a IDs falsos '1','2','3'
--     y Supabase respondía: invalid input syntax for type uuid: "2"
--
--  Es idempotente: se puede volver a ejecutar sin romper nada.
--  Todo el bloque 1-8 va en una transacción; si algo falla, no queda a medias.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. checklist_hitos: columnas que faltaban ──────────────────────────────
alter table public.checklist_hitos add column if not exists titulo       text not null default 'Hito sin título';
alter table public.checklist_hitos add column if not exists descripcion  text default '';
alter table public.checklist_hitos add column if not exists fecha_texto  text default '';
alter table public.checklist_hitos alter column completado set default false;
alter table public.checklist_hitos alter column orden      set default 0;

create index if not exists idx_checklist_hitos_proyecto on public.checklist_hitos (proyecto_id, orden);

-- ── 2. proyectos: columnas que la app espera ──────────────────────────────
alter table public.proyectos add column if not exists porcentaje_avance int  default 0;
alter table public.proyectos add column if not exists imagen_url        text;
alter table public.proyectos add column if not exists fecha_entrega     date;
alter table public.proyectos add column if not exists tag               text;

-- ── 3. usuarios ───────────────────────────────────────────────────────────
-- La tabla real usa `nombre_completo` y es NOT NULL. Se le pone un DEFAULT
-- para que ningún INSERT que lo omita choque con la restricción, sin tener
-- que debilitar el NOT NULL.
alter table public.usuarios add column if not exists nombre_completo text;
alter table public.usuarios alter column nombre_completo set default 'Usuario MM Capital';
update public.usuarios
   set nombre_completo = coalesce(nullif(trim(nombre_completo), ''), split_part(email, '@', 1), 'Usuario MM Capital')
 where nombre_completo is null or trim(nombre_completo) = '';

-- ── 4. archivos: ruta dentro del bucket (necesaria para borrar del Storage) ─
alter table public.archivos add column if not exists storage_path text;

-- ── 4b. Blindaje: NOT NULL sin DEFAULT ────────────────────────────────────
-- La clave `anon` no permite leer el catálogo de constraints, así que en vez
-- de adivinar qué columnas son NOT NULL, este bloque las busca y les pone un
-- DEFAULT acorde a su tipo. Solo toca columnas que YA son NOT NULL y que NO
-- tienen default: son exactamente las que romperían los INSERT de más abajo.
-- Cada ajuste se reporta con RAISE NOTICE para que quede visible.
do $$
declare
  r        record;
  v_default text;
begin
  for r in
    select c.table_name, c.column_name, c.data_type
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name in ('proyectos','checklist_hitos','usuarios','archivos','gastos')
       and c.is_nullable = 'NO'
       and c.column_default is null
       and c.is_identity = 'NO'
  loop
    v_default := case
      when r.data_type in ('text','character varying','character','citext')          then quote_literal('')
      when r.data_type in ('integer','bigint','smallint','numeric','real',
                           'double precision')                                       then '0'
      when r.data_type = 'boolean'                                                   then 'false'
      when r.data_type in ('timestamp with time zone','timestamp without time zone') then 'now()'
      when r.data_type = 'date'                                                      then 'current_date'
      when r.data_type = 'uuid'                                                      then 'gen_random_uuid()'
      when r.data_type in ('json','jsonb')                                           then quote_literal('{}') || '::jsonb'
      else null
    end;

    if v_default is not null then
      execute format('alter table public.%I alter column %I set default %s',
                     r.table_name, r.column_name, v_default);
      raise notice 'DEFAULT aplicado a %.% (tipo %) para no chocar con su NOT NULL',
                   r.table_name, r.column_name, r.data_type;
    else
      raise notice 'ATENCION: %.% es NOT NULL, tipo % y sin default; podria bloquear inserts',
                   r.table_name, r.column_name, r.data_type;
    end if;
  end loop;
end $$;

-- ── 5. Datos semilla de los 3 proyectos (genera UUIDs reales) ─────────────
--     Sin esto el frontend sigue inventando IDs '1','2','3' y falla el guardado.
insert into public.proyectos (nombre, ubicacion, descripcion, estado, presupuesto_total, tag, fecha_entrega, imagen_url)
select * from (values
  ('Proyecto San Martín',     'Colonia Santa María, San Martín', 'Desarrollo residencial de lujo con acabados premium y amenidades exclusivas.', 'En Progreso',   1480000, 'Desarrollo Residencial',  date '2025-11-30', 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=80'),
  ('Proyecto Chalchuapa',     'Chalchuapa, Santa Ana',           'Complejo residencial accesible. Terreno adquirido por $32,000 USD.',           'En Ejecución',   850000, 'Residencial Accesible',   date '2025-12-15', 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80'),
  ('Proyecto San Juan Opico', 'San Juan Opico, La Libertad',     'Desarrollo industrial y comercial estratégico. Saldo de terreno pendiente.',   'Fase Inicial',   100000, 'Industrial / Comercial',  date '2026-03-30', 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=80')
) as v(nombre, ubicacion, descripcion, estado, presupuesto_total, tag, fecha_entrega, imagen_url)
where not exists (select 1 from public.proyectos);

-- ── 6. Row Level Security ─────────────────────────────────────────────────
alter table public.proyectos       enable row level security;
alter table public.checklist_hitos enable row level security;
alter table public.usuarios        enable row level security;
alter table public.archivos        enable row level security;
alter table public.gastos          enable row level security;

-- Helper: ¿el usuario autenticado es administrador?
create or replace function public.es_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select rol in ('admin','socio_administrador') from public.usuarios where id = auth.uid()),
    (select auth.jwt() ->> 'email') = 'luisp.bomel@gmail.com',
    false
  );
$$;

-- Lectura: cualquier usuario autenticado. Escritura: solo administradores.
do $$
declare t text;
begin
  foreach t in array array['proyectos','checklist_hitos','archivos','gastos'] loop
    execute format('drop policy if exists "lectura_autenticados" on public.%I', t);
    execute format('drop policy if exists "escritura_admin" on public.%I', t);
    execute format('create policy "lectura_autenticados" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "escritura_admin" on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;

-- usuarios: cada quien ve su fila; el admin ve y edita todas.
drop policy if exists "usuarios_lectura"   on public.usuarios;
drop policy if exists "usuarios_escritura" on public.usuarios;
create policy "usuarios_lectura"   on public.usuarios for select to authenticated using (id = auth.uid() or public.es_admin());
create policy "usuarios_escritura" on public.usuarios for all    to authenticated using (public.es_admin()) with check (public.es_admin());

-- ── 7. Alta automática en `usuarios` al registrarse en Auth ───────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Se usa WHERE NOT EXISTS en lugar de ON CONFLICT porque este último exige
  -- que exista un índice único sobre `id`; así funciona sea cual sea el caso.
  insert into public.usuarios (id, email, nombre_completo, rol)
  select
    new.id,
    new.email,
    -- nombre_completo es NOT NULL: la cascada garantiza que nunca llegue null
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      case when new.email = 'luisp.bomel@gmail.com' then 'Luis Panameño' end,
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuario MM Capital'
    ),
    case when new.email = 'luisp.bomel@gmail.com' then 'admin' else 'inversionista' end
  where not exists (select 1 from public.usuarios where id = new.id);

  return new;
exception
  -- Nunca bloquear el registro de un usuario por un fallo al espejarlo aquí
  when others then
    raise warning 'No se pudo crear la fila en public.usuarios para %: %', new.id, sqlerrm;
    return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: mete en `usuarios` a quien ya se registró antes de este trigger.
-- El COALESCE evita el error 23502 sobre nombre_completo (NOT NULL).
insert into public.usuarios (id, email, nombre_completo, rol)
select
  u.id,
  u.email,
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
    case when u.email = 'luisp.bomel@gmail.com' then 'Luis Panameño' end,
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'Usuario MM Capital'
  ),
  case when u.email = 'luisp.bomel@gmail.com' then 'admin' else 'inversionista' end
from auth.users u
where u.email is not null
  and not exists (select 1 from public.usuarios x where x.id = u.id);

-- Asegura que el administrador real tenga rol y nombre correctos
update public.usuarios
   set rol = 'admin',
       nombre_completo = coalesce(nullif(trim(nombre_completo), ''), 'Luis Panameño')
 where email = 'luisp.bomel@gmail.com';

-- ── 8. Realtime (para que la UI se actualice sola, tipo Excel) ────────────
do $$
declare t text;
begin
  foreach t in array array['proyectos','checklist_hitos','usuarios','archivos','gastos'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      -- ya estaba publicada, o la publicación no existe en este proyecto:
      -- ninguno de los dos casos debe abortar la migración completa.
      when others then
        raise notice 'Realtime para % omitido: %', t, sqlerrm;
    end;
  end loop;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  9. STORAGE · bucket archivos_mmcapital
--     (el bucket ya existe; esto solo le pone las políticas de acceso)
--
--  NOTA: storage.objects pertenece al rol supabase_storage_admin. Si este
--  bloque falla con «must be owner of table objects», crea las mismas dos
--  políticas desde el panel: Storage -> archivos_mmcapital -> Policies.
--  El resto de la migración (arriba) ya se aplicó y no se ve afectado.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('archivos_mmcapital', 'archivos_mmcapital', true)
on conflict (id) do update set public = true;

drop policy if exists "mmcapital_lectura_publica" on storage.objects;
drop policy if exists "mmcapital_escritura_admin" on storage.objects;

create policy "mmcapital_lectura_publica" on storage.objects
  for select using (bucket_id = 'archivos_mmcapital');

create policy "mmcapital_escritura_admin" on storage.objects
  for all to authenticated
  using      (bucket_id = 'archivos_mmcapital' and public.es_admin())
  with check (bucket_id = 'archivos_mmcapital' and public.es_admin());
