/**
 * ¿Este lead llegó por un formulario de Meta (Lead Ads)?
 *
 * Manda la atribución que guarda `persistMetaLead()` (`meta_leadgen_id` /
 * `meta_form_id`); el marcador de texto en las notas se mira como respaldo
 * porque los leads anteriores a esas columnas lo tienen solo ahí. No se deduce
 * de `source`: "Facebook Ads" también lo lleva quien escribió por un anuncio
 * sin llenar ningún formulario.
 *
 * Lo usan las tarjetas de los dos tableros, así que vive acá y no copiado en
 * cada vista.
 */
export function cameFromForm(lead) {
  if (!lead) return false;
  if (lead.meta_leadgen_id || lead.meta_form_id) return true;
  return String(lead.additional_notes || '').includes('[Meta leadgen_id=');
}
