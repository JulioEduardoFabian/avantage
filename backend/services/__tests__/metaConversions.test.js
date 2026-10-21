import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKFILL_WINDOW_DAYS,
  buildEvent,
  datasetFor,
  eventTimeFor,
  leadIdValue,
  messagingEventName,
  resolveIdentifier,
  tokenFor
} from '../metaConversionsService.js';

/**
 * Conversiones hacia Meta: las reglas que deciden qué se le manda y con qué
 * forma. Son las que no se pueden verificar mirando el panel —si el evento sale
 * mal, Meta lo descarta en silencio y la campaña sigue optimizando por la
 * métrica equivocada.
 */

const AHORA = new Date('2026-10-19T15:00:00Z');

test('el lead_id de 17 dígitos NO se convierte a número', () => {
  // A partir de 2^53 un entero de JavaScript pierde los últimos dígitos, así
  // que convertirlo manda el id de otro lead (o de ninguno).
  const grande = '12345678901234567';
  assert.equal(leadIdValue(grande), grande, 'tiene que viajar como cadena, sin perder dígitos');
  assert.equal(Number.isSafeInteger(Number(grande)), false, 'el supuesto de la regla');
});

test('el lead_id que entra exacto viaja como número, que es lo que pide Meta', () => {
  assert.equal(leadIdValue('123456789012345'), 123456789012345);
  assert.equal(typeof leadIdValue('123456789012345'), 'number');
});

test('lo que no son puros dígitos no es un lead_id', () => {
  assert.equal(leadIdValue(''), null);
  assert.equal(leadIdValue(null), null);
  assert.equal(leadIdValue('abc'), null);
  assert.equal(leadIdValue('123abc'), null);
});

test('el formulario manda sobre el click de WhatsApp cuando están los dos', () => {
  // El lead_id es la atribución que Meta considera propia del lead; el
  // ctwa_clid identifica una conversación.
  const id = resolveIdentifier({ meta_leadgen_id: '123456789012345' }, 'ARAkXYZ');
  assert.deepEqual(id, { kind: 'lead_id', value: 123456789012345 });
});

test('el lead de Click-to-WhatsApp se reconoce por su click id', () => {
  assert.deepEqual(resolveIdentifier({ meta_leadgen_id: null }, 'ARAkXYZ'), {
    kind: 'ctwa_clid',
    value: 'ARAkXYZ'
  });
});

test('un lead sin atribución de Meta no se reporta', () => {
  // El del evaluador público o el cargado a mano: no hay a qué anuncio
  // atribuirlo, y un evento sin identificador lo descarta Meta.
  assert.equal(resolveIdentifier({ meta_leadgen_id: null }, null), null);
  assert.equal(resolveIdentifier({}, '   '), null);
});

test('el evento del formulario va como evento de CRM', () => {
  const event = buildEvent({
    eventName: 'Cotizado',
    eventTime: 1760000000,
    identifier: { kind: 'lead_id', value: 123456789012345 },
    leadEventSource: 'Avantage CRM'
  });
  assert.deepEqual(event, {
    event_name: 'Cotizado',
    event_time: 1760000000,
    action_source: 'system_generated',
    user_data: { lead_id: 123456789012345 },
    custom_data: { lead_event_source: 'Avantage CRM', event_source: 'crm' }
  });
});

test('el evento de Click-to-WhatsApp va como mensajería y no como CRM', () => {
  // Son las dos formas que acepta Meta, y usar la del otro origen hace que el
  // evento se descarte.
  const event = buildEvent({
    eventName: 'LeadSubmitted',
    eventTime: 1760000000,
    identifier: { kind: 'ctwa_clid', value: 'ARAkXYZ' },
    messagingIdentity: { pageId: '1234567890' }
  });
  assert.equal(event.action_source, 'business_messaging');
  assert.equal(event.messaging_channel, 'whatsapp');
  assert.deepEqual(event.user_data, { ctwa_clid: 'ARAkXYZ', page_id: '1234567890' });
});

test('el evento de mensajería lleva la identidad de quien recibió el clic', () => {
  // Meta lo exige: "no tiene ni page_id ni whatsapp_business_account_id". El
  // click id identifica el clic, no el negocio que lo recibió.
  const conPagina = buildEvent({
    eventName: 'LeadSubmitted',
    eventTime: 1760000000,
    identifier: { kind: 'ctwa_clid', value: 'X' },
    messagingIdentity: { pageId: 111, wabaId: 222 }
  });
  // Con las dos, manda la de la Página: es a lo que queda vinculado el
  // conjunto creado desde "Mensajes > Página de Facebook".
  assert.equal(conPagina.user_data.page_id, '111');
  assert.equal(conPagina.user_data.whatsapp_business_account_id, undefined);

  const soloWaba = buildEvent({
    eventName: 'LeadSubmitted',
    eventTime: 1760000000,
    identifier: { kind: 'ctwa_clid', value: 'X' },
    messagingIdentity: { wabaId: 222 }
  });
  assert.equal(soloWaba.user_data.whatsapp_business_account_id, '222');
});

test('el evento de formulario NO lleva page_id', () => {
  // Es del flujo de CRM: ahí el lead_id ya identifica todo, y un campo de más
  // es un campo que Meta puede rechazar.
  const event = buildEvent({
    eventName: 'Cotizado',
    eventTime: 1760000000,
    identifier: { kind: 'lead_id', value: 123 },
    messagingIdentity: { pageId: '1234567890' }
  });
  assert.equal(event.user_data.page_id, undefined);
});

test('ningún evento lleva importes', () => {
  // Decisión del equipo: Meta recibe la etapa, no cuánto facturó el cliente.
  for (const identifier of [{ kind: 'lead_id', value: 1 }, { kind: 'ctwa_clid', value: 'x' }]) {
    const event = buildEvent({ eventName: 'Venta ganada', eventTime: 1760000000, identifier });
    assert.equal(event.custom_data?.value, undefined);
    assert.equal(event.custom_data?.currency, undefined);
  }
});

test('un movimiento de más de 7 días no se intenta', () => {
  // Meta no acepta eventos más viejos que eso: mandarlo es gastar una llamada
  // para que lo descarte.
  const viejo = new Date(AHORA.getTime() - (BACKFILL_WINDOW_DAYS + 1) * 86400000);
  const result = eventTimeFor({ movedAt: viejo, createdAt: viejo, now: AHORA });
  assert.equal(result.ok, false);
  assert.match(result.reason, /7 días/);
});

test('el piso es la fecha del lead EN META, no la de esta base', () => {
  // Un lead recuperado por la conciliación entra días después de llenarse el
  // formulario; lo que Meta compara es su propia fecha de generación.
  const result = eventTimeFor({
    movedAt: '2026-10-19T12:00:00Z',
    metaCreatedAt: '2026-10-17T10:00:00Z',
    createdAt: '2026-10-19T11:00:00Z',
    now: AHORA
  });
  assert.equal(result.ok, true);
  assert.equal(result.eventTime, Math.floor(Date.parse('2026-10-19T12:00:00Z') / 1000));
});

test('un movimiento anterior al nacimiento del lead se corre un segundo después', () => {
  // Pasa con relojes que no coinciden; Meta descarta el evento anterior a la
  // generación del lead, y el movimiento sí ocurrió después.
  const result = eventTimeFor({
    movedAt: '2026-10-19T10:00:00Z',
    metaCreatedAt: '2026-10-19T10:00:05Z',
    now: AHORA
  });
  assert.equal(result.ok, true);
  assert.equal(result.eventTime, Math.floor(Date.parse('2026-10-19T10:00:05Z') / 1000) + 1);
});

test('una fecha futura se recorta a ahora', () => {
  const result = eventTimeFor({ movedAt: '2026-10-20T15:00:00Z', now: AHORA });
  assert.equal(result.eventTime, Math.floor(AHORA.getTime() / 1000));
});

test('sin fecha de movimiento no hay evento', () => {
  assert.equal(eventTimeFor({ movedAt: null, now: AHORA }).ok, false);
  assert.equal(eventTimeFor({ movedAt: 'cualquier cosa', now: AHORA }).ok, false);
});

test('cada origen va a SU conjunto de datos', () => {
  // Cruzarlos no devuelve error: Meta acepta el evento y no lo atribuye a
  // ningún anuncio, que es la peor forma de fallar porque nadie se entera.
  const config = { datasetId: 'CRM-1', messagingDatasetId: 'WABA-2' };
  assert.equal(datasetFor('lead_id', config), 'CRM-1');
  assert.equal(datasetFor('ctwa_clid', config), 'WABA-2');
});

test('sin el conjunto de mensajería, el lead de Click-to-WhatsApp no se manda al de CRM', () => {
  const config = { datasetId: 'CRM-1', messagingDatasetId: '' };
  assert.equal(datasetFor('ctwa_clid', config), null);
  assert.equal(datasetFor('lead_id', config), 'CRM-1');
});

test('sin ninguno configurado no hay destino', () => {
  assert.equal(datasetFor('lead_id', {}), null);
  assert.equal(datasetFor('ctwa_clid', {}), null);
  assert.equal(datasetFor('lead_id'), null);
});

test('cada conjunto se habla con su propio token cuando hay uno aparte', () => {
  // Un token del Administrador de eventos solo vale para el conjunto que lo
  // emitió: mandar al conjunto correcto con el token del otro es el mismo
  // rechazo que no tener permiso.
  const config = { accessToken: 'T-CRM', messagingAccessToken: 'T-WABA' };
  assert.equal(tokenFor('lead_id', config), 'T-CRM');
  assert.equal(tokenFor('ctwa_clid', config), 'T-WABA');
});

test('sin token propio de mensajería se usa el principal', () => {
  const config = { accessToken: 'T-UNICO', messagingAccessToken: 'T-UNICO' };
  assert.equal(tokenFor('ctwa_clid', config), 'T-UNICO');
  assert.equal(tokenFor('ctwa_clid', { accessToken: 'T-UNICO' }), 'T-UNICO');
});

test('en Click-to-WhatsApp el nombre del evento es uno de los estándar de Meta', () => {
  // Meta rechaza los nombres propios con action_source business_messaging:
  // "proporciona un valor válido como Purchase o LeadSubmitted". Los nombres
  // que puso el equipo solo valen para la mitad de formularios.
  const ganadoras = new Set(['ganado', 'col_mtc2nwec_fij']);
  assert.equal(messagingEventName('cita_agendada', ganadoras), 'LeadSubmitted');
  assert.equal(messagingEventName('ganado', ganadoras), 'Purchase');
});

test('la etapa ganadora se pregunta, no se compara contra una constante', () => {
  // La columna "Ganado" la crea el equipo y su clave se genera sola.
  assert.equal(messagingEventName('col_mtc2nwec_fij', new Set(['ganado', 'col_mtc2nwec_fij'])), 'Purchase');
  assert.equal(messagingEventName('col_mtc2nwec_fij', new Set(['ganado'])), 'LeadSubmitted');
});

test('un desenlace de pérdida no se reporta por Click-to-WhatsApp', () => {
  // Mandarlo como LeadSubmitted diría "este lead calificó" justo del que no
  // calificó; Meta tampoco optimiza en contra de un evento.
  assert.equal(messagingEventName('perdido', new Set(['ganado'])), null);
  assert.equal(messagingEventName('descartado', new Set(['ganado'])), null);
  assert.equal(messagingEventName(null, new Set()), null);
});
