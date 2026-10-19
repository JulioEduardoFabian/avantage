import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  actorKey,
  actorLabel,
  buildTimeline,
  nextDay,
  normalizeFilters,
  parseActor
} from '../leadReportService.js';
import { buildStatusLabeler } from '../funnelStageLabel.js';

/**
 * Reporte de Leads: las reglas que se pueden probar sin base de datos — cómo se
 * entiende lo que manda la pantalla y cómo se arma la trayectoria de un lead.
 */

const labelStatus = buildStatusLabeler({
  salesColumns: [
    { key: 'cita_agendada', label: 'Agendado con el closer', icon: '📅' },
    { key: 'col_mtc2nwec_fij', label: 'Cotizado', icon: '📄' }
  ],
  setterColumns: [
    { key: 'conversacion_abierta', label: 'Conversación Abierta', icon: '💬' },
    { key: 'cita_agendada', label: 'Cita Agendada', icon: '📅' }
  ]
});

test('el actor del filtro solo se acepta en los tres formatos posibles', () => {
  assert.deepEqual(parseActor('user:7'), { type: 'user', id: 7 });
  assert.deepEqual(parseActor('bot'), { type: 'bot', id: null });
  assert.deepEqual(parseActor('system'), { type: 'system', id: null });
  // Cualquier otra cosa es "sin filtro", no un pedazo de texto que termina en
  // un where.
  assert.equal(parseActor("user:1 OR 1=1"), null);
  assert.equal(parseActor('cualquiera'), null);
  assert.equal(parseActor(''), null);
});

test('el código del desplegable y el que entiende el filtro son el mismo', () => {
  const actores = [
    { actorType: 'user', actorId: 7, actorName: 'Lucía' },
    { actorType: 'bot', actorId: null, actorName: null },
    { actorType: 'system', actorId: null, actorName: null }
  ];
  for (const actor of actores) {
    const key = actorKey(actor);
    assert.deepEqual(parseActor(key)?.type, actor.actorType, `${key} tiene que volver a leerse igual`);
  }
});

test('quien movió el lead siempre tiene nombre', () => {
  assert.equal(actorLabel({ actorType: 'user', actorName: 'Kevin' }), 'Kevin');
  assert.equal(actorLabel({ actorType: 'bot' }), 'Avan (bot)');
  assert.equal(actorLabel({ actorType: 'system' }), 'El sistema');
  // Un usuario dado de baja antes de que se guardara la copia del nombre: se
  // dice lo único que se sabe de él en vez de dejar el movimiento sin autor.
  assert.equal(actorLabel({ actorType: 'user', actorName: null }), 'Un usuario del panel');
});

test('un rango de fechas escrito al revés se usa como rango igual', () => {
  // Devolver cero filas se lee como "el reporte está roto".
  const filters = normalizeFilters({ from: '2026-10-18', to: '2026-10-01' });
  assert.equal(filters.from, '2026-10-01');
  assert.equal(filters.to, '2026-10-18');
});

test('una fecha que no es una fecha no filtra nada', () => {
  const filters = normalizeFilters({ from: 'ayer', to: '2026-13' });
  assert.equal(filters.from, null);
  assert.equal(filters.to, null);
});

test('la paginación tiene piso y techo', () => {
  assert.equal(normalizeFilters({}).page, 1);
  assert.equal(normalizeFilters({ page: '0' }).page, 1);
  assert.equal(normalizeFilters({ page: '-3' }).page, 1);
  assert.equal(normalizeFilters({}).pageSize, DEFAULT_PAGE_SIZE);
  assert.equal(normalizeFilters({ pageSize: '5000' }).pageSize, MAX_PAGE_SIZE);
});

test('el rango se cierra con el día siguiente, así el "hasta" entra completo', () => {
  // Comparar contra `to 00:00:00` dejaría afuera todo lo que pasó ese día.
  assert.equal(nextDay('2026-10-18'), '2026-10-19');
  assert.equal(nextDay('2026-10-31'), '2026-11-01');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
});

test('la trayectoria empieza por el alta y sigue en orden', () => {
  const lead = {
    id: 12,
    created_at: '2026-10-01T14:00:00Z',
    created_by: 4,
    created_by_name: 'Lucía',
    source: 'Manual'
  };
  const timeline = buildTimeline(lead, [
    { id: 1, fromStatus: 'nuevo', toStatus: 'conversacion_abierta', actorType: 'bot', actorName: null, blocked: false, reason: null, createdAt: '2026-10-02T10:00:00Z' },
    { id: 2, fromStatus: 'conversacion_abierta', toStatus: 'cita_agendada', actorType: 'user', actorName: 'Kevin', blocked: false, reason: null, createdAt: '2026-10-03T10:00:00Z' }
  ], labelStatus, 'setter');

  assert.equal(timeline.length, 3);
  assert.equal(timeline[0].kind, 'alta');
  assert.equal(timeline[0].derived, true);
  assert.equal(timeline[0].actorLabel, 'Lucía');
  assert.equal(timeline[1].from.label, 'Nuevo');
  assert.equal(timeline[1].to.label, 'Conversación Abierta');
  assert.equal(timeline[1].actorLabel, 'Avan (bot)');
  assert.equal(timeline[2].actorLabel, 'Kevin');
});

test('el lead sin movimientos igual tiene su alta: la bitácora es más nueva que él', () => {
  const timeline = buildTimeline(
    { id: 3, created_at: '2026-09-01T10:00:00Z', created_by: null, created_by_name: null, source: 'WhatsApp Directo' },
    [],
    labelStatus
  );
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].kind, 'alta');
  // Lo que entró solo no tiene autor y no se le inventa uno: lo que se sabe es
  // por dónde entró.
  assert.equal(timeline[0].actorLabel, null);
  assert.equal(timeline[0].source, 'WhatsApp Directo');
});

test('la etapa de cada movimiento se nombra con la etiqueta del tablero del lead', () => {
  // `cita_agendada` existe en los dos tableros con nombres distintos, y la del
  // tablero equivocado diría que el lead está donde no está.
  const changes = [{ id: 9, fromStatus: 'conversacion_abierta', toStatus: 'cita_agendada', actorType: 'user', actorName: 'Kevin', blocked: false, reason: null, createdAt: '2026-10-05T10:00:00Z' }];
  const lead = { id: 5, created_at: '2026-10-01T10:00:00Z' };

  assert.equal(buildTimeline(lead, changes, labelStatus, 'setter')[1].to.label, 'Cita Agendada');
  assert.equal(buildTimeline(lead, changes, labelStatus, 'ventas')[1].to.label, 'Agendado con el closer');
});

test('el intento rechazado viaja marcado y con su motivo', () => {
  // Un tope que funciona y un tope que nunca se activó se ven idénticos si el
  // reporte no muestra lo bloqueado.
  const timeline = buildTimeline(
    { id: 8, created_at: '2026-10-01T10:00:00Z' },
    [{ id: 4, fromStatus: 'ganado', toStatus: 'conversacion_abierta', actorType: 'bot', actorName: null, blocked: true, reason: 'el lead ya es del closer', createdAt: '2026-10-06T10:00:00Z' }],
    labelStatus,
    'ventas'
  );
  assert.equal(timeline[1].blocked, true);
  assert.equal(timeline[1].reason, 'el lead ya es del closer');
});
