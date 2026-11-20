/**
 * Espejo de `backend/services/leadRouting.js` para la vista previa de la
 * pantalla de Reparto: la secuencia se recalcula al instante mientras se mueve
 * un peso, sin ir al servidor. El test del backend verifica que las dos copias
 * digan la misma secuencia.
 */

/**
 * ¿Se reparte ESTE lead ahora? El de formulario y el del evaluador siempre —el
 * bot no los atiende nunca—; el que nace de una conversación de WhatsApp, solo
 * con el bot apagado. El porqué, en el backend.
 */
export function routesNow({ botWillAttend = false, botEnabled = false } = {}) {
  return !(botWillAttend && botEnabled);
}

export function isEligible(member) {
  return Boolean(member?.active) && Number(member?.weight) > 0 && member?.eligible !== false;
}

export function pickNext(members) {
  const weights = new Map(members.map((m) => [m.id, Number(m.current_weight) || 0]));
  const eligibles = members.filter(isEligible);
  if (eligibles.length === 0) return { chosen: null, weights };

  let total = 0;
  let chosen = null;
  for (const member of eligibles) {
    const weight = Number(member.weight);
    total += weight;
    const current = weights.get(member.id) + weight;
    weights.set(member.id, current);
    if (!chosen || current > weights.get(chosen.id)) chosen = member;
  }
  weights.set(chosen.id, weights.get(chosen.id) - total);
  return { chosen, weights };
}

export function simulateRouting(members, count) {
  let state = members.map((m) => ({ ...m }));
  const sequence = [];
  for (let i = 0; i < count; i += 1) {
    const { chosen, weights } = pickNext(state);
    if (!chosen) break;
    sequence.push(chosen.id);
    state = state.map((m) => ({ ...m, current_weight: weights.get(m.id) }));
  }
  return sequence;
}
