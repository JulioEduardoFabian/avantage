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
 * Qué es cada fila de la planilla:
 *   - `pago`: plata que sale (lo de siempre). Puede ser suelta —la planilla
 *     mensual de alguien— o colgar de un acuerdo.
 *   - `acuerdo`: cuánto se le paga a quien consiguió el lead por ESE proyecto.
 *     **No es dinero que salió**: es el compromiso, como la comisión de la
 *     setter, y por eso no se descuenta en el Resumen Financiero. Lo que
 *     descuenta son sus pagos.
 */
export const TIPOS = ['pago', 'acuerdo'];

/**
 * El porcentaje del acuerdo que cubre un pago. Se deriva en cada lectura y no
 * se guarda: si el acuerdo se corrige, un porcentaje guardado seguiría
 * diciendo el viejo (misma razón que `is_locked` de un hito).
 */
export function percentOf(monto, acuerdo) {
  const base = Math.abs(Number(acuerdo) || 0);
  if (!base) return null;
  return Math.round((Math.abs(Number(monto) || 0) / base) * 1000) / 10;
}

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
function normalize({ persona, cargo, fecha, periodo, monto, moneda, estado, metodoPago, banco, detalle, kind, parentId, projectId, userId }) {
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
    detalle: detalle?.trim() || null,
    kind: TIPOS.includes(kind) ? kind : 'pago',
    parent_id: parentId || null,
    project_id: projectId || null,
    user_id: userId || null
  };
}

export class FinanceSalaryService {
  /**
   * La planilla, con los acuerdos por proyecto ya armados: cada acuerdo trae
   * sus pagos dentro (`children`) y, derivados, lo pagado, el saldo y el
   * porcentaje cubierto. Los pagos sueltos —la planilla de siempre— siguen
   * saliendo al mismo nivel.
   *
   * Se arma acá y no en la pantalla porque de estas mismas cifras cuelga lo
   * que la pestaña muestra arriba: con el cálculo en el cliente, el total de
   * la tira y el de la fila se separan el día que una de las dos cambie.
   */
  async listSalaries() {
    const rows = await db('finance_salaries')
      .leftJoin('users as autor', 'autor.id', 'finance_salaries.created_by')
      .leftJoin('users as beneficiario', 'beneficiario.id', 'finance_salaries.user_id')
      .leftJoin('projects', 'projects.id', 'finance_salaries.project_id')
      .leftJoin('leads', 'leads.id', 'projects.lead_id')
      .select(
        'finance_salaries.*',
        'autor.name as created_by_name',
        'beneficiario.name as beneficiary_name',
        'projects.topic as project_topic',
        db.raw("COALESCE(NULLIF(leads.full_name, ''), leads.topic) as project_client")
      )
      .orderBy('finance_salaries.fecha', 'desc')
      .orderBy('finance_salaries.id', 'desc');

    const withReceipts = (await attachReceipts(rows, 'finance_salary_receipts', 'salary_id')).map(withIsoDates);

    const porPadre = new Map();
    for (const row of withReceipts) {
      if (!row.parent_id) continue;
      if (!porPadre.has(row.parent_id)) porPadre.set(row.parent_id, []);
      porPadre.get(row.parent_id).push(row);
    }

    return withReceipts
      .filter((row) => !row.parent_id)
      .map((row) => {
        if (row.kind !== 'acuerdo') return { ...row, children: [] };
        // Los pagos de un acuerdo van del más viejo al más nuevo: se leen como
        // lo que son, una cuenta que se va cubriendo.
        const children = (porPadre.get(row.id) || [])
          .slice()
          .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.id - b.id)
          .map((child) => ({ ...child, percent: percentOf(child.monto, row.monto) }));

        const pagado = children
          .filter((child) => child.estado === 'pagado')
          .reduce((suma, child) => suma + Math.abs(Number(child.monto) || 0), 0);
        const comprometido = children.reduce((suma, child) => suma + Math.abs(Number(child.monto) || 0), 0);
        const acordado = Math.abs(Number(row.monto) || 0);

        return {
          ...row,
          children,
          paid_amount: Math.round(pagado * 100) / 100,
          scheduled_amount: Math.round(comprometido * 100) / 100,
          pending_amount: Math.round((acordado - pagado) * 100) / 100,
          paid_percent: percentOf(pagado, row.monto)
        };
      });
  }

  /**
   * Los proyectos a los que todavía no se les registró su salario, con el
   * cliente y el responsable ya resueltos: es lo que ofrece el desplegable del
   * formulario, y por eso se filtran los que ya tienen acuerdo — ofrecer uno
   * que después el servidor va a rechazar con 409 es hacer trabajar al
   * usuario para nada.
   */
  async listProjectsWithoutAgreement() {
    const conAcuerdo = await db('finance_salaries')
      .where('kind', 'acuerdo')
      .whereNotNull('project_id')
      .pluck('project_id');

    const query = db('projects')
      .leftJoin('leads', 'leads.id', 'projects.lead_id')
      .leftJoin('users as lider', 'lider.id', 'projects.leader_id')
      .leftJoin('users as comercial', 'comercial.id', 'leads.assigned_user_id')
      .select(
        'projects.id',
        'projects.topic',
        db.raw("COALESCE(NULLIF(leads.full_name, ''), leads.topic, 'Cliente') as client_name"),
        db.raw('COALESCE(lider.name, comercial.name, leads.assigned_to) as owner_name')
      )
      .orderBy('projects.id', 'desc');

    if (conAcuerdo.length > 0) query.whereNotIn('projects.id', conAcuerdo);
    return query;
  }

  /**
   * Quién cobra el salario de un proyecto: **su responsable**.
   *
   * Primero el líder del proyecto (el Asesor Operativo) y, si todavía no
   * tiene, el responsable comercial del lead. Ese segundo paso no es un
   * adorno: el acuerdo se registra también en el momento del cierre, cuando el
   * proyecto se acaba de abrir y nadie le asignó líder — sin él, justo el
   * camino principal quedaría sin beneficiario.
   *
   * Devuelve el id y el NOMBRE, y los dos se guardan: `user_id` es el enlace
   * con la cuenta y `persona` la copia legible, igual que `leads.assigned_to`.
   * Dar de baja a alguien no puede dejar la planilla de meses pasados sin
   * dueño, y a la planilla también entra gente sin cuenta en el panel.
   */
  async resolveProjectOwner(projectId) {
    const row = await db('projects')
      .leftJoin('leads', 'leads.id', 'projects.lead_id')
      .leftJoin('users as lider', 'lider.id', 'projects.leader_id')
      .leftJoin('users as comercial', 'comercial.id', 'leads.assigned_user_id')
      .select(
        'projects.id',
        'projects.topic',
        'lider.id as lider_id',
        'lider.name as lider_name',
        'comercial.id as comercial_id',
        'comercial.name as comercial_name',
        'leads.assigned_to as assigned_text'
      )
      .where('projects.id', projectId)
      .first();
    if (!row) throw new Error('Proyecto no encontrado.');

    return {
      projectId: row.id,
      topic: row.topic,
      userId: row.lider_id || row.comercial_id || null,
      persona: row.lider_name || row.comercial_name || row.assigned_text || null
    };
  }

  /**
   * El acuerdo de salario por un proyecto: cuánto se le paga a quien lo
   * consiguió. Se registra desde la pestaña de Salarios y también al cerrar la
   * venta, así que la regla de quién cobra y la de no duplicar viven acá — en
   * la ruta, el segundo camino se olvidaría.
   *
   * Un proyecto tiene UN acuerdo: si ya existe se devuelve el que hay en vez
   * de abrir un segundo, que partiría los pagos en dos cuentas que no suman.
   */
  async createAgreement({ projectId, monto, persona, moneda, metodoPago, banco, detalle, fecha, createdBy = null }) {
    if (!projectId) throw new Error('Hay que indicar el proyecto del salario.');

    const existente = await db('finance_salaries')
      .where({ project_id: projectId, kind: 'acuerdo' })
      .first();
    if (existente) {
      const error = new Error('Este proyecto ya tiene registrado su salario.');
      error.code = 'SALARY_AGREEMENT_EXISTS';
      error.agreementId = existente.id;
      throw error;
    }

    const owner = await this.resolveProjectOwner(projectId);
    const nombre = persona?.trim() || owner.persona;
    if (!nombre) throw new Error('Ese proyecto no tiene responsable asignado: elige a quién se le paga.');

    const data = normalize({
      persona: nombre,
      fecha: fecha || new Date().toISOString().slice(0, 10),
      monto,
      moneda,
      // Un acuerdo no es un pago: no tiene estado propio: lo que está pagado o
      // pendiente son sus hijos. Se guarda como 'pendiente' para que ninguna
      // suma vieja lo tome por dinero que salió.
      estado: 'pendiente',
      metodoPago,
      banco,
      detalle,
      kind: 'acuerdo',
      projectId,
      userId: owner.userId
    });

    const [id] = await db('finance_salaries').insert({ ...data, created_by: createdBy });
    return this.getSalary(id);
  }

  /** Un pago parcial de un acuerdo. El porcentaje sale del monto, no se pide. */
  async addPayment(parentId, payload) {
    const padre = await db('finance_salaries').where({ id: parentId }).first();
    if (!padre || padre.kind !== 'acuerdo') throw new Error('Ese salario no admite pagos parciales.');

    const data = normalize({
      ...payload,
      // El pago hereda del acuerdo a quién se le paga y por qué proyecto: son
      // del acuerdo, no de cada pago, y volver a pedirlos es la forma de que
      // terminen diciendo cosas distintas.
      persona: padre.persona,
      moneda: payload.moneda || padre.moneda,
      banco: payload.banco || padre.banco,
      metodoPago: payload.metodoPago || padre.metodo_pago,
      kind: 'pago',
      parentId: padre.id,
      projectId: padre.project_id,
      userId: padre.user_id
    });

    const [id] = await db('finance_salaries').insert({ ...data, created_by: payload.createdBy || null });
    await this.#insertReceipts(id, payload.receipts);
    return this.getSalary(id);
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

    // Qué es la fila y de qué cuelga NO se edita desde el formulario: lo dice
    // la fila guardada. Sin esto `normalize()` los devolvía a sus valores por
    // defecto, y editar un pago de un acuerdo lo soltaba de su acuerdo (y
    // editar el acuerdo lo convertía en un pago suelto que sí descuenta).
    const padre = existing.parent_id
      ? await db('finance_salaries').where({ id: existing.parent_id }).first()
      : null;
    const data = normalize({
      ...payload,
      // El pago de un acuerdo hereda a quién se le paga, igual que al crearlo.
      persona: padre ? padre.persona : payload.persona,
      kind: existing.kind,
      parentId: existing.parent_id,
      projectId: existing.project_id,
      userId: existing.user_id
    });
    // Un acuerdo no tiene estado propio (ver `createAgreement`).
    if (existing.kind === 'acuerdo') data.estado = existing.estado;

    await db('finance_salaries').where({ id }).update(data);
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

  /**
   * Borra el pago y, con él, los archivos de sus comprobantes en disco.
   *
   * Si es un acuerdo, la base se lleva sus pagos por CASCADE — pero los
   * archivos de ESOS pagos no los borra nadie, así que se limpian acá antes.
   */
  async deleteSalary(id) {
    const ids = [Number(id), ...(await db('finance_salaries').where({ parent_id: id }).pluck('id'))];
    const receipts = await db('finance_salary_receipts').whereIn('salary_id', ids).select('filename');
    receipts.forEach((r) => unlinkQuiet(r.filename));
    return db('finance_salaries').where({ id }).del();
  }
}
