-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 011 — Lectura del directorio de usuarios
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..010 aplicadas. Es idempotente.
--
--  Problema: la política "usuarios_lectura" (migración 001) solo dejaba ver la
--  fila propia o, si eras admin, todas. Consecuencia para cualquier no-admin:
--    · Chat > Directos mostraba "No hay otros usuarios registrados".
--    · Las burbujas del canal General salían sin foto de perfil (la unión con
--      `usuarios` y el directorio de avatares devolvían cero filas).
--
--  Solución: SELECT abierto a todo usuario `authenticated` sobre
--  public.usuarios. La ESCRITURA no se toca: sigue siendo del administrador
--  (usuarios_escritura) más la fila propia (usuarios_actualiza_propio,
--  migración 005), y el trigger `usuarios_bloquea_escalada` sigue impidiendo
--  que alguien se cambie el rol.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.usuarios enable row level security;

-- La política antigua se reemplaza; la nueva la engloba (id = auth.uid() y
-- es_admin() son subconjuntos de "cualquier autenticado").
drop policy if exists "usuarios_lectura"          on public.usuarios;
drop policy if exists "usuarios_lectura_directorio" on public.usuarios;

create policy "usuarios_lectura_directorio" on public.usuarios
  for select to authenticated
  using (true);

comment on table public.usuarios is
  'Directorio de personas. Lectura para cualquier usuario autenticado (chat, avatares y menciones); la escritura sigue restringida al administrador y a la propia fila.';

-- ── Realtime: sin esto el canal `avatares-usuarios-mmcapital` no recibe los
--    cambios de foto de perfil de los demás. ───────────────────────────────
do $$
begin
  alter publication supabase_realtime add table public.usuarios;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
-- ═══════════════════════════════════════════════════════════════════════════
select policyname, cmd, roles, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'usuarios'
 order by policyname;

-- Debe devolver a TODOS los usuarios, no solo al que ejecuta la consulta.
select id, nombre_completo, rol, (avatar_url is not null) as tiene_avatar
  from public.usuarios
 order by created_at;
