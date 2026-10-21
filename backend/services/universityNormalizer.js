import { PERU_UNIVERSITIES, AMBIGUOUS_UNIVERSITY_TERMS } from '../data/peruUniversities.js';

function normalizeToken(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Busca `rawText` en el catálogo cerrado, comparando por palabra completa
 * (no substring) para que alias cortos como "uni"/"unt" no matcheen dentro
 * de otra palabra ("universidad" contiene "uni" pero no debe confundirse).
 *
 * Gana el candidato MÁS ESPECÍFICO de TODO el catálogo (el nombre completo
 * sobre cualquier alias, y entre alias el más largo) y no el de la primera
 * entrada de la lista: varias universidades peruanas comparten palabras
 * ("católica", "nacional"), y con el primero ganando ese término genérico
 * tapaba el nombre propio de otra entrada. Caso real del 15/10/2026:
 * "Universidad católica Sedes Sapientiae" se confirmó como "Pontificia
 * Universidad Católica del Perú" porque "catolica" era alias de la PUCP y su
 * entrada iba antes en la lista — y lo mismo le pasaba a la de Santa María,
 * la de San Pablo y todas las demás católicas del país.
 */
function matchCatalog(rawText) {
  const normalized = normalizeToken(rawText);
  if (!normalized) return null;

  let best = null;
  for (const entry of PERU_UNIVERSITIES) {
    for (const candidate of [entry.name, ...entry.aliases]) {
      const normalizedCandidate = normalizeToken(candidate);
      if (!normalizedCandidate) continue;
      const isExact = normalized === normalizedCandidate;
      if (!isExact) {
        const wordBoundaryRe = new RegExp(`(?:^|\\s)${escapeRegExp(normalizedCandidate)}(?:$|\\s)`);
        if (!wordBoundaryRe.test(normalized)) continue;
      }
      const score = normalizedCandidate.length + (isExact ? 1000 : 0);
      if (!best || score > best.score) best = { entry, score };
    }
  }
  return best?.entry || null;
}

/**
 * Todas las universidades del catálogo que aparecen nombradas en `rawText`,
 * en el orden en que aparecen.
 *
 * `normalizeUniversity()` contesta "¿cuál es esta universidad?" y devuelve
 * UNA. Esta contesta otra pregunta: "¿de qué universidades habla este
 * mensaje?", que es la que hay que hacerse cuando el contacto nos corrige —
 * "No es la pontificia / Es la Sapientiae" nombra DOS, y quedarse con la
 * primera (o con la más larga) es volver a guardar justo la que acaba de
 * descartar. Ver `profileCorrection.js`.
 */
export function findUniversityMentions(rawText) {
  const normalized = normalizeToken(rawText);
  if (!normalized) return [];

  const found = [];
  for (const entry of PERU_UNIVERSITIES) {
    let earliest = -1;
    for (const candidate of [entry.name, ...entry.aliases]) {
      const normalizedCandidate = normalizeToken(candidate);
      if (!normalizedCandidate) continue;
      const wordBoundaryRe = new RegExp(`(?:^|\\s)${escapeRegExp(normalizedCandidate)}(?:$|\\s)`);
      const match = wordBoundaryRe.exec(normalized);
      if (!match) continue;
      if (earliest === -1 || match.index < earliest) earliest = match.index;
    }
    if (earliest !== -1) found.push({ name: entry.name, index: earliest });
  }
  return found.sort((a, b) => a.index - b.index).map((item) => item.name);
}

/**
 * ¿El texto del contacto es, en esencia, solo un término que varias
 * universidades comparten ("la católica", "nacional")? Entonces no hay nada
 * que confirmar, por más seguro que suene el LLM: en el Perú "la católica"
 * son seis universidades distintas.
 */
function isAmbiguousTerm(rawText) {
  const normalized = normalizeToken(rawText).replace(/^(?:la|el|en|de)\s+/, '');
  return AMBIGUOUS_UNIVERSITY_TERMS.has(normalized);
}

/**
 * Resuelve una universidad peruana a partir de texto libre, dando prioridad
 * absoluta a un catálogo cerrado y determinístico antes de confiar en
 * cualquier respuesta del LLM: así "UNAC" nunca puede terminar confundida
 * con "UNCP", y "Villarreal" nunca con "San Marcos" — casos reales que
 * ocurrieron cuando la única fuente de verdad era una llamada al LLM
 * autoreportando su propia confianza.
 *
 * `resolveWithLLM(rawText)` es opcional: si se pasa, solo se invoca cuando el
 * catálogo no reconoce nada, y su resultado (`{name, confident}`) se vuelve a
 * validar contra el catálogo antes de aceptarse como confianza alta — un
 * `confident: true` que no calza con ninguna entrada real del catálogo baja
 * a confianza media en vez de aceptarse tal cual.
 *
 * Devuelve `{ name, confidence: 'alta'|'media'|'baja', source }`.
 * - alta: se puede confirmar la universidad tal cual.
 * - media: hay una corrección plausible pero sin verificar — preguntar antes
 *   de darla por buena.
 * - baja: no hay nada confiable que ofrecer — no mencionar ninguna
 *   universidad y quedarse con el texto tal cual escribió el contacto.
 */
export async function normalizeUniversity(rawText, { resolveWithLLM } = {}) {
  // Un término compartido no sube a confianza alta ni por el catálogo ni por
  // el LLM: no hay forma de saber cuál de las seis "católicas" es.
  if (isAmbiguousTerm(rawText)) {
    return { name: rawText, confidence: 'media', source: 'termino_ambiguo' };
  }

  const catalogMatch = matchCatalog(rawText);
  if (catalogMatch) {
    return { name: catalogMatch.name, confidence: 'alta', source: 'catalogo' };
  }

  if (typeof resolveWithLLM !== 'function') {
    return { name: rawText, confidence: 'baja', source: 'sin_resolver' };
  }

  const resolved = await resolveWithLLM(rawText);
  if (!resolved?.confident || !resolved?.name) {
    return { name: rawText, confidence: 'baja', source: 'llm' };
  }

  const validated = matchCatalog(resolved.name);
  if (validated) return { name: validated.name, confidence: 'alta', source: 'llm_validado' };

  return { name: resolved.name, confidence: 'media', source: 'llm_sin_catalogo' };
}
