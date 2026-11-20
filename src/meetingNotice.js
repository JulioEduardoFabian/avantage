/**
 * Qué se le dice a quien acaba de agendar una reunión a mano, según dónde
 * quedó de verdad el evento de Google.
 *
 * Vive en un solo sitio porque lo dicen tres pantallas (Calendario y la ficha
 * del lead en los dos funnels). Antes cada una tenía su copia y las tres
 * afirmaban "agendada en el calendario del asesor" aunque el evento hubiera
 * caído en el calendario de quien agendaba —el respaldo de `bookManual()`
 * cuando el Google del asesor no responde—: la persona lo buscaba en el
 * calendario del asesor, no lo encontraba y concluía que no se había agendado
 * (12/11/2026).
 *
 * Y una reunión telefónica no tiene sala de Meet, así que no aparece en
 * meet.google.com aunque sí esté en Google Calendar: también se dice.
 */
export function meetingCreatedNotice(data = {}) {
  if (data.calendarError && !data.meeting?.calendar_event_id) {
    return `Reunión guardada en el panel, pero sin evento en Google Calendar (${data.calendarError}).`;
  }
  const telefonica = data.meeting?.modality === 'llamada';
  const dondeVerla = telefonica
    ? ' Es telefónica: búscala en Google Calendar, no en meet.google.com (ahí solo salen las que tienen sala de Meet).'
    : '';
  if (data.calendarFallback) {
    return `✅ Reunión agendada, pero el evento quedó en TU Google Calendar y al asesor le llegó como invitación: su calendario no lo aceptó (${data.calendarFallback.reason}).${dondeVerla}`;
  }
  if (data.calendarError) {
    return `✅ Reunión agendada en el calendario del asesor, con un aviso: ${data.calendarError}${dondeVerla}`;
  }
  return `✅ Reunión agendada en el Google Calendar del asesor.${dondeVerla}`;
}
