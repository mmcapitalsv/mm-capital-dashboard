/**
 * Aplicación LOCAL de los eventos de Supabase Realtime.
 *
 * Antes cada evento disparaba una recarga completa del portafolio: siete
 * consultas y un re-render de todo el panel porque alguien corrigió el monto de
 * una factura. Con listas grandes eso es tráfico y trabajo desperdiciado, y
 * además deja una ventana en la que la pantalla muestra datos viejos mientras
 * la red responde.
 *
 * Aquí el evento se aplica sobre el arreglo que ya está en memoria: llega la
 * fila nueva, se inserta; llega una corrección, se reemplaza; llega un borrado,
 * se quita. Cero viajes a la red.
 *
 * Sigue habiendo un camino de recarga completa (`refetchData`) para lo que no
 * se puede parchear con una sola fila —cambios de esquema, joins, o el primer
 * arranque— y para cuando el usuario lo pide explícitamente.
 */

const mismaId = (a, b) => String(a ?? '') === String(b ?? '');

/**
 * Devuelve un actualizador `(prev) => siguiente` listo para `setState`.
 *
 * @param {object} payload            evento crudo de `postgres_changes`.
 * @param {object} [opciones]
 * @param {(fila: any) => boolean} [opciones.pertenece]
 *        Filtro de alcance: una vista de un solo proyecto ignora las filas de
 *        los demás. Por defecto entra todo.
 * @param {(fila: any) => any} [opciones.normalizar]
 *        Convierte la fila cruda de Postgres a la forma que usa la vista
 *        (`getFacturas` y compañía no devuelven la fila tal cual).
 * @param {'inicio'|'fin'} [opciones.insertarEn] dónde cae un INSERT.
 */
export function parchearLista(payload, {
  pertenece = () => true,
  normalizar = (fila) => fila,
  insertarEn = 'inicio'
} = {}) {
  const evento = payload?.eventType || payload?.event;
  const filaNueva = payload?.new && Object.keys(payload.new).length > 0 ? payload.new : null;
  /* En un DELETE, Postgres solo manda la clave primaria salvo que la tabla
     tenga REPLICA IDENTITY FULL: por eso el borrado se resuelve por `id` y
     nunca por el contenido de la fila. */
  const idBorrado = payload?.old?.id ?? null;

  return (previo) => {
    const lista = Array.isArray(previo) ? previo : [];

    if (evento === 'DELETE') {
      if (idBorrado === null) return lista;
      return lista.filter((f) => !mismaId(f?.id, idBorrado));
    }

    if (!filaNueva) return lista;

    /* Una fila que ya no pertenece a esta vista se trata como una salida: es el
       caso de un gasto que se reasigna a otro proyecto. Dejarla en pantalla
       sería mostrar dinero ajeno en el proyecto equivocado. */
    if (!pertenece(filaNueva)) {
      return lista.filter((f) => !mismaId(f?.id, filaNueva.id));
    }

    const item = normalizar(filaNueva);
    const indice = lista.findIndex((f) => mismaId(f?.id, filaNueva.id));

    // Un INSERT repetido (reconexión del canal) actualiza, no duplica.
    if (indice >= 0) {
      const copia = [...lista];
      copia[indice] = { ...copia[indice], ...item };
      return copia;
    }

    if (evento === 'UPDATE') {
      /* UPDATE de una fila que no teníamos: normalmente es una fila que acaba
         de entrar en nuestro alcance (cambió de proyecto). Se agrega. */
      return insertarEn === 'fin' ? [...lista, item] : [item, ...lista];
    }

    return insertarEn === 'fin' ? [...lista, item] : [item, ...lista];
  };
}

/** `true` si el evento afecta a la fila con ese id (en cualquiera de sus caras). */
export function afectaFila(payload, id) {
  return mismaId(payload?.new?.id, id) || mismaId(payload?.old?.id, id);
}
