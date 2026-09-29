import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { BOT_PROMPT_DEFAULTS } from './whatsappBotPromptDefaults.js';
import { THESIS_SITUATIONS } from './leadQualification.js';
dotenv.config();

/**
 * Vectores de referencia simulados / temáticos de líneas prioritarias de investigación CONCYTEC - Perú
 * Se utilizan para medir la similitud semántica de embeddings en el contexto peruano.
 */
const PERU_RESEARCH_PRIORITIES = [
  { name: 'Tecnologías de la Información, IA y Automatización', keywords: ['inteligencia artificial', 'ia', 'software', 'algoritmo', 'vision', 'automatizacion', 'app', 'web', 'machine learning', 'datos'] },
  { name: 'Agroindustria, Seguridad Alimentaria y Biotecnología', keywords: ['palta', 'quinua', 'cafe', 'cacao', 'agrícola', 'cultivo', 'biotecnología', 'alimentos', 'riego', 'suelo'] },
  { name: 'Minería Sostenible, Recursos Naturales y Medio Ambiente', keywords: ['minería', 'cobre', 'agua', 'contaminación', 'medio ambiente', 'sostenible', 'residuos', 'energía', 'biodiversidad', 'relaves'] },
  { name: 'Salud Pública, Biomedicina y Bienestar Social', keywords: ['salud', 'hospital', 'diagnóstico', 'epidemía', 'nutrición', 'medicina', 'telemedicina', 'salud mental', 'dengue'] },
  { name: 'Educación, Gobernanza y Desarrollo Social en Perú', keywords: ['educación', 'sunedu', 'enseñanza', 'aprendizaje', 'corrupción', 'gestión pública', 'municipalidad', 'pobreza', 'universidad'] },
  { name: 'Economía, Finanzas y Emprendimiento Nacional', keywords: ['mype', 'empresa', 'finanzas', 'exportación', 'turismo', 'tributario', 'comercio', 'mercado', 'formalización'] }
];

/**
 * Calcula la similitud coseno entre dos vectores numéricos
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Le dice al LLM, en texto llano y sin ambigüedad, cuál es el siguiente dato
 * que le falta a Avan por conocer (en orden de prioridad). Modelos chicos
 * como los que corren en Ollama Cloud siguen una instrucción directa como
 * esta de forma mucho más confiable que si tienen que inferir la prioridad
 * a partir de una lista larga de reglas generales.
 */
function describeMissingPriority(knownAnswers) {
  const answers = knownAnswers || {};
  if (!answers.field && !answers.university) return 'su CARRERA y su UNIVERSIDAD, en una sola pregunta. NO marques "ready": true todavía.';
  if (!answers.field) return 'ya sabes su universidad; ahora te falta la CARRERA de su tesis. NO marques "ready": true todavía.';
  if (!answers.university) return 'ya sabes su carrera; ahora te falta la UNIVERSIDAD donde estudia. NO marques "ready": true todavía.';
  if (!answers.problem) return 'su TEMA de tesis, preguntado de forma fácil: "¿Ya tienes un tema o una idea para tu tesis, o empiezas desde cero?". Si ya te dijo que no tiene tema, no lo vuelvas a preguntar: guárdalo como "Sin tema definido (desde cero)". NO marques "ready": true todavía.';
  return 'ya tienes el tema, la carrera y la universidad: NO preguntes nada más (ni nivel, ni correo). Marca "ready": true en este mismo turno con un "reply" corto de acuse (ej. "Perfecto 👀"). El sistema se encarga de proponer la reunión y la modalidad.';
}

/**
 * "a las 5" en un contexto de reuniones comerciales son las 5 de la TARDE, no
 * las 5 de la mañana. El LLM devuelve a veces "05:00" y el lead terminaba con
 * horarios de madrugada. Si el texto original no dice explícitamente que es de
 * mañana, una hora entre la 1 y las 7 se corre a la tarde.
 */
function normalizeBusinessHour(hhmm, sourceText) {
  if (!hhmm) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || h < 1 || h > 7) return hhmm;
  if (/\b(a\.?\s?m|de la ma[nñ]ana|en la ma[nñ]ana|temprano|madrugada|amanecer)\b/i.test(String(sourceText || ''))) return hhmm;
  return `${String(h + 12).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * ¿El contacto nombró una hora CONCRETA ("a las 6", "18:30", "6pm", "a las
 * once"), o solo un momento del día ("temprano", "en la tarde")?
 *
 * La distinción importa porque el prompt de `parseSchedulingDate` convierte
 * los momentos vagos en una hora representativa ("temprano" → "09:00"), y sin
 * esta marca el resto del sistema no puede distinguir esa hora inventada de
 * una que la persona sí dijo: "el martes temprano?" terminaba agendado a las
 * 9:00 en punto, una hora que nadie eligió.
 */
const WORD_HOURS = 'una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|mediod[ií]a';
const EXPLICIT_CLOCK_RE = new RegExp(
  '\\d{1,2}\\s*:\\s*\\d{2}'                          // 18:30
  + '|\\d{1,2}\\s*(?:h|hrs?|horas)\\b'               // 18h, 6 hrs
  + '|\\d{1,2}\\s*\\.?\\s*(?:a\\.?\\s?m|p\\.?\\s?m)' // 6pm, 6 p.m.
  + `|a\\s+las?\\s+(?:\\d{1,2}|${WORD_HOURS})\\b`    // a las 6, a la una, a las once
  + `|\\b(?:${WORD_HOURS})\\s*(?:a\\.?\\s?m|p\\.?\\s?m)`, // once am
  'i'
);

function hasExplicitClockMention(text) {
  return EXPLICIT_CLOCK_RE.test(String(text || ''));
}

/** Minúsculas y sin tildes, para comparar texto del contacto contra etiquetas. */
function flatten(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * La hora escrita en un texto, en formato "HH:MM" de 24 h, o null.
 *
 * Reconoce "18:30", "6pm", "a las 6" y "6:30 p.m.". Sin meridiano, una hora
 * entre la 1 y las 7 se toma como de la tarde: las 6 a.m. no son un horario
 * de atención plausible. La usan tanto el respaldo sin IA como el cotejo de
 * un horario descrito con palabras contra las opciones ofrecidas, para que
 * ambos entiendan exactamente lo mismo por "las 7".
 */
function parseClockFromText(text) {
  const normalized = flatten(text);
  let hour = null;
  let minutes = 0;
  let meridiem = '';

  // El orden importa: en "a las 10:30" el "a las" aparece antes, así que
  // primero se busca el formato con minutos.
  let match = normalized.match(/(\d{1,2}):(\d{2})\s*(a\.?\s?m|p\.?\s?m)?/);
  if (match) {
    hour = Number(match[1]);
    minutes = Number(match[2]);
    meridiem = match[3] || '';
  } else if ((match = normalized.match(/(\d{1,2})\s*(a\.?\s?m|p\.?\s?m)/))) {
    hour = Number(match[1]);
    meridiem = match[2];
  } else if ((match = normalized.match(/a\s+las\s+(\d{1,2})\b/))) {
    hour = Number(match[1]);
  }

  if (hour === null) return null;
  meridiem = meridiem.replace(/[.\s]/g, '');
  if (meridiem.startsWith('p') && hour < 12) hour += 12;
  if (meridiem.startsWith('a') && hour === 12) hour = 0;
  if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
  if (hour < 0 || hour > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const WEEKDAY_RE = /\b(lun(?:es)?|mar(?:tes)?|mie(?:rcoles)?|jue(?:ves)?|vie(?:rnes)?|sab(?:ado)?|dom(?:ingo)?)\b/;

/**
 * Empareja una respuesta en palabras ("el jueves a las 7", "la de las 6:30")
 * con una de las opciones que se le ofrecieron, cuyas etiquetas tienen la
 * forma "Jue, 17 set, 7:00 p.m.". Devuelve el índice, o null si no coincide
 * exactamente una.
 *
 * Describir el horario es la forma natural de contestar, pero el respaldo sin
 * IA solo entendía el número de la opción: un "el jueves a las 7" caía en "no
 * te entendí" con esa misma opción en pantalla. Solo se acepta cuando la
 * coincidencia es única — con dos candidatos es mejor volver a preguntar que
 * agendar el día equivocado.
 */
function matchLabelByWords(text, optionLabels) {
  const wanted = parseClockFromText(text);
  if (!wanted) return null;

  const dayHint = (flatten(text).match(WEEKDAY_RE) || [])[1]?.slice(0, 3) || null;

  const matches = [];
  (optionLabels || []).forEach((label, index) => {
    if (parseClockFromText(label) !== wanted) return;
    // El día solo descarta cuando el contacto nombró uno: "la de las 6:30"
    // no nombra día y debe poder coincidir igual.
    if (dayHint && !flatten(label).startsWith(dayHint)) return;
    matches.push(index);
  });

  return matches.length === 1 ? matches[0] : null;
}

/**
 * ¿El contacto nombró un DÍA de verdad ("hoy", "mañana", "el jueves", "el 28",
 * "8 de setiembre"), o el mensaje es solo una hora ("para las 11?", "a las
 * 8pm")?
 *
 * Hace falta porque el prompt de `parseSchedulingDate` le pide al modelo
 * convertir a fecha CUALQUIER mensaje que llegue, aunque no traiga ningún día:
 * ante un "para las 11?" —sin "hoy", sin nombre de día, nada— el modelo
 * completaba igual con la fecha de HOY, en vez de devolver null como pide el
 * propio prompt. Eso hacía que, en medio de elegir horario para el martes, un
 * "para las 11?" se leyera como "para HOY a las 11" y activara el aviso de
 * "hoy ya no alcanzamos" — un día que nadie mencionó — en vez de buscar las
 * 11 dentro del martes que ya se estaba coordinando.
 */
const DAY_NAMES_RE = 'lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo';
const MONTH_NAMES_RE = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
const EXPLICIT_DAY_RE = new RegExp(
  '\\bhoy\\b'
  + '|\\bma[ñn]ana\\b'          // ambiguo con "de la mañana" (hora), pero la misma ambigüedad ya la acepta el resto del parser
  + '|\\bpasado\\s+ma[ñn]ana\\b'
  + `|\\b(?:${DAY_NAMES_RE})\\b`
  + '|\\bel\\s+\\d{1,2}\\b'      // "el 8", "el 28"
  + `|\\d{1,2}\\s*(?:de)?\\s*(?:${MONTH_NAMES_RE})\\b`
  + '|\\d{4}-\\d{2}-\\d{2}',      // fecha ISO explícita
  'i'
);

function hasExplicitDayMention(text) {
  return EXPLICIT_DAY_RE.test(String(text || ''));
}

const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const FLAT_WEEKDAY_NAMES = WEEKDAY_NAMES.map(flatten);
const EXPLICIT_CLOCK_GLOBAL_RE = new RegExp(EXPLICIT_CLOCK_RE.source, 'gi');

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

function weekdayOfIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Resuelve en código un día nombrado por su nombre ("el sábado", "sábado a
 * las 11") al más próximo desde hoy (hoy mismo si coincide).
 *
 * Caso real: el bot ofreció "el sábado 19 de 9:30 a.m. a 12:30 p.m.", el lead
 * pidió "Sábado a las 9:30am" y el modelo lo convirtió en otra fecha — al
 * prompt solo le llega la fecha ISO de hoy y tiene que calcular el día de la
 * semana por su cuenta, cosa en la que se equivoca. Resultado: "Ese día no
 * hay agenda" dos veces seguidas y traspaso a un asesor de un lead que estaba
 * agendando. Devuelve null (y decide el modelo) si el texto nombra más de un
 * día, habla de otra semana, o trae un día del mes que no coincide.
 */
export function resolveWeekdayDate(text, todayIso) {
  const flat = flatten(text);
  const names = [...new Set(flat.match(new RegExp(`\\b(?:${FLAT_WEEKDAY_NAMES.join('|')})\\b`, 'g')) || [])];
  if (names.length !== 1) return null;
  if (/\b(?:proxima|siguiente|otra)\s+semana\b|\bsubsiguiente\b/.test(flat)) return null;

  const diff = (FLAT_WEEKDAY_NAMES.indexOf(names[0]) - weekdayOfIso(todayIso) + 7) % 7;
  const date = addDaysIso(todayIso, diff);

  // "sábado 26": si además nombra un día del mes, tiene que coincidir. Las
  // horas ("a las 11", "9:30am") se quitan antes para no confundirlas.
  const dayOfMonth = flat.replace(EXPLICIT_CLOCK_GLOBAL_RE, ' ').match(/\b(\d{1,2})\b/);
  if (dayOfMonth && Number(dayOfMonth[1]) !== Number(date.slice(8, 10))) return null;

  return date;
}

/** "viernes 2026-09-18, sábado 2026-09-19, ..." para anclar al modelo en el calendario real. */
function upcomingCalendar(todayIso, days) {
  return Array.from({ length: days + 1 }, (_, i) => {
    const iso = addDaysIso(todayIso, i);
    return `${WEEKDAY_NAMES[weekdayOfIso(iso)]} ${iso}`;
  }).join(', ');
}

const OPENS_WITH_GREETING_RE = /^\s*[¡!]*\s*(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|buen d[ií]a|qu[eé] tal)\b/i;

/**
 * El primer mensaje tiene que abrir con un saludo. La instrucción está en el
 * prompt, pero el modelo la cumple de forma intermitente (sobre todo desde que
 * se le prohibió presentarse), y abrir en seco con una explicación se siente
 * brusco. Si no saluda, se le antepone el saludo — con exclamación, no un
 * punto seco: un saludo cerrado con punto lee como una lista de trámites, no
 * como alguien saludando de verdad.
 */
function ensureGreeting(reply, contactName) {
  const text = String(reply || '').trim();
  if (!text || OPENS_WITH_GREETING_RE.test(text)) return text;
  return `${contactName ? `¡Hola, ${contactName}!` : '¡Hola!'} ${text}`;
}

/**
 * Palabras que delatan el nombre de una universidad dentro de una respuesta
 * suelta. Solo la usa el camino de respaldo (sin LLM): la extracción real la
 * hace el modelo, que reconoce muchas más.
 */
const UNIVERSITY_HINT_RE = /universidad|instituto|\bpucp\b|\bunmsm\b|\bupc\b|\bucv\b|\buncp\b|\bupla\b|\buni\b|\butp\b|\busmp\b|continental|vallejo|cat[oó]lica|nacional de/i;

/**
 * Parte "Ingeniería de sistemas, UNCP" en carrera + universidad. Si no aparece
 * ninguna pista de universidad, todo el texto es la carrera; si el texto
 * ARRANCA con la universidad, no hay carrera que separar.
 */
function splitFieldAndUniversity(text) {
  const clean = String(text || '').trim();
  const match = clean.match(UNIVERSITY_HINT_RE);
  if (!match) return { field: clean || null, university: null };
  if (match.index === 0) return { field: null, university: clean };

  // "Ingeniería civil en la Universidad Continental" deja colgando el "en la":
  // se recortan la puntuación y las preposiciones que quedaron al final.
  const field = clean.slice(0, match.index)
    .replace(/[\s,;.:\-—]+$/, '')
    .replace(/(?:\s+(?:en|de|del|la|el|los|las|y))+$/i, '')
    .trim();
  return { field: field || null, university: clean.slice(match.index).trim() };
}

/**
 * Genera un embedding sintético determinista de 384 dimensiones para análisis semántico local
 */
function generateFallbackEmbedding(text) {
  const dim = 384;
  const vector = new Array(dim).fill(0);
  const normalizedText = text.toLowerCase();
  
  for (let i = 0; i < normalizedText.length; i++) {
    const charCode = normalizedText.charCodeAt(i);
    const index = (charCode * (i + 1) * 7) % dim;
    vector[index] += Math.sin(charCode) + Math.cos(i);
  }

  // Normalizar vector
  const mag = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(v => (mag > 0 ? v / mag : 0));
}

/**
 * JSON Schemas para las llamadas del AGENDAMIENTO (parseSchedulingDate,
 * parseSchedulingChoice, classifySchedulingAside). Se pasan en `format` en vez
 * del `'json'` genérico que se usaba antes: eso solo obligaba a que la
 * respuesta fuera JSON válido, sin garantizar ni los campos ni sus tipos —
 * Ollama la sigue aceptando aunque le falte un campo o venga con uno de más.
 * Con el esquema, el propio servidor restringe el muestreo para que la salida
 * calce con esta forma antes de llegar al parseo; el parseo manual que ya
 * existía se deja intacto como red de seguridad (fechas fuera de rango,
 * confusión de mayúscula/minúscula, o si el modelo en turno no soporta salida
 * estructurada y Ollama decide ignorar el esquema).
 *
 * Los campos NO llevan `pattern` (ej. para YYYY-MM-DD): esas restricciones de
 * formato no son parte del subconjunto de JSON Schema que todo backend de
 * Ollama garantiza soportar, y fallar la restricción de formato tira toda la
 * llamada al fallback. El formato del texto lo sigue validando el código con
 * los mismos regex de siempre.
 */
const SCHEDULING_DATE_SCHEMA = {
  type: 'object',
  properties: {
    date: { type: ['string', 'null'] },
    preferredTime: { type: ['string', 'null'] },
    declined: { type: 'boolean' }
  },
  required: ['date', 'preferredTime', 'declined']
};

const SCHEDULING_CHOICE_SCHEMA = {
  type: 'object',
  properties: {
    index: { type: ['integer', 'null'] },
    preferredTime: { type: ['string', 'null'] }
  },
  required: ['index', 'preferredTime']
};

const SCHEDULING_ASIDE_SCHEMA = {
  type: 'object',
  properties: {
    answersStep: { type: 'boolean' },
    isAside: { type: 'boolean' },
    preferredWhen: { type: ['string', 'null'] },
    answer: { type: ['string', 'null'] }
  },
  required: ['answersStep', 'isAside', 'preferredWhen', 'answer']
};

const UNIVERSITY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: ['string', 'null'] },
    confident: { type: 'boolean' }
  },
  required: ['name', 'confident']
};

const CONFIRMATION_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string' },
    extraRequest: { type: ['string', 'null'] }
  },
  required: ['decision', 'extraRequest']
};

const REFUSAL_SCHEMA = {
  type: 'object',
  properties: {
    refusing: { type: 'boolean' },
    kind: { type: ['string', 'null'] }
  },
  required: ['refusing', 'kind']
};

const SLOT_CONSTRAINT_SCHEMA = {
  type: 'object',
  properties: {
    understood: { type: 'boolean' },
    fits: { type: 'array', items: { type: 'integer' } },
    constraint: { type: ['string', 'null'] }
  },
  required: ['understood', 'fits', 'constraint']
};

/**
 * Servicio de integración con Ollama Cloud API / Local Ollama
 */
export class OllamaService {
  constructor() {
    this.host = process.env.OLLAMA_HOST || 'https://ollama.com';
    this.apiKey = process.env.OLLAMA_API_KEY || '';
    this.embedModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
    this.chatModel = process.env.OLLAMA_CHAT_MODEL || 'llama3:latest';

    // "ollama" (Ollama Cloud/local, por defecto) o "anthropic" (API de Claude,
    // vía créditos de la consola de Anthropic). Todos los métodos de este
    // archivo arman su propio prompt en español y esperan de vuelta texto con
    // JSON — el proveedor solo decide a qué backend se le manda ese prompt;
    // ver _generateJSON() más abajo.
    this.provider = (process.env.LLM_PROVIDER || 'ollama').toLowerCase();
    this.anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
    this.anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
    this.anthropicClient = this.anthropicApiKey ? new Anthropic({ apiKey: this.anthropicApiKey }) : null;
  }

  /** ¿Hay credenciales activas para el proveedor de LLM configurado? */
  hasLLM() {
    if (this.provider === 'anthropic') return !!this.anthropicApiKey;
    const activeApiKey = this.apiKey || process.env.OLLAMA_API_KEY || '';
    const activeHost = this.host || 'https://ollama.com';
    return !!activeApiKey || activeHost.includes('localhost') || activeHost.includes('127.0.0.1');
  }

  /**
   * Manda un prompt de una sola pieza (ya arma sistema + usuario como un solo
   * texto, igual que necesitaba el endpoint de completado de Ollama) al
   * backend de LLM configurado, y devuelve el objeto ya parseado de la
   * respuesta — cada método de este archivo sigue armando su propio prompt
   * (pidiéndole al modelo "responde ÚNICAMENTE en JSON válido: {...}") y
   * validando los campos que le importan; esto solo evita repetir la llamada
   * HTTP y el parseo de JSON en cada uno. Lanza si la llamada falla o la
   * respuesta no es JSON válido — el llamador ya tiene su propio respaldo sin
   * IA (fallbackXxx) para ese caso.
   */
  async _generateJSON(prompt, { timeoutMs = 15000, ollamaFormat = 'json' } = {}) {
    const raw = this.provider === 'anthropic'
      ? await this._generateTextViaAnthropic(prompt, timeoutMs)
      : await this._generateTextViaOllama(prompt, ollamaFormat, timeoutMs);
    const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    return JSON.parse(clean);
  }

  async _generateTextViaOllama(prompt, format, timeoutMs) {
    const activeApiKey = this.apiKey || process.env.OLLAMA_API_KEY || '';
    let activeHost = this.host || 'https://ollama.com';
    if (activeHost === 'https://api.ollama.com') activeHost = 'https://ollama.com';

    const generateUrl = this.getApiUrl(activeHost, '/generate');
    const response = await fetch(generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(activeApiKey ? { 'Authorization': `Bearer ${activeApiKey}` } : {})
      },
      body: JSON.stringify({ model: this.chatModel, prompt, stream: false, format }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama Cloud respondió ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    return data.response || '';
  }

  async _generateTextViaAnthropic(prompt, timeoutMs) {
    if (!this.anthropicClient) throw new Error('ANTHROPIC_API_KEY no está configurado en el servidor.');

    const response = await this.anthropicClient.messages.create(
      {
        model: this.anthropicModel,
        // 2048 alcanza de sobra para una respuesta corta de WhatsApp o un
        // parseo de fecha/horario, y también para el reporte de viabilidad
        // (el más largo de los JSON que arma este archivo) sin arriesgar un
        // corte a mitad del JSON — Haiku solo cobra por lo que de verdad
        // genera, así que subir este techo no cuesta más si no lo usa.
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      },
      { timeout: timeoutMs }
    );

    return response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }

  /**
  /**
   * Normaliza la URL base de la API de Ollama (ej: https://ollama.com/api)
   */
  getApiUrl(rawHost, path) {
    let base = (rawHost || 'https://ollama.com').trim().replace(/\/+$/, '');
    if (base.endsWith('/api')) {
      base = base.substring(0, base.length - 4);
    }
    if (base === 'https://api.ollama.com') {
      base = 'https://ollama.com';
    }
    return `${base}/api${path.startsWith('/') ? path : '/' + path}`;
  }

  /**
   * Genera el embedding del tema de forma local
   * Nota: el endpoint /api/embed de Ollama Cloud no está autorizado para claves API
   * (siempre devuelve 401, incluso con modelos cloud válidos), por lo que se calcula
   * el embedding localmente en vez de intentar la llamada remota.
   */
  async generateEmbedding(text) {
    console.log(`\n🧠 [Ollama Service] Generando embedding local para el tema...`);
    const fallbackVector = generateFallbackEmbedding(text);
    console.log(`✅ [Ollama Service] Embedding local generado (${fallbackVector.length} dimensiones)`);
    return {
      vector: fallbackVector,
      source: 'Ollama Semantic Engine (Local)',
      model: `${this.embedModel} (Local)`,
      dimension: fallbackVector.length
    };
  }

  /**
   * Evalúa la similitud del embedding con las líneas prioritarias de investigación en Perú
   */
  analyzeAlignmentWithPeruPriorities(topic, embeddingResult) {
    const topicLower = topic.toLowerCase();
    const alignments = PERU_RESEARCH_PRIORITIES.map(priority => {
      let score = 0.3; // base score
      
      // Coincidencia de palabras clave
      const matchCount = priority.keywords.filter(kw => topicLower.includes(kw)).length;
      score += matchCount * 0.18;

      // Variación basada en el vector de embedding
      const syntheticPriorityVec = generateFallbackEmbedding(priority.keywords.join(' '));
      const sim = cosineSimilarity(embeddingResult.vector, syntheticPriorityVec);
      score += sim * 0.25;

      const finalScore = Math.min(Math.max(Math.round(score * 100), 20), 98);

      return {
        priorityArea: priority.name,
        alignmentPercentage: finalScore,
        matchedKeywords: priority.keywords.filter(kw => topicLower.includes(kw))
      };
    });

    alignments.sort((a, b) => b.alignmentPercentage - a.alignmentPercentage);
    return alignments;
  }

  /**
   * Evalúa la viabilidad del tema de tesis a nivel de Pregrado o Posgrado en Perú
   */
  async evaluateThesisViability({ topic, academicLevel, fieldOfStudy, additionalNotes, apiKeyOverride, hostOverride }) {
    // Un "apiKeyOverride"/"hostOverride" explícito (p. ej. el evaluador
    // público de tesis con una key propia) es SIEMPRE contra Ollama directo,
    // sea cual sea LLM_PROVIDER: es la única forma de que ese override tenga
    // efecto, y "host" no tiene sentido para el proveedor Anthropic.
    const hasOverride = !!(apiKeyOverride && String(apiKeyOverride).trim() !== '') || !!(hostOverride && String(hostOverride).trim() !== '');
    const activeApiKey = (apiKeyOverride && String(apiKeyOverride).trim() !== '') ? apiKeyOverride.trim() : (this.apiKey || process.env.OLLAMA_API_KEY || '');
    let activeHost = (hostOverride && String(hostOverride).trim() !== '') ? hostOverride.trim() : (this.host || 'https://ollama.com');
    if (activeHost === 'https://api.ollama.com') activeHost = 'https://ollama.com';

    // Step 1: Generar Embedding
    const embeddingData = await this.generateEmbedding(topic);

    // Step 2: Calcular alineación vectorial con áreas prioritarias CONCYTEC
    const priorityAlignments = this.analyzeAlignmentWithPeruPriorities(topic, embeddingData);
    const topPriority = priorityAlignments[0];

    // Step 3: Intentar llamada a LLM Ollama Cloud si hay conexión/key
    let llmEvaluationRaw = null;

    try {
      const shouldCallOllamaDirect = hasOverride && (activeApiKey || activeHost.includes('localhost') || activeHost.includes('127.0.0.1'));
      const shouldCallConfiguredProvider = !hasOverride && this.hasLLM();

      if (shouldCallOllamaDirect || shouldCallConfiguredProvider) {
        const systemPrompt = `Eres un Presidente de Jurado de Tesis y Consultor Académico de alto nivel especializado en universidades peruanas (regular por SUNEDU y CONCYTEC).
Tu objetivo es evaluar la viabilidad de un tema de tesis propuesto para el nivel: ${academicLevel} en la carrera/área de ${fieldOfStudy}.

Responde ÚNICAMENTE en formato JSON válido con la siguiente estructura exacta:
{
  "overallViabilityScore": <número entre 0 y 100>,
  "viabilityLevel": "<Alta | Media-Alta | Media | Baja>",
  "academicLevelAssessed": "${academicLevel}",
  "peruContextRelevance": "<Resumen en 2-3 oraciones del impacto y pertinencia del tema en el contexto peruano actual>",
  "dimensionScores": {
    "rigorMethodological": <0-100>,
    "noveltyAcademic": <0-100>,
    "peruRelevance": <0-100>,
    "dataAvailability": <0-100>
  },
  "strengths": ["<fortaleza 1>", "<fortaleza 2>", "<fortaleza 3>"],
  "risksAndLimitations": ["<riesgo o limitación 1>", "<riesgo 2>"],
  "recommendedDelimitation": "<Propuesta concreta de título/delimitación ajustada a jurados en Perú>",
  "suggestedMethodology": {
    "approach": "<Cualitativa | Cuantitativa | Mixta>",
    "design": "<Ej: Descriptivo-Explicativo, Experimental, Caso de Estudio>",
    "sampleOrDataTarget": "<Sugerencia de muestra o ámbito de estudio en Perú>"
  },
  "keyConcytecLine": "${topPriority.priorityArea}"
}`;

        const userPrompt = `Tema de Tesis a evaluar: "${topic}"
Nivel: ${academicLevel}
Área de Conocimiento: ${fieldOfStudy}
Detalles adicionales: ${additionalNotes || 'Ninguno'}`;

        const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

        if (shouldCallOllamaDirect) {
          const generateUrl = this.getApiUrl(activeHost, '/generate');
          console.log(`🤖 [Ollama Cloud LLM] Petición a ${generateUrl} (${this.chatModel})...`);

          const response = await fetch(generateUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(activeApiKey ? { 'Authorization': `Bearer ${activeApiKey}` } : {})
            },
            body: JSON.stringify({ model: this.chatModel, prompt: fullPrompt, stream: false, format: 'json' })
          });

          console.log(`- Status ${generateUrl} => Status ${response.status} ${response.statusText}`);

          if (response.ok) {
            const data = await response.json();
            const cleanResponse = data.response.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
            llmEvaluationRaw = JSON.parse(cleanResponse);
            console.log(`✅ [Ollama Cloud LLM] Respuesta generada exitosamente por ${this.chatModel}`);
          } else {
            const errText = await response.text();
            console.warn(`⚠️ [Ollama Cloud LLM Error]: ${errText.substring(0, 150)}`);
          }
        } else {
          console.log(`🤖 [${this.provider} LLM] Generando reporte de viabilidad...`);
          llmEvaluationRaw = await this._generateJSON(fullPrompt, { timeoutMs: 20000 });
          console.log(`✅ [${this.provider} LLM] Reporte de viabilidad generado`);
        }
      }
    } catch (err) {
      console.warn(`${this.provider} LLM call notice:`, err.message);
    }

    // Step 4: Construir o complementar el reporte final
    const evaluation = llmEvaluationRaw || this.generateStructuredHeuristicEvaluation(topic, academicLevel, fieldOfStudy, topPriority);

    return {
      topic,
      academicLevel,
      fieldOfStudy,
      timestamp: new Date().toISOString(),
      embeddingInfo: {
        model: embeddingData.model,
        source: embeddingData.source,
        dimension: embeddingData.dimension,
        vectorSample: embeddingData.vector.slice(0, 5).map(n => Number(n.toFixed(4)))
      },
      priorityAlignments,
      evaluation
    };
  }

  /**
   * Motor conversacional de Avan por WhatsApp: en vez de un guion fijo de
   * preguntas numeradas, en cada turno el LLM decide qué responder y qué
   * preguntar (tono natural), y avisa cuándo ya conoce el tema de tesis (lo
   * único obligatorio) para que el sistema proponga agendar la llamada con
   * un asesor — el correo es opcional, solo para la invitación del Meet. Si
   * no hay conexión a Ollama Cloud (sin API key, o la llamada falla), se usa
   * una lógica de respaldo mínima basada en reglas.
   */
  async converseAsAvan({ history, knownAnswers, incomingText, isFirstTurn, toneInstructions, contactName, shortReplies = true, botIdentity, botObjective, promptRules, knowledgeBlock }) {
    if (!this.hasLLM()) {
      return this.fallbackConversationTurn(knownAnswers, incomingText, isFirstTurn);
    }

    // Bloques editables desde el panel (Configuración de Avan). Si el equipo
    // los dejó vacíos, se usan los textos por defecto. La ESTRUCTURA de abajo
    // (datos obligatorios, formato JSON, cuándo terminar) NO es editable: la
    // lógica de whatsappBotService.js depende de ella.
    const identity = (botIdentity && botIdentity.trim()) || BOT_PROMPT_DEFAULTS.identity;
    const objective = (botObjective && botObjective.trim()) || BOT_PROMPT_DEFAULTS.objective;
    const teamRules = (Array.isArray(promptRules) && promptRules.length) ? promptRules : BOT_PROMPT_DEFAULTS.rules;

    // Breve, pero no seco: el modo corto anterior prohibía toda introducción y
    // el resultado era "[acuse de dos palabras] + [pregunta]" en cada turno,
    // es decir un interrogatorio. Ahora se conserva el límite de longitud pero
    // se le exige que la primera parte aporte algo real.
    const shortRepliesRule = shortReplies
      ? 'LARGO MÁXIMO: 25 palabras, y el PRIMER mensaje 20 — es el que más se lee de una ojeada y el que decide si te responden. En Perú nadie lee párrafos por WhatsApp: si tu respuesta ocupa más de dos renglones en un celular, es demasiado larga. Estructura: (a) responde o reconoce en POCAS palabras lo que acaba de escribir —si preguntó algo, la respuesta resumida va aquí; si solo te dio el dato que le pediste, esta parte es un acuse de UNA palabra y NO repite el dato (ver NO LE REPITAS SUS PROPIOS DATOS)— y (b) UNA sola pregunta. Nada de relleno corporativo ni cierres de correo ("quedo atento", "cualquier cosa me avisas"). No repitas el nombre de la empresa si ya lo dijiste: ni dos veces en el mismo mensaje, ni en mensajes siguientes. NUNCA sacrifiques la gramática por acortar: escribe frases completas y bien formadas, con sus artículos; si no te alcanza el largo, di UNA cosa menos en vez de escribir un telegrama ("10-min reunión te guía"). Escribe en español natural de Perú, sin calcos del inglés ("no problema", "déjame saber").'
      : 'LARGO MÁXIMO: 45 palabras, con la misma estructura: primero respondes o reconoces en pocas palabras lo que dijo —sin repetirle el dato que acaba de darte, ver NO LE REPITAS SUS PROPIOS DATOS—, después UNA sola pregunta. Nada de relleno corporativo ni cierres de correo.';

    // El bloque del PRIMER mensaje solo viaja en el primer turno. Antes iba
    // siempre, con sus ejemplos literales ("Hola, Jair. ¿Ya tienes un tema en
    // mente para tu tesis?"), y en un turno posterior el modelo los copiaba
    // tal cual: el contacto recibía dos saludos de apertura seguidos.
    const openingBlock = isFirstTurn
      ? `NO TE PRESENTES: nunca abras diciendo quién eres ni nombrando a la empresa ("soy X de Y"). Entra directo a ayudar. Solo di con quién hablan si te lo preguntan explícitamente. Pero este PRIMER mensaje de la conversación SÍ abre con un saludo antes de lo demás: no presentarte no significa abrir en seco.

CÓMO ES EXACTAMENTE ESTE PRIMER MENSAJE (es el que decide si te responden, y se escribe distinto a todos los demás):
a) Saludo cálido con signo de exclamación, nunca un punto seco: "¡Hola, <su nombre>!" Un punto después del saludo lee como un trámite, no como alguien saludando de verdad. SOLO usa su nombre si se te dio uno abajo ("Su nombre ... es"); si no se te pasó ningún nombre, saluda con "¡Hola!" a secas — NUNCA saludes con un usuario, apodo, correo o texto raro como si fuera su nombre. Puedes poner UN emoji junto al saludo cuando aporte calidez (👋 🙌 😊), nunca más de uno.
b) Inmediatamente después, LA PREGUNTA por su carrera y su universidad (juntas, en una sola pregunta). La pregunta va ANTES de cualquier explicación de lo que hacen: es lo que abre conversación. Nunca metas una frase de catálogo entre el saludo y la pregunta ("te acompañamos con un asesor durante toda tu tesis", "un asesor te guía paso a paso"): se lee como plantilla y es el error a evitar. Esto NO cambia si su primer mensaje fue un pedido genérico de "información" ("info", "quisiera información", "sobre tesis"): sin saber su caso todavía no hay nada concreto que explicarle, así que la pregunta por su carrera y universidad ES la respuesta — pasa directo a saludar y preguntar, sin citar ningún dato del servicio. Reserva los DATOS REALES DEL SERVICIO para cuando pregunte algo puntual (precio, duración, modalidad) en este mismo mensaje o en uno posterior.
c) El mensaje TERMINA en esa pregunta. No prometas nada para después —ni "con eso te explico cómo trabajamos", ni "ahora te cuento", ni "te explico en un momento"—: una promesa en el primer mensaje crea una deuda que el turno siguiente no paga, y el contacto la nota. Tampoco prometas en futuro sobre la persona ("te acompañaremos", "te guiaremos", "lograrás sustentar"): todavía no hay nada acordado y suena hueco. Si te preguntan algo concreto más adelante, ahí sí respondes con los datos reales del servicio.
d) Ejemplos del registro exacto, y son el mensaje COMPLETO. Pidiendo información en general (sin pregunta puntual): "¡Hola, Jair! 👋 ¿De qué carrera eres y en qué universidad estudias?" Solo saludo: "¡Hola, Jair! 🙌 Cuéntame, ¿de qué carrera eres y en qué universidad estudias?" Si el emoji va, va pegado al saludo, nunca al final de la pregunta.
e) Ese saludo NO es un acuse de recibo: "Claro que sí", "Por supuesto" y "Con gusto" SOLO valen si la persona te pidió o preguntó algo — nunca le respondas que sí a algo que no te pidió.`
      : `NO TE PRESENTES: nunca digas quién eres ni nombres a la empresa ("soy X de Y"). Solo di con quién hablan si te lo preguntan explícitamente.

YA SALUDASTE: esta conversación ya está abierta (mira el historial). PROHIBIDO volver a saludar. Tu mensaje NO puede empezar con "Hola", "Buenas", "Buenos días/tardes/noches", "Qué tal" ni con el nombre de la persona a modo de saludo.

NUNCA REPITAS UNA PREGUNTA QUE YA HICISTE: si esa pregunta ya está en el historial ("¿de qué carrera eres y en qué universidad estudias?", "¿ya tienes un tema?"), NO puede volver a aparecer en este mensaje — ni al principio, ni al final, ni reformulada con otras palabras. Da igual dónde la pongas: la persona la lee y sabe perfectamente que ya se la hiciste. Que no te la haya respondido NO te autoriza a repetirla; si la esquivó o cambió de tema es porque antes necesita otra cosa de ti, y tu trabajo en este turno es darle ESA otra cosa. Si esa pregunta te la hicieron una vez y ya la repetiste otra, no existe un tercer intento: responde lo suyo y CIERRA SIN PREGUNTA en vez de insistir.

Continúa desde donde quedó: responde lo último que escribió y sigue con lo que falta.`;

    const rulesBlock = [shortRepliesRule, ...teamRules]
      .concat(contactName ? [`Su nombre (según su perfil de WhatsApp) es "${contactName}". Úsalo como MUCHO una vez cada tres o cuatro mensajes: repetirlo en cada uno suena a plantilla y alarga el mensaje. Si ya lo usaste en tu mensaje anterior, este va sin nombre.`] : [])
        .map((r, i) => `${i + 1}. ${r}`)
      .join('\n');

    const systemPrompt = `${identity}

TU OBJETIVO: ${objective}

LO QUE NECESITAS SABER, EN ESTE ORDEN (esto es estructural, no cambia):
1. La CARRERA de su tesis y la UNIVERSIDAD donde estudia — OBLIGATORIAS LAS DOS, y se piden JUNTAS, en un mismo mensaje: "¿De qué carrera eres y en qué universidad estudias?". Van PRIMERO porque son datos que la persona tiene en la punta de la lengua y contesta sin pensar: abrir con algo que obliga a pensar (su tema, en qué parte de la tesis está) hace que muchos dejen el chat en visto. Para efectos del límite de una pregunta por mensaje, esas dos cuentan como UNA. Si te contesta solo uno de los dos, pides el que falta en el turno siguiente, a secas.
2. Su TEMA de tesis — OBLIGATORIO, y se pregunta de forma FÁCIL de contestar, dándole la salida de que no tenga uno: "¿Ya tienes un tema o una idea para tu tesis, o empiezas desde cero?". Basta con una idea GENERAL. Si te dice que NO tiene tema, que empieza de cero o que no sabe, ESO YA ES LA RESPUESTA: guárdala en "extracted.problem" como "Sin tema definido (desde cero)". Nunca vuelvas a preguntar por el tema después de eso.

Recién cuando tengas (1) y (2) completo —carrera, universidad Y tema— marca "ready": true (ver CUÁNDO TERMINAR).

ESCUCHA SIEMPRE, DE PRINCIPIO A FIN: en CADA mensaje, antes de decidir qué responder, revisa si la persona mencionó —aunque no se lo hayas preguntado y aunque venga mezclado en una sola frase— su TEMA, su CARRERA, su UNIVERSIDAD, su nivel académico o CUÁNDO quiere la reunión, y guárdalo todo en "extracted"/"preferredWhen" en ese mismo turno. Ejemplo: "sobre arquitectura de la continental, tesis con avance" trae carrera (Arquitectura), universidad (Universidad Continental) y tema (tesis ya iniciada, con avance). En Perú las universidades se nombran abreviadas o en minúscula: continental = Universidad Continental, upla = Universidad Peruana Los Andes, uncp = Universidad Nacional del Centro del Perú, unac = Universidad Nacional del Callao (¡NO es la uncp!), unmsm = San Marcos, ucv = César Vallejo, y también upc, pucp, uni, utp, usmp, ulima, undac, unsa. NO confundas siglas parecidas; si no estás seguro de qué universidad es una sigla, extráela TAL CUAL la escribió la persona sin "corregirla". JAMÁS preguntes por un dato que ya te dieron, ni en este mensaje ni en uno anterior.

MENSAJES PARTIDOS EN VARIAS BURBUJAS: la gente en WhatsApp escribe a pedazos y le da enviar en cada pausa; el sistema te entrega esas burbujas juntas, separadas por saltos de línea. Léelas SIEMPRE como UNA SOLA intención, nunca como mensajes independientes, y reconstruye lo que quiso decir ANTES de responder o de extraer nada:
- Un día y una hora en renglones distintos son un solo horario: "mañana" + "a las 3" = mañana a las 3.
- Una hora y su meridiano son una sola hora: "las 9" + "pm" = 9 de la NOCHE, jamás las 9 de la mañana.
- Datos académicos sueltos se suman: "Derecho" + "San Marcos" + "desde cero" son carrera, universidad y estado de la tesis, los tres.
- Si dos renglones se contradicen, vale el ÚLTIMO: "las 9" + "mejor 10" = las 10. Si NO se contradicen, se complementan: usa todos.
Nunca respondas al primer renglón ignorando los siguientes: es el error que más se nota, porque la persona sabe perfectamente lo que escribió.

TRATO: siempre de TÚ, nunca de usted, en todos los mensajes.

${openingBlock}

NOMBRES: la videollamada se llama siempre "Google Meet", nunca "Meet" a secas.

AGENDAR GANA SOBRE TODO: si el contacto pide una reunión/llamada, pregunta por horarios, o propone un día u hora concretos ("¿puedo el jueves?", "a las 5 hoy"), eso es lo prioritario. Marca "schedulingIntent": true y guarda en "preferredWhen" lo que dijo del cuándo, TAL CUAL. En ese caso el sistema pasa a agendar de inmediato: no sigas pidiendo tema, carrera ni universidad, y tu "reply" tiene que ser un acuse corto y SIN preguntas.

NO SEAS CERRADO: que te falte un dato NUNCA es excusa para ignorar lo que la persona escribió. Si te hace una pregunta PUNTUAL, RESPÓNDELA primero con los DATOS REALES DEL SERVICIO y recién después, en el mismo mensaje, haz tu pregunta pendiente. Alguien que pide información puntual y solo recibe preguntas se va. Cuentan como pregunta puntual TANTO las del servicio ("¿cuánto cuesta?", "¿cuánto dura?", "¿es presencial?") COMO las que buscan saber quiénes son ustedes: dónde quedan, de qué ciudad son, si tienen oficina, si son una empresa formal, si tienen RUC, si hay contrato de por medio. Esas ÚLTIMAS no son logística: la persona está comprobando que existen de verdad, y es la pregunta más importante que te puede hacer. EXCEPCIÓN — primer mensaje de la conversación: si lo único que escribió es un pedido GENÉRICO de información ("info", "quisiera información", "sobre tesis", sin especificar qué quiere saber), esta regla no aplica: sigue el formato del PRIMER MENSAJE de arriba (saludo + pregunta por su carrera y universidad, sin citar datos del servicio) en vez de recitar la base de conocimiento.

REGLA DURA SOBRE LA BASE DE CONOCIMIENTO: si la respuesta a lo que te preguntaron está en los DATOS REALES DEL SERVICIO, la DAS, con el dato concreto y textual (la ciudad, la dirección, la razón social, el RUC). Está PROHIBIDO esquivarla, contestar de costado o derivarla al asesor teniendo el dato a la vista: eso solo vale para lo que NO está en esa lista. Ejemplo real de lo que NO se debe hacer: a "¿están en Huancayo o en otra ciudad?" responder "trabajamos por videollamada, así que da igual dónde estés" — eso ni responde dónde están USTEDES (que es lo que preguntaron) ni usa el dato que tenías, y quien pregunta lo lee como que le están ocultando algo. Se responde con la ciudad y la dirección reales, y si viene al caso se agrega que además se trabaja por Google Meet.

Datos OPCIONALES Y PASIVOS (correo, teléfono, nivel académico, si es estudiante o egresado, ciclo, situación de su tesis, ámbito/región): si la persona los menciona por su cuenta, guárdalos en "extracted". Pero JAMÁS los preguntes — hay valores por defecto y el asesor los ve en la reunión, y el teléfono para la llamada se pide aparte, solo si de verdad hace falta.

CÓMO SUENAS (esto es lo que decide si te siguen respondiendo o te dejan en visto):
- EMPATÍA CONCRETA, NUNCA GENÉRICA: si la persona cuenta algo que le pesa —lleva años atascada, su asesor no le responde, le observaron la tesis, tiene una fecha encima, le da miedo que la estafen— reconoce ESO en una frase corta antes de seguir con lo tuyo. "Uf, dos años sin avanzar cansa" sirve; "te entiendo, la tesis es difícil" no sirve, porque no dice nada de SU caso y se nota que es de molde. Nunca le atribuyas un sentimiento que no expresó.
- NO SUENES A PLANTILLA: no abras dos mensajes seguidos con la misma palabra (si ya usaste "Perfecto", el siguiente arranca de otra forma o sin muletilla) y no repitas en toda la conversación la misma frase hecha para explicar la reunión. Si ya dijiste algo de una manera, dilo de otra o no lo repitas. Que se note el patrón es exactamente lo que hace que dejen de contestar.
- NO LE REPITAS SUS PROPIOS DATOS: cuando la persona te contesta lo que le preguntaste (su carrera, su universidad, su tema, su horario, su correo), ese dato lo guardas en "extracted" y SIGUES. No se lo devuelves escrito. Repetírselo no confirma nada que él no sepa —acaba de escribirlo— y suena exactamente a formulario leyendo el campo de vuelta, que es lo que delata a un bot. MAL: "Genial, matemática e informática en la Cantuta. ¿Ya tienes un tema para tu tesis o empiezas desde cero?" BIEN: "Genial 🙌 ¿Ya tienes un tema para tu tesis o empiezas desde cero?" MAL: "Perfecto, Derecho en San Marcos, entonces..." BIEN: "Perfecto 🙌 ...". Un acuse corto ("Genial", "Perfecto", "Listo") sí va; el dato, no. Esto NO te impide USAR el dato más adelante cuando aporte algo nuevo (por ejemplo al hablar de su carrera en concreto) — lo que está prohibido es devolvérselo como acuse de recibo en el turno en que te lo dio. ÚNICA EXCEPCIÓN: la fecha y la hora de una reunión que se está cerrando sí se repiten, porque ahí confirmar es el punto.
- ADÁPTATE A CÓMO ESCRIBE: si escribe corto e informal, responde corto e informal; si escribe cuidado y formal, sube un poco el registro. Igualar su forma de escribir hace más por la confianza que cualquier frase amable.

REGLAS DEL EQUIPO (respétalas siempre; nunca contradicen lo estructural de arriba):
${rulesBlock}
${knowledgeBlock ? `
DATOS REALES DEL SERVICIO (lo ÚNICO que puedes afirmar; si la persona pregunta algo que NO está en esta lista, dile con naturalidad que el asesor se lo detalla en la reunión — NUNCA inventes precios, plazos, cifras ni promesas):
${knowledgeBlock}

Si el contacto hace una pregunta, RESPÓNDELA primero con estos datos y recién después sigue con lo que te falta preguntar. Nunca ignores su pregunta ni la dejes para más adelante.
` : ''}
${toneInstructions ? `\nINSTRUCCIONES ADICIONALES DEL EQUIPO:\n${toneInstructions}\n` : ''}

SI DUDAN DE USTEDES (lo más delicado de toda la conversación): mucha gente en Perú ya fue estafada con servicios de tesis, así que la desconfianza es razonable y no es un rechazo — es una última oportunidad de convencerla. Reconoce la duda en pocas palabras, sin ponerte a la defensiva y sin pedirle que confíe ("confía en nosotros", "somos serios" no prueban nada). Detecta la señal aunque venga suelta y sin pregunta: "no hay confianza", "¿será estafa?", "¿son reales?", "no me da confianza", "¿cómo sé que no me estafan?", "¿quiénes son?".
- Lo ÚNICO que mueve la aguja son DATOS COMPROBABLES, y los tienes en los DATOS REALES DEL SERVICIO: la razón social con su RUC (lo puede verificar él mismo en SUNAT), la dirección de la oficina con su ciudad, y que se trabaja con contrato de prestación de servicios. Da DOS de esos datos, concretos y textuales, en el mismo mensaje en que reconoces la duda.
- NUNCA respondas a una duda de confianza solo con el argumento de la reunión ("es sin compromiso", "así ves cómo trabajamos"). Eso no es una prueba, es otra vez pedirle el sí. La reunión se menciona DESPUÉS de los datos, no en lugar de ellos.
- En ese turno NO le hagas ninguna pregunta pendiente (ni carrera, ni universidad, ni tema). Alguien que acaba de decir que no confía y recibe otra pregunta se va. Das los datos, y cierras ahí o le ofreces verificarlos.
- Este es el ÚNICO caso donde puedes pasarte del largo máximo, y solo lo justo para que los dos datos entren completos: es preferible un mensaje un poco más largo que uno corto que no prueba nada.
- Nunca inventes pruebas que no estén en los DATOS REALES DEL SERVICIO: nada de años de experiencia, cantidad de tesis, reseñas, nombres de clientes ni universidades conveniadas.

CUÁNDO TERMINAR: marca "ready": true en cuanto tengas el tema de tesis (o sepas que empieza desde cero) Y la carrera o la universidad. NO antes: si te falta un dato, tu turno es para preguntarlo, con "ready": false. Cuando por fin marques "ready": true, tu "reply" tiene que ser MUY corto y SIN preguntas: si el contacto aprovechó ese último mensaje para preguntarte algo, respóndele ahí en una línea con los datos reales del servicio; si no preguntó nada, un simple acuse (ej. "Perfecto 👀" o "Genial, dame un momento 🙌"). El sistema toma el hilo enseguida: propone la reunión con el asesor y le pregunta la modalidad (telefónica o Meet). Este "reply" tuyo puede incluso no mostrarse, así que no pongas nada importante en él.

DATOS YA CONFIRMADOS (usa esto para no repetir preguntas ya respondidas):
${JSON.stringify(knownAnswers || {})}

LO QUE FALTABA ANTES DE LEER SU ÚLTIMO MENSAJE: ${describeMissingPriority(knownAnswers)}
OJO: eso era el estado ANTES de leer lo que acaba de escribir. Si en ese mensaje ya te dio ese dato, extráelo y pregunta por el SIGUIENTE que falte. Repetir una pregunta que la persona ya respondió es el peor error que puedes cometer.

Responde ÚNICAMENTE en JSON válido con esta forma exacta (usa null en los campos de "extracted" que no puedas identificar todavía):
{
  "reply": "<mensaje de WhatsApp en texto plano, sin comillas ni markdown>",
  "extracted": {
    "problem": "<tema o problema de tesis identificado. Si dijo que no tiene tema o que empieza desde cero, escribe exactamente 'Sin tema definido (desde cero)' — ese texto es interno, va SOLO en este campo y JAMÁS en tu "reply". Usa null SOLO si todavía no ha dicho nada sobre su tema>",
    "location": "<ámbito/región identificado, o null>",
    "level": "<uno de: 'Pregrado (Bachiller/Título)', 'Posgrado (Maestría)', 'Posgrado (Doctorado)', o null>",
    "academicStatus": "<lo que es HOY, uno de: 'Estudiante', 'Egresado', 'Bachiller', 'Titulado', 'Magíster', o null>",
    "cycle": <número de ciclo que cursa si es estudiante de pregrado ("sexto ciclo" = 6, "VIII" = 8), o null>,
    "thesisSituation": "<situación de su tesis, uno EXACTO de: ${THESIS_SITUATIONS.map((o) => `'${o}'`).join(', ')}, o null>",
    "field": "<carrera/campo de estudio identificado, o null>",
    "university": "<universidad/institución donde estudia, o null>",
    "email": "<correo electrónico identificado, o null>",
    "phone": "<número de teléfono identificado (con código de país si lo dio), o null>"
  },
  "ready": <true o false>,
  "schedulingIntent": <true si pidió agendar, preguntó por horarios o propuso un día u hora; si no, false>,
  "preferredWhen": "<lo que dijo sobre cuándo quiere la reunión, tal cual lo escribió (ej. 'a las 5 hoy', 'el lunes en la mañana'), o null>"
}`;

    const transcript = (history || [])
      .map((m) => `${m.direction === 'outbound' ? 'Avan' : 'Contacto'}: ${m.text}`)
      .join('\n');

    const userPrompt = `Historial de la conversación hasta ahora:\n${transcript || '(sin mensajes previos)'}\n\nNuevo mensaje del contacto: "${incomingText}"\n\nResponde siguiendo las reglas, en el JSON indicado.`;

    try {
      console.log(`🤖 [${this.provider} LLM] Turno conversacional de Avan (${this.provider === 'anthropic' ? this.anthropicModel : this.chatModel})...`);

      const parsed = await this._generateJSON(`${systemPrompt}\n\n${userPrompt}`, { timeoutMs: 20000 });
      if (!parsed.reply) return this.fallbackConversationTurn(knownAnswers, incomingText, isFirstTurn);

      console.log(`✅ [${this.provider} LLM] Turno de Avan generado`);
      return {
        reply: isFirstTurn ? ensureGreeting(parsed.reply, contactName) : parsed.reply,
        extracted: parsed.extracted || {},
        ready: !!parsed.ready,
        schedulingIntent: !!parsed.schedulingIntent,
        preferredWhen: typeof parsed.preferredWhen === 'string' && parsed.preferredWhen.trim() ? parsed.preferredWhen.trim() : null,
        source: 'llm'
      };
    } catch (err) {
      console.warn(`${this.provider} LLM conversation turn notice:`, err.message);
      return this.fallbackConversationTurn(knownAnswers, incomingText, isFirstTurn);
    }
  }

  /**
   * Respaldo mínimo basado en reglas para cuando Ollama Cloud no está
   * disponible: no reemplaza la calidad de la conversación con IA, pero
   * evita dejar al contacto sin respuesta. En cuanto tiene el tema, marca
   * "ready" (el correo es opcional, se captura solo si aparece en el texto).
   */
  fallbackConversationTurn(knownAnswers, incomingText, isFirstTurn) {
    const answers = knownAnswers || {};
    const trimmedIn = (incomingText || '').trim();
    const isNoise = trimmedIn.length < 3 || /^(hola|hi|buenas|si|sí|ok|okay|no|informes?|gracias)/i.test(trimmedIn);
    const turn = (reply, extracted = {}, ready = false) => ({ reply, extracted, ready, source: 'fallback' });

    // Mismo orden que el prompt con IA: primero carrera y universidad (se
    // contestan sin pensar), después el tema, preguntado de forma fácil.
    const ASK_BOTH = '¿De qué carrera eres y en qué universidad estudias?';
    const ASK_TOPIC = '¿Ya tienes un tema o una idea para tu tesis, o empiezas desde cero?';

    if (isFirstTurn) return turn(`¡Hola! 👋 ${ASK_BOTH}`);

    // Falta la carrera y/o la universidad. Sin LLM no hay extracción real,
    // pero como se preguntan juntas la mayoría contesta las dos en una línea
    // ("Sistemas, UNCP"), y se parten por la palabra que delata a la universidad.
    if (!answers.field || !answers.university) {
      if (isNoise) {
        const ask = !answers.field && !answers.university ? ASK_BOTH
          : (!answers.field ? '¿Y de qué carrera es tu tesis?' : '¿Y en qué universidad estudias?');
        return turn(`Genial 🙌 ${ask}`);
      }

      const split = splitFieldAndUniversity(trimmedIn);
      const field = answers.field || split.field || (answers.university ? trimmedIn : null);
      const university = answers.university || split.university || (answers.field ? trimmedIn : null);
      const extracted = {};
      if (!answers.field && field) extracted.field = field;
      if (!answers.university && university) extracted.university = university;

      if (!field) return turn('Genial 🙌 ¿Y de qué carrera es tu tesis?', extracted);
      if (!university) return turn('¡Perfecto! ¿Y en qué universidad estudias?', extracted);
      if (!answers.problem) return turn(`¡Perfecto! ${ASK_TOPIC}`, extracted);
      return turn('Perfecto, dame un momento 👀', extracted, true);
    }

    if (!answers.problem) {
      if (isNoise && !/^no/i.test(trimmedIn)) return turn(`Cuéntame, ${ASK_TOPIC.charAt(0).toLowerCase()}${ASK_TOPIC.slice(1)}`);
      const fromScratch = /cero|no tengo|ninguno|a[uú]n no|todav[ií]a no|no s[eé]|^no/i.test(trimmedIn);
      return turn('Perfecto, dame un momento 👀', { problem: fromScratch ? 'Sin tema definido (desde cero)' : trimmedIn }, true);
    }

    const looksLikeEmail = trimmedIn.includes('@');
    return {
      reply: 'Perfecto, dame un momento 👀',
      extracted: looksLikeEmail ? { email: trimmedIn } : {},
      ready: true,
      source: 'fallback'
    };
  }

  /**
   * Normaliza el nombre de una universidad peruana escrito de cualquier forma
   * (sigla, nombre parcial, en minúsculas): "unac" → "Universidad Nacional del
   * Callao", "san marcos" → "Universidad Nacional Mayor de San Marcos".
   *
   * La extracción del turno conversacional a veces confunde siglas parecidas
   * (UNAC ≠ UNCP), así que este es un paso aparte con una sola tarea. Devuelve
   * `{ name, confident }`:
   *   - confident:true  → `name` es el nombre oficial completo.
   *   - confident:false → la sigla es ambigua o no se reconoce; `name` es el
   *     texto TAL CUAL lo escribió el contacto. Es mejor repetir lo que dijo
   *     que "corregirlo" a una universidad equivocada.
   */
  async resolveUniversity(raw) {
    const text = String(raw || '').trim();
    if (!text) return { name: null, confident: false, source: 'empty' };

    if (!this.hasLLM()) {
      return { name: text, confident: false, source: 'fallback' };
    }

    const prompt = `Contexto: universidades e institutos de educación superior de PERÚ.
Alguien escribió el nombre de su universidad así: """${text}"""

Devuelve el NOMBRE OFICIAL COMPLETO de esa universidad peruana. Ejemplos: "unac" → "Universidad Nacional del Callao"; "uncp" → "Universidad Nacional del Centro del Perú"; "san marcos" o "unmsm" → "Universidad Nacional Mayor de San Marcos"; "la continental" → "Universidad Continental"; "cesar vallejo" o "ucv" → "Universidad César Vallejo".

Reglas:
- Si reconoces la universidad SIN ambigüedad, "confident": true y "name" = su nombre oficial completo, bien escrito.
- Si la sigla o el nombre corto podría ser MÁS DE UNA universidad peruana (ej. "UNA", "UPT", "UPSJB", "UNS"), o NO reconoces la institución, "confident": false y "name" = el texto tal cual, sin cambiarlo.
- Nunca inventes una universidad que no exista en Perú. Nunca cambies una sigla por otra parecida.

Responde ÚNICAMENTE en JSON válido: {"name": "<nombre o el texto tal cual>", "confident": <true o false>}`;

    try {
      const parsed = await this._generateJSON(prompt, { timeoutMs: 12000, ollamaFormat: UNIVERSITY_SCHEMA });
      const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : text;
      return { name, confident: !!parsed.confident, source: 'llm' };
    } catch (err) {
      console.warn(`${this.provider} LLM university resolve notice:`, err.message);
      return { name: text, confident: false, source: 'fallback' };
    }
  }

  /**
   * Interpreta en lenguaje natural qué día pide el lead para su llamada
   * ("mañana", "el jueves", "el 28", una fecha explícita, etc.) y lo
   * convierte a "YYYY-MM-DD" (calendario de Lima). Devuelve date: null si no
   * logra identificar un día claro dentro de un rango razonable.
   */
  async parseSchedulingDate(text, todayIso, maxDaysAhead = 2) {
    if (!this.hasLLM()) {
      return this.fallbackParseSchedulingDate(text, todayIso);
    }

    const prompt = `Hoy es ${WEEKDAY_NAMES[weekdayOfIso(todayIso)]} ${todayIso} (formato YYYY-MM-DD, zona horaria de Lima, Perú).
Calendario de los próximos días: ${upcomingCalendar(todayIso, 7)}.

Alguien acaba de responder esto cuando le preguntaron qué día prefiere para una llamada:
"""${text}"""

Si ese texto trae varios renglones, son burbujas seguidas de WhatsApp: una sola intención partida en pedazos, no respuestas distintas. Únelas antes de interpretar ("mañana" + "a las 3" = mañana a las 3; "las 9" + "pm" = 21:00), y si dos se contradicen vale la última.

Interpreta a qué fecha se refiere (puede decir "hoy", "mañana", "pasado mañana", "el jueves", "el 28", una fecha explícita, etc.) y conviértela a formato YYYY-MM-DD. La fecha debe estar entre hoy (${todayIso}) y ${maxDaysAhead} días después como máximo. Si pide un día más lejano, igual devuélvelo tal cual (el sistema le explicará el límite). Si el texto NO expresa ningún día concreto (ej. "cuando puedas", "no sé", o simplemente no habla de fechas), responde null.

Además, si junto con el día también dijo una HORA o un momento del día (ej. "hoy a las 6 pm", "mañana temprano", "el jueves por la tarde"), extráela en formato 24h "HH:MM" en "preferredTime" (usa una hora representativa: "temprano"/"en la mañana" ~ "09:00", "en la tarde" ~ "15:00", "de noche"/"tarde" ~ "20:00"). Si no dijo ninguna hora, deja preferredTime en null. Las reuniones son en horario comercial: una hora sin "am"/"pm" entre la 1 y las 7 SIEMPRE es de la tarde ("a las 5" = "17:00"), salvo que diga explícitamente que es de la mañana.

OJO — POSPONER NO ES ELEGIR UN DÍA: si el mensaje en realidad es una forma de aplazar o declinar el agendamiento (ej. "mañana le escribo", "ya te aviso", "después vemos", "no puedo ahora", "lo dejamos para más adelante"), marca "declined": true y deja "date" en null AUNQUE el texto mencione una palabra de fecha como "mañana" — esa palabra ahí no es una elección de horario, es parte de la despedida. Distíngelo así: si la persona NOMBRA un día para QUE LE OFREZCAS horarios ("el jueves", "mañana en la tarde"), no es un aplazamiento; si dice que ELLA te va a escribir/avisar después, sí lo es.

Responde ÚNICAMENTE en JSON válido: {"date": "YYYY-MM-DD" o null, "preferredTime": "<HH:MM o null>", "declined": true o false}`;

    try {
      const parsed = await this._generateJSON(prompt, { timeoutMs: 15000, ollamaFormat: SCHEDULING_DATE_SCHEMA });
      const declined = !!parsed.declined;
      // Igual que con la hora: el prompt le pide completar SIEMPRE una fecha,
      // y ante un mensaje que no nombra ningún día ("para las 11?") el modelo
      // completaba con "hoy" en vez de responder null. Se descarta esa fecha
      // si el texto original no menciona un día de verdad.
      const rawDate = !declined && typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
      // Un día nombrado por su nombre se resuelve en código: el modelo se
      // equivoca calculando el día de la semana (ver resolveWeekdayDate).
      const weekdayDate = declined ? null : resolveWeekdayDate(text, todayIso);
      const date = weekdayDate || (rawDate && hasExplicitDayMention(text) ? rawDate : null);
      const preferredTime = typeof parsed.preferredTime === 'string' && /^\d{2}:\d{2}$/.test(parsed.preferredTime) ? parsed.preferredTime : null;
      const normalizedTime = normalizeBusinessHour(preferredTime, text);
      // La precisión se decide sobre el texto original, no sobre lo que
      // devolvió el modelo: el prompt le pide convertir "temprano" en "09:00",
      // así que su salida sola no distingue una hora dicha de una inferida.
      return {
        date,
        preferredTime: normalizedTime,
        timePrecision: normalizedTime ? (hasExplicitClockMention(text) ? 'exact' : 'vague') : null,
        declined,
        source: 'llm'
      };
    } catch (err) {
      console.warn(`${this.provider} LLM date parsing notice:`, err.message);
      return this.fallbackParseSchedulingDate(text, todayIso);
    }
  }

  /**
   * Respaldo mínimo sin IA: reconoce "hoy" y "mañana" respecto a `todayIso`.
   * Cualquier otra expresión (nombres de día, fechas explícitas, etc.)
   * devuelve null — sin IA no vale la pena adivinar más que lo obvio.
   */
  fallbackParseSchedulingDate(text, todayIso) {
    const normalized = (text || '').toLowerCase();
    const [y, m, d] = todayIso.split('-').map(Number);
    const todayUTC = Date.UTC(y, m - 1, d);

    // Sin IA solo se reconocen las formas más comunes de aplazar/declinar:
    // la persona avisa que ELLA va a escribir/avisar después, en vez de
    // nombrar un día para que se le ofrezcan horarios. "mañana" aquí es parte
    // de la despedida, no una elección de fecha.
    if (/\b(te|le)\s+escribo\b|\bya\s+te\s+(escribo|aviso|digo)\b|\bdespu[eé]s\s+(te\s+)?(escribo|aviso|vemos)\b|\bm[aá]s\s+adelante\b|\bno\s+puedo\s+ahora\b/i.test(normalized)) {
      return { date: null, preferredTime: null, timePrecision: null, declined: true, source: 'fallback' };
    }

    // Sin IA solo se reconoce una hora escrita de forma inequívoca: con
    // minutos ("18:30"), con meridiano ("6pm") o precedida de "a las". Un
    // número suelto NO cuenta, para no confundir "el 6 de septiembre" con
    // las 6 de la mañana. El orden importa: en "a las 10:30" el "a las"
    // aparece antes, así que primero se busca el formato con minutos.
    let hour = null;
    let minutes = 0;
    let meridiem = '';

    let timeMatch = normalized.match(/(\d{1,2}):(\d{2})\s*(a\.?\s?m|p\.?\s?m)?/);
    if (timeMatch) {
      hour = Number(timeMatch[1]);
      minutes = Number(timeMatch[2]);
      meridiem = timeMatch[3] || '';
    } else if ((timeMatch = normalized.match(/(\d{1,2})\s*(a\.?\s?m|p\.?\s?m)/))) {
      hour = Number(timeMatch[1]);
      meridiem = timeMatch[2];
    } else if ((timeMatch = normalized.match(/a\s+las\s+(\d{1,2})\b/))) {
      hour = Number(timeMatch[1]);
    }

    let preferredTime = null;
    if (hour !== null) {
      meridiem = meridiem.replace(/[.\s]/g, '');
      if (meridiem.startsWith('p') && hour < 12) hour += 12;
      if (meridiem.startsWith('a') && hour === 12) hour = 0;
      // "a las 6" sin meridiano, en un contexto comercial, es la tarde: las
      // 6 a.m. no son un horario de atención plausible.
      if (!meridiem && hour >= 1 && hour <= 7) hour += 12;
      if (hour >= 0 && hour <= 23 && minutes >= 0 && minutes <= 59) {
        preferredTime = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }
    }

    // Sin hora exacta, un MOMENTO del día también cuenta (igual que en el
    // prompt del LLM de arriba) — sobre todo importa acá porque esta rama
    // solo corre cuando la llamada al LLM falló o no hay API key: sin esto,
    // "¿no habría otro día en las tardes?" no reconocía "tardes" como nada y
    // el bot repetía la lista de horarios de la mañana con un "no te entendí"
    // que sí había entendido, solo no lo estaba buscando. "mañana" como
    // momento del día (a secas, sin "en la"/"por la") se deja sin resolver a
    // propósito: ya es ambigua con "mañana" como DÍA (ver hasExplicitDayMention)
    // y aquí, sin LLM, no hay forma de distinguirlas.
    if (preferredTime === null) {
      if (/\ben\s+las?\s+tardes?\b|\bpor\s+las?\s+tardes?\b/.test(normalized)) {
        preferredTime = '15:00';
      } else if (/\ben\s+la\s+noche\b|\bpor\s+la\s+noche\b|\bde\s+noche\b/.test(normalized)) {
        preferredTime = '20:00';
      } else if (/\btemprano\b|\ben\s+la\s+ma[ñn]ana\b|\bpor\s+la\s+ma[ñn]ana\b/.test(normalized)) {
        preferredTime = '09:00';
      }
    }

    // Sin IA solo se llega hasta aquí con horas escritas de forma inequívoca
    // o un momento del día reconocido arriba, pero se calcula igual para que
    // el contrato de la función sea el mismo que el del camino con LLM.
    const timePrecision = preferredTime ? (hasExplicitClockMention(text) ? 'exact' : 'vague') : null;

    // Antes que "hoy"/"mañana": en "el sábado en la mañana" el día es el sábado.
    const weekdayDate = resolveWeekdayDate(text, todayIso);
    if (weekdayDate) {
      return { date: weekdayDate, preferredTime, timePrecision, declined: false, source: 'fallback' };
    }
    if (/\bhoy\b/.test(normalized)) {
      return { date: todayIso, preferredTime, timePrecision, declined: false, source: 'fallback' };
    }
    if (/\bmanana\b|\bmañana\b/.test(normalized)) {
      const tomorrow = new Date(todayUTC + 86400000);
      return { date: tomorrow.toISOString().slice(0, 10), preferredTime, timePrecision, declined: false, source: 'fallback' };
    }
    return { date: null, preferredTime, timePrecision, declined: false, source: 'fallback' };
  }

  /**
   * Interpreta en lenguaje natural a cuál horario de una lista numerada se
   * refiere el lead (ej. "si para las 5:30", "la segunda", "el de las 4")
   * en vez de exigir que responda solo con el número. Devuelve el índice
   * (0-based) elegido, o null si la respuesta no elige ninguna opción (por
   * ejemplo, si pregunta algo distinto).
   */
  async parseSchedulingChoice(text, optionLabels) {
    if (!this.hasLLM()) {
      return this.fallbackParseSchedulingChoice(text, optionLabels);
    }

    const numbered = optionLabels.map((label, i) => `${i + 1}. ${label}`).join('\n');
    const prompt = `Le mostraste a alguien esta lista numerada de horarios para una llamada:
${numbered}

Y respondió esto: """${text}"""

Si ese texto trae varios renglones, son burbujas seguidas de WhatsApp: pueden ser una sola intención partida en pedazos, o una respuesta a otra cosa seguida de la elección del horario. Quédate con el renglón que SÍ elige un horario, aunque los otros hablen de otra cosa.

¿A cuál horario de la lista se refiere? Puede responder con el número, con la hora, con una frase tipo "sí, el de las 5:30", "la primera opción", etc. Si su respuesta no elige ninguna opción de la lista, responde index:null.

Además, si NO eligió ninguna opción pero sí expresó una preferencia de horario distinta a las ofrecidas (ej. "no tienes más de noche?", "para las 8pm", "algo más tarde", "en la mañana mejor"), extrae esa hora aproximada en formato 24h "HH:MM" en "preferredTime" (usa una hora representativa: "en la mañana" ~ "09:00", "en la tarde" ~ "15:00", "de noche"/"más tarde" ~ "20:00"). Si no expresó ninguna preferencia de horario, deja preferredTime en null.

Responde ÚNICAMENTE en JSON válido: {"index": <número de 1 a ${optionLabels.length}, o null>, "preferredTime": "<HH:MM o null>"}`;

    try {
      const parsed = await this._generateJSON(prompt, { timeoutMs: 15000, ollamaFormat: SCHEDULING_CHOICE_SCHEMA });
      const index = Number.isInteger(parsed.index) && parsed.index >= 1 && parsed.index <= optionLabels.length ? parsed.index - 1 : null;
      const preferredTime = typeof parsed.preferredTime === 'string' && /^\d{2}:\d{2}$/.test(parsed.preferredTime) ? parsed.preferredTime : null;
      return { index, preferredTime: normalizeBusinessHour(preferredTime, text), source: 'llm' };
    } catch (err) {
      console.warn(`${this.provider} LLM scheduling choice notice:`, err.message);
      return this.fallbackParseSchedulingChoice(text, optionLabels);
    }
  }

  /**
   * Respaldo sin IA. Reconoce dos formas:
   *
   *   - el número de la opción ("3"),
   *   - el horario descrito con palabras ("el jueves a las 7", "la de las
   *     6:30"), cotejado contra las etiquetas que se le ofrecieron.
   *
   * Lo segundo hace falta porque describir el horario es la forma natural de
   * contestar: con solo el número, un "el jueves a las 7" caía en "no te
   * entendí" teniendo esa opción en pantalla.
   */
  fallbackParseSchedulingChoice(text, optionLabels) {
    const trimmed = (text || '').trim();
    const asNumber = parseInt(trimmed, 10);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= optionLabels.length && /^\s*\d+\s*$/.test(trimmed)) {
      return { index: asNumber - 1, preferredTime: null, source: 'fallback' };
    }

    const matched = matchLabelByWords(trimmed, optionLabels);
    if (matched !== null) return { index: matched, preferredTime: null, source: 'fallback' };

    const index = Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= optionLabels.length ? asNumber - 1 : null;
    return { index, preferredTime: null, source: 'fallback' };
  }

  /**
   * Respuesta al "¿Confirmo <modalidad>, <horario>?". El regex de
   * afirmaciones (`isAffirmative`) exige que TODO el mensaje sea un sí, así
   * que un sí que venga con un pedido pegado —"Si esta bien.. Me envía enlace
   * por este numero porfavor"— no coincidía y el bloque ya elegido se
   * soltaba: el caso real del 28/09 en que una reunión confirmada a las 6:30
   * p.m. se perdió y el lead tuvo que agendar de nuevo una hora después.
   *
   * Acá el mensaje se lee entero:
   *   - `confirm`: dice que sí, aunque además pida algo ("mándame el link",
   *     "me confirmas por correo"). Ese pedido extra vuelve en `extraRequest`
   *     para poder atenderlo DESPUÉS de reservar, no en vez de reservar.
   *   - `refuse`: no quiere la reunión.
   *   - `change`: quiere otro día u otra hora.
   *   - `unclear`: no se puede afirmar ninguna de las tres. Ante la duda NO se
   *     reserva — es la misma regla que ya tenía este paso.
   *
   * Sin LLM devuelve `unclear`, que es exactamente el comportamiento
   * histórico: quien llama ya probó el regex antes de preguntar acá.
   */
  async parseConfirmationReply(text, slotLabel) {
    if (!this.hasLLM()) return { decision: 'unclear', extraRequest: null, source: 'fallback' };

    const prompt = `A alguien se le propuso este horario para una reunión: "${slotLabel}".
Se le preguntó: "¿Confirmo ${slotLabel}? Responde Sí o dime qué cambiar".

Respondió esto: """${text}"""

Si ese texto trae varios renglones, son burbujas seguidas de WhatsApp: una sola intención partida en pedazos, no respuestas distintas. Únelas antes de interpretar.

Clasifica su respuesta en "decision", con UNO de estos cuatro valores:
- "confirm": acepta el horario propuesto. IMPORTANTE: sigue siendo "confirm" aunque junto al sí pida algo más ("sí, mándame el link", "está bien, me lo confirmas por acá", "ok pero avísame antes"). Un sí con un pedido pegado es un sí.
- "refuse": no quiere la reunión, o quiere dejarla para después sin proponer otro momento.
- "change": quiere reunirse, pero en otro día u otra hora (nombre otro momento o solo diga que ese no le va).
- "unclear": no se puede saber cuál de los tres es. Úsalo solo si de verdad no hay señal: si dudas entre "confirm" y "unclear", responde "unclear" (reservar por error es peor que volver a preguntar), pero un sí evidente con un pedido al lado NO es unclear.

Si además del sí/no pidió algo concreto (el link, una confirmación por otro medio, avisarle antes, etc.), descríbelo en pocas palabras en "extraRequest". Si no pidió nada extra, deja "extraRequest" en null.

Responde ÚNICAMENTE en JSON válido: {"decision": "confirm" | "refuse" | "change" | "unclear", "extraRequest": "<texto corto o null>"}`;

    try {
      const parsed = await this._generateJSON(prompt, { timeoutMs: 15000, ollamaFormat: CONFIRMATION_SCHEMA });
      const decision = ['confirm', 'refuse', 'change', 'unclear'].includes(parsed.decision) ? parsed.decision : 'unclear';
      const extraRequest = typeof parsed.extraRequest === 'string' && parsed.extraRequest.trim()
        ? parsed.extraRequest.trim()
        : null;
      return { decision, extraRequest, source: 'llm' };
    } catch (err) {
      console.warn(`${this.provider} LLM confirmation notice:`, err.message);
      return { decision: 'unclear', extraRequest: null, source: 'fallback' };
    }
  }

  /**
   * ¿El contacto está diciendo que ya no quiere seguir? El regex
   * `saysNotInterested` solo reconoce la despedida cuando ocupa el mensaje
   * entero ("no gracias", "ya no me interesa"), y por eso el 28/09 se le
   * ofrecieron horarios a alguien que había escrito "Buscaré en otro lado
   * gracias igual" y después "Ya le comenté que no": ninguna de las dos
   * coincide, así que el bot siguió con el guion tres mensajes más.
   *
   * Acá lo decide el LLM leyendo la frase completa. `kind` distingue qué hacer
   * después, porque no todos los "no" se cierran igual:
   *   - `not_interested`: ya no quiere el servicio → se cierra y no se le
   *     vuelve a escribir.
   *   - `postpone`: quiere retomarlo después → se cierra amable, sin insistir.
   *   - `wants_human`: no rechaza, quiere hablar con una persona → se transfiere.
   *
   * Sin LLM devuelve `refusing: false` y quien llama se queda con el regex de
   * siempre: este método solo agrega casos, nunca quita los que ya funcionaban.
   */
  async detectRefusal(text, { stepQuestion = null } = {}) {
    if (!this.hasLLM()) return { refusing: false, kind: null, source: 'fallback' };

    const asked = stepQuestion ? `\nLo último que se le preguntó fue: "${stepQuestion}"` : '';
    const prompt = `Un bot de WhatsApp está conversando con alguien interesado en asesoría de tesis, con el objetivo de agendarle una reunión con un asesor.${asked}

La persona respondió esto: """${text}"""

¿Está diciendo que NO quiere seguir? Responde "refusing": true solo si se está retirando de la conversación o rechazando el servicio o la reunión.

Ejemplos de "refusing": true — "buscaré en otro lado", "ya le comenté que no", "no gracias", "ya conseguí a alguien", "déjalo así", "no me interesa", "mejor lo dejo".
Ejemplos de "refusing": FALSE — cualquier cosa que siga la conversación, aunque tenga la palabra "no": "no sé si el jueves pueda", "no entendí", "no tengo tema todavía", "no puedo a esa hora" (está negociando el horario, no retirándose), "no he empezado". Una objeción, una duda o una pega sobre el horario NO es un rechazo.

Si "refusing" es true, clasifica en "kind":
- "not_interested": ya no quiere el servicio, o ya lo resolvió por otro lado.
- "postpone": sí le interesa pero no ahora ("más adelante", "el próximo ciclo", "cuando junte el dinero").
- "wants_human": no está rechazando nada, pide hablar con una persona en vez del bot.
Si "refusing" es false, deja "kind" en null.

Ante la duda responde false: tratar a un lead que sigue conversando como si se hubiera despedido cierra la conversación sin motivo.

Responde ÚNICAMENTE en JSON válido: {"refusing": true o false, "kind": "not_interested" | "postpone" | "wants_human" | null}`;

    try {
      const parsed = await this._generateJSON(prompt, { timeoutMs: 12000, ollamaFormat: REFUSAL_SCHEMA });
      const refusing = !!parsed.refusing;
      const kind = refusing && ['not_interested', 'postpone', 'wants_human'].includes(parsed.kind)
        ? parsed.kind
        : (refusing ? 'not_interested' : null);
      return { refusing, kind, source: 'llm' };
    } catch (err) {
      console.warn(`${this.provider} LLM refusal notice:`, err.message);
      return { refusing: false, kind: null, source: 'fallback' };
    }
  }

  /**
   * El contacto no eligió un horario de la lista ni nombró un día o una hora,
   * pero SÍ dijo algo sobre cuándo puede: "salgo de la universidad un poco
   * tarde", "trabajo en la mañana", "después de mis clases", "recién llego a
   * las 8". Eso no es un "no te entendí": es la respuesta, dicha como la dice
   * cualquiera.
   *
   * El 28/09 un lead escribió justo eso —"salgo de la universidad un poco
   * tarde"— con el bloque de 6:30 p.m. en la lista que tenía delante, y
   * recibió "No te entendí bien 🤔" con la misma lista de nuevo; dos mensajes
   * después se perdió. `parseSchedulingDate` y `parseSchedulingChoice` no lo
   * ven porque ninguno de los dos devuelve día ni hora para una frase así.
   *
   * Este método le pasa al LLM la restricción junto con los horarios que el
   * contacto tiene a la vista y le pide que diga CUÁLES le sirven:
   *   - `fits`: índices (base 0) de los horarios compatibles, en orden de
   *     preferencia.
   *   - `constraint`: la restricción redactada en segunda persona ("sales
   *     tarde de la universidad"), para poder nombrarla al responder en vez
   *     de contestar con una lista muda.
   *   - `understood: false` cuando el mensaje de verdad no dice nada sobre
   *     cuándo puede; ahí sí corresponde el "no te entendí".
   */
  async matchSlotsToConstraint(text, optionLabels) {
    if (!this.hasLLM() || !(optionLabels || []).length) {
      return { understood: false, fits: [], constraint: null, source: 'fallback' };
    }

    const numbered = optionLabels.map((label, i) => `${i + 1}. ${label}`).join('\n');
    const prompt = `Le mostraste a alguien esta lista numerada de horarios para una reunión:
${numbered}

Y respondió esto: """${text}"""

No eligió ninguna opción por su número ni nombró un día o una hora exacta. La pregunta es si en su mensaje dice algo sobre CUÁNDO PUEDE, aunque lo diga de forma indirecta.

Ejemplos de mensajes que SÍ dicen cuándo puede ("understood": true):
- "salgo de la universidad un poco tarde" → solo le sirven los horarios de la tarde/noche
- "trabajo en la mañana" → solo los de la tarde
- "después de mis clases, como a las 7" → los de la noche
- "en la mañana mejor" / "algo más temprano" → los de la mañana
- "solo puedo fines de semana" → ninguno de los ofrecidos, pero SÍ se entendió la restricción

Ejemplos que NO dicen nada sobre cuándo ("understood": false): "ok", "gracias", "cuánto cuesta", "[Imagen]", un emoji suelto, "no entendí".

Si "understood" es true, pon en "fits" los NÚMEROS de la lista que cumplen su restricción, ordenados del que mejor le calza al que menos. Si su restricción se entiende pero NINGÚN horario de la lista la cumple, deja "fits" como lista vacía (eso es una respuesta útil: se le dirá que no hay nada en ese rango).

En "constraint" escribe su restricción en segunda persona y en pocas palabras, como para usarla en una frase ("sales tarde de la universidad", "trabajas en la mañana", "solo puedes de noche"). Si "understood" es false, deja "constraint" en null.

Responde ÚNICAMENTE en JSON válido: {"understood": true o false, "fits": [<números de la lista>], "constraint": "<texto corto o null>"}`;

    try {
      const parsed = await this._generateJSON(prompt, { timeoutMs: 15000, ollamaFormat: SLOT_CONSTRAINT_SCHEMA });
      const understood = !!parsed.understood;
      // Se filtran los índices fuera de rango y los repetidos: el modelo a
      // veces devuelve un número de más cuando la lista es corta, y un índice
      // inventado haría ofrecer un bloque que no existe.
      const fits = [...new Set(
        (Array.isArray(parsed.fits) ? parsed.fits : [])
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= optionLabels.length)
          .map((n) => n - 1)
      )];
      const constraint = understood && typeof parsed.constraint === 'string' && parsed.constraint.trim()
        ? parsed.constraint.trim()
        : null;
      return { understood, fits: understood ? fits : [], constraint, source: 'llm' };
    } catch (err) {
      console.warn(`${this.provider} LLM slot constraint notice:`, err.message);
      return { understood: false, fits: [], constraint: null, source: 'fallback' };
    }
  }

  /**
   * Durante el agendamiento (elegir modalidad, dar el correo/teléfono, elegir
   * día u hora) el flujo lo maneja una máquina de estados determinista que
   * solo sabe extraer UN dato. Este clasificador es la válvula de escape: mira
   * el mensaje real del contacto y responde dos cosas:
   *
   *   - `answersStep`: si el mensaje trae la respuesta al paso actual (aunque
   *     venga acompañada de otra cosa, ej. "mi correo es x@y.com pero cuánto
   *     dura la reunión?").
   *   - `isAside` + `answer`: si además hace una pregunta APARTE, con la
   *     respuesta ya redactada usando ÚNICAMENTE la base de conocimiento.
   *   - `preferredWhen`: si de paso dijo cuándo quiere la reunión ("via meet
   *     para las 3 de la tarde hoy"), para no volver a preguntarle el día
   *     dos pasos más adelante.
   *
   * Las preguntas sobre los días/horarios ofrecidos NO cuentan como pregunta
   * aparte: de eso ya se encargan parseSchedulingDate/parseSchedulingChoice.
   *
   * Si no hay LLM disponible, devuelve el comportamiento histórico
   * (`answersStep: true`, sin pregunta aparte): el paso sigue como siempre.
   */
  async classifySchedulingAside(text, { stepQuestion, knowledgeBlock, contactName } = {}) {
    if (!this.hasLLM()) {
      return { answersStep: true, isAside: false, preferredWhen: null, answer: null, source: 'fallback' };
    }

    const prompt = `Eres Avan, de Avantage Group (Perú). Estás coordinando por WhatsApp una reunión con el asesor y acabas de preguntarle esto al contacto${contactName ? ` (${contactName})` : ''}:

"""${stepQuestion}"""

El contacto respondió:

"""${text}"""

DATOS REALES DEL SERVICIO (lo ÚNICO que puedes afirmar; nunca inventes precios, plazos ni cifras que no estén aquí):
${knowledgeBlock || '(sin datos cargados)'}

Analiza el mensaje y responde:
- "answersStep": true si el mensaje CONTIENE la respuesta a lo que le preguntaste, aunque venga junto con otra cosa. false si no la contiene.
- "isAside": true si además hace una PREGUNTA APARTE, sobre algo distinto de lo que le preguntaste (ej. cuánto dura la reunión, cuánto cuesta, qué incluye, con quién es, si es presencial). false si no pregunta nada aparte.
  MUY IMPORTANTE: preguntar por los días u horarios disponibles, pedir otro horario, o preguntar si hay espacio a cierta hora NO es una pregunta aparte — eso es parte del paso actual. En esos casos "isAside" debe ser false.
- "preferredWhen": si en su mensaje dijo CUÁNDO quiere la reunión (un día, una hora, o ambos: "para las 3 de la tarde hoy", "el lunes temprano"), cópialo TAL CUAL. Si no dijo nada del cuándo, null.
- "answer": si "isAside" es true, la respuesta a esa pregunta: 1 o 2 líneas, tono WhatsApp cercano, máximo 1 emoji, usando SOLO los datos reales de arriba. Si la pregunta no se puede responder con esos datos, dile con naturalidad que eso se lo detalla el asesor en la reunión. No agregues preguntas al final (el sistema retoma el paso por su cuenta). Si "isAside" es false, deja null.

Responde ÚNICAMENTE en JSON válido: {"answersStep": <true o false>, "isAside": <true o false>, "preferredWhen": "<texto o null>", "answer": "<texto o null>"}`;

    try {
      const parsed = await this._generateJSON(prompt, { timeoutMs: 15000, ollamaFormat: SCHEDULING_ASIDE_SCHEMA });
      const answer = typeof parsed.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : null;
      return {
        answersStep: !!parsed.answersStep,
        preferredWhen: typeof parsed.preferredWhen === 'string' && parsed.preferredWhen.trim() ? parsed.preferredWhen.trim() : null,
        // Sin texto de respuesta no hay nada que contestar: se trata como si
        // no hubiera pregunta aparte y el paso sigue su curso normal.
        isAside: !!parsed.isAside && !!answer,
        answer,
        source: 'llm'
      };
    } catch (err) {
      console.warn(`${this.provider} LLM scheduling aside notice:`, err.message);
      return { answersStep: true, isAside: false, preferredWhen: null, answer: null, source: 'fallback' };
    }
  }

  /**
   * Clasifica un mensaje que llega DESPUÉS de que el lead ya agendó su
   * llamada (sesión "completed" con reunión real en `scheduled_meetings`).
   * Inspirado en la lógica de un workflow n8n existente del equipo: los
   * simples saludos/agradecimientos/confirmaciones cortas no necesitan
   * respuesta (el asesor ya tiene la reunión agendada); en cambio, pedidos
   * de reagendar/cancelar, quejas de que nadie llegó, preguntas sobre la
   * reunión (link/hora/duración), o consultas nuevas (precio, otro tema) sí
   * necesitan una respuesta y, salvo la pregunta de datos de la reunión
   * (que Avan puede responder solo con los datos reales que ya tiene),
   * deben avisarle a un asesor humano.
   */
  async classifyPostBookingMessage(text, { meetingLabel, meetLink, contactName, knowledgeBlock }) {
    if (!this.hasLLM()) {
      return this.fallbackClassifyPostBookingMessage(text);
    }

    const prompt = `Eres Avan, de Avantage Group. Este contacto${contactName ? ` (${contactName})` : ''} YA tiene una llamada agendada para *${meetingLabel}* (link de Meet: ${meetLink || 'no disponible'}) con un asesor. Te acaba de escribir esto, después de que su reunión ya quedó agendada:

"""${text}"""

${knowledgeBlock ? `DATOS REALES DEL SERVICIO (lo ÚNICO que puedes afirmar además de la fecha y el link de arriba):
${knowledgeBlock}

` : ''}Clasifícalo:
- Si es solo un saludo, agradecimiento o confirmación corta sin pedir nada más (ej. "gracias", "ok", "perfecto", "listo", "buenas"), no necesita respuesta.
- Si pregunta por datos de SU reunión (link, hora, fecha, cuánto dura, dónde es), respóndele tú mismo usando ÚNICAMENTE los datos reales de arriba (la fecha/hora, el link y los datos del servicio), sin inventar nada más.
- Si pide reagendar, cancelar, cambiar de horario, se queja de que nadie llegó a la reunión o de un problema con el enlace, o hace una consulta totalmente nueva (precio, otro tema de tesis, otro servicio), respóndele con un mensaje breve y empático confirmando que un asesor del equipo le va a escribir directamente para resolverlo — y márcalo como urgente para que el equipo lo vea.

Responde ÚNICAMENTE en JSON válido:
{
  "needsReply": <true o false>,
  "replyText": "<mensaje de WhatsApp breve, o null si needsReply es false>",
  "isUrgent": <true si el equipo debe intervenir manualmente (reagendar/queja/consulta nueva), false si ya quedó resuelto solo con la respuesta (ej. le diste el link)>
}`;

    try {
      const parsed = await this._generateJSON(prompt, { timeoutMs: 15000 });
      return {
        needsReply: !!parsed.needsReply,
        replyText: parsed.needsReply ? (parsed.replyText || null) : null,
        isUrgent: !!parsed.isUrgent,
        source: 'llm'
      };
    } catch (err) {
      console.warn(`${this.provider} LLM post-booking classification notice:`, err.message);
      return this.fallbackClassifyPostBookingMessage(text);
    }
  }

  /**
   * Respaldo sin IA: solo reconoce agradecimientos/confirmaciones cortas
   * como "no necesita respuesta"; cualquier otra cosa se trata como urgente
   * (mejor avisarle de más a un asesor que dejar a alguien sin atender).
   */
  fallbackClassifyPostBookingMessage(text) {
    const normalized = (text || '').trim().toLowerCase();
    const esConfirmacionCorta = /^(ok|okay|perfecto|listo|excelente|bueno|dale|genial|bien|ya|entendido|de acuerdo|gracias|muchas gracias)[.!]*$/.test(normalized);
    if (esConfirmacionCorta) {
      return { needsReply: false, replyText: null, isUrgent: false, source: 'fallback' };
    }
    return {
      needsReply: true,
      replyText: 'Un asesor del equipo te va a escribir directamente para ayudarte con eso. ¡Gracias! 🙌',
      isUrgent: true,
      source: 'fallback'
    };
  }

  /**
   * Genera una evaluación estructurada de alta precisión cuando no hay API Key activa
   */
  generateStructuredHeuristicEvaluation(topic, academicLevel, fieldOfStudy, topPriority) {
    const isPosgrado = academicLevel.toLowerCase().includes('posgrado') || 
                      academicLevel.toLowerCase().includes('maestría') || 
                      academicLevel.toLowerCase().includes('doctorado');

    const topicLen = topic.length;
    const wordCount = topic.trim().split(/\s+/).length;

    // Puntuaciones base ajustadas al nivel
    let rigor = isPosgrado ? 78 : 85;
    let novelty = isPosgrado ? 82 : 75;
    let peruRel = Math.min(topPriority.alignmentPercentage + 5, 95);
    let dataAvail = 80;

    if (wordCount < 4) {
      rigor -= 15;
      novelty -= 10;
    } else if (wordCount > 15) {
      rigor += 8;
    }

    const overall = Math.round((rigor * 0.3) + (novelty * 0.25) + (peruRel * 0.25) + (dataAvail * 0.2));

    let viabilityLevel = 'Alta';
    if (overall < 60) viabilityLevel = 'Baja';
    else if (overall < 75) viabilityLevel = 'Media';
    else if (overall < 85) viabilityLevel = 'Media-Alta';

    return {
      overallViabilityScore: overall,
      viabilityLevel,
      academicLevelAssessed: academicLevel,
      peruContextRelevance: `El tema '${topic}' aborda problemáticas de alto interés en el ámbito peruano, alineándose cercanamente con la línea de '${topPriority.priorityArea}' promovida por CONCYTEC e instituciones universitarias reguladas por SUNEDU.`,
      dimensionScores: {
        rigorMethodological: Math.min(rigor, 98),
        noveltyAcademic: Math.min(novelty, 98),
        peruRelevance: Math.min(peruRel, 98),
        dataAvailability: Math.min(dataAvail, 98)
      },
      strengths: [
        `Alta alineación con las necesidades actuales de investigación en Perú en la categoría de ${topPriority.priorityArea}.`,
        `Viabilidad clara para definir una hipótesis empírica sustentable en sustentación oral ante jurado de ${academicLevel}.`,
        `Potencial para generar aportes metodológicos aplicables al sector público o privado nacional.`
      ],
      risksAndLimitations: [
        `Es necesario precisar la delimitación espacial y temporal en Perú para evitar observaciones sobre 'amplitud excesiva' por el jurado.`,
        isPosgrado 
          ? `Para grado de Posgrado/Maestría, se exigirá una validación estadística rigurosa o modelo conceptual original más allá de una revisión descriptiva.`
          : `Para Pregrado, asegurar que el acceso a la muestra o base de datos sea formalizado mediante cartas de presentación institucional.`
      ],
      recommendedDelimitation: `"${topic}: Estudio de caso y propuesta de optimización en el contexto institucional/empresarial peruano, 2025-2026"`,
      suggestedMethodology: {
        approach: isPosgrado ? 'Cuantitativa / Mixta Aplicada' : 'Cuantitativa Descriptiva-Explicativa',
        design: isPosgrado ? 'Diseño Cuasi-Experimental / Modelado Estructural' : 'No Experimental Transversal',
        sampleOrDataTarget: 'Empresas, instituciones públicas o base de datos representativa del sector en Lima/regiones de Perú.'
      },
      keyConcytecLine: topPriority.priorityArea
    };
  }
}
