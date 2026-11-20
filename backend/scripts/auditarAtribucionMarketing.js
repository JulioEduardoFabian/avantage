import 'dotenv/config';
import { db } from '../db/connection.js';
import { leadOrigin, LEAD_ORIGIN_COLUMNS, PLATFORMS, bareSourceId } from '../services/leadOrigin.js';
import { levelLabel, LEVELS } from '../services/smartPlusLevel.js';
import { buildStageResolver, loadFunnelStageIndex } from '../services/funnelStageLabel.js';

/**
 * ¿Dice la base lo que dice la hoja de marketing?
 *
 * Solo LEE: no importa ningún lead, no escribe en ninguna tabla, no llama a
 * ninguna API de anuncios.
 *
 * Existe porque una discrepancia entre la hoja y el CRM tiene dos causas muy
 * distintas y en pantalla se ven igual: o la exportación publicó un dato
 * equivocado, o el importador de la hoja lo infirió por su cuenta. Este script
 * imprime **lo que la base contesta**, que es el lado del que se puede
 * responder acá: si acá dice "TikTok" y la hoja dice "Meta", el defecto está
 * del lado del importador y no hay nada que arreglar en el CRM.
 *
 * Las cinco preguntas, en el orden en que conviene leerlas:
 *
 *  1. ¿Está aplicada la migración del sello de origen? Sin ella no hay
 *     `origin_platform` ni evidencia, así que el arreglo del 01/11/2026 no
 *     está vigente y los leads anteriores siguen con la regla vieja.
 *  2. ¿Hay algún lead con campaña de TikTok y plataforma distinta de TikTok?
 *     Ese es el criterio de aceptación, comprobado contra la base.
 *  3. ¿Con qué evidencia se atribuyó cada lead? Un `phone_match` es una
 *     coincidencia, no una identificación.
 *  4. ¿En qué nivel de la jerarquía quedó cada lead de TikTok (padre, pieza,
 *     video)? La pieza desconocida se dice, no se infiere.
 *  5. ¿Qué dinero cuelga de cada lead del rango? Vendido, cobrado y pactado
 *     son tres cifras distintas, y confundirlas es lo que hace que un reporte
 *     muestre monto vendido con cero ventas cerradas.
 *
 * Uso:
 *   node backend/scripts/auditarAtribucionMarketing.js [desde] [hasta]
 *   node backend/scripts/auditarAtribucionMarketing.js 2026-10-27 2026-11-01
 *
 * No imprime teléfonos ni correos: de cada lead salen su id, su nombre y sus
 * ids de atribución, que es lo que se está auditando.
 */

const DESDE = process.argv[2] || '2026-10-27';
const HASTA = process.argv[3] || '2026-11-01';

const linea = (texto = '') => console.log(texto);
const titulo = (texto) => {
  linea();
  linea('='.repeat(78));
  linea(`  ${texto}`);
  linea('='.repeat(78));
};
const dia = (valor) => (valor ? new Date(valor).toISOString().slice(0, 10) : '-');
const money = (valor) => (valor === null || valor === undefined ? 'sin dato' : `S/ ${Number(valor).toFixed(2)}`);

const SELLO_COLUMNS = [
  'origin_platform',
  'attribution_method',
  'attribution_confidence',
  'tiktok_parent_ad_id',
  'tiktok_creative_id',
  'tiktok_video_id'
];

async function columnasPresentes() {
  const estado = {};
  for (const nombre of SELLO_COLUMNS) estado[nombre] = await db.schema.hasColumn('leads', nombre);
  const conflictos = await db.schema.hasTable('attribution_conflicts');
  return { estado, conflictos };
}

async function main() {
  titulo(`Atribución de marketing · leads del ${DESDE} al ${HASTA}`);

  // -- 1. ¿Está vigente el arreglo? -----------------------------------------
  const { estado, conflictos } = await columnasPresentes();
  const faltan = Object.entries(estado).filter(([, hay]) => !hay).map(([nombre]) => nombre);
  linea();
  linea('1) El sello de origen y la evidencia');
  if (faltan.length) {
    linea(`   FALTAN columnas: ${faltan.join(', ')}`);
    linea('      La migración del sello (20261125000000) y/o la de Smart+ (20261127000000)');
    linea('      NO están aplicadas acá, así que el arreglo del 01/11/2026 no está vigente:');
    linea('      el teléfono todavía puede escribir atribución y `leadOrigin()` no tiene');
    linea('      sello con el que desempatar. Corré `npm run migrate` antes de leer el resto.');
  } else {
    linea('   OK: columnas del sello y de Smart+ presentes.');
  }
  linea(`   Tabla attribution_conflicts: ${conflictos ? 'existe' : 'NO existe'}`);

  // -- Los leads del rango ---------------------------------------------------
  // Si la migración no corrió, se piden solo las columnas que de verdad hay:
  // `leadOrigin()` lee las ausentes como `undefined`, que es lo que necesita
  // para no inventar nada.
  const columnas = [];
  for (const columna of LEAD_ORIGIN_COLUMNS) {
    if (estado[columna] === false) continue;
    if (await db.schema.hasColumn('leads', columna)) columnas.push(columna);
  }

  const leads = await db('leads')
    .select('id', 'full_name', 'status', 'total_amount', 'deal_cancelled_at', ...columnas)
    .whereRaw('DATE(created_at) >= ?', [DESDE])
    .whereRaw('DATE(created_at) <= ?', [HASTA])
    .orderBy('id', 'asc');

  linea();
  linea(`   Leads creados en el rango: ${leads.length}`);

  const resueltos = leads.map((lead) => ({ lead, origin: leadOrigin(lead) }));

  // -- 2. Criterio de aceptación: TikTok nunca marcado como Meta ------------
  titulo('2) ¿Alguna fila con campaña de TikTok dice Plataforma = Meta?');
  const malMarcados = resueltos.filter(({ lead, origin }) => {
    const esDeTikTok = lead.tiktok_campaign_id || lead.tiktok_ad_id || lead.tiktok_lead_id;
    return esDeTikTok && origin.platform !== PLATFORMS.tiktok;
  });
  if (!malMarcados.length) {
    linea('   OK: la base no marca como Meta ningún lead con atribución de TikTok.');
    linea('      Si la hoja "Embudo CRM" los muestra como Meta, el dato lo pone el');
    linea('      importador: el CRM no exporta ninguna hoja con ese nombre, y su única');
    linea('      plataforma por defecto es "Otro" (PLATFORM_FALLBACK, campaignExportService).');
  } else {
    linea(`   ${malMarcados.length} lead(s) con atribución de TikTok y otra plataforma de origen:`);
    for (const { lead, origin } of malMarcados) {
      linea(`      #${lead.id} ${lead.full_name} -> sello ${origin.platform}`
        + ` · campaña TT ${lead.tiktok_campaign_name || lead.tiktok_campaign_id || 'sin dato'}`
        + ` · secundaria: ${origin.secondary.map((s) => s.platform).join(', ') || '-'}`);
    }
    linea('      Un sello distinto NO es un error por sí mismo: significa que esta persona');
    linea('      vino de otra plataforma y además llenó el formulario de TikTok (eso sale en');
    linea('      "Plataforma secundaria"). Lo que hay que revisar es con qué evidencia.');
  }

  // -- 3. Con qué evidencia -------------------------------------------------
  titulo('3) Con qué evidencia se atribuyó cada lead');
  const porMetodo = new Map();
  for (const { origin } of resueltos) {
    const clave = `${origin.method || 'sin método'} / ${origin.confidence || 'sin confianza'}`;
    porMetodo.set(clave, (porMetodo.get(clave) || 0) + 1);
  }
  for (const [clave, total] of [...porMetodo].sort((a, b) => b[1] - a[1])) {
    linea(`   ${String(total).padStart(4)}  ${clave}`);
  }

  const debiles = resueltos.filter(({ origin }) => origin.confidence === 'baja' || (origin.paid && !origin.method));
  if (debiles.length) {
    linea();
    linea(`   ${debiles.length} lead(s) pagados sin evidencia fuerte (coincidencia, no identificación):`);
    for (const { lead, origin } of debiles) {
      linea(`      #${lead.id} ${lead.full_name} · ${origin.platform}`
        + ` · ${origin.method || 'sin método'}`
        + ` · campaña ${origin.campaignName || origin.campaignId || 'sin dato'}`);
    }
    linea('      Según la regla vigente tienen que quedar como origen desconocido y su caso');
    linea('      anotado en attribution_conflicts, no acreditados a la plataforma.');
  }

  if (conflictos) {
    const casos = await db('attribution_conflicts')
      .select('platform', 'reason', 'resolved_at')
      .whereRaw('DATE(detected_at) >= ?', [DESDE]);
    const abiertos = casos.filter((c) => !c.resolved_at);
    linea();
    linea(`   Conflictos anotados desde ${DESDE}: ${casos.length} (${abiertos.length} sin resolver)`);
    const porRazon = new Map();
    for (const caso of abiertos) porRazon.set(caso.reason, (porRazon.get(caso.reason) || 0) + 1);
    for (const [razon, total] of porRazon) linea(`      ${String(total).padStart(4)}  ${razon}`);
  }

  // -- 4. Nivel de anuncio (Smart+) -----------------------------------------
  titulo('4) Nivel de atribución de los leads de TikTok');
  const deTikTok = resueltos.filter(({ origin }) => origin.platform === PLATFORMS.tiktok);
  if (!deTikTok.length) {
    linea('   No hay leads de TikTok en el rango.');
  } else {
    const porNivel = new Map();
    for (const { origin } of deTikTok) {
      const nivel = origin.creative?.level || LEVELS.desconocido;
      porNivel.set(nivel, (porNivel.get(nivel) || 0) + 1);
    }
    for (const [nivel, total] of porNivel) linea(`   ${String(total).padStart(4)}  ${levelLabel(nivel)}`);
    linea();
    for (const { lead, origin } of deTikTok) {
      const creative = origin.creative || {};
      linea(`   #${lead.id} ${lead.full_name}`);
      linea(`      anuncio ${bareSourceId(origin.adId) || 'sin dato'}`
        + ` · padre ${creative.parentAdId || 'sin dato'}`
        + ` · pieza ${creative.creativeId || 'desconocida'}`
        + ` · video ${creative.videoId || 'desconocido'} (${creative.videoName || 'sin nombre'})`);
      linea(`      campaña ${origin.campaignName || origin.campaignId || 'sin dato'}`
        + ` · atribuir con ${creative.attributionAdId || 'sin dato'}`
        + ` · ${levelLabel(creative.level)}`);
    }
  }

  // -- 5. Sin campaña asignada ----------------------------------------------
  /*
   * "Sin campaña" son DOS cosas y hay que separarlas, porque se arreglan
   * distinto y una de las dos no está rota.
   *
   * `leadOrigin()` es puro y no consulta tablas, así que de un clic que abre
   * WhatsApp devuelve el id del anuncio y `campaignName: null`: la campaña de
   * ese anuncio la resuelve el reporte cruzando `ctwa_ad_id` contra
   * `campaign_ads`. Contarlos como "sin campaña" infla el problema — en el
   * corte del 27/10 al 02/11 daba 76 donde marketing veía 13 — y manda a
   * investigar 63 leads que tienen su anuncio perfectamente identificado.
   *
   * El que de verdad no tiene de dónde agarrarse es el que no trae NINGÚN id
   * de anuncio: ese es el que no va a aparecer en ninguna campaña.
   */
  titulo('5) Leads sin campaña asignada, y qué plataforma les corresponde');
  const sinCampana = resueltos.filter(({ origin }) => !origin.campaignId && !origin.campaignName);
  const conAnuncio = sinCampana.filter(({ origin }) => origin.adId);
  const huerfanos = sinCampana.filter(({ origin }) => !origin.adId);

  linea(`   ${huerfanos.length} lead(s) de ${leads.length} sin ningún id de anuncio:`);
  linea('   esos son los que no van a figurar en ninguna campaña.');
  if (conAnuncio.length) {
    linea();
    linea(`   (Otros ${conAnuncio.length} traen id de anuncio pero su campaña no se resuelve acá:`);
    linea('    son clics que abren WhatsApp, y el reporte les pone la campaña cruzando');
    linea('    `ctwa_ad_id` contra `campaign_ads`. No son un problema y no se listan.)');
  }
  linea();
  linea('   "Plataforma = Meta" sin anuncio es legítimo solo si el `source` dice "... Ads"');
  linea('   (se sabe la plataforma, no el anuncio). Cualquier otro caso es "Otro", y el');
  linea('   que entró por WhatsApp sin referral de anuncio es "Orgánico" — que NO es lo');
  linea('   mismo que "sin plataforma": se sabe por dónde llegó, no hay anuncio detrás.');
  linea();
  for (const { lead, origin } of huerfanos) {
    const sospechoso = origin.platform === PLATFORMS.meta
      && !lead.ctwa_clid
      && !/ ads|meta ads/i.test(String(lead.source || ''));
    linea(`   ${sospechoso ? '(!)' : '   '} #${lead.id} ${lead.full_name}`
      + ` · ${origin.platform} / ${origin.channel}`
      + ` · source "${lead.source || '-'}"`
      + ` · ${origin.method || 'sin método'}`
      + ` · ingresó ${dia(origin.enteredAt)}`);
  }

  // -- Dinero del rango ------------------------------------------------------
  titulo('Dinero de estos leads: vendido, cobrado y pactado son tres cifras');
  const ids = leads.map((lead) => lead.id);
  if (!ids.length) {
    linea('   Sin leads en el rango.');
    return;
  }

  const cuotas = await db('finance_income')
    .select('lead_id', 'code', 'estado', 'monto', 'fecha', 'due_date')
    .whereIn('lead_id', ids)
    .orderBy(['lead_id', 'due_date']);
  const proyectos = await db('projects').select('lead_id', 'created_at').whereIn('lead_id', ids);
  const proyectoDe = new Map(proyectos.map((p) => [p.lead_id, p.created_at]));

  /*
   * Las claves de las columnas las genera el servidor (`col_mtc9ogeu_kpk`), así
   * que una etapa impresa en crudo no le dice nada a nadie. Se nombra con el
   * mismo resolvedor que el tablero y la bandeja de WhatsApp.
   */
  const stageOf = buildStageResolver(await loadFunnelStageIndex());

  const conDinero = resueltos.filter(({ lead }) => Number(lead.total_amount) > 0
    || cuotas.some((c) => c.lead_id === lead.id)
    || proyectoDe.has(lead.id));

  if (!conDinero.length) linea('   Ningún lead del rango tiene dinero registrado.');

  for (const { lead, origin } of conDinero) {
    const suyas = cuotas.filter((c) => c.lead_id === lead.id);
    const suma = (estadoCuota) => suyas
      .filter((c) => c.estado === estadoCuota)
      .reduce((total, c) => total + Number(c.monto), 0);

    linea();
    linea(`   #${lead.id} ${lead.full_name} · ${origin.platform}`
      + ` · campaña ${origin.campaignName || origin.campaignId || 'sin campaña'}`);
    const etapa = stageOf(lead);
    linea(`      etapa ${etapa?.label || lead.status} · proyecto abierto ${dia(proyectoDe.get(lead.id))}`
      + `${lead.deal_cancelled_at ? ` · VENTA NO CONCRETADA ${dia(lead.deal_cancelled_at)}` : ''}`);
    linea(`      precio pactado ${money(lead.total_amount)}`
      + ` · cobrado (verificado) ${money(suma('verificado'))}`
      + ` · por verificar ${money(suma('pagado'))}`
      + ` · por cobrar ${money(suma('pendiente'))}`);
    for (const cuota of suyas) {
      linea(`         ${cuota.code || 'sin código'} · ${cuota.estado} · ${money(cuota.monto)}`
        + ` · vence ${dia(cuota.due_date)} · entró ${dia(cuota.fecha)}`);
    }
  }

  linea();
  linea('   "Monto vendido" con cero ventas cerradas es el precio pactado de un lead que');
  linea('   todavía no se ganó: cuota pactada, no venta. "Cobrado" es solo lo verificado.');

  titulo('La regla, por si el resultado invita a rellenar lo que falta');
  linea('  Coincidir no es identificar. El teléfono sirve para no duplicar a una persona;');
  linea('  no para decir de qué anuncio salió. Lo que no se sabe se cuenta como desconocido:');
  linea('  un origen inventado se cuenta como verdad, y de esos números cuelga el presupuesto.');
}

main()
  .catch((error) => {
    console.error('Error en la auditoría:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
