/**
 * El buscador de los dos tableros de leads.
 *
 * Vive acá y no en cada vista por lo mismo que `leadCardDate.js`: el Setter
 * Funnel y el Funnel de Ventas buscan sobre los MISMOS leads, y hasta ahora
 * cada pantalla tenía su propia lista de campos —el de Ventas no miraba la
 * universidad ni el canal, el del setter no miraba las notas— así que el mismo
 * texto encontraba cosas distintas según el tablero.
 *
 * Y busca **tolerando errores de tipeo**: "Rodrigez" encuentra a "Rodríguez" y
 * "sistmas" encuentra "Sistemas". Eso no hace la búsqueda más rápida —la
 * distancia de Levenshtein cuesta más que un `includes`— así que el orden
 * importa: primero la coincidencia exacta, que resuelve la enorme mayoría de
 * los casos sin calcular nada, y la corrección de tipeos solo para lo que no
 * coincidió. Escribir bien sigue siendo igual de rápido que antes.
 */

/** Sin tildes, sin mayúsculas y sin espacios de más: así se compara todo acá. */
export function normalizeSearchText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cuántas letras de diferencia se perdonan en una palabra de esta longitud.
 *
 * Nada por debajo de 4 caracteres: con "ana" y una letra de margen entran
 * "ara", "una" y media agenda, y un buscador que devuelve de todo no sirve
 * para encontrar a nadie. De 4 a 6, un error; de 7 en adelante, dos — que es
 * el dedazo típico de un nombre largo.
 */
export function toleranceFor(term) {
  const n = term.length;
  if (n < 4) return 0;
  if (n <= 6) return 1;
  return 2;
}

/**
 * Distancia de Levenshtein entre dos cadenas, con corte temprano.
 *
 * `maxDistance` no es un adorno: sin él, comparar una consulta contra cada
 * palabra de cada lead en cada tecla es trabajo de sobra. Apenas la fila
 * entera supera el máximo tolerado ya no hay forma de bajar —la distancia
 * nunca decrece de fila en fila—, así que se corta y se devuelve
 * `maxDistance + 1`, que al llamador le basta para descartar.
 */
export function levenshtein(a, b, maxDistance = Infinity) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // La diferencia de largos es una cota inferior de la distancia: si ya se
  // pasa, no hace falta calcular nada.
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let fila = current[0];
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,      // inserción
        previous[j] + 1,         // borrado
        previous[j - 1] + costo  // sustitución
      );
      if (current[j] < fila) fila = current[j];
    }
    if (fila > maxDistance) return maxDistance + 1;
    const intercambio = previous;
    previous = current;
    current = intercambio;
  }
  return previous[b.length];
}

/**
 * ¿Este texto responde a esta consulta?
 *
 * Dos pasadas, en este orden:
 *   1. la coincidencia exacta de siempre (ya sin tildes ni mayúsculas, que por
 *      sí solo arregla buscar "Nuñez" y que la ficha diga "Núñez");
 *   2. si no, palabra por palabra con tolerancia a tipeos. Cada palabra de la
 *      consulta tiene que encontrar la suya en el texto — "juan centeno"
 *      encuentra a "Juan Diego Centeno" aunque no estén pegadas— y si falta
 *      una, no es.
 */
export function fuzzyMatchesText(text, query) {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  const haystack = normalizeSearchText(text);
  if (!haystack) return false;
  return matchesIndex({ text: haystack, words: haystack.split(' ') }, needle);
}

/** El mismo cruce, sobre un texto YA normalizado y partido en palabras. */
function matchesIndex(index, needle) {
  if (index.text.includes(needle)) return true;

  return needle.split(' ').every((term) => {
    const tolerancia = toleranceFor(term);
    if (tolerancia === 0) return index.words.some((word) => word.includes(term));
    return index.words.some((word) => {
      if (word.includes(term)) return true;
      if (Math.abs(word.length - term.length) > tolerancia) return false;
      return levenshtein(word, term, tolerancia) <= tolerancia;
    });
  });
}

/**
 * Los campos de texto por los que se busca un lead, iguales en los dos
 * tableros. El teléfono y el documento NO están acá: van aparte, sin tolerar
 * tipeos (ver `matchesLeadSearch`).
 */
const TEXT_FIELDS = [
  'full_name',
  'topic',
  'email',
  'field_of_study',
  'university',
  'academic_level',
  'additional_notes',
  'source',
  'assigned_to'
];

/**
 * ¿Este lead responde a lo que se escribió en el buscador?
 *
 * Los números se buscan **tal cual**, sin corregir nada: en un teléfono o un
 * DNI un dígito de diferencia es otra persona, y un buscador que "corrige"
 * eso muestra la ficha equivocada justo cuando alguien está por llamar. Por
 * eso una consulta de puros dígitos solo mira id, celular y documento, y por
 * substring: así "9325" sigue encontrando al que termina en 9325.
 */
export function matchesLeadSearch(lead, query) {
  const needle = normalizeSearchText(query).replace(/^#/, '');
  if (!needle) return true;
  if (!lead) return false;

  const digits = needle.replace(/\D/g, '');
  const soloNumeros = digits.length > 0 && digits === needle.replace(/\s/g, '');
  if (soloNumeros) {
    return String(lead.id ?? '').includes(digits)
      || String(lead.phone ?? '').replace(/\D/g, '').includes(digits)
      || String(lead.dni ?? '').replace(/\D/g, '').includes(digits);
  }

  return matchesIndex(searchIndexOf(lead), needle);
}

/**
 * El texto buscable de un lead, normalizado una sola vez y guardado.
 *
 * Sin esto, cada tecla volvía a quitarle las tildes a nueve campos de cada uno
 * de los leads cargados: con dos mil fichas eran ~95 ms por pulsación en una
 * consulta de dos palabras, o sea tipear a los saltos. La normalización es lo
 * caro; cruzar ya es barato.
 *
 * El `WeakMap` se vacía solo cuando la vista reemplaza sus leads, y la firma
 * cruda (barata: concatenar) detecta los campos que la pantalla cambia en el
 * sitio —reasignar un lead reescribe `assigned_to` sobre el mismo objeto— para
 * que el índice no se quede viejo justo después de un cambio.
 */
const searchIndexCache = new WeakMap();

function searchIndexOf(lead) {
  // Los campos se unen con un salto de línea: `normalizeSearchText` lo trata
  // como cualquier otro espacio, así que sirve de separador de palabras y, a
  // la vez, de firma para saber si algo cambió.
  const raw = TEXT_FIELDS.map((field) => lead[field] ?? '').join('\n');
  const cached = searchIndexCache.get(lead);
  if (cached && cached.raw === raw) return cached;

  const text = normalizeSearchText(raw);
  const index = { raw, text, words: text ? text.split(' ') : [] };
  searchIndexCache.set(lead, index);
  return index;
}
