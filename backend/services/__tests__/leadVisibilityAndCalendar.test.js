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

/*
 * `setter.view_all` es el punto medio: lo propio más todo el Setter Funnel (lo
 * que todavía no graduó a Ventas, tenga o no responsable). No abre los leads
 * que ya son del closer.
 */
test('con setter.view_all se ve todo el Setter Funnel, pero no lo que ya graduó', () => {
  const salesStatuses = new Set(['cita_agendada', 'ganado', 'col_abc']);
  const setter = { id: 4, permissions: ['setter.view', 'setter.view_all'] };

  assert.equal(leads.canView({ id: 1, assigned_user_id: 7, status: 'calificando' }, setter, salesStatuses), true);
  assert.equal(leads.canView({ id: 2, assigned_user_id: null, status: 'nuevo' }, setter, salesStatuses), true);
  assert.equal(leads.canView({ id: 3, assigned_user_id: 7, status: 'col_abc' }, setter, salesStatuses), false);
  // El sello manda sobre el status: la columna pudo haberse borrado.
  assert.equal(
    leads.canView({ id: 4, assigned_user_id: 7, status: 'calificando', sales_funnel_at: '2026-10-01' }, setter, salesStatuses),
    false
  );
  // Lo propio se sigue viendo aunque ya haya graduado.
  assert.equal(leads.canView({ id: 5, assigned_user_id: 4, status: 'ganado' }, setter, salesStatuses), true);
});

test('sin setter.view_all, el Setter Funnel ajeno sigue cerrado', () => {
  const salesStatuses = new Set(['cita_agendada']);
  const setter = { id: 4, permissions: ['setter.view'] };
  assert.equal(leads.canView({ id: 1, assigned_user_id: 7, status: 'calificando' }, setter, salesStatuses), false);
});

/*
 * Un lead está asociado a una setter y a un closer además de a quien lo tiene
 * a cargo: cualquiera de los tres lo ve, y nadie más.
 */
test('la setter y el closer de un lead lo ven aunque esté a cargo de otra persona', () => {
  const lead = { id: 1, assigned_user_id: 7, setter_user_id: 4, closer_user_id: 5 };
  assert.equal(leads.canView(lead, { id: 4, permissions: ['setter.view'] }), true);
  assert.equal(leads.canView(lead, { id: 5, permissions: ['leads.view'] }), true);
  assert.equal(leads.canView(lead, { id: 6, permissions: ['leads.view', 'setter.view'] }), false);
});
