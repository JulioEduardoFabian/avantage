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

/**
 * El ITF que se guarda: el que mandó el formulario, o el de la fórmula si no
 * mandó ninguno.
 *
 * La fórmula es la del Excel del área y acierta casi siempre, pero el banco
 * cobra lo que cobra: hay cuentas exoneradas, operaciones entre cuentas
 * propias y redondeos que no cuadran, y hasta ahora el campo era de solo
 * lectura y esa diferencia se quedaba fuera de los libros. Ahora la fórmula es
 * el **valor propuesto** y el que registra puede corregirlo.
 *
 * Un `itf` ausente, vacío o nulo NO es un cero: significa "no me lo dieron,
 * calculalo". Un cero explícito sí se respeta — es exactamente el caso de la
 * cuenta exonerada, y tratarlo como "no vino" haría imposible registrarlo.
 */
export function resolveItf(itf, monto) {
  if (itf === undefined || itf === null || itf === '') return calcItf(monto);
  const numeric = Number(itf);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error('El ITF debe ser un número mayor o igual a 0.');
  }
  return Math.round(numeric * 100) / 100;
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
      .select('id', 'dni', 'total_amount', 'deal_cancelled_at')
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
        balance_amount: total != null ? Math.round((total - registered) * 100) / 100 : null,
        // Un cierre caído conserva su saldo (es historia), pero quien lo mira
        // tiene que saber que ese saldo ya no se espera.
        deal_cancelled: Boolean(lead.deal_cancelled_at)
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
      .leftJoin('users as cancelador', 'cancelador.id', 'leads.deal_cancelled_by')
      .select(
        'finance_income.*',
        db.raw("COALESCE(NULLIF(leads.full_name, ''), leads.topic) as lead_name"),
        'leads.dni as lead_dni',
        'leads.email as lead_email',
        'leads.phone as lead_phone',
        // Viaja con cada cuota porque la pantalla agrupa por lead y necesita
        // pintar el cierre caído sin pedir el directorio aparte.
        'leads.deal_cancelled_at as lead_deal_cancelled_at',
        'leads.deal_cancelled_reason as lead_deal_cancelled_reason',
        'cancelador.name as lead_deal_cancelled_by_name',
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
   * alta y la edición para que ambas apliquen las mismas reglas (el mes sale
   * siempre de la fecha; el ITF se propone con la fórmula y se puede corregir,
   * ver `resolveItf`).
   */
  #normalizeIncome({ fecha, dueDate, leadId, cuota, emitir, monto, itf, banco, estado, tributario }) {
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
      itf: resolveItf(itf, numericMonto),
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

  /**
   * Lo que un lead ya tiene registrado en Finanzas, mirado desde el cierre de
   * venta: su precio total, la suma de lo ya asentado en cuotas y cuánto falta
   * por registrar.
   *
   * Existe porque el cierre NO siempre es el primer sitio donde aparece el
   * dinero: el cronograma también nace del contrato (`replaceScheduleForLead`)
   * y Finanzas puede asentar el pago por su cuenta. Cuando eso ya pasó, el
   * modal de cierre pedía igual "el primer pago" y el alta chocaba contra
   * `#assertWithinLeadTotal` ("supera el saldo pendiente... S/ 0.00") sin decir
   * que el dinero ya estaba — y el lead se quedaba sin poder ganarse.
   *
   * Va aparte de `listLeadsDirectory()` porque esto lo lee el closer con
   * `leads.view` —es su propia venta, el precio lo fija él en este mismo
   * modal— y aquel es el directorio completo de Finanzas.
   */
  async getLeadSettlement(leadId) {
    const empty = { total: null, registered: 0, remaining: null, installments: [], cancelled: false };
    if (!leadId) return empty;
    const lead = await db('leads').where({ id: leadId })
      .select('total_amount', 'deal_cancelled_at', 'deal_cancelled_reason').first();
    if (!lead) return empty;

    const rows = await db('finance_income')
      .where({ lead_id: leadId })
      .select('id', 'code', 'cuota', 'monto', 'itf', 'emitir', 'banco', 'estado', 'fecha', 'due_date', 'is_initial_payment')
      .orderBy('due_date', 'asc')
      .orderBy('id', 'asc');

    const total = lead.total_amount != null ? Number(lead.total_amount) : null;
    const registered = Math.round(rows.reduce((sum, row) => sum + Number(row.monto), 0) * 100) / 100;
    return {
      total,
      registered,
      remaining: total != null ? Math.round((total - registered) * 100) / 100 : null,
      cancelled: Boolean(lead.deal_cancelled_at),
      cancelled_reason: lead.deal_cancelled_reason || null,
      installments: rows.map((row) => ({
        ...withIsoDates(row),
        monto: Number(row.monto),
        is_initial_payment: Boolean(row.is_initial_payment)
      }))
    };
  }

  /**
   * Pone el marcador de pago inicial en la primera cuota del lead cuando
   * todavía no lo tiene ninguna. Lo usa el cierre de venta que se registra
   * sobre cuotas que ya existían: el proyecto que acaba de nacer tiene que
   * quedar esperando la verificación de ese pago igual que cualquier otro
   * cierre. Fuera de ese momento el marcador no se repone solo (ver
   * `#syncInitialPayment`).
   */
  async ensureInitialPayment(leadId) {
    await this.#syncInitialPayment(leadId, { ensure: true });
  }

  /**
   * Da por caído un cierre (o lo reactiva). Es lo que pasa cuando el cliente se
   * arrepiente después de firmar: el cronograma queda ahí —es historia, y
   * borrarlo se llevaría por delante lo que sí llegó a cobrarse— pero deja de
   * contar como plata que se espera.
   *
   * Lo que cambia es UNA marca en el lead. Deliberadamente NO se tocan los
   * estados de las cuotas:
   *
   *  - Lo ya `verificado` entró de verdad y tiene que seguir en los libros. Un
   *    cierre caído no deshace un pago cobrado; si hubo devolución, eso es un
   *    egreso del Libro Diario y se registra como tal.
   *  - Deshacerlo es borrar la marca. Si se hubieran reescrito las cuotas,
   *    reactivar exigiría acordarse de en qué estado estaba cada una.
   *
   * Quienes leen la marca lo hacen en cada consulta (Cobranzas la excluye de la
   * lista de a quién llamar, Finanzas deja de esperar su saldo): el dato vive
   * en un solo sitio y nadie guarda una copia derivada.
   */
  async setDealCancelled(leadId, { cancelled, reason = null, actorId = null } = {}) {
    const lead = await db('leads').where({ id: leadId }).first();
    if (!lead) throw new Error('Lead no encontrado.');

    if (!cancelled) {
      await db('leads').where({ id: leadId }).update({
        deal_cancelled_at: null,
        deal_cancelled_by: null,
        deal_cancelled_reason: null
      });
      return this.getLeadSettlement(leadId);
    }

    const text = String(reason || '').trim();
    await db('leads').where({ id: leadId }).update({
      deal_cancelled_at: new Date(),
      deal_cancelled_by: actorId || null,
      deal_cancelled_reason: text ? text.slice(0, 255) : null
    });
    return this.getLeadSettlement(leadId);
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
          //
          // El ITF se recalcula SOLO si el monto cambió: el cronograma no tiene
          // campo de ITF, así que recalcularlo siempre le borraría en silencio
          // la corrección a quien la hizo a mano desde INGRESOS, por abrir el
          // plan de pagos y guardarlo sin tocar los importes.
          ...(settled ? {} : {
            fecha: entry.dueDate,
            mes: mesEnLetras(entry.dueDate),
            monto: entry.monto,
            ...(Math.abs(Number(existing.monto) - entry.monto) > 0.01 ? { itf: calcItf(entry.monto) } : {})
          }),
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
  #normalizeJournal({ fecha, detalle, monto, itf, moneda, banco, estado, area, asientoPorDestino }) {
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
      itf: resolveItf(itf, numericMonto),
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

  /**
   * Pasa un asiento de pendiente a pagado y al revés, sin tocar nada más.
   *
   * Va aparte de `updateJournal()` porque es otra operación: aquella pide el
   * asiento entero (fecha, monto, banco, detalle) y es la que se usa desde el
   * formulario; esta es un clic sobre la celda de estado en la tabla. Mandar el
   * asiento completo para cambiar una palabra obliga a la pantalla a reenviar
   * campos que nadie editó, y cualquiera que llegue vacío o normalizado
   * distinto se reescribe de paso — un recálculo de ITF o una fecha corrida por
   * una vuelta que solo quería decir "esto ya se pagó".
   *
   * De este estado cuelgan los totales de la pestaña: lo pendiente es dinero
   * que todavía no se movió y suma aparte, así que el clic cambia las cifras de
   * arriba y no solo el color de la píldora.
   */
  async updateJournalEstado(id, estado) {
    if (!ESTADOS_DIARIO.includes(estado)) {
      throw new Error(`El estado debe ser uno de: ${ESTADOS_DIARIO.join(', ')}.`);
    }
    const existing = await db('finance_journal').where({ id }).first();
    if (!existing) return null;
    await db('finance_journal').where({ id }).update({ estado });
    return this.getJournalById(id);
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
   *  - Egresos  = asientos negativos del libro diario + **salarios pagados**
   *               + **comisiones pagadas** (en soles, en valor absoluto).
   *
   * Salarios y comisiones nacieron fuera de la contabilidad (ver la cabecera de
   * `finance_salaries` y de `sales_commissions`) y por eso no entraban acá,
   * pero son plata que sale: sin ellos el Balance Neto en Caja daba de más —
   * todo lo cobrado menos los gastos del libro, sin la planilla ni lo que se le
   * paga al equipo por vender. `totals.egresosPorOrigen` devuelve el desglose,
   * porque el total ahora mezcla tres pestañas distintas.
   *
   * Solo cuenta el dinero confirmado: los ingresos verificados por finanzas,
   * los asientos del libro ya pagados y los salarios/comisiones ya pagados. Lo
   * pendiente (o pagado pero sin verificar) todavía no es dinero en caja y
   * falsearía el balance; lo devengado y sin pagar viaja aparte en
   * `totals.pendientes` para poder mostrarlo como obligación.
   *
   * La ventana de meses es del GRÁFICO (la evolución mensual) y nada más. El
   * saldo de cada cuenta y los totales se calculan sobre TODO el dinero
   * confirmado, sin ventana: un saldo recortado a los últimos N meses no es un
   * saldo — deja afuera la plata que entró antes y sigue en la cuenta, y la
   * fechada más adelante (una cuota adelantada al mes que viene) se caía del
   * grid en silencio, así que la tarjeta de BCP Finanzas decía S/ 700.00 con
   * S/ 3,700.00 verificados en INGRESOS.
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
    // Fin de la ventana: el primer día del mes siguiente al último del gráfico.
    // Se escribe en la consulta en vez de dejar que el grid descarte lo que no
    // entra, que es lo que escondía el problema.
    const afterLast = (() => {
      const [y, m] = monthKeys[monthKeys.length - 1].split('-').map(Number);
      const d = new Date(y, m, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    })();

    const incomeRows = await db('finance_income')
      .select('banco')
      .select(db.raw("DATE_FORMAT(fecha, '%Y-%m') as month"))
      .sum('monto as total')
      .where('fecha', '>=', earliest)
      .where('fecha', '<', afterLast)
      .where('estado', 'verificado')
      .groupBy('banco', 'month');

    const journalRows = await db('finance_journal')
      .select('banco')
      .select(db.raw("DATE_FORMAT(fecha, '%Y-%m') as month"))
      .select(db.raw('SUM(CASE WHEN monto >= 0 THEN monto ELSE 0 END) as ingreso'))
      .select(db.raw('SUM(CASE WHEN monto < 0 THEN -monto ELSE 0 END) as egreso'))
      .where('fecha', '>=', earliest)
      .where('fecha', '<', afterLast)
      .where('moneda', 'soles')
      .where('estado', 'pagado')
      .groupBy('banco', 'month');

    /*
     * Salarios y comisiones PAGADOS: son plata que salió de la empresa, así
     * que desde ahora restan en el resumen. Hasta acá los dos módulos vivían
     * fuera de la contabilidad (ver la cabecera de `finance_salaries` y de
     * `sales_commissions`) y el Balance Neto en Caja daba de más: mostraba lo
     * cobrado menos los gastos del libro diario, sin la planilla ni lo que se
     * le paga al equipo por vender.
     *
     * Solo lo PAGADO entra, igual que todo lo demás en esta pantalla: lo
     * pendiente no salió de ninguna cuenta y falsearía el saldo. Se devuelve
     * aparte (`totals.pendientes`) para poder mostrarlo como obligación.
     *
     * Las comisiones no se descuentan dos veces: acá se pagan por fuera de la
     * planilla, así que no hay una fila de `finance_salaries` que repita ese
     * mismo egreso. Si algún día se empiezan a anotar en Salarios, ESTE es el
     * lugar donde hay que dejar de sumarlas.
     *
     * `moneda` se filtra a soles como en el libro diario — el resumen entero
     * está en soles—, y el monto va en valor absoluto porque la planilla
     * guarda los egresos en negativo.
     */
    const salaryRows = await db('finance_salaries')
      .select('banco')
      .select(db.raw("DATE_FORMAT(fecha, '%Y-%m') as month"))
      .select(db.raw('SUM(ABS(monto)) as egreso'))
      .where('fecha', '>=', earliest)
      .where('fecha', '<', afterLast)
      .where('moneda', 'soles')
      .where('estado', 'pagado')
      .groupBy('banco', 'month');

    /*
     * La fecha del egreso de una comisión es `paid_at` (el día en que se le
     * pagó) y no `created_at` (el día en que se devengó): una comisión de una
     * venta de agosto que se paga en octubre salió de caja en octubre. Sin
     * `paid_at` no hay mes al que asignarla, así que esa fila no entra en la
     * evolución mensual aunque sí en el total.
     */
    const commissionRows = await db('sales_commissions')
      .select(db.raw("DATE_FORMAT(paid_at, '%Y-%m') as month"))
      .select(db.raw('SUM(ABS(monto)) as egreso'))
      .where('estado', 'pagado')
      .whereNotNull('paid_at')
      .where('paid_at', '>=', earliest)
      .where('paid_at', '<', afterLast)
      .groupBy('month');

    /*
     * Una comisión no tiene cuenta bancaria y un salario puede no tenerla, y
     * la grilla mensual está indexada por cuenta: sin este cajón, ese dinero
     * se caía del gráfico en silencio (es la misma razón por la que el TOTAL
     * cuenta lo que no tiene banco asignado). No entra en `banks` ni en las
     * tarjetas por cuenta, que reparten solo lo que sí cayó en una conocida.
     */
    const SIN_CUENTA = 'Sin cuenta';
    const seriesKeys = [...BANCOS, SIN_CUENTA];
    const emptyGrid = () => Object.fromEntries(
      seriesKeys.map((b) => [b, Object.fromEntries(monthKeys.map((m) => [m, 0]))])
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
    /** La cuenta de la fila, o el cajón de lo que no cayó en ninguna conocida. */
    const cuentaDe = (banco) => (banco && egresos[banco] ? banco : SIN_CUENTA);
    for (const r of salaryRows) {
      const cuenta = cuentaDe(r.banco);
      if (egresos[cuenta]?.[r.month] !== undefined) {
        egresos[cuenta][r.month] += Number(r.egreso) || 0;
      }
    }
    for (const r of commissionRows) {
      if (egresos[SIN_CUENTA]?.[r.month] !== undefined) {
        egresos[SIN_CUENTA][r.month] += Number(r.egreso) || 0;
      }
    }

    const toSeries = (grid) => seriesKeys.map((banco) => ({
      banco,
      values: monthKeys.map((m) => Math.round(grid[banco][m] * 100) / 100)
    }));

    // --- Saldo por cuenta: todo el dinero confirmado, sin ventana de meses ---
    const incomeByBank = await db('finance_income')
      .select('banco')
      .sum('monto as total')
      .where('estado', 'verificado')
      .groupBy('banco');

    const journalByBank = await db('finance_journal')
      .select('banco')
      .select(db.raw('SUM(CASE WHEN monto >= 0 THEN monto ELSE 0 END) as ingreso'))
      .select(db.raw('SUM(CASE WHEN monto < 0 THEN -monto ELSE 0 END) as egreso'))
      .where('moneda', 'soles')
      .where('estado', 'pagado')
      .groupBy('banco');

    const saldos = Object.fromEntries(BANCOS.map((b) => [b, { ingresos: 0, egresos: 0 }]));
    let sumaIngresos = 0;
    let sumaEgresos = 0;
    // El total suma TODO lo confirmado —incluido lo que no tiene banco asignado,
    // que es dinero igual y así lo cuenta la pestaña INGRESOS—; el desglose por
    // cuenta solo reparte lo que sí cayó en una de las cuentas conocidas.
    const acumular = (banco, ingreso, egreso) => {
      sumaIngresos += ingreso;
      sumaEgresos += egreso;
      if (saldos[banco]) {
        saldos[banco].ingresos += ingreso;
        saldos[banco].egresos += egreso;
      }
    };
    for (const r of incomeByBank) acumular(r.banco, Number(r.total) || 0, 0);
    for (const r of journalByBank) {
      acumular(r.banco, Number(r.ingreso) || 0, Number(r.egreso) || 0);
    }

    // El egreso del libro, apartado antes de sumarle la planilla y las
    // comisiones: el desglose de la tarjeta de Egresos sale de acá, y sin
    // separarlo no habría forma de ver de dónde viene cada parte del total.
    const egresoLibro = sumaEgresos;

    // Un salario pagado desde BCP es plata que salió de BCP: resta también en
    // la tarjeta de esa cuenta, no solo en el total.
    const salaryByBank = await db('finance_salaries')
      .select('banco')
      .select(db.raw('SUM(ABS(monto)) as egreso'))
      .where('moneda', 'soles')
      .where('estado', 'pagado')
      .groupBy('banco');
    for (const r of salaryByBank) acumular(r.banco, 0, Number(r.egreso) || 0);
    const egresoSalarios = sumaEgresos - egresoLibro;

    // Las comisiones no tienen cuenta: restan del total, no de una tarjeta.
    const comisionesPagadas = await db('sales_commissions')
      .select(db.raw('SUM(ABS(monto)) as egreso'))
      .where('estado', 'pagado')
      .first();
    const egresoComisiones = Number(comisionesPagadas?.egreso) || 0;
    acumular(null, 0, egresoComisiones);

    /*
     * Lo que se debe y todavía no salió. NO toca el balance —esta pantalla
     * cuenta dinero confirmado y un salario pendiente sigue en la cuenta—,
     * pero se devuelve para poder mostrarlo al lado: un balance en verde con
     * media planilla sin pagar es el número que hace tomar la decisión
     * equivocada.
     */
    const salariosPendientes = await db('finance_salaries')
      .select(db.raw('SUM(ABS(monto)) as total'))
      .where('moneda', 'soles')
      .where('estado', 'pendiente')
      .first();
    const comisionesPendientes = await db('sales_commissions')
      .select(db.raw('SUM(ABS(monto)) as total'))
      .where('estado', 'pendiente')
      .first();

    const redondear = (n) => Math.round(n * 100) / 100;
    const totalIngresos = redondear(sumaIngresos);
    const totalEgresos = redondear(sumaEgresos);
    const pendienteSalarios = redondear(Number(salariosPendientes?.total) || 0);
    const pendienteComisiones = redondear(Number(comisionesPendientes?.total) || 0);

    // Se cuenta el mismo universo que suman los totales (todo lo confirmado):
    // un conteo con otra ventana es justo la clase de cifra que no cuadra con
    // nada de lo que tiene al lado.
    const [incomeCount] = await db('finance_income')
      .where('estado', 'verificado')
      .count('id as cnt');
    const [journalCount] = await db('finance_journal')
      .where('moneda', 'soles')
      .where('estado', 'pagado')
      .count('id as cnt');
    const [salaryCount] = await db('finance_salaries')
      .where('moneda', 'soles')
      .where('estado', 'pagado')
      .count('id as cnt');
    const [commissionCount] = await db('sales_commissions')
      .where('estado', 'pagado')
      .count('id as cnt');
    const totalTransactions = (Number(incomeCount?.cnt) || 0)
      + (Number(journalCount?.cnt) || 0)
      + (Number(salaryCount?.cnt) || 0)
      + (Number(commissionCount?.cnt) || 0);

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

    // Los dos entran también en "últimos movimientos": un egreso que mueve el
    // balance y no aparece en la lista de al lado obliga a buscarlo de pestaña
    // en pestaña para entender por qué bajó el saldo.
    const recentSalaries = await db('finance_salaries')
      .select('id', 'persona', 'cargo', 'fecha', 'monto', 'banco', 'periodo')
      .where('moneda', 'soles')
      .where('estado', 'pagado')
      .orderBy('fecha', 'desc')
      .orderBy('id', 'desc')
      .limit(8);

    const recentCommissions = await db('sales_commissions')
      .select('id', 'beneficiary_name', 'paid_at', 'monto', 'role', 'percent')
      .where('estado', 'pagado')
      .whereNotNull('paid_at')
      .orderBy('paid_at', 'desc')
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
      }),
      ...recentSalaries.map((r) => ({
        id: `sal-${r.id}`,
        code: null,
        fecha: r.fecha,
        title: r.persona,
        subtitle: [r.cargo, r.periodo].filter(Boolean).join(' · ') || 'Salario',
        banco: r.banco,
        amount: Math.abs(Number(r.monto) || 0),
        type: 'out',
        source: 'salary'
      })),
      ...recentCommissions.map((r) => ({
        id: `com-${r.id}`,
        code: null,
        fecha: r.paid_at,
        title: r.beneficiary_name,
        subtitle: `Comisión ${r.role} (${Number(r.percent) || 0}%)`,
        banco: null,
        amount: Math.abs(Number(r.monto) || 0),
        type: 'out',
        source: 'commission'
      }))
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
        balance: redondear(totalIngresos - totalEgresos),
        // De dónde sale el total de egresos. Va desglosado y no solo sumado
        // porque es un número que ahora mezcla tres orígenes que se manejan en
        // tres pestañas distintas: sin el desglose, "¿por qué subió?" solo se
        // contesta revisando las tres a mano.
        egresosPorOrigen: {
          libro: redondear(egresoLibro),
          salarios: redondear(egresoSalarios),
          comisiones: redondear(egresoComisiones)
        },
        // Devengado y sin pagar: no entra en el balance (no salió de ninguna
        // cuenta), pero se muestra al lado.
        pendientes: {
          salarios: pendienteSalarios,
          comisiones: pendienteComisiones,
          total: redondear(pendienteSalarios + pendienteComisiones)
        },
        totalTransactions,
        byBank: BANCOS.map((banco) => ({
          banco,
          ingresos: redondear(saldos[banco].ingresos),
          egresos: redondear(saldos[banco].egresos)
        }))
      },
      recentTransactions
    };
  }
}
