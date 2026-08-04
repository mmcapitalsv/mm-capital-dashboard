-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 005
--  Ejecutar en:  Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..004 aplicadas. Es idempotente.
--
--  1. STORAGE · corrige «new row violates row-level security policy» al subir
--     la foto de perfil: hasta ahora la única política de escritura del bucket
--     exigía public.es_admin(), así que cualquier socio que no fuera admin
--     recibía un 403 al subir su avatar.
--  2. usuarios · cada quien puede actualizar SU ficha (avatar_url), con un
--     trigger que impide escalar privilegios cambiándose el rol o el correo.
--  3. configuracion · tabla clave/valor para las cifras editables del panel
--     (capital total del portafolio).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Ficha propia: el usuario puede actualizar su avatar ────────────────
drop policy if exists "usuarios_actualiza_propio" on public.usuarios;
create policy "usuarios_actualiza_propio" on public.usuarios
  for update to authenticated
  using      (id = auth.uid())
  with check (id = auth.uid());

-- Blindaje: sin esto, la política de arriba dejaría que un inversionista se
-- ascendiera a 'admin' editando su propia fila. El rol, el correo y el id solo
-- los puede cambiar un administrador.
create or replace function public.usuarios_bloquea_escalada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.es_admin() then
    return new;                      -- service_role, migraciones o admin real
  end if;

  new.id    := old.id;
  new.rol   := old.rol;
  new.email := old.email;
  return new;
end $$;

drop trigger if exists trg_usuarios_bloquea_escalada on public.usuarios;
create trigger trg_usuarios_bloquea_escalada
  before update on public.usuarios
  for each row execute function public.usuarios_bloquea_escalada();

-- ── 2. Configuración editable del panel ───────────────────────────────────
create table if not exists public.configuracion (
  clave           text primary key,
  valor           jsonb       not null default '{}'::jsonb,
  actualizado_en  timestamptz not null default now(),
  actualizado_por uuid
);

alter table public.configuracion enable row level security;

drop policy if exists "configuracion_lectura"  on public.configuracion;
drop policy if exists "configuracion_escritura" on public.configuracion;

create policy "configuracion_lectura" on public.configuracion
  for select to authenticated using (true);

create policy "configuracion_escritura" on public.configuracion
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Capital total del portafolio: $1,000,000 por defecto, editable en MODO EDICIÓN
insert into public.configuracion (clave, valor)
values ('capital_total', jsonb_build_object('monto', 1000000))
on conflict (clave) do nothing;

-- Realtime: el dashboard reacciona al instante cuando cambia el capital
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.configuracion';
  exception when others then
    raise notice 'Realtime para configuracion omitido: %', sqlerrm;
  end;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  3. STORAGE · políticas del bucket archivos_mmcapital
--
--  NOTA: storage.objects pertenece a supabase_storage_admin. Si este bloque
--  falla con «must be owner of table objects», crea las mismas políticas desde
--  Storage -> archivos_mmcapital -> Policies con las expresiones de abajo.
--  Lo anterior ya quedó aplicado y no se ve afectado.
--
--  Estructura de rutas usada por la app:
--     avatares/<uid>/<timestamp>_<archivo>      ← foto de perfil (cada quien)
--     proyecto_<uuid>/...                       ← documentos y portadas
--     corporate_vault/...                       ← bóveda corporativa
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('archivos_mmcapital', 'archivos_mmcapital', true)
on conflict (id) do update set public = true;

-- Lectura pública del bucket (las URLs públicas del avatar y las portadas)
drop policy if exists "mmcapital_lectura_publica" on storage.objects;
create policy "mmcapital_lectura_publica" on storage.objects
  for select using (bucket_id = 'archivos_mmcapital');

-- Escritura total para administradores (bóveda, documentos, portadas)
drop policy if exists "mmcapital_escritura_admin" on storage.objects;
create policy "mmcapital_escritura_admin" on storage.objects
  for all to authenticated
  using      (bucket_id = 'archivos_mmcapital' and public.es_admin())
  with check (bucket_id = 'archivos_mmcapital' and public.es_admin());

-- ── Avatar propio: INSERT / UPDATE / DELETE / SELECT de SUS imágenes ──────
-- El segundo tramo de la ruta es el uuid del dueño: avatares/<uid>/archivo.jpg
drop policy if exists "mmcapital_avatar_propio_select" on storage.objects;
drop policy if exists "mmcapital_avatar_propio_insert" on storage.objects;
drop policy if exists "mmcapital_avatar_propio_update" on storage.objects;
drop policy if exists "mmcapital_avatar_propio_delete" on storage.objects;

create policy "mmcapital_avatar_propio_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'archivos_mmcapital'
    and (storage.foldername(name))[1] = 'avatares'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "mmcapital_avatar_propio_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'archivos_mmcapital'
    and (storage.foldername(name))[1] = 'avatares'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "mmcapital_avatar_propio_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'archivos_mmcapital'
    and (storage.foldername(name))[1] = 'avatares'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'archivos_mmcapital'
    and (storage.foldername(name))[1] = 'avatares'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "mmcapital_avatar_propio_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'archivos_mmcapital'
    and (storage.foldername(name))[1] = 'avatares'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
-- ═══════════════════════════════════════════════════════════════════════════
select policyname, cmd, roles
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'mmcapital%'
 order by policyname;
