import { db } from '../db/connection.js';

/**
 * Planilla de salarios.
 *
 * Vive en su propio servicio y no dentro de `financeLedgerService` a propósito:
 * un salario **no es** un ingreso ni un egreso de la empresa. No entra en
 * `finance_journal`, no toca `finance_income` y no aparece en los totales ni en
 * el flujo de caja de `getOverview()` — es un historial de pagos al personal,
 * con su fecha, y nada más. Mantenerlo separado evita que una suma futura del
 * libro contable lo arrastre sin querer.
 */

export const MONEDAS = ['soles', 'dolares'];
export const BANCOS = ['BCP', 'Interbank', 'Efectivo'];

/**
 * mysql2 devuelve las columnas DATE como un Date a medianoche LOCAL; pasarlo
 * por JSON (UTC) corre el día hacia atrás. Las fechas salen siempre como
 * "YYYY-MM-DD", igual que en el resto de Finanzas.
 */
function isoDay(value) {
  if (!value) return null;
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function withIsoDates(row) {
  return row ? { ...row, fecha: isoDay(row.fecha) } : row;
}

/** Valida y normaliza lo que llega del formulario, para alta y para edición. */
function normalize({ persona, cargo, fecha, periodo, monto, moneda, metodoPago, banco, detalle }) {
  if (!persona || !persona.trim()) throw new Error('El nombre de la persona es obligatorio.');
  if (!fecha) throw new Error('La fecha es obligatoria.');

  const importe = Number(monto);
  if (!Number.isFinite(importe) || importe <= 0) {
    throw new Error('El monto debe ser un número mayor que cero.');
  }

  return {
    persona: persona.trim(),
    cargo: cargo?.trim() || null,
    fecha: String(fecha).slice(0, 10),
    periodo: periodo?.trim() || null,
    monto: Math.round(importe * 100) / 100,
    moneda: MONEDAS.includes(moneda) ? moneda : 'soles',
    metodo_pago: metodoPago?.trim() || null,
    banco: banco?.trim() || null,
    detalle: detalle?.trim() || null
  };
}

export class FinanceSalaryService {
  async listSalaries() {
    const rows = await db('finance_salaries')
      .leftJoin('users', 'users.id', 'finance_salaries.created_by')
      .select('finance_salaries.*', 'users.name as created_by_name')
      .orderBy('finance_salaries.fecha', 'desc')
      .orderBy('finance_salaries.id', 'desc');
    return rows.map(withIsoDates);
  }

  async createSalary(payload) {
    const data = normalize(payload);
    const [id] = await db('finance_salaries').insert({
      ...data,
      created_by: payload.createdBy || null
    });
    return this.getSalary(id);
  }

  async updateSalary(id, payload) {
    const existing = await db('finance_salaries').where({ id }).first();
    if (!existing) return null;
    await db('finance_salaries').where({ id }).update(normalize(payload));
    return this.getSalary(id);
  }

  async getSalary(id) {
    const row = await db('finance_salaries').where({ id }).first();
    return withIsoDates(row);
  }

  async deleteSalary(id) {
    return db('finance_salaries').where({ id }).del();
  }
}
