import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyMatchesText, levenshtein, matchesLeadSearch } from '../../../src/leadSearch.js';

/**
 * El buscador de los dos tableros de leads. Se prueba desde acá —como el
 * espejo de `leadRouting`— porque la suite corre sobre `backend/**`, y de esto
 * depende que alguien encuentre al lead al que está por llamar.
 */

test('la distancia cuenta los cambios de una palabra a la otra', () => {
  assert.equal(levenshtein('rodriguez', 'rodriguez'), 0);
  assert.equal(levenshtein('rodrigez', 'rodriguez'), 1);  // falta una letra
  assert.equal(levenshtein('rodrigues', 'rodriguez'), 1); // una cambiada
  assert.equal(levenshtein('', 'juan'), 4);
});

test('el corte temprano no cambia el resultado cuando la distancia entra en el máximo', () => {
  assert.equal(levenshtein('rodrigez', 'rodriguez', 2), 1);
  // Y cuando se pasa, devuelve algo mayor al máximo: al llamador le alcanza
  // para descartar sin haber calculado la matriz entera.
  assert.ok(levenshtein('juan', 'wilhelmina', 2) > 2);
});

test('encuentra pese al dedazo', () => {
  assert.equal(fuzzyMatchesText('Juan Diego Centeno Machaca', 'centeno'), true);
  assert.equal(fuzzyMatchesText('Juan Diego Centeno Machaca', 'centino'), true);
  assert.equal(fuzzyMatchesText('Ingeniería de Sistemas', 'sistmas'), true);
});

test('encuentra sin tildes, que es la mitad de las búsquedas fallidas', () => {
  assert.equal(fuzzyMatchesText('Óscar Castañeda', 'oscar castaneda'), true);
  assert.equal(fuzzyMatchesText('Núñez', 'nunez'), true);
});

test('las palabras de la consulta no tienen que estar pegadas', () => {
  assert.equal(fuzzyMatchesText('Juan Diego Centeno Machaca', 'juan centeno'), true);
  // Pero todas tienen que aparecer: si falta una, no es esa persona.
  assert.equal(fuzzyMatchesText('Juan Diego Centeno Machaca', 'juan ramirez'), false);
});

test('una consulta corta no se corrige: devolvería media agenda', () => {
  // Con "ana" y una letra de margen entrarían "ara", "una", "ani"…
  assert.equal(fuzzyMatchesText('Ara Flores', 'ana'), false);
  assert.equal(fuzzyMatchesText('Ana Flores', 'ana'), true);
});

test('un nombre que no se parece no entra', () => {
  assert.equal(fuzzyMatchesText('Juan Diego Centeno', 'rodriguez'), false);
});

/* ------------------------------- El lead -------------------------------- */

const LEAD = {
  id: 412,
  full_name: 'Óscar Castañeda',
  phone: '+51 980 303 553',
  dni: '70123456',
  topic: 'Clima laboral',
  field_of_study: 'Ingeniería Ambiental',
  university: 'Universidad Católica Sedes Sapientiae',
  source: 'Facebook Ads',
  assigned_to: 'Kevin'
};

test('busca por todos los campos en los DOS tableros, no una lista por pantalla', () => {
  for (const consulta of ['castaneda', 'clima', 'ambiental', 'sapientiae', 'facebook', 'kevin']) {
    assert.equal(matchesLeadSearch(LEAD, consulta), true, `"${consulta}" debería encontrarlo`);
  }
});

test('el teléfono se busca tal cual, sin corregir un solo dígito', () => {
  assert.equal(matchesLeadSearch(LEAD, '303553'), true);
  assert.equal(matchesLeadSearch(LEAD, '3553'), true);
  // Un dígito de diferencia es OTRA persona: corregirlo mostraría la ficha
  // equivocada justo cuando alguien está por llamar.
  assert.equal(matchesLeadSearch(LEAD, '303554'), false);
});

test('el documento y el id también se buscan exactos', () => {
  assert.equal(matchesLeadSearch(LEAD, '70123456'), true);
  assert.equal(matchesLeadSearch(LEAD, '412'), true);
  assert.equal(matchesLeadSearch(LEAD, '#412'), true);
});

test('el buscador vacío no filtra nada', () => {
  assert.equal(matchesLeadSearch(LEAD, ''), true);
  assert.equal(matchesLeadSearch(LEAD, '   '), true);
});

test('un lead sin esos campos no revienta ni matchea de más', () => {
  assert.equal(matchesLeadSearch({ id: 9 }, 'castaneda'), false);
  assert.equal(matchesLeadSearch(null, 'castaneda'), false);
});
