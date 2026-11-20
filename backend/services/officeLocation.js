/**
 * "¿Tienen sede en Lima?", "¿están en Lima?", "¿su oficina queda en Lima?".
 *
 * Es una pregunta de hecho, no de criterio: la respuesta es una dirección
 * exacta y no puede quedar sujeta a lo que improvise el LLM —una calle o un
 * número inventados mandan a alguien a tocar una puerta que no existe—, así
 * que se detecta con reglas acá y se contesta con el dato de `COMPANY.offices`,
 * la misma fuente que imprime el pie de la cotización. Es el mismo motivo por
 * el que la corrección de carrera/universidad (`profileCorrection.js`) tampoco
 * pasa por el modelo.
 *
 * Y es una pregunta caliente: quien pregunta por la sede está evaluando si
 * puede ir, o si la empresa es de verdad. Antes caía en `isTrustDoubt`
 * —"tienen oficina" coincide con su patrón— y se le contestaba con el
 * domicilio legal de Huancayo: al que preguntaba por Lima se le respondía que
 * estamos en otra ciudad, teniendo la sede de Lima a la vista.
 */

import { COMPANY } from './quotationDocument.js';

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 'LIMA' → 'Lima'. La etiqueta del pie de la cotización va en mayúsculas;
 * dentro de una frase de WhatsApp eso se lee como un grito.
 */
export function officeCityName(city) {
  const s = String(city || '').toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Cómo escribe la gente cada ciudad. La lista de sedes sale del catálogo
 * (`COMPANY.offices`) y no de acá: lo único que se agrega por ciudad son sus
 * alias, así que una sede nueva se contesta igual aunque nadie toque este
 * mapa (cae a su propio nombre).
 */
const CITY_ALIASES = {
  LIMA: ['lima'],
  HUANCAYO: ['huancayo', 'hyo']
};

function aliasesFor(city) {
  return CITY_ALIASES[city] || [normalize(city)];
}

/** Palabras con las que se nombra NUESTRA ubicación. */
const PLACE_WORD = 'sedes?|oficinas?|local(?:es)?|sucursal(?:es)?|direccion|atencion|tienda';

/*
 * Verbos en plural o en segunda persona. El singular ("queda", "está", "es")
 * se deja afuera a propósito: "mi universidad está en Lima" es una respuesta
 * normal del perfilamiento, y contestarla con la dirección de la oficina es
 * responderle a alguien algo que no preguntó.
 */
const US_VERB = 'estan|estas|estaran|estarian|son|eres|quedan|atienden|atiendes|operan|trabajan|ubicad[oa]s?|encuentran|vienen|visitar|ir';

/*
 * Lo que delata que la ciudad es la DEL CONTACTO y no la nuestra. Solo se
 * consulta cuando el mensaje no nombra una oficina: "vivo en Lima, ¿tienen
 * sede acá?" sí es una pregunta por la sede, y nombrar la oficina es lo que
 * la desempata.
 */
const ABOUT_THE_CONTACT = /\b(?:vivo|vivimos|resido|radico|estudio|estudie|estudiando|curso|soy\s+de|yo\s+(?:estoy|vivo|soy)|me\s+encuentro|estoy|mi\s+(?:casa|universidad|u|instituto|ciudad|zona|distrito|trabajo))\b/;

/** "mi dirección en Lima es…" es el cliente dando SU dirección. */
const OWN_ADDRESS = /\b(?:mi|nuestra)\s+direccion\b/;

/**
 * Las sedes por las que pregunta el mensaje, en el orden del catálogo. Vacío
 * si no está preguntando por ninguna.
 *
 * Devuelve TODAS las que nombre: "¿tienen sede en Lima o solo en Huancayo?"
 * pregunta por las dos, y contestar una sola deja la mitad de la pregunta sin
 * responder.
 */
export function officeQuestion(text) {
  const clean = normalize(text);
  if (!clean || clean.length > 240) return [];
  if (OWN_ADDRESS.test(clean)) return [];

  const matched = [];
  for (const office of COMPANY.offices) {
    const city = aliasesFor(office.city).join('|');

    // (a) El mensaje nombra la oficina y la ciudad: "sede en Lima", "oficina
    //     de Lima", "su oficina queda en Lima", "¿hay atención en Lima?".
    const byPlace = new RegExp(String.raw`\b(?:${PLACE_WORD})\b[^?¿]{0,25}?\b(?:en|de|por|:)?\s*(?:${city})\b`);

    // (b) Sin nombrar la oficina, pero preguntando por nosotros: "¿están en
    //     Lima?", "¿atienden en Lima?", "¿son de Lima?", "¿puedo ir a Lima?".
    const byVerb = new RegExp(String.raw`\b(?:${US_VERB})\b[^?¿]{0,30}?\b(?:en|de|por|desde|a)\s+(?:${city})\b`);

    if (byPlace.test(clean)) matched.push(office);
    else if (byVerb.test(clean) && !ABOUT_THE_CONTACT.test(clean)) matched.push(office);
  }
  return matched;
}
