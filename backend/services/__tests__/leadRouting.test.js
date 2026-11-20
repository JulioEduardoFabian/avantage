import test from 'node:test';
import assert from 'node:assert/strict';

import { pickNext, routesNow, simulateRouting } from '../leadRouting.js';
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


/* ─────────────── Qué se reparte, y cuándo ─────────────── */

/**
 * La regla no es el interruptor del bot sino **quién atiende al lead**. Vino
 * de un agujero que se veía en el panel y no en el código: con el bot
 * encendido, un lead de formulario de TikTok o de Meta nacía sin responsable —
 * y un lead sin responsable no lo ve nadie salvo quien reparte—, así que la
 * mayoría de lo que entra por anuncios quedaba en tierra de nadie justo
 * mientras el bot estaba encendido, que es casi siempre.
 */

test('el lead de formulario se reparte aunque el bot esté encendido', () => {
  // El bot no lo atiende nunca: contesta mensajes, no escribe primero.
  assert.equal(routesNow({ botWillAttend: false, botEnabled: true }), true);
});

test('la conversación de WhatsApp espera a que el bot esté apagado', () => {
  assert.equal(routesNow({ botWillAttend: true, botEnabled: true }), false);
  assert.equal(routesNow({ botWillAttend: true, botEnabled: false }), true);
});

test('con el bot apagado se reparte todo', () => {
  assert.equal(routesNow({ botWillAttend: true, botEnabled: false }), true);
  assert.equal(routesNow({ botWillAttend: false, botEnabled: false }), true);
});

test('sin decir nada, un lead se reparte', () => {
  // El valor por defecto es el que no hay que recordar: el camino de alta que
  // tiene que acordarse de algo es el del bot, que es uno solo. Al revés, el
  // próximo camino automático que se agregue deja sus leads sin dueño y nadie
  // se entera, porque eso no falla.
  assert.equal(routesNow(), true);
  assert.equal(routesNow({}), true);
});

test('la pantalla y el servidor deciden lo mismo', () => {
  // `src/leadRouting.js` es el espejo que usa la banda de la pantalla de
  // Reparto: si dijera otra cosa, la pantalla afirmaría que algo se reparte
  // cuando no.
  for (const botWillAttend of [true, false]) {
    for (const botEnabled of [true, false]) {
      assert.equal(
        espejo.routesNow({ botWillAttend, botEnabled }),
        routesNow({ botWillAttend, botEnabled }),
        `difieren con botWillAttend=${botWillAttend} botEnabled=${botEnabled}`
      );
    }
  }
});
