-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 010 — Monto por hito, ajuste manual del costo
--                                ejecutado y edición/borrado de mensajes
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..009 aplicadas. Es idempotente.
--
--  1. `checklist_hitos.valor_asociado` — dinero que representa cada tarea.
--     Al marcarla como hecha, ese monto entra al Costo Ejecutado del proyecto.
--  2. `proyectos.ajuste_costo_manual` — lo que el Administrador escribe a mano
--     en la tarjeta de Costo Ejecutado, POR ENCIMA de facturas e hitos.
--     Costo Ejecutado = facturas + hitos marcados + ajuste manual.
--  3. `mensajes`: política de UPDATE (hasta ahora NO existía, así que editar un
--     mensaje fallaba en silencio) y marca de "editado".
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Monto asociado a cada hito del checklist ──────────────────────────
alter table public.checklist_hitos
  add column if not exists valor_asociado numeric(14,2) not null default 0;

comment on column public.checklist_hitos.valor_asociado is
  'Monto en USD que este hito aporta al costo ejecutado cuando se marca como completado.';

-- ── 2. Ajuste manual del costo ejecutado ─────────────────────────────────
-- `costo_ejecutado` sigue guardando el TOTAL ya calculado (lo leen reportes y
-- vistas antiguas). `ajuste_costo_manual` guarda solo la parte escrita a mano,
-- que es lo único que la app no puede recalcular por su cuenta.
alter table public.proyectos
  add column if not exists ajuste_costo_manual numeric(14,2) not null default 0;

comment on column public.proyectos.ajuste_costo_manual is
  'Corrección manual del Administrador sobre el costo ejecutado. El total mostrado es facturas + hitos completados + este ajuste.';

-- ── 3. Chat: cada quien edita SUS mensajes ───────────────────────────────
-- La marca de edición es honesta: la burbuja muestra "(editado)" y nadie puede
-- cambiar un mensaje ajeno sin que se note.
alter table public.mensajes
  add column if not exists editado_en timestamptz;

drop policy if exists "mensajes_edicion" on public.mensajes;

-- Editar: SOLO el autor, y sin poder cambiar de dueño ni de destinatario.
-- El administrador NO puede reescribir mensajes ajenos (solo borrarlos, lo que
-- ya permite la política "mensajes_borrado" de la migración 006).
create policy "mensajes_edicion" on public.mensajes
  for update to authenticated
  using      (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
-- ═══════════════════════════════════════════════════════════════════════════
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and (
     (table_name = 'checklist_hitos' and column_name = 'valor_asociado') or
     (table_name = 'proyectos'       and column_name = 'ajuste_costo_manual') or
     (table_name = 'mensajes'        and column_name = 'editado_en')
   )
 order by table_name;

select policyname, cmd from pg_policies
 where schemaname = 'public' and tablename = 'mensajes'
 order by policyname;
