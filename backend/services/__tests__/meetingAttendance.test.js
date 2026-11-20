import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ATTENDANCE_VALUES } from '../scheduledMeetingService.js';
import { summarize, withRates } from '../setterReportService.js';

/**
 * Una cita **agendada** no es una cita **asistida**, y hasta el 01/11/2026 el
 * CRM no sabía decir la diferencia: `scheduled_meetings` sabía si la reunión se
 * había cancelado —el evento desapareció del Google Calendar del asesor— pero
 * no si alguien se presentó.
 *
 * Con eso, todo lo que mide el embudo contaba como "cita" a la que nadie fue:
 * la tasa por anuncio, el reporte de setters, el costo por cita del exportable.
 * Un anuncio que trae gente que agenda y no aparece se leía exactamente igual
 * que uno que trae gente que se presenta.
 *
 * Lo que fijan estas pruebas es el tercer estado, que es el que hace útil al
 * dato: **vacío es "nadie lo registró" y no "no vino"**.
 */

/** Un lead con su reunión, con la forma que arma `SetterReportService`. */
function entry({ attended = 0, attendanceUnknown = 0, active = 1, cancelled = 0 } = {}) {
  return {
    lead: { id: 1, created_at: '2026-10-01T10:00:00Z' },
    verdict: {
      graduated: true,
      won: false,
      lost: false,
      wonAt: null,
      movedAt: '2026-10-02T10:00:00Z',
      meeting: { active, attended, attendanceUnknown, cancelled, manual: 0, firstBookedAt: '2026-10-02T10:00:00Z' }
    }
  };
}

// ─────────────────────── Los valores admitidos son dos ──────────────────────

test('la asistencia tiene dos valores escritos y un tercer estado que es el vacío', () => {
  assert.deepEqual([...ATTENDANCE_VALUES].sort(), ['asistio', 'no_asistio']);
  // El null no está en el conjunto a propósito: no es un valor que se elija,
  // es la ausencia de registro.
  assert.equal(ATTENDANCE_VALUES.has(null), false);
  assert.equal(ATTENDANCE_VALUES.has('tal_vez'), false);
});

// ───────────────── Agendada y asistida se cuentan por separado ──────────────

test('una reunión asistida cuenta en las dos cifras; una sin registrar, solo en la primera', () => {
  const stats = summarize([
    entry({ attended: 1 }),
    entry({ attendanceUnknown: 1 })
  ]);

  assert.equal(stats.withMeeting, 2);
  // Solo una está registrada como asistida: la otra no se puede contar ni como
  // asistencia ni como ausencia.
  assert.equal(stats.withAttendedMeeting, 1);
  assert.equal(stats.attendanceUnknown, 1);
});

test('una ausencia registrada no es una asistencia ni un desconocido', () => {
  // `attended: 0` con `attendanceUnknown: 0` es la reunión en la que SÍ se
  // registró que el contacto no vino.
  const stats = summarize([entry({ attended: 0, attendanceUnknown: 0 })]);

  assert.equal(stats.withMeeting, 1);
  assert.equal(stats.withAttendedMeeting, 0);
  assert.equal(stats.attendanceUnknown, 0);
});

test('una reunión cancelada no entra en ninguna de las dos', () => {
  const stats = summarize([entry({ active: 0, cancelled: 1 })]);

  // Cancelar es que la reunión no existe más; no asistir es que existió y el
  // contacto no fue. Mezclarlas haría imposible contar las dos.
  assert.equal(stats.withMeeting, 0);
  assert.equal(stats.withAttendedMeeting, 0);
  assert.equal(stats.meetingsCancelled, 1);
});

// ─────────────────────────── La tasa y su denominador ───────────────────────

test('la asistencia se mide sobre las citas conseguidas, no sobre los leads', () => {
  const stats = summarize([
    entry({ attended: 1 }),
    entry({ attended: 1 }),
    entry({ attended: 0, attendanceUnknown: 0 }),
    entry({ attended: 0, attendanceUnknown: 0 })
  ]);
  const rates = withRates(stats);

  // Lo que mide es si las reuniones que este setter agenda de verdad ocurren:
  // 2 de 4 citas. Sobre los leads diría otra cosa y no sería comparable con
  // `meetingRate`, que sí es sobre leads.
  assert.equal(rates.attendanceRate, 50);
});

test('sin citas conseguidas la tasa no inventa un cero', () => {
  const rates = withRates(summarize([]));

  // Un 0% con denominador cero se lee como "nadie asiste", que es una
  // afirmación sobre reuniones que no existen.
  assert.equal(rates.attendanceRate, null);
});

test('con todo sin registrar la tasa da 0 y el desconocido lo explica', () => {
  /*
   * El caso que hay que poder distinguir: una tasa de asistencia en cero puede
   * ser un setter que agenda reuniones a las que nadie va, o un equipo que no
   * está registrando el desenlace. Sin `attendanceUnknown` al lado, las dos se
   * leen igual — y a una se le baja el presupuesto y a la otra se le pide que
   * complete el registro.
   */
  const stats = summarize([entry({ attendanceUnknown: 1 }), entry({ attendanceUnknown: 1 })]);
  const rates = withRates(stats);

  assert.equal(rates.attendanceRate, 0);
  assert.equal(stats.attendanceUnknown, 2);
  assert.equal(stats.withMeeting, 2);
});
