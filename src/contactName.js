/**
 * Espejo de `backend/services/contactName.js` para el navegador.
 *
 * Existe por lo mismo que `src/salesFunnelStage.js`: la regla se decide en el
 * servidor, pero el formulario necesita aplicarla antes de mandar nada — si
 * precargara el marcador que el bot le pone a un contacto sin nombre de perfil,
 * la persona lo confirmaría sin mirar y la reunión nacería llamándose
 * "Contacto de WhatsApp", que es justo lo que se vino a sacar de la agenda.
 */
export const GENERIC_CONTACT_NAME = 'Contacto de WhatsApp';

const GENERIC_NAMES = new Set([GENERIC_CONTACT_NAME.toLowerCase(), 'sin nombre']);

/** ¿Es el marcador y no un nombre de verdad? */
export function isGenericContactName(name) {
  const limpio = String(name || '').trim().toLowerCase();
  return limpio === '' || GENERIC_NAMES.has(limpio);
}

/** El primer nombre de verdad de la lista, o `''` si no hay ninguno. */
export function firstRealName(...candidates) {
  for (const candidato of candidates) {
    const limpio = String(candidato || '').trim();
    if (limpio && !isGenericContactName(limpio)) return limpio;
  }
  return '';
}
