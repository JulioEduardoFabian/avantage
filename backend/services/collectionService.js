import { db } from '../db/connection.js';
import { CommissionService } from './commissionService.js';
import { FinanceLedgerService } from './financeLedgerService.js';

/**
 * Cobranzas: las cuotas que todavía no entraron, y las que entraron y Finanzas
 * aún no verificó.
 *
 * No tiene tabla propia a propósito. Es la misma `finance_income` mirada desde
 * el trabajo de cobrar: inventarle una tabla paralela obligaría a mantener dos
 * listas de cuotas sincronizadas, y la primera vez que se desincronicen nadie
 * va a saber cuál de las dos dice la verdad. Lo único que no existía —quién
 * cobró y cuándo— son dos columnas en esa misma tabla.
 *
 * Cobrar NO es verificar. Marcar "cobrado" deja la cuota en `pagado`, que es el
 * estado que ya significaba "el cliente pagó y Finanzas todavía no dio el visto
 * bueno": el visto bueno sigue siendo de Finanzas, con su permiso
 * (`finance.verify`), porque de él cuelgan el desbloqueo del proyecto, el aviso
 * de entregables y las cifras del módulo. Por eso esta pantalla puede estar en
 * manos de quien persigue los pagos sin darle acceso al dinero.
 *
 * El cambio de estado pasa por `financeLedgerService.updateIncomeEstado()`, que
 * es el camino que ya existía: duplicarlo acá dejaría dos reglas distintas para
 * la misma transición (esa, por ejemplo, es la que impide tocar una cuota ya
 * verificada).
 */

/** Las cuotas que le importan a Cobranzas: todo lo que no esté verificado. */
export const ESTADOS_COBRANZA = ['pendiente', 'pagado'];

/** Hoy en formato "AAAA-MM-DD", para comparar contra las fechas pactadas. */
function hoy() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
}

/**
 * Las fechas DATE llegan de mysql2 como Date a medianoche local; pasarlas por
 * JSON (UTC) corre el día hacia atrás. Mismo criterio que el resto de Finanzas.
 */
function isoDay(value) {
  if (!value) return null;
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/**
 * Días que faltan (positivo) o que pasaron (negativo) hasta el vencimiento
 * pactado. Se calcula acá y no en la pantalla para que el "vencida hace 3 días"
 * y el filtro de vencidas cuenten lo mismo.
 */
export function daysUntil(dueDate, today = hoy()) {
  const vence = isoDay(dueDate);
  if (!vence) return null;
  const ms = Date.parse(`${vence}T00:00:00`) - Date.parse(`${today}T00:00:00`);
  return Math.round(ms / 86400000);
}

/**
 * Qué dice de una cuota el estado de los entregables atados a ella.
 *
 * `work_delivered` es la señal que ordena el día de quien cobra: el trabajo ya
 * está en manos del cliente y el dinero no entró. Es el mismo cruce que el
 * módulo de Entregables llama `sin_cobrar`, visto desde el otro lado — pero acá
 * basta con que **uno** de los entregables haya salido: con eso ya hay algo
 * entregado sin cobrar, aunque falten los demás.
 *
 * Una cuota verificada nunca cuenta como "entregado sin cobrar": esa plata ya
 * entró y Finanzas la cerró.
 */
export function deliveryState(income, deliverables = []) {
  const entregados = deliverables.filter((entregable) => entregable.status === 'entregado');
  return {
    delivered_count: entregados.length,
    work_delivered: entregados.length > 0 && income?.estado !== 'verificado',
    last_delivered_at: entregados.map((e) => e.delivered_at).filter(Boolean).sort().pop() || null
  };
}

export class CollectionService {
  constructor({ ledgerService, commissionService } = {}) {
    this.ledger = ledgerService || new FinanceLedgerService();
    this.commissions = commissionService || new CommissionService();
  }

  /**
   * Las cuotas por cobrar con los datos del cliente al lado: quien cobra
   * necesita el teléfono y el correo en la misma fila, no entrar a la ficha.
   */
  async list({ estado = null } = {}) {
    const query = db('finance_income as i')
      .leftJoin('leads', 'leads.id', 'i.lead_id')
      .leftJoin('users as cobrador', 'cobrador.id', 'i.collected_by')
      .leftJoin('users as asesor', 'asesor.id', 'leads.assigned_user_id')
      .whereIn('i.estado', estado ? [estado] : ESTADOS_COBRANZA)
      .select(
        'i.id', 'i.code', 'i.cuota', 'i.monto', 'i.estado', 'i.fecha', 'i.due_date',
        'i.banco', 'i.emitir', 'i.lead_id', 'i.collected_at',
        db.raw("COALESCE(NULLIF(leads.full_name, ''), leads.topic) as cliente"),
        'leads.phone as cliente_phone',
        'leads.email as cliente_email',
        'leads.dni as cliente_dni',
        'leads.status as lead_status',
        'asesor.name as responsable',
        'cobrador.name as cobrado_por'
      )
      .orderBy('i.due_date', 'asc')
      .orderBy('i.id', 'asc');

    const filas = await query;
    const dia = hoy();
    const ids = filas.map((fila) => fila.id).concat([0]);

    // Qué cuotas ya tienen comisión de cobranza: la pantalla tiene que poder
    // decir "cobrada, comisión registrada" en vez de ofrecerla otra vez.
    const conComision = new Set(
      await db('sales_commissions')
        .where({ role: 'cobranza' })
        .whereIn('income_id', ids)
        .pluck('income_id')
    );

    /*
     * Los entregables atados a cada cuota (`deliverables.income_id`).
     *
     * Una cuota cuyo trabajo YA salió es la deuda más urgente del tablero: el
     * cliente tiene su capítulo y nosotros no tenemos su plata. El módulo de
     * Entregables ya lo llama `sin_cobrar`, pero ese estado solo se ve desde
     * allá, que es otra pantalla y casi siempre otra persona. Acá se trae para
     * que quien cobra pueda decidir a quién llamar primero sin cambiar de
     * módulo.
     */
    const entregables = await db('deliverables')
      .whereIn('income_id', ids)
      .select('id', 'income_id', 'title', 'status', 'delivered_at')
      .orderBy('position', 'asc');

    const porCuota = new Map();
    for (const entregable of entregables) {
      if (!porCuota.has(entregable.income_id)) porCuota.set(entregable.income_id, []);
      porCuota.get(entregable.income_id).push({
        ...entregable,
        delivered_at: isoDay(entregable.delivered_at)
      });
    }

    return filas.map((fila) => {
      const dias = daysUntil(fila.due_date, dia);
      const atados = porCuota.get(fila.id) || [];
      return {
        ...fila,
        fecha: isoDay(fila.fecha),
        due_date: isoDay(fila.due_date),
        monto: Number(fila.monto),
        days_until_due: dias,
        // "Vencida" es solo lo que no entró: una cuota cobrada fuera de fecha
        // ya no es un problema de cobranza.
        is_overdue: fila.estado === 'pendiente' && dias !== null && dias < 0,
        has_commission: conComision.has(fila.id),
        deliverables: atados,
        ...deliveryState(fila, atados)
      };
    });
  }

  /**
   * Totales del encabezado: lo que falta cobrar, lo vencido, lo ya cobrado y
   * —el que más urge— lo que ya se entregó y todavía no entró.
   */
  async summary() {
    const filas = await this.list();
    const resumen = {
      pendiente: { total: 0, n: 0 },
      vencido: { total: 0, n: 0 },
      cobrado: { total: 0, n: 0 },
      entregado: { total: 0, n: 0 }
    };
    for (const fila of filas) {
      const grupo = fila.estado === 'pagado' ? 'cobrado' : 'pendiente';
      resumen[grupo].total += fila.monto;
      resumen[grupo].n += 1;
      if (fila.is_overdue) {
        resumen.vencido.total += fila.monto;
        resumen.vencido.n += 1;
      }
      if (fila.work_delivered) {
        resumen.entregado.total += fila.monto;
        resumen.entregado.n += 1;
      }
    }
    return resumen;
  }

  /**
   * Marca la cuota como cobrada (estado `pagado`) y, si se pide, registra el 2%
   * para quien la cobró.
   *
   * La comisión es opcional en cada cobro y no automática: hay cuotas que entran
   * solas (transferencia que aparece en el banco) y ahí no hay cobranza que
   * comisionar. Si falla el registro de la comisión, el cobro queda igual: el
   * motivo viaja en la respuesta para poder decirlo en pantalla.
   */
  async collect(incomeId, { user, commission = false } = {}) {
    const income = await this.ledger.getIncomeById(incomeId);
    if (!income) return null;
    if (income.estado === 'verificado') {
      const error = new Error('Esta cuota ya está verificada por Finanzas.');
      error.code = 'ALREADY_VERIFIED';
      throw error;
    }

    if (income.estado !== 'pagado') {
      await this.ledger.updateIncomeEstado(incomeId, 'pagado');
    }
    await db('finance_income').where({ id: incomeId }).update({
      collected_at: db.fn.now(),
      collected_by: user?.id || null
    });

    let commissionRow = null;
    let commissionReason = null;
    if (commission) {
      const resultado = await this.commissions.registerForCollection(income, user);
      commissionRow = resultado.commission;
      commissionReason = resultado.reason;
    }

    return {
      income: await this.ledger.getIncomeById(incomeId),
      commission: commissionRow,
      commissionReason
    };
  }

  /**
   * Deshace un cobro mal registrado: la cuota vuelve a `pendiente` y se borra la
   * comisión que generó, salvo que ya figure pagada (ver
   * `dropPendingCollectionCommission`).
   */
  async revert(incomeId) {
    const income = await this.ledger.getIncomeById(incomeId);
    if (!income) return null;
    if (income.estado === 'verificado') {
      const error = new Error('Esta cuota ya está verificada por Finanzas: quita la verificación desde Finanzas.');
      error.code = 'ALREADY_VERIFIED';
      throw error;
    }

    await this.ledger.updateIncomeEstado(incomeId, 'pendiente');
    await db('finance_income').where({ id: incomeId }).update({
      collected_at: null,
      collected_by: null
    });
    const borradas = await this.commissions.dropPendingCollectionCommission(incomeId);

    return { income: await this.ledger.getIncomeById(incomeId), removedCommissions: borradas };
  }
}
