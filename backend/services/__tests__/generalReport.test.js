import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agingBucket,
  buildFunnel,
  sumSeries,
  topWithOther
} from '../generalReportService.js';
// La aritmética del período se comparte con el Reporte de Setters desde que
// existen los dos (ver `reportPeriod.js`).
import {
  lastMonthKeys,
  nextMonthKeys,
  normalizeMonths,
  percentChange,
  ratio,
  toDayKey
} from '../reportPeriod.js';

/**
 * Reporte General: las reglas que deciden qué cifra ve la gerencia, probadas
 * sin base de datos.
 */

test('normalizeMonths solo acepta las ventanas ofrecidas', () => {
  assert.equal(normalizeMonths('12'), 12);
  assert.equal(normalizeMonths(3), 3);
  assert.equal(normalizeMonths('99'), 6);
  assert.equal(normalizeMonths(undefined), 6);
});

test('las ventanas de meses cruzan el cambio de año', () => {
  const now = new Date(2026, 1, 15); // 15 feb 2026
  assert.deepEqual(lastMonthKeys(3, now), ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(nextMonthKeys(3, new Date(2026, 10, 5)), ['2026-11', '2026-12', '2027-01']);
});

test('percentChange no inventa una variación sin base', () => {
  assert.equal(percentChange(150, 100), 50);
  assert.equal(percentChange(50, 100), -50);
  assert.equal(percentChange(10, 0), null);
  assert.equal(percentChange(-50, -100), 50);
});

test('ratio devuelve null sin denominador', () => {
  assert.equal(ratio(1, 3), 33.3);
  assert.equal(ratio(5, 0), null);
});

test('agingBucket: lo que vence hoy todavía está a tiempo', () => {
  const hoy = '2026-10-22';
  assert.equal(agingBucket('2026-10-22', hoy), 'por_vencer');
  assert.equal(agingBucket('2026-11-30', hoy), 'por_vencer');
  assert.equal(agingBucket('2026-10-21', hoy), 'd1_30');
  assert.equal(agingBucket('2026-09-22', hoy), 'd1_30');
  assert.equal(agingBucket('2026-09-21', hoy), 'd31_60');
  assert.equal(agingBucket('2026-08-01', hoy), 'd61_90');
  assert.equal(agingBucket('2026-01-01', hoy), 'd90');
  assert.equal(agingBucket(null, hoy), 'por_vencer');
});

test('toDayKey entiende Date y texto de mysql2', () => {
  assert.equal(toDayKey(new Date(2026, 9, 3)), '2026-10-03');
  assert.equal(toDayKey('2026-10-03T05:00:00.000Z'), '2026-10-03');
  assert.equal(toDayKey(null), null);
  assert.equal(toDayKey('basura'), null);
});

test('el embudo es acumulativo: un ganado sin sello igual pasó por Ventas', () => {
  const leads = [
    { id: 1, sales_funnel_at: null },
    { id: 2, sales_funnel_at: '2026-10-01' },
    { id: 3, sales_funnel_at: '2026-10-01' },
    { id: 4, sales_funnel_at: null } // ganado sin sello
  ];
  const funnel = buildFunnel(leads, { wonIds: new Set([4]), meetingIds: new Set([3]) });
  assert.deepEqual(funnel.map((s) => s.count), [4, 3, 2, 1]);
  assert.equal(funnel[0].ofPrevious, null);
  assert.equal(funnel[3].ofTotal, 25);
  assert.equal(funnel[3].ofPrevious, 50);
  // Nunca se ensancha hacia abajo.
  for (let i = 1; i < funnel.length; i++) assert.ok(funnel[i].count <= funnel[i - 1].count);
});

test('topWithOther junta el resto sin perder cantidades', () => {
  const rows = [
    { label: 'A', leads: 10, won: 2 },
    { label: 'B', leads: 5, won: 1 },
    { label: 'C', leads: 3, won: 0 },
    { label: 'D', leads: 1, won: 1 }
  ];
  const result = topWithOther(rows, 2, 'leads');
  assert.deepEqual(result.map((r) => r.label), ['A', 'B', 'Otros']);
  assert.equal(result[2].leads, 4);
  assert.equal(result[2].won, 1);
  assert.equal(result.reduce((s, r) => s + r.leads, 0), 19);
});

test('sumSeries suma las cuentas mes a mes', () => {
  const series = [
    { banco: 'BCP', values: [100, 0, 50.555] },
    { banco: 'Interbank', values: [1, 2, 3] }
  ];
  assert.deepEqual(sumSeries(series, 3), [101, 2, 53.56]);
  assert.deepEqual(sumSeries([], 2), [0, 0]);
});
