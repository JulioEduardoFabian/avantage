import { db } from '../db/connection.js';
import { loadWinningStatuses } from './salesFunnelStage.js';
import {
  dayKeyOf,
  firstDayAfter,
  firstDayOf,
  lastMonthKeys,
  nextMonthKeys,
  normalizeMonths,
  percentChange,
  ratio,
  round2,
  toDayKey
} from './reportPeriod.js';

/**
 * Reporte General: la pantalla de gerencia. No es otro módulo de datos sino
 * las preguntas que se hacen para decidir, contestadas de una vez y sobre las
 * MISMAS fuentes que el resto del panel:
 *
 *  - ¿Cuánto vendimos y cuánto entró? Lo vendido es el precio pactado de los
 *    leads que se ganaron (un proyecto nace cuando se gana el lead, así que su
 *    `created_at` es el día del cierre). Lo cobrado y lo gastado NO se vuelven
 *    a sumar acá: salen de `financeLedgerService.getOverview()`, que es lo que
 *    muestra Finanzas. Dos pantallas con dos sumas propias es como se llega a
 *    que la gerencia vea un número y Finanzas otro.
 *  - ¿Qué nos deben y cuánto está vencido? Las cuotas `pendiente` por
 *    antigüedad de su fecha pactada (`due_date`). Las `pagado` van aparte:
 *    el cliente ya pagó y falta el visto bueno de Finanzas, no es deuda.
 *  - ¿De dónde salen las ventas? El embudo y los canales se miden por
 *    COHORTE —los leads que entraron en el período y hasta dónde llegaron—,
 *    no contando ventas del mes contra leads del mes, que mezcla gente que
 *    entró en momentos distintos y da tasas mayores al 100%.
 *
 * Una venta que no se concretó (`leads.deal_cancelled_at`) no cuenta como
 * vendida ni como cartera, igual que en Cobranzas; se informa aparte.
 *
 * Cada KPI se compara con el período anterior de la misma longitud: una cifra
 * sola no dice si las cosas van mejor o peor.
 */

const TOP_CHANNELS = 7;
const PROJECTION_MONTHS = 6;

/**
 * El tramo de antigüedad de una cuota pendiente según su fecha pactada.
 * `por_vencer` incluye la que vence hoy: todavía se puede pagar a tiempo.
 */
export const AGING_BUCKETS = [
  { key: 'por_vencer', label: 'Por vencer' },
  { key: 'd1_30', label: 'Vencido 1–30 días' },
  { key: 'd31_60', label: 'Vencido 31–60 días' },
  { key: 'd61_90', label: 'Vencido 61–90 días' },
  { key: 'd90', label: 'Vencido +90 días' }
];

export function agingBucket(dueDay, todayDay) {
  if (!dueDay || dueDay >= todayDay) return 'por_vencer';
  const dias = Math.round((Date.parse(`${todayDay}T00:00:00Z`) - Date.parse(`${dueDay}T00:00:00Z`)) / 86400000);
  if (dias <= 30) return 'd1_30';
  if (dias <= 60) return 'd31_60';
  if (dias <= 90) return 'd61_90';
  return 'd90';
}

/**
 * Hasta dónde llegó cada lead de una cohorte. Las etapas son acumulativas a
 * propósito: un lead ganado también "pasó a Ventas" aunque le falte el sello
 * (se cerró antes de que existiera, o el closer lo cargó directo), y contarlo
 * solo en la última etapa daría un embudo que se ensancha hacia abajo.
 */
export function funnelStageOf(lead, { wonIds, meetingIds }) {
  if (wonIds.has(lead.id)) return 4;
  if (meetingIds.has(lead.id)) return 3;
  if (lead.sales_funnel_at) return 2;
  return 1;
}

export function buildFunnel(leads, sets) {
  const counts = [0, 0, 0, 0];
  for (const lead of leads) {
    const stage = funnelStageOf(lead, sets);
    for (let i = 0; i < stage; i++) counts[i] += 1;
  }
  const labels = ['Leads nuevos', 'Pasaron a Ventas', 'Tuvieron reunión', 'Ventas ganadas'];
  return labels.map((label, i) => ({
    label,
    count: counts[i],
    ofTotal: ratio(counts[i], counts[0]),
    ofPrevious: i === 0 ? null : ratio(counts[i], counts[i - 1])
  }));
}

/**
 * Agrupa por una clave, se queda con los `limit` más grandes y junta el resto
 * en "Otros": una barra por cada origen escrito a mano no se lee.
 */
export function topWithOther(rows, limit, sortKey) {
  const sorted = [...rows].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const other = { label: 'Otros', isOther: true };
  for (const row of rest) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number') other[key] = (other[key] || 0) + value;
    }
  }
  return [...head, other];
}

/** Suma, mes a mes, las series por cuenta que devuelve `getOverview()`. */
export function sumSeries(series, length) {
  const totals = new Array(length).fill(0);
  for (const s of series || []) {
    s.values.forEach((v, i) => { totals[i] += Number(v) || 0; });
  }
  return totals.map(round2);
}

const sumRange = (values, from, to) => round2(values.slice(from, to).reduce((a, b) => a + b, 0));

export class GeneralReportService {
  constructor({ financeLedgerService }) {
    this.financeLedgerService = financeLedgerService;
  }

  async report(query = {}, now = new Date()) {
    const months = normalizeMonths(query.months);
    // Se trae el doble de meses: la mitad vieja es el período de comparación.
    const allKeys = lastMonthKeys(months * 2, now);
    const keys = allKeys.slice(months);
    const prevKeys = allKeys.slice(0, months);
    const windowStart = firstDayOf(allKeys[0]);
    const currentStart = firstDayOf(keys[0]);
    const windowEnd = firstDayAfter(keys[keys.length - 1]);
    const today = dayKeyOf(now);
    const inCurrent = (monthKey) => monthKey >= keys[0];

    const [overview, wonStatuses] = await Promise.all([
      this.financeLedgerService.getOverview({ monthsBack: months * 2 }),
      loadWinningStatuses()
    ]);

    // --- Caja: exactamente lo de Finanzas, sumadas las cuentas ---
    const cashIn = sumSeries(overview.ingresos, allKeys.length);
    const cashOut = sumSeries(overview.egresos, allKeys.length);

    // --- Ventas cerradas: un proyecto por lead ganado ---
    const wonRows = await db('projects')
      .join('leads', 'leads.id', 'projects.lead_id')
      .leftJoin('users as closer', 'closer.id', 'leads.closer_user_id')
      .select(
        'leads.id',
        'leads.total_amount',
        'leads.source',
        'leads.deal_cancelled_at',
        'leads.closer_user_id',
        'closer.name as closer_name',
        db.raw("DATE_FORMAT(projects.created_at, '%Y-%m') as month")
      )
      .where('projects.created_at', '>=', windowStart)
      .where('projects.created_at', '<', windowEnd);

    const salesAmount = Object.fromEntries(allKeys.map((k) => [k, 0]));
    const salesCount = Object.fromEntries(allKeys.map((k) => [k, 0]));
    const cancelled = { count: 0, amount: 0 };
    const closers = new Map();
    for (const row of wonRows) {
      const amount = Number(row.total_amount) || 0;
      if (row.deal_cancelled_at) {
        if (inCurrent(row.month)) {
          cancelled.count += 1;
          cancelled.amount += amount;
        }
        continue;
      }
      if (salesAmount[row.month] === undefined) continue;
      salesAmount[row.month] += amount;
      salesCount[row.month] += 1;
      if (inCurrent(row.month)) {
        const key = row.closer_user_id || 0;
        const entry = closers.get(key) || {
          label: row.closer_name || 'Sin closer registrado',
          count: 0,
          amount: 0
        };
        entry.count += 1;
        entry.amount += amount;
        closers.set(key, entry);
      }
    }
    const salesAmountSeries = allKeys.map((k) => round2(salesAmount[k]));
    const salesCountSeries = allKeys.map((k) => salesCount[k]);

    // --- Cohorte de leads: los que entraron en la ventana completa ---
    const [leadRows, projectLeadIds, meetingLeadIds] = await Promise.all([
      db('leads')
        .select(
          'id', 'status', 'source', 'sales_funnel_at', 'total_amount', 'deal_cancelled_at',
          db.raw("DATE_FORMAT(created_at, '%Y-%m') as month")
        )
        .where('created_at', '>=', windowStart)
        .where('created_at', '<', windowEnd),
      db('projects').whereNotNull('lead_id').pluck('lead_id'),
      db('scheduled_meetings').whereNotNull('lead_id').distinct('lead_id').pluck('lead_id')
    ]);
    const projectIds = new Set(projectLeadIds);
    const wonIds = new Set(
      leadRows
        .filter((l) => !l.deal_cancelled_at && (wonStatuses.has(l.status) || projectIds.has(l.id)))
        .map((l) => l.id)
    );
    const sets = { wonIds, meetingIds: new Set(meetingLeadIds) };

    const newLeads = Object.fromEntries(allKeys.map((k) => [k, 0]));
    for (const lead of leadRows) {
      if (newLeads[lead.month] !== undefined) newLeads[lead.month] += 1;
    }
    const currentLeads = leadRows.filter((l) => inCurrent(l.month));
    const previousLeads = leadRows.filter((l) => !inCurrent(l.month));
    const wonIn = (list) => list.filter((l) => wonIds.has(l.id)).length;

    const channelMap = new Map();
    for (const lead of currentLeads) {
      const label = (lead.source || '').trim() || 'Sin origen';
      const entry = channelMap.get(label) || { label, leads: 0, won: 0, amount: 0 };
      entry.leads += 1;
      if (wonIds.has(lead.id)) {
        entry.won += 1;
        entry.amount += Number(lead.total_amount) || 0;
      }
      channelMap.set(label, entry);
    }
    const channels = topWithOther([...channelMap.values()], TOP_CHANNELS, 'leads').map((c) => ({
      ...c,
      amount: round2(c.amount),
      conversion: ratio(c.won, c.leads)
    }));

    // --- Cartera: lo que el cliente todavía debe ---
    const receivableRows = await db('finance_income as i')
      .leftJoin('leads', 'leads.id', 'i.lead_id')
      .select('i.monto', 'i.estado', 'i.due_date', 'i.fecha')
      .whereIn('i.estado', ['pendiente', 'pagado'])
      .whereNull('leads.deal_cancelled_at');

    const aging = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, { amount: 0, count: 0 }]));
    const projectionKeys = nextMonthKeys(PROJECTION_MONTHS, now);
    const projection = Object.fromEntries(projectionKeys.map((k) => [k, 0]));
    let toVerify = 0;
    let toVerifyCount = 0;
    for (const row of receivableRows) {
      const amount = Number(row.monto) || 0;
      if (row.estado === 'pagado') {
        toVerify += amount;
        toVerifyCount += 1;
        continue;
      }
      const due = toDayKey(row.due_date) || toDayKey(row.fecha);
      const bucket = agingBucket(due, today);
      aging[bucket].amount += amount;
      aging[bucket].count += 1;
      if (bucket === 'por_vencer' && due && projection[due.slice(0, 7)] !== undefined) projection[due.slice(0, 7)] += amount;
    }
    const receivableTotal = Object.values(aging).reduce((s, b) => s + b.amount, 0);
    const overdueTotal = receivableTotal - aging.por_vencer.amount;

    // --- Efectividad: de lo que vencía cada mes, cuánto ya se pagó ---
    const dueRows = await db('finance_income as i')
      .leftJoin('leads', 'leads.id', 'i.lead_id')
      .select(db.raw("DATE_FORMAT(i.due_date, '%Y-%m') as month"))
      .sum('i.monto as pactado')
      .select(db.raw("SUM(CASE WHEN i.estado IN ('pagado', 'verificado') THEN i.monto ELSE 0 END) as cobrado"))
      .where('i.due_date', '>=', currentStart)
      .where('i.due_date', '<', windowEnd)
      .whereNull('leads.deal_cancelled_at')
      .groupBy('month');
    const dueByMonth = new Map(dueRows.map((r) => [r.month, r]));
    const collectionRate = keys.map((k) => {
      const r = dueByMonth.get(k);
      const pactado = round2(r?.pactado);
      const cobrado = round2(r?.cobrado);
      return { month: k, pactado, cobrado, rate: ratio(cobrado, pactado) };
    });

    // --- Egresos del período por destino ---
    const [areaRows, salaryRow, commissionRow] = await Promise.all([
      db('finance_journal')
        .select('area')
        .select(db.raw('SUM(-monto) as total'))
        .where('monto', '<', 0)
        .where('moneda', 'soles')
        .where('estado', 'pagado')
        .where('fecha', '>=', currentStart)
        .where('fecha', '<', windowEnd)
        .groupBy('area'),
      db('finance_salaries')
        .select(db.raw('SUM(ABS(monto)) as total'))
        .where('moneda', 'soles')
        .where('estado', 'pagado')
        .where('kind', 'pago')
        .where('fecha', '>=', currentStart)
        .where('fecha', '<', windowEnd)
        .first(),
      db('sales_commissions')
        .select(db.raw('SUM(ABS(monto)) as total'))
        .where('estado', 'pagado')
        .whereNotNull('paid_at')
        .where('paid_at', '>=', currentStart)
        .where('paid_at', '<', windowEnd)
        .first()
    ]);
    const expenseRows = areaRows.map((r) => ({
      label: (r.area || '').trim() || 'Sin área',
      amount: round2(r.total)
    }));
    if (Number(salaryRow?.total)) expenseRows.push({ label: 'Planilla', amount: round2(salaryRow.total) });
    if (Number(commissionRow?.total)) expenseRows.push({ label: 'Comisiones', amount: round2(commissionRow.total) });
    const expenses = topWithOther(expenseRows.filter((r) => r.amount > 0), 7, 'amount')
      .map((r) => ({ ...r, amount: round2(r.amount) }));

    // --- KPIs, período actual contra el anterior ---
    const cur = (values) => sumRange(values, months, months * 2);
    const prev = (values) => sumRange(values, 0, months);
    const kpi = (current, previous) => ({ current, previous, change: percentChange(current, previous) });

    const salesNow = cur(salesAmountSeries);
    const salesPrev = prev(salesAmountSeries);
    const dealsNow = cur(salesCountSeries);
    const dealsPrev = prev(salesCountSeries);
    const inNow = cur(cashIn);
    const inPrev = prev(cashIn);
    const outNow = cur(cashOut);
    const outPrev = prev(cashOut);

    return {
      months,
      generatedAt: now.toISOString(),
      period: { months: keys, previous: prevKeys },
      kpis: {
        sales: kpi(salesNow, salesPrev),
        deals: kpi(dealsNow, dealsPrev),
        ticket: kpi(
          dealsNow ? round2(salesNow / dealsNow) : 0,
          dealsPrev ? round2(salesPrev / dealsPrev) : 0
        ),
        cashIn: kpi(inNow, inPrev),
        cashOut: kpi(outNow, outPrev),
        net: kpi(round2(inNow - outNow), round2(inPrev - outPrev)),
        margin: { current: ratio(inNow - outNow, inNow), previous: ratio(inPrev - outPrev, inPrev) },
        newLeads: kpi(currentLeads.length, previousLeads.length),
        conversion: {
          current: ratio(wonIn(currentLeads), currentLeads.length),
          previous: ratio(wonIn(previousLeads), previousLeads.length)
        }
      },
      monthly: {
        months: keys,
        sales: salesAmountSeries.slice(months),
        deals: salesCountSeries.slice(months),
        cashIn: cashIn.slice(months),
        cashOut: cashOut.slice(months),
        net: cashIn.slice(months).map((v, i) => round2(v - cashOut[months + i])),
        newLeads: keys.map((k) => newLeads[k])
      },
      funnel: buildFunnel(currentLeads, sets),
      channels,
      closers: [...closers.values()]
        .map((c) => ({ ...c, amount: round2(c.amount) }))
        .sort((a, b) => b.amount - a.amount),
      receivables: {
        total: round2(receivableTotal),
        overdue: round2(overdueTotal),
        overdueShare: ratio(overdueTotal, receivableTotal),
        toVerify: { amount: round2(toVerify), count: toVerifyCount },
        aging: AGING_BUCKETS.map((b) => ({
          ...b,
          amount: round2(aging[b.key].amount),
          count: aging[b.key].count
        })),
        projection: {
          overdue: round2(overdueTotal),
          months: projectionKeys.map((k) => ({ month: k, amount: round2(projection[k]) }))
        }
      },
      collectionRate,
      expenses,
      cancelled: { count: cancelled.count, amount: round2(cancelled.amount) },
      obligations: overview.totals?.pendientes || null
    };
  }
}
