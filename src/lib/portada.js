/*
 * Id del único selector de portada de la aplicación.
 *
 * Los botones "Cambiar portada" son <label htmlFor> apuntando aquí: abrir el
 * selector con la etiqueta es la forma NATIVA y funciona en todos los
 * teléfonos, mientras que llamar a `input.click()` desde JavaScript lo
 * bloquean varios navegadores móviles.
 *
 * Vive en `lib` porque el `<input>` real está en Dashboard.jsx pero las
 * etiquetas que lo abren viven en tres vistas distintas (panel, carrusel móvil
 * y "Todos los Proyectos"): si cada archivo se inventara su propia constante,
 * bastaría una letra de diferencia para que el botón dejara de abrir nada.
 */
export const ID_INPUT_PORTADA = 'input-portada-proyecto';
