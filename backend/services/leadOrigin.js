/**
 * De dónde salió un lead, contestado en UN solo sitio.
 *
 * La pregunta parece trivial y no lo es: la respuesta vive repartida en tres
 * juegos de columnas que escriben tres caminos distintos (el formulario de
 * Meta, el formulario de TikTok y el clic que abre WhatsApp), más el texto
 * libre de `leads.source` para todo lo que no viene de un anuncio. Cada
 * pantalla que lo resolvía por su cuenta llegaba a una respuesta distinta, y
 * así es como la exportación de marketing acabó marcando como "Meta" hasta los
 * leads de TikTok.
 *
 * Es puro y no toca la base: recibe la fila del lead y devuelve su origen
 * normalizado. Lo que no se sabe viaja en `null` y la pantalla escribe "sin
 * dato" — nunca se rellena con un valor plausible, que es exactamente el error
 * que hacía pasar por Meta lo que no era de Meta.
 *
 * **Coincidir no es identificar.** El origen es un sello que se escribe una
 * vez (`leads.origin_platform`) y no la última columna que alguien rellenó:
 * una ficha que ya era de Meta no se vuelve de TikTok porque una conciliación
 * encontrara un teléfono parecido. Lo que llega después se informa aparte, y
 * con qué evidencia se supo cada cosa vive en `attributionEvidence.js`.
 *
 * Los IDs se devuelven como **texto**: son números de 15 a 17 dígitos y
 * cualquier paso por `Number` les cambia los últimos dígitos o los convierte
 * en notación científica, con lo que el cruce contra el Administrador de
 * anuncios deja de cerrar.
 */

import { SMART_PLUS_COLUMNS, creativeOf } from './smartPlusLevel.js';

/** Los cinco valores de "Plataforma" que lee la hoja de marketing. */
export const PLATFORMS = {
  meta: 'Meta',
  tiktok: 'TikTok',
  organico: 'Orgánico',
  referido: 'Referido',
  otro: 'Otro'
};

/** Los tres valores de "Canal". */
export const CHANNELS = {
  form: 'Formulario',
  whatsapp: 'WhatsApp',
  dm: 'Mensaje directo'
};

const text = (value) => {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out ? out : null;
};

const flat = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Facebook o Instagram, que es lo que distingue el campo `platform` del lead de
 * Meta ("fb" / "ig"). No es la plataforma de la hoja —esa es "Meta" en los dos
 * casos— sino la red donde la persona vio el anuncio, y se guarda porque es lo
 * que permite comparar el rendimiento de las dos.
 */
export function metaNetwork(value) {
  const key = flat(value);
  if (!key) return null;
  if (key === 'ig' || key.includes('instagram')) return 'Instagram';
  if (key === 'fb' || key.includes('facebook')) return 'Facebook';
  if (key.includes('messenger')) return 'Messenger';
  if (key.includes('audience')) return 'Audience Network';
  return null;
}

/**
 * Plataforma y canal de lo que NO vino de un anuncio: ahí lo único que hay es
 * el texto de `leads.source`, que lo escribe cada camino de alta (el webhook
 * de WhatsApp pone "WhatsApp Directo", el evaluador "Chatbot Web", el alta
 * manual lo que eligió quien cargó la ficha).
 *
 * "Meta" NO es el valor por defecto de nada: lo que no se reconoce es "Otro",
 * porque un lead cuyo origen no se sabe tiene que poder contarse como tal en
 * vez de abultar la cuenta de una plataforma que quizá no lo trajo.
 */
function fromSourceText(source) {
  const key = flat(source);

  if (!key) return { platform: PLATFORMS.otro, channel: CHANNELS.dm, network: null };

  if (key.includes('tiktok')) return { platform: PLATFORMS.tiktok, channel: CHANNELS.dm, network: 'TikTok' };
  if (key.includes('referid') || key.includes('recomendac')) {
    return { platform: PLATFORMS.referido, channel: CHANNELS.dm, network: null };
  }
  // Un lead cuyo `source` dice "Facebook Ads" o "Instagram Ads" pero que no
  // tiene una sola columna de atribución es un lead de Meta sin anuncio
  // identificado: la plataforma se sabe, el anuncio no. Decir "Orgánico"
  // sería tan falso como inventarle una campaña.
  if (key.includes(' ads') || key.includes('meta ads')) {
    return { platform: PLATFORMS.meta, channel: CHANNELS.form, network: metaNetwork(key) };
  }
  if (key.includes('whatsapp')) return { platform: PLATFORMS.organico, channel: CHANNELS.whatsapp, network: null };
  if (key.includes('instagram') || key.includes('messenger') || key.includes('facebook')) {
    return { platform: PLATFORMS.organico, channel: CHANNELS.dm, network: metaNetwork(key) };
  }
  // El evaluador público de viabilidad y el formulario de la web.
  if (key.includes('chatbot') || key.includes('web') || key.includes('evaluador') || key.includes('formulario')) {
    return { platform: PLATFORMS.organico, channel: CHANNELS.form, network: null };
  }
  if (key.includes('presencial') || key.includes('base fria') || key.includes('llamada') || key.includes('manual')) {
    return { platform: PLATFORMS.organico, channel: CHANNELS.dm, network: null };
  }

  return { platform: PLATFORMS.otro, channel: CHANNELS.dm, network: null };
}

/**
 * Los tres bloques de columnas que puede tener una ficha, cada uno con la
 * fecha de SU evidencia. Devuelven `null` cuando esa plataforma no dejó nada.
 *
 * Están separados porque una misma ficha puede tener más de uno —el contacto
 * que llenó el formulario de TikTok y además escribió por WhatsApp desde un
 * anuncio de Meta es el caso normal mientras las dos plataformas corren sobre
 * el mismo público— y entonces hay que elegir cuál es el ORIGEN y cuál llegó
 * después, en vez de que gane el que esté más arriba en el archivo.
 */
function tiktokBlock(lead) {
  const adId = text(lead.tiktok_ad_id);
  const leadId = text(lead.tiktok_lead_id);
  if (!adId && !leadId) return null;

  return {
    platform: PLATFORMS.tiktok,
    time: lead.tiktok_created_time || null,
    detail: {
      platform: PLATFORMS.tiktok,
      network: 'TikTok',
      channel: CHANNELS.form,
      paid: !!adId,
      campaignId: text(lead.tiktok_campaign_id),
      campaignName: text(lead.tiktok_campaign_name),
      adsetId: text(lead.tiktok_adgroup_id),
      adsetName: text(lead.tiktok_adgroup_name),
      adId,
      adName: text(lead.tiktok_ad_name),
      formId: text(lead.tiktok_page_id),
      headline: null,
      platformLeadId: leadId,
      enteredAt: lead.tiktok_created_time || lead.created_at || null,
      /*
       * La jerarquía de Smart+. En una campaña Smart+ el gasto se reporta al
       * anuncio PADRE y la pieza creativa puede no venir: `creative.pieceKnown`
       * dice si se sabe, y `attributionAdId` con qué id hay que atribuir — la
       * pieza cuando se conoce, el padre cuando no. Nunca un id elegido entre
       * candidatos (ver `smartPlusLevel.js`).
       */
      creative: creativeOf(lead)
    }
  };
}

function metaFormBlock(lead) {
  const adId = text(lead.meta_ad_id);
  const leadgenId = text(lead.meta_leadgen_id);
  if (!adId && !leadgenId && !text(lead.meta_form_id)) return null;

  return {
    platform: PLATFORMS.meta,
    time: lead.meta_created_time || null,
    detail: {
      platform: PLATFORMS.meta,
      network: metaNetwork(lead.meta_platform),
      channel: CHANNELS.form,
      paid: !!adId,
      campaignId: text(lead.meta_campaign_id),
      campaignName: text(lead.meta_campaign_name),
      adsetId: text(lead.meta_adset_id),
      adsetName: text(lead.meta_adset_name),
      adId,
      adName: text(lead.meta_ad_name),
      formId: text(lead.meta_form_id),
      headline: null,
      platformLeadId: leadgenId,
      enteredAt: lead.meta_created_time || lead.created_at || null
    }
  };
}

function ctwaBlock(lead) {
  const adId = text(lead.ctwa_ad_id);
  const clid = text(lead.ctwa_clid);
  const type = flat(lead.ctwa_source_type);
  if (!adId && !clid && !type) return null;

  return {
    platform: PLATFORMS.meta,
    time: lead.ctwa_created_time || null,
    detail: {
      platform: PLATFORMS.meta,
      network: null,
      channel: CHANNELS.whatsapp,
      // Una publicación orgánica también manda `referral`, y ahí no hay
      // campaña que pedir ni costo que repartir.
      paid: type === 'ad' && !!adId,
      campaignId: null,
      campaignName: null,
      adsetId: null,
      adsetName: null,
      adId: type === 'post' ? null : adId,
      adName: null,
      formId: null,
      headline: text(lead.ctwa_headline),
      // El click id es con lo que Meta reconoce esta conversación: hace el
      // papel del `leadgen_id` de un formulario.
      platformLeadId: clid,
      enteredAt: lead.ctwa_created_time || lead.created_at || null
    }
  };
}

/** El bloque más antiguo, y los que no quedaron elegidos. */
function pickEarliest(blocks) {
  const stamp = (block) => {
    const t = new Date(block.time || 0).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  // Sin fecha de evidencia no se puede comparar, así que esos van al final: un
  // bloque fechado es mejor candidato a "fue primero" que uno sin fecha.
  const sorted = [...blocks].sort((a, b) => {
    const ta = stamp(a);
    const tb = stamp(b);
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return ta - tb;
  });
  return { chosen: sorted[0], rest: sorted.slice(1) };
}

/** Cómo se nombra en `secondary` lo que llegó después del origen. */
function secondaryOf(block) {
  return {
    platform: block.detail.platform,
    channel: block.detail.channel,
    adId: block.detail.adId,
    campaignId: block.detail.campaignId,
    platformLeadId: block.detail.platformLeadId,
    enteredAt: block.detail.enteredAt
  };
}

/**
 * El origen de un lead, normalizado.
 *
 * **El origen es el primero, no el último que escribió una columna.** Hasta el
 * 01/11/2026 el orden era de certeza por plataforma —TikTok, después el
 * formulario de Meta, después el clic que abre WhatsApp— y eso tenía una
 * consecuencia que nadie quería: a una ficha de Meta a la que después se le
 * colgaba un formulario de TikTok le ganaba la columna nueva, y pasaba a ser
 * TikTok en todas las hojas de marketing. Con las dos plataformas corriendo
 * sobre el mismo público esa ficha no es el caso raro, es el normal; y como la
 * importación de TikTok emparejaba por los últimos 9 dígitos del teléfono y la
 * conciliación diaria corre sola, eso se escribía sin que nadie lo mirara.
 *
 * Ahora manda `leads.origin_platform`, que se escribe UNA vez cuando la ficha
 * nace y no se vuelve a tocar — un sello, como `sales_funnel_at` o
 * `setter_user_id`. Lo que llegue después se informa aparte en `secondary`,
 * así se puede ver sin que reescriba la historia, y `conflict` marca la ficha
 * que tiene más de una plataforma encima, que es justo la que hay que revisar.
 *
 * Sin sello —las fichas anteriores a la migración— se desempata por la fecha
 * de la evidencia: gana el bloque cuyo `*_created_time` sea más antiguo, que
 * es lo más cerca de cuál fue primero que se puede llegar sin inventar nada.
 *
 * `method`, `confidence` y `reconciledAt` viajan siempre: que un lead sea de
 * TikTok sin decir cómo se supo es precisamente el dato que no se puede
 * auditar después (ver `attributionEvidence.js`).
 *
 * `paid` es "¿esto salió de un anuncio?" y de él cuelga qué columnas de la hoja
 * son obligatorias. Un clic desde una PUBLICACIÓN de Meta (`source_type:
 * 'post'`) es de Meta y no es pagado: tiene plataforma y no tiene campaña.
 */
export function leadOrigin(lead = {}) {
  const evidence = {
    method: text(lead.attribution_method),
    confidence: text(lead.attribution_confidence),
    reconciledAt: lead.attribution_reconciled_at || null
  };

  const blocks = [tiktokBlock(lead), metaFormBlock(lead), ctwaBlock(lead)].filter(Boolean);
  const sealed = text(lead.origin_platform);

  if (blocks.length) {
    /*
     * Con el sello puesto, el origen es el que dice el sello y solo se elige
     * entre SUS bloques (una ficha de Meta puede tener el formulario y el clic
     * de WhatsApp, y ahí gana el más antiguo de los dos). Los bloques de otra
     * plataforma quedan en `secondary` pase lo que pase: son envíos que de
     * verdad ocurrieron, pero no son de dónde salió esta persona.
     */
    const propios = sealed ? blocks.filter((b) => b.platform === sealed) : blocks;
    const ajenos = sealed ? blocks.filter((b) => b.platform !== sealed) : [];

    if (propios.length) {
      const { chosen, rest } = pickEarliest(propios);
      const secondary = [...rest, ...ajenos].map(secondaryOf);
      return { ...chosen.detail, ...evidence, secondary, conflict: secondary.length > 0 };
    }

    /*
     * El sello dice una plataforma que no tiene columnas propias —un lead
     * orgánico, uno referido, uno cargado a mano— y encima tiene atribución de
     * otra. El origen sigue siendo el sellado y NO se lo reemplaza por el
     * bloque que apareció después: eso es exactamente el rellenado por
     * descarte. Lo de la otra plataforma se informa en `secondary`.
     */
    const guess = fromSourceText(lead.source);
    return {
      platform: sealed,
      network: guess.platform === sealed ? guess.network : null,
      channel: guess.platform === sealed ? guess.channel : CHANNELS.dm,
      paid: false,
      campaignId: null,
      campaignName: null,
      adsetId: null,
      adsetName: null,
      adId: null,
      adName: null,
      formId: null,
      headline: null,
      platformLeadId: null,
      enteredAt: lead.created_at || null,
      ...evidence,
      secondary: blocks.map(secondaryOf),
      conflict: true
    };
  }

  const guess = fromSourceText(lead.source);
  return {
    // El sello manda también acá: una ficha sellada como "Referido" no vuelve
    // a adivinarse desde el texto de `source`, que alguien pudo editar.
    platform: sealed || guess.platform,
    network: guess.network,
    channel: guess.channel,
    paid: false,
    campaignId: null,
    campaignName: null,
    adsetId: null,
    adsetName: null,
    adId: null,
    adName: null,
    formId: null,
    headline: null,
    platformLeadId: null,
    enteredAt: lead.created_at || null,
    ...evidence,
    secondary: [],
    conflict: false
  };
}

/**
 * El "ID de origen" con el que se enlaza todo, igual que lo escribe la
 * plataforma: dígitos y nada más.
 *
 * Dentro del CRM el id de un anuncio de TikTok viaja con el prefijo `tt:`
 * porque `campaign_ads.ad_source_id` es ÚNICA y la comparten las dos
 * plataformas (los dos ids son numéricos y podrían chocar). Ese prefijo es un
 * detalle interno: en la hoja de marketing tiene que salir el id pelado, que
 * es lo que se compara dígito por dígito contra el Ads Manager.
 */
export function bareSourceId(sourceId) {
  const value = text(sourceId);
  if (!value) return null;
  return value.startsWith('tt:') ? value.slice(3) : value;
}

/**
 * El `referral` del primer mensaje de WhatsApp, convertido a las columnas del
 * lead.
 *
 * Meta manda ese objeto cuando la conversación nació de un clic en un anuncio
 * (o en una publicación) y lo reenvían tanto el webhook nativo como YCloud,
 * con las claves en snake_case. Se admiten las dos grafías porque el proveedor
 * normaliza algunas: lo que no se puede es perder el dato por el nombre de la
 * clave.
 *
 * Devuelve `{}` cuando no hay nada que guardar, para poder esparcirlo sobre el
 * alta sin ensuciarla con nulos.
 */
export function ctwaAttribution(referral, { receivedAt = null } = {}) {
  if (!referral || typeof referral !== 'object') return {};

  const sourceType = text(referral.source_type ?? referral.sourceType);
  const sourceId = text(referral.source_id ?? referral.sourceId);
  const clid = text(referral.ctwa_clid ?? referral.ctwaClid);
  if (!sourceId && !clid) return {};

  return {
    // Solo un anuncio tiene id de anuncio: el `source_id` de una publicación
    // orgánica es el id del post, y escribirlo acá lo haría pasar por pagado.
    ctwaAdId: sourceType === 'ad' && sourceId ? sourceId.slice(0, 40) : null,
    ctwaClid: clid ? clid.slice(0, 255) : null,
    ctwaSourceType: sourceType ? sourceType.slice(0, 20) : null,
    ctwaHeadline: text(referral.headline)?.slice(0, 255) || null,
    ctwaCreatedTime: receivedAt || new Date()
  };
}

/**
 * ¿Este lead no dejó un solo dato más que su número?
 *
 * Meta cuenta como conversación iniciada cualquier clic que abre el chat, así
 * que su total siempre va a ser mayor que el del CRM (624 contra 382 en el
 * corte del 31/10/2026). Parte de esa diferencia es gente que escribió "hola"
 * y nunca contestó nada, y parte es pérdida real — sin separarlas, la brecha
 * no se puede explicar ni corregir.
 *
 * El criterio es "no hay nada que trabajar": sin nombre propio (el marcador
 * genérico que le pone el bot a un contacto sin perfil no cuenta), sin correo,
 * sin documento, sin universidad y sin informe de viabilidad.
 */
export function onlyGreeted(lead = {}, { genericName = null } = {}) {
  const name = text(lead.full_name);
  const hasName = !!name && (!genericName || name !== genericName);
  const hasScore = lead.overall_viability_score !== null && lead.overall_viability_score !== undefined;

  return !hasName
    && !text(lead.email)
    && !text(lead.dni)
    && !text(lead.university)
    && !hasScore;
}

/** Las columnas de `leads` que hacen falta para resolver el origen. */
export const LEAD_ORIGIN_COLUMNS = [
  'source',
  'created_at',
  // El sello del origen y con qué evidencia se lo supo: sin estas cuatro,
  // `leadOrigin()` vuelve a desempatar por fecha y la hoja no puede decir de
  // dónde salió la respuesta (ver `attributionEvidence.js`).
  'origin_platform',
  'attribution_method', 'attribution_confidence', 'attribution_reconciled_at',
  'meta_leadgen_id', 'meta_form_id', 'meta_ad_id', 'meta_adset_id', 'meta_campaign_id',
  'meta_platform', 'meta_created_time',
  'meta_ad_name', 'meta_adset_name', 'meta_campaign_name',
  'tiktok_lead_id', 'tiktok_page_id', 'tiktok_ad_id', 'tiktok_adgroup_id', 'tiktok_campaign_id',
  'tiktok_created_time',
  'tiktok_ad_name', 'tiktok_adgroup_name', 'tiktok_campaign_name',
  // La jerarquía de Smart+: el padre, la pieza, el video y su vigencia.
  ...SMART_PLUS_COLUMNS,
  'ctwa_ad_id', 'ctwa_clid', 'ctwa_source_type', 'ctwa_headline', 'ctwa_created_time'
];
