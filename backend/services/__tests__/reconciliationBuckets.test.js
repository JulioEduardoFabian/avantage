import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUCKETS,
  COMPARABILIDAD,
  classifySubmission,
  emptyBuckets,
  phoneKeyOf
} from '../reconciliationBuckets.js';
import { phoneMatchKey } from '../leadService.js';
import { isNewOpportunity } from '../campaignService.js';

/*
 * Las dos conciliaciones reportaban "en la plataforma", "en el CRM",
 * "faltantes" y "fallidos", y con eso una diferencia nunca se terminaba de
 * explicar: "faltan 37" podía ser 37 leads perdidos, o 12 duplicados que la
 * plataforma devuelve dos veces, 9 personas que ya estaban en el CRM de antes,
 * 6 formularios sin un dato con el que llamar a nadie y 10 entregados fuera de
 * su propio corte.
 *
 * Cada uno se arregla distinto y tres de los cinco no se arreglan: están bien
 * así. Mezclados, la conciliación produce una alarma que nadie puede cerrar — y
 * una alarma que nadie puede cerrar se deja de mirar.
 */

const CORTE = new Date('2026-10-28T00:00:00-05:00');

function envio(extra = {}) {
  return {
    platformLeadId: '7412',
    phone: '987654321',
    email: 'lucia@example.com',
    createdTime: new Date('2026-10-29T10:00:00-05:00'),
    ...extra
  };
}

const contexto = (extra = {}) => ({
  windowStart: CORTE,
  seenLeadIds: new Set(),
  seenPhoneKeys: new Set(),
  existingLead: null,
  ...extra
});

// ──────────────────────────── Los cinco cajones ─────────────────────────────

test('un envío nuevo dentro del corte es nuevo', () => {
  assert.equal(classifySubmission(envio(), contexto()), BUCKETS.nuevo);
});

test('el mismo id de envío dos veces en la corrida es un duplicado', () => {
  const ctx = contexto({ seenLeadIds: new Set(['7412']) });
  assert.equal(classifySubmission(envio(), ctx), BUCKETS.duplicado);
});

test('el mismo teléfono dos veces en la corrida es un duplicado, aunque el id cambie', () => {
  // Dos envíos distintos de la misma persona en el mismo corte: contarlos como
  // dos leads infla el total de la plataforma contra el del CRM.
  const ctx = contexto({ seenPhoneKeys: new Set(['987654321']) });
  assert.equal(classifySubmission(envio({ platformLeadId: '7413' }), ctx), BUCKETS.duplicado);
});

test('sin teléfono y sin correo es inválido: no hay con qué llamar ni con qué cruzar', () => {
  const cajon = classifySubmission(envio({ phone: '', email: '' }), contexto());
  assert.equal(cajon, BUCKETS.invalido);
});

test('un envío anterior al corte es un retraso de la plataforma', () => {
  // Pertenece al día en que la persona llenó el formulario, no al día en que lo
  // recuperamos: mezclarlos es lo que impide que el reporte cierre contra el
  // Administrador de anuncios.
  const cajon = classifySubmission(
    envio({ createdTime: new Date('2026-10-20T10:00:00-05:00') }),
    contexto()
  );
  assert.equal(cajon, BUCKETS.retrasado);
});

test('quien ya estaba en el CRM antes del corte es un reingreso, no un lead nuevo', () => {
  const ctx = contexto({ existingLead: { id: 5, created_at: '2026-09-01T10:00:00Z' } });
  assert.equal(classifySubmission(envio(), ctx), BUCKETS.reingreso);
});

test('una ficha creada DENTRO del corte no convierte el envío en reingreso', () => {
  /*
   * Si la ficha nació dentro del corte, es este mismo envío (o su gemelo) el
   * que la creó. Contarlo como reingreso escondería el alta que sí ocurrió, y
   * entonces el corte diría que no entró nadie el día en que entraron todos.
   */
  const ctx = contexto({ existingLead: { id: 5, created_at: '2026-10-29T10:00:05Z' } });
  assert.equal(classifySubmission(envio(), ctx), BUCKETS.nuevo);
});

// ─────────────────────── La prioridad entre los cajones ─────────────────────

test('el duplicado gana sobre el inválido y sobre el retraso', () => {
  /*
   * La propiedad que sostiene el reporte: los cajones son excluyentes y su suma
   * es el total de envíos. Si el inválido ganara, un envío repetido Y sin
   * teléfono se contaría una vez como repetido y otra como inválido, y la suma
   * dejaría de cerrar.
   */
  const ctx = contexto({ seenLeadIds: new Set(['7412']) });
  const cajon = classifySubmission(
    envio({ phone: '', email: '', createdTime: new Date('2026-01-01T00:00:00Z') }),
    ctx
  );
  assert.equal(cajon, BUCKETS.duplicado);
});

test('el retraso gana sobre el reingreso', () => {
  // Lo que define al retraso es CUÁNDO se envió, y eso no depende de si la
  // persona ya estaba. Al revés, un reingreso viejo se contaría dentro del
  // corte actual y la cuenta no cerraría contra el Ads Manager.
  const ctx = contexto({ existingLead: { id: 5, created_at: '2026-09-01T10:00:00Z' } });
  const cajon = classifySubmission(envio({ createdTime: new Date('2026-10-01T10:00:00Z') }), ctx);
  assert.equal(cajon, BUCKETS.retrasado);
});

test('sin corte pedido no hay retrasos ni se pierde el reingreso', () => {
  const ctx = contexto({ windowStart: null, existingLead: { id: 5, created_at: '2026-09-01T10:00:00Z' } });
  assert.equal(classifySubmission(envio({ createdTime: new Date('2020-01-01T00:00:00Z') }), ctx), BUCKETS.reingreso);
});

// ──────────────────────── La suma tiene que ser el total ────────────────────

test('los cajones arrancan en cero y son los cinco', () => {
  const cajones = emptyBuckets();
  assert.deepEqual(Object.keys(cajones).sort(), ['duplicados', 'invalidos', 'nuevos', 'reingresos', 'retrasados']);
  assert.equal(Object.values(cajones).reduce((a, b) => a + b, 0), 0);
});

test('clasificar un lote reparte cada envío en exactamente un cajón', () => {
  const lote = [
    envio({ platformLeadId: '1', phone: '987111111' }),
    envio({ platformLeadId: '2', phone: '987111111' }),                       // duplicado por teléfono
    envio({ platformLeadId: '3', phone: '', email: '' }),                     // inválido
    envio({ platformLeadId: '4', phone: '987222222', createdTime: new Date('2026-10-01T10:00:00Z') }), // retraso
    envio({ platformLeadId: '5', phone: '987333333' })
  ];

  const cajones = emptyBuckets();
  const seenLeadIds = new Set();
  const seenPhoneKeys = new Set();
  const existentes = new Map([['987333333', { id: 9, created_at: '2026-09-01T00:00:00Z' }]]);

  for (const e of lote) {
    const key = phoneKeyOf(e.phone);
    const cajon = classifySubmission(e, {
      windowStart: CORTE,
      seenLeadIds,
      seenPhoneKeys,
      existingLead: key ? existentes.get(key) || null : null
    });
    cajones[cajon]++;
    seenLeadIds.add(String(e.platformLeadId));
    if (key) seenPhoneKeys.add(key);
  }

  assert.deepEqual(cajones, {
    nuevos: 1,
    duplicados: 1,
    reingresos: 1,
    invalidos: 1,
    retrasados: 1
  });
  // La propiedad que permite afirmar que la comparación cerró.
  assert.equal(Object.values(cajones).reduce((a, b) => a + b, 0), lote.length);
});

// ─────────── La clave de teléfono dice lo mismo que la del CRM ──────────────

test('phoneKeyOf y phoneMatchKey coinciden: son el mismo criterio en dos sitios', () => {
  /*
   * `reconciliationBuckets` es puro y no importa `leadService` para no
   * arrastrar la conexión a la base. El precio es una copia, y esta prueba es
   * lo que impide que las dos se separen — el día que se separen, un envío se
   * clasificaría como nuevo y después se emparejaría con una ficha existente.
   */
  for (const telefono of ['987654321', '+51 987 654 321', '51987654321', '987-654-321', '12345', '']) {
    assert.equal(phoneKeyOf(telefono), phoneMatchKey(telefono), `difieren en "${telefono}"`);
  }
});

// ──────────── No exigir que el CRM iguale las "conversiones" ────────────────

test('el reporte dice qué universo cuenta cada cifra, y qué NO es comparable', () => {
  /*
   * El error que esto evita se comete leyendo la pantalla: el Ads Manager tiene
   * un campo "conversiones" que no cuenta envíos de formulario —cuenta el
   * evento configurado en la campaña— y exigir que el CRM dé ese mismo número
   * manda a buscar leads que nunca existieron.
   */
  assert.match(COMPARABILIDAD.en_la_plataforma, /Envíos de formulario/);
  assert.match(COMPARABILIDAD.en_crm, /id del envío/);
  assert.match(COMPARABILIDAD.no_comparable, /conversiones/);
  assert.match(COMPARABILIDAD.no_comparable, /no es una pérdida de leads/);
});

// ───────── Los tres niveles de WhatsApp: evento, conversación, persona ──────

test('la conversación que creó la ficha es una persona nueva', () => {
  const contacto = {
    firstMessageAt: '2026-10-29T10:00:00Z',
    lead: { id: 1, created_at: '2026-10-29T10:00:02Z' }
  };
  assert.equal(isNewOpportunity(contacto), true);
});

test('quien ya era lead y volvió a escribir desde un anuncio NO es una persona nueva', () => {
  /*
   * Sin esta distinción el costo por conversación se lee como costo por persona
   * nueva, y un anuncio de retargeting —que por definición le habla a quien ya
   * está en la base— parece tan eficiente como uno que trae gente nueva.
   */
  const contacto = {
    firstMessageAt: '2026-10-29T10:00:00Z',
    lead: { id: 1, created_at: '2026-09-01T10:00:00Z' }
  };
  assert.equal(isNewOpportunity(contacto), false);
});

test('el lead de formulario que después escribe por WhatsApp no cuenta como persona nueva de esa conversación', () => {
  // Entre el formulario y el mensaje pasan minutos u horas: queda fuera del
  // margen y del lado correcto.
  const contacto = {
    firstMessageAt: '2026-10-29T14:00:00Z',
    lead: { id: 1, created_at: '2026-10-29T10:00:00Z' }
  };
  assert.equal(isNewOpportunity(contacto), false);
});

test('un contacto sin ficha en el CRM no es una oportunidad que se pueda contar', () => {
  // Escribió y nadie lo registró: es la brecha que `onlyGreeted` mide aparte, y
  // contarlo como persona nueva afirmaría un alta que no ocurrió.
  assert.equal(isNewOpportunity({ firstMessageAt: '2026-10-29T10:00:00Z', lead: null }), false);
});
