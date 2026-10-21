import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WhatsappBotService } from '../whatsappBotService.js';

/**
 * El 15/10/2026 un lead de Facebook Ads escribió a las 7:18 p.m. y a las 8:48
 * recibió CUATRO mensajes seguidos: "Perdona la demora", "Perdona la demora,
 * se me quedó tu mensaje sin responder", "Te paso con un asesor" y recién
 * entonces el saludo con la primera pregunta. Lo transfirieron a un asesor
 * mientras la respuesta que lo iba a atender se estaba escribiendo.
 *
 * Fueron dos barridos pisándose: el primero recuperó el mensaje huérfano
 * (`_recoverOrphanInbounds`) y arrancó el turno, que tarda 10-20 s por el LLM;
 * el segundo leyó la foto de "quién habló último" ANTES de que ese saliente
 * llegara a la base —`send()` guarda la fila después de dormir el gap de
 * tecleo y de llamar a la Graph API—, lo dio por perdido otra vez y, con
 * `missed_reply_at` ya marcado por el primero, cayó directo en la rama de
 * transferencia.
 *
 * Estas pruebas cubren los dos frenos nuevos. La revalidación contra la base
 * no se ejercita acá porque toca `db` directamente; su equivalente en memoria
 * —el turno en curso— sí, y es el que cierra la ventana del caso real.
 */

function makeBot() {
  const bot = Object.create(WhatsappBotService.prototype);
  bot.logged = [];
  bot.logActivity = (entry) => { bot.logged.push(entry); };
  bot.turnChains = new Map();
  bot.sweepInFlight = false;
  return bot;
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('el tick que cae con un barrido en curso se descarta en vez de correr encima', async () => {
  const bot = makeBot();
  const gate = deferred();
  let corridas = 0;
  bot._runStaleConversationsSweep = async () => {
    corridas += 1;
    await gate.promise;
  };

  const primero = bot.checkStaleConversations();
  await bot.checkStaleConversations();

  assert.equal(corridas, 1, 'el segundo tick no debe arrancar otro barrido');
  assert.ok(
    bot.logged.some((e) => e.type === 'stale_sweep_skipped_overlap'),
    'el tick descartado queda en la bitácora'
  );

  gate.resolve();
  await primero;

  // Descartar un tick no puede dejar el barrido trabado para siempre.
  await bot.checkStaleConversations();
  assert.equal(corridas, 2, 'terminado el anterior, el siguiente tick sí corre');
});

test('el candado se libera aunque el barrido falle', async () => {
  const bot = makeBot();
  bot._runStaleConversationsSweep = async () => { throw new Error('se cayó la base'); };

  await assert.rejects(() => bot.checkStaleConversations(), /se cayó la base/);
  assert.equal(bot.sweepInFlight, false);
});

test('no se da por perdido un turno que se está respondiendo ahora mismo', async () => {
  const bot = makeBot();
  const enviados = [];
  bot.send = async (waId, text) => { enviados.push(text); };
  bot.handOffToAdvisor = async () => { throw new Error('no debería transferir'); };
  // Es lo que deja `runSerialized` mientras el turno corre: el contacto del
  // caso real estaba justo acá cuando entró el segundo barrido.
  bot.turnChains.set('51918855063', Promise.resolve());

  await bot._recoverMissedReply({ id: 7, wa_id: '51918855063' }, 'Hola 👋 Quiero información para avanzar mi tesis.');

  assert.deepEqual(enviados, [], 'no sale ninguna disculpa encima del turno en curso');
  assert.ok(bot.logged.some((e) => e.type === 'missed_reply_skipped_turn_running'));
});
