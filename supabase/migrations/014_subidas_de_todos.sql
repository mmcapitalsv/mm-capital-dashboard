-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 014 — Subir es de todos; borrar es de quien subió
--  Ejecutar en:  Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..013 aplicadas. Es idempotente.
--
--  Regla nueva, igual en Bóveda, Documentos de proyecto y Galería:
--    · SUBIR      — cualquier usuario autenticado.
--    · MODIFICAR  — solo quien lo subió.
--    · ELIMINAR   — solo quien lo subió.
--    · El Administrador puede modificar y eliminar CUALQUIER cosa, la haya
--      subido él o no.
--
--  Hasta ahora `archivos` y `galeria_albumes` tenían una sola política de
--  escritura (`escritura_admin`, migración 001/002) que exigía es_admin() para
--  insert, update y delete por igual: un socio director o un inversionista no
--  podía ni adjuntar una foto de obra.
--
--  Para saber de quién es cada fila se añade la columna `subido_por`, con
--  DEFAULT auth.uid(): la app no necesita mandarla y, aunque la mandara, la
--  política de inserción solo acepta que sea uno mismo.
--
--  NOTA sobre las filas ANTERIORES a esta migración: se quedan con
--  `subido_por` en NULL a propósito. NULL no coincide con ningún auth.uid(),
--  así que siguen siendo territorio exclusivo del Administrador — que es
--  exactamente el permiso que tenían hasta hoy.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Columna de autoría ─────────────────────────────────────────────────
alter table public.archivos
  add column if not exists subido_por uuid references public.usuarios(id) on delete set null;

alter table public.galeria_albumes
  add column if not exists subido_por uuid references public.usuarios(id) on delete set null;

-- El DEFAULT es lo que hace que el cliente no tenga que enviar nada: la fila
-- nace ya firmada por quien la inserta.
alter table public.archivos        alter column subido_por set default auth.uid();
alter table public.galeria_albumes alter column subido_por set default auth.uid();

create index if not exists idx_archivos_subido_por        on public.archivos        (subido_por);
create index if not exists idx_galeria_albumes_subido_por on public.galeria_albumes (subido_por);

comment on column public.archivos.subido_por is
  'Quién subió el archivo. Manda sobre quién puede renombrarlo o borrarlo. NULL = anterior a la migración 014: solo el Administrador.';
comment on column public.galeria_albumes.subido_por is
  'Quién creó el álbum. Manda sobre quién puede editarlo o borrarlo. NULL = anterior a la migración 014: solo el Administrador.';

-- ── 2. La autoría no se reescribe ─────────────────────────────────────────
-- Sin esto, quien sube un archivo podría después ponerlo a nombre de otro (o
-- quitárselo de encima). Solo el Administrador puede reasignar.
create or replace function public.conserva_autoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.es_admin() then
    return new;                      -- service_role, migraciones o admin real
  end if;

  new.subido_por := old.subido_por;
  return new;
end $$;

drop trigger if exists trg_archivos_conserva_autoria on public.archivos;
create trigger trg_archivos_conserva_autoria
  before update on public.archivos
  for each row execute function public.conserva_autoria();

drop trigger if exists trg_galeria_albumes_conserva_autoria on public.galeria_albumes;
create trigger trg_galeria_albumes_conserva_autoria
  before update on public.galeria_albumes
  for each row execute function public.conserva_autoria();

-- ── 3. RLS de `archivos` ──────────────────────────────────────────────────
-- La política única `escritura_admin` (FOR ALL) se sustituye por tres, una por
-- verbo: solo así puede ser abierta en INSERT y cerrada en UPDATE/DELETE.
alter table public.archivos enable row level security;

drop policy if exists "escritura_admin"         on public.archivos;
drop policy if exists "archivos_insertar"       on public.archivos;
drop policy if exists "archivos_actualizar"     on public.archivos;
drop policy if exists "archivos_eliminar"       on public.archivos;

-- La lectura no se toca: sigue siendo `lectura_autenticados` (migración 001).

create policy "archivos_insertar" on public.archivos
  for insert to authenticated
  with check (subido_por = auth.uid() or public.es_admin());

create policy "archivos_actualizar" on public.archivos
  for update to authenticated
  using      (subido_por = auth.uid() or public.es_admin())
  with check (subido_por = auth.uid() or public.es_admin());

create policy "archivos_eliminar" on public.archivos
  for delete to authenticated
  using (subido_por = auth.uid() or public.es_admin());

-- ── 4. RLS de `galeria_albumes` ───────────────────────────────────────────
alter table public.galeria_albumes enable row level security;

drop policy if exists "escritura_admin"     on public.galeria_albumes;
drop policy if exists "albumes_insertar"    on public.galeria_albumes;
drop policy if exists "albumes_actualizar"  on public.galeria_albumes;
drop policy if exists "albumes_eliminar"    on public.galeria_albumes;

create policy "albumes_insertar" on public.galeria_albumes
  for insert to authenticated
  with check (subido_por = auth.uid() or public.es_admin());

create policy "albumes_actualizar" on public.galeria_albumes
  for update to authenticated
  using      (subido_por = auth.uid() or public.es_admin())
  with check (subido_por = auth.uid() or public.es_admin());

create policy "albumes_eliminar" on public.galeria_albumes
  for delete to authenticated
  using (subido_por = auth.uid() or public.es_admin());

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  5. STORAGE · el binario obedece la misma regla que su ficha
--
--  La tabla de arriba gobierna el REGISTRO del archivo; esto gobierna el
--  ARCHIVO. Sin los dos, un usuario podría borrar su fila pero no su binario
--  (basura en el bucket) o al revés.
--
--  `storage.objects` guarda a quién pertenece cada objeto en `owner` (uuid) y,
--  en versiones nuevas, también en `owner_id` (texto). Supabase lo rellena
--  solo con el auth.uid() de quien sube, así que aquí no hay nada que enviar
--  desde la app. Se comprueban los dos por compatibilidad.
--
--  NOTA: storage.objects pertenece a supabase_storage_admin. Si este bloque
--  falla con «must be owner of table objects», crea las mismas políticas desde
--  Storage -> archivos_mmcapital -> Policies. Lo de arriba ya quedó aplicado.
-- ═══════════════════════════════════════════════════════════════════════════

-- La política de la 005 era FOR ALL con es_admin(): concedía y negaba los tres
-- verbos a la vez. Se reemplaza por tres, con la misma regla que la tabla.
drop policy if exists "mmcapital_escritura_admin"    on storage.objects;
drop policy if exists "mmcapital_subida_autenticada" on storage.objects;
drop policy if exists "mmcapital_edita_propio"       on storage.objects;
drop policy if exists "mmcapital_borra_propio"       on storage.objects;

-- Subir: cualquier usuario autenticado, en cualquier carpeta del bucket.
create policy "mmcapital_subida_autenticada" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'archivos_mmcapital');

-- Reemplazar el binario (la app sube con upsert): el dueño o el Administrador.
create policy "mmcapital_edita_propio" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'archivos_mmcapital'
    and (owner = auth.uid() or owner_id = auth.uid()::text or public.es_admin())
  )
  with check (
    bucket_id = 'archivos_mmcapital'
    and (owner = auth.uid() or owner_id = auth.uid()::text or public.es_admin())
  );

-- Borrar: el dueño o el Administrador.
create policy "mmcapital_borra_propio" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'archivos_mmcapital'
    and (owner = auth.uid() or owner_id = auth.uid()::text or public.es_admin())
  );

-- Las políticas de avatares (005) y de adjuntos del chat (012) siguen vigentes
-- y son ADICIONALES: PostgreSQL concede si CUALQUIERA de ellas permite. No hay
-- que tocarlas.

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
-- ═══════════════════════════════════════════════════════════════════════════
select tablename, policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('archivos', 'galeria_albumes')
 order by tablename, policyname;

select policyname, cmd
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'mmcapital_%'
 order by policyname;

-- Debe existir la columna en las dos tablas, con default auth.uid()
select table_name, column_name, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('archivos', 'galeria_albumes')
   and column_name = 'subido_por';
