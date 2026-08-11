-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 016 — RLS estable, roles por UUID y concurrencia
--
--   P2-11 · `public.es_admin()` se declara STABLE. Sin volatilidad declarada,
--           PostgreSQL la trata como VOLATILE y la ejecuta UNA VEZ POR FILA
--           evaluada en cada política RLS: una lectura de 2,000 gastos hacía
--           2,000 consultas a `usuarios`. Marcada STABLE, el planificador la
--           cachea dentro de la sentencia (InitPlan) y la ejecuta una vez.
--
--   P2-12 · Los administradores se resuelven por `auth.uid()` (UUID), no por
--           cadenas de texto. La versión anterior caía en un `auth.jwt() ->>
--           'email' = 'luisp.bomel@gmail.com'` codificado a mano: un correo es
--           mutable, se puede cambiar desde Auth y no es una identidad. Ahora
--           existe `public.administradores(usuario_id uuid)` como padrón
--           explícito y la comprobación es una pertenencia por UUID.
--
--   P2-17 · `proyectos.updated_at` + trigger. Es el testigo de versión que
--           permite el bloqueo optimista del cliente: si dos administradores
--           guardan finanzas a la vez, el segundo UPDATE no encuentra fila y
--           la aplicación lo rechaza en vez de pisar en silencio lo anterior.
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..015 aplicadas. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ═══════════════════════════════════════════════════════════════════════════
--  1. Padrón de administradores por UUID (P2-12)
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.administradores (
  usuario_id  uuid primary key references auth.users(id) on delete cascade,
  nota        text,
  creado_en   timestamptz not null default now()
);

comment on table public.administradores is
  'Padrón de administradores por UUID de Auth. Fuente de verdad de es_admin(); '
  'el rol textual de public.usuarios se conserva solo para la UI.';

alter table public.administradores enable row level security;

-- Semilla 1: todo quien ya tenga rol administrativo en `usuarios` Y exista en
-- Auth. Sin esto, aplicar la migración dejaría al equipo sin permisos.
insert into public.administradores (usuario_id, nota)
select u.id, 'migrado desde usuarios.rol = ' || u.rol
  from public.usuarios u
  join auth.users a on a.id = u.id
 where u.rol in ('admin', 'socio_administrador')
on conflict (usuario_id) do nothing;

-- Semilla 2: el administrador raíz que la 001 identificaba por correo. Se
-- resuelve UNA sola vez, aquí, a su UUID de Auth; a partir de este punto el
-- correo deja de otorgar privilegio alguno.
insert into public.administradores (usuario_id, nota)
select a.id, 'administrador raíz (resuelto desde correo en la migración 016)'
  from auth.users a
 where lower(a.email) = 'luisp.bomel@gmail.com'
on conflict (usuario_id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
--  2. es_admin(): STABLE y estrictamente por auth.uid() (P2-11 · P2-12)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.es_admin()
returns boolean
language sql
stable                    -- ← P2-11: una evaluación por sentencia, no por fila
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.administradores adm
     where adm.usuario_id = auth.uid()
  );
$$;

comment on function public.es_admin() is
  'STABLE: el planificador la cachea por sentencia dentro de las políticas RLS. '
  'Valida exclusivamente por auth.uid() contra public.administradores.';

-- Políticas del propio padrón: se leen y se administran con la misma función.
drop policy if exists "administradores_lectura"   on public.administradores;
drop policy if exists "administradores_escritura" on public.administradores;

create policy "administradores_lectura" on public.administradores
  for select to authenticated
  using (usuario_id = auth.uid() or public.es_admin());

create policy "administradores_escritura" on public.administradores
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ═══════════════════════════════════════════════════════════════════════════
--  3. El rol textual sigue al padrón (P2-12)
--
--  `usuarios.rol` ya no concede permisos, pero sigue pintándose en la UI. Este
--  trigger evita que las dos representaciones se separen: alta o baja en el
--  padrón => rol coherente en la ficha.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.sincronizar_rol_administrador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.usuarios
       set rol = 'admin'
     where id = new.usuario_id
       and rol not in ('admin', 'socio_administrador');
    return new;
  end if;

  update public.usuarios
     set rol = 'socio'
   where id = old.usuario_id
     and rol in ('admin', 'socio_administrador');
  return old;
end $$;

drop trigger if exists trg_sincronizar_rol_administrador on public.administradores;
create trigger trg_sincronizar_rol_administrador
  after insert or delete on public.administradores
  for each row execute function public.sincronizar_rol_administrador();

-- Un socio no puede auto-ascenderse editando su propia fila de `usuarios`:
-- el rol solo lo mueve el padrón (o un administrador).
create or replace function public.bloquear_autoascenso_rol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rol is distinct from old.rol
     and not public.es_admin()
     and not exists (select 1 from public.administradores where usuario_id = new.id)
  then
    raise exception 'El rol solo lo puede cambiar un administrador.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_bloquear_autoascenso_rol on public.usuarios;
create trigger trg_bloquear_autoascenso_rol
  before update of rol on public.usuarios
  for each row execute function public.bloquear_autoascenso_rol();

-- ═══════════════════════════════════════════════════════════════════════════
--  4. Testigo de versión para el bloqueo optimista (P2-17)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.proyectos
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- `clock_timestamp()`, no `now()`: dentro de una misma transacción `now()`
  -- es constante y dos escrituras seguidas producirían el mismo testigo.
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists trg_proyectos_updated_at on public.proyectos;
create trigger trg_proyectos_updated_at
  before update on public.proyectos
  for each row execute function public.tocar_updated_at();

-- Índice del filtro del bloqueo optimista (`id = ? and updated_at = ?`).
create index if not exists idx_proyectos_id_updated_at
  on public.proyectos (id, updated_at);

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Alta/baja de administradores (referencia operativa):
--    insert into public.administradores (usuario_id)
--    select id from auth.users where lower(email) = 'nuevo@correo.com';
--
--    delete from public.administradores
--     where usuario_id = '00000000-0000-0000-0000-000000000000';
-- ═══════════════════════════════════════════════════════════════════════════
