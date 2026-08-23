-- ═══════════════════════════════════════════════════════════════════════════
--  MM Capital · Migración 021 — Socio Administrador manda igual que Administrador
--  Ejecutar en: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Requiere 001..020 aplicadas. Es idempotente.
--
--  Decisión de negocio: los dos roles administrativos pesan lo mismo. En la
--  interfaz ya se igualaron (Chat IA, checks de avance y vaciar el chat, que
--  colgaban de `rol = 'admin'`). Falta que la base sostenga esa promesa.
--
--  El agujero: `es_admin()` —que gobierna TODAS las políticas RLS— mira solo la
--  tabla `administradores`. La 016 sembró allí a quienes ya tenían rol admin o
--  socio_administrador, pero nadie vuelve a mirar. Nombrar a alguien «Socio
--  Administrador» desde el panel le daba los botones y NINGÚN permiso real:
--  la interfaz le dejaría intentarlo y la base le diría que no.
--
--  Aquí se cierra el círculo: el rol administrativo entra y sale del padrón
--  solo. Ojo con lo que eso significa —y es lo que se ha pedido—: un Socio
--  Administrador puede escribir en todas las tablas protegidas, cambiar roles
--  y dar de alta a otros administradores. Es el mismo poder, sin matices.
--
--  No se invierte la regla de la 016: el padrón sigue siendo quien concede el
--  permiso. Lo que se añade es que la etiqueta lo ARRASTRE, y como el rol solo
--  lo puede tocar un administrador (RLS + los triggers de la 016 y la 020),
--  nadie se asciende a sí mismo por esta vía.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. La etiqueta arrastra al padrón ─────────────────────────────────────
create or replace function public.sincronizar_padron_desde_rol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rol in ('admin', 'socio_administrador') then
    insert into public.administradores (usuario_id, nota)
    select new.id, 'alta automática por rol ' || new.rol
     where exists (select 1 from auth.users au where au.id = new.id)
    on conflict (usuario_id) do nothing;
  else
    delete from public.administradores where usuario_id = new.id;
  end if;

  return new;
end $$;

comment on function public.sincronizar_padron_desde_rol() is
  'Nombrar a alguien Administrador o Socio Administrador en el panel le da '
  'permiso de verdad: entra en el padrón que consulta es_admin(). Quitarle el '
  'rol lo saca (migración 021).';

/* `after`, no `before`: la fila ya está escrita y con su valor definitivo, así
   que el padrón nunca se adelanta a un cambio que luego se rechaza.

   La condición `when` evita el trabajo inútil —la mayoría de los UPDATE de
   esta tabla son de avatar— y, sobre todo, corta el ida y vuelta con
   `sincronizar_rol_administrador` (016), que escribe el rol al tocar el
   padrón: si el rol no cambia, este trigger ni se despierta. */
drop trigger if exists trg_sincronizar_padron_desde_rol on public.usuarios;
create trigger trg_sincronizar_padron_desde_rol
  after insert or update of rol on public.usuarios
  for each row
  when (new.rol is not null)
  execute function public.sincronizar_padron_desde_rol();

-- ── 2. Poner al día lo que ya existe ──────────────────────────────────────
-- Quien tenga rol administrativo y no esté en el padrón, entra.
insert into public.administradores (usuario_id, nota)
select u.id, 'alta por rol ' || u.rol || ' (migración 021)'
  from public.usuarios u
  join auth.users au on au.id = u.id
 where u.rol in ('admin', 'socio_administrador')
on conflict (usuario_id) do nothing;

-- Y quien esté en el padrón sin rol administrativo, sale: la contradicción
-- entre lo que se ve en pantalla y lo que se puede hacer es justo lo que esta
-- migración viene a eliminar.
--
-- Con red de seguridad: si la limpieza fuera a dejar el padrón VACÍO, no se
-- hace. Un padrón vacío significa que `es_admin()` responde que no a todo el
-- mundo y que nadie puede volver a escribir en ninguna tabla protegida —ni
-- siquiera para arreglarlo— salvo entrando por el SQL Editor. Ante la duda,
-- se deja el permiso de más y se avisa.
do $$
declare
  v_quedan int;
  v_fuera   int;
begin
  select count(*) into v_quedan
    from public.administradores a
    join public.usuarios u on u.id = a.usuario_id
   where u.rol in ('admin', 'socio_administrador');

  if v_quedan = 0 then
    raise notice 'Limpieza OMITIDA: nadie quedaría en el padrón. Revisa los roles antes de repetirla.';
    return;
  end if;

  delete from public.administradores a
   where not exists (
     select 1 from public.usuarios u
      where u.id = a.usuario_id
        and u.rol in ('admin', 'socio_administrador')
   );

  get diagnostics v_fuera = row_count;
  if v_fuera > 0 then
    raise notice 'Retiradas % altas del padrón por no tener rol administrativo', v_fuera;
  end if;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Comprobación
--
--  `en_el_padron` debe ser true para TODOS los admin y socio_administrador,
--  y false para el resto. Sin excepciones: si algo no cuadra aquí, la interfaz
--  volverá a prometer permisos que la base no concede.
-- ═══════════════════════════════════════════════════════════════════════════

select u.nombre_completo,
       u.email,
       u.rol,
       (a.usuario_id is not null) as en_el_padron,
       case
         when u.rol in ('admin','socio_administrador') and a.usuario_id is not null
           then 'Correcto — manda de verdad'
         when u.rol not in ('admin','socio_administrador') and a.usuario_id is null
           then 'Correcto — sin mando'
         else 'DESCUADRE: revisar'
       end as estado
  from public.usuarios u
  left join public.administradores a on a.usuario_id = u.id
 order by en_el_padron desc, u.nombre_completo;
