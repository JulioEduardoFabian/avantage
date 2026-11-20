import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_RESPONSE_SLA_MS, needsFirstResponse, waitingLabel } from '../../../src/leadFirstResponse.js';

/**
 * El aviso de "nadie le contestó a este lead".
 *
 * La regla vive en el frontend porque la pintan las tarjetas de los dos
 * tableros, y se prueba desde acá porque es la única suite del repo: lo que
 * importa es que las dos pantallas avisen por los mismos leads.
 *
 * Caso que lo motivó: 12 de los 22 leads del anuncio "FORM | Confianza |
 * contrato | Jair | 25Oct" no tenían ninguna primera respuesta registrada el
 * 31/10/2026, y no había forma de distinguir "no se le contactó" de "se le
 * llamó y no quedó registrado".
 */

const AHORA = new Date('2026-11-01T12:00:00.000Z');
const haceHoras = (h) => new Date(AHORA.getTime() - h * 60 * 60 * 1000).toISOString();

test('avisa recién a las 24 horas', () => {
  assert.equal(needsFirstResponse({ created_at: haceHoras(23) }, AHORA), false);
  assert.equal(needsFirstResponse({ created_at: haceHoras(25) }, AHORA), true);
  assert.equal(FIRST_RESPONSE_SLA_MS, 24 * 60 * 60 * 1000);
});

test('un lead al que ya se le contestó no avisa, por viejo que sea', () => {
  const lead = { created_at: haceHoras(200), first_response_at: haceHoras(199) };
  assert.equal(needsFirstResponse(lead, AHORA), false);
});

test('un lead con proyecto abierto no avisa', () => {
  // Ya está en producción: avisar ahí es ruido, y el aviso sirve para
  // perseguir lo que falta y no para auditar el pasado.
  const lead = { created_at: haceHoras(300), project_id: 12 };
  assert.equal(needsFirstResponse(lead, AHORA), false);
});

test('sin fecha de registro no se inventa un plazo', () => {
  assert.equal(needsFirstResponse({}, AHORA), false);
  assert.equal(needsFirstResponse({ created_at: 'no es una fecha' }, AHORA), false);
  assert.equal(needsFirstResponse(null, AHORA), false);
});

test('la espera se cuenta en lenguaje llano', () => {
  assert.equal(waitingLabel({ created_at: haceHoras(30) }, AHORA), 'sin responder desde hace 30 h');
  assert.equal(waitingLabel({ created_at: haceHoras(72) }, AHORA), 'sin responder desde hace 3 días');
  assert.equal(waitingLabel({}, AHORA), '');
});
