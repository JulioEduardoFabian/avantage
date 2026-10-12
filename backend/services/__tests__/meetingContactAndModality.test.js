import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstRealName, isGenericContactName, GENERIC_CONTACT_NAME } from '../contactName.js';
import { ScheduledMeetingService, meetingContactName } from '../scheduledMeetingService.js';

/*
 * Dos reglas de la reunión cargada a mano:
 *
 *  (1) con quién es — el marcador que el bot le pone a un contacto sin nombre
 *      de perfil no es un nombre, y llenaba la agenda de "Contacto de WhatsApp"
 *      repetidos que no identifican a nadie;
 *  (2) por dónde se hace — una reunión por Meet sin cuenta de Google conectada
 *      es una videollamada sin sala, así que se rechaza al agendar en vez de
 *      guardarse con un aviso que se lee una vez.
 */

/* ------------------------------- El nombre ------------------------------- */

test('el marcador del bot no cuenta como nombre; un nombre de verdad sí', () => {
  assert.equal(isGenericContactName(GENERIC_CONTACT_NAME), true);
  assert.equal(isGenericContactName('  contacto de whatsapp  '), true);
  assert.equal(isGenericContactName(''), true);
  assert.equal(isGenericContactName(null), true);
  assert.equal(isGenericContactName('Rafael Gonzales'), false);
});

test('firstRealName se queda con el primer nombre de verdad de la lista', () => {
  assert.equal(firstRealName(GENERIC_CONTACT_NAME, 'Rafael Gonzales'), 'Rafael Gonzales');
  assert.equal(firstRealName(null, '', GENERIC_CONTACT_NAME), null);
});

test('manda el nombre escrito al agendar por encima del de la ficha', () => {
  const row = { contact_name: 'Rafael G.', lead_full_name: 'Rafael Anderson Gonzales Ureta', wa_id: '51987654321' };
  assert.equal(meetingContactName(row), 'Rafael G.');
});

test('sin nombre propio sale el del lead, y el marcador del bot nunca', () => {
  assert.equal(meetingContactName({ lead_full_name: 'Lucía Pérez' }), 'Lucía Pérez');
  assert.equal(
    meetingContactName({ lead_full_name: GENERIC_CONTACT_NAME, wa_id: '51987654321' }),
    '51987654321',
    'el teléfono identifica a la persona; el marcador no'
  );
});

test('sin nombre ni teléfono queda en null y la pantalla decide cómo llamarlo', () => {
  assert.equal(meetingContactName({}), null);
  assert.equal(meetingContactName(null), null);
});

/* ------------------------------ La modalidad ----------------------------- */

const conectados = (ids) => ({
  async getConnection(userId) {
    return ids.includes(userId) ? { user_id: userId } : undefined;
  }
});

test('con el Google del asesor conectado se puede agendar por Meet', async () => {
  const service = new ScheduledMeetingService({ googleCalendarService: conectados([7]) });
  assert.equal(await service.meetBlockedReason([7, 4]), null);
});

test('alcanza con el Google de quien agenda: el evento cae en su calendario', async () => {
  const service = new ScheduledMeetingService({ googleCalendarService: conectados([4]) });
  assert.equal(await service.meetBlockedReason([7, 4]), null);
});

test('sin ninguna cuenta conectada, el motivo nombra las dos salidas', async () => {
  const service = new ScheduledMeetingService({ googleCalendarService: conectados([]) });
  const motivo = await service.meetBlockedReason([7, 4]);
  assert.match(motivo, /conectada/i);
  assert.match(motivo, /telefónica/i, 'tiene que decir que se puede agendar como llamada');
});

test('sin el servicio de Google configurado tampoco se agenda por Meet', async () => {
  const service = new ScheduledMeetingService();
  assert.match(await service.meetBlockedReason([7]), /telefónica/i);
});

test('bookManual rechaza la reunión por Meet antes de guardar nada', async () => {
  const service = new ScheduledMeetingService({ googleCalendarService: conectados([]) });
  await assert.rejects(
    () => service.bookManual({
      advisorUserId: 7,
      createdBy: 4,
      startTime: '2026-10-20T15:00:00.000Z',
      endTime: '2026-10-20T15:30:00.000Z'
    }),
    /conectada/i
  );
});
