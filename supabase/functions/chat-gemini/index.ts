// Edge Function `chat-gemini`
//
// Proxy seguro entre la app y la API de Gemini: la clave de Google vive solo
// aquí (`GEMINI_API_KEY` en los secretos del proyecto) y nunca viaja al
// navegador. Solo responde a usuarios autenticados (JWT válido de Supabase).
//
// Además expone un menú de herramientas (Function Calling) para que la IA
// consulte y escriba en la base a nombre del usuario: el cliente de Supabase
// se crea con el `Authorization: Bearer <jwt>` recibido, así que TODA acción
// de la IA pasa por las mismas políticas RLS que la app (solo el admin puede
// crear proyectos o registrar gastos).
//
// Cuerpo esperado:
//   { contents: [...], systemInstruction?: {...}, generationConfig?: {...}, modelos?: string[], herramientas?: boolean }
// Respuesta:
//   { texto: string, modeloUsado: string, herramientasUsadas: string[] }

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODELOS_POR_DEFECTO = [
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-pro-latest'
];

/** Tamaño máximo del cuerpo: los adjuntos viajan en Base64 inline. */
const CUERPO_MAX_BYTES = 25 * 1024 * 1024;

/** Vueltas máximas del ciclo modelo -> herramienta -> modelo, para no colgar la función. */
const MAX_VUELTAS_HERRAMIENTAS = 5;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// ── Declaración de herramientas ────────────────────────────────────────────
// Esquema OpenAPI reducido, tal como lo espera `tools[].functionDeclarations`.

const DECLARACIONES_HERRAMIENTAS = [
  {
    name: 'obtener_resumen_financiero',
    description:
      'Devuelve el resumen financiero de MM Capital: presupuesto total, gasto ejecutado, ' +
      'aportaciones de socios y saldo por proyecto. Úsala siempre que pregunten por cifras, ' +
      'presupuestos, gastos, inversión o el estado económico de uno o todos los proyectos.',
    parameters: {
      type: 'OBJECT',
      properties: {
        proyecto: {
          type: 'STRING',
          description:
            'Nombre (o parte del nombre) del proyecto a consultar. Si se omite, devuelve todos los proyectos.'
        }
      }
    }
  },
  {
    name: 'crear_nuevo_proyecto',
    description:
      'Crea un proyecto nuevo en MM Capital. Solo funciona si el usuario es administrador. ' +
      'Pide confirmación al usuario antes de llamarla.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nombre: { type: 'STRING', description: 'Nombre del proyecto.' },
        presupuesto: { type: 'NUMBER', description: 'Presupuesto total en dólares (USD).' },
        ubicacion: { type: 'STRING', description: 'Ubicación del proyecto.' },
        descripcion: { type: 'STRING', description: 'Descripción breve del proyecto.' }
      },
      required: ['nombre', 'presupuesto']
    }
  },
  {
    name: 'registrar_gasto',
    description:
      'Registra un gasto o factura de proveedor en un proyecto existente. Solo funciona si el ' +
      'usuario es administrador. Pide confirmación al usuario antes de llamarla.',
    parameters: {
      type: 'OBJECT',
      properties: {
        monto: { type: 'NUMBER', description: 'Monto del gasto en dólares (USD), mayor que cero.' },
        proyecto: { type: 'STRING', description: 'Nombre (o parte del nombre) del proyecto al que se carga el gasto.' },
        concepto: { type: 'STRING', description: 'Concepto o descripción del gasto.' },
        proveedor: { type: 'STRING', description: 'Proveedor al que se le paga. Si se omite se usa el concepto.' }
      },
      required: ['monto', 'proyecto', 'concepto']
    }
  }
];

// ── Utilidades ─────────────────────────────────────────────────────────────

function aNumero(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : parseFloat(String(valor ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function texto(valor: unknown): string {
  return String(valor ?? '').trim();
}

/**
 * Resuelve un nombre parcial de proyecto a su fila real.
 * Devuelve `null` si no hay coincidencia; el error se le explica a la IA.
 */
async function buscarProyecto(supabase: SupabaseClient, nombre: string) {
  const patron = nombre.replace(/[%_]/g, '');
  const { data, error } = await supabase
    .from('proyectos')
    .select('id, nombre, ubicacion, estado, presupuesto_total')
    .ilike('nombre', `%${patron}%`)
    .limit(5);

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── Implementación de cada herramienta ─────────────────────────────────────
// Todas usan el cliente autenticado con el JWT del usuario: si RLS lo bloquea,
// el error se devuelve como `functionResponse` para que la IA lo explique en
// lenguaje natural en vez de reventar la petición.

async function obtenerResumenFinanciero(supabase: SupabaseClient, args: Record<string, unknown>) {
  const filtroNombre = texto(args.proyecto);

  let consulta = supabase
    .from('proyectos')
    .select('id, nombre, ubicacion, estado, presupuesto_total, anticipo, cuota_asignada, porcentaje_avance');

  if (filtroNombre) consulta = consulta.ilike('nombre', `%${filtroNombre.replace(/[%_]/g, '')}%`);

  const { data: proyectos, error } = await consulta;
  if (error) return { error: `No se pudieron leer los proyectos: ${error.message}` };
  if (!proyectos || proyectos.length === 0) {
    return { error: filtroNombre ? `No existe ningún proyecto que coincida con "${filtroNombre}".` : 'No hay proyectos registrados.' };
  }

  const ids = proyectos.map(p => p.id);

  const [gastosRes, aportacionesRes] = await Promise.all([
    supabase.from('gastos').select('proyecto_id, monto').in('proyecto_id', ids),
    supabase.from('aportaciones').select('proyecto_id, monto').in('proyecto_id', ids)
  ]);

  if (gastosRes.error) return { error: `No se pudieron leer los gastos: ${gastosRes.error.message}` };

  const sumarPor = (filas: Array<{ proyecto_id: string; monto: unknown }> | null) => {
    const mapa: Record<string, number> = {};
    for (const f of filas ?? []) {
      mapa[f.proyecto_id] = (mapa[f.proyecto_id] ?? 0) + aNumero(f.monto);
    }
    return mapa;
  };

  const gastoPorProyecto = sumarPor(gastosRes.data);
  // Las aportaciones pueden estar restringidas por RLS para un socio: si fallan,
  // el resumen sigue siendo útil sin ellas.
  const aportePorProyecto = aportacionesRes.error ? {} : sumarPor(aportacionesRes.data);

  const detalle = proyectos.map(p => {
    const presupuesto = aNumero(p.presupuesto_total);
    const ejecutado = gastoPorProyecto[p.id] ?? 0;
    return {
      proyecto: p.nombre,
      ubicacion: p.ubicacion ?? '',
      estado: p.estado ?? '',
      avance_porcentaje: aNumero(p.porcentaje_avance),
      presupuesto_total: presupuesto,
      gasto_ejecutado: ejecutado,
      saldo_disponible: presupuesto - ejecutado,
      aportaciones_socios: aportePorProyecto[p.id] ?? 0,
      anticipo: aNumero(p.anticipo),
      cuota_asignada: aNumero(p.cuota_asignada)
    };
  });

  const total = (campo: keyof (typeof detalle)[number]) =>
    detalle.reduce((acc, d) => acc + aNumero(d[campo]), 0);

  return {
    moneda: 'USD',
    proyectos_analizados: detalle.length,
    totales: {
      presupuesto_total: total('presupuesto_total'),
      gasto_ejecutado: total('gasto_ejecutado'),
      saldo_disponible: total('saldo_disponible'),
      aportaciones_socios: total('aportaciones_socios')
    },
    detalle,
    aportaciones_no_visibles: Boolean(aportacionesRes.error)
  };
}

async function crearNuevoProyecto(supabase: SupabaseClient, args: Record<string, unknown>) {
  const nombre = texto(args.nombre);
  const presupuesto = aNumero(args.presupuesto);

  if (!nombre) return { error: 'Falta el nombre del proyecto.' };
  if (presupuesto <= 0) return { error: 'El presupuesto debe ser un número mayor que cero.' };

  const yaExiste = await buscarProyecto(supabase, nombre).catch(() => []);
  if (yaExiste.some(p => texto(p.nombre).toLowerCase() === nombre.toLowerCase())) {
    return { error: `Ya existe un proyecto llamado "${nombre}". No se creó nada.` };
  }

  const { data, error } = await supabase
    .from('proyectos')
    .insert([{
      nombre,
      presupuesto_total: presupuesto,
      ubicacion: texto(args.ubicacion),
      descripcion: texto(args.descripcion),
      estado: 'Fase Inicial',
      porcentaje_avance: 0
    }])
    .select('id, nombre, presupuesto_total, estado')
    .single();

  if (error) {
    return {
      error: `No se pudo crear el proyecto: ${error.message}. Es posible que solo el Administrador tenga permiso para crear proyectos.`
    };
  }

  return { ok: true, mensaje: 'Proyecto creado correctamente.', proyecto: data };
}

async function registrarGasto(supabase: SupabaseClient, args: Record<string, unknown>) {
  const monto = aNumero(args.monto);
  const nombreProyecto = texto(args.proyecto);
  const concepto = texto(args.concepto);
  const proveedor = texto(args.proveedor) || concepto;

  if (monto <= 0) return { error: 'El monto debe ser un número mayor que cero.' };
  if (!nombreProyecto) return { error: 'Falta indicar el proyecto.' };
  if (!concepto) return { error: 'Falta el concepto del gasto.' };

  let candidatos: Array<{ id: string; nombre: string }> = [];
  try {
    candidatos = await buscarProyecto(supabase, nombreProyecto);
  } catch (err) {
    return { error: `No se pudo buscar el proyecto: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (candidatos.length === 0) return { error: `No existe ningún proyecto que coincida con "${nombreProyecto}".` };
  if (candidatos.length > 1) {
    return {
      error: 'Hay varios proyectos que coinciden; pídele al usuario que elija uno.',
      coincidencias: candidatos.map(p => p.nombre)
    };
  }

  const proyecto = candidatos[0];

  const { data, error } = await supabase
    .from('gastos')
    .insert([{
      proyecto_id: proyecto.id,
      proveedor,
      concepto,
      // `descripcion` es la columna original de la tabla y varios reportes solo leen esa.
      descripcion: concepto,
      monto,
      comprobante: ''
    }])
    .select('id, proveedor, concepto, monto, created_at')
    .single();

  if (error) {
    return {
      error: `No se pudo registrar el gasto: ${error.message}. Es posible que solo el Administrador tenga permiso para registrar gastos.`
    };
  }

  return { ok: true, mensaje: 'Gasto registrado correctamente.', proyecto: proyecto.nombre, gasto: data };
}

const EJECUTORES: Record<string, (s: SupabaseClient, a: Record<string, unknown>) => Promise<unknown>> = {
  obtener_resumen_financiero: obtenerResumenFinanciero,
  crear_nuevo_proyecto: crearNuevoProyecto,
  registrar_gasto: registrarGasto
};

async function ejecutarHerramienta(supabase: SupabaseClient, nombre: string, args: Record<string, unknown>) {
  const ejecutor = EJECUTORES[nombre];
  if (!ejecutor) return { error: `La herramienta "${nombre}" no existe.` };

  try {
    return await ejecutor(supabase, args ?? {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  // 1. Autenticación: sin JWT válido no se gasta ni una llamada a Google
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'No autorizado.' }, 401);
  }

  // El JWT del usuario viaja en cada consulta: la IA nunca escapa de su RLS.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: errorAuth } = await supabase.auth.getUser();
  if (errorAuth || !user) return json({ error: 'No autorizado.' }, 401);

  // 2. Clave de Google: solo existe en los secretos de la función
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return json({ error: 'La IA no está configurada en el servidor.' }, 500);

  // 3. Cuerpo de la petición
  const bruto = await req.text();
  if (bruto.length > CUERPO_MAX_BYTES) {
    return json({ error: 'La petición es demasiado grande.' }, 413);
  }

  let cuerpo: {
    contents?: unknown;
    systemInstruction?: unknown;
    generationConfig?: unknown;
    modelos?: unknown;
    herramientas?: unknown;
  };
  try {
    cuerpo = JSON.parse(bruto);
  } catch {
    return json({ error: 'Cuerpo inválido.' }, 400);
  }

  const contents = cuerpo.contents;
  if (!Array.isArray(contents) || contents.length === 0) {
    return json({ error: 'Falta el contenido de la conversación.' }, 400);
  }

  // Solo se aceptan modelos de la lista blanca: el cliente no elige rutas libres
  const solicitados = Array.isArray(cuerpo.modelos)
    ? (cuerpo.modelos as unknown[]).filter(m => typeof m === 'string' && MODELOS_POR_DEFECTO.includes(m)) as string[]
    : [];
  const modelos = solicitados.length > 0 ? solicitados : MODELOS_POR_DEFECTO;

  // Las herramientas vienen activadas salvo que el cliente pida `herramientas: false`.
  const usarHerramientas = cuerpo.herramientas !== false;

  const peticionBase: Record<string, unknown> = {};
  if (cuerpo.systemInstruction) peticionBase.systemInstruction = cuerpo.systemInstruction;
  if (cuerpo.generationConfig) peticionBase.generationConfig = cuerpo.generationConfig;
  if (usarHerramientas) {
    peticionBase.tools = [{ functionDeclarations: DECLARACIONES_HERRAMIENTAS }];
  }

  // 4. Cascada de modelos: se prueban en orden hasta que uno responda
  let ultimoError = 'Error desconocido';

  for (const nombre of modelos) {
    try {
      // Historial propio de este intento: si el modelo falla a media conversación
      // de herramientas, el siguiente empieza limpio desde el turno del usuario.
      const historial: unknown[] = [...contents];
      const herramientasUsadas: string[] = [];
      let falloModelo = false;

      for (let vuelta = 0; vuelta < MAX_VUELTAS_HERRAMIENTAS; vuelta++) {
        const respuesta = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${nombre}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({ ...peticionBase, contents: historial })
          }
        );

        if (!respuesta.ok) {
          const detalle = await respuesta.text();
          ultimoError = `${nombre}: ${respuesta.status} ${detalle.slice(0, 300)}`;
          console.warn(`[chat-gemini] ${ultimoError}`);
          falloModelo = true;
          break;
        }

        const datos = await respuesta.json();
        const contenido = datos?.candidates?.[0]?.content;
        const partes: Array<Record<string, unknown>> = contenido?.parts ?? [];

        const llamadas = partes
          .map(p => p?.functionCall as { name?: string; args?: Record<string, unknown> } | undefined)
          .filter((f): f is { name: string; args?: Record<string, unknown> } => Boolean(f?.name));

        // 4a. Sin functionCall: es la respuesta final en texto
        if (llamadas.length === 0) {
          const textoFinal = partes
            .map(p => (typeof p?.text === 'string' ? p.text : ''))
            .join('')
            .trim();

          if (!textoFinal) {
            ultimoError = `${nombre}: respuesta vacía`;
            falloModelo = true;
            break;
          }

          return json({ texto: textoFinal, modeloUsado: nombre, herramientasUsadas });
        }

        // 4b. Hay functionCall: se ejecuta contra Supabase con el JWT del usuario
        // y el resultado vuelve al modelo como `functionResponse`.
        const respuestasHerramientas = await Promise.all(
          llamadas.map(async (llamada) => {
            herramientasUsadas.push(llamada.name);
            console.log(`[chat-gemini] tool ${llamada.name} · usuario ${user.id}`);
            const resultado = await ejecutarHerramienta(supabase, llamada.name, llamada.args ?? {});
            return { functionResponse: { name: llamada.name, response: { resultado } } };
          })
        );

        historial.push({ role: 'model', parts: partes });
        historial.push({ role: 'user', parts: respuestasHerramientas });
      }

      if (falloModelo) continue;

      ultimoError = `${nombre}: se agotaron las ${MAX_VUELTAS_HERRAMIENTAS} vueltas de herramientas sin respuesta final`;
      console.warn(`[chat-gemini] ${ultimoError}`);
    } catch (err) {
      ultimoError = `${nombre}: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`[chat-gemini] ${ultimoError}`);
    }
  }

  return json({ error: `La IA no respondió con ninguno de los modelos disponibles: ${ultimoError}` }, 502);
});
