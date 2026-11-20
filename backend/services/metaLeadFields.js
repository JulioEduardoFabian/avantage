/**
 * Lectura del `field_data` de un lead de Meta Lead Ads.
 *
 * Vive aparte de `metaWebhookService.js` porque son reglas puras —texto que
 * entra, campos del lead que salen— y de ellas depende lo que el equipo ve en
 * la ficha: hay que poder probarlas sin webhook, sin Graph API y sin base.
 *
 * El nombre de cada pregunta NO es estable. En un formulario instantáneo
 * clásico las preguntas prellenadas llegan con la clave canónica de Meta
 * (`full_name`, `email`, `phone_number`), pero en los formularios que se
 * contestan DENTRO de Messenger o de Instagram la mayoría son preguntas
 * propias y la clave es el texto de la pregunta convertido a slug
 * (`cual_es_tu_numero_de_celular`). Buscando `fields.phone_number` a secas,
 * de esos leads solo entraba el nombre —el único campo que Messenger sí
 * prellena— y el celular y el resto de las respuestas se perdían aunque Meta
 * las hubiera mandado (caso real del 25/10/2026: un lead de Messenger quedó
 * en la tarjeta como "Sin celular", y lo mismo venía pasando con Instagram).
 *
 * Por eso acá nada se compara contra una clave exacta: se normaliza la clave
 * (sin tildes, sin signos, guiones y guiones bajos como espacio) y se la
 * busca por patrón. Y lo que no cae en ningún campo conocido tampoco se tira:
 * va al bloque de respuestas de las notas, que es lo que hace que el próximo
 * formulario con una pregunta nueva no vuelva a perder nada.
 */

/** Sin tildes, sin signos y con guiones/guiones bajos como espacio. */
export function normalizeFieldKey(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[¿?¡!.,;:()"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Título profesional" / "Maestría" / etc. -> uno de los tres niveles canónicos, o null. */
export function mapAcademicLevel(value) {
  const v = normalizeFieldKey(value);
  if (/doctorado/.test(v)) return 'Posgrado (Doctorado)';
  if (/maestria|magister|master/.test(v)) return 'Posgrado (Maestría)';
  if (/bachiller|titulo|pregrado|licenciatura/.test(v)) return 'Pregrado (Bachiller/Título)';
  return null;
}

/**
 * Las respuestas de opción múltiple de un formulario de Meta Lead Ads a
 * veces llegan como la CLAVE interna de la opción ("estoy_con_el_proyecto")
 * en vez del texto que la persona vio y eligió ("Estoy con el proyecto") —
 * caso real: la misma respuesta que en el visor nativo de Meta se ve
 * legible llegaba así por la Graph API. Si el valor tiene esa forma
 * (todo en snake_case/kebab-case, sin espacios ni mayúsculas), se convierte
 * a texto legible; un valor que ya viene con espacios o mayúsculas propias
 * (como "UNDAC" o "Título profesional") se deja tal cual.
 */
export function prettifyFormValue(value) {
  const v = String(value || '').trim();
  if (!v || !/^[a-z0-9]+([_-][a-z0-9]+)+$/.test(v)) return v;
  const words = v.replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * La clave de la pregunta, escrita para que se lea en la ficha. Es lo único
 * que hay: el `field_data` de la Graph API trae la clave de la pregunta,
 * nunca el texto tal como lo vio la persona.
 */
export function prettifyFormLabel(name) {
  const label = String(name || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label) return '';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Mismas preguntas que ya reconoce extractLeadFormFields() en
// whatsappBotService.js para el resumen que llega por WhatsApp.
const LEVEL_KEY_RE = /sacando|nivel academ|grado academ|que estas estudiando/;
const UNIVERSITY_KEY_RE = /universidad|casa de estudios|instituto/;
const FIELD_KEY_RE = /carrera|especialidad|programa de estudio/;
const PROGRESS_KEY_RE = /punto|avanzad|avance|etapa|estado.*tesis/;
const EMAIL_KEY_RE = /email|e mail|correo/;
const PHONE_KEY_RE = /phone|telef|celular|whatsapp|whats app|movil|numero|contacto/;
const NAME_KEY_RE = /^(full name|first name|last name|name|nombre|nombres|nombre completo|nombres completos|nombres y apellidos|apellidos y nombres|apellidos)$/;
const NAME_QUESTION_RE = /\b(tu|su) (nombre|nombres)\b|como te llamas/;
// Un documento no es un teléfono aunque la pregunta diga "número": el DNI
// peruano tiene 8 dígitos y entraría como celular por la puerta de atrás.
const ID_KEY_RE = /\bdni\b|documento|identidad|cedula|carnet|pasaporte|\bcui\b|codigo/;

const digitsOf = (value) => String(value || '').replace(/\D/g, '');

/** Teléfono plausible: de 7 (fijo) a 15 dígitos (el máximo de E.164). */
function looksLikePhone(value, minDigits = 7) {
  const digits = digitsOf(value);
  return digits.length >= minDigits && digits.length <= 15;
}

/**
 * Convierte el `field_data` de un lead de Meta en los campos del CRM.
 *
 * Devuelve además `extras`: TODA respuesta que no cayó en un campo conocido,
 * en el orden en que vino. Es deliberado que no se descarte nada — el equipo
 * agrega preguntas al formulario sin avisarle al CRM, y una respuesta que no
 * se guarda en ningún lado es una respuesta que la persona contestó para
 * nadie.
 */
export function extractMetaLeadForm(fieldData) {
  const out = { extras: [] };
  const unmatched = [];

  for (const item of fieldData || []) {
    const key = normalizeFieldKey(item.name);
    const value = String(item.values?.[0] ?? '').trim();
    if (!key || !value) continue;

    // El orden importa: "¿cuál es el nombre de tu universidad?" tiene las dos
    // palabras, y lo que esa pregunta pide es la universidad.
    if (!out.university && UNIVERSITY_KEY_RE.test(key)) {
      out.university = prettifyFormValue(value);
    } else if (!out.fieldOfStudy && FIELD_KEY_RE.test(key)) {
      out.fieldOfStudy = prettifyFormValue(value);
    } else if (!out.academicLevel && LEVEL_KEY_RE.test(key) && mapAcademicLevel(value)) {
      out.academicLevel = mapAcademicLevel(value);
    } else if (!out.progressNote && PROGRESS_KEY_RE.test(key)) {
      out.progressNote = prettifyFormValue(value);
    } else if (!out.email && (EMAIL_KEY_RE.test(key) || value.includes('@'))) {
      out.email = value;
    } else if (!out.phone && PHONE_KEY_RE.test(key) && !ID_KEY_RE.test(key) && looksLikePhone(value)) {
      out.phone = value;
    } else if (!out.dni && ID_KEY_RE.test(key)) {
      out.dni = value;
    } else if (!out.fullName && (NAME_KEY_RE.test(key) || NAME_QUESTION_RE.test(key))) {
      out.fullName = value;
    } else {
      unmatched.push({ key, name: item.name, value });
    }
  }

  /*
   * Último recurso para el celular: una respuesta de 9 dígitos o más que no
   * sea un documento es un teléfono, se llame como se llame la pregunta. Es
   * la red que rescata al formulario cuya pregunta no nombra ni el celular ni
   * el WhatsApp. Se piden 9 dígitos y no 7 justamente para que un DNI (8) no
   * entre por acá.
   */
  if (!out.phone) {
    const index = unmatched.findIndex((entry) => !ID_KEY_RE.test(entry.key) && looksLikePhone(entry.value, 9));
    if (index >= 0) {
      out.phone = unmatched[index].value;
      unmatched.splice(index, 1);
    }
  }

  out.extras = unmatched.map((entry) => ({
    label: prettifyFormLabel(entry.name),
    value: prettifyFormValue(entry.value)
  }));
  return out;
}

/**
 * Compatibilidad: lo que se extraía antes de que este módulo leyera también
 * nombre, correo, teléfono y documento. Lo sigue usando el backfill.
 */
export function extractCustomFields(fieldData) {
  const { academicLevel, university, fieldOfStudy, progressNote, extras } = extractMetaLeadForm(fieldData);
  const extracted = {};
  if (academicLevel) extracted.academicLevel = academicLevel;
  if (university) extracted.university = university;
  if (fieldOfStudy) extracted.fieldOfStudy = fieldOfStudy;
  if (progressNote) extracted.progressNote = progressNote;
  if (extras?.length) extracted.extras = extras;
  return extracted;
}

/**
 * Arma el bloque de notas legible con lo que se pudo extraer del
 * formulario ("Grado académico: ...", "Universidad: ...", etc.) — mismo
 * estilo de etiquetas que ya usa whatsappBotService.finalize() para las
 * notas de un lead calificado por WhatsApp, para que el equipo vea el mismo
 * formato sea cual sea el origen del lead. Al final van las respuestas que no
 * tienen campo propio en la ficha, con el nombre de su pregunta.
 */
export function formatCustomFieldsNote(custom) {
  const lines = [];
  if (custom.academicLevel) lines.push(`Grado académico: ${custom.academicLevel}`);
  if (custom.fieldOfStudy) lines.push(`Carrera: ${custom.fieldOfStudy}`);
  if (custom.university) lines.push(`Universidad: ${custom.university}`);
  if (custom.progressNote) lines.push(`Avance declarado: ${custom.progressNote}`);
  for (const extra of custom.extras || []) {
    if (extra?.label && extra?.value) lines.push(`${extra.label}: ${extra.value}`);
  }
  return lines.join('\n');
}
