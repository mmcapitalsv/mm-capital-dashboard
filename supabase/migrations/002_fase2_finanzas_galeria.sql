-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 002 — Fase 2 (finanzas editables y galería real)
--  Ejecutar en:  Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere que 001_esquema_mmcapital.sql ya se haya aplicado.
--  Es idempotente: se puede volver a ejecutar sin romper nada.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Finanzas editables por proyecto ────────────────────────────────────
alter table public.proyectos add column if not exists anticipo        numeric(14,2) default 0;
alter table public.proyectos add column if not exists cuota_asignada  numeric(14,2) default 0;

-- El presupuesto ya existía; se asegura que tenga default para no romper inserts
alter table public.proyectos alter column presupuesto_total set default 0;

-- ── 2. Álbumes de galería (antes vivían solo en memoria del navegador) ────
create table if not exists public.galeria_albumes (
  id           uuid primary key default gen_random_uuid(),
  proyecto_id  uuid references public.proyectos(id) on delete cascade,
  titulo       text not null default 'Álbum sin título',
  fecha_texto  text default '',
  portada_url  text,
  created_at   timestamptz default now()
);

create index if not exists idx_galeria_albumes_proyecto
  on public.galeria_albumes (proyecto_id, created_at);

-- ── 3. Vincular cada foto a su álbum ──────────────────────────────────────
alter table public.archivos
  add column if not exists album_id uuid references public.galeria_albumes(id) on delete set null;

create index if not exists idx_archivos_album on public.archivos (album_id);

-- ── 4. RLS: lectura para autenticados, escritura solo administradores ─────
--     Reutiliza la función public.es_admin() creada en la migración 001.
alter table public.galeria_albumes enable row level security;

drop policy if exists "lectura_autenticados" on public.galeria_albumes;
drop policy if exists "escritura_admin"      on public.galeria_albumes;

create policy "lectura_autenticados" on public.galeria_albumes
  for select to authenticated using (true);

create policy "escritura_admin" on public.galeria_albumes
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ── 5. Realtime ───────────────────────────────────────────────────────────
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.galeria_albumes';
  exception when others then
    raise notice 'Realtime para galeria_albumes omitido: %', sqlerrm;
  end;
end $$;

commit;
