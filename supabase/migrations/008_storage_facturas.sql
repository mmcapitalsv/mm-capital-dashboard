-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 008 — Comprobantes de facturas de proveedores
--
--  Crea el bucket público `facturas` y sus políticas RLS, para que el modal
--  "Registrar Factura" pueda subir la foto/PDF del comprobante sin chocar con
--  «new row violates row-level security policy», y cualquier socio o
--  inversionista pueda verlo y descargarlo desde el visor de alta calidad.
--
--  La URL pública resultante se guarda en `public.gastos.comprobante`.
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..007 aplicadas (usa public.es_admin()). Idempotente.
--
--  Estructura de rutas usada por la app:
--     proyecto_<uuid>/<timestamp>_<archivo>   ← comprobante de una factura
--     sin_proyecto/<timestamp>_<archivo>      ← respaldo si no hay proyecto
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Columnas de `gastos` (defensivo: 007 ya las creó) ──────────────────
alter table public.gastos add column if not exists proveedor   text default '';
alter table public.gastos add column if not exists concepto    text default '';
alter table public.gastos add column if not exists comprobante text default '';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  2. STORAGE · bucket `facturas`
--
--  NOTA: storage.objects pertenece a supabase_storage_admin. Si este bloque
--  falla con «must be owner of table objects», crea el bucket desde
--  Storage -> New bucket -> nombre `facturas`, marcado como Public, y las
--  mismas políticas desde Storage -> facturas -> Policies.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('facturas', 'facturas', true)
on conflict (id) do update set public = true;

-- Lectura pública: las miniaturas y el visor usan la URL pública del objeto
drop policy if exists "facturas_lectura_publica" on storage.objects;
create policy "facturas_lectura_publica" on storage.objects
  for select using (bucket_id = 'facturas');

-- Subida: cualquier usuario autenticado puede adjuntar el comprobante.
-- Quien realmente registra la factura sigue siendo el Administrador (la fila
-- de `gastos` está protegida por sus propias políticas); esto solo evita el
-- 403 al subir el binario.
drop policy if exists "facturas_subida_autenticada" on storage.objects;
create policy "facturas_subida_autenticada" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'facturas');

-- Reemplazar un comprobante (upsert de la app) también queda permitido
drop policy if exists "facturas_actualiza_autenticada" on storage.objects;
create policy "facturas_actualiza_autenticada" on storage.objects
  for update to authenticated
  using      (bucket_id = 'facturas')
  with check (bucket_id = 'facturas');

-- Borrar un comprobante es cosa del Administrador: un comprobante es
-- respaldo contable y no debe poder eliminarlo cualquiera.
drop policy if exists "facturas_borrado_admin" on storage.objects;
create policy "facturas_borrado_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'facturas' and public.es_admin());

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
-- ═══════════════════════════════════════════════════════════════════════════
select policyname, cmd, roles
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'facturas%'
 order by policyname;
