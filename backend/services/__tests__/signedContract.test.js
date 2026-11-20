import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayTitle,
  isoDay,
  normalizeExternalUrl,
  sourceOf,
  validateSource
} from '../signedContractService.js';
import { deletionBlockReason } from '../leadService.js';

/**
 * Contrato firmado: las reglas que deciden qué se acepta como documento,
 * probadas sin base de datos.
 */

test('el enlace tiene que ser una dirección web de verdad', () => {
  assert.equal(
    normalizeExternalUrl('https://drive.google.com/file/d/abc/view'),
    'https://drive.google.com/file/d/abc/view'
  );
  assert.equal(normalizeExternalUrl('  http://ejemplo.com/c.pdf  '), 'http://ejemplo.com/c.pdf');
  assert.equal(normalizeExternalUrl(''), null);
  assert.equal(normalizeExternalUrl(null), null);
});

test('un enlace que no es http(s) no se guarda', () => {
  /*
   * Lo que se guarda termina siendo un `href` en la ficha: un `javascript:`
   * pegado ahí se ejecutaría al hacer clic.
   */
  assert.throws(() => normalizeExternalUrl('javascript:alert(1)'), /http:\/\/ o https:\/\//);
  assert.throws(() => normalizeExternalUrl('file:///C:/contrato.pdf'), /http:\/\/ o https:\/\//);
  assert.throws(() => normalizeExternalUrl('drive.google.com/abc'), /dirección válida/);
  assert.throws(() => normalizeExternalUrl(`https://x.com/${'a'.repeat(1200)}`), /demasiado largo/);
});

test('el enlace rechazado lo dice con un 400, no con un 500', () => {
  try {
    normalizeExternalUrl('javascript:alert(1)');
    assert.fail('debió lanzar');
  } catch (error) {
    assert.equal(error.status, 400);
  }
});

test('un archivo o un enlace, nunca los dos ni ninguno', () => {
  // Las dos formas válidas.
  assert.doesNotThrow(() => validateSource({ file: { filename: 'x.pdf' } }));
  assert.doesNotThrow(() => validateSource({ externalUrl: 'https://drive.google.com/x' }));

  // Los dos a la vez dejarían dos originales y ninguno mandando.
  assert.throws(
    () => validateSource({ file: { filename: 'x.pdf' }, externalUrl: 'https://drive.google.com/x' }),
    /no las dos cosas/
  );
  // Ninguno guardaría "hay contrato firmado" sin el contrato.
  assert.throws(() => validateSource({}), /Falta el documento/);
  assert.throws(() => validateSource(), /Falta el documento/);
});

test('cómo está guardado el documento se deriva de la fila', () => {
  assert.equal(sourceOf({ file_filename: '123.pdf' }), 'archivo');
  assert.equal(sourceOf({ external_url: 'https://drive.google.com/x' }), 'enlace');
  assert.equal(sourceOf(null), 'enlace');
});

test('sin título se usa el nombre del archivo, y de último uno genérico', () => {
  assert.equal(displayTitle({ title: 'Adenda 1', file_original_name: 'x.pdf' }), 'Adenda 1');
  assert.equal(displayTitle({ title: '   ', file_original_name: 'contrato-firmado.pdf' }), 'contrato-firmado.pdf');
  // Un enlace no tiene nombre de archivo: ahí la fila igual tiene que llamarse
  // de alguna forma en pantalla.
  assert.equal(displayTitle({ external_url: 'https://drive.google.com/x' }), 'Contrato firmado');
});

test('la fecha de firma no se corre un día al serializarla', () => {
  // mysql2 entrega DATE como un Date a medianoche LOCAL; `toISOString()` lo
  // pasaría a UTC y podría devolver el día anterior.
  assert.equal(isoDay(new Date(2026, 9, 23)), '2026-10-23');
  assert.equal(isoDay('2026-10-23T00:00:00.000Z'), '2026-10-23');
  assert.equal(isoDay(null), null);
});

test('una ficha con contrato firmado no se puede borrar', () => {
  /*
   * `signed_contracts` está en CASCADE: borrar el lead borraría el respaldo de
   * la firma, que es lo único que cuelga de una ficha y no se puede volver a
   * generar desde el sistema.
   */
  const motivo = deletionBlockReason({
    projects: 0, income: 0, contracts: 0, quotes: 0, commissions: 0, signedContracts: 1
  });
  assert.match(motivo, /contrato\(s\) firmado\(s\)/);
  assert.match(motivo, /respaldo de la firma/);

  // Sin nada colgando se sigue pudiendo borrar.
  assert.equal(
    deletionBlockReason({ projects: 0, income: 0, contracts: 0, quotes: 0, commissions: 0, signedContracts: 0 }),
    null
  );
});
