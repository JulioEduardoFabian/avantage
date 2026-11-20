/**
 * El criterio con el que se califica un lead, escrito y a la vista.
 *
 * Está acá y no dentro del componente porque es vocabulario del negocio y no
 * un detalle de esa pantalla: lo muestran las fichas de los dos tableros y lo
 * va a mirar cualquiera que tenga que explicar un "No". Copiado en cada
 * pantalla, el día que el equipo lo cambie van a convivir dos criterios y la
 * columna "Calificado" volverá a no significar nada — que es justo de donde se
 * viene (decía "Sí" en 403 de 403 leads).
 *
 * Son las tres preguntas que el equipo comercial ya hacía de palabra. Si el
 * criterio cambia, se cambia acá: la marca guardada no se recalcula —el lead
 * se calificó con el criterio de ese día— y por eso la ficha dice también
 * quién la puso y cuándo.
 */
export const QUALIFICATION_CRITERIA = [
  'Tiene una tesis o un trabajo de investigación en curso (no es una consulta general).',
  'Estudia o estudió en el Perú y su universidad o instituto se atiende.',
  'Puede invertir: conoce el rango de precio y no lo descartó.'
];
