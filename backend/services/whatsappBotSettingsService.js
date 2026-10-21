import { db } from '../db/connection.js';
import { BOT_PROMPT_DEFAULTS, parsePromptRules, parseFaqFacts } from './whatsappBotPromptDefaults.js';

// Topes defensivos para los textos editables del prompt (evitan que un pegado
// accidental infle el prompt del LLM o el tamaño de la fila).
const MAX_TEXT_LEN = 2000;
const MAX_RULE_LEN = 500;
const MAX_RULES = 40;

// Duración de la reunión (en minutos) que Avan le comunica al contacto.
const MIN_MEETING_MINUTES = 5;
const MAX_MEETING_MINUTES = 180;

// Límites defensivos para los rangos de precio (soles) que Avan cita cuando
// preguntan por el costo — evitan que un valor mal tipeado en el panel
// termine citándose tal cual a un lead.
const MIN_PRICE = 0;
const MAX_PRICE = 100000;
const PRICE_FIELDS = [
  'pricePregradoMin', 'pricePregradoMax',
  'priceMaestriaMin', 'priceMaestriaMax',
  'priceDoctoradoMin', 'priceDoctoradoMax'
];
const PRICE_FIELD_TO_COLUMN = {
  pricePregradoMin: 'price_pregrado_min',
  pricePregradoMax: 'price_pregrado_max',
  priceMaestriaMin: 'price_maestria_min',
  priceMaestriaMax: 'price_maestria_max',
  priceDoctoradoMin: 'price_doctorado_min',
  priceDoctoradoMax: 'price_doctorado_max'
};

function clampText(value, max = MAX_TEXT_LEN) {
  const trimmed = String(value ?? '').trim();
  return trimmed.slice(0, max);
}

/** Normaliza una lista editable de textos (reglas del equipo o hechos del FAQ). */
function sanitizeTextList(items) {
  if (!Array.isArray(items)) return null;
  return items
    .filter((r) => typeof r === 'string')
    .map((r) => r.trim().slice(0, MAX_RULE_LEN))
    .filter(Boolean)
    .slice(0, MAX_RULES);
}

/**
 * Configuración (fila única) del motor conversacional de Avan: bloques
 * editables de su personalidad (identidad, objetivo, reglas del equipo),
 * instrucciones de tono adicionales, controles de comportamiento y los
 * valores por defecto que se aplican cuando el lead no menciona su nivel,
 * carrera o ámbito.
 */
export class WhatsappBotSettingsService {
  async get() {
    let row = await db('whatsapp_bot_settings').orderBy('id', 'asc').first();

    // Salvaguarda por si la tabla quedó vacía (no debería pasar tras la
    // migración, que siembra la fila inicial).
    if (!row) {
      const [id] = await db('whatsapp_bot_settings').insert({});
      row = await db('whatsapp_bot_settings').where({ id }).first();
    }

    // `prompt_rules` y `faq_knowledge` se guardan como texto JSON; se
    // devuelven ya como arrays para que ni el panel ni el motor
    // conversacional tengan que parsearlos.
    return {
      ...row,
      prompt_rules: parsePromptRules(row.prompt_rules),
      faq_knowledge: parseFaqFacts(row.faq_knowledge)
    };
  }

  /**
   * El interruptor **global** de Avan: `true` = el bot atiende, `false` = lo
   * atiende el equipo y el reparto automático de leads entra en juego.
   *
   * Es una consulta propia y no `get()` porque la pregunta se hace en el camino
   * caliente —una vez por mensaje entrante y una vez por barrido de fondo— y
   * `get()` trae y parsea el prompt entero, el FAQ y los rangos de precio para
   * leer un booleano.
   *
   * Ante un error de base devuelve `true` (el bot sigue): un fallo de lectura
   * no puede dejar en silencio al único que contesta. El lado caro de
   * equivocarse acá es no responderle a nadie, no responder de más.
   */
  async isBotEnabled() {
    try {
      const row = await db('whatsapp_bot_settings').orderBy('id', 'asc').first('bot_enabled');
      return row ? Boolean(row.bot_enabled) : true;
    } catch (error) {
      console.error('❌ No se pudo leer el interruptor global del bot:', error.message);
      return true;
    }
  }

  /** Enciende o apaga el bot para TODAS las conversaciones. */
  async setBotEnabled(enabled) {
    const current = await db('whatsapp_bot_settings').orderBy('id', 'asc').first();
    if (!current) {
      await db('whatsapp_bot_settings').insert({ bot_enabled: !!enabled });
      return this.isBotEnabled();
    }
    await db('whatsapp_bot_settings')
      .where({ id: current.id })
      .update({ bot_enabled: !!enabled, updated_at: db.fn.now() });
    return !!enabled;
  }

  /** Textos por defecto de la personalidad (para el botón "Restaurar" del panel). */
  getPromptDefaults() {
    return {
      identity: BOT_PROMPT_DEFAULTS.identity,
      objective: BOT_PROMPT_DEFAULTS.objective,
      rules: [...BOT_PROMPT_DEFAULTS.rules],
      faq: [...BOT_PROMPT_DEFAULTS.faq],
      meetingDurationMinutes: BOT_PROMPT_DEFAULTS.meetingDurationMinutes
    };
  }

  async update({
    toneInstructions,
    botIdentity,
    botObjective,
    promptRules,
    faqKnowledge,
    meetingDurationMinutes,
    defaultAcademicLevel,
    defaultFieldOfStudy,
    defaultLocation,
    shortRepliesEnabled,
    typingIndicatorEnabled,
    messageGapSeconds,
    salesNotificationPhone,
    salesNotificationEmail,
    pricePregradoMin,
    pricePregradoMax,
    priceMaestriaMin,
    priceMaestriaMax,
    priceDoctoradoMin,
    priceDoctoradoMax
  }) {
    const current = await db('whatsapp_bot_settings').orderBy('id', 'asc').first();
    const priceInput = {
      pricePregradoMin, pricePregradoMax, priceMaestriaMin, priceMaestriaMax, priceDoctoradoMin, priceDoctoradoMax
    };

    let gap = current.message_gap_seconds;
    if (messageGapSeconds !== undefined) {
      const parsed = Number(messageGapSeconds);
      gap = Number.isFinite(parsed) ? Math.min(Math.max(Math.round(parsed), 0), 60) : gap;
    }

    let duration = current.meeting_duration_minutes;
    if (meetingDurationMinutes !== undefined) {
      const parsed = Number(meetingDurationMinutes);
      duration = Number.isFinite(parsed)
        ? Math.min(Math.max(Math.round(parsed), MIN_MEETING_MINUTES), MAX_MEETING_MINUTES)
        : duration;
    }

    const sanitizedRules = promptRules === undefined ? undefined : sanitizeTextList(promptRules);
    const sanitizedFaq = faqKnowledge === undefined ? undefined : sanitizeTextList(faqKnowledge);
    // Se guarda solo dígitos (y un "+" inicial opcional): lo que espera la
    // Graph API como destinatario de un envío de WhatsApp.
    let sanitizedSalesPhone;
    if (salesNotificationPhone !== undefined) {
      const raw = clampText(salesNotificationPhone, 30);
      const digits = raw.replace(/\D/g, '');
      sanitizedSalesPhone = digits ? `${raw.startsWith('+') ? '+' : ''}${digits}` : null;
    }

    let sanitizedSalesEmail;
    if (salesNotificationEmail !== undefined) {
      const raw = clampText(salesNotificationEmail, 255).toLowerCase();
      sanitizedSalesEmail = raw || null;
    }

    // Cada monto se clampea individualmente a [0, MAX_PRICE]; si el par
    // queda invertido (min > max) tras la edición, se intercambian en vez de
    // guardar un rango sin sentido.
    const priceUpdates = {};
    for (const field of PRICE_FIELDS) {
      if (priceInput[field] === undefined) continue;
      const parsed = Number(priceInput[field]);
      priceUpdates[field] = Number.isFinite(parsed)
        ? Math.min(Math.max(Math.round(parsed), MIN_PRICE), MAX_PRICE)
        : current[PRICE_FIELD_TO_COLUMN[field]];
    }
    for (const [minField, maxField] of [
      ['pricePregradoMin', 'pricePregradoMax'],
      ['priceMaestriaMin', 'priceMaestriaMax'],
      ['priceDoctoradoMin', 'priceDoctoradoMax']
    ]) {
      if (priceUpdates[minField] === undefined && priceUpdates[maxField] === undefined) continue;
      const min = priceUpdates[minField] ?? current[PRICE_FIELD_TO_COLUMN[minField]];
      const max = priceUpdates[maxField] ?? current[PRICE_FIELD_TO_COLUMN[maxField]];
      if (min > max) { priceUpdates[minField] = max; priceUpdates[maxField] = min; }
    }

    await db('whatsapp_bot_settings').where({ id: current.id }).update({
      tone_instructions: toneInstructions ?? current.tone_instructions,
      // Los bloques de personalidad se guardan null cuando quedan vacíos: el
      // motor conversacional cae al texto por defecto en ese caso.
      bot_identity: botIdentity === undefined ? current.bot_identity : (clampText(botIdentity) || null),
      bot_objective: botObjective === undefined ? current.bot_objective : (clampText(botObjective) || null),
      prompt_rules: sanitizedRules === undefined
        ? current.prompt_rules
        : (sanitizedRules && sanitizedRules.length ? JSON.stringify(sanitizedRules) : null),
      // El FAQ vacío se guarda como null: el motor cae a los hechos por
      // defecto, para que Avan nunca se quede sin nada que responder.
      faq_knowledge: sanitizedFaq === undefined
        ? current.faq_knowledge
        : (sanitizedFaq && sanitizedFaq.length ? JSON.stringify(sanitizedFaq) : null),
      meeting_duration_minutes: duration,
      default_academic_level: defaultAcademicLevel || current.default_academic_level,
      default_field_of_study: defaultFieldOfStudy || current.default_field_of_study,
      default_location: defaultLocation || current.default_location,
      short_replies_enabled: shortRepliesEnabled === undefined ? current.short_replies_enabled : !!shortRepliesEnabled,
      typing_indicator_enabled: typingIndicatorEnabled === undefined ? current.typing_indicator_enabled : !!typingIndicatorEnabled,
      sales_notification_phone: sanitizedSalesPhone === undefined ? current.sales_notification_phone : sanitizedSalesPhone,
      sales_notification_email: sanitizedSalesEmail === undefined ? current.sales_notification_email : sanitizedSalesEmail,
      message_gap_seconds: gap,
      price_pregrado_min: priceUpdates.pricePregradoMin ?? current.price_pregrado_min,
      price_pregrado_max: priceUpdates.pricePregradoMax ?? current.price_pregrado_max,
      price_maestria_min: priceUpdates.priceMaestriaMin ?? current.price_maestria_min,
      price_maestria_max: priceUpdates.priceMaestriaMax ?? current.price_maestria_max,
      price_doctorado_min: priceUpdates.priceDoctoradoMin ?? current.price_doctorado_min,
      price_doctorado_max: priceUpdates.priceDoctoradoMax ?? current.price_doctorado_max,
      updated_at: db.fn.now()
    });
    return this.get();
  }
}
