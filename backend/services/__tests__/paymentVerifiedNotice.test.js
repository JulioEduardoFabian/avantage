import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVerifiedPaymentNotice, PaymentNoticeService } from '../paymentNoticeService.js';
import { isEmailShaped } from '../deliverableSettingsService.js';

/**
 * Verificar una cuota es lo que habilita la entrega del trabajo atado a ella
 * (ver `blocksDelivery()`), pero eso pasa en Finanzas, en otra pantalla y a
 * cargo de otra persona. El aviso tiene que llegar con lo necesario para
 * actuar sin abrir el sistema: quién es el cliente, qué hay que entregar y
 * contra qué cuota.
 */

const income = { id: 7, code: '20260930-3', cuota: '2da', monto: 1500, due_date: '2026-10-03' };
const lead = {
  full_name: 'Joselyn Ramos',
  phone: '987654321',
  email: 'joselyn@example.com',
  university: 'UNCP',
  field_of_study: 'Ingeniería de Sistemas'
};
const project = { id: 7, topic: 'Score crediticio con Machine Learning' };

test('el aviso lleva al cliente, la cuota y lo que falta entregar', () => {
  const notice = buildVerifiedPaymentNotice({
    income,
    lead,
    project,
    deliverables: [
      { title: 'Capítulo I y II', due_date: '2026-10-03', status: 'pendiente' },
      { title: 'Resumen ejecutivo', due_date: '2026-09-28', status: 'entregado', delivered_at: '2026-09-29' }
    ],
    verifiedByName: 'Kevin'
  });

  assert.match(notice.title, /20260930-3/);
  assert.match(notice.title, /Joselyn Ramos/);
  assert.match(notice.body, /Kevin/);
  assert.match(notice.body, /987654321/);
  assert.match(notice.body, /Score crediticio/);
  assert.match(notice.body, /Capítulo I y II/);
  assert.match(notice.body, /FALTA ENTREGAR/);
  assert.match(notice.body, /Resumen ejecutivo.*ya entregado/);
  // Las fechas son días de calendario: no pueden correrse un día.
  assert.match(notice.body, /03\/10\/2026/);
});

test('el aviso NO lleva importes', () => {
  // Misma regla que en Proyectos y Entregables: una cuota se nombra por su
  // código. Estos destinatarios tienen `deliverables.view`, no `finance.view`.
  const notice = buildVerifiedPaymentNotice({
    income,
    lead,
    project,
    deliverables: [{ title: 'Capítulo I y II', due_date: '2026-10-03', status: 'pendiente' }]
  });

  assert.doesNotMatch(notice.body, /1500/);
  assert.doesNotMatch(notice.title, /1500/);
  assert.match(notice.body, /El importe se consulta en Finanzas/);
});

test('una cuota sin entregables atados lo dice en vez de callarlo', () => {
  const notice = buildVerifiedPaymentNotice({ income, lead, project, deliverables: [] });

  assert.match(notice.body, /Ninguno: esta cuota no condiciona ningún entregable/);
  assert.match(notice.notificationBody, /No tiene entregables atados/);
});

test('si ya estaba todo entregado, el aviso no pide nada', () => {
  const notice = buildVerifiedPaymentNotice({
    income,
    lead,
    project,
    deliverables: [{ title: 'Resumen', status: 'entregado', delivered_at: '2026-09-29' }]
  });

  assert.match(notice.body, /no queda nada pendiente por esta cuota/);
  assert.doesNotMatch(notice.body, /FALTA ENTREGAR/);
});

test('se sostiene sin lead, sin proyecto y sin quién verificó', () => {
  const notice = buildVerifiedPaymentNotice({ income, lead: null, project: null, deliverables: [] });

  assert.match(notice.title, /Cliente sin nombre/);
  assert.doesNotMatch(notice.body, /undefined|null/);
});

/**
 * Quien recibe el aviso tiene que poder actuar sin abrir el sistema, y para eso
 * le faltaban dos datos: a QUIÉN pedirle el trabajo (el líder del proyecto, que
 * en este correo se nombra "Asesor Operativo") y QUÉ cuota del cronograma es la
 * que se acaba de cobrar — "la segunda de tres" dice mucho más que un código.
 */
test('el aviso nombra al líder del proyecto como Asesor Operativo', () => {
  const notice = buildVerifiedPaymentNotice({
    income,
    lead,
    project: { ...project, leader_name: 'Ana Quispe' },
    advisorName: 'Ana Quispe',
    deliverables: []
  });

  assert.match(notice.body, /Asesor Operativo: Ana Quispe/);
});

test('un proyecto sin líder lo dice: "No asignado", no un renglón vacío', () => {
  // Omitir la línea haría creer que el aviso no trae el dato; decir
  // "No asignado" es información: hay que ponerle líder a ese proyecto.
  const sinLider = buildVerifiedPaymentNotice({ income, lead, project, deliverables: [] });
  assert.match(sinLider.body, /Asesor Operativo: No asignado/);

  const sinProyecto = buildVerifiedPaymentNotice({ income, lead, project: null, deliverables: [] });
  assert.match(sinProyecto.body, /Asesor Operativo: No asignado/);
});

test('la cuota se nombra por su posición en el cronograma, no por el texto guardado', () => {
  // `finance_income.cuota` solo se renumera cuando el plan se reemplaza
  // entero, así que puede quedar diciendo "2da" siendo la tercera que vence.
  // Manda el cronograma, que es el orden que ve Finanzas en pantalla.
  const notice = buildVerifiedPaymentNotice({
    income,
    lead,
    project,
    deliverables: [],
    cuotaPosition: 3,
    cuotaTotal: 4
  });

  assert.match(notice.body, /Cuota: tercera de 4/);
  // Y el asunto dice lo mismo: si se contradicen, no se sabe a cuál creerle.
  assert.match(notice.title, /tercera cuota/);
  assert.doesNotMatch(notice.body, /Cuota: 2da/);
});

test('más allá de la décima cuota el ordinal pasa a cifras', () => {
  const notice = buildVerifiedPaymentNotice({
    income, lead, project, deliverables: [], cuotaPosition: 11, cuotaTotal: 12
  });

  assert.match(notice.body, /Cuota: 11.ª de 12/);
});

test('un cronograma de una sola cuota no dice "de 1"', () => {
  const notice = buildVerifiedPaymentNotice({
    income, lead, project, deliverables: [], cuotaPosition: 1, cuotaTotal: 1
  });

  assert.match(notice.body, /Cuota: primera$/m);
});

test('una cuota sin cronograma del que contar sale como No asignado', () => {
  // Sin posición y sin ordinal guardado no hay nada que decir: se dice que no
  // está asignada, igual que con el asesor.
  const notice = buildVerifiedPaymentNotice({
    income: { id: 7, code: '20260930-3', due_date: '2026-10-03' },
    lead,
    project,
    deliverables: []
  });

  assert.match(notice.body, /Cuota: No asignado/);
});

/**
 * El aviso va a UN solo correo, el que se guarda en la pantalla de Entregables:
 * de las entregas se encarga una persona, y repartirlo entre todos los que
 * pueden abrir el módulo lo convierte en ruido que nadie termina de mirar.
 */
const settingsStub = (noticeEmail) => ({ get: async () => ({ noticeEmail }) });

test('manda al correo guardado en la pantalla de Entregables', async () => {
  const service = new PaymentNoticeService({ deliverableSettingsService: settingsStub('entregas@empresa.com') });
  process.env.INTERNAL_ALERT_EMAIL = 'interno@empresa.com';

  assert.equal(await service.noticeRecipient(), 'entregas@empresa.com');
});

test('sin correo guardado cae en INTERNAL_ALERT_EMAIL, que es la red de seguridad', async () => {
  const service = new PaymentNoticeService({ deliverableSettingsService: settingsStub('') });
  process.env.INTERNAL_ALERT_EMAIL = 'interno@empresa.com';

  assert.equal(await service.noticeRecipient(), 'interno@empresa.com');
});

test('sin nada configurado no inventa un destinatario', async () => {
  const service = new PaymentNoticeService({ deliverableSettingsService: settingsStub('') });
  delete process.env.INTERNAL_ALERT_EMAIL;

  assert.equal(await service.noticeRecipient(), null);
});

test('el correo de prueba avisa que lo es antes de abrirlo', async () => {
  const sent = [];
  const service = new PaymentNoticeService({
    deliverableSettingsService: settingsStub('entregas@empresa.com'),
    emailService: { sendInternalAlertEmail: async (to, payload) => { sent.push({ to, payload }); return { success: true }; } }
  });

  const result = await service.sendTestNotice();

  assert.equal(result.recipient, 'entregas@empresa.com');
  assert.match(sent[0].payload.subject, /^\[PRUEBA\]/);
  // Y muestra el aviso COMPLETO: una prueba recortada no sirve para saber qué
  // va a llegar el día que llegue de verdad.
  assert.match(sent[0].payload.bodyText, /ENTREGABLES ATADOS A ESTA CUOTA/);
  assert.match(sent[0].payload.bodyText, /FALTA ENTREGAR/);
  // Los renglones nuevos también: una prueba que no los muestra no sirve para
  // saber si el día que llegue de verdad van a venir.
  assert.match(sent[0].payload.bodyText, /Asesor Operativo: .+/);
  assert.match(sent[0].payload.bodyText, /Cuota: segunda de 3/);
});

test('el correo de prueba se manda a la dirección escrita, aunque no esté guardada', async () => {
  const sent = [];
  const service = new PaymentNoticeService({
    deliverableSettingsService: settingsStub('viejo@empresa.com'),
    emailService: { sendInternalAlertEmail: async (to) => { sent.push(to); return { success: true }; } }
  });

  // Probar antes de guardar es el punto: si la dirección está mal escrita, lo
  // último que se quiere es haberla dejado guardada.
  const result = await service.sendTestNotice('nuevo@empresa.com');

  assert.equal(result.recipient, 'nuevo@empresa.com');
  assert.deepEqual(sent, ['nuevo@empresa.com']);
});

test('sin destinatario, la prueba lo dice en vez de fingir que salió', async () => {
  const service = new PaymentNoticeService({ deliverableSettingsService: settingsStub('') });
  delete process.env.INTERNAL_ALERT_EMAIL;

  await assert.rejects(() => service.sendTestNotice(), (error) => error.code === 'NO_RECIPIENT');
});

test('el correo se valida con la forma mínima, no con una expresión estricta', () => {
  for (const value of ['nombre@empresa.com', 'a.b+c@sub.dominio.pe']) {
    assert.equal(isEmailShaped(value), true, `rechazaría: "${value}"`);
  }
  for (const value of ['', 'nombre', 'nombre@empresa', 'con espacio@empresa.com', '@empresa.com']) {
    assert.equal(isEmailShaped(value), false, `aceptaría: "${value}"`);
  }
});
