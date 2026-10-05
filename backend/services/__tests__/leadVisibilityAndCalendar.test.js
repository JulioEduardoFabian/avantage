import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeadService } from '../leadService.js';
import { limaDayStart } from '../scheduledMeetingService.js';

const leads = new LeadService();

/*
 * Cada persona ve en el funnel los leads que tiene asignados; el que administra
 * el área comercial (`leads.manage_all`) ve todos y es el único que reparte.
 *
 * La regla se escribe UNA vez (`canView`) y la usan el listado y el middleware
 * de cada ruta de un lead: filtrar la lista y dejar la ficha abierta por id
 * sería una cortina, no un permiso.
 */

test('sin el permiso de administrador, cada quien ve solo lo suyo', () => {
  const user = { id: 4, permissions: ['leads.view'] };
  assert.equal(leads.canView({ id: 1, assigned_user_id: 4 }, user), true);
  assert.equal(leads.canView({ id: 2, assigned_user_id: 7 }, user), false);
});

test('un lead sin responsable no es de nadie: solo lo ve quien reparte', () => {
  const user = { id: 4, permissions: ['leads.view', 'setter.view'] };
  assert.equal(leads.canView({ id: 3, assigned_user_id: null }, user), false);

  const jefe = { id: 9, permissions: ['leads.view', 'leads.manage_all'] };
  assert.equal(leads.canView({ id: 3, assigned_user_id: null }, jefe), true);
});

test('el administrador del área comercial ve cualquier lead', () => {
  const jefe = { id: 9, permissions: ['leads.manage_all'] };
  assert.equal(leads.canView({ id: 1, assigned_user_id: 4 }, jefe), true);
});

test('una sesión sin usuario no ve nada, y un lead que no existe tampoco se ve', () => {
  assert.equal(leads.canView({ id: 1, assigned_user_id: 4 }, null), false);
  assert.equal(leads.canView(null, { id: 4, permissions: ['leads.manage_all'] }), false);
});

/*
 * El calendario arma el rango de un día de Perú (UTC-5 todo el año, sin horario
 * de verano). Construir el Date con la fecha pelada lo interpretaría en la zona
 * del servidor y la agenda se correría un día.
 */
test('el día de calendario peruano empieza a las 05:00 UTC', () => {
  assert.equal(limaDayStart('2026-10-05').toISOString(), '2026-10-05T05:00:00.000Z');
});

test('el rango de un día termina donde empieza el siguiente', () => {
  assert.equal(limaDayStart('2026-10-05', 1).toISOString(), '2026-10-06T05:00:00.000Z');
  assert.equal(limaDayStart('2026-10-31', 1).toISOString(), '2026-11-01T05:00:00.000Z');
});
