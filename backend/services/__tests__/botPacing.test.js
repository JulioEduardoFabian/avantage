import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSendAt, typingTimeFor } from '../whatsappBotService.js';

/**
 * El ritmo con el que Avan suelta sus mensajes. Lo reportó ventas el 16/10:
 * "está respondiendo muy rápido, se nota que es un bot".
 *
 * La causa estaba en el PISO de la espera. Después de cada llamada al LLM
 * (10-20 s) el gap antispam ya venció, y ahí el piso era una constante de
 * 2,5 s para cualquier mensaje: la respuesta más larga de la conversación
 * salía tan rápido como un acuse de dos palabras, y todo el trabajo de
 * `typingTimeFor` no se usaba justo en el camino por el que pasa casi toda
 * la conversación.
 */

const GAP = 5000;        // mínimo antispam configurado, el valor por defecto
const LARGO = 'palabra '.repeat(40).trim();
const CORTO = 'Perfecto 👀';

test('un mensaje largo nunca sale tan rápido como un acuse corto', () => {
  const now = 1_000_000;
  // `reserved` muy viejo = el gap ya venció, que es el caso después del LLM.
  const reserved = now - 60_000;

  const largo = nextSendAt({ now, reserved, configuredGapMs: GAP, typingMs: typingTimeFor(LARGO) }) - now;
  const corto = nextSendAt({ now, reserved, configuredGapMs: GAP, typingMs: typingTimeFor(CORTO) }) - now;

  assert.ok(largo > corto, `el largo (${largo} ms) tiene que esperar más que el corto (${corto} ms)`);
  assert.ok(largo >= 6000, `cuarenta palabras en ${largo} ms no las escribe nadie`);
});

test('ningún mensaje sale instantáneo, por corto que sea', () => {
  const now = 1_000_000;
  const espera = nextSendAt({ now, reserved: now - 60_000, configuredGapMs: GAP, typingMs: typingTimeFor('Ok') }) - now;
  assert.ok(espera >= 2500, `salió en ${espera} ms`);
});

test('dos mensajes seguidos se encolan en vez de salir juntos', () => {
  const now = 1_000_000;
  // El primero ya reservó su momento; el segundo tiene que caer después.
  const primero = nextSendAt({ now, reserved: 0, configuredGapMs: GAP, typingMs: typingTimeFor(CORTO) });
  const segundo = nextSendAt({ now, reserved: primero, configuredGapMs: GAP, typingMs: typingTimeFor(CORTO) });

  assert.ok(segundo >= primero + GAP, 'entre uno y otro tiene que pasar el gap antispam completo');
});

test('el gap antispam configurado se respeta aunque el texto sea cortísimo', () => {
  const now = 1_000_000;
  const espera = nextSendAt({ now, reserved: 0, configuredGapMs: GAP, typingMs: typingTimeFor('Ok') }) - now;
  assert.ok(espera >= GAP, `salió en ${espera} ms, por debajo del mínimo antispam`);
});
