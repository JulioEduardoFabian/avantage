/**
 * Los círculos con iniciales con los que se dibuja a una persona del equipo.
 *
 * Vive fuera de las vistas porque la misma persona aparece en la tabla de
 * Proyectos (líder y colaboradores) y en las tarjetas de los dos tableros de
 * leads (el responsable comercial). Copiado en cada pantalla, la paleta se
 * desincroniza y "Lucía" pasa a ser verde en un lado y naranja en el otro —
 * justo lo que hace reconocible al círculo de un vistazo.
 */

/** Las iniciales que van dentro del círculo: una o dos letras, nunca más. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Color del círculo, derivado del nombre. Es estable —la misma persona se ve
 * siempre del mismo color en todas las pantallas, que es lo que la hace
 * reconocible de un vistazo— y no se guarda en ningún lado.
 *
 * Todos los tonos de la paleta tienen contraste suficiente con el texto blanco
 * de las iniciales.
 */
const AVATAR_COLORS = ['#6F8125', '#2E7D46', '#56624A', '#C85532', '#8A3F28', '#3A6B8A', '#6B4E8C', '#8A6A1F'];

export function avatarColor(name) {
  const text = String(name || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 100000;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
