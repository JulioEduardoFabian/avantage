import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVerifiedPaymentNotice } from '../paymentNoticeService.js';

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
