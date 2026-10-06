import test from 'node:test';
import assert from 'node:assert/strict';

import { WhatsappBotService } from '../whatsappBotService.js';
import { criticalSignal, isWaitingInMeeting } from '../leadSignals.js';
import { unreadableMessage } from '../../copy/whatsappBotCopy.js';

/*
 * Arreglos de UX conversacional que salieron de revisar las 2.723 conversaciones
 * del 08/09 al 05/10. Cada bloque nombra el caso real que lo motivó: si alguien
 * cambia el texto o la expresión regular, el caso tiene que seguir cubierto.
 */

test('el lead que avisa que está esperando en la reunión se detecta', () => {
  // Los cuatro casos reales del período. Ninguno recibió respuesta.
  const reales = [
    'Estoy en sala de espera',
    'Me encuentro en la sala de espera',
    'Me estoy uniendo',
    'No hay nadie quien me acepte ...'
  ];
  for (const texto of reales) {
    assert.equal(isWaitingInMeeting(texto), true, `debería detectarse: ${texto}`);
  }
});

test('reconoce otras formas de decir que ya entró al Meet', () => {
  for (const texto of ['ya entré al meet', 'Ya estoy en el link', 'no me aceptan', 'esperando que me acepten']) {
    assert.equal(isWaitingInMeeting(texto), true, `debería detectarse: ${texto}`);
  }
});

test('no confunde estar esperando con otras frases que empiezan igual', () => {
  // "Estoy en la universidad" comparte el arranque y no tiene nada que ver;
  // tratarlo como una reunión en curso dispararía una alerta urgente falsa.
  for (const texto of ['Estoy en la universidad', 'estoy en quinto ciclo', 'quiero agendar una reunión', 'me estoy decidiendo']) {
    assert.equal(isWaitingInMeeting(texto), false, `no debería detectarse: ${texto}`);
  }
});

test('un mensaje muy largo no se lee como aviso de sala de espera', () => {
  // El aviso de sala es corto por naturaleza ("estoy en la sala"). Un párrafo
  // que menciona la reunión de pasada no puede disparar una alerta urgente.
  const largo = 'Estoy en sala de espera '.repeat(12);
  assert.equal(isWaitingInMeeting(largo), false);
});

test('"no hay nadie" en presente también cuenta como plantón', () => {
  // La expresión solo cubría el pasado ("no había nadie"), así que el caso
  // real del 03/10 —"No hay nadie quien me acepte"— no escalaba a nadie.
  assert.equal(criticalSignal('no hay nadie'), 'noShow');
  assert.equal(criticalSignal('no me aceptan en la reunión'), 'noShow');
});

test('el aviso por un mensaje ilegible nombra lo que la persona mandó', () => {
  // Decir "no te entiendo" a quien mandó una foto le hace pensar que el
  // mensaje no llegó. Tiene que quedar claro que llegó y que no se puede abrir.
  const porImagen = unreadableMessage('image');
  assert.match(porImagen, /la imagen/);
  assert.match(porImagen, /escrito/);

  const porAudio = unreadableMessage('audio');
  assert.match(porAudio, /tu audio/);
  assert.match(porAudio, /escuchar/);
});

test('nunca le pide a la persona que vuelva a mandar lo mismo', () => {
  // Lo mandó bien; el que no puede leerlo es el bot. "Reenvíamelo" le echa la
  // culpa a quien hizo todo correcto.
  for (const tipo of ['image', 'document', 'audio', 'sticker']) {
    assert.doesNotMatch(unreadableMessage(tipo), /vuelve a (enviar|mandar)|reenv/i);
  }
});

test('un tipo desconocido igual produce un texto usable', () => {
  // La lista de tipos de Meta crece sola; un tipo nuevo no puede dejar el
  // mensaje a medias ni mostrar "undefined".
  const texto = unreadableMessage('tipo_que_no_existe');
  assert.doesNotMatch(texto, /undefined/);
  assert.match(texto, /escrito/);
});

/* ------------------------------------------------------------------------ */
/* El recordatorio de inactividad en conversación libre                      */
/* ------------------------------------------------------------------------ */

/**
 * Construye el servicio con dobles, como en `schedulingRecovery.test.js`: lo
 * que se ejercita acá solo arma texto y no toca la base ni Google.
 */
function makeNudgeBot({ slot = null } = {}) {
  const bot = Object.create(WhatsappBotService.prototype);
  const logged = [];
  bot.logged = logged;
  bot.logActivity = (entry) => { logged.push(entry); };
  bot.updateSession = async () => {};
  bot.googleCalendarService = {
    getUpcomingFreeSlots: async () => (slot ? [slot] : [])
  };
  return bot;
}

function sessionWith(answers, status = 'active') {
  return { wa_id: '51999000111', status, answers: JSON.stringify(answers) };
}

test('en conversación libre el recordatorio nombra el dato que falta', async () => {
  // El genérico "¿Sigues por ahí?" fue el último mensaje de 72 conversaciones
  // entre el 20/09 y el 05/10, con 26% de respuesta: no le da nada que
  // contestar a alguien que ya se distrajo.
  const bot = makeNudgeBot();
  const texto = await bot._inactivityNudgeText(sessionWith({ field: 'Enfermería' }), 0);

  assert.match(texto, /universidad/i);
  assert.doesNotMatch(texto, /Sigues por ahí/i);
  assert.match(texto, /horarios/i, 'tiene que decir para qué sirve contestar');
});

test('el recordatorio con el dato pendiente no arranca en mayúscula a mitad de frase', async () => {
  // Las preguntas vienen con "¡Perfecto! ¿De qué carrera...?" y se incrustan
  // dentro de otra oración: pegarlas tal cual dejaba "...una sola cosa: ¿De qué".
  const bot = makeNudgeBot();
  const texto = await bot._inactivityNudgeText(sessionWith({}), 0);

  assert.match(texto, /una sola cosa: ¿de qué carrera/);
  assert.doesNotMatch(texto, /¡Perfecto!/);
});

test('si ya no falta ningún dato, vuelve al recordatorio genérico', async () => {
  // Sin dato pendiente no hay nada concreto que pedir, y prometerle un horario
  // que después no se le reserva sería peor que el genérico.
  const bot = makeNudgeBot();
  const sesion = sessionWith({ field: 'Derecho', university: 'UNMSM', problem: 'tesis de grado' });
  const texto = await bot._inactivityNudgeText(sesion, 0);

  assert.match(texto, /Sigues por ahí/i);
});

test('el recordatorio de quien se quedó mudo frente a los horarios sigue nombrando un bloque', async () => {
  // Es el camino que ya existía y que esta mejora no debía tocar.
  const bot = makeNudgeBot({ slot: { label: 'Mar, 6 oct, 11:00 a.m.' } });
  const sesion = sessionWith({ __scheduling: { mode: 'meet' } }, 'scheduling_time');
  const texto = await bot._inactivityNudgeText(sesion, 0);

  assert.match(texto, /Mar, 6 oct, 11:00 a\.m\./);
  assert.doesNotMatch(texto, /Sigues por ahí/i);
});
