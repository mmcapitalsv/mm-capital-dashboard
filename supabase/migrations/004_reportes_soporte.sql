-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 004 — Reportes de Soporte Ejecutivo
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001 aplicada (usa public.es_admin()). Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.reportes_soporte (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  mensaje     text not null,
  estado      text not null default 'pendiente'
                check (estado in ('pendiente', 'en_proceso', 'resuelto')),
  created_at  timestamptz not null default now()
);

create index if not exists idx_reportes_usuario on public.reportes_soporte (usuario_id);
create index if not exists idx_reportes_estado  on public.reportes_soporte (estado, created_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.reportes_soporte enable row level security;

drop policy if exists "reportes_insertar_propio" on public.reportes_soporte;
drop policy if exists "reportes_leer"            on public.reportes_soporte;
drop policy if exists "reportes_admin_gestiona"  on public.reportes_soporte;

-- Cualquier autenticado puede enviar un reporte, pero solo a su propio nombre
create policy "reportes_insertar_propio" on public.reportes_soporte
  for insert to authenticated
  with check (usuario_id = auth.uid());

-- Cada quien lee los suyos; el administrador los lee todos
create policy "reportes_leer" on public.reportes_soporte
  for select to authenticated
  using (usuario_id = auth.uid() or public.es_admin());

-- Solo el administrador actualiza el estado o elimina
create policy "reportes_admin_gestiona" on public.reportes_soporte
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ── Realtime ──────────────────────────────────────────────────────────────
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.reportes_soporte';
  exception when others then
    raise notice 'Realtime para reportes_soporte omitido: %', sqlerrm;
  end;
end $$;

commit;
