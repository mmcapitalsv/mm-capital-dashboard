-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 013 — Notificaciones leídas, guardadas en la base
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..012 aplicadas. Es idempotente.
--
--  Problema: marcar una notificación como leída solo cambiaba el estado local
--  y una copia en `localStorage`. Consecuencias:
--    · Entrar desde otro equipo o desde el teléfono devolvía todos los avisos
--      a "sin leer", aunque ya se hubieran revisado.
--    · Limpiar los datos del navegador borraba el historial de lectura.
--
--  Solución: una marca por (usuario, aviso) en la base. La campana deja de
--  depender del navegador que se tenga delante.
--
--  Nota sobre el tipo de `aviso_id`: es TEXT, no UUID. Hoy el identificador
--  es el del hito que vence, pero la campana ya reúne conceptos distintos
--  (vencimientos y chat) y mañana puede reunir más; un TEXT admite cualquier
--  origen sin volver a migrar. La contrapartida —no hay clave foránea al
--  hito— se cubre con la limpieza del final: las marcas huérfanas se borran.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.avisos_leidos (
  usuario_id  uuid        not null references public.usuarios(id) on delete cascade,
  aviso_id    text        not null,
  leido_en    timestamptz not null default now(),
  primary key (usuario_id, aviso_id)
);

comment on table public.avisos_leidos is
  'Qué notificaciones ha leído cada persona. Sustituye a la lista que vivía en localStorage, que no cruzaba de un dispositivo a otro.';

create index if not exists idx_avisos_leidos_usuario
  on public.avisos_leidos (usuario_id);

alter table public.avisos_leidos enable row level security;

drop policy if exists "avisos_leidos_propios" on public.avisos_leidos;

-- Cada quien administra ÚNICAMENTE sus propias marcas de lectura. Sin esto,
-- cualquier autenticado podría apagar la campana de otro.
create policy "avisos_leidos_propios" on public.avisos_leidos
  for all to authenticated
  using      (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

commit;

-- ── Limpieza: las marcas de hitos que ya no existen se borran ──────────────
--  Sin esto la tabla crece para siempre: un hito borrado deja su marca ahí.
--  Solo se descartan las marcas cuyo id TIENE forma de UUID (las de los
--  vencimientos) y no corresponde a ningún hito vivo; cualquier otro origen
--  de aviso se deja intacto.
delete from public.avisos_leidos a
 where a.aviso_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and not exists (
     select 1 from public.checklist_hitos h where h.id = a.aviso_id::uuid
   );

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
-- ═══════════════════════════════════════════════════════════════════════════
select policyname, cmd, roles from pg_policies
 where schemaname = 'public' and tablename = 'avisos_leidos';

-- Debe devolver solo TUS marcas, nunca las de otro usuario.
select aviso_id, leido_en from public.avisos_leidos order by leido_en desc;
