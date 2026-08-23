-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 019 — Un solo vocabulario de roles
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..018 aplicadas. Es idempotente.
--
--  Dos fallos vistos en producción con la MISMA raíz: la aplicación y la base
--  no hablan del rol con las mismas palabras.
--
--   1. Cambiar el rol en «Administración de Usuarios y Roles» respondía
--          new row for relation "usuarios" violates check constraint
--          "usuarios_rol_check"
--      `usuarios` arrastra un CHECK anterior a este repositorio que solo admite
--      parte del vocabulario que usa el panel. El desplegable ofrece cuatro
--      roles y la base acepta menos: se enseñan opciones que serán rechazadas.
--
--   2. El canal «General» del chat contesta "Acceso restringido" a quien sí es
--      socio. Tanto `es_socio()` como el cliente comparan `usuarios.rol` contra
--      ('admin','socio_administrador','socio_director'); CUALQUIER valor fuera
--      de esa lista —'socio', 'administrador', un rol vacío— cierra el canal a
--      una persona con derecho a entrar.
--      Y la propia migración 016 fabricaba uno de esos valores: al dar de baja
--      a alguien del padrón escribía rol = 'socio', que no existe en ninguna
--      otra parte del código.
--
--  Aquí se fija UN vocabulario, el que ya usa la interfaz:
--        admin · socio_administrador · socio_director · inversionista
--  se normaliza lo guardado, se blinda con un CHECK acorde y se corrigen las
--  funciones que escribían fuera de esa lista.
--
--  Lo que esta migración NO toca: el permiso real. Quién es administrador lo
--  sigue diciendo `public.administradores` (migración 016); `usuarios.rol` es
--  la etiqueta de la interfaz y el criterio de entrada al canal de Socios.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ═══════════════════════════════════════════════════════════════════════════
--  1. Las funciones que vigilan el rol, antes de tocar ningún dato
--
--  `bloquear_autoascenso_rol` (016) levanta una excepción cuando el rol cambia
--  y quien lo cambia no es administrador. Ejecutada desde el SQL Editor no hay
--  JWT: `auth.uid()` es null, `es_admin()` es falso y la normalización de más
--  abajo moriría contra su propio guardián. Se le añade la misma puerta que ya
--  tenía `usuarios_bloquea_escalada` (005): sin sesión de usuario —migraciones,
--  service_role— no hay a quién vigilar.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.bloquear_autoascenso_rol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.rol is distinct from old.rol
     and not public.es_admin()
     and not exists (select 1 from public.administradores where usuario_id = new.id)
  then
    raise exception 'El rol solo lo puede cambiar un administrador.'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- ── El padrón deja de escribir un rol que no existe ───────────────────────
-- Al dar de baja a alguien del padrón, la 016 le ponía rol = 'socio'. Ese
-- valor no está en el desplegable, no lo traduce el diccionario y, sobre todo,
-- deja a la persona fuera del canal de Socios. Quien sale del padrón deja de
-- mandar, pero sigue siendo socio: 'socio_director'.
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
     set rol = 'socio_director'
   where id = old.usuario_id
     and rol in ('admin', 'socio_administrador');
  return old;
end $$;

-- ── es_socio(): el padrón manda también aquí ──────────────────────────────
-- Un administrador cuyo `usuarios.rol` se hubiera desincronizado quedaba sin
-- acceso al canal por RLS aunque `es_admin()` dijera lo contrario. Ahora el
-- padrón abre la puerta por sí solo y la etiqueta es el segundo camino.
create or replace function public.es_socio()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.es_admin() or coalesce(
    (select rol in ('admin', 'socio_administrador', 'socio_director')
       from public.usuarios where id = auth.uid()),
    false
  );
$$;

-- ═══════════════════════════════════════════════════════════════════════════
--  2. Normalización de lo que ya está guardado
--
--  Va ANTES de crear el CHECK: si quedara una sola fila fuera del vocabulario,
--  la restricción no se podría añadir.
-- ═══════════════════════════════════════════════════════════════════════════

update public.usuarios
   set rol = case lower(trim(coalesce(rol, '')))
     when 'admin'               then 'admin'
     when 'administrador'       then 'admin'
     when 'administrator'       then 'admin'
     when 'socio_administrador' then 'socio_administrador'
     when 'socio administrador' then 'socio_administrador'
     when 'socio-administrador' then 'socio_administrador'
     when 'managing_partner'    then 'socio_administrador'
     when 'socio_director'      then 'socio_director'
     when 'socio director'      then 'socio_director'
     when 'socio-director'      then 'socio_director'
     when 'director_partner'    then 'socio_director'
     -- El 'socio' que escribía la 016 al dar de baja del padrón
     when 'socio'               then 'socio_director'
     when 'inversionista'       then 'inversionista'
     when 'inversor'            then 'inversionista'
     when 'investor'            then 'inversionista'
     -- Desconocido o vacío: el rol de menor privilegio, nunca uno de mando
     else 'inversionista'
   end
 where rol is null
    or rol not in ('admin', 'socio_administrador', 'socio_director', 'inversionista');

-- El padrón y la etiqueta no pueden contradecirse: quien administra de verdad
-- se ve como administrador. Es la misma regla que aplica el trigger.
update public.usuarios u
   set rol = 'admin'
 where exists (select 1 from public.administradores a where a.usuario_id = u.id)
   and u.rol not in ('admin', 'socio_administrador');

-- ═══════════════════════════════════════════════════════════════════════════
--  3. El CHECK, ahora con el vocabulario completo
--
--  No se busca por nombre: el que rechazaba el cambio se llama
--  `usuarios_rol_check`, pero pudo haber otros. Se retira TODA restricción de
--  comprobación que recaiga sobre la columna `rol` y se pone una sola, la
--  buena. Localizarlas por `conkey` —las columnas que abarca— y no por el
--  texto del CHECK evita llevarse por delante la restricción de otra columna
--  cuyo nombre contenga esas tres letras.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  c        record;
  v_attnum smallint;
begin
  select a.attnum into v_attnum
    from pg_attribute a
    join pg_class rel    on rel.oid = a.attrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
   where ns.nspname = 'public' and rel.relname = 'usuarios' and a.attname = 'rol';

  if v_attnum is null then
    raise notice 'public.usuarios no tiene columna `rol`: nada que restringir';
    return;
  end if;

  for c in
    select con.conname, pg_get_constraintdef(con.oid) as definicion
      from pg_constraint con
      join pg_class rel    on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'usuarios'
       and con.contype = 'c'
       and v_attnum = any (con.conkey)
  loop
    execute format('alter table public.usuarios drop constraint %I', c.conname);
    raise notice 'Retirado el CHECK % (%)', c.conname, c.definicion;
  end loop;
end $$;

alter table public.usuarios
  add constraint usuarios_rol_check
  check (rol in ('admin', 'socio_administrador', 'socio_director', 'inversionista'));

-- Una ficha nueva sin rol explícito nace como inversionista, no como null: un
-- rol vacío es justo lo que dejaba a alguien sin etiqueta y sin canal.
alter table public.usuarios alter column rol set default 'inversionista';
alter table public.usuarios alter column rol set not null;

comment on column public.usuarios.rol is
  'Etiqueta de interfaz y llave del canal de Socios: admin, socio_administrador, '
  'socio_director o inversionista. El permiso real de administrador vive en '
  'public.administradores (migración 016).';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Reparto de roles: no debe quedar ninguno fuera de los cuatro.
select rol, count(*) as personas
  from public.usuarios
 group by rol
 order by rol;

-- 2. Quién es quién, y si la etiqueta cuadra con el padrón de administradores.
select u.nombre_completo,
       u.email,
       u.rol,
       (a.usuario_id is not null)                                  as en_padron,
       (u.rol in ('admin','socio_administrador','socio_director')) as entra_al_chat
  from public.usuarios u
  left join public.administradores a on a.usuario_id = u.id
 order by u.rol, u.nombre_completo;

-- 3. El CHECK que quedó vivo sobre `rol`.
select con.conname, pg_get_constraintdef(con.oid) as definicion
  from pg_constraint con
  join pg_class rel    on rel.oid = con.conrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
 where ns.nspname = 'public' and rel.relname = 'usuarios' and con.contype = 'c';

-- 4. Fichas cuyo id NO coincide con el de Auth: se crearon a mano antes de que
--    la persona se registrara (es el caso que contempla la migración 003). La
--    aplicación busca la ficha por id, así que mientras haya filas aquí esa
--    persona entra al panel sin rol y sin canal.
--    Esto solo INFORMA: corregirlo implica mover aportaciones de una ficha a
--    otra y se hace a mano, caso por caso.
select u.email,
       u.id  as id_en_usuarios,
       au.id as id_en_auth,
       u.rol
  from public.usuarios u
  join auth.users au on lower(au.email) = lower(u.email)
 where u.id <> au.id;
