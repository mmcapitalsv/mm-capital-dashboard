// Checklists semilla (datos de arranque) por proyecto.
//
// Se usan SOLO como respaldo visual cuando Supabase todavía no tiene ningún hito
// registrado para el proyecto. En cuanto existe al menos una fila en la base de
// datos, la base de datos manda y estos datos dejan de usarse.
//
// Se comparten entre ProjectDetails.jsx (detalle) y useProyectos.js (dashboard)
// para que ambos muestren exactamente el mismo porcentaje de avance.

export const CHECKLIST_SEEDS = {
  '1': [
    { done: true,  text: '1. Resanar y corregir defectos estructurales / obra gris', detail: 'Diagnóstico de grietas, refuerzo de cimentación y nivelación estructural completados.', fecha: '15 de junio 2025' },
    { done: true,  text: '2. Repello y afinado de paredes interior/exterior', detail: 'Repello completo aplicado. Paredes preparadas para pulido de acabados.', fecha: '10 de agosto 2025' },
    { done: false, text: '3. Instalación de pisos y enchapes cerámicos', detail: 'Porcelanato premium recibido en almacén. En proceso de colocación.', fecha: '20 de septiembre 2025' },
    { done: false, text: '4. Instalación de cielos falsos y luminarias LED', detail: 'Estructura de perfiles galvanizados y paneles de tablayeso.', fecha: '15 de octubre 2025' },
    { done: false, text: '5. Acabados finales, pintura elastomérica y entrega', detail: 'Pintura exterior resistente a intemperie e instalaciones sanitarias.', fecha: '25 de noviembre 2025' }
  ],
  '2': [
    { done: true,  text: '1. Compra del terreno e inscripción', detail: 'Escrituras registradas al 100% en CNR El Salvador.', fecha: '10 de abril 2025' },
    { done: true,  text: '2. Registro del terreno en CNR e Impuestos', detail: 'Inscripción de propiedad raíz completada. Impuestos municipales al día.', fecha: '15 de agosto 2025' },
    { done: true,  text: '3. Permisos de agua (ANDA) y luz (CLESA)', detail: 'Factibilidad técnica aprobada y medidores solicitados.', fecha: '1 de septiembre 2025' },
    { done: true,  text: '4. Permisos de construcción de la alcaldía', detail: 'Permiso municipal otorgado por la alcaldía.', fecha: '5 de octubre 2025' },
    { done: true,  text: '5. Planos arquitectónicos y estructurales', detail: 'Planos completos visados por el colegio de ingenieros.', fecha: '12 de octubre 2025' },
    { done: true,  text: '6. Colocación de primera piedra', detail: 'Acto simbólico de inicio de obras ejecutado.', fecha: '20 de octubre 2025' },
    { done: true,  text: '7. Búsqueda de cotizaciones de constructoras', detail: 'Recibidas 4 propuestas bajo modalidad suma alzada.', fecha: '1 de noviembre 2025' },
    { done: false, text: '8. Evaluación y adjudicación de cotizaciones', detail: 'Evaluación técnica y económica con junta directiva.', fecha: '20 de agosto 2025' },
    { done: false, text: '9. Inicio de obras de construcción (Plazo 3-4 meses)', detail: 'Terracería, cimentación y levantado de muros.', fecha: '30 de noviembre 2025' },
    { done: false, text: '10. Finalización de obra gris y acabados', detail: 'Techado, repellos, fontanería y carpintería.', fecha: '15 de diciembre 2025' },
    { done: false, text: '11. Apertura a la venta y comercialización', detail: 'Inicio de preventa con brochure ejecutivo y renders 3D.', fecha: '30 de diciembre 2025' }
  ],
  '3': [
    { done: true,  text: '1. Compra del terreno e inscripción CNR', detail: 'Terreno industrial de 5,000 m² inscrito legalmente.', fecha: '1 de marzo 2025' },
    { done: true,  text: '2. Pago de impuestos de registro CNR', detail: 'Solvencia municipal e impuestos CNR cancelados.', fecha: '20 de julio 2025' },
    { done: true,  text: '3. Permisos de agua y luz industrial', detail: 'Acometida trifásica aprobada por CLESA.', fecha: '30 de agosto 2025' },
    { done: false, text: '4. Permisos de construcción de la alcaldía', detail: 'Observación en drenaje de aguas pluviales pendiente de corregir.', fecha: '15 de agosto 2025' },
    { done: false, text: '5. Planos arquitectónicos e ingenierías', detail: 'Revisión final de cálculo estructural.', fecha: '10 de septiembre 2025' },
    { done: false, text: '6. Colocación de primera piedra', detail: 'Programado tras obtención de permiso municipal.', fecha: '20 de septiembre 2025' },
    { done: false, text: '7. Búsqueda de cotizaciones de constructoras', detail: 'Licitación pública en proceso.', fecha: '30 de septiembre 2025' },
    { done: false, text: '8. Evaluación y adjudicación de cotizaciones', detail: 'Análisis de ofertas recibidas.', fecha: '15 de octubre 2025' },
    { done: false, text: '9. Inicio de obras de construcción (Plazo 4 meses)', detail: 'Movimiento de tierra y nivelación de terrazas.', fecha: '31 de enero 2026' },
    { done: false, text: '10. Finalización de nave industrial y casetas', detail: 'Estructura metálica y cubierta de lámina aluzinc.', fecha: '15 de marzo 2026' },
    { done: false, text: '11. Apertura a la venta y comercialización', detail: 'Comercialización de bodegas industriales.', fecha: '30 de marzo 2026' }
  ]
};

// Tras ejecutar la migración, los proyectos pasan a tener UUID real y ya no
// coinciden con las claves '1','2','3'. Este índice por nombre permite que la
// plantilla siga apareciendo para que el administrador la guarde de una vez.
const SEEDS_POR_NOMBRE = {
  'proyecto san martin': '1',
  'proyecto chalchuapa': '2',
  'proyecto san juan opico': '3'
};

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Devuelve una copia segura de la checklist semilla (nunca null).
 * Busca primero por id y, si no hay coincidencia, por nombre del proyecto.
 */
export function getChecklistSeed(proyectoId, nombreProyecto) {
  let seed = CHECKLIST_SEEDS[String(proyectoId ?? '')];

  if (!Array.isArray(seed) && nombreProyecto) {
    const clave = SEEDS_POR_NOMBRE[normalizar(nombreProyecto)];
    if (clave) seed = CHECKLIST_SEEDS[clave];
  }

  if (!Array.isArray(seed)) return [];
  return seed.map((item) => ({ ...item }));
}
