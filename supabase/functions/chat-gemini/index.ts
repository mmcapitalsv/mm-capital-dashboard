// Edge Function `chat-gemini`
//
// Proxy seguro entre la app y la API de Gemini: la clave de Google vive solo
// aquí (`GEMINI_API_KEY` en los secretos del proyecto) y nunca viaja al
// navegador. Solo responde a usuarios autenticados (JWT válido de Supabase).
//
// Cuerpo esperado:
//   { contents: [...], systemInstruction?: {...}, generationConfig?: {...}, modelos?: string[] }
// Respuesta:
//   { texto: string, modeloUsado: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MODELOS_POR_DEFECTO = [
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-pro-latest'
];

/** Tamaño máximo del cuerpo: los adjuntos viajan en Base64 inline. */
const CUERPO_MAX_BYTES = 25 * 1024 * 1024;

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  // 1. Autenticación: sin JWT válido no se gasta ni una llamada a Google
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'No autorizado.' }, 401);
  }

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

  const peticion: Record<string, unknown> = { contents };
  if (cuerpo.systemInstruction) peticion.systemInstruction = cuerpo.systemInstruction;
  if (cuerpo.generationConfig) peticion.generationConfig = cuerpo.generationConfig;

  // 4. Cascada de modelos: se prueban en orden hasta que uno responda
  let ultimoError = 'Error desconocido';

  for (const nombre of modelos) {
    try {
      const respuesta = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${nombre}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(peticion)
        }
      );

      if (!respuesta.ok) {
        const detalle = await respuesta.text();
        ultimoError = `${nombre}: ${respuesta.status} ${detalle.slice(0, 300)}`;
        console.warn(`[chat-gemini] ${ultimoError}`);
        continue;
      }

      const datos = await respuesta.json();
      const texto = (datos?.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p?.text ?? '')
        .join('')
        .trim();

      if (!texto) {
        ultimoError = `${nombre}: respuesta vacía`;
        continue;
      }

      return json({ texto, modeloUsado: nombre });
    } catch (err) {
      ultimoError = `${nombre}: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(`[chat-gemini] ${ultimoError}`);
    }
  }

  return json({ error: `La IA no respondió con ninguno de los modelos disponibles: ${ultimoError}` }, 502);
});
