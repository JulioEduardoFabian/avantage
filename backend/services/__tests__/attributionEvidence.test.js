import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTRIBUTION_METHODS,
  CONFIDENCE,
  CONFLICT_REASONS,
  confidenceFor,
  demoteLaunderedMarker,
  evidencePatch,
  resolveMatch,
  writesAttribution
} from '../attributionEvidence.js';
import { leadOrigin, PLATFORMS, CHANNELS } from '../leadOrigin.js';

/*
 * Estas pruebas fijan la regla que salió de un error medido y que corría solo:
 * la importación de TikTok, cuando no encontraba la ficha por el `lead_id` del
 * envío, la buscaba por los últimos 9 dígitos del teléfono y, si daba con una,
 * le escribía campaña, grupo y anuncio. Como `leadOrigin()` preguntaba por las
 * columnas `tiktok_*` antes que por las demás, esa ficha pasaba a ser "TikTok"
 * en todas las hojas de marketing y tapaba su origen real. Y la conciliación
 * diaria corre con `apply: true`, así que eso se escribía sin que nadie lo
 * mirara.
 *
 * Que TikTok reporte 21 leads y el CRM tenga 21 fichas del mismo corte no
 * empareja ninguna de las 21 con ninguna de las otras.
 */

// ───────────────────────── Qué evidencia vale para qué ──────────────────────

test('solo la evidencia independiente habilita escribir la atribución', () => {
  assert.equal(writesAttribution(ATTRIBUTION_METHODS.platformLeadId), true);
  assert.equal(writesAttribution(ATTRIBUTION_METHODS.noteMarker), true);
  assert.equal(writesAttribution(ATTRIBUTION_METHODS.webhook), true);

  // El teléfono reconoce a la PERSONA y no al anuncio del que salió.
  assert.equal(writesAttribution(ATTRIBUTION_METHODS.phoneMatch), false);
  // Lo que cargó una persona queda registrado, pero no se asciende a prueba.
  assert.equal(writesAttribution(ATTRIBUTION_METHODS.manual), false);
  // Y sin método no hay nada que respaldar.
  assert.equal(writesAttribution(null), false);
});

test('la confianza de cada método es explícita y no se deduce', () => {
  assert.equal(confidenceFor(ATTRIBUTION_METHODS.platformLeadId), CONFIDENCE.alta);
  assert.equal(confidenceFor(ATTRIBUTION_METHODS.phoneMatch), CONFIDENCE.baja);
  assert.equal(confidenceFor(ATTRIBUTION_METHODS.manual), CONFIDENCE.media);
  assert.equal(confidenceFor('inventado'), null);
});

// ──────────────────────────── A qué ficha se empareja ───────────────────────

test('el id del envío resuelve sin mirar el teléfono', () => {
  const porId = { id: 7 };
  const match = resolveMatch({ byPlatformLeadId: porId, phoneCandidates: [{ id: 8 }, { id: 9 }] });

  assert.equal(match.lead, porId);
  assert.equal(match.method, ATTRIBUTION_METHODS.platformLeadId);
  assert.equal(match.ambiguous, false);
});

test('varios candidatos por teléfono NO eligen uno: queda pendiente', () => {
  const match = resolveMatch({ phoneCandidates: [{ id: 8 }, { id: 9 }] });

  // Lo importante es que no haya ficha elegida: antes ganaba la que el
  // ORDER BY dejaba arriba, que es una moneda al aire entre dos personas que
  // comparten el sufijo de 9 dígitos.
  assert.equal(match.lead, null);
  assert.equal(match.ambiguous, true);
  assert.deepEqual(match.candidates.map((c) => c.id), [8, 9]);
});

test('un solo candidato por teléfono se empareja, pero con confianza baja', () => {
  const match = resolveMatch({ phoneCandidates: [{ id: 8 }] });

  // Se empareja para no abrir una segunda ficha de la misma persona, y la
  // confianza baja es lo que después impide escribirle la campaña.
  assert.equal(match.lead.id, 8);
  assert.equal(match.confidence, CONFIDENCE.baja);
  assert.equal(writesAttribution(match.method), false);
});

test('sin candidatos no hay emparejamiento ni método', () => {
  const match = resolveMatch({ phoneCandidates: [] });
  assert.equal(match.lead, null);
  assert.equal(match.method, null);
  assert.equal(match.ambiguous, false);
});

// ───────────────────── El marcador no lava la evidencia ─────────────────────

test('el marcador escrito por un match de teléfono no se asciende a evidencia fuerte', () => {
  /*
   * El camino que esto cierra: un envío colgado por teléfono deja igual el
   * marcador `[TikTok lead_id=...]` en las notas —es lo que impide volver a
   * darlo de alta en cada pasada—. En la corrida siguiente ese marcador se
   * encuentra como `noteMarker`, que es confianza ALTA, y ahí sí se le
   * escribiría la campaña: el teléfono habría atribuido el lead dos días
   * después y por la puerta de atrás.
   */
  const ficha = { id: 8, attribution_confidence: CONFIDENCE.baja };
  const method = demoteLaunderedMarker(ATTRIBUTION_METHODS.noteMarker, ficha);

  assert.equal(method, ATTRIBUTION_METHODS.phoneMatch);
  assert.equal(writesAttribution(method), false);
});

test('el marcador de una ficha emparejada por su id sigue valiendo', () => {
  const ficha = { id: 8, attribution_confidence: CONFIDENCE.alta };
  const method = demoteLaunderedMarker(ATTRIBUTION_METHODS.noteMarker, ficha);

  assert.equal(method, ATTRIBUTION_METHODS.noteMarker);
  assert.equal(writesAttribution(method), true);
});

// ─────────────────── La fecha se escribe aunque no se resuelva ──────────────

test('conciliar deja fecha incluso cuando la atribución no se pudo escribir', () => {
  const patch = evidencePatch({ method: ATTRIBUTION_METHODS.phoneMatch });

  // "Ya se comparó contra la plataforma y quedó pendiente" es distinto de
  // "nunca se la comparó": esa es la diferencia entre un pendiente y un
  // agujero que nadie vio.
  assert.ok(patch.attribution_reconciled_at instanceof Date);
  assert.equal(patch.attribution_confidence, CONFIDENCE.baja);
});

test('sin método no se escribe nada', () => {
  assert.deepEqual(evidencePatch({ method: null }), {});
});

// ───────────────────── El origen es un sello, no la última columna ──────────

test('una ficha sellada como Meta no se vuelve de TikTok porque le cuelguen un formulario', () => {
  /*
   * El caso exacto del error: lead de formulario de Meta al que después se le
   * adjunta un envío de TikTok. Antes `leadOrigin()` preguntaba por
   * `tiktok_*` primero y devolvía "TikTok", con lo que la venta se acreditaba
   * a la plataforma equivocada.
   */
  const origin = leadOrigin({
    origin_platform: PLATFORMS.meta,
    meta_leadgen_id: '99001',
    meta_ad_id: '120210000000000001',
    meta_campaign_name: 'FORM | contrato | 25Oct',
    meta_created_time: '2026-10-25T10:00:00Z',
    tiktok_lead_id: '7412',
    tiktok_ad_id: '1800000000000000001',
    tiktok_campaign_name: 'TT | WA | Asesor | 27Oct',
    tiktok_created_time: '2026-10-27T10:00:00Z'
  });

  assert.equal(origin.platform, PLATFORMS.meta);
  assert.equal(origin.campaignName, 'FORM | contrato | 25Oct');
  assert.equal(origin.adId, '120210000000000001');

  // Lo de TikTok no se tira: se informa aparte, y la ficha queda marcada como
  // la que hay que ir a revisar.
  assert.equal(origin.conflict, true);
  assert.equal(origin.secondary.length, 1);
  assert.equal(origin.secondary[0].platform, PLATFORMS.tiktok);
  assert.equal(origin.secondary[0].platformLeadId, '7412');
});

test('sin sello gana la evidencia más antigua y no el orden del archivo', () => {
  // Las fichas anteriores a la migración no tienen sello. El desempate por
  // fecha es lo más cerca de "cuál fue primero" sin inventar nada.
  const origin = leadOrigin({
    tiktok_lead_id: '7412',
    tiktok_ad_id: '1800000000000000001',
    tiktok_created_time: '2026-10-27T10:00:00Z',
    meta_leadgen_id: '99001',
    meta_ad_id: '120210000000000001',
    meta_created_time: '2026-10-25T10:00:00Z'
  });

  assert.equal(origin.platform, PLATFORMS.meta);
  assert.equal(origin.conflict, true);
});

test('un sello sin columnas propias no se reemplaza por la plataforma que apareció después', () => {
  /*
   * Lead orgánico de WhatsApp al que una conciliación le colgó un envío de
   * TikTok. Rellenar el origen con TikTok es exactamente el rellenado por
   * descarte: el origen sigue siendo el que se selló.
   */
  const origin = leadOrigin({
    origin_platform: PLATFORMS.organico,
    source: 'WhatsApp Directo',
    tiktok_lead_id: '7412',
    tiktok_ad_id: '1800000000000000001'
  });

  assert.equal(origin.platform, PLATFORMS.organico);
  assert.equal(origin.channel, CHANNELS.whatsapp);
  assert.equal(origin.campaignId, null);
  assert.equal(origin.adId, null);
  assert.equal(origin.conflict, true);
  assert.equal(origin.secondary[0].platform, PLATFORMS.tiktok);
});

test('una ficha de una sola plataforma no queda marcada como conflicto', () => {
  const origin = leadOrigin({
    origin_platform: PLATFORMS.tiktok,
    tiktok_lead_id: '7412',
    tiktok_ad_id: '1800000000000000001',
    tiktok_campaign_name: 'TT | WA | Asesor | 27Oct',
    attribution_method: ATTRIBUTION_METHODS.platformLeadId,
    attribution_confidence: CONFIDENCE.alta
  });

  assert.equal(origin.platform, PLATFORMS.tiktok);
  assert.equal(origin.conflict, false);
  assert.deepEqual(origin.secondary, []);
  // Con qué evidencia se supo viaja en la respuesta: es lo que hace auditable
  // la hoja de marketing.
  assert.equal(origin.method, ATTRIBUTION_METHODS.platformLeadId);
  assert.equal(origin.confidence, CONFIDENCE.alta);
});

test('la ficha de Meta con formulario y clic elige el más antiguo de los dos y no marca conflicto de plataforma', () => {
  const origin = leadOrigin({
    origin_platform: PLATFORMS.meta,
    ctwa_clid: 'ARAbc123',
    ctwa_source_type: 'ad',
    ctwa_ad_id: '120210000000000009',
    ctwa_created_time: '2026-10-20T09:00:00Z',
    meta_leadgen_id: '99001',
    meta_ad_id: '120210000000000001',
    meta_created_time: '2026-10-25T10:00:00Z'
  });

  // Los dos son de Meta, así que el origen no está en disputa; pero el canal
  // sí, y gana el primero: la conversación de WhatsApp fue antes.
  assert.equal(origin.platform, PLATFORMS.meta);
  assert.equal(origin.channel, CHANNELS.whatsapp);
  assert.equal(origin.adId, '120210000000000009');
  assert.equal(origin.secondary.length, 1);
  assert.equal(origin.secondary[0].channel, CHANNELS.form);
});

// ───────────────────────────── Motivos del pendiente ────────────────────────

test('los motivos del pendiente son explícitos', () => {
  // Importan porque cada uno se arregla distinto: con varias candidatas hay
  // que elegir, y con una sola hay que confirmar que de verdad es esa.
  assert.equal(CONFLICT_REASONS.multiplePhoneMatch, 'multiple_phone_match');
  assert.equal(CONFLICT_REASONS.phoneOnlyMatch, 'phone_only_match');
  assert.equal(CONFLICT_REASONS.originConflict, 'origin_conflict');
});
