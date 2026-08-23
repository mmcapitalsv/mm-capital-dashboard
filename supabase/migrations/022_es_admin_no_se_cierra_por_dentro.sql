-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 022 — es_admin() deja de cerrarse por dentro
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..021 aplicadas. Es idempotente.
--
--  Síntoma: un administrador se cambia a «Socio Administrador» y ya no puede
--  volver. La base responde 42501 desde `usuarios_bloquea_escalada`, y esa
--  línea solo se alcanza cuando `es_admin()` responde que NO — con la persona
--  dada de alta en `administradores` y con el mismo id en las tres tablas.
--
--  Causa: la `es_admin()` viva en la base no es la que declara la migración
--  016. Sigue resolviendo el permiso contra `usuarios.rol = 'admin'`, de modo
--  que la propia etiqueta que la interfaz deja cambiar es la que concede el
--  permiso para cambiarla. Bajarse de 'admin' es tirar la llave dentro de la
--  habitación y cerrar la puerta: nadie más que el SQL Editor puede abrir.
--
--  Corrección: es_admin() se declara aquí de forma definitiva y reconoce DOS
--  caminos, a propósito:
--
--    · el padrón `administradores` — la fuente de verdad que quería la 016;
--    · el rol administrativo en la ficha — la etiqueta que se ve en pantalla.
--
--  Con los dos, una desincronización entre ambos ya no deja a nadie fuera:
--  antes bastaba que se separaran para perder el mando sin remedio. Y no abre
--  ninguna puerta nueva, porque cambiar un rol sigue exigiendo ser admin
--  (RLS + los triggers de la 016 y la 020): quien no lo es no puede escribirse
--  la etiqueta que lo convertiría en uno.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.es_admin()
returns boolean
language sql
stable                    -- una evaluación por sentencia dentro de las políticas RLS
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.administradores adm
            where adm.usuario_id = auth.uid()
         )
      or coalesce(
           (select u.rol in ('admin', 'socio_administrador')
              from public.usuarios u
             where u.id = auth.uid()),
           false
         );
$$;

comment on function public.es_admin() is
  'Administrador efectivo: figura en el padrón `administradores` O tiene rol '
  'administrativo en su ficha. Los dos caminos a propósito (migración 022): '
  'con uno solo, cualquier desajuste entre padrón y etiqueta dejaba a la '
  'persona sin mando y sin forma de recuperarlo desde la aplicación.';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación — con la sesión simulada, que es la que importa
--
--  Desde el SQL Editor no hay JWT: `auth.uid()` es nulo y todo parece correcto
--  aunque no lo esté. Estos bloques se ponen en la piel del usuario.
--  Sustituye el UUID por el de la persona a comprobar.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A · ¿La base te reconoce? ─────────────────────────────────────────────
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"53ecdea6-1c66-4299-91c8-b6b713e9e9bd","role":"authenticated"}';

  select auth.uid()        as uid_que_ve_la_base,
         public.es_admin() as es_admin,   -- debe ser true
         public.es_socio() as es_socio;   -- debe ser true
rollback;

-- ── B · El cambio de rol, tal cual lo hace el panel ──────────────────────
-- Debe devolver la fila con rol = 'admin'. El rollback deshace la prueba.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"53ecdea6-1c66-4299-91c8-b6b713e9e9bd","role":"authenticated"}';

  update public.usuarios
     set rol = 'admin'
   where id = '53ecdea6-1c66-4299-91c8-b6b713e9e9bd'
  returning id, email, rol;
rollback;

-- ── C · La definición que quedó viva ─────────────────────────────────────
select pg_get_functiondef('public.es_admin()'::regprocedure) as definicion_es_admin;
