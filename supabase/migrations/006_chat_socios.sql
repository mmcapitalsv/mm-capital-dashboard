-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 006 — Chat "Socios" real (Supabase + Realtime)
--  Ejecutar en:  Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..005 aplicadas. Es idempotente.
--
--  Sustituye el chat de ejemplo (canales general / obra / finanzas en memoria)
--  por UN solo canal persistido: 'socios'. El recuadro del Sidebar y la página
--  de Chat leen esta misma tabla, así que lo escrito en uno aparece idéntico e
--  instantáneo en el otro.
--
--  Acceso: solo administradores y socios. Un inversionista no lee ni escribe.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. ¿Quién es "socio"? ────────────────────────────────────────────────
-- Admin, socio administrador y socio director. Los inversionistas quedan
-- fuera del canal por decisión de negocio.
create or replace function public.es_socio()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select rol in ('admin', 'socio_administrador', 'socio_director')
       from public.usuarios where id = auth.uid()),
    false
  );
$$;

-- ── 2. Mensajes ──────────────────────────────────────────────────────────
create table if not exists public.mensajes (
  id          uuid primary key default gen_random_uuid(),
  canal       text        not null default 'socios',
  usuario_id  uuid        not null default auth.uid() references public.usuarios(id) on delete cascade,
  autor       text        not null default '',
  contenido   text        not null check (length(trim(contenido)) > 0),
  created_at  timestamptz not null default now()
);

create index if not exists mensajes_canal_fecha_idx
  on public.mensajes (canal, created_at);

-- Limpieza: los canales 'general', 'obra' y 'finanzas' desaparecen de la app.
delete from public.mensajes where canal <> 'socios';

alter table public.mensajes enable row level security;

drop policy if exists "mensajes_lectura"  on public.mensajes;
drop policy if exists "mensajes_escritura" on public.mensajes;
drop policy if exists "mensajes_borrado"  on public.mensajes;

-- Leer: solo admin o socios
create policy "mensajes_lectura" on public.mensajes
  for select to authenticated
  using (public.es_socio());

-- Escribir: solo admin o socios, y siempre en su propio nombre
create policy "mensajes_escritura" on public.mensajes
  for insert to authenticated
  with check (public.es_socio() and usuario_id = auth.uid());

-- Borrar: el autor o un administrador
create policy "mensajes_borrado" on public.mensajes
  for delete to authenticated
  using (usuario_id = auth.uid() or public.es_admin());

-- ── 3. Marca de lectura (indicador rojo de la campana) ───────────────────
create table if not exists public.chat_lecturas (
  usuario_id   uuid        not null references public.usuarios(id) on delete cascade,
  canal        text        not null default 'socios',
  leido_hasta  timestamptz not null default now(),
  primary key (usuario_id, canal)
);

alter table public.chat_lecturas enable row level security;

drop policy if exists "chat_lecturas_propias" on public.chat_lecturas;

-- Cada quien administra únicamente SU marca de lectura
create policy "chat_lecturas_propias" on public.chat_lecturas
  for all to authenticated
  using      (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

commit;

-- ── 4. Realtime: el chat se actualiza sin recargar la página ─────────────
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.mensajes';
  exception when others then
    raise notice 'Realtime para mensajes omitido: %', sqlerrm;
  end;
end $$;

-- Los UPDATE/DELETE por Realtime necesitan la fila completa
alter table public.mensajes replica identity full;

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
-- ═══════════════════════════════════════════════════════════════════════════
select policyname, cmd from pg_policies
 where schemaname = 'public' and tablename in ('mensajes', 'chat_lecturas')
 order by tablename, policyname;
