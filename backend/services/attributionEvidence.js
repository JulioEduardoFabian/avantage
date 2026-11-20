/**
 * Con qué evidencia se le puede poner plataforma a un lead, contestado en UN
 * solo sitio.
 *
 * La regla viene de un error medido: la importación de TikTok, cuando no
 * encontraba la ficha por su `lead_id`, la buscaba por los **últimos 9 dígitos
 * del teléfono** y, si daba con una, le escribía campaña, grupo y anuncio. Como
 * `leadOrigin()` pregunta por las columnas `tiktok_*` antes que por las demás,
 * cualquier ficha que recibiera un `tiktok_lead_id` por esa vía pasaba a ser
 * "TikTok" en todas las hojas de marketing y tapaba su origen real —el
 * formulario de Meta o el clic que abrió la conversación—. Y no era un botón
 * que alguien aprieta mirando: la conciliación diaria corre con `apply: true`,
 * así que eso se escribía solo, todos los días.
 *
 * El criterio es el de cualquier conciliación seria: **coincidir no es
 * identificar**. Que TikTok reporte 21 leads y el CRM tenga 21 fichas en el
 * mismo corte no empareja ninguna de las 21 con ninguna de las otras. Solo
 * emparejan los identificadores que la plataforma emitió para ESE envío —el
 * `lead_id`, el `leadgen_id`, el marcador que quedó escrito al adjuntarlo, el
 * `ctwa_clid` del clic— porque ninguno de ellos se puede inventar por descarte.
 *
 * El teléfono sirve para **no duplicar a una persona**, que es otro problema y
 * se sigue resolviendo con él (ver `findByPhone`): dos fichas de la misma
 * persona son un estorbo, pero una ficha con la plataforma equivocada es un
 * presupuesto mal repartido. Por eso un match por teléfono alcanza para colgar
 * el envío de la ficha que ya existe y **no** para decir de dónde salió.
 *
 * Es puro y no toca la base: recibe candidatos y devuelve con qué método y con
 * cuánta confianza se los puede usar.
 */

/**
 * Cómo se emparejó el lead de la plataforma con la ficha del CRM.
 *
 * Se guarda en `leads.attribution_method` junto con la confianza y la fecha,
 * porque "este lead es de TikTok" sin decir cómo se supo es exactamente el
 * dato que no se puede auditar después.
 */
export const ATTRIBUTION_METHODS = {
  /** El id que la plataforma emitió para este envío (`lead_id`, `leadgen_id`). */
  platformLeadId: 'platform_lead_id',
  /** El marcador `[TikTok lead_id=...]` que quedó en las notas al adjuntarlo. */
  noteMarker: 'note_marker',
  /** Llegó por el webhook de la plataforma: la recepción misma es la evidencia. */
  webhook: 'webhook',
  /** Coincidieron los últimos 9 dígitos del teléfono y nada más. */
  phoneMatch: 'phone_match',
  /** Lo escribió una persona. */
  manual: 'manual'
};

export const CONFIDENCE = { alta: 'alta', media: 'media', baja: 'baja' };

/*
 * Los tres primeros son identificadores que emitió la plataforma o acuses de
 * recepción: no hay forma de llegar a ellos por descarte. El teléfono es bajo
 * porque un sufijo de 9 dígitos compartido no distingue a dos personas, y
 * porque el contacto que llenó el formulario de TikTok y además escribió por
 * WhatsApp desde un anuncio de Meta es el caso NORMAL mientras las dos
 * plataformas corren sobre el mismo público.
 */
const CONFIDENCE_BY_METHOD = {
  [ATTRIBUTION_METHODS.platformLeadId]: CONFIDENCE.alta,
  [ATTRIBUTION_METHODS.noteMarker]: CONFIDENCE.alta,
  [ATTRIBUTION_METHODS.webhook]: CONFIDENCE.alta,
  [ATTRIBUTION_METHODS.manual]: CONFIDENCE.media,
  [ATTRIBUTION_METHODS.phoneMatch]: CONFIDENCE.baja
};

export function confidenceFor(method) {
  return CONFIDENCE_BY_METHOD[method] || null;
}

/**
 * ¿Este método habilita escribir plataforma, campaña, grupo y anuncio?
 *
 * Solo la confianza alta. Con la baja el envío se cuelga igual de la ficha
 * —para no abrir una segunda ficha de la misma persona— pero la atribución se
 * queda sin escribir y el caso va a `attribution_conflicts` para que alguien
 * lo resuelva. Un origen desconocido se puede contar como desconocido; uno
 * inventado se cuenta como verdad.
 */
export function writesAttribution(method) {
  return confidenceFor(method) === CONFIDENCE.alta;
}

/** Por qué un emparejamiento quedó sin resolver. */
export const CONFLICT_REASONS = {
  /** El sufijo del teléfono dio con más de una ficha. */
  multiplePhoneMatch: 'multiple_phone_match',
  /** Dio con una sola, pero el teléfono es la única evidencia que hay. */
  phoneOnlyMatch: 'phone_only_match',
  /** La ficha ya tenía otra plataforma de origen escrita. */
  originConflict: 'origin_conflict'
};

/**
 * Con qué ficha —y con qué derecho— se empareja un envío de la plataforma.
 *
 * `byPlatformLeadId` es la ficha hallada por el id del envío (o por su marcador
 * en las notas): si está, no hay nada que decidir. `phoneCandidates` son TODAS
 * las fichas cuyo teléfono coincide, y son todas a propósito: pedir una sola y
 * quedarse con la primera es la asignación arbitraria que esto viene a evitar
 * —dos fichas con el mismo sufijo pueden ser dos personas distintas, y el
 * desempate por "la más reciente" es una moneda al aire—.
 *
 * Devuelve `ambiguous: true` sin elegir ninguna cuando hay más de una: eso no
 * es un fallo, es un caso que necesita que lo resuelva una persona.
 */
export function resolveMatch({ byPlatformLeadId = null, byNoteMarker = null, phoneCandidates = [] } = {}) {
  const none = { lead: null, method: null, confidence: null, ambiguous: false, candidates: [] };

  if (byPlatformLeadId) {
    return {
      lead: byPlatformLeadId,
      method: ATTRIBUTION_METHODS.platformLeadId,
      confidence: CONFIDENCE.alta,
      ambiguous: false,
      candidates: []
    };
  }

  if (byNoteMarker) {
    return {
      lead: byNoteMarker,
      method: ATTRIBUTION_METHODS.noteMarker,
      confidence: CONFIDENCE.alta,
      ambiguous: false,
      candidates: []
    };
  }

  const candidates = (phoneCandidates || []).filter(Boolean);
  if (!candidates.length) return none;

  if (candidates.length > 1) {
    return {
      lead: null,
      method: ATTRIBUTION_METHODS.phoneMatch,
      confidence: CONFIDENCE.baja,
      ambiguous: true,
      candidates
    };
  }

  return {
    lead: candidates[0],
    method: ATTRIBUTION_METHODS.phoneMatch,
    confidence: CONFIDENCE.baja,
    ambiguous: false,
    candidates
  };
}

/**
 * El marcador de las notas vale lo que valió la evidencia que lo escribió.
 *
 * Hace falta por un camino que, sin esto, lava la evidencia débil hasta
 * volverla fuerte. Cuando un envío se cuelga de una ficha por teléfono se le
 * escribe igual el marcador `[TikTok lead_id=...]` en las notas — es lo que
 * impide que la importación vuelva a dar de alta ese lead en cada pasada. Pero
 * en la corrida siguiente ese mismo marcador se encuentra como
 * `noteMarker`, que es confianza ALTA, y entonces sí se le escribiría la
 * campaña: el teléfono habría terminado atribuyendo el lead, dos días
 * después y por la puerta de atrás.
 *
 * La ficha recuerda con qué se la emparejó (`attribution_confidence`), y una
 * evidencia baja no se asciende sola: el caso ya está anotado como pendiente
 * y lo resuelve una persona, no la repetición.
 */
export function demoteLaunderedMarker(method, lead = null) {
  if (method !== ATTRIBUTION_METHODS.noteMarker) return method;
  if (lead?.attribution_confidence === CONFIDENCE.baja) return ATTRIBUTION_METHODS.phoneMatch;
  return method;
}

/**
 * Lo que se escribe en la ficha cuando una conciliación la vuelve a mirar.
 *
 * La fecha va siempre —incluso cuando la atribución no se escribe— porque
 * "esta ficha ya se comparó contra la plataforma y quedó sin resolver" es
 * distinto de "nunca se la comparó", y es la diferencia entre un pendiente y
 * un agujero que nadie vio.
 */
export function evidencePatch({ method, at = new Date() } = {}) {
  if (!method) return {};
  return {
    attribution_method: method,
    attribution_confidence: confidenceFor(method),
    attribution_reconciled_at: at
  };
}
