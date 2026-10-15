/**
 * La aritmética del reparto automático de leads: a quién le toca el próximo.
 *
 * Es un reparto ponderado **suave** (el de nginx): cada persona tiene un peso y,
 * de cada "suma de pesos" leads, le tocan exactamente tantos como su peso. Con
 * una setter de peso 5 y un closer de peso 1, de cada 6 leads 5 son de ella y 1
 * de él. Y los intercala (S S S C S S) en vez de mandar ráfagas: con dos
 * setters de peso 5 se alternan entre ellas, no le caen cinco seguidos a una.
 *
 * Funciones puras: no leen la base ni el reloj. `src/leadRouting.js` es su
 * espejo para la vista previa de la pantalla, y el test verifica que los dos
 * digan la misma secuencia — la vista previa que no coincide con lo que después
 * pasa es peor que no tenerla.
 */

/** ¿Esta persona entra en el reparto? Activa, con peso y todavía del área comercial. */
export function isEligible(member) {
  return Boolean(member?.active) && Number(member?.weight) > 0 && member?.eligible !== false;
}

/**
 * Elige al próximo y devuelve los `current_weight` nuevos de todos.
 * `members` en su orden de pantalla (`position`): ante un empate gana el de
 * más arriba. Sin nadie elegible devuelve `chosen: null` y no cambia nada.
 *
 * @returns {{ chosen: object|null, weights: Map<number, number> }}
 */
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

/** Los próximos `count` a los que les tocaría un lead, sin guardar nada. */
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
