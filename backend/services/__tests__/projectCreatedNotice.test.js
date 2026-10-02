import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectCreatedNotice, ProjectNoticeService } from '../projectNoticeService.js';

/**
 * Un proyecto nace casi siempre solo, cuando una venta se cierra en el Funnel
 * de Ventas. El aviso tiene que llegar con lo necesario para tomarlo sin abrir
 * el sistema: de quién es, qué es y si ya se puede trabajar.
 */

const project = {
  id: 12,
  topic: 'Score crediticio con Machine Learning',
  client_email: 'joselyn@example.com',
  client_phone: '987654321',
  academic_level: 'Pregrado (Bachiller/Título)',
  field_of_study: 'Ingeniería de Sistemas',
  status: 'Creado',
  deadline: '2026-12-15',
  is_locked: false,
  initial_payment: null
};

test('el aviso lleva al cliente, el tema y la fecha límite', () => {
  const notice = buildProjectCreatedNotice({ project, clientName: 'Joselyn Ramos' });

  assert.match(notice.title, /Joselyn Ramos/);
  assert.match(notice.title, /Score crediticio/);
  assert.match(notice.body, /987654321/);
  assert.match(notice.body, /joselyn@example.com/);
  assert.match(notice.body, /Ingeniería de Sistemas/);
  // La fecha es un día de calendario: no puede correrse uno hacia atrás.
  assert.match(notice.body, /15\/12\/2026/);
});

test('distingue la venta cerrada del alta a mano', () => {
  const fromLead = buildProjectCreatedNotice({ project, clientName: 'Joselyn Ramos' });
  assert.match(fromLead.body, /se cerró una venta/i);

  // No es lo mismo para quien lo lee: uno hay que tomarlo, el otro ya lo está
  // tomando alguien.
  const manual = buildProjectCreatedNotice({ project, origin: 'manual', createdByName: 'Kevin' });
  assert.match(manual.body, /a mano/i);
  assert.match(manual.body, /Kevin/);
});

test('un proyecto bloqueado lo dice, y nombra el pago por su CÓDIGO', () => {
  const notice = buildProjectCreatedNotice({
    project: { ...project, is_locked: true, initial_payment: { code: '20260930-1', monto: 1500 } },
    clientName: 'Joselyn Ramos'
  });

  assert.match(notice.body, /bloqueado hasta que Finanzas verifique/i);
  assert.match(notice.body, /20260930-1/);
  // En Proyectos no se muestran importes, tampoco en sus avisos.
  assert.doesNotMatch(notice.body, /1500/);
});

test('un proyecto sin bloqueo invita a trabajarlo', () => {
  const notice = buildProjectCreatedNotice({ project, clientName: 'Joselyn Ramos' });
  assert.match(notice.body, /Ya se puede trabajar/i);
  assert.doesNotMatch(notice.body, /bloqueado/i);
});

test('se sostiene sin nombre de cliente y sin fecha límite', () => {
  const notice = buildProjectCreatedNotice({ project: { ...project, deadline: null } });

  assert.match(notice.title, /joselyn@example.com/);
  assert.match(notice.body, /todavía sin definir/);
  assert.doesNotMatch(notice.body, /undefined|null/);
});

/** El destinatario es UNO solo: el que se guarda en la pantalla de Proyectos. */
const settingsStub = (noticeEmail) => ({ get: async () => ({ noticeEmail }) });

test('manda al correo guardado en la pantalla de Proyectos', async () => {
  const service = new ProjectNoticeService({ projectSettingsService: settingsStub('proyectos@empresa.com') });
  process.env.INTERNAL_ALERT_EMAIL = 'interno@empresa.com';

  assert.equal(await service.noticeRecipient(), 'proyectos@empresa.com');
});

test('sin correo guardado cae en INTERNAL_ALERT_EMAIL, que es la red de seguridad', async () => {
  const service = new ProjectNoticeService({ projectSettingsService: settingsStub('') });
  process.env.INTERNAL_ALERT_EMAIL = 'interno@empresa.com';

  assert.equal(await service.noticeRecipient(), 'interno@empresa.com');
});

test('el correo de prueba avisa que lo es y se manda a la dirección escrita', async () => {
  const sent = [];
  const service = new ProjectNoticeService({
    projectSettingsService: settingsStub('viejo@empresa.com'),
    emailService: { sendInternalAlertEmail: async (to, payload) => { sent.push({ to, payload }); return { success: true }; } }
  });

  const result = await service.sendTestNotice('nuevo@empresa.com');

  assert.equal(result.recipient, 'nuevo@empresa.com');
  assert.match(sent[0].payload.subject, /^\[PRUEBA\]/);
  assert.match(sent[0].payload.bodyText, /PROYECTO/);
});

test('el aviso nunca tumba la creación del proyecto', async () => {
  // Si el correo falla, el proyecto ya está creado: el servicio traga el error
  // en vez de propagarlo a quien cerró la venta.
  const service = new ProjectNoticeService({
    projectSettingsService: settingsStub('proyectos@empresa.com'),
    emailService: { sendInternalAlertEmail: async () => { throw new Error('SMTP caído'); } }
  });

  const result = await service.notifyProjectCreated(project, {});
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'error');
});
