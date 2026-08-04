import { supabase } from '../supabaseClient';

/**
 * Servicio de persistencia real del checklist de obra en Supabase.
 *
 * Fuente de verdad primaria: tabla relacional `checklist_hitos`
 *   (una fila por hito -> permite INSERT / UPDATE / DELETE individuales).
 * Respaldo automático: columna JSON `proyectos.checklist`
 *   (se usa solo si la tabla `checklist_hitos` no existe en el proyecto Supabase).
 *
 * El servicio se auto-adapta al esquema real: si una columna opcional no existe
 * en la tabla, la descarta y reintenta en lugar de perder el guardado completo.
 */

const TABLE = 'checklist_hitos';
const PROYECTOS_TABLE = 'proyectos';

/* ────────────────────────────── Utilidades de fecha ───────────────────────── */

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12
};

const MESES_NOMBRE = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

const COMBINING_MARKS = /[̀-ͯ]/g;

function sinAcentos(str) {
  return String(str || '').normalize('NFD').replace(COMBINING_MARKS, '');
}

/** "15 de junio 2025" | "2025-06-15" | Date -> "2025-06-15" (o null si no se puede). */
export function toISODate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  const match = sinAcentos(raw.toLowerCase()).match(/(\d{1,2})\s*de\s*([a-z]+)\s*(?:de\s*)?(\d{4})/);
  if (match) {
    const mes = MESES[match[2]];
    if (mes) {
      return `${match[3]}-${String(mes).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return null;
}

/** "2025-06-15" -> "15 de junio 2025" para mostrar en la interfaz. */
export function fromISODate(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  const nombreMes = MESES_NOMBRE[Number(match[2]) - 1];
  if (!nombreMes) return String(value);
  return `${Number(match[3])} de ${nombreMes} ${match[1]}`;
}

/* ──────────────────── Tolerancia a diferencias de esquema ─────────────────── */

/** La tabla completa no existe / no está expuesta en la API. */
function isMissingTable(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
  return code === '42P01' || code === 'PGRST205' || /could not find the table|relation .* does not exist/i.test(msg);
}

/** Devuelve el nombre de la columna problemática (inexistente o de tipo incompatible). */
function problemColumn(error, payloadKeys) {
  if (!error) return null;
  const code = String(error.code || '');
  const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;

  // Columna inexistente: 42703 (postgres) / PGRST204 (cache de esquema de PostgREST)
  if (code === '42703' || code === 'PGRST204' || /does not exist|could not find the/i.test(msg)) {
    const quoted = msg.match(/'([a-zA-Z0-9_]+)'\s+column/i) || msg.match(/column\s+"?([a-zA-Z0-9_]+)"?/i);
    if (quoted && payloadKeys.includes(quoted[1])) return quoted[1];
  }

  // Tipo incompatible (p. ej. texto libre en una columna DATE): 22007 / 22008 / 22P02
  if (['22007', '22008', '22P02'].includes(code) || /invalid input syntax/i.test(msg)) {
    const quoted = msg.match(/type\s+(\w+)/i);
    const esFecha = quoted && /date|timestamp/i.test(quoted[1]);
    if (esFecha && payloadKeys.includes('fecha_vencimiento')) return 'fecha_vencimiento';
    const col = msg.match(/column\s+"?([a-zA-Z0-9_]+)"?/i);
    if (col && payloadKeys.includes(col[1])) return col[1];
  }

  return null;
}

function stripColumn(payload, column) {
  if (Array.isArray(payload)) {
    return payload.map((row) => {
      const copy = { ...row };
      delete copy[column];
      return copy;
    });
  }
  const copy = { ...payload };
  delete copy[column];
  return copy;
}

function payloadKeys(payload) {
  const sample = Array.isArray(payload) ? payload[0] : payload;
  return sample && typeof sample === 'object' ? Object.keys(sample) : [];
}

/**
 * Ejecuta una operación de Supabase descartando automáticamente las columnas
 * que el esquema real no acepta, hasta un máximo de reintentos.
 */
async function runTolerant(payload, runner) {
  let body = payload;
  const stripped = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await runner(body);
    if (!result?.error) return { ...result, stripped };

    const keys = payloadKeys(body);
    const bad = problemColumn(result.error, keys);
    if (!bad || keys.length <= 1) return { ...result, stripped };

    console.warn(`[checklist] La columna "${bad}" no existe en el esquema; se omite y se reintenta.`);
    stripped.push(bad);
    body = stripColumn(body, bad);
  }
  return { ...(await runner(body)), stripped };
}

/** Columnas sin las cuales el checklist pierde información imprescindible. */
const COLUMNAS_CRITICAS = ['titulo', 'completado'];

function avisoMigracion(stripped) {
  const criticas = (stripped || []).filter(c => COLUMNAS_CRITICAS.includes(c));
  if (criticas.length === 0) return null;
  return `La tabla checklist_hitos no tiene la(s) columna(s) ${criticas.join(', ')}, ` +
         'así que ese dato no se pudo guardar. Ejecuta supabase/migrations/001_esquema_mmcapital.sql en el SQL Editor de Supabase.';
}

/* ─────────────────────────── Normalización de hitos ───────────────────────── */

/* ───────────────────── Compatibilidad de IDs (UUID vs demo) ───────────────── */

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Las tablas usan `uuid` para proyecto_id. Los proyectos de demostración que
 * el frontend inventa cuando la tabla `proyectos` está vacía usan '1','2','3',
 * lo que provoca: invalid input syntax for type uuid: "2".
 */
export function esIdValidoDeSupabase(id) {
  return typeof id === 'string' && RE_UUID.test(id.trim());
}

export const ERROR_ID_DEMO =
  'Este proyecto es de demostración (no existe en Supabase), por eso su ID no es un UUID. ' +
  'Ejecuta supabase/migrations/001_esquema_mmcapital.sql para crear los proyectos reales y vuelve a entrar.';

/** Convierte una fila de Supabase (o un item semilla) al formato que usa la UI. */
export function normalizeHito(row, index = 0) {
  if (!row || typeof row !== 'object') return null;

  const done = row.done === true || row.completado === true || row.estado === 'completado';
  const fechaTexto = row.fecha_texto || row.fecha || fromISODate(row.fecha_vencimiento);
  const ordenNum = Number(row.orden);

  return {
    id: row.id ?? null,
    done,
    text: String(row.text || row.titulo || row.nombre || 'Hito sin título'),
    detail: String(row.detail || row.descripcion || ''),
    fecha: fechaTexto ? String(fechaTexto) : '',
    // Dinero que este hito aporta al costo ejecutado al marcarse como hecho
    valor: aMonto(row.valor ?? row.valor_asociado),
    orden: Number.isFinite(ordenNum) ? ordenNum : index,
    persisted: row.id !== undefined && row.id !== null
  };
}

/** Lo que el usuario escribió en la casilla de dinero -> número no negativo. */
export function aMonto(valor) {
  if (valor === '' || valor === null || valor === undefined) return 0;
  const n = Number(String(valor).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100) / 100);
}

/**
 * Suma el `valor` de los hitos COMPLETADOS.
 *
 * Es lo que el checklist aporta al Costo Ejecutado del proyecto. Se recalcula
 * siempre desde la lista (no se acumulan deltas al marcar y desmarcar), así
 * que la cifra nunca se desincroniza aunque se marque y desmarque mil veces.
 */
export function sumarValoresCompletados(items) {
  if (!Array.isArray(items)) return 0;
  const total = items.reduce(
    (s, i) => s + (i && (i.done === true || i.estado === 'completado') ? aMonto(i.valor ?? i.valor_asociado) : 0),
    0
  );
  return Math.round(total * 100) / 100;
}

/**
 * Convierte un item de la UI a la fila que se manda a `checklist_hitos`.
 * Esquema real verificado: id(uuid), proyecto_id(uuid), completado(bool),
 * fecha_vencimiento(date), orden(int) + titulo/descripcion/fecha_texto
 * que agrega la migración 001.
 */
function toRow(item, index, proyectoId) {
  const fechaTexto = String(item?.fecha || '').trim();
  return {
    proyecto_id: proyectoId,
    titulo: String(item?.text || '').trim() || 'Hito sin título',
    descripcion: String(item?.detail || '').trim(),
    completado: !!item?.done,
    fecha_vencimiento: toISODate(fechaTexto),
    fecha_texto: fechaTexto,
    valor_asociado: aMonto(item?.valor),
    orden: index
  };
}

/** Ordena por `orden`, luego por fecha de creación, luego por id. */
function sortHitos(rows) {
  return [...rows].sort((a, b) => {
    const ordenA = Number.isFinite(Number(a?.orden)) ? Number(a.orden) : Number.MAX_SAFE_INTEGER;
    const ordenB = Number.isFinite(Number(b?.orden)) ? Number(b.orden) : Number.MAX_SAFE_INTEGER;
    if (ordenA !== ordenB) return ordenA - ordenB;
    const fechaA = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const fechaB = b?.created_at ? new Date(b.created_at).getTime() : 0;
    if (fechaA !== fechaB) return fechaA - fechaB;
    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  });
}

/** Porcentaje de avance físico (0-100) blindado contra arreglos vacíos o nulos. */
export function calcularAvance(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  const completados = items.filter((i) => i && (i.done === true || i.estado === 'completado')).length;
  return Math.round((completados / items.length) * 100);
}

/* ───────────────────────────────── Lectura ────────────────────────────────── */

/**
 * Lee el checklist real del proyecto desde Supabase.
 * @returns {Promise<{items: Array|null, source: 'checklist_hitos'|'proyectos_json'|'none', error: string|null}>}
 *   `items === null` significa "la base de datos no tiene nada guardado todavía"
 *   (el componente debe entonces mostrar la checklist semilla).
 */
export async function fetchChecklist(proyectoId) {
  if (proyectoId === undefined || proyectoId === null || proyectoId === '') {
    return { items: null, source: 'none', error: null };
  }

  // Los IDs de demostración ('1','2','3') no son UUID: consultar con ellos
  // devolvería 22P02. Se corta aquí para caer directo a la checklist semilla.
  if (!esIdValidoDeSupabase(proyectoId)) {
    return { items: null, source: 'none', error: null, esDemo: true };
  }

  // 1. Tabla relacional
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('proyecto_id', proyectoId);

    if (!error && Array.isArray(data) && data.length > 0) {
      const items = sortHitos(data).map((row, i) => normalizeHito(row, i)).filter(Boolean);
      return { items, source: 'checklist_hitos', error: null };
    }
    if (error && !isMissingTable(error)) {
      console.warn('[checklist] No se pudo leer checklist_hitos:', error.message);
    }
  } catch (err) {
    console.warn('[checklist] Excepción leyendo checklist_hitos:', err);
  }

  // 2. Respaldo: columna JSON en `proyectos`
  try {
    const { data, error } = await supabase
      .from(PROYECTOS_TABLE)
      .select('checklist')
      .eq('id', proyectoId)
      .maybeSingle();

    if (!error && data && Array.isArray(data.checklist) && data.checklist.length > 0) {
      const items = data.checklist.map((row, i) => normalizeHito(row, i)).filter(Boolean);
      return { items, source: 'proyectos_json', error: null };
    }
  } catch (err) {
    console.warn('[checklist] Excepción leyendo proyectos.checklist:', err);
  }

  return { items: null, source: 'none', error: null };
}

/* ───────────────────────────────── Escritura ──────────────────────────────── */

/** Guarda el porcentaje de avance físico en la tabla `proyectos` (best-effort). */
export async function guardarAvanceProyecto(proyectoId, porcentaje, extra = {}) {
  if (!esIdValidoDeSupabase(proyectoId)) return { error: null };

  const payload = { porcentaje_avance: porcentaje, ...extra };

  const { error } = await runTolerant(payload, (body) =>
    supabase.from(PROYECTOS_TABLE).update(body).eq('id', proyectoId)
  );

  if (error) console.warn('[checklist] No se pudo actualizar el avance en proyectos:', error.message);
  return { error: error ? error.message : null };
}

/** Respaldo completo del checklist como JSON dentro de `proyectos.checklist`. */
async function guardarComoJSON(proyectoId, items) {
  const limpio = items.map((item, i) => ({
    done: !!item.done,
    text: String(item.text || ''),
    detail: String(item.detail || ''),
    fecha: String(item.fecha || ''),
    valor: aMonto(item.valor),
    orden: i
  }));

  const { error } = await runTolerant(
    { checklist: limpio, porcentaje_avance: calcularAvance(limpio) },
    (body) => supabase.from(PROYECTOS_TABLE).update(body).eq('id', proyectoId)
  );

  if (error) {
    return { success: false, items: null, error: error.message, source: 'proyectos_json' };
  }
  return {
    success: true,
    items: limpio.map((row, i) => normalizeHito(row, i)),
    error: null,
    source: 'proyectos_json'
  };
}

/**
 * Sincroniza el checklist completo contra Supabase:
 *   - INSERT de las tareas nuevas (sin id)
 *   - UPDATE de las tareas existentes (estado del checkbox, texto, detalle, fecha, orden)
 *   - DELETE de las filas que ya no están en la lista
 *   - UPDATE del porcentaje de avance en `proyectos`
 *
 * @returns {Promise<{success: boolean, items: Array|null, porcentaje: number, error: string|null, source: string}>}
 */
export async function saveChecklist(proyectoId, items) {
  const lista = Array.isArray(items) ? items.filter(Boolean) : [];
  const porcentaje = calcularAvance(lista);

  if (proyectoId === undefined || proyectoId === null || proyectoId === '') {
    return { success: false, items: null, porcentaje, error: 'El proyecto no tiene un identificador válido.', source: 'none' };
  }

  // FIX del error `invalid input syntax for type uuid: "2"`:
  // se detecta antes de tocar la red y se explica qué hacer.
  if (!esIdValidoDeSupabase(proyectoId)) {
    return { success: false, items: null, porcentaje, error: ERROR_ID_DEMO, source: 'none', esDemo: true };
  }

  // ── 1. Leer ids existentes para saber qué borrar ──
  let idsEnBD = [];
  try {
    const { data, error } = await supabase.from(TABLE).select('id').eq('proyecto_id', proyectoId);

    if (error) {
      if (isMissingTable(error)) {
        const fallback = await guardarComoJSON(proyectoId, lista);
        return { ...fallback, porcentaje };
      }
      return { success: false, items: null, porcentaje, error: error.message, source: TABLE };
    }
    idsEnBD = (data || []).map((r) => r.id);
  } catch (err) {
    const fallback = await guardarComoJSON(proyectoId, lista);
    return { ...fallback, porcentaje, error: fallback.error || String(err?.message || err) };
  }

  const idsActuales = lista.map((i) => i.id).filter((id) => id !== null && id !== undefined);
  const idsABorrar = idsEnBD.filter((id) => !idsActuales.some((actual) => String(actual) === String(id)));

  let primerError = null;
  const columnasOmitidas = new Set();

  // ── 2. DELETE de los hitos eliminados por el administrador ──
  if (idsABorrar.length > 0) {
    const { error } = await supabase.from(TABLE).delete().in('id', idsABorrar);
    if (error) primerError = primerError || error.message;
  }

  // ── 3. UPDATE de los hitos existentes ──
  for (let i = 0; i < lista.length; i += 1) {
    const item = lista[i];
    if (item.id === null || item.id === undefined) continue;

    const { proyecto_id: _omit, ...patch } = toRow(item, i, proyectoId);
    const { error, stripped } = await runTolerant(patch, (body) =>
      supabase.from(TABLE).update(body).eq('id', item.id)
    );
    (stripped || []).forEach(c => columnasOmitidas.add(c));
    if (error) primerError = primerError || error.message;
  }

  // ── 4. INSERT de las tareas nuevas ──
  const nuevos = lista
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.id === null || item.id === undefined)
    .map(({ item, i }) => toRow(item, i, proyectoId));

  if (nuevos.length > 0) {
    const { error, stripped } = await runTolerant(nuevos, (body) => supabase.from(TABLE).insert(body));
    (stripped || []).forEach(c => columnasOmitidas.add(c));
    if (error) primerError = primerError || error.message;
  }

  // ── 5. Porcentaje de avance en la tabla de proyectos ──
  await guardarAvanceProyecto(proyectoId, porcentaje);

  if (primerError) {
    return { success: false, items: null, porcentaje, error: primerError, source: TABLE };
  }

  // Se guardó, pero faltan columnas imprescindibles en la tabla
  const aviso = avisoMigracion([...columnasOmitidas]);
  if (aviso) {
    return { success: false, items: null, porcentaje, error: aviso, source: TABLE, requiereMigracion: true };
  }

  // ── 6. Releer desde la base para devolver los ids reales ──
  const refrescado = await fetchChecklist(proyectoId);
  return {
    success: true,
    items: refrescado.items || [],
    porcentaje,
    error: null,
    source: refrescado.source
  };
}

/** Elimina permanentemente un hito de Supabase por su id. */
export async function deleteHito(hitoId) {
  if (hitoId === null || hitoId === undefined) return { success: true, error: null };
  try {
    const { error } = await supabase.from(TABLE).delete().eq('id', hitoId);
    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: String(err?.message || err) };
  }
}

/** Actualiza permanentemente un hito existente en Supabase. */
export async function updateHito(hitoId, item, orden = 0, proyectoId = null) {
  if (hitoId === null || hitoId === undefined) return { success: true, error: null };
  try {
    const { proyecto_id: _omit, ...patch } = toRow(item, orden, proyectoId);
    const { error } = await runTolerant(patch, (body) =>
      supabase.from(TABLE).update(body).eq('id', hitoId)
    );
    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: String(err?.message || err) };
  }
}
