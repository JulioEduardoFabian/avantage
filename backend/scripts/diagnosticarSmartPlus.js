import 'dotenv/config';
import { db } from '../db/connection.js';
import { TikTokAdsService } from '../services/tiktokAdsService.js';
import { TikTokLeadsService } from '../services/tiktokLeadsService.js';
import { LEVELS, SPEND_LEVEL, creativeOf, levelLabel } from '../services/smartPlusLevel.js';
import { MINIMUM_ACCESS } from '../services/bridgeContract.js';

/**
 * ¿En qué nivel de la jerarquía de TikTok podemos atribuir de verdad?
 *
 * Solo LEE: no importa ningún lead, no escribe en ninguna tabla, no toca
 * ninguna campaña.
 *
 * Las campañas **Smart+** no tienen un anuncio y una pieza: tienen un anuncio
 * padre y, debajo, piezas creativas que TikTok combina y rota sola. Eso rompe el
 * supuesto sobre el que está construido el reporte —"un lead viene de un
 * anuncio, y ese anuncio tiene un gasto"— de una manera que no se ve, porque
 * cada lado de la división puede estar en un nivel distinto.
 *
 * Las tres preguntas que hay que contestar **antes** de creerle a un costo por
 * pieza, y que no se pueden contestar leyendo el código:
 *
 *  1. **¿Qué nivel devuelve la descarga de leads?** Si trae solo `ad_id`, de un
 *     lead de Smart+ no se puede decir qué pieza lo trajo.
 *  2. **¿Qué nivel devuelve el reporte de gasto?** Si el gasto está en el padre
 *     y las citas en la pieza, la división no da el costo de nada.
 *  3. **¿Coinciden los ids de los dos lados?** Dos endpoints de la misma API
 *     pueden devolver ids de niveles distintos con el mismo nombre de campo, y
 *     ahí el cruce "cierra" emparejando cosas que no son la misma.
 *
 * Lo que este script NO hace es inferir. Si la pieza no viene, la respuesta es
 * "desconocida": atribuir el lead al video que más impresiones tuvo ese día
 * produce un número que parece cierto, que nadie puede auditar, y del que cuelga
 * cortar una pieza que quizá era la que vendía.
 *
 * Uso:
 *   node backend/scripts/diagnosticarSmartPlus.js
 *
 * No imprime datos de contacto de nadie: de cada lead salen sus ids de
 * atribución, que es lo que se está diagnosticando.
 */

const ads = new TikTokAdsService();
const leads = new TikTokLeadsService({ ads, leadService: null });

const linea = (texto = '') => console.log(texto);

/** Las claves de un objeto que parecen un id de anuncio, pieza o video. */
function clavesDeJerarquia(objeto) {
  if (!objeto || typeof objeto !== 'object') return [];
  return Object.keys(objeto).filter((k) => /(^|_)(ad|adgroup|campaign|creative|video|material|parent|smart)(_|$)/i.test(k));
}

async function nivelDeLasMetricas(advertiserId) {
  linea('2. EL REPORTE DE GASTO');
  linea('─'.repeat(74));

  try {
    const anuncios = await ads.apiPaged('ad/get/', {
      advertiser_id: advertiserId,
      page_size: 10
    });

    if (!anuncios.length) {
      linea('   La cuenta no devolvió anuncios. Sin ellos no hay gasto que cruzar.');
      return;
    }

    const muestra = anuncios[0];
    linea(`   ${anuncios.length} anuncio(s) leídos. Claves de jerarquía en el primero:`);
    for (const clave of clavesDeJerarquia(muestra)) {
      const valor = muestra[clave];
      linea(`     ${clave.padEnd(28)} ${valor === null || valor === undefined ? '(vacío)' : String(valor).slice(0, 40)}`);
    }
    linea();

    /*
     * La pregunta concreta: ¿hay alguna clave que apunte a un nivel POR DEBAJO
     * del anuncio? Si no la hay, el gasto solo se puede repartir al padre, y eso
     * no es un problema que haya que resolver con más consultas: es el nivel en
     * el que la plataforma mide.
     */
    const hijas = clavesDeJerarquia(muestra).filter((k) => /creative|video|material/i.test(k));
    if (hijas.length) {
      linea(`   ✅ El anuncio expone ${hijas.length} clave(s) de nivel hijo: ${hijas.join(', ')}.`);
      linea('      Hay con qué intentar el cruce a nivel de pieza. Comprobá en el punto 3');
      linea('      que esos ids sean los MISMOS que trae la descarga de leads.');
    } else {
      linea('   ⚠️  El anuncio no expone ninguna clave de pieza ni de video.');
      linea(`      El gasto se mide en el nivel "${SPEND_LEVEL}" y ahí hay que reportar el`);
      linea('      costo por cita y por venta. La pieza queda desconocida — que es la');
      linea('      respuesta correcta, no una falta de datos que haya que rellenar.');
    }
  } catch (error) {
    linea(`   ❌ No se pudieron leer los anuncios: ${error.message}`);
    linea('      Sin esto no se puede saber en qué nivel está el gasto.');
  }
  linea();
}

async function nivelDeLaDescarga(advertiserId) {
  linea('1. LA DESCARGA DE LEADS');
  linea('─'.repeat(74));

  let formularios = [];
  try {
    const { forms, aviso } = await leads.listForms(advertiserId);
    formularios = forms;
    if (aviso) linea(`   ⚠️  ${aviso}`);
  } catch (error) {
    linea(`   ❌ No se pudieron listar los formularios: ${error.message}`);
    linea(`      ${MINIMUM_ACCESS['tiktok:lead_generation'].como}`);
    linea();
    return;
  }

  if (!formularios.length) {
    linea('   La cuenta no tiene formularios instantáneos, así que por este camino no');
    linea('   entra ningún lead y no hay nivel que diagnosticar.');
    linea();
    return;
  }

  linea(`   ${formularios.length} formulario(s). Se mira el primero que entregue leads.`);
  linea();

  for (const form of formularios.slice(0, 5)) {
    let filas = [];
    try {
      filas = await leads.fetchLeadsForDiagnosis(form.id, advertiserId);
    } catch (error) {
      linea(`   ${form.id}: ❌ ${error.message}`);
      continue;
    }

    if (!filas.length) {
      linea(`   ${form.id}: sin leads en el rango por defecto.`);
      continue;
    }

    const muestra = filas[0];
    linea(`   ${form.id} (${form.name || 'sin nombre'}): ${filas.length} lead(s).`);
    linea('   Lo que trae cada envío, de la jerarquía:');
    for (const clave of ['leadId', 'adId', 'adgroupId', 'campaignId', 'parentAdId', 'creativeId', 'videoId', 'videoName']) {
      const valor = muestra[clave];
      linea(`     ${clave.padEnd(16)} ${valor ? String(valor).slice(0, 40) : '(vacío)'}`);
    }
    linea();

    if (muestra.creativeId || muestra.videoId) {
      linea('   ✅ La descarga SÍ trae el nivel de pieza. Se puede atribuir a la');
      linea('      creatividad concreta.');
    } else if (muestra.adId || muestra.parentAdId) {
      linea('   ⚠️  La descarga trae solo el nivel de ANUNCIO. De un lead de Smart+ no');
      linea('      se puede decir qué pieza lo trajo, así que la pieza queda');
      linea('      desconocida y el costo se reporta al padre.');
      linea(`      ${MINIMUM_ACCESS['tiktok:smart_plus_creative'].como}`);
    } else {
      linea('   ❌ La descarga no trae ningún id de atribución: estos leads entran al');
      linea('      CRM sin poder acreditarse a ninguna campaña.');
    }
    linea();
    return;
  }

  linea('   Ninguno de los primeros formularios entregó leads para diagnosticar.');
  linea();
}

async function nivelDeLoGuardado() {
  linea('3. LO QUE YA ESTÁ GUARDADO EN EL CRM');
  linea('─'.repeat(74));

  const filas = await db('leads')
    .select(
      'id', 'tiktok_lead_id', 'tiktok_ad_id', 'tiktok_parent_ad_id',
      'tiktok_creative_id', 'tiktok_video_id', 'tiktok_video_name',
      'tiktok_ad_name', 'tiktok_creative_valid_from', 'tiktok_creative_valid_to',
      'tiktok_created_time', 'created_at'
    )
    .whereNotNull('tiktok_lead_id');

  if (!filas.length) {
    linea('   No hay ningún lead de TikTok en el CRM todavía.');
    linea();
    return;
  }

  const porNivel = { [LEVELS.pieza]: 0, [LEVELS.padre]: 0, [LEVELS.desconocido]: 0 };
  let conVigencia = 0;

  for (const fila of filas) {
    const creative = creativeOf(fila);
    porNivel[creative.level] += 1;
    if (creative.vigencia.desde || creative.vigencia.hasta) conVigencia += 1;
  }

  linea(`   ${filas.length} lead(s) de TikTok. En qué nivel se los puede atribuir:`);
  for (const [nivel, total] of Object.entries(porNivel)) {
    linea(`     ${levelLabel(nivel).padEnd(36)} ${String(total).padStart(5)}`);
  }
  linea(`     con vigencia de pieza guardada${' '.repeat(6)} ${String(conVigencia).padStart(5)}`);
  linea();

  if (porNivel[LEVELS.desconocido] > 0) {
    linea(`   ⚠️  ${porNivel[LEVELS.desconocido]} lead(s) sin ningún id de anuncio: están en el CRM y no`);
    linea('       figuran en ninguna fila del reporte por anuncio. Se arreglan con el');
    linea('       botón de completar datos, no volviendo a importar.');
  }
  if (porNivel[LEVELS.pieza] === 0 && porNivel[LEVELS.padre] > 0) {
    linea('   La pieza creativa no se conoce en ningún lead. Eso NO se rellena: el');
    linea('   costo por cita y por venta se reportan al anuncio padre, y la hoja de');
    linea('   marketing dice "pieza desconocida" en la columna del nivel.');
  }
  if (conVigencia === 0 && filas.length > 0) {
    linea('   Sin vigencia guardada no se puede comprobar que un lead caiga dentro del');
    linea('   período en que su pieza estaba entregando — es la forma más silenciosa');
    linea('   de que un costo por lead salga absurdo.');
  }
  linea();
}

async function main() {
  linea('═'.repeat(74));
  linea('  DIAGNÓSTICO DE LA JERARQUÍA SMART+ DE TIKTOK');
  linea('  Solo lectura: no importa leads ni escribe en ninguna tabla.');
  linea('═'.repeat(74));
  linea();

  let advertiser = null;
  try {
    advertiser = await ads.resolveAdvertiser();
    linea(`Cuenta publicitaria: ${advertiser.id}`);
    linea();
  } catch (error) {
    linea(`❌ No se pudo resolver la cuenta publicitaria: ${error.message}`);
    linea('   Sin ella no se puede preguntar nada a la API. Lo que YA está guardado');
    linea('   en el CRM se puede mirar igual, así que el punto 3 corre de todos modos.');
    linea();
  }

  if (advertiser) {
    await nivelDeLaDescarga(advertiser.id);
    await nivelDeLasMetricas(advertiser.id);
  }
  await nivelDeLoGuardado();

  linea('═'.repeat(74));
  linea('  La regla, por si el resultado invita a rellenar lo que falta: lo que no');
  linea('  se sabe se declara desconocido. Inferir la pieza por descarte produce un');
  linea('  número que parece cierto y que nadie puede auditar. El acceso que haría');
  linea('  falta está nombrado en MINIMUM_ACCESS (bridgeContract.js), y hasta que');
  linea('  esté no se amplía ningún otro permiso del token.');
  linea('═'.repeat(74));
}

main()
  .catch((error) => {
    console.error('❌ Error en el diagnóstico:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
