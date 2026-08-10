-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 015 — Integridad de comprobantes y de usuarios
--
--  Dos blindajes independientes que van juntos porque ambos cierran un agujero
--  de integridad de datos:
--
--   P1-6 · Comprobantes de facturas (bucket `facturas`)
--          Hasta ahora cualquier usuario autenticado podía INSERTAR y, peor,
--          ACTUALIZAR objetos del bucket. Como la app subía con `upsert: true`
--          y la ruta era predecible (`proyecto_<uuid>/<timestamp>_<nombre>`),
--          bastaba con reescribir esa ruta para sustituir el comprobante de
--          otro proyecto SIN tocar la fila de `gastos`: el registro contable
--          seguía apuntando a la misma URL, pero el archivo ya era otro.
--          Ahora: subir es solo del Administrador, solo bajo `proyecto_<uuid>/`,
--          y NO existe política de UPDATE — un comprobante no se sobrescribe.
--
--   P1-10 · Alta de usuarios reconciliada por CORREO
--          El trigger insertaba una ficha nueva cuando no había ninguna con el
--          `id` de auth. Si el Administrador ya había dado de alta a la persona
--          a mano (con su correo y un uuid propio), al registrarse quedaban DOS
--          fichas para la misma persona: la de auth, vacía, y la fantasma con
--          sus inversiones colgando. Ahora la reconciliación es por correo: se
--          adopta la ficha existente asignándole el uuid de Auth, y las
--          aportaciones, reportes y mensajes viajan con ella (ON UPDATE CASCADE).
--
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..014 aplicadas. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
--  1. STORAGE · bucket `facturas` — un comprobante no se pisa
--
--  NOTA: storage.objects pertenece a supabase_storage_admin. Si este bloque
--  falla con «must be owner of table objects», aplica las mismas políticas
--  desde Storage -> facturas -> Policies.
-- ═══════════════════════════════════════════════════════════════════════════

-- Lectura pública: el visor y las miniaturas usan la URL pública (sin cambios).
drop policy if exists "facturas_lectura_publica" on storage.objects;
create policy "facturas_lectura_publica" on storage.objects
  for select using (bucket_id = 'facturas');

-- Subida: SOLO Administrador y SOLO bajo la carpeta de un proyecto.
-- `sin_proyecto/` desaparece: era una carpeta común donde todos escribían.
drop policy if exists "facturas_subida_autenticada" on storage.objects;
drop policy if exists "facturas_subida_admin" on storage.objects;
create policy "facturas_subida_admin" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'facturas'
    and public.es_admin()
    and (storage.foldername(name))[1] like 'proyecto\_%'
  );

-- UPDATE: NINGUNA política. Sin ella, RLS deniega toda sobrescritura, que es
-- exactamente lo que se busca — el respaldo contable es inmutable. Corregir un
-- comprobante = subir uno nuevo y apuntar `gastos.comprobante` ahí.
drop policy if exists "facturas_actualiza_autenticada" on storage.objects;

-- Borrado: sigue siendo exclusivo del Administrador.
drop policy if exists "facturas_borrado_admin" on storage.objects;
create policy "facturas_borrado_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'facturas' and public.es_admin());

-- ═══════════════════════════════════════════════════════════════════════════
--  2. USUARIOS · reconciliación por correo
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 2.a Las FK a `usuarios` deben seguir el cambio de id ──────────────────
-- Adoptar una ficha significa cambiarle la clave primaria; sin ON UPDATE
-- CASCADE, `aportaciones`, `reportes_soporte`, `mensajes`, etc. lo impedirían.
do $$
declare r record;
begin
  for r in
    select con.conname,
           nsp.nspname  as esquema,
           rel.relname  as tabla,
           pg_get_constraintdef(con.oid) as definicion
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      join pg_class     ref on ref.oid = con.confrelid
     where con.contype = 'f'
       and ref.relname = 'usuarios'
       and nsp.nspname = 'public'
       and con.confupdtype <> 'c'          -- 'c' = ya tiene ON UPDATE CASCADE
  loop
    execute format('alter table %I.%I drop constraint %I', r.esquema, r.tabla, r.conname);
    execute format('alter table %I.%I add constraint %I %s on update cascade',
                   r.esquema, r.tabla, r.conname, r.definicion);
    raise notice 'ON UPDATE CASCADE aplicado a %.% (%)', r.esquema, r.tabla, r.conname;
  end loop;
end $$;

-- ── 2.b Fichas fantasma ya existentes: se funden por correo ───────────────
-- Gana la ficha cuyo id existe en auth.users (o la más antigua). Las demás
-- ceden sus hijos y desaparecen: son duplicados de la misma persona.
do $$
declare
  g         record;
  ganador   uuid;
  perdedor  uuid;
  hijo      record;
begin
  for g in
    select lower(trim(email)) as correo
      from public.usuarios
     where nullif(trim(email), '') is not null
     group by 1
    having count(*) > 1
  loop
    select u.id into ganador
      from public.usuarios u
     where lower(trim(u.email)) = g.correo
     order by (exists (select 1 from auth.users a where a.id = u.id)) desc, u.created_at asc
     limit 1;

    for perdedor in
      select u.id from public.usuarios u
       where lower(trim(u.email)) = g.correo and u.id <> ganador
    loop
      for hijo in
        select nsp.nspname as esquema, rel.relname as tabla, att.attname as columna
          from pg_constraint con
          join pg_class     rel on rel.oid = con.conrelid
          join pg_namespace nsp on nsp.oid = rel.relnamespace
          join pg_class     ref on ref.oid = con.confrelid
          join unnest(con.conkey) as k(attnum) on true
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
         where con.contype = 'f' and ref.relname = 'usuarios' and nsp.nspname = 'public'
      loop
        -- Un duplicado (misma aportación, mismo aviso leído) no se fusiona: se
        -- descarta, porque fusionarlo sumaría dos veces el mismo dinero.
        begin
          execute format('update %I.%I set %I = $1 where %I = $2',
                         hijo.esquema, hijo.tabla, hijo.columna, hijo.columna)
            using ganador, perdedor;
        exception when unique_violation then
          execute format('delete from %I.%I where %I = $1', hijo.esquema, hijo.tabla, hijo.columna)
            using perdedor;
        end;
      end loop;

      delete from public.usuarios where id = perdedor;
      raise notice 'Ficha duplicada % fundida en % (correo %)', perdedor, ganador, g.correo;
    end loop;
  end loop;
end $$;

-- ── 2.c Un correo, una ficha. Y siempre normalizado ───────────────────────
update public.usuarios
   set email = lower(trim(email))
 where email is not null and email <> lower(trim(email));

create unique index if not exists idx_usuarios_email_unico
  on public.usuarios (lower(trim(email)))
  where email is not null and trim(email) <> '';

-- ── 2.d El trigger: reconciliar por correo antes de insertar ──────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_correo   text := lower(trim(coalesce(new.email, '')));
  v_nombre   text;
  v_adoptada int := 0;
begin
  -- 1. Ya existe la ficha con este mismo id: nada que hacer.
  if exists (select 1 from public.usuarios where id = new.id) then
    -- El correo sí se refresca (pudo cambiarlo desde su perfil).
    if v_correo <> '' then
      update public.usuarios set email = v_correo where id = new.id and coalesce(email, '') <> v_correo;
    end if;
    return new;
  end if;

  v_nombre := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    case when v_correo = 'luisp.bomel@gmail.com' then 'Luis Panameño' end,
    nullif(split_part(v_correo, '@', 1), ''),
    'Usuario MM Capital'
  );

  -- 2. ¿El Administrador ya había creado la ficha con este correo? Se ADOPTA:
  --    se le pone el uuid de Auth y sus inversiones/reportes viajan con ella
  --    (ON UPDATE CASCADE). Así no nace una segunda ficha fantasma.
  if v_correo <> '' then
    update public.usuarios
       set id    = new.id,
           email = v_correo,
           nombre_completo = coalesce(nullif(trim(nombre_completo), ''), v_nombre)
     where lower(trim(email)) = v_correo
       and id <> new.id;

    get diagnostics v_adoptada = row_count;
    if v_adoptada > 0 then return new; end if;
  end if;

  -- 3. Persona nueva de verdad: alta normal.
  insert into public.usuarios (id, email, nombre_completo, rol)
  values (
    new.id,
    nullif(v_correo, ''),
    v_nombre,
    case when v_correo = 'luisp.bomel@gmail.com' then 'admin' else 'inversionista' end
  );

  return new;
exception
  -- Nunca bloquear el registro de un usuario por un fallo al espejarlo aquí
  when others then
    raise warning 'No se pudo reconciliar la ficha de public.usuarios para %: %', new.id, sqlerrm;
    return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 2.e Backfill: adoptar las fichas que quedaron sueltas por correo ──────
-- Cuentas de Auth que ya existen y cuya única ficha está bajo otro uuid.
do $$
declare a record;
begin
  for a in
    select au.id, lower(trim(au.email)) as correo
      from auth.users au
     where nullif(trim(au.email), '') is not null
       and not exists (select 1 from public.usuarios u where u.id = au.id)
  loop
    update public.usuarios
       set id = a.id, email = a.correo
     where lower(trim(email)) = a.correo
       and id <> a.id;
    if found then
      raise notice 'Ficha de % adoptada por la cuenta de Auth %', a.correo, a.id;
    end if;
  end loop;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
-- ═══════════════════════════════════════════════════════════════════════════
select policyname, cmd, roles
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'facturas%'
 order by policyname;

-- Debe devolver cero filas: ni fichas duplicadas por correo ni huérfanas.
select lower(trim(email)) as correo, count(*)
  from public.usuarios
 where nullif(trim(email), '') is not null
 group by 1
having count(*) > 1;
