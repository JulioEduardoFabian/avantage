import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinCustomerWindow } from '../whatsappMessageService.js';
import { WhatsappBotService } from '../whatsappBotService.js';

/*
 * Ventana de servicio al cliente de WhatsApp (24 h desde el último mensaje del
 * contacto). Todos los mensajes que quedaron en `failed` —recordatorios de
 * reunión y las alertas "🆘 Lead transferido a un asesor" al número interno
 * 51972566937— eran texto libre mandado fuera de esta ventana, y nadie se
 * enteró. Estas pruebas cubren la decisión que antes no existía.
 */

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-23T18:00:00Z');

test('sin ningún mensaje entrante la ventana está cerrada', () => {
  assert.equal(isWithinCustomerWindow(null, NOW), false);
  assert.equal(isWithinCustomerWindow(undefined, NOW), false);
});

test('una fecha ilegible cuenta como ventana cerrada, no como abierta', () => {
  assert.equal(isWithinCustomerWindow('no-es-una-fecha', NOW), false);
});

test('a las 23 h del último mensaje del contacto la ventana sigue abierta', () => {
  assert.equal(isWithinCustomerWindow(new Date(NOW - 23 * HOUR), NOW), true);
});

test('a las 25 h ya está cerrada: es el caso real de las alertas que fallaron', () => {
  assert.equal(isWithinCustomerWindow(new Date(NOW - 25 * HOUR), NOW), false);
});

test('justo en las 24 h está cerrada (el límite no se incluye)', () => {
  assert.equal(isWithinCustomerWindow(new Date(NOW - 24 * HOUR), NOW), false);
});

/* ------------------------------------------------------------------ */

/**
 * Bot con lo mínimo para ejercitar `send()`, sin base de datos ni red.
 * `globallyEnabled` es el interruptor global de Avan, que `send()` consulta
 * antes que la ventana: encendido por defecto, que es como está en producción.
 */
function botWithWindow(windowOpen, { globallyEnabled = true } = {}) {
  const sent = [];
  const bot = new WhatsappBotService({
    whatsappMessageService: {
      isCustomerWindowOpen: async () => windowOpen,
      sendTextMessage: async (waId, text) => { sent.push({ waId, text }); },
      sendTypingIndicator: async () => {}
    },
    settingsService: {
      get: async () => ({ message_gap_seconds: 0, typing_indicator_enabled: false }),
      isBotEnabled: async () => globallyEnabled
    }
  });
  return { bot, sent };
}

test('con el bot apagado globalmente no sale ni una respuesta a un mensaje recién llegado', async () => {
  // La ventana está ABIERTA y el envío no es proactivo: lo único que lo frena
  // es el interruptor global. Es la red de último momento de `send()` — los
  // caminos que hablan ya vuelven antes, pero si alguno se agrega después, el
  // lead no puede recibir un mensaje del bot que el equipo acaba de apagar.
  const { bot, sent } = botWithWindow(true, { globallyEnabled: false });
  await assert.rejects(() => bot.send('51999', 'hola'), (error) => error.code === 'BOT_DISABLED');
  assert.equal(sent.length, 0);
});

test('un envío proactivo con la ventana cerrada no se manda: falla con WINDOW_CLOSED', async () => {
  const { bot, sent } = botWithWindow(false);
  await assert.rejects(
    () => bot.send('51999999999', 'Te recuerdo tu reunión', { requireOpenWindow: true }),
    (error) => error.code === 'WINDOW_CLOSED'
  );
  assert.equal(sent.length, 0, 'no debe intentar el envío que WhatsApp va a rechazar');
});

test('un envío proactivo con la ventana abierta sí sale', async () => {
  const { bot, sent } = botWithWindow(true);
  await bot.send('51999999999', 'Te recuerdo tu reunión', { requireOpenWindow: true });
  assert.equal(sent.length, 1);
});

test('una respuesta normal no comprueba la ventana: el mensaje del contacto acaba de llegar', async () => {
  const { bot, sent } = botWithWindow(false);
  await bot.send('51999999999', 'Claro, te cuento');
  assert.equal(sent.length, 1, 'el bot no puede dejar de responder por esta comprobación');
});
