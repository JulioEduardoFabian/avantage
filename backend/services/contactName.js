/**
 * El nombre con el que se le habla a un contacto.
 *
 * `findOrCreateFromWhatsApp()` abre la ficha con un marcador cuando WhatsApp
 * no compartió un nombre de perfil real. Ese marcador es un hueco, no un
 * nombre: sacarlo a pantalla —"Contacto de WhatsApp" en la agenda del
 * calendario— hace creer que la reunión es con un desconocido cuando lo único
 * que pasó es que nadie escribió todavía cómo se llama la persona.
 *
 * La lista vive acá y no repetida en cada servicio porque el día que el
 * marcador cambie, la pantalla que se quedó con la cadena vieja vuelve a
 * mostrarlo como si fuera un nombre. Su espejo para el navegador es
 * `src/contactName.js`.
 */
export const GENERIC_CONTACT_NAME = 'Contacto de WhatsApp';

const GENERIC_NAMES = new Set([GENERIC_CONTACT_NAME.toLowerCase(), 'sin nombre']);

/** ¿Es el marcador y no un nombre de verdad? */
export function isGenericContactName(name) {
  const limpio = String(name || '').trim().toLowerCase();
  return limpio === '' || GENERIC_NAMES.has(limpio);
}

/** El primer nombre de verdad de la lista, o `null` si no hay ninguno. */
export function firstRealName(...candidates) {
  for (const candidato of candidates) {
    const limpio = String(candidato || '').trim();
    if (limpio && !isGenericContactName(limpio)) return limpio;
  }
  return null;
}
