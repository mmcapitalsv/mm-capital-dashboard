import { supabase } from '../supabaseClient';

/**
 * Enlaces firmados de Supabase Storage (P0.1).
 *
 * Los buckets `archivos_mmcapital` y `facturas` son PRIVADOS desde la
 * migración 018: las URLs `/object/public/...` ya no resuelven y cualquier
 * lectura necesita una firma temporal que el servidor solo emite si las
 * políticas RLS dejan leer el objeto al usuario en sesión.
 *
 * Este módulo es el único sitio de la app que fabrica esas firmas. Trabaja
 * indistintamente con:
 *   · una ruta dentro del bucket  → `proyecto_<uuid>/1712_foto.jpg`
 *   · una URL ya guardada en la base (pública antigua o firmada caducada), de
 *     la que se extrae la ruta. Así los miles de registros históricos con
 *     `/object/public/` siguen viéndose sin migrar una sola fila.
 *
 * La caché evita pedir la misma firma en cada render: una lista de 40
 * documentos con avatares repetidos pasaría de 40+ peticiones a una por ruta.
 */

/** Bucket general de la aplicación (documentos, portadas, avatares, galería). */
export const BUCKET_ARCHIVOS = 'archivos_mmcapital';

/** Bucket dedicado a los comprobantes de las facturas de proveedores. */
export const BUCKET_FACTURAS = 'facturas';

/** Vida de una firma. Una hora: cubre de sobra una sesión de trabajo. */
export const TTL_FIRMA_SEGUNDOS = 3600;

/** Buckets que este módulo sabe firmar, en orden de búsqueda. */
const BUCKETS = [BUCKET_ARCHIVOS, BUCKET_FACTURAS];

/**
 * Se renueva la firma antes de que caduque de verdad: una imagen que empieza a
 * descargarse en el segundo 3599 no debe fallar a mitad.
 */
const MARGEN_MS = 5 * 60 * 1000;

/** `${bucket}|${ruta}` -> { url, expiraEn } */
const cache = new Map();

/** Firmas en vuelo, para que diez componentes no pidan diez veces lo mismo. */
const enVuelo = new Map();

function clave(bucket, ruta) {
  return `${bucket}|${ruta}`;
}

function leerCache(bucket, ruta) {
  const guardado = cache.get(clave(bucket, ruta));
  if (!guardado) return null;
  if (guardado.expiraEn - MARGEN_MS <= Date.now()) {
    cache.delete(clave(bucket, ruta));
    return null;
  }
  return guardado.url;
}

function guardarCache(bucket, ruta, url, ttl) {
  cache.set(clave(bucket, ruta), { url, expiraEn: Date.now() + ttl * 1000 });
}

/** Vacía la caché (cierre de sesión: las firmas del usuario anterior sobran). */
export function olvidarFirmas() {
  cache.clear();
  enVuelo.clear();
}

/**
 * Ruta y bucket de un valor guardado en la base.
 *
 * Reconoce las tres formas que Storage produce —`/object/public/<bucket>/`,
 * `/object/sign/<bucket>/` y `/object/authenticated/<bucket>/`— y también una
 * ruta pelada, que es lo que hay en `archivos.storage_path`.
 *
 * @param {string} valor  URL guardada o ruta dentro del bucket
 * @param {string} [bucketEsperado]  restringe la búsqueda a un bucket
 * @returns {{bucket: string, ruta: string}|null}
 */
export function rutaDeUrl(valor, bucketEsperado) {
  const bruto = typeof valor === 'string' ? valor.trim() : '';
  if (!bruto) return null;

  const candidatos = bucketEsperado ? [bucketEsperado] : BUCKETS;

  // 1. URL de Storage: se corta por la marca del bucket
  if (/^https?:\/\//i.test(bruto)) {
    for (const bucket of candidatos) {
      for (const modo of ['public', 'sign', 'authenticated']) {
        const marca = `/object/${modo}/${bucket}/`;
        const i = bruto.indexOf(marca);
        if (i === -1) continue;
        const cruda = bruto.slice(i + marca.length).split('?')[0];
        try {
          return { bucket, ruta: decodeURIComponent(cruda) };
        } catch {
          return { bucket, ruta: cruda };
        }
      }
    }
    // URL externa (o de otro bucket): no es cosa nuestra
    return null;
  }

  // 2. Nada que firmar en un data:/blob: de una previsualización local
  if (/^(data|blob):/i.test(bruto)) return null;

  /* 3. Lo que empieza por «/» es un recurso del propio sitio (`/logo1.png`,
        una portada de demo en `public/`), no una clave del bucket: las claves
        que genera la app son siempre `carpeta/archivo`. Confundirlas haría
        pedir una firma imposible y dejaría la imagen en blanco. */
  if (bruto.startsWith('/')) return null;

  // 4. Ruta pelada dentro del bucket
  return { bucket: bucketEsperado || BUCKET_ARCHIVOS, ruta: bruto };
}

/**
 * Firma UNA ruta. Devuelve null si Storage la rechaza (objeto borrado, o RLS
 * que no deja leerlo): quien llama pinta su respaldo en vez de un enlace roto.
 */
export async function firmarRuta(ruta, { bucket = BUCKET_ARCHIVOS, ttl = TTL_FIRMA_SEGUNDOS } = {}) {
  if (!ruta) return null;

  const cacheada = leerCache(bucket, ruta);
  if (cacheada) return cacheada;

  const k = clave(bucket, ruta);
  if (enVuelo.has(k)) return enVuelo.get(k);

  const promesa = (async () => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(ruta, ttl);
    if (error || !data?.signedUrl) {
      console.warn(`[urlFirmada] no se pudo firmar ${bucket}/${ruta}:`, error?.message || 'sin URL');
      return null;
    }
    guardarCache(bucket, ruta, data.signedUrl, ttl);
    return data.signedUrl;
  })().finally(() => enVuelo.delete(k));

  enVuelo.set(k, promesa);
  return promesa;
}

/**
 * Firma varias rutas del MISMO bucket en una sola petición.
 * @returns {Promise<Map<string, string>>} ruta -> URL firmada
 */
export async function firmarRutas(rutas, { bucket = BUCKET_ARCHIVOS, ttl = TTL_FIRMA_SEGUNDOS } = {}) {
  const mapa = new Map();
  const pendientes = [];

  for (const ruta of new Set((rutas || []).filter(Boolean))) {
    const cacheada = leerCache(bucket, ruta);
    if (cacheada) mapa.set(ruta, cacheada);
    else pendientes.push(ruta);
  }

  if (pendientes.length === 0) return mapa;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(pendientes, ttl);
  if (error) {
    console.warn(`[urlFirmada] fallo firmando ${pendientes.length} rutas de ${bucket}:`, error.message);
    return mapa;
  }

  for (const fila of data || []) {
    if (!fila?.path || !fila?.signedUrl) continue;
    guardarCache(bucket, fila.path, fila.signedUrl, ttl);
    mapa.set(fila.path, fila.signedUrl);
  }
  return mapa;
}

/**
 * Firma un valor guardado (URL antigua o ruta). Lo que no pertenece a nuestros
 * buckets —un `data:` de previsualización, una imagen externa— se devuelve tal
 * cual: firmarlo no tendría sentido y romperlo, menos.
 */
export async function firmarUrl(valor, { bucket, ttl = TTL_FIRMA_SEGUNDOS } = {}) {
  const destino = rutaDeUrl(valor, bucket);
  if (!destino) return typeof valor === 'string' ? valor : null;
  return firmarRuta(destino.ruta, { bucket: destino.bucket, ttl });
}

/**
 * Firma una lista de valores agrupando por bucket: una sola petición por
 * bucket en vez de una por elemento.
 * @returns {Promise<Map<string, string|null>>} valor original -> URL firmada
 */
export async function firmarUrls(valores, { bucket, ttl = TTL_FIRMA_SEGUNDOS, soloUrls = false } = {}) {
  const resultado = new Map();
  const porBucket = new Map();

  for (const valor of valores || []) {
    if (!valor || resultado.has(valor)) continue;
    // `soloUrls`: hay campos donde conviven enlaces y texto suelto —
    // `gastos.comprobante` guarda "Factura #F-9482" en las filas antiguas —
    // y ese texto no es una ruta del bucket, es el dato.
    const destino = soloUrls && !/^https?:\/\//i.test(String(valor).trim())
      ? null
      : rutaDeUrl(valor, bucket);
    if (!destino) { resultado.set(valor, valor); continue; }
    resultado.set(valor, null);
    if (!porBucket.has(destino.bucket)) porBucket.set(destino.bucket, new Map());
    porBucket.get(destino.bucket).set(valor, destino.ruta);
  }

  await Promise.all([...porBucket.entries()].map(async ([nombreBucket, pares]) => {
    const firmadas = await firmarRutas([...pares.values()], { bucket: nombreBucket, ttl });
    for (const [valor, ruta] of pares) resultado.set(valor, firmadas.get(ruta) ?? null);
  }));

  return resultado;
}

/**
 * Reescribe un campo con URL de una lista de filas, dejándolo firmado.
 * Devuelve filas NUEVAS: no muta lo que venga de Supabase.
 *
 * @param {Array<object>} filas
 * @param {string} campo   nombre de la propiedad que guarda la URL
 */
export async function firmarCampo(filas, campo, opciones = {}) {
  const lista = Array.isArray(filas) ? filas : [];
  if (lista.length === 0) return lista;

  const firmadas = await firmarUrls(lista.map(f => f?.[campo]), opciones);
  return lista.map(fila => (
    // `?? fila[campo]`: si la firma no se pudo emitir se deja el valor original
    // — un enlace muerto se ve mal, pero un campo vaciado pierde el dato.
    fila?.[campo] ? { ...fila, [campo]: firmadas.get(fila[campo]) ?? fila[campo] } : fila
  ));
}
