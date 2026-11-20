import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  QUALITY_ACTORS,
  QUALITY_KINDS,
  classifyActivity,
  kindLabel,
  summarise,
  trackedActivityTypes
} from '../botQuality.js';

/**
 * El monitor de calidad: qué de lo que anota el bot contesta una de las cuatro
 * preguntas —preguntas sin resolver, errores, respuestas repetidas y
 * abandonos— y qué no se guarda.
 */

test('las cuatro preguntas tienen al menos un evento que las alimenta', () => {
  const cubiertas = new Set(trackedActivityTypes().map((type) => classifyActivity({ type }).kind));
  for (const kind of QUALITY_KINDS) {
    assert.ok(cubiertas.has(kind), `ninguna entrada alimenta "${kind}": esa cifra saldría siempre en cero`);
  }
});

test('todo lo clasificado usa el vocabulario de la tabla', () => {
  for (const type of trackedActivityTypes()) {
    const event = classifyActivity({ type });
    assert.ok(QUALITY_KINDS.includes(event.kind), `${type} tiene un "kind" fuera del catálogo`);
    assert.ok(QUALITY_ACTORS.includes(event.actor), `${type} tiene un "actor" fuera del catálogo`);
    assert.ok(['alta', 'media', 'baja'].includes(event.severity), `${type} tiene una severidad rara`);
  }
});

test('el ruido del turno normal NO se persiste', () => {
  // `send_success` y `llm_request` solos son dos filas por turno: guardarlos
  // enterraría las cuatro cifras que la tabla viene a hacer visibles.
  for (const type of ['send_success', 'llm_request', 'llm_response', 'buffer', 'meeting_booked', 'warmup_ask']) {
    assert.equal(classifyActivity({ type }), null, `${type} no debería ir a la tabla`);
  }
  assert.equal(classifyActivity({}), null);
  assert.equal(classifyActivity({ type: 'algo_que_no_existe' }), null);
});

test('un abandono NUESTRO y uno del contacto se guardan distinto', () => {
  // Se ven igual en una cifra y se arreglan al revés: al contacto se le
  // insiste, al equipo se le reclama.
  assert.equal(classifyActivity({ type: 'inactivity_frozen' }).actor, 'contacto');
  assert.equal(classifyActivity({ type: 'unanswered_inbound' }).actor, 'equipo');
  assert.equal(classifyActivity({ type: 'handoff_unattended' }).actor, 'equipo');

  for (const type of ['inactivity_frozen', 'unanswered_inbound', 'handoff_unattended']) {
    assert.equal(classifyActivity({ type }).kind, 'abandono');
  }
});

test('el turno que se cayó es de severidad alta y el horario mal leído no', () => {
  assert.equal(classifyActivity({ type: 'conversation_turn_failed' }).severity, 'alta');
  assert.equal(classifyActivity({ type: 'day_request_parse_failed' }).severity, 'baja');
});

test('el detalle guarda con qué arreglar la fila', () => {
  const conError = classifyActivity({ type: 'send_failed', waId: '51999', error: 'Window closed' });
  assert.equal(conError.detail, 'Window closed');
  assert.equal(conError.waId, '51999');

  const conTexto = classifyActivity({ type: 'step_miss', text: 'el jueves a cualquier hora' });
  assert.equal(conTexto.detail, 'el jueves a cualquier hora');

  const conTipo = classifyActivity({ type: 'unreadable_message', messageType: 'document' });
  assert.equal(conTipo.detail, '[document]');

  const conCampo = classifyActivity({ type: 'garbage_value_ignored', campo: 'carrera', valor: 'Yy' });
  assert.equal(conCampo.detail, 'carrera: Yy');
});

test('el error gana sobre el texto en el detalle', () => {
  // Cuando hay un error, lo que hace falta leer es el error.
  const event = classifyActivity({ type: 'turn_error_recovering', text: 'hola', error: 'ECONNRESET' });
  assert.ok(event.detail.startsWith('ECONNRESET'));
});

test('el detalle se recorta a lo que entra en la columna', () => {
  const event = classifyActivity({ type: 'step_miss', text: 'x'.repeat(900) });
  assert.equal(event.detail.length, 500);
});

test('sin detalle la fila se guarda igual, con null', () => {
  assert.equal(classifyActivity({ type: 'inactivity_frozen' }).detail, null);
});

test('el resumen cuenta las filas, los actores y las conversaciones distintas', () => {
  const rows = [
    { kind: 'abandono', actor: 'equipo', wa_id: '51999', event_type: 'unanswered_inbound' },
    { kind: 'abandono', actor: 'equipo', wa_id: '51999', event_type: 'unanswered_inbound' },
    { kind: 'abandono', actor: 'contacto', wa_id: '51888', event_type: 'inactivity_frozen' },
    { kind: 'error', actor: 'bot', wa_id: '51777', event_type: 'send_failed' }
  ];

  const resumen = summarise(rows);
  assert.equal(resumen.total, 4);
  assert.equal(resumen.conversaciones, 3, 'el mismo contacto dos veces es una conversación');
  assert.equal(resumen.porPregunta.abandono.total, 3);
  assert.equal(resumen.porPregunta.abandono.porActor.equipo, 2);
  assert.equal(resumen.porPregunta.abandono.porActor.contacto, 1);
  assert.equal(resumen.porPregunta.abandono.porEvento.unanswered_inbound, 2);
  assert.equal(resumen.porPregunta.error.total, 1);
  assert.equal(resumen.porPregunta.respuesta_repetida.total, 0);
});

test('el resumen vacío trae las cuatro preguntas en cero y no en blanco', () => {
  // Una pregunta que falta se lee como "no hay datos"; una en cero dice que
  // esta semana no pasó. No es lo mismo.
  const resumen = summarise([]);
  for (const kind of QUALITY_KINDS) {
    assert.equal(resumen.porPregunta[kind].total, 0);
  }
});

test('el resumen lee las filas de la base y las de memoria por igual', () => {
  // Las de la base traen `wa_id`/`event_type`; las que acaba de clasificar el
  // bot traen `waId`/`eventType`. Las dos tienen que contar lo mismo.
  const deBase = summarise([{ kind: 'error', actor: 'bot', wa_id: '51999', event_type: 'send_failed' }]);
  const deMemoria = summarise([{ kind: 'error', actor: 'bot', waId: '51999', eventType: 'send_failed' }]);
  assert.deepEqual(deMemoria, deBase);
});

test('cada pregunta se nombra en castellano para la pantalla', () => {
  for (const kind of QUALITY_KINDS) {
    assert.notEqual(kindLabel(kind), kind, `falta la etiqueta de ${kind}`);
  }
});

/**
 * La clasificación nombra tipos de la bitácora por su cadena literal, así que
 * un tipo renombrado en el bot deja su cajón en cero sin que nada falle — el
 * fallo silencioso de siempre. Esto lo comprueba contra el código real.
 */
test('todos los tipos que se miden siguen existiendo en el bot', () => {
  const fuente = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'whatsappBotService.js'),
    'utf8'
  );
  for (const type of trackedActivityTypes()) {
    assert.ok(
      fuente.includes(`type: '${type}'`),
      `"${type}" ya no se anota en whatsappBotService.js: su cajón del monitor quedaría siempre en cero`
    );
  }
});
