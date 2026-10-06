/**
 * Por qué un contacto sale con una etapa distinta en Campañas y en el Funnel.
 *
 *   node backend/scripts/diagnosticarLeadCampana.js "Rafael Anderson"
 *   node backend/scripts/diagnosticarLeadCampana.js 999922762
 *
 * Imprime TODAS las fichas de `leads` de esa persona (hay teléfonos con más de
 * una), cuál elige la trazabilidad de Campañas y por qué, qué status significan
 * "ganado" según el tablero de hoy, y si tiene proyecto abierto. Entre esos
 * cuatro datos está siempre la explicación de una etapa que no coincide.
 *
 * No escribe nada: solo lee.
 */
import { db } from '../db/connection.js';
import { PHONE_MATCH_KEY_SQL, phoneMatchKey } from '../services/leadService.js';
import { esMejorLead, isWonLead } from '../services/campaignService.js';
import { loadWinningStatuses } from '../services/salesFunnelStage.js';

const busqueda = process.argv.slice(2).join(' ').trim();

if (!busqueda) {
  console.error('Falta a quién buscar. Ej: node backend/scripts/diagnosticarLeadCampana.js "Rafael Anderson"');
  process.exit(1);
}

try {
  const wonStatuses = await loadWinningStatuses();
  console.log('\n▶ Status que hoy significan "ganado":', [...wonStatuses].join(', '));

  const columnas = await db('funnel_columns').select('key', 'label', 'final').orderBy('position');
  console.log('\n▶ Columnas del funnel:');
  console.table(columnas.map((c) => ({ clave: c.key, etiqueta: c.label, final: c.final ? 'SÍ' : 'no' })));

  const clave = phoneMatchKey(busqueda);
  const fichas = clave
    ? await db('leads').whereIn(db.raw(PHONE_MATCH_KEY_SQL), [clave])
      .select('id', 'full_name', 'phone', 'status', 'sales_funnel_at', 'created_at',
        'source', 'meta_leadgen_id', 'meta_created_time', 'additional_notes')
    : await db('leads').whereRaw('LOWER(full_name) LIKE ?', [`%${busqueda.toLowerCase()}%`])
      .select('id', 'full_name', 'phone', 'status', 'sales_funnel_at', 'created_at',
        'source', 'meta_leadgen_id', 'meta_created_time', 'additional_notes');

  if (fichas.length === 0) {
    console.log(`\n⚠ No hay ninguna ficha que coincida con "${busqueda}".`);
    process.exit(0);
  }

  const proyectos = await db('projects').whereIn('lead_id', fichas.map((f) => f.id)).select('lead_id');
  const conProyecto = new Set(proyectos.map((p) => p.lead_id));

  console.log(`\n▶ Fichas encontradas (${fichas.length}):`);
  console.table(fichas.map((f) => ({
    id: f.id,
    nombre: f.full_name,
    telefono: f.phone,
    sufijo: phoneMatchKey(f.phone),
    status: f.status,
    '¿ganado?': isWonLead(f, wonStatuses, conProyecto) ? 'SÍ' : 'no',
    graduado: f.sales_funnel_at ? 'sí' : 'no',
    proyecto: conProyecto.has(f.id) ? 'sí' : 'no',
    creado: new Date(f.created_at).toISOString().slice(0, 10)
  })));

  if (fichas.length > 1) {
    // De dónde salió cada ficha. Con dos fichas del mismo teléfono, la
    // pregunta siguiente siempre es "¿qué camino creó la segunda?", y la
    // respuesta está en el origen y en el id de Meta.
    console.log(`
▶ De dónde salió cada ficha:`);
    console.table(fichas.map((f) => ({
      id: f.id,
      origen: f.source || '(sin origen)',
      meta_leadgen_id: f.meta_leadgen_id || '—',
      meta_created_time: f.meta_created_time ? new Date(f.meta_created_time).toISOString().slice(0, 16) : '—',
      creada: new Date(f.created_at).toISOString().slice(0, 16),
      nota: String(f.additional_notes || '').replace(/\s+/g, ' ').slice(0, 60)
    })));
  }

  // La misma elección que hace `#enrichContacts`.
  let elegida = null;
  for (const ficha of fichas) {
    if (!elegida || esMejorLead(ficha, elegida, wonStatuses)) elegida = ficha;
  }
  console.log(`\n▶ La trazabilidad de Campañas usaría la ficha #${elegida.id} (status "${elegida.status}").`);
  console.log(`  ¿La cuenta como ganada? ${isWonLead(elegida, wonStatuses, conProyecto) ? 'SÍ' : 'NO'}`);

  // ¿Llega siquiera a la trazabilidad? Hace falta un mensaje con referral de anuncio.
  const sufijos = fichas.map((f) => phoneMatchKey(f.phone)).filter(Boolean);
  const mensajes = await db('whatsapp_messages')
    .whereNotNull('referral')
    .andWhere('direction', 'inbound')
    .select('wa_id')
    .orderBy('received_at', 'asc');
  const atribuidos = mensajes.filter((m) => sufijos.includes(phoneMatchKey(m.wa_id)));
  console.log(`\n▶ Mensajes con referral de anuncio de este contacto: ${atribuidos.length}`);
  if (atribuidos.length > 0) {
    console.log('  wa_id tal como lo manda Meta:', [...new Set(atribuidos.map((m) => m.wa_id))].join(', '));
  } else {
    console.log('  Sin ninguno, este contacto NO aparece en la trazabilidad de ninguna campaña.');
  }
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
