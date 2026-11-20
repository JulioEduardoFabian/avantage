import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMetaLeadForm, formatCustomFieldsNote, normalizeFieldKey } from '../metaLeadFields.js';

/*
 * Caso real del 25/10/2026: un lead que llenó el formulario dentro de
 * Messenger entró al panel con su nombre y "Sin celular" en la tarjeta, y sin
 * ninguna de las otras respuestas. Lo mismo venía pasando con Instagram.
 *
 * El motivo no era que Meta no las mandara: en esos formularios las preguntas
 * son propias y su clave es el texto de la pregunta convertido a slug, así
 * que buscar `field_data.phone_number` a secas no encontraba nada. El único
 * campo que entraba era el nombre, que es el único que Messenger prellena con
 * la clave canónica.
 */
const MESSENGER_FORM = [
  { name: 'full_name', values: ['Gianni Casas'] },
  { name: '¿cuál_es_tu_número_de_celular?', values: ['987654321'] },
  { name: '¿en_qué_universidad_estudias?', values: ['UNDAC'] },
  { name: '¿qué_carrera_estudias?', values: ['contabilidad'] },
  { name: '¿en_qué_punto_estás?', values: ['estoy_con_el_proyecto'] }
];

test('el celular entra aunque la pregunta no se llame phone_number', () => {
  const form = extractMetaLeadForm(MESSENGER_FORM);
  assert.equal(form.phone, '987654321');
  assert.equal(form.fullName, 'Gianni Casas');
  assert.equal(form.university, 'UNDAC');
  assert.equal(form.fieldOfStudy, 'contabilidad');
  assert.equal(form.progressNote, 'Estoy con el proyecto');
});

test('el formulario instantáneo clásico sigue leyéndose igual', () => {
  const form = extractMetaLeadForm([
    { name: 'full_name', values: ['Rafael Gonzales'] },
    { name: 'phone_number', values: ['+51987654321'] },
    { name: 'email', values: ['rafael@correo.com'] },
    { name: 'que_estas_sacando', values: ['Título profesional'] }
  ]);
  assert.equal(form.fullName, 'Rafael Gonzales');
  assert.equal(form.phone, '+51987654321');
  assert.equal(form.email, 'rafael@correo.com');
  assert.equal(form.academicLevel, 'Pregrado (Bachiller/Título)');
});

// La pregunta pide la universidad, no el nombre de la persona: si ganara la
// regla del nombre, la ficha diría que el lead se llama "UNDAC".
test('"el nombre de tu universidad" es la universidad y no el nombre', () => {
  const form = extractMetaLeadForm([
    { name: 'cual_es_el_nombre_de_tu_universidad', values: ['UNDAC'] },
    { name: 'cual_es_tu_nombre', values: ['Gianni'] }
  ]);
  assert.equal(form.university, 'UNDAC');
  assert.equal(form.fullName, 'Gianni');
});

// El DNI peruano tiene 8 dígitos y su pregunta suele decir "número": tomarlo
// como celular deja la ficha con un teléfono al que nadie contesta.
test('un documento nunca entra como celular', () => {
  const form = extractMetaLeadForm([
    { name: 'numero_de_dni', values: ['45678912'] },
    { name: 'full_name', values: ['Gianni Casas'] }
  ]);
  assert.equal(form.phone, undefined);
  assert.equal(form.dni, '45678912');
});

// Último recurso: la pregunta no nombra ni el celular ni el WhatsApp, pero la
// respuesta son nueve dígitos y eso en Perú es un celular.
test('una respuesta de 9 dígitos se rescata como celular aunque la pregunta no lo nombre', () => {
  const form = extractMetaLeadForm([
    { name: 'full_name', values: ['Gianni Casas'] },
    { name: 'a_donde_te_escribimos', values: ['987 654 321'] }
  ]);
  assert.equal(form.phone, '987 654 321');
  assert.deepEqual(form.extras, []);
});

test('ese último recurso no confunde un documento de 8 dígitos con un celular', () => {
  const form = extractMetaLeadForm([
    { name: 'tu_documento', values: ['45678912'] }
  ]);
  assert.equal(form.phone, undefined);
});

// Lo que el equipo agregue al formulario no tiene por qué tener campo en la
// ficha, pero perderlo es perder algo que la persona sí contestó.
test('las respuestas sin campo propio quedan escritas en las notas', () => {
  const form = extractMetaLeadForm([
    { name: 'full_name', values: ['Gianni Casas'] },
    { name: 'presupuesto_disponible', values: ['entre_1000_y_2000'] },
    { name: 'para_cuando_lo_necesitas', values: ['Este mes'] }
  ]);
  assert.deepEqual(form.extras, [
    { label: 'Presupuesto disponible', value: 'Entre 1000 y 2000' },
    { label: 'Para cuando lo necesitas', value: 'Este mes' }
  ]);
  const note = formatCustomFieldsNote(form);
  assert.match(note, /Presupuesto disponible: Entre 1000 y 2000/);
  assert.match(note, /Para cuando lo necesitas: Este mes/);
});

test('las claves se comparan sin tildes ni signos', () => {
  assert.equal(normalizeFieldKey('¿Cuál_es_tu_número_de_celular?'), 'cual es tu numero de celular');
});

test('una respuesta vacía no ocupa el campo', () => {
  const form = extractMetaLeadForm([
    { name: 'phone_number', values: [''] },
    { name: 'whatsapp', values: ['987654321'] }
  ]);
  assert.equal(form.phone, '987654321');
});
