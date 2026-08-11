-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 018 — Buckets PRIVADOS y lectura solo autenticada
--  Ejecutar en:  Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..017 aplicadas. Es idempotente.
--
--  Hallazgo P0.1 de la auditoría: los buckets `archivos_mmcapital` y
--  `facturas` estaban marcados `public = true` y con una política de SELECT
--  SIN rol (`for select using (bucket_id = ...)`), que en Supabase alcanza
--  también a `anon`. Consecuencia: cualquiera con la URL —o adivinando la
--  ruta, que es predecible: `proyecto_<uuid>/<timestamp>_<nombre>`— leía
--  contratos, comprobantes contables, adjuntos privados del chat y avatares
--  sin haber iniciado sesión nunca.
--
--  Esta migración:
--    1. Pone los dos buckets en `public = false`. Las URLs `/object/public/`
--       dejan de resolver; la app pasa a `createSignedUrl` (TTL 1 h), ver
--       src/lib/urlFirmada.js.
--    2. Reemplaza TODA política de lectura sin rol por una `to authenticated`.
--       Se eliminan por nombre las de las migraciones 001, 005, 008 y 017.
--
--  NOTA: storage.buckets/objects pertenecen a supabase_storage_admin. Si algún
--  bloque falla con «must be owner of table objects», hazlo desde el panel:
--  Storage -> <bucket> -> Settings -> Public bucket OFF, y las políticas desde
--  Storage -> <bucket> -> Policies con las expresiones de abajo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
--  1. Los buckets dejan de ser públicos
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('archivos_mmcapital', 'archivos_mmcapital', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('facturas', 'facturas', false)
on conflict (id) do update set public = false;

-- ═══════════════════════════════════════════════════════════════════════════
--  2. Lectura: SOLO usuarios autenticados
--
--  `to authenticated` es la parte que importa. Sin ese rol la política se
--  evalúa también para `anon`, que es exactamente el agujero que se cierra.
--  Con el bucket privado, la firma de `createSignedUrl` la emite el servidor
--  únicamente si estas políticas dejan leer el objeto al usuario que la pide.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Bucket `archivos_mmcapital` ──────────────────────────────────────────
-- Lecturas heredadas sin rol (001, 005, 017) y la de avatares de la 005.
drop policy if exists "mmcapital_lectura_publica"      on storage.objects;
drop policy if exists "mmcapital_avatar_propio_select" on storage.objects;
drop policy if exists "mmcapital_lectura_autenticada"  on storage.objects;

create policy "mmcapital_lectura_autenticada" on storage.objects
  for select to authenticated
  using (bucket_id = 'archivos_mmcapital');

-- ── Bucket `facturas` ────────────────────────────────────────────────────
-- La 008 y la 015 la recrearon siempre sin rol: se sustituye por la de rol.
drop policy if exists "facturas_lectura_publica"     on storage.objects;
drop policy if exists "facturas_lectura_autenticada" on storage.objects;

create policy "facturas_lectura_autenticada" on storage.objects
  for select to authenticated
  using (bucket_id = 'facturas');

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
--
--  Lo que se espera:
--    · `public` = false en los dos buckets.
--    · Ninguna política de SELECT sobre estos buckets con `roles = {public}`.
-- ═══════════════════════════════════════════════════════════════════════════

select id, public from storage.buckets
 where id in ('archivos_mmcapital', 'facturas')
 order by id;

select policyname, cmd, roles
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and (policyname like 'mmcapital_%' or policyname like 'facturas%')
 order by cmd, policyname;
