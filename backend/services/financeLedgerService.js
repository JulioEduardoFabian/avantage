import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { financeReceiptDir } from '../middleware/upload.js';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

/**
 * Ordinales admitidos para una cuota. Se ampliaron más allá de las tres
 * originales porque el cronograma que se pacta al cerrar la venta puede
 * partirse en tantos pagos como acuerden las partes (mensualidades de una
 * tesis larga, por ejemplo).
 */
export const CUOTAS = [
  '1era', '2da', '3era', '4ta', '5ta', '6ta',
  '7ma', '8va', '9na', '10ma', '11va', '12va'
];

/** El ordinal que le toca a la cuota n.º `index + 1` del cronograma. */
export function cuotaLabel(index) {
  return CUOTAS[index] || `${index + 1}va`;
}
export const EMITIR_OPCIONES = ['factura', 'boleta', 'nrus', 'rxh', 'c. interno'];
/**
 * Cuentas donde puede entrar o salir el dinero. "BCP Finanzas" es la cuenta
 * del área de finanzas, separada de la operativa ("BCP"), y se lista en todo
 * el módulo (ingresos, libro diario, gastos fijos, salarios y el resumen).
 */
export const BANCOS = ['BCP', 'BCP Finanzas', 'Interbank', 'Efectivo'];
export const MONEDAS = ['soles', 'dolares'];
/**
 * Ciclo de vida de un ingreso. "verificado" es el único estado que suma en las
 * cifras de Finanzas y el que desbloquea el proyecto asociado; solo lo pone
 * finanzas, con el permiso `finance.verify`.
 */
export const ESTADOS_INGRESO = ['pendiente', 'pagado', 'verificado'];
export const ESTADOS_DIARIO = ['pagado', 'pendiente'];

/** ITF según la fórmula del Excel: IF(H<1000, 0, INT(H/1000)*0.05), sobre el valor absoluto. */
function calcItf(monto) {
  const a = Math.abs(Number(monto) || 0);
  if (a < 1000) return 0;
  return Math.round(Math.floor(a / 1000) * 0.05 * 100) / 100;
}

function dayOnly(fecha) {
  if (fecha instanceof Date) return isoDay(fecha);
  return String(fecha).slice(0, 10);
}

/**
 * mysql2 devuelve las columnas DATE como un Date a medianoche LOCAL. Pasarlo
 * por JSON (UTC) corre el día hacia atrás, y quien lo lea del lado del
 * servidor recibe un "Mon Sep 22 2026..." que no es una fecha ISO. Las fechas
 * del cronograma se entregan siempre como "YYYY-MM-DD".
 */
function isoDay(value) {
  if (!value) return null;
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function withIsoDates(row) {
  return { ...row, fecha: isoDay(row.fecha), due_date: isoDay(row.due_date) };
}

function mesEnLetras(fecha) {
  const idx = Number(dayOnly(fecha).slice(5, 7)) - 1;
  return MESES[idx] || '';
}

/**
 * Código autogenerado: YYYYMMDD-N, con N incremental entre los registros del
 * mismo día. Se cuentan códigos distintos, no filas: en INGRESOS varias cuotas
 * del mismo cliente comparten código (ver `#codeForIncome`) y contar filas
 * dejaría huecos en el correlativo del día.
 */
async function nextCode(table, fecha) {
  const day = dayOnly(fecha);
  const prefix = day.replace(/-/g, '');
  const [{ count }] = await db(table).where('fecha', day).countDistinct({ count: 'code' });
  return `${prefix}-${Number(count) + 1}`;
}

export function unlinkQuiet(filename) {
  if (!filename) return;
  fs.unlink(path.join(financeReceiptDir, filename), () => {});
}

/** ¿El archivo sigue en `uploads/finance-receipts/`? (se pierde si el despliegue borra `uploads/`). */
export function receiptFileExists(filename) {
  if (!filename) return false;
  return fs.existsSync(path.join(financeReceiptDir, filename));
}

/** Filas de comprobante (1:N) a partir de los archivos subidos por multer. */
export function receiptRowsFromFiles(files, foreignKey, id) {
  return (files || []).map((file) => ({
    [foreignKey]: id,
    filename: file.filename,
    original_name: file.originalname || null,
    mime_type: file.mimetype || null,
    size: file.size || null
  }));
}

/**
 * Adjunta a cada fila su lista de comprobantes (`row.receipts`), marcando con
 * `missing: true` los que ya no tienen archivo en disco para que la UI lo diga
 * en vez de quedarse cargando una miniatura que nunca llegará.
 */
export async function attachReceipts(rows, table, foreignKey) {
  if (rows.length === 0) return rows;
  const receipts = await db(table)
    .whereIn(foreignKey, rows.map((r) => r.id))
    .orderBy('id', 'asc');

  const byOwner = new Map();
  for (const rcpt of receipts) {
    const list = byOwner.get(rcpt[foreignKey]) || [];
    list.push({ ...rcpt, missing: !receiptFileExists(rcpt.filename) });
    byOwner.set(rcpt[foreignKey], list);
  }
  return rows.map((r) => ({ ...r, receipts: byOwner.get(r.id) || [] }));
}

/**
 * Libro contable de Finanzas: ingresos (con comprobantes hijos), libro diario y
 * gastos fijos. Cada registro lleva un código autogenerado por día y las
 * pestañas de ingresos/diario calculan el ITF automáticamente.
 */
export class FinanceLedgerService {
  /**
   * Directorio ligero de leads para el selector de la pestaña INGRESOS, con el
   * precio total del cierre (si ya se registró) y cuánto se lleva cobrado en
   * cuotas, para que Finanzas vea de un vistazo el saldo pendiente de cada uno.
   */
  async listLeadsDirectory() {
    const leads = await db('leads')
      .select('id', 'dni', 'total_amount')
      .select(db.raw("COALESCE(NULLIF(full_name, ''), topic) as name"))
      .orderBy('name', 'asc');

    const sums = await db('finance_income')
      .whereNotNull('lead_id')
      .groupBy('lead_id')
      .select('lead_id')
      .sum('monto as registered');
    const registeredByLead = new Map(sums.map((s) => [s.lead_id, Number(s.registered) || 0]));

    return leads.map((lead) => {
      const total = lead.total_amount != null ? Number(lead.total_amount) : null;
      const registered = registeredByLead.get(lead.id) || 0;
      return {
        ...lead,
        total_amount: total,
        registered_amount: registered,
        balance_amount: total != null ? Math.round((total - registered) * 100) / 100 : null
      };
    });
  }

  /**
   * Fija (o quita, con `null`) el precio total del cierre de un lead. No se
   * puede bajar por debajo de lo que ya tiene registrado en cuotas — eso
   * dejaría ingresos existentes "sin sitio" en el total.
   */
  async setLeadTotalAmount(leadId, totalAmount) {
    const lead = await db('leads').where({ id: leadId }).first();
    if (!lead) throw new Error('Lead no encontrado.');

    let value = null;
    if (totalAmount !== null && totalAmount !== undefined && totalAmount !== '') {
      const numeric = Number(totalAmount);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new Error('El precio total debe ser un número mayor a 0.');
      }
      const { registered } = await db('finance_income').where({ lead_id: leadId }).sum('monto as registered').first();
      const registeredTotal = Number(registered) || 0;
      if (numeric < registeredTotal - 0.01) {
        throw new Error(
          `El precio total no puede ser menor a lo ya registrado en cuotas (S/ ${registeredTotal.toFixed(2)}).`
        );
      }
      value = numeric;
    }

    await db('leads').where({ id: leadId }).update({ total_amount: value });
    return db('leads').where({ id: leadId }).first();
  }

  /**
   * Un ingreso ligado a un lead no puede hacer que la suma de sus cuotas
   * supere el precio total del cierre. Si el lead no tiene precio total
   * definido (leads viejos, o ingresos sin lead asociado), no hay nada que
   * validar.
   */
  async #assertWithinLeadTotal(leadId, monto, excludeIncomeId = null) {
    if (!leadId) return;
    const lead = await db('leads').where({ id: leadId }).select('total_amount').first();
    if (!lead || lead.total_amount == null) return;

    const total = Number(lead.total_amount);
    let query = db('finance_income').where({ lead_id: leadId });
    if (excludeIncomeId) query = query.whereNot('id', excludeIncomeId);
    const { registered } = await query.sum('monto as registered').first();
    const registeredTotal = Number(registered) || 0;
    const remaining = Math.round((total - registeredTotal) * 100) / 100;

    if (monto > remaining + 0.01) {
      throw new Error(
        `El monto (S/ ${monto.toFixed(2)}) supera el saldo pendiente de este lead: ` +
        `S/ ${remaining.toFixed(2)} de un precio total de S/ ${total.toFixed(2)}.`
      );
    }
  }

  // ---------------------------------------------------------------- INGRESOS

  async listIncome() {
    const rows = await db('finance_income')
      .leftJoin('leads', 'leads.id', 'finance_income.lead_id')
      .leftJoin('users', 'users.id', 'finance_income.created_by')
      .select(
        'finance_income.*',
        db.raw("COALESCE(NULLIF(leads.full_name, ''), leads.topic) as lead_name"),
        'leads.dni as lead_dni',
        'leads.email as lead_email',
        'leads.phone as lead_phone',
        'users.name as created_by_name'
      )
      .orderBy('finance_income.fecha', 'desc')
      .orderBy('finance_income.id', 'desc');

    return attachReceipts(rows, 'finance_income_receipts', 'income_id');
  }

  /** Cuotas de UN lead/proyecto (portal de clientes: no la tabla completa de Finanzas). */
  async listIncomeByLead(leadId) {
    if (!leadId) return [];
    const rows = await db('finance_income')
      .where('finance_income.lead_id', leadId)
      .select('finance_income.*')
      .orderBy('finance_income.fecha', 'asc')
      .orderBy('finance_income.id', 'asc');

    return attachReceipts(rows, 'finance_income_receipts', 'income_id');
  }

  async getIncomeById(id) {
    const row = await db('finance_income')
      .leftJoin('leads', 'leads.id', 'finance_income.lead_id')
      .leftJoin('users', 'users.id', 'finance_income.created_by')
      .select(
        'finance_income.*',
        db.raw("COALESCE(NULLIF(leads.full_name, ''), leads.topic) as lead_name"),
        'leads.dni as lead_dni',
        'leads.email as lead_email',
        'leads.phone as lead_phone',
        // Sale impresa en el comprobante de pago.
        'leads.field_of_study as lead_career',
        'users.name as created_by_name'
      )
      .where('finance_income.id', id)
      .first();
    if (!row) return null;
    const [withReceipts] = await attachReceipts([row], 'finance_income_receipts', 'income_id');
    return withReceipts;
  }

  /**
   * Valida y normaliza los campos editables de un ingreso; los comparten el
   * alta y la edición para que ambas apliquen las mismas reglas (mes e ITF
   * siempre derivados de la fecha y el monto).
   */
  #normalizeIncome({ fecha, dueDate, leadId, cuota, emitir, monto, banco, estado, tributario }) {
    if (!fecha) throw new Error('La fecha es obligatoria.');
    if (!CUOTAS.includes(cuota)) throw new Error('La cuota debe ser 1era, 2da o 3era.');
    if (!EMITIR_OPCIONES.includes(emitir)) throw new Error('El campo "emitir" no es válido.');
    if (!BANCOS.includes(banco)) throw new Error(`El banco debe ser uno de: ${BANCOS.join(', ')}.`);
    const numericMonto = Number(monto);
    if (!Number.isFinite(numericMonto) || numericMonto <= 0) {
      throw new Error('El monto debe ser un número mayor a 0.');
    }

    const day = dayOnly(fecha);
    return {
      mes: mesEnLetras(day),
      fecha: day,
      // Vencimiento pactado; si no se indica, la cuota vence el día que se asienta.
      due_date: dueDate ? dayOnly(dueDate) : day,
      lead_id: leadId || null,
      cuota,
      emitir,
      monto: numericMonto,
      itf: calcItf(numericMonto),
      banco,
      estado: ESTADOS_INGRESO.includes(estado) ? estado : 'pendiente',
      tributario: tributario?.trim() || null
    };
  }

  /**
   * Deja el marcador `is_initial_payment` donde tiene que estar: en la PRIMERA
   * cuota del cronograma del lead (la de vencimiento más antiguo), y en una
   * sola.
   *
   * Ese marcador es el que desbloquea el proyecto al verificarse, así que si
   * se queda pegado a una cuota posterior el proyecto no se activa nunca
   * aunque el cliente ya haya pagado — y desde Finanzas no se ve por qué. Pasó:
   * alguien registró "otro primer pago" para destrabarlo y terminó con el
   * marcador en la segunda cuota. Por eso no se confía en el valor guardado:
   * se recalcula después de cada cambio en las cuotas del lead.
   *
   * Un cierre SIN marcador no se toca: son los anteriores a este flujo, que
   * nunca bloquearon su proyecto, y ponerles uno ahora los trabaría de golpe.
   * `ensure` es para el único caso en que hay que reponerlo: se borró
   * justamente la cuota que lo tenía y quedan otras.
   */
  async #syncInitialPayment(leadId, { ensure = false } = {}) {
    if (!leadId) return;
    const rows = await db('finance_income')
      .where({ lead_id: leadId })
      .select('id', 'is_initial_payment')
      .orderBy('due_date', 'asc')
      .orderBy('fecha', 'asc')
      .orderBy('id', 'asc');
    if (rows.length === 0) return;
    if (!ensure && !rows.some((row) => row.is_initial_payment)) return;

    const first = rows[0];
    const isCorrect = (row) => Boolean(row.is_initial_payment) === (row.id === first.id);
    if (rows.every(isCorrect)) return;

    await db('finance_income').where({ lead_id: leadId }).update({ is_initial_payment: false });
    await db('finance_income').where({ id: first.id }).update({ is_initial_payment: true });
  }

  /** El pago inicial ya registrado de un lead, si lo tiene (uno por lead). */
  async findInitialPaymentByLead(leadId) {
    if (!leadId) return null;
    const row = await db('finance_income')
      .where({ lead_id: leadId, is_initial_payment: true })
      .orderBy('id', 'asc')
      .first();
    return row || null;
  }

  /** Borra del disco un archivo recién subido cuya operación no prosperó. */
  discardUploadedFile(file) {
    unlinkQuiet(file?.filename);
  }

  /**
   * El código de un ingreso identifica al cliente, no al asiento: todas las
   * cuotas de un mismo lead comparten el código de la primera, porque en la
   * práctica el equipo lo usa para referirse a la persona ("el 20260917-1").
   * Solo se genera uno nuevo cuando el lead todavía no tiene ingresos o cuando
   * el ingreso no está asociado a ninguno.
   */
  async #codeForIncome(leadId, fecha) {
    if (leadId) {
      const existing = await db('finance_income')
        .where({ lead_id: leadId })
        .whereNotNull('code')
        .orderBy('id', 'asc')
        .first('code');
      if (existing?.code) return existing.code;
    }
    return nextCode('finance_income', fecha);
  }

  async createIncome({ createdBy, isInitialPayment, ...fields }) {
    const values = this.#normalizeIncome(fields);
    await this.#assertWithinLeadTotal(values.lead_id, values.monto);
    const [id] = await db('finance_income').insert({
      ...values,
      code: await this.#codeForIncome(values.lead_id, values.fecha),
      is_initial_payment: Boolean(isInitialPayment),
      created_by: createdBy || null
    });
    await this.#syncInitialPayment(values.lead_id);
    return this.getIncomeById(id);
  }

  /**
   * Edita un ingreso ya registrado. El código no se regenera aunque cambie la
   * fecha: es el identificador con el que ya se referencia el asiento. Sí
   * cambia si el ingreso pasa a otro lead, porque el código es de la persona.
   */
  async updateIncome(id, fields) {
    const existing = await db('finance_income').where({ id }).first();
    if (!existing) return null;
    const values = this.#normalizeIncome(fields);
    await this.#assertWithinLeadTotal(values.lead_id, values.monto, id);
    if (values.lead_id && values.lead_id !== existing.lead_id) {
      values.code = await this.#codeForIncome(values.lead_id, values.fecha);
    }
    // Verificar es un acto de finanzas, no un campo más del formulario: editar
    // el ingreso no puede darle ni quitarle el visto bueno.
    if (existing.estado === 'verificado' || values.estado === 'verificado') {
      values.estado = existing.estado;
    }
    await db('finance_income').where({ id }).update(values);
    // Cambiar el vencimiento (o mover la cuota a otro lead) reordena el
    // cronograma, y con él cuál es la primera cuota.
    await this.#syncInitialPayment(values.lead_id);
    if (existing.lead_id && existing.lead_id !== values.lead_id) await this.#syncInitialPayment(existing.lead_id);
    return this.getIncomeById(id);
  }

  /**
   * Cronograma de pagos de un lead: las cuotas pactadas, en orden de
   * vencimiento. Es lo mismo que sus ingresos de Finanzas — el plan no vive en
   * otra tabla — pero leído como plan: primero lo que vence antes.
   */
  async listScheduleByLead(leadId) {
    if (!leadId) return [];
    const rows = await db('finance_income')
      .where({ lead_id: leadId })
      .select('*')
      .orderBy('due_date', 'asc')
      .orderBy('id', 'asc');
    return (await attachReceipts(rows, 'finance_income_receipts', 'income_id')).map(withIsoDates);
  }

  /**
   * Una cuota ya cobrada (con comprobante subido o verificada por Finanzas) no
   * se puede borrar ni cambiarle el monto desde el cronograma: el dinero ya
   * entró y el asiento tiene que seguir cuadrando con el banco. Solo las
   * cuotas todavía `pendiente` y sin comprobante son editables.
   */
  static #isSettled(row) {
    return row.estado !== 'pendiente' || Number(row.receipt_count) > 0;
  }

  /**
   * Reemplaza el cronograma de pagos de un lead por la lista recibida. Es el
   * método que comparten el cierre de venta (modal "lead ganado") y el
   * contrato: en los dos lados se edita el MISMO plan, así que lo que se pacta
   * en el contrato es exactamente lo que Finanzas va a cobrar, sin copiar
   * datos de un módulo a otro.
   *
   * Cada entrada es `{ id?, monto, dueDate, emitir?, banco? }`: con `id` se
   * actualiza la cuota existente, sin `id` se crea una nueva, y las cuotas que
   * ya no aparecen en la lista se eliminan (si todavía nadie las cobró). El
   * ordinal (`cuota`) no se manda: se renumera solo por fecha de vencimiento.
   */
  async replaceScheduleForLead(leadId, installments, { createdBy = null } = {}) {
    if (!leadId) throw new Error('El cronograma necesita un lead asociado.');
    const lead = await db('leads').where({ id: leadId }).first();
    if (!lead) throw new Error('Lead no encontrado.');

    const entries = (Array.isArray(installments) ? installments : []).map((item, index) => {
      const monto = Number(item.monto);
      if (!Number.isFinite(monto) || monto <= 0) {
        throw new Error(`La cuota ${index + 1} debe tener un monto mayor a 0.`);
      }
      if (!item.dueDate) throw new Error(`La cuota ${index + 1} necesita una fecha de vencimiento.`);
      return {
        id: item.id ? Number(item.id) : null,
        monto: Math.round(monto * 100) / 100,
        dueDate: dayOnly(item.dueDate),
        emitir: EMITIR_OPCIONES.includes(item.emitir) ? item.emitir : null,
        banco: BANCOS.includes(item.banco) ? item.banco : null
      };
    });

    if (lead.total_amount != null && entries.length > 0) {
      const planned = entries.reduce((sum, e) => sum + e.monto, 0);
      const total = Number(lead.total_amount);
      if (planned > total + 0.01) {
        throw new Error(
          `El cronograma suma S/ ${planned.toFixed(2)} y el precio total del cierre es S/ ${total.toFixed(2)}.`
        );
      }
    }

    const current = await db('finance_income')
      .where({ lead_id: leadId })
      .select('finance_income.*')
      .select(db.raw('(SELECT COUNT(*) FROM finance_income_receipts WHERE income_id = finance_income.id) as receipt_count'));
    const byId = new Map(current.map((row) => [row.id, row]));

    // Todo lo que rompe reglas se detecta ANTES de escribir nada: un
    // cronograma se guarda entero o no se guarda.
    const keptIds = new Set(entries.map((e) => e.id).filter(Boolean));
    for (const row of current) {
      if (keptIds.has(row.id)) continue;
      if (FinanceLedgerService.#isSettled(row)) {
        throw new Error(`La cuota ${row.cuota} (S/ ${Number(row.monto).toFixed(2)}) ya se cobró: no se puede quitar del cronograma.`);
      }
    }
    for (const entry of entries) {
      if (!entry.id) continue;
      const row = byId.get(entry.id);
      if (!row) throw new Error('Una de las cuotas del cronograma ya no existe.');
      if (FinanceLedgerService.#isSettled(row) && Math.abs(Number(row.monto) - entry.monto) > 0.01) {
        throw new Error(`La cuota ${row.cuota} ya se cobró: su monto no se puede cambiar desde el cronograma.`);
      }
    }

    const order = [...entries].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const ordinalOf = new Map(order.map((entry, index) => [entry, cuotaLabel(index)]));
    const code = await this.#codeForIncome(leadId, order[0]?.dueDate || dayOnly(new Date().toISOString()));

    for (const row of current) {
      if (!keptIds.has(row.id)) await this.deleteIncome(row.id);
    }

    for (const entry of order) {
      const existing = entry.id ? byId.get(entry.id) : null;
      if (existing) {
        const settled = FinanceLedgerService.#isSettled(existing);
        await db('finance_income').where({ id: existing.id }).update({
          cuota: ordinalOf.get(entry),
          due_date: entry.dueDate,
          // Una cuota cobrada conserva el día en que entró el dinero; una
          // pendiente se asienta el día que se pactó hasta que se pague.
          ...(settled ? {} : { fecha: entry.dueDate, mes: mesEnLetras(entry.dueDate), monto: entry.monto, itf: calcItf(entry.monto) }),
          ...(entry.emitir ? { emitir: entry.emitir } : {}),
          ...(entry.banco ? { banco: entry.banco } : {})
        });
      } else {
        await db('finance_income').insert({
          code,
          mes: mesEnLetras(entry.dueDate),
          fecha: entry.dueDate,
          due_date: entry.dueDate,
          lead_id: leadId,
          cuota: ordinalOf.get(entry),
          emitir: entry.emitir || 'boleta',
          monto: entry.monto,
          itf: calcItf(entry.monto),
          banco: entry.banco || 'BCP',
          estado: 'pendiente',
          is_initial_payment: false,
          created_by: createdBy
        });
      }
    }

    await this.#syncInitialPayment(leadId);
    return this.listScheduleByLead(leadId);
  }

  /**
   * Marca el ingreso como cobrado o lo devuelve a pendiente. No pasa por aquí
   * la verificación: esa tiene su propio método porque exige otro permiso y
   * arrastra el desbloqueo del proyecto.
   */
  async updateIncomeEstado(id, estado) {
    if (!['pendiente', 'pagado'].includes(estado)) {
      throw new Error('El estado debe ser "pendiente" o "pagado".');
    }
    const existing = await db('finance_income').where({ id }).first();
    if (!existing) return null;
    if (existing.estado === 'verificado') {
      throw new Error('Este ingreso ya está verificado: quita la verificación antes de cambiar su estado.');
    }
    await db('finance_income').where({ id }).update({ estado });
    return this.getIncomeById(id);
  }

  /**
   * Visto bueno de finanzas (permiso `finance.verify`). Es lo que hace que el
   * ingreso empiece a sumar en las cifras del módulo y que el proyecto del
   * lead pase de "Creado" (bloqueado) a "Activo".
   *
   * Al quitar la verificación el proyecto vuelve a quedar bloqueado, pero se
   * respeta el avance: solo se devuelve a "Creado" si seguía en "Activo".
   */
  async setIncomeVerificacion(id, { verified, verifiedBy } = {}) {
    const income = await db('finance_income').where({ id }).first();
    if (!income) return null;

    if (verified) {
      await db('finance_income').where({ id }).update({
        estado: 'verificado',
        verified_at: db.fn.now(),
        verified_by: verifiedBy || null
      });
    } else {
      await db('finance_income').where({ id }).update({
        // Sin verificación vuelve a "pagado" si tiene comprobante, y a
        // "pendiente" si nunca llegó a tenerlo.
        estado: (await db('finance_income_receipts').where('income_id', id).first()) ? 'pagado' : 'pendiente',
        verified_at: null,
        verified_by: null
      });
    }
    return this.getIncomeById(id);
  }

  /** Adjunta (o reemplaza) el archivo/imagen del campo tributario de un ingreso. */
  async setTributarioFile(id, file) {
    if (!file) throw new Error('No se recibió ningún archivo.');
    const income = await db('finance_income').where({ id }).first();
    if (!income) {
      unlinkQuiet(file.filename);
      throw new Error('Ingreso no encontrado.');
    }
    unlinkQuiet(income.tributario_filename);
    await db('finance_income').where({ id }).update({
      tributario_filename: file.filename,
      tributario_original_name: file.originalname || null,
      tributario_mime_type: file.mimetype || null,
      tributario_size: file.size || null
    });
    return this.getIncomeById(id);
  }

  async deleteTributarioFile(id) {
    const income = await db('finance_income').where({ id }).first();
    if (!income) return null;
    unlinkQuiet(income.tributario_filename);
    await db('finance_income').where({ id }).update({
      tributario_filename: null,
      tributario_original_name: null,
      tributario_mime_type: null,
      tributario_size: null
    });
    return this.getIncomeById(id);
  }

  async deleteIncome(id) {
    const income = await db('finance_income').where({ id }).select('tributario_filename', 'lead_id', 'is_initial_payment').first();
    if (income) unlinkQuiet(income.tributario_filename);
    const receipts = await db('finance_income_receipts').where('income_id', id).select('filename');
    receipts.forEach((r) => unlinkQuiet(r.filename));
    const deleted = await db('finance_income').where({ id }).del();
    // Si se borró la cuota que desbloqueaba el proyecto, el marcador pasa a
    // la que quedó primera: si no, el cierre se quedaría sin ninguna.
    await this.#syncInitialPayment(income?.lead_id, { ensure: Boolean(income?.is_initial_payment) });
    return deleted;
  }

  // ------------------------------------------------------------ COMPROBANTES

  /** Adjunta uno o varios comprobantes a un ingreso. */
  async addIncomeReceipts(incomeId, files) {
    const rows = receiptRowsFromFiles(files, 'income_id', incomeId);
    if (rows.length === 0) throw new Error('No se recibió ningún comprobante.');
    const income = await db('finance_income').where({ id: incomeId }).first();
    if (!income) {
      rows.forEach((r) => unlinkQuiet(r.filename));
      throw new Error('Ingreso no encontrado.');
    }
    await db('finance_income_receipts').insert(rows);
    // Adjuntar el voucher es lo que da por cobrado el ingreso; la verificación
    // la sigue haciendo finanzas aparte.
    if (income.estado === 'pendiente') {
      await db('finance_income').where({ id: incomeId }).update({ estado: 'pagado' });
    }
    return db('finance_income_receipts')
      .where('income_id', incomeId)
      .whereIn('filename', rows.map((r) => r.filename))
      .orderBy('id', 'asc');
  }

  async getReceiptById(id) {
    return db('finance_income_receipts').where({ id }).first();
  }

  async deleteReceipt(id) {
    const receipt = await db('finance_income_receipts').where({ id }).first();
    if (receipt) unlinkQuiet(receipt.filename);
    return db('finance_income_receipts').where({ id }).del();
  }

  // ------------------------------------------------------------- LIBRO DIARIO

  async listJournal() {
    const rows = await db('finance_journal')
      .leftJoin('users', 'users.id', 'finance_journal.created_by')
      .select('finance_journal.*', 'users.name as created_by_name')
      .orderBy('finance_journal.fecha', 'desc')
      .orderBy('finance_journal.id', 'desc');
    return attachReceipts(rows, 'finance_journal_receipts', 'journal_id');
  }

  async getJournalById(id) {
    const row = await db('finance_journal')
      .leftJoin('users', 'users.id', 'finance_journal.created_by')
      .select('finance_journal.*', 'users.name as created_by_name')
      .where('finance_journal.id', id)
      .first();
    if (!row) return null;
    const [withReceipts] = await attachReceipts([row], 'finance_journal_receipts', 'journal_id');
    return withReceipts;
  }

  /** Valida y normaliza los campos editables de un asiento (alta y edición). */
  #normalizeJournal({ fecha, detalle, monto, moneda, banco, estado, area, asientoPorDestino }) {
    if (!fecha) throw new Error('La fecha es obligatoria.');
    if (!detalle || !detalle.trim()) throw new Error('El detalle es obligatorio.');
    if (!BANCOS.includes(banco)) throw new Error(`El banco debe ser uno de: ${BANCOS.join(', ')}.`);
    const numericMonto = Number(monto);
    if (!Number.isFinite(numericMonto)) throw new Error('El monto debe ser un número.');

    return {
      fecha: dayOnly(fecha),
      detalle: detalle.trim(),
      monto: numericMonto,
      moneda: MONEDAS.includes(moneda) ? moneda : 'soles',
      itf: calcItf(numericMonto),
      banco,
      estado: ESTADOS_DIARIO.includes(estado) ? estado : 'pendiente',
      area: area?.trim() || null,
      asiento_por_destino: asientoPorDestino?.trim() || null
    };
  }

  async createJournal({ receipts, createdBy, ...fields }) {
    const files = receipts || [];
    try {
      const values = this.#normalizeJournal(fields);
      const [id] = await db('finance_journal').insert({
        ...values,
        code: await nextCode('finance_journal', values.fecha),
        created_by: createdBy || null
      });
      const rows = receiptRowsFromFiles(files, 'journal_id', id);
      if (rows.length > 0) await db('finance_journal_receipts').insert(rows);
      return this.getJournalById(id);
    } catch (error) {
      files.forEach((f) => unlinkQuiet(f.filename));
      throw error;
    }
  }

  /**
   * Edita un asiento del libro diario. El código se mantiene aunque cambie la
   * fecha. Los comprobantes que lleguen se suman a los que ya tenía (se
   * eliminan de uno en uno con `deleteJournalReceipt`).
   */
  async updateJournal(id, { receipts, ...fields }) {
    const files = receipts || [];
    const existing = await db('finance_journal').where({ id }).first();
    if (!existing) {
      files.forEach((f) => unlinkQuiet(f.filename));
      return null;
    }
    try {
      await db('finance_journal').where({ id }).update(this.#normalizeJournal(fields));
      const rows = receiptRowsFromFiles(files, 'journal_id', id);
      if (rows.length > 0) await db('finance_journal_receipts').insert(rows);
      return this.getJournalById(id);
    } catch (error) {
      files.forEach((f) => unlinkQuiet(f.filename));
      throw error;
    }
  }

  async deleteJournal(id) {
    const receipts = await db('finance_journal_receipts').where('journal_id', id).select('filename');
    receipts.forEach((r) => unlinkQuiet(r.filename));
    return db('finance_journal').where({ id }).del();
  }

  /** Adjunta uno o varios comprobantes a un asiento ya registrado. */
  async addJournalReceipts(journalId, files) {
    const rows = receiptRowsFromFiles(files, 'journal_id', journalId);
    if (rows.length === 0) throw new Error('No se recibió ningún comprobante.');
    const journal = await db('finance_journal').where({ id: journalId }).first();
    if (!journal) {
      rows.forEach((r) => unlinkQuiet(r.filename));
      throw new Error('Asiento no encontrado.');
    }
    await db('finance_journal_receipts').insert(rows);
    return db('finance_journal_receipts')
      .where('journal_id', journalId)
      .whereIn('filename', rows.map((r) => r.filename))
      .orderBy('id', 'asc');
  }

  async getJournalReceiptById(id) {
    return db('finance_journal_receipts').where({ id }).first();
  }

  async deleteJournalReceipt(id) {
    const receipt = await db('finance_journal_receipts').where({ id }).first();
    if (receipt) unlinkQuiet(receipt.filename);
    return db('finance_journal_receipts').where({ id }).del();
  }

  // ------------------------------------------------------------- GASTOS FIJOS

  async listFixedExpenses() {
    return db('finance_fixed_expenses')
      .leftJoin('users', 'users.id', 'finance_fixed_expenses.created_by')
      .select('finance_fixed_expenses.*', 'users.name as created_by_name')
      .orderBy('finance_fixed_expenses.fecha', 'desc')
      .orderBy('finance_fixed_expenses.id', 'desc');
  }

  async createFixedExpense({ fecha, concepto, metodoPago, detalle, banco, createdBy }) {
    if (!fecha) throw new Error('La fecha es obligatoria.');
    if (!concepto || !concepto.trim()) throw new Error('El concepto es obligatorio.');
    const bancoFinal = banco && BANCOS.includes(banco) ? banco : (banco?.trim() || null);

    const day = dayOnly(fecha);
    const [id] = await db('finance_fixed_expenses').insert({
      code: await nextCode('finance_fixed_expenses', day),
      concepto: concepto.trim(),
      metodo_pago: metodoPago?.trim() || null,
      fecha: day,
      detalle: detalle?.trim() || null,
      banco: bancoFinal,
      created_by: createdBy || null
    });
    return db('finance_fixed_expenses').where({ id }).first();
  }

  async updateFixedExpense(id, { fecha, concepto, metodoPago, detalle, banco }) {
    const existing = await db('finance_fixed_expenses').where({ id }).first();
    if (!existing) return null;
    if (!fecha) throw new Error('La fecha es obligatoria.');
    if (!concepto || !concepto.trim()) throw new Error('El concepto es obligatorio.');
    const bancoFinal = banco && BANCOS.includes(banco) ? banco : (banco?.trim() || null);

    await db('finance_fixed_expenses').where({ id }).update({
      fecha: dayOnly(fecha),
      concepto: concepto.trim(),
      metodo_pago: metodoPago?.trim() || null,
      detalle: detalle?.trim() || null,
      banco: bancoFinal
    });
    return db('finance_fixed_expenses').where({ id }).first();
  }

  async deleteFixedExpense(id) {
    return db('finance_fixed_expenses').where({ id }).del();
  }

  /**
   * Panel de control de pago mensual: cada gasto fijo con el estado
   * (pagado/pendiente) de los últimos `monthsBack` meses.
   */
  async getFixedExpensesPanel({ monthsBack = 6 } = {}) {
    const months = Math.min(Math.max(Number(monthsBack) || 6, 1), 24);
    const now = new Date();
    const periods = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const expenses = await db('finance_fixed_expenses')
      .select('id', 'code', 'concepto', 'metodo_pago', 'banco')
      .orderBy('concepto', 'asc');

    if (expenses.length === 0) return { periods, expenses: [] };

    const payments = await db('finance_fixed_expense_payments')
      .whereIn('fixed_expense_id', expenses.map((e) => e.id))
      .whereIn('period', periods)
      .select('fixed_expense_id', 'period', 'estado', 'paid_at');

    const byExpense = new Map();
    for (const p of payments) {
      if (!byExpense.has(p.fixed_expense_id)) byExpense.set(p.fixed_expense_id, {});
      byExpense.get(p.fixed_expense_id)[p.period] = { estado: p.estado, paid_at: p.paid_at };
    }

    return {
      periods,
      expenses: expenses.map((e) => ({
        ...e,
        payments: Object.fromEntries(periods.map((period) => [
          period,
          byExpense.get(e.id)?.[period] || { estado: 'pendiente', paid_at: null }
        ]))
      }))
    };
  }

  /** Marca (upsert) el estado de pago de un gasto fijo para un mes concreto. */
  async setFixedExpensePayment(expenseId, period, { estado, updatedBy } = {}) {
    if (!/^\d{4}-\d{2}$/.test(period || '')) {
      throw new Error('El periodo debe tener el formato YYYY-MM.');
    }
    if (!['pagado', 'pendiente'].includes(estado)) {
      throw new Error('El estado debe ser "pagado" o "pendiente".');
    }
    const expense = await db('finance_fixed_expenses').where({ id: expenseId }).first();
    if (!expense) throw new Error('Gasto fijo no encontrado.');

    const row = {
      fixed_expense_id: expenseId,
      period,
      estado,
      paid_at: estado === 'pagado' ? new Date().toISOString().slice(0, 10) : null,
      updated_by: updatedBy || null,
      updated_at: db.fn.now()
    };

    await db('finance_fixed_expense_payments')
      .insert(row)
      .onConflict(['fixed_expense_id', 'period'])
      .merge(['estado', 'paid_at', 'updated_by', 'updated_at']);

    return db('finance_fixed_expense_payments')
      .where({ fixed_expense_id: expenseId, period })
      .first();
  }

  // --------------------------------------------------------------- FINANZAS

  /**
   * Resumen para la pestaña FINANZAS: ingresos y egresos por mes, desglosados
   * por banco (BCP, Interbank, Efectivo).
   *
   *  - Ingresos = `finance_income` + asientos positivos del libro diario (en soles).
   *  - Egresos  = asientos negativos del libro diario (en soles, en valor absoluto).
   *
   * Solo cuenta el dinero confirmado: los ingresos verificados por finanzas y
   * los asientos del libro diario ya pagados. Lo pendiente (o pagado pero sin
   * verificar) todavía no es dinero en caja y falsearía el balance.
   */
  async getOverview({ monthsBack = 6 } = {}) {
    const months = Math.min(Math.max(Number(monthsBack) || 6, 1), 24);
    const now = new Date();
    const monthKeys = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const earliest = `${monthKeys[0]}-01`;

    const incomeRows = await db('finance_income')
      .select('banco')
      .select(db.raw("DATE_FORMAT(fecha, '%Y-%m') as month"))
      .sum('monto as total')
      .where('fecha', '>=', earliest)
      .where('estado', 'verificado')
      .groupBy('banco', 'month');

    const journalRows = await db('finance_journal')
      .select('banco')
      .select(db.raw("DATE_FORMAT(fecha, '%Y-%m') as month"))
      .select(db.raw('SUM(CASE WHEN monto >= 0 THEN monto ELSE 0 END) as ingreso'))
      .select(db.raw('SUM(CASE WHEN monto < 0 THEN -monto ELSE 0 END) as egreso'))
      .where('fecha', '>=', earliest)
      .where('moneda', 'soles')
      .where('estado', 'pagado')
      .groupBy('banco', 'month');

    const emptyGrid = () => Object.fromEntries(
      BANCOS.map((b) => [b, Object.fromEntries(monthKeys.map((m) => [m, 0]))])
    );
    const ingresos = emptyGrid();
    const egresos = emptyGrid();

    for (const r of incomeRows) {
      if (ingresos[r.banco]?.[r.month] !== undefined) {
        ingresos[r.banco][r.month] += Number(r.total) || 0;
      }
    }
    for (const r of journalRows) {
      if (ingresos[r.banco]?.[r.month] !== undefined) {
        ingresos[r.banco][r.month] += Number(r.ingreso) || 0;
      }
      if (egresos[r.banco]?.[r.month] !== undefined) {
        egresos[r.banco][r.month] += Number(r.egreso) || 0;
      }
    }

    const toSeries = (grid) => BANCOS.map((banco) => ({
      banco,
      values: monthKeys.map((m) => Math.round(grid[banco][m] * 100) / 100)
    }));
    const bankTotal = (grid, banco) => monthKeys.reduce((s, m) => s + grid[banco][m], 0);
    const grandTotal = (grid) => BANCOS.reduce((s, b) => s + bankTotal(grid, b), 0);

    const totalIngresos = Math.round(grandTotal(ingresos) * 100) / 100;
    const totalEgresos = Math.round(grandTotal(egresos) * 100) / 100;

    const [incomeCount] = await db('finance_income')
      .where('fecha', '>=', earliest)
      .where('estado', 'verificado')
      .count('id as cnt');
    const [journalCount] = await db('finance_journal')
      .where('fecha', '>=', earliest)
      .where('moneda', 'soles')
      .where('estado', 'pagado')
      .count('id as cnt');
    const totalTransactions = (Number(incomeCount?.cnt) || 0) + (Number(journalCount?.cnt) || 0);

    const recentIncome = await db('finance_income')
      .leftJoin('leads', 'leads.id', 'finance_income.lead_id')
      .select(
        'finance_income.id',
        'finance_income.code',
        'finance_income.fecha',
        'finance_income.monto',
        'finance_income.banco',
        'finance_income.cuota',
        db.raw("COALESCE(NULLIF(leads.full_name, ''), leads.topic, 'Cliente') as client_name")
      )
      .where('finance_income.estado', 'verificado')
      .orderBy('finance_income.fecha', 'desc')
      .orderBy('finance_income.id', 'desc')
      .limit(8);

    const recentJournal = await db('finance_journal')
      .select('id', 'code', 'fecha', 'monto', 'banco', 'detalle', 'area')
      .where('moneda', 'soles')
      .where('estado', 'pagado')
      .orderBy('fecha', 'desc')
      .orderBy('id', 'desc')
      .limit(8);

    const recentTransactions = [
      ...recentIncome.map((r) => ({
        id: `inc-${r.id}`,
        code: r.code,
        fecha: r.fecha,
        title: r.client_name,
        subtitle: r.cuota ? `Cuota ${r.cuota}` : 'Ingreso por cuota',
        banco: r.banco,
        amount: Number(r.monto) || 0,
        type: 'in',
        source: 'income'
      })),
      ...recentJournal.map((r) => {
        const num = Number(r.monto) || 0;
        return {
          id: `jrn-${r.id}`,
          code: r.code,
          fecha: r.fecha,
          title: r.detalle || 'Movimiento contable',
          subtitle: r.area || (num >= 0 ? 'Ingreso operativo' : 'Egreso operativo'),
          banco: r.banco,
          amount: Math.abs(num),
          type: num >= 0 ? 'in' : 'out',
          source: 'journal'
        };
      })
    ]
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, 8);

    return {
      months: monthKeys,
      banks: BANCOS,
      ingresos: toSeries(ingresos),
      egresos: toSeries(egresos),
      totals: {
        ingresos: totalIngresos,
        egresos: totalEgresos,
        balance: Math.round((totalIngresos - totalEgresos) * 100) / 100,
        totalTransactions,
        byBank: BANCOS.map((banco) => ({
          banco,
          ingresos: Math.round(bankTotal(ingresos, banco) * 100) / 100,
          egresos: Math.round(bankTotal(egresos, banco) * 100) / 100
        }))
      },
      recentTransactions
    };
  }
}
