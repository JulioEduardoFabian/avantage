import 'dotenv/config';
import { db } from '../db/connection.js';
import { PHONE_MATCH_KEY_SQL, phoneMatchKey } from '../services/leadService.js';
import { leadOrigin } from '../services/leadOrigin.js';
import { buildStageResolver, loadFunnelStageIndex } from '../services/funnelStageLabel.js';
import { findOrphanConversations } from '../services/orphanConversationService.js';

/**
 * Hay conversación en la bandeja y el lead no aparece en ningún tablero. ¿Por
 * qué?
 *
 * Solo LEE: no crea fichas, no asigna a nadie, no escribe en ninguna tabla.
 *
 * El síntoma tiene **tres** causas distintas y en pantalla se ven igual —la
 * bandeja muestra el chat y el funnel no muestra nada—, pero se arreglan de
 * tres maneras:
 *
 *  1. **La ficha no existe.** Guardar el mensaje y abrir la ficha son dos
 *     pasos (`recordInboundMessage` y `findOrCreateFromWhatsApp`); si el
 *     segundo falla, el mensaje queda guardado y la ficha no se abre. El
 *     webhook ya respondió 200, así que no se reintenta y lo único que queda
 *     es una línea en un log que se rota. Es el mismo agujero por el que se
 *     perdió el 39% de los leads de formulario de Meta en septiembre de 2026,
 *     visto desde el lado de WhatsApp.
 *  2. **La ficha existe y no la ve quien mira.** Un lead sin responsable no lo
 *     ve nadie salvo quien reparte (`leads.manage_all`), y los leads que entran
 *     solos quedan sin responsable mientras el bot esté encendido: el reparto
 *     automático corre justamente cuando el bot está apagado. Acá no falta
 *     nada, falta asignarlo.
 *  3. **La ficha existe con otro teléfono.** El `wa_id` de una conversación
 *     puede no ser un número (los `PE.xxxx` de quien escribe desde un anuncio
 *     sin compartir su celular), y entonces no hay sufijo de 9 dígitos con el
 *     que cruzarlo contra la ficha.
 *
 * Sin separar las tres, "este lead no está" manda a revisar el webhook cuando
 * a veces lo único que hace falta es asignarlo.
 *
 * Uso:
 *   node backend/scripts/diagnosticarConversacionSinLead.js 931261225
 *   node backend/scripts/diagnosticarConversacionSinLead.js          (barrido)
 *
 * Sin argumento hace el barrido completo: todas las conversaciones de los
 * últimos 30 días que no tienen ficha. Es la pregunta que de verdad importa,
 * porque un contacto perdido no falla — simplemente no está, y nadie lo
 * extraña hasta que alguien lo busca por su nombre.
 */

const BUSQUEDA = process.argv[2] || null;
const DIAS = Number(process.argv[3] || 30);

const linea = (texto = '') => console.log(texto);
const titulo = (texto) => {
  linea();
  linea('='.repeat(78));
  linea(`  ${texto}`);
  linea('='.repeat(78));
};
const momento = (valor) => (valor ? new Date(valor).toISOString().replace('T', ' ').slice(0, 16) : '-');

/** Las fichas cuyo teléfono termina igual que este `wa_id`. */
async function fichasDe(waId) {
  const clave = phoneMatchKey(waId);
  const exacta = await db('leads').where('phone', waId);
  if (!clave) return { clave: null, fichas: exacta };

  const porSufijo = await db('leads').whereRaw(`${PHONE_MATCH_KEY_SQL} = ?`, [clave]);
  const vistas = new Set(exacta.map((l) => l.id));
  return { clave, fichas: [...exacta, ...porSufijo.filter((l) => !vistas.has(l.id))] };
}

/** La conversación de un `wa_id`: cuántos mensajes, desde cuándo, qué canal. */
async function conversacionDe(waId) {
  const [resumen] = await db('whatsapp_messages')
    .where({ wa_id: waId })
    .select(
      db.raw('COUNT(*) as total'),
      db.raw('MIN(received_at) as primero'),
      db.raw('MAX(received_at) as ultimo')
    );
  const inicial = await db('whatsapp_messages')
    .where({ wa_id: waId })
    .orderBy('received_at', 'asc')
    .select('channel', 'contact_name', 'direction')
    .first();
  return { ...resumen, canal: inicial?.channel || null, nombre: inicial?.contact_name || null };
}

async function explicarUno(waId, stageOf) {
  const conversacion = await conversacionDe(waId);
  if (!Number(conversacion.total)) {
    linea(`   No hay ninguna conversación con wa_id "${waId}".`);
    linea('   El identificador de la bandeja es el que manda: copialo de ahí tal cual.');
    return;
  }

  linea(`   Conversación "${waId}"`);
  linea(`      ${conversacion.total} mensaje(s) · del ${momento(conversacion.primero)}`
    + ` al ${momento(conversacion.ultimo)}`);
  linea(`      canal del primer mensaje: ${conversacion.canal || 'sin dato'}`
    + ` · perfil: ${conversacion.nombre || 'sin nombre'}`);

  const { clave, fichas } = await fichasDe(waId);
  linea(`      sufijo con el que se cruza: ${clave || 'NINGUNO (el wa_id no es un teléfono)'}`);

  if (!clave) {
    linea();
    linea('   CAUSA 3: el `wa_id` no es un número de teléfono.');
    linea('      Es un id de usuario de la empresa (los "PE.xxxx" de quien escribe desde');
    linea('      un anuncio sin compartir su celular). La ficha, si existe, guarda ESE');
    linea('      texto en `phone`, y no hay sufijo de 9 dígitos con el que emparejarla.');
  }

  if (!fichas.length) {
    linea();
    linea('   CAUSA 1: no hay ninguna ficha para este contacto.');
    linea('      El mensaje se guardó y la ficha no se abrió. Guardar el mensaje y crear');
    linea('      el lead son dos pasos del mismo webhook, que ya respondió 200: si el');
    linea('      segundo falla no se reintenta y queda este estado — chat sin ficha.');
    linea('      Se arregla dando de alta el lead a mano desde el Setter Funnel con ese');
    linea('      número; el historial de la conversación ya está y se le va a colgar solo.');
    return;
  }

  linea();
  linea(`   Hay ${fichas.length} ficha(s) para este contacto:`);
  for (const lead of fichas) {
    const origin = leadOrigin(lead);
    const etapa = stageOf(lead);
    linea(`      #${lead.id} ${lead.full_name || 'sin nombre'} · phone "${lead.phone}"`);
    linea(`         etapa ${etapa?.label || lead.status || 'sin etapa'}`
      + ` · ${origin.platform} / ${origin.channel}`
      + ` · creado ${momento(lead.created_at)}`);
    linea(`         responsable: ${lead.assigned_to || 'SIN RESPONSABLE'}`
      + ` (user_id ${lead.assigned_user_id ?? 'null'})`);

    if (!lead.assigned_user_id) {
      linea();
      linea('   CAUSA 2: la ficha existe pero no tiene responsable.');
      linea('      Un lead sin responsable solo lo ve quien reparte (`leads.manage_all`):');
      linea('      para todos los demás el tablero y el Reporte de Leads se ven vacíos, que');
      linea('      es exactamente este síntoma. No falta ningún dato — falta asignarlo.');
      linea('      Los leads que entran solos quedan así mientras el bot esté encendido: el');
      linea('      reparto automático corre cuando el bot está apagado, para no poner a una');
      linea('      persona a trabajar en paralelo la conversación que Avan está atendiendo.');
    }
  }
}

async function barrido() {
  /*
   * La detección vive en `orphanConversationService` y no acá: la usan este
   * diagnóstico y la recuperación, y con una copia en cada uno el día que una
   * cambie los dos scripts contestarían cosas distintas sobre los mismos
   * contactos.
   */
  const { total, orphans, borradas } = await findOrphanConversations({ days: DIAS });

  linea(`   Conversaciones de los últimos ${DIAS} días: ${total}`);
  linea(`   Sin ficha en el CRM: ${orphans.length}`);
  // Conversaciones cuya ficha alguien borró: no están perdidas, están sacadas
  // a propósito, y el barrido no las vuelve a abrir (ver `lead_deletions`).
  if (borradas) linea(`   Con la ficha borrada a mano: ${borradas} (no se recuperan)`);
  if (!orphans.length) {
    linea();
    linea('   Todas tienen su ficha. Si igual no aparecen en el tablero, el problema es de');
    linea('   visibilidad y no de alta: mirá la CAUSA 2 corriendo este script con el número.');
    return;
  }

  linea();
  linea('   Cada una es una persona que escribió y a la que nadie va a trabajar, porque no');
  linea('   figura en ningún tablero. Para abrirles la ficha con el historial y el anuncio');
  linea('   que las trajo: `node backend/scripts/recuperarConversacionesSinLead.js --aplicar`.');
  linea();
  for (const o of orphans) {
    linea(`   ${o.isPhone ? '               ' : '(no es teléfono)'} ${o.waId.padEnd(20)}`
      + ` ${String(o.messages).padStart(4)} msj`
      + ` · del ${momento(o.firstAt)} al ${momento(o.lastAt)}`
      + `${o.referral ? ' · con anuncio' : ''}`);
  }
}

async function main() {
  const stageOf = buildStageResolver(await loadFunnelStageIndex());

  if (BUSQUEDA) {
    titulo(`Conversación sin lead · "${BUSQUEDA}"`);

    /*
     * El número se escribe de muchas formas y el `wa_id` lleva el código de
     * país ("51931261225" para un celular que en pantalla se lee
     * "+51 931 261 225"). Se resuelve por sufijo ANTES de contestar: con la
     * comparación exacta, buscar el número tal como se ve en la bandeja
     * respondía "no hay conversación" justamente cuando sí la hay, que es el
     * peor diagnóstico posible.
     */
    const clave = phoneMatchKey(BUSQUEDA);
    let waIds = [BUSQUEDA];
    if (clave) {
      const parecidas = await db('whatsapp_messages')
        .whereRaw('RIGHT(wa_id, 9) = ?', [clave])
        .groupBy('wa_id')
        .select('wa_id');
      const otros = parecidas.map((p) => String(p.wa_id)).filter((w) => w !== BUSQUEDA);
      if (otros.length) {
        waIds = otros;
        linea(`   "${BUSQUEDA}" es el sufijo de ${otros.length} conversación(es): ${otros.join(', ')}`);
        linea();
      }
    }

    for (const waId of waIds) await explicarUno(waId, stageOf);
  } else {
    titulo(`Conversaciones sin ficha en el CRM · últimos ${DIAS} días`);
    await barrido();
  }

  titulo('La regla');
  linea('  Una conversación guardada no es un lead registrado: son dos escrituras del');
  linea('  mismo webhook y la segunda puede fallar sola. Y un lead registrado no es un');
  linea('  lead visible: sin responsable solo lo ve quien reparte. Las tres causas se');
  linea('  arreglan distinto, así que conviene saber cuál es antes de tocar nada.');
}

main()
  .catch((error) => {
    console.error('Error en el diagnóstico:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
