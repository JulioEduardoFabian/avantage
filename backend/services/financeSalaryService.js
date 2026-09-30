import { db } from '../db/connection.js';
import {
  BANCOS as BANCOS_LEDGER,
  attachReceipts,
  receiptRowsFromFiles,
  unlinkQuiet
} from './financeLedgerService.js';

/**
 * Planilla de salarios.
 *
 * Vive en su propio servicio y no dentro de `financeLedgerService` a propósito:
 * no entra en `finance_journal`, no toca `finance_income` y no aparece en los
 * totales ni en el flujo de caja de `getOverview()` — es un historial de pagos
 * al personal, con su fecha y su estado (pagado/pendiente). Mantenerlo separado
 * evita que una suma futura del libro contable lo arrastre sin querer.
 *
 * El `monto` se guarda en **negativo** porque es dinero que sale; el
 * formulario lo pide en positivo y `normalize()` le pone el signo.
 *
 * Lo único que comparte con `financeLedgerService` son las utilidades de
 * archivo de los comprobantes (`finance_salary_receipts` guarda sus archivos
 * en la misma carpeta `uploads/finance-receipts/`) y la lista de bancos: es
 * fontanería de disco y un desplegable, no contabilidad.
 */

export const MONEDAS = ['soles', 'dolares'];
/** La misma lista de cuentas que el resto de Finanzas (BCP, BCP Finanzas...). */
export const BANCOS = BANCOS_LEDGER;
export const ESTADOS = ['pagado', 'pendiente'];

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
function normalize({ persona, cargo, fecha, periodo, monto, moneda, estado, metodoPago, banco, detalle }) {
  if (!persona || !persona.trim()) throw new Error('El nombre de la persona es obligatorio.');
  if (!fecha) throw new Error('La fecha es obligatoria.');

  // Un salario es un egreso: se guarda siempre en negativo. Se acepta el monto
  // con o sin signo (el formulario lo pide en positivo) y se toma su valor
  // absoluto, así nunca queda un salario "a favor" por un signo mal puesto.
  const importe = Math.abs(Number(monto));
  if (!Number.isFinite(importe) || importe === 0) {
    throw new Error('El monto debe ser un número distinto de cero.');
  }

  return {
    persona: persona.trim(),
    cargo: cargo?.trim() || null,
    fecha: String(fecha).slice(0, 10),
    periodo: periodo?.trim() || null,
    monto: -Math.round(importe * 100) / 100,
    moneda: MONEDAS.includes(moneda) ? moneda : 'soles',
    estado: ESTADOS.includes(estado) ? estado : 'pagado',
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
    const withReceipts = await attachReceipts(rows, 'finance_salary_receipts', 'salary_id');
    return withReceipts.map(withIsoDates);
  }

  async createSalary(payload) {
    const data = normalize(payload);
    const [id] = await db('finance_salaries').insert({
      ...data,
      created_by: payload.createdBy || null
    });
    await this.#insertReceipts(id, payload.receipts);
    return this.getSalary(id);
  }

  /**
   * Los comprobantes que lleguen en la edición se **suman** a los que ya
   * tiene el pago (igual que en el libro diario): quitar uno es una acción
   * aparte, desde su miniatura.
   */
  async updateSalary(id, payload) {
    const existing = await db('finance_salaries').where({ id }).first();
    if (!existing) return null;
    await db('finance_salaries').where({ id }).update(normalize(payload));
    await this.#insertReceipts(id, payload.receipts);
    return this.getSalary(id);
  }

  async #insertReceipts(salaryId, files) {
    const rows = receiptRowsFromFiles(files, 'salary_id', salaryId);
    if (rows.length > 0) await db('finance_salary_receipts').insert(rows);
    return rows.length;
  }

  /** Adjunta comprobantes a un pago ya registrado, desde su fila en la tabla. */
  async addReceipts(salaryId, files) {
    const salary = await db('finance_salaries').where({ id: salaryId }).first();
    if (!salary) throw new Error('Salario no encontrado.');
    if (!files || files.length === 0) throw new Error('No se recibió ningún comprobante.');
    await this.#insertReceipts(salaryId, files);
    return db('finance_salary_receipts').where('salary_id', salaryId).orderBy('id', 'asc');
  }

  async getReceiptById(id) {
    return db('finance_salary_receipts').where({ id }).first();
  }

  async deleteReceipt(id) {
    const receipt = await db('finance_salary_receipts').where({ id }).first();
    if (receipt) unlinkQuiet(receipt.filename);
    return db('finance_salary_receipts').where({ id }).del();
  }

  /** Cambia solo el estado (pagado ↔ pendiente) sin reenviar todo el formulario. */
  async setSalaryStatus(id, estado) {
    if (!ESTADOS.includes(estado)) throw new Error('Estado inválido: debe ser "pagado" o "pendiente".');
    const updated = await db('finance_salaries').where({ id }).update({ estado });
    return updated ? this.getSalary(id) : null;
  }

  async getSalary(id) {
    const row = await db('finance_salaries').where({ id }).first();
    if (!row) return row;
    const [withReceipts] = await attachReceipts([row], 'finance_salary_receipts', 'salary_id');
    return withIsoDates(withReceipts);
  }

  /** Borra el pago y, con él, los archivos de sus comprobantes en disco. */
  async deleteSalary(id) {
    const receipts = await db('finance_salary_receipts').where('salary_id', id).select('filename');
    receipts.forEach((r) => unlinkQuiet(r.filename));
    return db('finance_salaries').where({ id }).del();
  }
}
