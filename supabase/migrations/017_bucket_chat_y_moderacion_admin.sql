-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 017 — Bucket del chat + moderación del Administrador
--  Ejecutar en:  Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..016 aplicadas. Es idempotente.
--
--  Dos arreglos:
--   1. El bucket `archivos_mmcapital` (el que usa el chat en `chat/<uid>/...`,
--      ver src/services/storageService.js) se garantiza creado y público, con
--      lectura pública y subida/borrado para autenticados. Sin el bucket, el
--      clip del compositor fallaba con «Bucket not found».
--   2. El Administrador puede BORRAR cualquier mensaje del chat, no solo los
--      suyos: moderación real del canal General y de los directos.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
--  1. STORAGE · bucket de los adjuntos del chat
--
--  NOTA: storage.buckets/objects pertenecen a supabase_storage_admin. Si este
--  bloque falla con «must be owner of table objects», crea el bucket desde
--  Storage -> New bucket (nombre `archivos_mmcapital`, Public ON) y las
--  políticas desde Storage -> archivos_mmcapital -> Policies con las
--  expresiones de abajo. El bloque 2 (RLS de mensajes) es independiente.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('archivos_mmcapital', 'archivos_mmcapital', true)
on conflict (id) do update set public = true;

-- Lectura pública: es lo que hace funcionar las URLs públicas de los adjuntos,
-- los avatares y las portadas.
drop policy if exists "mmcapital_lectura_publica" on storage.objects;
create policy "mmcapital_lectura_publica" on storage.objects
  for select using (bucket_id = 'archivos_mmcapital');

-- Subir: cualquier usuario autenticado. La 012 lo limitaba a la carpeta propia
-- y al rol de socio; se abre para que ningún rol con acceso al chat se quede
-- sin poder adjuntar.
drop policy if exists "mmcapital_subida_autenticados" on storage.objects;
create policy "mmcapital_subida_autenticados" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'archivos_mmcapital');

-- Actualizar (upsert de avatar/portada) y borrar: usuarios autenticados.
drop policy if exists "mmcapital_update_autenticados" on storage.objects;
create policy "mmcapital_update_autenticados" on storage.objects
  for update to authenticated
  using      (bucket_id = 'archivos_mmcapital')
  with check (bucket_id = 'archivos_mmcapital');

drop policy if exists "mmcapital_borrado_autenticados" on storage.objects;
create policy "mmcapital_borrado_autenticados" on storage.objects
  for delete to authenticated
  using (bucket_id = 'archivos_mmcapital');

-- ═══════════════════════════════════════════════════════════════════════════
--  2. RLS · el Administrador modera el chat
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- Red de seguridad: `es_admin()` existe desde la 001, pero se redeclara aquí
-- para que la migración sea autosuficiente si se ejecuta suelta.
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select rol = 'admin' from public.usuarios where id = auth.uid()),
    false
  );
$$;

alter table public.mensajes enable row level security;

-- Borrar: el autor del mensaje O un administrador, sobre CUALQUIER fila de la
-- tabla (canal General y directos por igual).
drop policy if exists "mensajes_borrado" on public.mensajes;
create policy "mensajes_borrado" on public.mensajes
  for delete to authenticated
  using (usuario_id = auth.uid() or public.es_admin());

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
-- ═══════════════════════════════════════════════════════════════════════════
select id, public from storage.buckets where id = 'archivos_mmcapital';

select policyname, cmd from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'mmcapital_%'
 order by policyname;

select policyname, cmd, qual from pg_policies
 where schemaname = 'public' and tablename = 'mensajes'
 order by policyname;
