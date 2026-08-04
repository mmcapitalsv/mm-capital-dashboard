-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 007 — Producción
--   1) Finanzas 100% editables por proyecto (costo ejecutado + gráfica mensual)
--   2) Datos reales del Proyecto San Martín (fin de los datos de demostración)
--   3) Estado del proyecto derivado del % de hitos completados
--   4) Hilo de respuestas en los reportes de soporte + RLS por rol
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001 y 004 aplicadas (usa public.es_admin()). Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Finanzas editables ─────────────────────────────────────────────────
-- `costo_ejecutado` deja de ser una cifra calculada e inmutable: el
-- Administrador la sobrescribe desde el Modo Edición del proyecto.
alter table public.proyectos
  add column if not exists costo_ejecutado numeric(14,2) default 0;

-- Ejecución financiera mensual REAL (antes era un arreglo falso en el código).
-- Formato: [{"name":"Ene","value":0}, ...] — 12 meses, editable mes a mes.
alter table public.proyectos
  add column if not exists ejecucion_mensual jsonb default '[]'::jsonb;

update public.proyectos
   set ejecucion_mensual = '[]'::jsonb
 where ejecucion_mensual is null;

update public.proyectos
   set costo_ejecutado = 0
 where costo_ejecutado is null;

-- ── 1b. Facturas de proveedores REALES (adiós a las de demostración) ──────
-- El panel de facturas del proyecto dejaba de inventar filas y pasa a leer y
-- escribir en `gastos`; estas columnas son las que necesita.
alter table public.gastos add column if not exists proveedor   text default '';
alter table public.gastos add column if not exists concepto    text default '';
alter table public.gastos add column if not exists comprobante text default '';

-- ── 2. Proyecto San Martín con sus cifras reales ──────────────────────────
--  Presupuesto total $20,000 · Anticipo $2,000 · Costo ejecutado $0
--  Gráfica mensual: Enero–Junio $0, Julio $2,000, Agosto–Diciembre $0
update public.proyectos
   set presupuesto_total = 20000,
       anticipo          = 2000,
       costo_ejecutado   = 0,
       ejecucion_mensual = '[
         {"name":"Ene","value":0},
         {"name":"Feb","value":0},
         {"name":"Mar","value":0},
         {"name":"Abr","value":0},
         {"name":"May","value":0},
         {"name":"Jun","value":0},
         {"name":"Jul","value":2000},
         {"name":"Ago","value":0},
         {"name":"Sep","value":0},
         {"name":"Oct","value":0},
         {"name":"Nov","value":0},
         {"name":"Dic","value":0}
       ]'::jsonb
 where nombre ilike '%san mart%';

-- ── 3. Estado automático según el avance de hitos ─────────────────────────
-- 0% = Planificación · 1–99% = En progreso · 100% = Finalizado.
-- El frontend lo calcula en vivo; este trigger mantiene la BD coherente para
-- cualquier consulta o reporte que lea la tabla directamente.
create or replace function public.estado_por_avance(p_proyecto_id uuid)
returns text
language sql
stable
as $$
  select case
           when count(*) = 0 then 'Planificación'
           when count(*) filter (where completado) = 0 then 'Planificación'
           when count(*) filter (where completado) = count(*) then 'Finalizado'
           else 'En progreso'
         end
    from public.checklist_hitos
   where proyecto_id = p_proyecto_id;
$$;

create or replace function public.sincronizar_estado_proyecto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proyecto uuid := coalesce(new.proyecto_id, old.proyecto_id);
  v_total    int;
  v_hechos   int;
begin
  if v_proyecto is null then
    return coalesce(new, old);
  end if;

  select count(*), count(*) filter (where completado)
    into v_total, v_hechos
    from public.checklist_hitos
   where proyecto_id = v_proyecto;

  update public.proyectos
     set estado            = public.estado_por_avance(v_proyecto),
         porcentaje_avance = case when v_total > 0
                                  then round((v_hechos::numeric / v_total) * 100)
                                  else 0 end
   where id = v_proyecto;

  return coalesce(new, old);
end $$;

drop trigger if exists trg_estado_por_avance on public.checklist_hitos;
create trigger trg_estado_por_avance
  after insert or update or delete on public.checklist_hitos
  for each row execute function public.sincronizar_estado_proyecto();

-- Recalcula el estado de TODOS los proyectos con lo que ya hay en la base
update public.proyectos p
   set estado            = public.estado_por_avance(p.id),
       porcentaje_avance = coalesce((
         select case when count(*) > 0
                     then round((count(*) filter (where h.completado)::numeric / count(*)) * 100)
                     else 0 end
           from public.checklist_hitos h
          where h.proyecto_id = p.id
       ), 0);

-- ── 4. Hilo de respuestas de los reportes de soporte ──────────────────────
create table if not exists public.reportes_respuestas (
  id          uuid primary key default gen_random_uuid(),
  reporte_id  uuid not null references public.reportes_soporte(id) on delete cascade,
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  mensaje     text not null,
  es_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_reportes_respuestas_reporte
  on public.reportes_respuestas (reporte_id, created_at);

alter table public.reportes_respuestas enable row level security;

drop policy if exists "respuestas_leer"      on public.reportes_respuestas;
drop policy if exists "respuestas_escribir"  on public.reportes_respuestas;
drop policy if exists "respuestas_editar"    on public.reportes_respuestas;
drop policy if exists "respuestas_eliminar"  on public.reportes_respuestas;

-- Lee el hilo quien abrió el reporte y el Administrador
create policy "respuestas_leer" on public.reportes_respuestas
  for select to authenticated
  using (
    public.es_admin()
    or exists (
      select 1 from public.reportes_soporte r
       where r.id = reporte_id and r.usuario_id = auth.uid()
    )
  );

-- Responde el Administrador (a cualquier reporte) y el autor (al suyo),
-- siempre firmando con su propio usuario
create policy "respuestas_escribir" on public.reportes_respuestas
  for insert to authenticated
  with check (
    usuario_id = auth.uid()
    and (
      public.es_admin()
      or exists (
        select 1 from public.reportes_soporte r
         where r.id = reporte_id and r.usuario_id = auth.uid()
      )
    )
  );

-- Cada quien edita su propia respuesta; el Administrador, cualquiera
create policy "respuestas_editar" on public.reportes_respuestas
  for update to authenticated
  using (usuario_id = auth.uid() or public.es_admin())
  with check (usuario_id = auth.uid() or public.es_admin());

create policy "respuestas_eliminar" on public.reportes_respuestas
  for delete to authenticated
  using (usuario_id = auth.uid() or public.es_admin());

-- ── 5. RLS de reportes_soporte: se afina para el hilo ─────────────────────
-- La política "for all" anterior tapaba al autor. Se separa por operación:
-- el autor lee y elimina lo suyo; el Administrador gestiona todo.
drop policy if exists "reportes_insertar_propio" on public.reportes_soporte;
drop policy if exists "reportes_leer"            on public.reportes_soporte;
drop policy if exists "reportes_admin_gestiona"  on public.reportes_soporte;
drop policy if exists "reportes_actualizar"      on public.reportes_soporte;
drop policy if exists "reportes_eliminar"        on public.reportes_soporte;

create policy "reportes_insertar_propio" on public.reportes_soporte
  for insert to authenticated
  with check (usuario_id = auth.uid());

create policy "reportes_leer" on public.reportes_soporte
  for select to authenticated
  using (usuario_id = auth.uid() or public.es_admin());

-- Solo el Administrador cambia el estado del reporte
create policy "reportes_actualizar" on public.reportes_soporte
  for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- El Administrador elimina cualquiera; el autor puede retirar el suyo
create policy "reportes_eliminar" on public.reportes_soporte
  for delete to authenticated
  using (public.es_admin() or usuario_id = auth.uid());

-- ── 6. Realtime ───────────────────────────────────────────────────────────
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.reportes_respuestas';
  exception when others then
    raise notice 'Realtime para reportes_respuestas omitido: %', sqlerrm;
  end;
end $$;

commit;
