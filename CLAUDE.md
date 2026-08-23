# CLAUDE.md — MM Capital · Portal Ejecutivo

Panel ejecutivo (SPA + PWA) para MM Capital Grupo Inmobiliario: portafolio de proyectos
inmobiliarios, finanzas, bóveda documental, inversionistas, chat de socios y un asistente
de IA. Todo el código, los comentarios y la interfaz están en **español**; el idioma de la
UI se puede cambiar a inglés desde el diccionario propio (`src/i18n/diccionario.js`).

---

## 1. Stack

### Frontend (`package.json`)

| Paquete | Versión declarada | Para qué |
|---|---|---|
| `react` / `react-dom` | ^19.2.7 | UI. Sin router: la vista se guarda en el query `?view=` y se conmuta con un `switch` en `Dashboard.jsx` |
| `vite` | ^8.1.1 | Bundler y dev server (`npm run dev` levanta con `--host`) |
| `@vitejs/plugin-react` | ^6.0.3 | HMR / transform de React (usa Oxc) |
| `tailwindcss` + `@tailwindcss/vite` | ^4.3.3 | Estilos. Tailwind v4 (config en CSS, no `tailwind.config.js`) |
| `postcss` / `autoprefixer` | ^8.5.24 / ^10.5.4 | Cadena PostCSS |
| `vite-plugin-pwa` | ^1.3.0 | Service worker / manifest. `registerType: 'prompt'` |
| `@supabase/supabase-js` | ^2.111.0 | Auth, Postgres, Storage, Realtime, Edge Functions |
| `recharts` | ^3.10.1 | Gráficas del panel y de la ficha de proyecto |
| `framer-motion` | ^12.43.0 | Animaciones |
| `lucide-react` | ^1.27.0 | Iconografía |
| `threejs-components` | ^0.0.19 | Fondo WebGL (`tubes`) del login, cargado en diferido |
| `browser-image-compression` | ^2.0.2 | Compresión de imágenes antes de subir a Storage |
| `class-variance-authority`, `clsx`, `tailwind-merge` | ^0.7.1 / ^2.1.1 / ^3.6.0 | Utilidad `cn()` y variantes de componentes |
| `@radix-ui/react-slot` | ^1.3.3 | `asChild` en los botones |
| `oxlint` | ^1.71.0 | Linter (`npm run lint`), config en `.oxlintrc.json` |
| `@types/react`, `@types/react-dom` | ^19.2.17 / ^19.2.3 | Tipos (el proyecto es **JS puro**, no TypeScript) |

Entorno verificado: **Node 24.16.0**, Vite 8.1.5. Módulos ESM (`"type": "module"`).

### Backend

- **Supabase** (Postgres + Auth + Storage + Realtime) — no hay servidor propio.
- **Supabase Edge Function** `chat-gemini` (Deno/TypeScript, importa `@supabase/supabase-js@2`
  desde `esm.sh`) — único punto que habla con **Google Gemini**.

### Scripts

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run lint
```

```bash
npm run preview
```

---

## 2. Estructura de carpetas

```
.
├── index.html                 Shell HTML. Aplica tema e idioma ANTES del primer pintado
├── vite.config.js             React + Tailwind + PWA (prompt), alias '@' → ./src
├── .env / .env.example        Solo las dos claves de Supabase (ver §4)
├── public/                    Assets servidos tal cual (logos, favicon, vídeo de fondo)
├── supabase/
│   ├── migrations/            022 migraciones SQL idempotentes, se ejecutan a mano
│   │                          en el SQL Editor del panel de Supabase
│   ├── functions/chat-gemini/ Edge Function: proxy a Gemini con herramientas
│   └── scripts/               SQL de un solo uso — IGNORADO por git (lleva contraseñas)
├── dist/                      Build (ignorado)
└── src/
    ├── main.jsx               createRoot + StrictMode
    ├── App.jsx                Sesión de Supabase; decide Login vs Dashboard
    ├── index.css              Paleta de marca y tokens de superficie (§5)
    ├── supabaseClient.js      createClient con las VITE_*
    ├── assets/                Imágenes importadas desde el bundle
    ├── components/            Una vista por archivo (todas lazy salvo Login)
    │   └── ui/                Piezas reutilizables (avatar, modal, portada, botones…)
    ├── context/               Providers globales: preferencias (tema/idioma) y chat
    ├── data/                  Semillas del checklist (`checklistSeeds.js`)
    ├── hooks/                 Estado compartido (proyectos, directorio, temporizadores…)
    ├── i18n/                  Diccionario es/en plano + `crearTraductor`
    ├── lib/                   Utilidades puras y de infraestructura
    └── services/             Acceso a datos: todo lo que toca Supabase pasa por aquí
```

### Qué hace cada carpeta

**`src/components/`** — las vistas del producto. `Dashboard.jsx` es el armazón (sidebar,
cabecera, barra inferior móvil, campana de avisos, modo edición) y carga las **nueve vistas
en diferido**: `DashboardView` (panel), `AllProjectsView`, `ProjectDetails` (la más grande,
~3.900 líneas: checklist, finanzas, galería, documentos), `VaultView` (bóveda),
`InvestorsView`, `ChatModule`, `AIChatView`, `AdminUsersView`, `ProfileView`.
`Login.jsx` y `ErrorBoundary.jsx` van en el paquete inicial.

**`src/components/ui/`** — piezas sin lógica de negocio: `AvatarUsuario`, `PortadaProyecto`
(ambos resuelven URLs firmadas), `Modal`, `InputMonto`, `MetricasProyecto`,
`AvisoActualizacion` (banner de nueva versión del service worker), `CargandoVista`,
`VideoBackground`, `NombreAjustado`, `liquid-glass-button`, `hyper-text`, `tubes-curor`.

**`src/services/`** — la única capa que llama a Supabase. Un servicio por dominio:
`storageService` (subidas, bóveda, avatares), `finanzasService` (presupuestos, facturas),
`checklistService` (hitos), `galeriaService` (álbumes y fotos), `inversionesService`
(aportaciones), `chatService` (canal Socios), `perfilService` (credenciales y reportes de
soporte), `configuracionService` (capital total), `avisosService` (notificaciones leídas),
`geminiService` (cliente de la Edge Function).

**`src/hooks/`** — `useProyectos` (portafolio + realtime + métricas derivadas),
`useDirectorioUsuarios` (mapa id→nombre, una consulta por sesión), `useEntradasPanel`
(actividad reciente / próximos hitos / tareas críticas), `usePreferencias`, `useDiaActual`,
`useTemporizadores`, `useUrlFirmada`, `useConfirmacion`.

**`src/lib/`** — `urlFirmada` (**único** sitio que firma URLs de Storage), `numeros`
(aritmética de dinero), `formato` (Title Case, estados), `archivos` (clase de archivo),
`comprimirImagen`, `realtime` (aplica eventos sobre el array en memoria),
`supabasePaginado` (evita el techo de 1.000 filas de PostgREST), `perfilUsuario`
(nombre, iniciales, cargo por rol), `portada`, `utils` (`cn`).

**`src/context/`** — `PreferenciasContext` (tema + idioma, con `forzarClaro` para el login)
y `ChatContext` (mensajes de Socios, no leídos, realtime). Los hooks de consumo viven
aparte (`usePrefs.js`, `useChat.js`) por la regla `react/only-export-components`.

---

## 3. Modelo de datos (Postgres · esquema `public`)

Las migraciones **alteran** un esquema que ya existía en Supabase, así que algunas columnas
base no aparecen en el SQL; las marcadas con † se deducen del uso en los servicios.

### `usuarios`
Espejo de `auth.users`; lo rellena el trigger `on_auth_user_created`.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | = `auth.users.id` |
| `email` | text | |
| `nombre_completo` | text NOT NULL | default `'Usuario MM Capital'` |
| `rol` | text NOT NULL | `admin` · `socio_administrador` · `socio_director` · `inversionista`. CHECK `usuarios_rol_check` (migración 019), default `inversionista` |
| `avatar_url` | text † | ruta/URL en el bucket de archivos |
| `cargo` | text † | cargo literal; si está, manda sobre el derivado del rol |

### `administradores` (migración 016 — **fuente de verdad de permisos**)
| `usuario_id` uuid PK → `auth.users` | `nota` text | `creado_en` timestamptz |

`public.es_admin()` reconoce **dos** caminos (migración 022): estar en esta tabla **o**
tener rol administrativo en la ficha. Con uno solo, cualquier desajuste entre padrón y
etiqueta dejaba a la persona sin mando y sin forma de recuperarlo desde la aplicación —
bajarse de `admin` era tirar la llave dentro de la habitación. Triggers en ambos sentidos
(016 y 021) mantienen las dos representaciones juntas.

### `proyectos`
| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `nombre`, `ubicacion`, `descripcion` | text † | |
| `estado` | text † | lo recalcula el trigger `trg_estado_por_avance` |
| `presupuesto_total` | numeric † | default 0 |
| `anticipo`, `cuota_asignada` | numeric(14,2) | migración 002 |
| `costo_ejecutado` | numeric(14,2) | migración 007 |
| `ajuste_costo_manual` | numeric(14,2) NOT NULL | migración 010 |
| `ejecucion_mensual` | jsonb | migración 007, default `[]` |
| `porcentaje_avance` | int | derivado de los hitos completados |
| `imagen_url` | text | portada |
| `fecha_entrega` | date | |
| `tag` | text | ej. "Desarrollo Residencial" |
| `checklist` | jsonb † | respaldo del checklist si falta la tabla relacional |
| `updated_at` | timestamptz | migración 016, control de concurrencia |

### `checklist_hitos`
`id`, `proyecto_id` → proyectos, `titulo` (NOT NULL), `descripcion`, `fecha_texto`,
`completado` (bool, default false), `orden` (int, default 0),
`valor_asociado` numeric(14,2) NOT NULL (migración 010 — valor de obra cerrada).
Índice `(proyecto_id, orden)`. Trigger que recalcula estado y % del proyecto.

### `gastos` (facturas de proveedores)
`id`, `proyecto_id` †, `descripcion` †, `monto` numeric †, `proveedor`, `concepto`,
`comprobante` (URL/ruta en el bucket `facturas`), `created_at` †.
**No tiene columna `fecha`**: se ordena y se muestra por `created_at`.

### `archivos` (bóveda, documentos de proyecto y fotos de galería)
`id`, `proyecto_id` uuid, `nombre_archivo`, `tipo` (categoría documental, o
`'foto_galeria'`), `url_archivo`, `storage_path`, `album_id` → `galeria_albumes`,
`subido_por` uuid (default `auth.uid()`, migración 014).

### `galeria_albumes`
`id`, `proyecto_id`, `titulo` (default 'Álbum sin título'), `fecha_texto`, `portada_url`,
`subido_por`, `created_at`.

### `aportaciones` (migración 003)
`id`, `usuario_id`, `proyecto_id`, `monto` numeric(14,2) ≥ 0, `fecha` date, `nota`,
`created_at`. Índice único `(usuario_id, proyecto_id, monto, fecha)` para semillas
reejecutables.

### `mensajes` (chat Socios · migraciones 006, 009, 010, 012)
`id`, `canal` (siempre `'socios'`), `usuario_id` (default `auth.uid()`), `autor`,
`contenido` (no vacío), `receptor_id` (mensajes directos), `editado_en`,
`adjunto_url`, `adjunto_nombre`, `adjunto_tipo`, `adjunto_tamano` bigint, `created_at`.

### `chat_lecturas`
PK `(usuario_id, canal)`, `leido_hasta` timestamptz.

### `avisos_leidos` (migración 013)
PK `(usuario_id, aviso_id)`, `leido_en`. `aviso_id` es **text** a propósito: la campana
mezcla vencimientos de hitos y chat.

### `reportes_soporte` (migración 004)
`id`, `usuario_id`, `mensaje`, `estado` (`pendiente` · `en_proceso` · `resuelto`), `created_at`.

### `reportes_respuestas` (migración 007)
`id`, `reporte_id`, `usuario_id`, `mensaje`, `es_admin` bool, `created_at`.

### `configuracion` (migración 005)
Clave/valor: `clave` text PK, `valor` jsonb, `actualizado_en`, `actualizado_por`.
Hoy solo `capital_total` → `{"monto": 1000000}`.

### Funciones y RLS

- `public.es_admin()` — STABLE, `security definer`; en `administradores` **o** con rol administrativo.
- `public.es_socio()` — `es_admin()` **o** rol ∈ {admin, socio_administrador, socio_director} (migración 019).
- `public.estado_por_avance()` / `sincronizar_estado_proyecto()` — estado del proyecto.
- `public.handle_new_user()` — trigger sobre `auth.users`.
- `public.sincronizar_rol_administrador()` — alta/baja en el padrón ⇒ rol coherente en la ficha.
- `public.bloquear_autoascenso_rol()` — solo un administrador mueve un rol (sin JWT no aplica: migraciones).
- Patrón general de RLS: **lectura para autenticados, escritura solo administradores**;
  excepciones: subir archivos y crear álbumes lo puede hacer cualquiera y solo el autor
  (o un admin) los edita/borra (014); `mensajes` solo para socios (006); marcas de lectura
  y reportes son de cada quien.
- Realtime publicado sobre `proyectos`, `checklist_hitos`, `usuarios`, `archivos`,
  `gastos`, `galeria_albumes`, `configuracion`, `mensajes`.

### Storage

Dos buckets, **privados desde la migración 018**: `archivos_mmcapital` (documentos,
portadas, avatares, galería) y `facturas` (comprobantes). Nada de `getPublicUrl`: cada
enlace se firma con `createSignedUrl` (1 hora) desde `src/lib/urlFirmada.js`, que además
re-firma al vuelo las URLs públicas antiguas guardadas en la base.

Rutas dentro de `archivos_mmcapital`:
`avatares/<uid>/…` · `proyecto_<uuid>/…` · `corporate_vault/…` · `chat/…`

---

## 4. Servicios externos y variables de entorno

### Supabase (obligatorio)
Cliente en `src/supabaseClient.js`. En `.env` de la raíz:

| Variable | Dónde | Para qué |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env` (cliente) | URL del proyecto |
| `VITE_SUPABASE_ANON_KEY` | `.env` (cliente) | Clave pública anónima |

Son las **únicas** dos variables del frontend. Sin ellas la app arranca pero avisa por consola.

### Google Gemini (a través de la Edge Function)
La clave **nunca** llega al navegador. Secretos del proyecto Supabase:

| Secreto | Para qué |
|---|---|
| `GEMINI_API_KEY` | Clave de la API de Google |
| `APP_ORIGINS` | Lista blanca CORS separada por comas. Los `localhost` 5173/4173 van siempre incluidos |
| `SUPABASE_URL` | Inyectada por la plataforma; la función crea su cliente con ella |
| `SUPABASE_ANON_KEY` | Idem; el cliente se crea con el JWT del usuario para respetar RLS |

```bash
npx supabase secrets set GEMINI_API_KEY=...
```

Modelos en cascada (se prueban en orden hasta que uno responda):
`gemini-flash-latest` → `gemini-2.0-flash` → `gemini-pro-latest`.

Dos reglas de seguridad grabadas en la función:
- **Solo los roles administrativos** pueden invocarla (se verifica con `es_admin()` sobre
  el JWT; un socio director o un inversionista recibe 403 aunque llame con curl).
- Las herramientas que **escriben** no escriben: devuelven una *propuesta* en `propuestas[]`
  y la escritura real ocurre en una segunda llamada `{ confirmar: {…} }` que dispara el
  usuario con un botón. Defensa contra prompt injection desde un PDF adjunto.

Herramientas declaradas: `obtener_resumen_financiero`, `consultar_checklist` (lectura,
directas) · `crear_nuevo_proyecto`, `registrar_gasto`, `actualizar_proyecto`,
`eliminar_proyecto`, `eliminar_gasto`, `modificar_fechas_checklist`, `editar_checklist`,
`reemplazar_checklist` (escritura, requieren confirmación).

### Otros
No hay analítica, ni pasarela de pago, ni CDN externo. El PWA sirve desde el propio origen.

---

## 5. Específico de MM Capital

### Nombres y marca
- Razón visible: **MM Capital Grupo Inmobiliario**; en la UI, "MM Capital".
- `<title>`: **Portal Ejecutivo - MM Capital**. Bajo el logo del login: **PORTAL EJECUTIVO**.
- Manifest PWA: `name` "MM Capital Dashboard", `short_name` "MM Capital",
  `display: standalone`, `orientation: portrait`, theme/background `#0f172a`.
- `apple-mobile-web-app-title`: "MM Capital". `<meta name="theme-color">` = `#0B1B2C`
  (navy de marca, deliberadamente distinto del `#0f172a` del manifest).
- Claves de `localStorage` con prefijo `mmcapital:` (`mmcapital:tema`, `mmcapital:idioma`).
- Nombre por defecto de un usuario sin nombre: **"Usuario MM Capital"**; iniciales de
  respaldo: **MM**.
- El diccionario **no traduce** la marca ni los nombres propios.

### Logo y assets (`public/`)
| Archivo | Uso |
|---|---|
| `logo1.png` | Login (invertido a blanco con `filter: brightness(0) invert(1)`) y cabecera móvil |
| `logo2.png` | Cabecera de escritorio |
| `logo1.jpg`, `logo2.jpg`, `logo21.png` | Variantes disponibles, sin uso en el código |
| `favicon2.png` | Favicon (`index.html`) |
| `favicon.svg`, `icons.svg` | Alternativas sin referenciar |
| `fondo-panel.mp4` | Vídeo de fondo del panel (`VideoBackground`) |

### Colores (declarados en `src/index.css`, fuente única)

Navy corporativo:
`--color-mm-navy #0B1B2C` · `--color-mm-navy-alto #16273B` (tarjetas sobre navy) ·
`--color-mm-navy-hondo #050D15` (sidebar) · `--color-mm-navy-velo #071320` (pie del sidebar).

Dorado — **tres tonos con oficios distintos y no intercambiables**:
- `--color-mm-oro #C5A059` — superficies, iconos, filetes, bordes. **Nunca texto pequeño**
  (2,46:1 sobre blanco, falla WCAG AA).
- `--color-mm-oro-tinta #8B6914` — el dorado para **texto en modo día** (5,09:1, cumple AA).
- `--color-mm-oro-claro #E3C77B` — el dorado para **texto en modo noche**.

Apoyos: `--color-mm-oro-lavado #FAF4EA` · `--color-mm-oro-borde #F0E2CD` ·
`--color-mm-oro-hover #F3E7D3` · `--color-mm-oro-vivo #D4B06A` · `--color-mm-oro-hondo #B8963A`.
Crema: `--color-mm-cream #F3F2EE`.

Jerarquía de superficies (tres niveles y solo tres), con tokens que cambian con el tema:
`--mm-lienzo` (fondo) · `--mm-tarjeta` / `--mm-tarjeta-alt` · `--mm-realce` (navy),
más `--mm-filete`, `--mm-filete-alto`, `--mm-sombra`, `--mm-sombra-alta`.
Texto: `--texto-1/2/3`. Modo oscuro por **clase** (`.dark`), no por `prefers-color-scheme`
(`@custom-variant dark`), y la pantalla de login se fuerza siempre en claro.

Se usan como utilidades Tailwind: `bg-mm-oro`, `text-mm-oro-tinta`, `border-mm-navy`,
`bg-mm-lienzo`…

### Roles de usuario

| Valor en `usuarios.rol` | Etiqueta ES / EN | Cargo mostrado |
|---|---|---|
| `admin` | Administrador / Administrator | Administrador |
| `socio_administrador` | Socio Administrador / Managing Partner | Socio propietario y socio administrativo |
| `socio_director` | Socio Director / Director Partner | Socio propietario e inversionista |
| `inversionista` | Inversionista / Investor | Socio propietario e inversionista |

El vocabulario está fijado en **tres sitios a la vez** y no puede divergir: `ROLES_VALIDOS`
en `src/lib/perfilUsuario.js` (de ahí sale el desplegable y la validación del servicio) y el
CHECK `usuarios_rol_check` de la migración 019. Un rol fuera de esa lista deja a la persona
sin etiqueta y **fuera del canal de Socios**.

Reglas de permiso repartidas por el código:
- **`admin` y `socio_administrador` mandan exactamente igual** (migración 021). La lista
  es `ROLES_ADMINISTRATIVOS` en `src/lib/perfilUsuario.js`, y de ella salen `isAdmin`
  (edición general, MODO EDICIÓN), `puedeEditarHitos`, `puedeUsarIA` y `puedeLimpiarChat`.
- El permiso REAL lo concede el padrón `administradores`, y un trigger lo mantiene al día
  con el rol: nombrar a alguien Socio Administrador en el panel le da poder de verdad,
  incluido cambiar roles y dar de alta a otros administradores.
- Chat "Socios": `admin`, `socio_administrador`, `socio_director`. Los inversionistas quedan
  fuera por decisión de negocio.
- `isInvestorOrPartner` = `inversionista` o `socio_director`.
- Cargo nominativo: si el nombre coincide con **Juan Carlos Meléndez** se muestra
  "Socio propietario y representante legal", con independencia del rol.
- Los nombres se pintan con tratamiento **"Ing. "** salvo que ya traigan uno
  (Ing./Inga./Arq./Lic./Licda./Dr./Dra./Sr./Sra.).
- El administrador raíz histórico era `luisp.bomel@gmail.com`; desde la migración 016 el
  correo **no otorga privilegio alguno**, solo el UUID en `administradores`.

### Terminología del producto

| Término | Significado |
|---|---|
| **Bóveda** | Repositorio de documentos legales y corporativos (`VaultView`, ruta `corporate_vault/`) |
| **Inversores / Inversionistas** | Vista de socios y sus aportaciones |
| **Aportación** | Capital que un socio pone en un proyecto (tabla `aportaciones`) |
| **Hito** | Tarea del checklist de obra; puede llevar `valor_asociado` en dólares |
| **Obra cerrada** | Valor de los hitos completados; suma al costo ejecutado junto con las facturas |
| **Costo ejecutado** | Facturas (`gastos`) + obra cerrada + ajuste manual |
| **Egresos ejecutados** | Cómo se rotula el gasto acumulado en el panel |
| **Capital total** | Cifra del portafolio, editable desde MODO EDICIÓN (`configuracion.capital_total`) |
| **MODO EDICIÓN** | Interruptor del administrador que habilita la edición en todas las vistas |
| **Cuota asignada / Anticipo** | Campos financieros del proyecto |
| **Chat Socios** | Único canal del chat interno (`mensajes.canal = 'socios'`) |
| **Chat de la IA — Asistente Ejecutivo** | Vista `AIChatView` |
| **Propuesta** | Acción de escritura que la IA prepara y el usuario confirma con un botón |
| **Reporte de soporte ejecutivo** | Incidencia que un socio abre desde su perfil, con hilo de respuestas |

**Categorías documentales de la bóveda** (el valor guardado en `archivos.tipo` es el texto
en español; solo la etiqueta se traduce): `Legal Corporativo`, `Poderes Legales`,
`Fiscal y Tributario`, `Gobernanza / Socios`, `Reglamento Interno`.

**Estados de proyecto**: derivados del avance real — 0% o sin hitos → *Planificación*;
1–99% → *En progreso*; 100% → *Finalizado*. En las semillas iniciales conviven además
etiquetas históricas ("En Progreso", "En Ejecución", "Fase Inicial").

**Estados de reporte**: `pendiente` · `en_proceso` · `resuelto`.

**Proyectos semilla** (migración 001, El Salvador): Proyecto San Martín (Colonia Santa
María, San Martín), Proyecto Chalchuapa (Santa Ana), Proyecto San Juan Opico (La Libertad).
Moneda: **USD**.

**Navegación**: Dashboard/Inicio · Proyectos · Bóveda · Inversores · Chat · Perfil, más las
vistas ocultas por rol (Administración de Usuarios y Roles, Chat IA). La vista activa viaja
en el query `?view=` y se lee en el primer render.

---

## 6. Convenciones que conviene respetar

- **Español en todo**: nombres de variables, funciones, comentarios y textos.
- Los comentarios de este repo explican *por qué*, no *qué*, y suelen documentar el problema
  que motivó el cambio. Mantener ese tono al editar.
- Nada toca Supabase fuera de `src/services/` (y `lib/urlFirmada.js` para las firmas).
- Ningún color a mano: usar los tokens `mm-*` de `src/index.css`.
- Dinero y porcentajes: siempre por `src/lib/numeros.js`.
- Lecturas de tablas que pueden crecer: `leerTablaCompleta` de `src/lib/supabasePaginado.js`,
  nunca un `select` pelado (PostgREST corta en 1.000 filas sin avisar).
- Migraciones: numeradas, **idempotentes**, en español y con cabecera que explique el
  problema. Se ejecutan a mano en el SQL Editor de Supabase.
- `supabase/scripts/` está en `.gitignore`: no meter ahí nada que deba versionarse.
