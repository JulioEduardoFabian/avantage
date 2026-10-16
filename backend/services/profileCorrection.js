import { findUniversityMentions } from './universityNormalizer.js';

/**
 * El contacto nos corrige la carrera o la universidad DESPUÉS de que ya se le
 * devolvieron escritas.
 *
 * El bot repite los dos datos en un solo mensaje antes de saltar a agendar
 * ("Perfecto: Ingeniería ambiental en X") precisamente para darle la
 * oportunidad de corregirnos — así está escrito en `offerScheduling()`. Lo
 * que faltaba era el otro lado: cuando de verdad corregía, el mensaje caía en
 * el paso de elección de horario, que solo sabe leer números y días, y
 * contestaba "No te entendí bien 🤔" con la misma lista. A la segunda
 * corrección se agotaban los intentos y la conversación se transfería a un
 * asesor.
 *
 * Caso real (15/10/2026, +51933977853): el bot leyó "Universidad católica
 * Sedes Sapientiae" como "Pontificia Universidad Católica del Perú"; el lead
 * respondió "No es la pontificia", "Es la Sapientiae", "Es esta universidad"
 * y terminó transferido. Minuto y medio después escribió "10:00 am" —eligió
 * un horario de la lista— y ya nadie lo leyó: la reunión nunca se agendó.
 *
 * Se resuelve con reglas y no con el LLM a propósito: de esto depende lo que
 * se guarda en la ficha (y después en la cotización y en el contrato), y el
 * catálogo cerrado de universidades ya sabe decir qué nombres aparecen en un
 * mensaje. Las reglas son deliberadamente estrechas: ante la duda devuelve
 * null y el paso de agendamiento sigue como siempre.
 */

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "No es...", "me equivoqué", "está mal": descarta lo que dijimos. */
const NEGATION_RE = /\bno\s+(?:es|era|fue|son|soy|estudio|estudie|estudiaba|curso|llevo)\b|\bme\s+equivoqu|\bequivocad[oa]\b|\bcorrijo\b|\bcorreccion\b|\bmal\s+escrit|\bno\s+esa\b|\bno\s+esa?\s+/;

/** "es...", "estudio...": afirma un valor nuevo. */
const ASSERTION_RE = /\b(?:es|era|seria|son|estudio|estudie|curso|llevo|soy\s+de|pertenezco)\b/;

const UNIVERSITY_WORD_RE = /\b(?:universidad|universidades|univ|instituto|institucion|escuela|pedagogico|politecnico|facultad|alma\s+mater|casa\s+de\s+estudios)\b/;
const CAREER_WORD_RE = /\b(?:carrera|especialidad|facultad|escuela\s+profesional)\b/;

/**
 * Señala algo que está fuera del texto (el mensaje anterior, un archivo que
 * acaba de mandar): "es esta universidad", "la que te mandé", "mi carrera".
 * Ahí no hay nombre que guardar — hay que preguntarlo.
 */
const POINTS_ELSEWHERE_RE = /\b(?:esta|este|esa|ese|aquella|aquel|la\s+que|el\s+que|lo\s+que|mi|mis)\b/;

/**
 * El mensaje habla de CUÁNDO, no de la ficha. Es el veto más importante: los
 * pasos de día y hora son los dueños de estas frases, y confundir "mejor el
 * jueves" con una corrección de universidad sería romper el agendamiento para
 * arreglar otra cosa.
 */
const WHEN_RE = /\b(hoy|ma[ñn]ana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|temprano|mediod[ií]a|tarde|noche|hora|horario|d[ií]a|a\s+las?|am|pm|minutos?|reuni[oó]n|cita|llamada|meet)\b/;

/** Palabras sin valor para comparar si dos carreras son "la misma". */
const CAREER_STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'en', 'y', 'e', 'ingenieria', 'licenciatura',
  'tecnico', 'tecnica', 'profesional', 'carrera', 'escuela'
]);

function significantTokens(text) {
  return normalize(text).split(' ').filter((token) => token.length > 3 && !CAREER_STOPWORDS.has(token));
}

/** ¿El mensaje nombra la carrera que ya tenemos guardada? */
function mentionsStoredCareer(normalizedText, storedField) {
  const tokens = significantTokens(storedField);
  if (tokens.length === 0) return false;
  return tokens.some((token) => new RegExp(`(?:^|\\s)${token}`).test(normalizedText));
}

/**
 * Lo que viene después del "es" final, como candidato a valor nuevo:
 * "no es ingeniería ambiental, es ambiental industrial" → "ambiental
 * industrial". Se toma el ÚLTIMO "es" porque la frase típica pone primero lo
 * que se descarta y después lo que vale.
 *
 * El "es" negado no cuenta (`(?<!no\s)`): sin eso, "No es la pontificia"
 * devolvía "la pontificia" como valor nuevo, o sea volvía a guardar
 * exactamente lo que el contacto acababa de descartar.
 */
function valueAfterAssertion(text) {
  const matches = [...String(text || '').matchAll(/(?<!\bno\s)\b(?:es|era|seria|estudio|estudie|curso|llevo)\s+(?:la\s+|el\s+|en\s+la\s+|en\s+el\s+|en\s+|de\s+)?([^,.;\n]{3,60})/gi)];
  if (matches.length === 0) return null;
  const candidate = matches[matches.length - 1][1].trim();
  // "es esta universidad" / "es la que te mandé" no son un nombre.
  if (POINTS_ELSEWHERE_RE.test(normalize(candidate))) return null;
  if (UNIVERSITY_WORD_RE.test(normalize(candidate)) && significantTokens(candidate).length === 0) return null;
  return candidate;
}

/**
 * Devuelve `null` si el mensaje no es una corrección, o
 * `{ field, value, raw }` donde:
 *   - `field` es 'university' o 'field' (la carrera);
 *   - `value` es el valor nuevo ya resuelto, o `null` cuando el contacto
 *     descartó el nuestro sin decir el correcto ("no es la pontificia", "es
 *     esta universidad") y hay que preguntárselo.
 */
export function detectProfileCorrection(rawText, stored = {}) {
  const text = String(rawText || '').trim();
  if (!text || text.length > 400) return null;

  const normalized = normalize(text);
  if (!normalized || /^\d{1,2}$/.test(normalized)) return null;
  if (WHEN_RE.test(normalized)) return null;

  const negates = NEGATION_RE.test(normalized);
  const asserts = ASSERTION_RE.test(normalized);

  // --- Universidad ---------------------------------------------------------
  const mentions = findUniversityMentions(text);
  const storedUniversity = normalize(stored.university || '');
  const others = mentions.filter((name) => normalize(name) !== storedUniversity);

  if (others.length > 0 && (negates || asserts || UNIVERSITY_WORD_RE.test(normalized))) {
    // Nombra una universidad distinta de la guardada: esa es la buena. Si
    // nombra varias (la nuestra y la suya), vale la última — la frase pone
    // primero lo que descarta.
    return { field: 'university', value: others[others.length - 1], raw: text };
  }

  const rejectsStoredUniversity = negates
    && (mentions.some((name) => normalize(name) === storedUniversity) || UNIVERSITY_WORD_RE.test(normalized));
  const pointsAtUniversity = UNIVERSITY_WORD_RE.test(normalized)
    && POINTS_ELSEWHERE_RE.test(normalized)
    && (asserts || negates);

  if (rejectsStoredUniversity || pointsAtUniversity) {
    const spelled = negates ? valueAfterAssertion(text) : null;
    return { field: 'university', value: spelled, raw: text };
  }

  // --- Carrera -------------------------------------------------------------
  // Más estrecho que la universidad: no hay catálogo cerrado de carreras
  // (ver `careerNormalizer.js`), así que solo se acepta cuando el contacto
  // descarta explícitamente la que le dijimos o habla de "mi carrera".
  const touchesCareer = CAREER_WORD_RE.test(normalized) || mentionsStoredCareer(normalized, stored.field);
  if (negates && touchesCareer) {
    return { field: 'field', value: valueAfterAssertion(text), raw: text };
  }

  return null;
}
