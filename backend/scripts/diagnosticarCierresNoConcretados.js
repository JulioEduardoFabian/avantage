import { db } from '../db/connection.js';

/**
 * ¿Quién dio por caído cada cierre, y cuándo?
 *
 * Solo LEE. Existe porque Ventas reportó (16/11/2026) que en la pestaña
 * INGRESOS había cierres marcados «NO CONCRETADO» que ellos no habían tocado,
 * y esa pregunta no se puede contestar mirando el código: en el panel hay UN
 * solo camino que escribe esa marca —el botón «🚫 No se concretó» de la fila
 * del cierre, bajo `finance.view`, vía
 * `PATCH /api/finance/leads/:id/deal-cancelled` → `setDealCancelled()`— y la
 * ficha guarda quién y cuándo (`deal_cancelled_by` / `_at`). O sea que la
 * respuesta está en los datos y no en el repositorio.
 *
 * Lo que hay que mirar al correrlo:
 *
 *  - `deal_cancelled_by` con nombre  → lo marcó esa persona desde Finanzas.
 *    Ventas no lo ve porque no es una etapa del funnel: es una decisión sobre
 *    el cobro, y se toma desde otra pantalla y casi siempre otra persona.
 *  - `deal_cancelled_by` en NULL     → o lo marcó alguien cuya cuenta se borró
 *    después (la columna es ON DELETE SET NULL), o lo escribió algo que no es
 *    la ruta, que es lo único que sería un fallo del sistema. En ese caso hay
 *    que buscar la fecha en el log del servidor: la ruta deja una línea
 *    «🚫 [Finanzas] Cierre del lead #N dado por caído por <correo>».
 *  - Varios marcados en el mismo minuto → alguien limpiando la lista de
 *    Cobranzas de una sentada, no ocho clics por error.
 *
 * Uso:
 *   node backend/scripts/diagnosticarCierresNoConcretados.js
 *
 * No imprime importes de cada cuota ni teléfonos: para contestar quién marcó
 * qué alcanza con el cierre, su precio pactado y lo que se alcanzó a cobrar.
 */

function dinero(valor) {
  return `S/ ${(Number(valor) || 0).toFixed(2)}`;
}

function fecha(valor) {
  if (!valor) return 'sin fecha';
  const date = new Date(valor);
  return Number.isNaN(date.getTime()) ? String(valor) : date.toISOString().replace('T', ' ').slice(0, 19);
}

const cierres = await db('leads')
  .leftJoin('users', 'users.id', 'leads.deal_cancelled_by')
  .whereNotNull('leads.deal_cancelled_at')
  .orderBy('leads.deal_cancelled_at', 'desc')
  .select(
    'leads.id',
    'leads.dni',
    'leads.status',
    'leads.total_amount',
    'leads.deal_cancelled_at',
    'leads.deal_cancelled_by',
    'leads.deal_cancelled_reason',
    db.raw("COALESCE(NULLIF(leads.full_name, ''), leads.topic) as nombre"),
    'users.name as marcado_por',
    'users.email as marcado_por_email'
  );

console.log(`\n▶ Cierres dados por caído: ${cierres.length}`);

if (cierres.length === 0) {
  console.log('   Ninguno. Si la pantalla muestra insignias «NO CONCRETADO», es otra base de datos.');
  await db.destroy();
  process.exit(0);
}

// Lo cobrado de cada uno, en UNA consulta para todos: lo verificado sigue
// contando en los libros aunque el cierre se haya caído, y es lo que separa
// «se cayó antes de pagar» de «pagó y después se cayó».
const ids = cierres.map((c) => c.id);
const cuotas = await db('finance_income')
  .whereIn('lead_id', ids)
  .groupBy('lead_id', 'estado')
  .select('lead_id', 'estado')
  .sum('monto as monto')
  .count('id as cuotas');

const porLead = new Map();
for (const fila of cuotas) {
  const entrada = porLead.get(fila.lead_id) || { verificado: 0, pagado: 0, pendiente: 0, cuotas: 0 };
  entrada[fila.estado] = Math.round((Number(fila.monto) || 0) * 100) / 100;
  entrada.cuotas += Number(fila.cuotas) || 0;
  porLead.set(fila.lead_id, entrada);
}

const sinAutor = [];
const porPersona = new Map();

for (const cierre of cierres) {
  const cobro = porLead.get(cierre.id) || { verificado: 0, pagado: 0, pendiente: 0, cuotas: 0 };
  const autor = cierre.marcado_por
    ? `${cierre.marcado_por}${cierre.marcado_por_email ? ` <${cierre.marcado_por_email}>` : ''}`
    : '⚠️  SIN AUTOR (cuenta borrada, o lo escribió algo que no es la ruta)';
  if (!cierre.marcado_por) sinAutor.push(cierre.id);
  porPersona.set(autor, (porPersona.get(autor) || 0) + 1);

  console.log(`\n   Lead #${cierre.id} · ${cierre.nombre || 'sin nombre'}${cierre.dni ? ` · DNI ${cierre.dni}` : ''}`);
  console.log(`      Marcado el ${fecha(cierre.deal_cancelled_at)} por ${autor}`);
  console.log(`      Motivo: ${cierre.deal_cancelled_reason || '— sin motivo escrito —'}`);
  console.log(`      Etapa del funnel: ${cierre.status || 'sin etapa'} · Precio pactado: ${
    cierre.total_amount != null ? dinero(cierre.total_amount) : 'sin definir'}`);
  console.log(`      Cuotas: ${cobro.cuotas} · verificado ${dinero(cobro.verificado)} · `
    + `por verificar ${dinero(cobro.pagado)} · pendiente ${dinero(cobro.pendiente)}`);
}

console.log('\n▶ Quién los marcó');
for (const [autor, total] of [...porPersona.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${total} cierre(s) — ${autor}`);
}

if (sinAutor.length > 0) {
  console.log(`\n⚠️  ${sinAutor.length} cierre(s) sin autor: leads ${sinAutor.join(', ')}.`);
  console.log('   La ruta siempre escribe el id de quien aprieta el botón, así que esto es');
  console.log('   una cuenta borrada o una escritura que no pasó por el panel. Buscar en el');
  console.log('   log del servidor la línea «🚫 [Finanzas] Cierre del lead #N dado por caído».');
}

console.log('\n   Recordatorio: marcar un cierre como no concretado NO es un movimiento del');
console.log('   funnel —no deja rastro en `lead_stage_changes` ni cambia `leads.status`—, así');
console.log('   que Ventas no lo ve pasar. Es una decisión sobre el cobro y se toma en');
console.log('   Finanzas, con `finance.view`.\n');

await db.destroy();
