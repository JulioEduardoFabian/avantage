import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGoogleEvent, planCalendarSync, planMeetingImport, planMeetingUpdate } from '../calendarSync.js';

/**
 * La sincronización del Calendario con Google. Las reglas se prueban acá, sin
 * credenciales y sin base de datos, porque este botón reescribe horas de
 * reuniones y marca cancelaciones: lo que decide tiene que poder verificarse.
 */

const NOW = new Date('2026-10-16T15:00:00.000Z');

function googleEvent(overrides = {}) {
  return {
    id: 'evt-1',
    status: 'confirmed',
    summary: 'Asesoría de tesis',
    start: { dateTime: '2026-10-20T15:00:00-05:00' },
    end: { dateTime: '2026-10-20T15:30:00-05:00' },
    hangoutLink: 'https://meet.google.com/abc-defg-hij',
    ...overrides
  };
}

function panelMeeting(overrides = {}) {
  return {
    id: 7,
    calendar_event_id: 'evt-1',
    start_time: new Date('2026-10-20T20:00:00.000Z'),
    end_time: new Date('2026-10-20T20:30:00.000Z'),
    meet_link: 'https://meet.google.com/abc-defg-hij',
    cancelled_at: null,
    reminder_sent_at: null,
    ...overrides
  };
}

/* ------------------------------ Normalización ----------------------------- */

test('un evento de día completo se reconoce como tal: no se puede ubicar en una grilla de horas', () => {
  const event = normalizeGoogleEvent(googleEvent({ start: { date: '2026-10-20' }, end: { date: '2026-10-21' } }));
  assert.equal(event.allDay, true);
});

test('el enlace de Meet llega limpio, sin el ?authuser que fuerza la cuenta equivocada', () => {
  const event = normalizeGoogleEvent(googleEvent({ hangoutLink: 'https://meet.google.com/abc-defg-hij?authuser=0' }));
  assert.equal(event.meetLink, 'https://meet.google.com/abc-defg-hij');
});

test('el invitado es con quién es la reunión: ni la cuenta del asesor ni una sala', () => {
  const event = normalizeGoogleEvent(googleEvent({
    attendees: [
      { email: 'asesor@avantage.com', self: true, displayName: 'Kevin' },
      { email: 'sala-lima@recursos.com', resource: true, displayName: 'Sala Lima' },
      { email: 'mario@gmail.com', displayName: 'Mario Ríos' }
    ]
  }));
  assert.equal(event.guestName, 'Mario Ríos');
  assert.equal(event.guestEmail, 'mario@gmail.com');
});

/* ------------------------- Reuniones que ya existen ----------------------- */

test('la reunión que no cambió no genera ninguna escritura', () => {
  assert.equal(planMeetingUpdate(panelMeeting(), normalizeGoogleEvent(googleEvent()), { now: NOW }), null);
});

test('movida en Google: el panel copia la hora nueva', () => {
  const event = normalizeGoogleEvent(googleEvent({
    start: { dateTime: '2026-10-20T17:00:00-05:00' },
    end: { dateTime: '2026-10-20T17:30:00-05:00' }
  }));
  const { patch, reason } = planMeetingUpdate(panelMeeting(), event, { now: NOW });
  assert.equal(reason, 'movida en Google');
  assert.equal(patch.start_time.toISOString(), '2026-10-20T22:00:00.000Z');
  assert.equal(patch.end_time.toISOString(), '2026-10-20T22:30:00.000Z');
});

test('si la reunión se movió, el recordatorio ya enviado se vuelve a habilitar', () => {
  // El que salió nombraba la hora vieja: dejarlo marcado como enviado es
  // garantizar que el lead se conecte a la hora equivocada.
  const meeting = panelMeeting({ reminder_sent_at: new Date('2026-10-20T19:00:00.000Z') });
  const event = normalizeGoogleEvent(googleEvent({
    start: { dateTime: '2026-10-20T17:00:00-05:00' },
    end: { dateTime: '2026-10-20T17:30:00-05:00' }
  }));
  const { patch } = planMeetingUpdate(meeting, event, { now: NOW });
  assert.equal(patch.reminder_sent_at, null);
});

test('una reunión que ya pasó no resucita su recordatorio', () => {
  const meeting = panelMeeting({
    start_time: new Date('2026-10-10T20:00:00.000Z'),
    end_time: new Date('2026-10-10T20:30:00.000Z'),
    reminder_sent_at: new Date('2026-10-10T19:00:00.000Z')
  });
  const event = normalizeGoogleEvent(googleEvent({
    start: { dateTime: '2026-10-10T16:00:00-05:00' },
    end: { dateTime: '2026-10-10T16:30:00-05:00' }
  }));
  const { patch } = planMeetingUpdate(meeting, event, { now: NOW });
  assert.ok(patch.start_time, 'la hora se corrige igual');
  assert.equal('reminder_sent_at' in patch, false, 'pero no se le avisa de una reunión que terminó');
});

test('borrada en Google: se marca cancelada, no se borra la fila', () => {
  const { patch, reason } = planMeetingUpdate(panelMeeting(), null, { now: NOW });
  assert.equal(reason, 'cancelada en Google');
  assert.equal(patch.cancelled_at, NOW);
  assert.equal('id' in patch, false, 'el parche son columnas y nada más: nadie borra nada acá');
});

test('cancelar dos veces no vuelve a escribir', () => {
  const meeting = panelMeeting({ cancelled_at: new Date('2026-10-15T10:00:00.000Z') });
  assert.equal(planMeetingUpdate(meeting, null, { now: NOW }), null);
});

test('restaurada en Google: se le quita la marca de cancelada', () => {
  const meeting = panelMeeting({ cancelled_at: new Date('2026-10-15T10:00:00.000Z') });
  const { patch, reason } = planMeetingUpdate(meeting, normalizeGoogleEvent(googleEvent()), { now: NOW });
  assert.equal(reason, 'restaurada en Google');
  assert.equal(patch.cancelled_at, null);
});

test('el enlace de Meet nuevo se copia', () => {
  const event = normalizeGoogleEvent(googleEvent({ hangoutLink: 'https://meet.google.com/zzz-yyyy-xxx' }));
  const { patch, reason } = planMeetingUpdate(panelMeeting(), event, { now: NOW });
  assert.equal(reason, 'enlace actualizado');
  assert.equal(patch.meet_link, 'https://meet.google.com/zzz-yyyy-xxx');
});

/* ------------------------------- Importación ------------------------------ */

test('un evento que el panel no conocía entra con su título y su invitado', () => {
  const event = normalizeGoogleEvent(googleEvent({
    id: 'evt-nuevo',
    summary: 'Revisión de capítulo 3',
    attendees: [{ email: 'mario@gmail.com', displayName: 'Mario Ríos' }]
  }));
  const fila = planMeetingImport(event, 4);
  assert.equal(fila.advisor_user_id, 4);
  assert.equal(fila.calendar_event_id, 'evt-nuevo');
  assert.equal(fila.topic, 'Revisión de capítulo 3');
  assert.equal(fila.contact_name, 'Mario Ríos');
  assert.equal(fila.source, 'google');
  assert.equal(fila.modality, 'meet', 'de un evento ajeno no se afirma que sea telefónico');
});

/* --------------------------------- El plan -------------------------------- */

test('sincronizar dos veces no importa el mismo evento dos veces', () => {
  const events = [googleEvent({ id: 'evt-ya-esta' })];
  const plan = planCalendarSync({
    meetings: [],
    events,
    knownEventIds: new Set(['evt-ya-esta']),
    advisorUserId: 4,
    now: NOW
  });
  assert.equal(plan.imports.length, 0);
});

test('un evento compartido entre dos asesores entra una sola vez', () => {
  // Mismo evento en los dos calendarios (uno invitó al otro): al sincronizar
  // al segundo ya figura como conocido.
  const events = [googleEvent({ id: 'evt-compartido' })];
  const primero = planCalendarSync({ meetings: [], events, knownEventIds: new Set(), advisorUserId: 4, now: NOW });
  assert.equal(primero.imports.length, 1);

  const conocidos = new Set(primero.imports.map((fila) => fila.calendar_event_id));
  const segundo = planCalendarSync({ meetings: [], events, knownEventIds: conocidos, advisorUserId: 9, now: NOW });
  assert.equal(segundo.imports.length, 0);
});

test('los eventos de día completo se cuentan aparte en vez de desaparecer', () => {
  const plan = planCalendarSync({
    meetings: [],
    events: [googleEvent({ id: 'evt-dia', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } })],
    advisorUserId: 4,
    now: NOW
  });
  assert.equal(plan.imports.length, 0);
  assert.equal(plan.skipped.allDay, 1);
});

test('la basura de la papelera de Google no se importa', () => {
  const plan = planCalendarSync({
    meetings: [],
    events: [googleEvent({ id: 'evt-borrado', status: 'cancelled' })],
    advisorUserId: 4,
    now: NOW
  });
  assert.equal(plan.imports.length, 0);
});

test('la reunión cuyo evento no vino en el rango NO se cancela: se devuelve para preguntar', () => {
  // El asesor pudo haberla movido al mes siguiente, fuera del rango
  // consultado. Marcarla cancelada sin preguntar borraría del panel una
  // reunión que sigue en pie.
  const plan = planCalendarSync({
    meetings: [panelMeeting({ id: 7, calendar_event_id: 'evt-movido' })],
    events: [],
    advisorUserId: 4,
    now: NOW
  });
  assert.equal(plan.updates.length, 0, 'nada se marca a ciegas');
  assert.deepEqual(plan.missing.map((m) => m.id), [7]);
});

test('una reunión sin evento (nació sin él) no se toca ni se cancela', () => {
  const plan = planCalendarSync({
    meetings: [panelMeeting({ calendar_event_id: null })],
    events: [],
    advisorUserId: 4,
    now: NOW
  });
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.missing.length, 0);
});

test('un mes real: una movida, una nueva y una borrada', () => {
  const meetings = [
    panelMeeting({ id: 1, calendar_event_id: 'evt-igual' }),
    panelMeeting({
      id: 2,
      calendar_event_id: 'evt-movida',
      start_time: new Date('2026-10-21T20:00:00.000Z'),
      end_time: new Date('2026-10-21T20:30:00.000Z')
    }),
    panelMeeting({ id: 3, calendar_event_id: 'evt-borrada' })
  ];
  const events = [
    googleEvent({ id: 'evt-igual' }),
    googleEvent({
      id: 'evt-movida',
      start: { dateTime: '2026-10-21T18:00:00-05:00' },
      end: { dateTime: '2026-10-21T18:30:00-05:00' }
    }),
    googleEvent({ id: 'evt-borrada', status: 'cancelled' }),
    googleEvent({ id: 'evt-ajena', summary: 'Reunión de equipo' })
  ];

  const plan = planCalendarSync({ meetings, events, advisorUserId: 4, now: NOW });

  assert.deepEqual(
    plan.updates.map((u) => [u.meetingId, u.reason]),
    [[2, 'movida en Google'], [3, 'cancelada en Google']]
  );
  assert.deepEqual(plan.imports.map((fila) => fila.topic), ['Reunión de equipo']);
  assert.equal(plan.missing.length, 0);
});
