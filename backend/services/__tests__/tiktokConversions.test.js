import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIKTOK_EVENT_NAMES,
  TikTokConversionsService,
  buildEvent,
  eventIdFor,
  eventTimeFor
} from '../tiktokConversionsService.js';

/*
 * TikTok nos manda los leads de formulario instantáneo —a mano, porque no hay
 * webhook— y nunca se enteraba de lo que pasó después. Sin esa vuelta su
 * optimización solo puede perseguir "más formularios llenados", que es justo la
 * métrica que se llena de leads que no contestan: la campaña aprende a traer
 * gente que completa un formulario, no gente que compra.
 *
 * Lo que fijan estas pruebas es lo que no se puede comprobar contra la API
 * (este entorno no tiene credenciales de TikTok): el Lead ID se preserva, las
 * fechas son las del hecho real, nada se manda sin identificador, y la
 * aceptación de un evento NO se confunde con que la campaña optimice por él.
 */

const AHORA = new Date('2026-11-01T12:00:00Z');

// ───────────────── El Lead ID se preserva, y es el único ────────────────────

test('el payload lleva el lead_id de TikTok tal cual y ningún dato de contacto', () => {
  const event = buildEvent({
    eventName: 'CompletePayment',
    eventTime: 1762000000,
    tiktokLeadId: '7412000000000000123',
    eventId: 'crm-5-completepayment'
  });

  assert.equal(event.user.lead_id, '7412000000000000123');
  assert.equal(typeof event.user.lead_id, 'string');
  // Con el lead_id TikTok ya sabe quién es: mandarle el teléfono sería exportar
  // un dato personal para nada.
  assert.deepEqual(Object.keys(event.user), ['lead_id']);
  // Y no viaja ningún importe, igual que en Meta: la plataforma recibe la
  // etapa, no cuánto facturó el cliente.
  assert.equal(event.value, undefined);
  assert.equal(event.properties, undefined);
});

test('un lead sin lead_id de TikTok no se reporta', async () => {
  /*
   * No hay equivalente del `ctwa_clid` de Meta: TikTok no manda referral al
   * chat. Un lead del evaluador, del alta manual o de WhatsApp orgánico no
   * tiene anuncio al que atribuirse, y forzarlo con un identificador
   * aproximado le enseñaría a la campaña una conversión que no trajo.
   */
  const svc = new TikTokConversionsService();
  svc.config = () => ({ enabled: true, sourceId: 'src', token: 'tok', missing: [] });
  svc.activeStageFor = async () => ({ status_key: 'ganado', event_name: 'CompletePayment' });

  const r = await svc.reportStageChange({ id: 5, tiktok_lead_id: null }, { status: 'ganado' });

  assert.equal(r.state, 'omitido');
  assert.equal(r.reason, 'sin_lead_id_de_tiktok');
});

// ──────────────────────── Las fechas son las reales ─────────────────────────

test('el evento se fecha en el momento del hecho, no del envío', () => {
  const movido = new Date('2026-10-30T09:00:00Z');
  const t = eventTimeFor({ movedAt: movido, tiktokCreatedAt: '2026-10-27T10:00:00Z', now: AHORA });

  assert.equal(t.ok, true);
  assert.equal(t.eventTime, Math.floor(movido.getTime() / 1000));
});

test('un movimiento anterior al alta del lead se ajusta al alta, no se descarta', () => {
  /*
   * TikTok descarta el evento anterior a la generación del lead. Pasa con las
   * fechas corregidas a mano, y perder el evento por eso sería peor que
   * reportarlo en el primer instante en que el lead ya existía.
   */
  const t = eventTimeFor({
    movedAt: new Date('2026-10-25T09:00:00Z'),
    tiktokCreatedAt: '2026-10-27T10:00:00Z',
    now: AHORA
  });

  assert.equal(t.ok, true);
  assert.equal(t.reason, 'ajustado_al_alta');
  assert.equal(t.eventTime, Math.floor(Date.parse('2026-10-27T10:00:00Z') / 1000));
});

test('lo que quedó fuera de la ventana se descarta ANTES de gastar la llamada', () => {
  // Un rechazo por antigüedad se ve igual que un error de forma, y manda a
  // buscar el problema donde no está.
  const t = eventTimeFor({ movedAt: new Date('2026-09-01T09:00:00Z'), now: AHORA });

  assert.equal(t.ok, false);
  assert.equal(t.reason, 'fuera_de_ventana');
});

test('una fecha futura no se manda', () => {
  const t = eventTimeFor({ movedAt: new Date('2026-12-01T09:00:00Z'), now: AHORA });
  assert.equal(t.ok, false);
  assert.equal(t.reason, 'fecha_futura');
});

test('sin fecha no se inventa el momento del envío', () => {
  const t = eventTimeFor({ now: AHORA });
  assert.equal(t.ok, false);
  assert.equal(t.reason, 'sin_fecha');
});

// ───────────────────────────── Deduplicación ────────────────────────────────

test('el event_id es determinista: un reenvío llega con el mismo id', () => {
  /*
   * La bitácora local evita el reenvío en el caso normal; esto cubre el caso en
   * que la bitácora y la plataforma no estén de acuerdo. Con un id al azar,
   * reabrir y volver a ganar se contaría como una segunda venta.
   */
  assert.equal(eventIdFor(5, 'CompletePayment'), eventIdFor(5, 'CompletePayment'));
  assert.notEqual(eventIdFor(5, 'CompletePayment'), eventIdFor(6, 'CompletePayment'));
  assert.notEqual(eventIdFor(5, 'CompletePayment'), eventIdFor(5, 'Contact'));
});

test('un evento ya enviado no se vuelve a enviar', async () => {
  const svc = new TikTokConversionsService();
  svc.config = () => ({ enabled: true, sourceId: 'src', token: 'tok', missing: [] });
  svc.activeStageFor = async () => ({ status_key: 'ganado', event_name: 'CompletePayment' });
  svc.alreadySent = async () => true;

  const r = await svc.reportStageChange({ id: 5, tiktok_lead_id: '7412' }, { status: 'ganado' });

  assert.equal(r.state, 'omitido');
  assert.equal(r.reason, 'ya_enviado');
});

// ──────────────────── Sin configurar no se intenta nada ─────────────────────

test('sin credenciales la integración está apagada y nombra lo que falta', () => {
  const svc = new TikTokConversionsService();
  const previo = {
    source: process.env.TIKTOK_EVENTS_SOURCE_ID,
    tokenEventos: process.env.TIKTOK_EVENTS_ACCESS_TOKEN,
    token: process.env.TIKTOK_ACCESS_TOKEN
  };
  delete process.env.TIKTOK_EVENTS_SOURCE_ID;
  delete process.env.TIKTOK_EVENTS_ACCESS_TOKEN;
  delete process.env.TIKTOK_ACCESS_TOKEN;

  try {
    const cfg = svc.config();
    assert.equal(cfg.enabled, false);
    // "No configurado" sin decir QUÉ falta obliga a leer el código, y es lo
    // primero que mira quien viene a encender la integración.
    assert.deepEqual(cfg.missing, ['TIKTOK_EVENTS_SOURCE_ID', 'TIKTOK_EVENTS_ACCESS_TOKEN']);
  } finally {
    if (previo.source !== undefined) process.env.TIKTOK_EVENTS_SOURCE_ID = previo.source;
    if (previo.tokenEventos !== undefined) process.env.TIKTOK_EVENTS_ACCESS_TOKEN = previo.tokenEventos;
    if (previo.token !== undefined) process.env.TIKTOK_ACCESS_TOKEN = previo.token;
  }
});

// ─────────── Aceptar un evento no es optimizar por él ───────────────────────

/**
 * La parte del envío, sin la bitácora: `#log` toca la base y lo que se está
 * probando es cómo se lee la respuesta de TikTok, no cómo se registra.
 */
function servicioQueResponde(respuesta) {
  const svc = new TikTokConversionsService({ fetchImpl: async () => respuesta });
  svc.config = () => ({ enabled: true, sourceId: 'src', token: 'tok', missing: [] });
  svc.activeStageFor = async () => ({ status_key: 'ganado', event_name: 'CompletePayment' });
  svc.alreadySent = async () => false;

  // La bitácora se reemplaza por un arreglo: así la prueba no necesita base y
  // además se puede comprobar CON QUÉ estado se registró, que es la mitad del
  // problema (un rechazo anotado como enviado no se reintenta nunca).
  const registrado = [];
  svc.logEntries = registrado;
  return { svc, registrado };
}

test('un HTTP 200 con code distinto de 0 es un ERROR, no un envío', async () => {
  /*
   * La Business API responde HTTP 200 con el fallo adentro. Mirar solo el
   * estado HTTP da por enviado lo que se rechazó, y un evento rechazado que
   * queda anotado como enviado no se reintenta nunca.
   */
  const { svc, registrado } = servicioQueResponde({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 40002, message: 'event_source_id inválido' })
  });

  const r = await svc.reportStageChange(
    { id: 5, tiktok_lead_id: '7412', tiktok_created_time: '2026-10-28T10:00:00Z' },
    { status: 'ganado', movedAt: new Date('2026-10-30T10:00:00Z') }
  );

  assert.equal(r.state, 'error');
  assert.match(r.reason, /event_source_id/);

  // Y queda anotado como error, con el código propio de TikTok: anotarlo como
  // enviado haría que nunca se reintente.
  assert.equal(registrado.length, 1);
  assert.equal(registrado[0].state, 'error');
  assert.equal(registrado[0].tiktokCode, 40002);
  assert.equal(registrado[0].httpStatus, 200);
});

test('un HTTP 200 con code 0 sí es un envío', async () => {
  const { svc } = servicioQueResponde({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 0, message: 'OK' })
  });

  const r = await svc.reportStageChange(
    { id: 5, tiktok_lead_id: '7412', tiktok_created_time: '2026-10-28T10:00:00Z' },
    { status: 'ganado', movedAt: new Date('2026-10-30T10:00:00Z') }
  );

  assert.equal(r.state, 'enviado');
});

test('un fallo de red se informa como error y no tumba el movimiento del lead', async () => {
  // Lo llama `updateLeadStatus()`: una excepción acá dejaría el lead movido y
  // la respuesta en error, o sea arrastrar una tarjeta fallaría porque la API
  // de TikTok está caída.
  const svc = new TikTokConversionsService({
    fetchImpl: async () => { throw new Error('ECONNRESET'); }
  });
  svc.config = () => ({ enabled: true, sourceId: 'src', token: 'tok', missing: [] });
  svc.activeStageFor = async () => ({ status_key: 'ganado', event_name: 'CompletePayment' });
  svc.alreadySent = async () => false;
  svc.logEntries = [];

  const r = await svc.reportStageChange(
    { id: 5, tiktok_lead_id: '7412', tiktok_created_time: '2026-10-28T10:00:00Z' },
    { status: 'ganado', movedAt: new Date('2026-10-30T10:00:00Z') }
  );

  assert.equal(r.state, 'error');
  assert.match(r.reason, /ECONNRESET/);
});

test('la elegibilidad sin servicio de anuncios dice "no comprobado", no "todo bien"', async () => {
  /*
   * Dar por bueno lo que no se comprobó es el peor diagnóstico posible (misma
   * regla que `subscriptionState()` en la conciliación de Meta).
   */
  const svc = new TikTokConversionsService();
  svc.config = () => ({ enabled: true, sourceId: 'src', token: 'tok', missing: [] });
  svc.stages = async () => [{ status_key: 'ganado', event_name: 'CompletePayment', enabled: true }];

  const r = await svc.checkEligibility();

  assert.equal(r.estado, 'no_comprobado');
  assert.match(r.detalle, /no significa que alguna campaña aprenda/);
});

test('una cuenta cuyos grupos no optimizan por conversión se marca como "no optimiza"', async () => {
  /*
   * El fallo silencioso de esta integración: TikTok acepta los eventos,
   * devuelve code 0, y la campaña sigue optimizando a clics. Todo "funciona" y
   * nada mejora.
   */
  const svc = new TikTokConversionsService({
    ads: {
      resolveAdvertiser: async () => ({ id: '123' }),
      apiPaged: async () => [
        { adgroup_id: '1', optimization_goal: 'CLICK' },
        { adgroup_id: '2', optimization_goal: 'REACH' }
      ]
    }
  });
  svc.config = () => ({ enabled: true, sourceId: 'src', token: 'tok', missing: [] });
  svc.stages = async () => [{ status_key: 'ganado', event_name: 'CompletePayment', enabled: true }];

  const r = await svc.checkEligibility();

  assert.equal(r.estado, 'no_optimiza');
  assert.equal(r.grupos_optimizando, 0);
  // Y dice qué hay que hacer, que no es mandar más eventos.
  assert.match(r.detalle, /no mandar más eventos/);
});

test('con grupos que optimizan igual se advierte que puede no ser por ESTOS eventos', async () => {
  const svc = new TikTokConversionsService({
    ads: {
      resolveAdvertiser: async () => ({ id: '123' }),
      apiPaged: async () => [
        { adgroup_id: '1', optimization_goal: 'CONVERT' },
        { adgroup_id: '2', optimization_goal: 'CLICK' }
      ]
    }
  });
  svc.config = () => ({ enabled: true, sourceId: 'src', token: 'tok', missing: [] });
  svc.stages = async () => [{ status_key: 'ganado', event_name: 'CompletePayment', enabled: true }];

  const r = await svc.checkEligibility();

  assert.equal(r.estado, 'optimiza');
  assert.equal(r.grupos_optimizando, 1);
  assert.equal(r.grupos_totales, 2);
  // Que optimicen no garantiza que sea por los eventos que mandamos.
  assert.match(r.detalle, /no garantiza/);
});

// ──────────────────── Los nombres de evento no son libres ───────────────────

test('los nombres válidos son los estándar de TikTok', () => {
  // El conjunto lo fija la plataforma: ofrecer un campo de texto solo daría la
  // oportunidad de escribir algo que el Events API va a rechazar.
  assert.ok(TIKTOK_EVENT_NAMES.includes('CompletePayment'));
  assert.ok(TIKTOK_EVENT_NAMES.includes('Contact'));
  assert.ok(TIKTOK_EVENT_NAMES.includes('SubmitForm'));
  assert.equal(TIKTOK_EVENT_NAMES.includes('VentaGanada'), false);
});
