import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStageResolver } from '../funnelStageLabel.js';

/**
 * La etapa que la bandeja de WhatsApp muestra al lado del nombre. Quien
 * contesta un mensaje no tenía forma de saber si del otro lado hay un contacto
 * recién llegado o un cliente al que ya se le cotizó.
 */

const INDEX = {
  salesColumns: [
    { key: 'cita_agendada', label: 'Agendado con el closer', icon: '📅', color: '#C9922E' },
    { key: 'congelado', label: 'En pausa (ventas)', icon: '🧊', color: '#8D9199' },
    { key: 'col_mtc2nwec_fij', label: 'Cotizado', icon: '📄', color: '#105EFF' }
  ],
  setterColumns: [
    { key: 'conversacion_abierta', label: 'Conversación Abierta', icon: '💬', color: '#2C8C99' },
    { key: 'congelado', label: 'Congelado', icon: '🧊', color: '#8D9199' },
    { key: 'cita_agendada', label: 'Cita Agendada', icon: '📅', color: '#C9922E' },
    { key: 'ganado', label: 'Ganado / Cerrado', icon: '🏆', color: '#2F7D5A' }
  ],
  // Lo que devolvería `loadSalesFunnelStatuses()` con ese tablero.
  salesStatuses: new Set(['cita_agendada', 'en_negociacion', 'ganado', 'perdido', 'col_mtc2nwec_fij'])
};

const stageOf = buildStageResolver(INDEX);

test('un lead del setter se nombra con la etiqueta de SU tablero', () => {
  const stage = stageOf({ status: 'conversacion_abierta', sales_funnel_at: null });
  assert.equal(stage.board, 'setter');
  assert.equal(stage.label, 'Conversación Abierta');
  assert.equal(stage.icon, '💬');
});

test('una etapa que existe en los DOS tableros usa la del tablero del lead', () => {
  // El equipo puede llamar distinto a la misma clave en cada tablero, y
  // mostrar la del otro sería decirle a quien contesta que el lead está donde
  // no está. Lo que decide es el sello, no el texto del status.
  const setter = stageOf({ status: 'congelado', sales_funnel_at: null });
  assert.equal(setter.board, 'setter');
  assert.equal(setter.label, 'Congelado');

  const ventas = stageOf({ status: 'congelado', sales_funnel_at: '2026-10-16T12:00:00Z' });
  assert.equal(ventas.board, 'ventas');
  assert.equal(ventas.label, 'En pausa (ventas)');
});

test('"cita agendada" ya es del closer aunque no tenga sello', () => {
  // Es el status con el que el bot (y el pase manual del setter) gradúa al
  // lead, así que `leadHasGraduated()` lo reconoce por el status para los
  // leads anteriores al sello. La bandeja tiene que decir Ventas: es
  // exactamente la diferencia entre escribirle a un contacto nuevo y
  // escribirle a alguien que ya tiene reunión con el closer.
  const stage = stageOf({ status: 'cita_agendada', sales_funnel_at: null });
  assert.equal(stage.board, 'ventas');
  assert.equal(stage.label, 'Agendado con el closer');
});

test('el tablero sale del sello y no del texto del status', () => {
  // `col_mtc2nwec_fij` no se puede listar en el código: la clave la generó el
  // equipo al crear la columna. El sello contesta igual.
  const stage = stageOf({ status: 'col_mtc2nwec_fij', sales_funnel_at: '2026-10-16T12:00:00Z' });
  assert.equal(stage.board, 'ventas');
  assert.equal(stage.label, 'Cotizado');
});

test('un desenlace sin columna configurada igual tiene nombre', () => {
  // Es justo el caso en el que saber la etapa más importa, así que no puede
  // quedarse sin etiqueta.
  const stage = stageOf({ status: 'en_negociacion', sales_funnel_at: '2026-10-16T12:00:00Z' });
  assert.equal(stage.label, 'En negociación');
});

test('el status por defecto de un lead nuevo se nombra, no se deja crudo', () => {
  assert.equal(stageOf({ status: 'nuevo', sales_funnel_at: null }).label, 'Nuevo');
});

test('una clave sin columna ni nombre fijo se muestra legible, no en bruto', () => {
  assert.equal(stageOf({ status: 'setter_col_x9', sales_funnel_at: null }).label, 'Setter col x9');
});

test('sin status no hay etapa: la bandeja no dibuja nada', () => {
  assert.equal(stageOf({ status: null }), null);
  assert.equal(stageOf(null), null);
});
