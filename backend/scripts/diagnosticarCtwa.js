import { db } from '../db/connection.js';

/**
 * ¿Nos está llegando el `ctwa_clid` de los anuncios Click-to-WhatsApp?
 *
 * Solo LEE. Contesta la pregunta de la que depende la mitad de
 * Click-to-WhatsApp de las conversiones hacia Meta
 * (`metaConversionsService.js`): ese click id es el único identificador con el
 * que Meta puede atribuir a un anuncio un lead que entró por conversación, y
 * viaja dentro del `referral` del PRIMER mensaje del contacto. Si el proveedor
 * de WhatsApp no lo reenvía, no hay conjunto de datos ni configuración que
 * arregle eso — y conviene saberlo antes de salir a buscar el
 * `META_CAPI_MESSAGING_DATASET_ID`.
 *
 * Uso:
 *   node backend/scripts/diagnosticarCtwa.js [días]
 *
 * El click id se imprime recortado: identifica un clic, pero no hay razón para
 * dejarlo entero en la consola de nadie.
 */

const dias = Number(process.argv[2]) || 90;
const desde = new Date(Date.now() - dias * 86400000);

function parse(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function recortar(clid) {
  const texto = String(clid || '');
  return texto.length <= 12 ? texto : `${texto.slice(0, 8)}…${texto.slice(-4)}`;
}

const filas = await db('whatsapp_messages')
  .whereNotNull('referral')
  .where('received_at', '>=', desde)
  .orderBy('received_at', 'desc')
  .select('id', 'wa_id', 'referral', 'received_at', 'channel');

console.log(`\n▶ Mensajes con referral de anuncio en los últimos ${dias} días: ${filas.length}`);

if (filas.length === 0) {
  console.log('  No hay ninguno. O no corrieron anuncios Click-to-WhatsApp en el período, o el');
  console.log('  proveedor no está reenviando el objeto "referral" del primer mensaje.');
  await db.destroy();
  process.exit(0);
}

const conClid = filas.filter((fila) => parse(fila.referral)?.ctwa_clid);
const contactosConClid = new Set(conClid.map((fila) => fila.wa_id));

console.log(`▶ De esos, con ctwa_clid: ${conClid.length} (${Math.round((conClid.length / filas.length) * 100)}%)`);
console.log(`▶ Contactos distintos con ctwa_clid: ${contactosConClid.size}`);

// Las claves que trae el referral dicen qué versión del objeto está llegando:
// un referral sin `ctwa_clid` pero con `source_id` es el formato viejo (o un
// proveedor que recorta el payload).
const claves = new Map();
for (const fila of filas) {
  for (const clave of Object.keys(parse(fila.referral) || {})) {
    claves.set(clave, (claves.get(clave) || 0) + 1);
  }
}
console.log('\n▶ Campos presentes en los referrals (y en cuántos mensajes):');
for (const [clave, n] of [...claves.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${clave.padEnd(22)} ${n}`);
}

console.log('\n▶ Últimos 5 referrals con ctwa_clid:');
for (const fila of conClid.slice(0, 5)) {
  const referral = parse(fila.referral);
  console.log(
    `   ${new Date(fila.received_at).toISOString().slice(0, 16).replace('T', ' ')} · ` +
    `${fila.wa_id} · anuncio ${referral.source_id || '—'} · clid ${recortar(referral.ctwa_clid)}`
  );
}

/*
 * Cuántos de esos contactos son leads que el panel puede reportar, con los
 * MISMOS dos caminos que usa `ctwaClidFor()` y no con uno solo:
 *
 *   - exacto, para las conversaciones cuyo identificador no es un teléfono
 *     sino un id de usuario de la empresa ("PE.2379096279586501"): el lead que
 *     nace de ellas guarda ese texto en `phone`;
 *   - por los últimos 9 dígitos, para los teléfonos, que cada puerta escribe
 *     distinto.
 *
 * Los BSUID se separan a propósito: quitarles los puntos y quedarse con sus
 * últimos 9 dígitos los haría parecer teléfonos y podrían cruzar con el lead
 * equivocado. Por eso se cuentan aparte y se buscan por igualdad.
 */
const esBsuid = (waId) => /[a-z]/i.test(String(waId));
const bsuids = [...contactosConClid].filter(esBsuid);
const telefonos = [...contactosConClid].filter((waId) => !esBsuid(waId));
const sufijos = telefonos
  .map((waId) => String(waId).replace(/\D/g, '').slice(-9))
  .filter((key) => key.length === 9);

console.log(`\n▶ De los ${contactosConClid.size} contactos con ctwa_clid: ${telefonos.length} son teléfonos y ${bsuids.length} son identificadores de usuario (PE.…).`);

const porTelefono = sufijos.length
  ? await db('leads')
    .whereRaw(
      `RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(leads.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), 9) IN (${sufijos.map(() => '?').join(',')})`,
      sufijos
    )
    .select('id', 'meta_leadgen_id')
  : [];

const porBsuid = bsuids.length
  ? await db('leads').whereIn('phone', bsuids).select('id', 'meta_leadgen_id')
  : [];

const leads = [...porTelefono, ...porBsuid];
const soloCtwa = leads.filter((lead) => !lead.meta_leadgen_id);
console.log(`\n▶ Leads que cruzan con esos contactos: ${leads.length} (${porTelefono.length} por teléfono, ${porBsuid.length} por identificador de usuario)`);
console.log(`   De ellos, SIN lead_id de formulario (o sea, los que se reportarían por ctwa_clid): ${soloCtwa.length}`);
const sinLead = contactosConClid.size - leads.length;
if (sinLead > 0) {
  console.log(`   ${sinLead} contacto(s) con ctwa_clid no tienen lead que les corresponda: esos no se reportan.`);
}
console.log('\n   Con META_CAPI_MESSAGING_DATASET_ID configurado, esos son los que empezarían a');
console.log('   reportarse cuando cambien de etapa. Sin él, quedan sin reportar.');

await db.destroy();
