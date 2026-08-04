-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 009 — Mensajes Directos (1 a 1) en el Chat
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 006 aplicada. Es idempotente.
--
--  El canal 'socios' sigue siendo el chat General (receptor_id null). Un
--  mensaje con `receptor_id` es privado: solo lo ven su autor y su receptor.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Destinatario del mensaje ──────────────────────────────────────────
alter table public.mensajes
  add column if not exists receptor_id uuid references public.usuarios(id) on delete cascade;

-- Conversación privada: se lee por pareja (autor, receptor) y por fecha
create index if not exists mensajes_directos_idx
  on public.mensajes (receptor_id, usuario_id, created_at);

-- ── 2. RLS: el General sigue siendo de socios; el privado es de la pareja ─
drop policy if exists "mensajes_lectura"  on public.mensajes;
drop policy if exists "mensajes_escritura" on public.mensajes;

-- Leer: el canal general lo ven los socios; un directo solo sus dos partes
create policy "mensajes_lectura" on public.mensajes
  for select to authenticated
  using (
    (receptor_id is null and public.es_socio())
    or receptor_id = auth.uid()
    or usuario_id  = auth.uid()
  );

-- Escribir: siempre en nombre propio. En el general hay que ser socio;
-- en un directo basta con ser un usuario autenticado.
create policy "mensajes_escritura" on public.mensajes
  for insert to authenticated
  with check (
    usuario_id = auth.uid()
    and (receptor_id is not null or public.es_socio())
  );

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
-- ═══════════════════════════════════════════════════════════════════════════
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'mensajes'
 order by ordinal_position;
