import test from 'node:test';
import assert from 'node:assert/strict';

import { LEAD_ROLE_WORDS, worksLeads } from '../../../src/data/leadRoles.js';

const con = (role_name) => ({ role_name });

test('entran los roles que trabajan leads', () => {
  for (const rol of ['Setter', 'Closer', 'Comercial', 'Ventas', 'Vendedor']) {
    assert.equal(worksLeads(con(rol)), true, rol);
  }
});

test('no entra quien está en el área por tener todos los permisos', () => {
  assert.equal(worksLeads(con('Administrador')), false);
  assert.equal(worksLeads(con('Marketing')), false);
  // "Asesor Operativo" es el líder de un proyecto, no alguien que trabaje leads.
  assert.equal(worksLeads(con('Asesor Operativo')), false);
});

test('los roles compuestos y los plurales entran solos', () => {
  assert.equal(worksLeads(con('Setter Junior')), true);
  assert.equal(worksLeads(con('Ejecutivo Comercial')), true);
  assert.equal(worksLeads(con('Jefe de Ventas')), true);
  assert.equal(worksLeads(con('Setters')), true);
  assert.equal(worksLeads(con('Comerciales')), true);
});

test('la palabra tiene que ser una palabra, no un pedazo de otra', () => {
  assert.equal(worksLeads(con('Ventanilla')), false);
  assert.equal(worksLeads(con('Recepción')), false);
});

test('las tildes y las mayúsculas no deciden nada', () => {
  assert.equal(worksLeads(con('COMERCIAL')), true);
  assert.equal(worksLeads(con('Asesoría Comerciál')), true);
});

test('sin rol no se ofrece a nadie', () => {
  assert.equal(worksLeads(con(null)), false);
  assert.equal(worksLeads(con('')), false);
  assert.equal(worksLeads(null), false);
  assert.equal(worksLeads(undefined), false);
});

test('la lista de palabras es la única fuente del criterio', () => {
  assert.deepEqual(LEAD_ROLE_WORDS, ['setter', 'closer', 'comercial', 'ventas', 'vendedor']);
});
