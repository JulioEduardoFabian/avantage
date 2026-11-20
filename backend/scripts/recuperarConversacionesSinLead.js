import 'dotenv/config';
import { db } from '../db/connection.js';
import { LeadService } from '../services/leadService.js';
import { leadOrigin } from '../services/leadOrigin.js';
import {
  DEFAULT_WINDOW_DAYS,
  adoptOrphanConversation,
  findOrphanConversations
} from '../services/orphanConversationService.js';

/**
 * Le abre la ficha a las conversaciones que se quedaron sin ella.
 *
 * Sin `--aplicar` **solo reporta**. Es la misma regla que las dos
 * conciliaciones de anuncios, y por la misma razón: abrir fichas mete gente
 * nueva en el funnel que el equipo va a repartir y a trabajar, así que no puede
 * ser el efecto de haber abierto una pantalla ni de haber corrido un
 * diagnóstico para mirar.
 *
 * Por qué hay conversaciones sin ficha, y por qué conviene correr esto con el
 * log del servidor al lado: guardar el mensaje y abrir la ficha son dos
 * escrituras del mismo webhook, que ya respondió 200. Si la segunda falla no se
 * reintenta y nadie se entera. La recuperación usa `findOrCreateFromWhatsApp()`
 * —el MISMO camino del webhook— así que si ese camino sigue roto, acá el error
 * sale completo y a la vista en vez de quedar en un `catch`. Un fallo no
 * detiene a los demás: cada contacto es independiente y el que se pueda
 * recuperar se recupera.
 *
 * El `referral` del clic se recupera del primer mensaje entrante, así que la
 * ficha nace con su anuncio y no como orgánica.
 *
 * Uso:
 *   node backend/scripts/recuperarConversacionesSinLead.js            (reporta)
 *   node backend/scripts/recuperarConversacionesSinLead.js --aplicar  (abre las fichas)
 *   node backend/scripts/recuperarConversacionesSinLead.js --aplicar --dias 7
 */

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const DIAS = Number(args[args.indexOf('--dias') + 1]) || DEFAULT_WINDOW_DAYS;

const linea = (texto = '') => console.log(texto);
const titulo = (texto) => {
  linea();
  linea('='.repeat(78));
  linea(`  ${texto}`);
  linea('='.repeat(78));
};
const momento = (valor) => (valor ? new Date(valor).toISOString().replace('T', ' ').slice(0, 16) : '-');

async function main() {
  titulo(`Conversaciones sin ficha · últimos ${DIAS} días · ${APLICAR ? 'APLICANDO' : 'solo reporte'}`);

  const { total, orphans, borradas } = await findOrphanConversations({ days: DIAS });
  linea();
  linea(`   Conversaciones en el período: ${total}`);
  linea(`   Sin ficha en el CRM: ${orphans.length}`);
  if (borradas) linea(`   Con la ficha borrada a mano: ${borradas} (no se vuelven a abrir)`);

  if (!orphans.length) {
    linea();
    linea('   No hay nada que recuperar.');
    return;
  }

  linea();
  for (const orphan of orphans) {
    const anuncio = orphan.referral ? ' · con referral de anuncio' : '';
    linea(`   ${orphan.waId.padEnd(20)} ${String(orphan.messages).padStart(3)} msj`
      + ` · ${momento(orphan.firstAt)} → ${momento(orphan.lastAt)}`
      + ` · ${orphan.contactName || 'sin nombre'} · ${orphan.channel || 'sin canal'}${anuncio}`);
  }

  if (!APLICAR) {
    linea();
    linea('   Para abrirles la ficha: volvé a correrlo con --aplicar.');
    linea('   Se usa el mismo camino del webhook, así que si el alta sigue rota el error');
    linea('   va a salir completo acá — que es justo lo que hay que ver.');
    return;
  }

  const leadService = new LeadService();
  let creados = 0;
  let fallidos = 0;

  titulo('Abriendo fichas');
  for (const orphan of orphans) {
    try {
      const lead = await adoptOrphanConversation(orphan, { leadService });
      const origin = leadOrigin(lead);
      creados++;
      linea(`   OK  #${lead.id} ${lead.full_name || 'sin nombre'} · ${orphan.waId}`
        + ` · ${origin.platform} / ${origin.channel}`
        + ` · responsable: ${lead.assigned_to || 'SIN RESPONSABLE'}`);
    } catch (error) {
      fallidos++;
      linea(`   FALLÓ  ${orphan.waId}: ${error.message}`);
      /*
       * El código del driver es lo que nombra la causa real. "Unknown column"
       * significa que falta una migración en esta base y que el alta está rota
       * para TODO el sistema, no solo para este contacto — un dato que no se
       * puede dejar pasar entre los demás renglones.
       */
      if (error.code) linea(`           código: ${error.code}`);
      if (error.sqlMessage) linea(`           sql: ${error.sqlMessage}`);
    }
  }

  linea();
  linea(`   Fichas abiertas: ${creados} · fallidas: ${fallidos}`);
  if (fallidos) {
    linea();
    linea('   Un fallo acá es el MISMO que se traga el webhook en silencio con cada');
    linea('   mensaje que entra. Mientras no se arregle, cada contacto nuevo va a quedar');
    linea('   sin ficha igual que estos. Si el error dice "Unknown column", falta correr');
    linea('   `npm run migrate` en esta base.');
  }
  if (creados) {
    linea();
    linea('   Las fichas nuevas quedan SIN RESPONSABLE si el bot está encendido (el');
    linea('   reparto automático corre con el bot apagado), y un lead sin responsable solo');
    linea('   lo ve quien reparte. Repartilos desde el tablero para que el equipo los vea.');
  }
}

main()
  .catch((error) => {
    console.error('Error en la recuperación:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
