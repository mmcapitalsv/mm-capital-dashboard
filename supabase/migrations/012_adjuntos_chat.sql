-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 012 — Adjuntos en el chat
--  Ejecutar en:  Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..011 aplicadas. Es idempotente.
--
--  El botón del clip existía en el compositor pero no hacía nada: no había ni
--  columnas donde guardar el archivo ni permiso para que un socio subiera al
--  bucket. Esto añade las dos cosas.
--
--  Aplica al canal 'socios' y a los mensajes directos por igual: los dos viven
--  en la misma tabla `mensajes`.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Columnas del adjunto ──────────────────────────────────────────────
-- Se guarda la URL pública y los metadatos que la interfaz necesita para
-- pintar la burbuja sin tener que ir al bucket a preguntar: el nombre real
-- (el de la ruta va saneado), el tipo MIME y el peso.
alter table public.mensajes
  add column if not exists adjunto_url    text,
  add column if not exists adjunto_nombre text,
  add column if not exists adjunto_tipo   text,
  add column if not exists adjunto_tamano bigint;

-- ── 2. El texto deja de ser obligatorio si viaja un adjunto ──────────────
-- La 006 declaró `check (length(trim(contenido)) > 0)`. Mandar solo una foto,
-- sin escribir nada, es de lo más normal en un chat y ese check lo impedía.
-- Ahora se exige texto O adjunto, pero no se admite un mensaje vacío del todo.
alter table public.mensajes
  drop constraint if exists mensajes_contenido_check;

alter table public.mensajes
  add constraint mensajes_contenido_check
  check (length(trim(contenido)) > 0 or adjunto_url is not null);

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  3. STORAGE · permiso para que un socio suba SUS adjuntos
--
--  NOTA: storage.objects pertenece a supabase_storage_admin. Si este bloque
--  falla con «must be owner of table objects», crea las mismas políticas desde
--  Storage -> archivos_mmcapital -> Policies con las expresiones de abajo.
--  Lo anterior (las columnas) ya quedó aplicado y no se ve afectado.
--
--  Hasta ahora, escribir en `archivos_mmcapital` era exclusivo de los
--  administradores (política `mmcapital_escritura_admin` de la 005). Un socio
--  director podía escribir en el chat pero no subir un archivo, así que el
--  adjunto habría fallado con «new row violates row-level security policy».
--
--  Ruta usada por la app, igual en forma a la de los avatares:
--     chat/<uid>/<timestamp>_<archivo>
--  El segundo tramo es el uuid del dueño, y eso es lo que se comprueba.
-- ═══════════════════════════════════════════════════════════════════════════

-- Subir: solo dentro de SU propia carpeta, y solo si es socio del canal
drop policy if exists "mmcapital_chat_propio_insert" on storage.objects;
create policy "mmcapital_chat_propio_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'archivos_mmcapital'
    and (storage.foldername(name))[1] = 'chat'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.es_socio()
  );

-- Borrar: el dueño del archivo. Los administradores ya pueden por la 005.
drop policy if exists "mmcapital_chat_propio_delete" on storage.objects;
create policy "mmcapital_chat_propio_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'archivos_mmcapital'
    and (storage.foldername(name))[1] = 'chat'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- La lectura NO necesita política nueva: `mmcapital_lectura_publica` (005) ya
-- abre el bucket entero en SELECT, que es lo que hace funcionar las URLs
-- públicas del avatar y las portadas.

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
-- ═══════════════════════════════════════════════════════════════════════════
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'mensajes'
   and column_name like 'adjunto%'
 order by column_name;

select policyname, cmd from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'mmcapital_chat%'
 order by policyname;
