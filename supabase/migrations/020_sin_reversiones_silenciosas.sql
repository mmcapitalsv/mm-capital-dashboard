-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 020 — Un cambio rechazado se DICE, no se deshace
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..019 aplicadas. Es idempotente.
--
--  Síntoma: en «Administración de Usuarios y Roles» se cambia un rol, el aviso
--  verde confirma «Fulano ahora es Administrador» y un segundo después el
--  desplegable vuelve solo al rol anterior. Nada falla y nada se guarda.
--
--  Causa: `usuarios_bloquea_escalada` (migración 005) impide que alguien se
--  ascienda editando su propia ficha, y hace bien. Pero lo hace ASÍ:
--
--      new.rol := old.rol;      -- se descarta el cambio y no se avisa
--
--  La fila se escribe igualmente. Postgres devuelve «UPDATE 1», PostgREST
--  responde 200 con la fila, la aplicación entiende que fue bien... y Realtime
--  reparte el cambio, que es lo que hace saltar el desplegable de vuelta.
--  Quien está delante ve un éxito y un valor viejo al mismo tiempo, sin una
--  sola pista de por qué.
--
--  Corrección: rechazar en voz alta, con el mismo error 42501 que ya usa
--  `bloquear_autoascenso_rol` (016). La protección es idéntica —nadie se
--  asciende solo—, pero ahora la aplicación puede explicarlo.
--
--  El `id` sigue fijándose en silencio a propósito: no hay ninguna pantalla que
--  lo edite, así que un id distinto solo puede venir de un cliente manipulado y
--  no hay a quién explicárselo.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.usuarios_bloquea_escalada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.es_admin() then
    return new;                      -- service_role, migraciones o admin real
  end if;

  if new.rol is distinct from old.rol then
    raise exception 'El rol solo lo puede cambiar un administrador dado de alta en public.administradores.'
      using errcode = '42501';
  end if;

  if new.email is distinct from old.email then
    raise exception 'El correo de la ficha lo cambia un administrador; el tuyo se cambia desde Perfil, que pasa por Auth.'
      using errcode = '42501';
  end if;

  -- El id no lo edita ninguna pantalla: se fija y no se discute.
  new.id := old.id;
  return new;
end $$;

comment on function public.usuarios_bloquea_escalada() is
  'Impide que alguien se ascienda editando su propia ficha. Lanza 42501 en vez '
  'de revertir en silencio: una escritura descartada sin aviso llegaba a la '
  'interfaz como un éxito (migración 020).';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación — la pregunta que de verdad importa aquí
--
--  Si el cambio de rol se estaba deshaciendo, es que `es_admin()` responde NO
--  para quien lo intentaba. Y `es_admin()` mira UNA sola tabla: el padrón.
--  Esta consulta enseña quién está dentro y quién no.
-- ═══════════════════════════════════════════════════════════════════════════

select u.nombre_completo,
       u.email,
       u.rol,
       (a.usuario_id is not null) as en_el_padron,
       case when a.usuario_id is null
            then 'NO puede cambiar roles ni escribir en las tablas protegidas'
            else 'Administrador efectivo'
       end as consecuencia
  from public.usuarios u
  left join public.administradores a on a.usuario_id = u.id
 order by en_el_padron desc, u.nombre_completo;

-- Para dar de alta a quien deba administrar (sustituye el correo):
--
--   insert into public.administradores (usuario_id, nota)
--   select id, 'alta manual'
--     from auth.users
--    where lower(email) = 'correo@ejemplo.com'
--   on conflict (usuario_id) do nothing;
