import test from 'node:test';
import assert from 'node:assert/strict';

import { pickNext, simulateRouting } from '../leadRouting.js';
import * as espejo from '../../../src/leadRouting.js';

const SETTER = { id: 1, weight: 5, active: true, current_weight: 0 };
const CLOSER = { id: 2, weight: 1, active: true, current_weight: 0 };

test('5 a 1: de cada 6 leads, 5 a la setter y 1 al closer', () => {
  const secuencia = simulateRouting([SETTER, CLOSER], 6);
  assert.deepEqual(secuencia, [1, 1, 1, 2, 1, 1]);
});

test('la proporción se sostiene en el largo plazo', () => {
  const secuencia = simulateRouting([SETTER, CLOSER], 600);
  assert.equal(secuencia.filter((id) => id === 2).length, 100);
});

test('dos setters del mismo peso se alternan, no reciben ráfagas', () => {
  const otra = { id: 3, weight: 5, active: true, current_weight: 0 };
  const secuencia = simulateRouting([SETTER, otra, CLOSER], 11);
  assert.deepEqual(secuencia.slice(0, 4), [1, 3, 1, 3]);
  assert.equal(secuencia.filter((id) => id === 2).length, 1);
});

test('se saltea a quien está en pausa, sin peso o ya no es del área comercial', () => {
  const pausada = { ...SETTER, active: false };
  assert.deepEqual(simulateRouting([pausada, CLOSER], 3), [2, 2, 2]);
  assert.deepEqual(simulateRouting([{ ...SETTER, weight: 0 }, CLOSER], 2), [2, 2]);
  assert.deepEqual(simulateRouting([{ ...SETTER, eligible: false }, CLOSER], 2), [2, 2]);
});

test('sin nadie elegible no elige a nadie (el lead queda sin asignar, como hoy)', () => {
  assert.equal(pickNext([{ ...SETTER, active: false }]).chosen, null);
  assert.deepEqual(simulateRouting([], 5), []);
});

test('sigue donde quedó: el estado guardado continúa la secuencia', () => {
  const { weights } = pickNext([SETTER, CLOSER]);
  const despues = [SETTER, CLOSER].map((m) => ({ ...m, current_weight: weights.get(m.id) }));
  assert.deepEqual(simulateRouting(despues, 5), [1, 1, 2, 1, 1]);
});

test('la vista previa de la pantalla dice lo mismo que el servidor', () => {
  const equipo = [SETTER, { id: 3, weight: 3, active: true, current_weight: 0 }, CLOSER];
  assert.deepEqual(espejo.simulateRouting(equipo, 50), simulateRouting(equipo, 50));
});

/* ------------------------------------------------------------------ */

/*
 * El reparto corre exactamente cuando el bot está apagado, y eso es una
 * decisión de diseño que conviene dejar clavada: la tentación de agregarle al
 * reparto un interruptor propio vuelve cada vez que alguien lee la tabla y ve
 * `lead_routing_pools.enabled`. Con dos interruptores, la combinación "bot
 * apagado + reparto apagado" deja los leads sin responsable y sin respuesta:
 * no los ve nadie en su tablero y no los contesta nadie.
 */
test('el reparto está activo exactamente cuando el bot global está apagado', async () => {
  const { LeadRoutingService } = await import('../leadRoutingService.js');
  const conBot = (enabled) => new LeadRoutingService({
    userService: {},
    botSettingsService: { isBotEnabled: async () => enabled }
  });

  assert.equal(await conBot(false).isActive(), true, 'bot apagado → reparte');
  assert.equal(await conBot(true).isActive(), false, 'bot encendido → no reparte');
});
