import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_CONTRACT_MODEL } from '../data/serviceContractModel.js';
import { buildContractDocument } from '../../services/contractDocument.js';

/**
 * El modelo vigente del contrato (confirmado por gerencia el 29/09/2026). Lo
 * que se fija acá no es la redacción —esa la cambia el área legal cuando
 * quiera desde el panel— sino las reglas de formato que hacen que el documento
 * salga bien: sin ordinales escritos a mano, con viñetas reconocibles y con los
 * cronogramas como marcador en vez de tabla tecleada. Son justo las tres cosas
 * que se perdían al pegar el texto desde Word.
 */

const clauses = SERVICE_CONTRACT_MODEL.clauses;

test('el modelo tiene las 14 cláusulas del contrato vigente', () => {
  assert.equal(clauses.length, 14);
  assert.equal(clauses[0].title, 'FINALIDAD DEL CONTRATO');
  assert.equal(clauses[13].title, 'ALCANCE DE LA GARANTÍA');
});

// El ordinal lo pone el documento por la POSICIÓN de la cláusula. Uno escrito
// en el título no se renumera al mover una cláusula, y el Word del que salió
// este texto ya traía tres duplicados ("CLÁUSULA DÉCIMA PRIMERA: CLÁUSULA
// DÉCIMO PRIMERA: …").
test('ningún título trae el ordinal escrito a mano', () => {
  for (const c of clauses) {
    assert.doesNotMatch(c.title, /CL[ÁA]USULA/i, `"${c.title}" no debe llevar el ordinal en el título`);
  }
});

test('las listas usan "- " y no la "o" que deja Word al pegar', () => {
  const withLists = clauses.filter((c) => /^- /m.test(c.body));
  assert.ok(withLists.length >= 4, 'las cláusulas de compromisos y penalidades van en viñetas');
  for (const c of clauses) {
    assert.doesNotMatch(c.body, /^o\s+\S/m, `"${c.title}" trae una viñeta de Word sin convertir`);
  }
});

test('los cronogramas y las cuentas van como marcador, no como tabla tecleada', () => {
  const pago = clauses.find((c) => c.title === 'RETRIBUCIÓN ECONÓMICA Y FORMA DE PAGO');
  assert.match(pago.body, /\{\{monto\}\}/);
  assert.match(pago.body, /\{\{cronograma_pagos\}\}/);
  assert.match(pago.body, /\{\{cuentas_bancarias\}\}/);

  const entregas = clauses.find((c) => c.title === 'CRONOGRAMA DE ENTREGAS');
  assert.match(entregas.body, /\{\{cronograma_entregas\}\}/);

  // Ninguna cláusula debe traer una tabla escrita a mano: es lo que dejaba
  // contratos emitidos con la tabla vacía.
  for (const c of clauses) {
    assert.doesNotMatch(c.body, /^Fecha\s*\|/m, `"${c.title}" trae una tabla tecleada`);
  }
});

test('la comparecencia nombra al representante legal y no fija datos del cliente', () => {
  assert.match(SERVICE_CONTRACT_MODEL.intro, /representada legalmente por \{\{representante\}\}/);
  assert.match(SERVICE_CONTRACT_MODEL.intro, /\{\{cliente\}\}/);
  assert.match(SERVICE_CONTRACT_MODEL.intro, /\{\{dni\}\}/);
  assert.doesNotMatch(SERVICE_CONTRACT_MODEL.intro, /Elena|25699591/);
});

// El Word traía la universidad y la carrera del contrato que se usó de
// muestra. Si se quedaran fijas, todos los contratos saldrían con esa.
test('ninguna cláusula deja fijos datos de un contrato concreto', () => {
  const finalidad = clauses.find((c) => c.title === 'FINALIDAD DEL CONTRATO');
  assert.match(finalidad.body, /\{\{universidad\}\}/);
  assert.match(finalidad.body, /\{\{carrera\}\}/);
  const todo = clauses.map((c) => c.body).join('\n');
  assert.doesNotMatch(todo, /USIL|Gestión Educativa|Elena Milagro/);
});

test('todos los importes escritos en el texto usan "S/." con punto', () => {
  const todo = clauses.map((c) => c.body).join('\n');
  assert.doesNotMatch(todo, /S\/(?!\.)\s*\d/, 'un importe quedó escrito como "S/ 15.00"');
  assert.match(todo, /S\/\. 15\.00/);
  assert.match(todo, /S\/\. 50\.00/);
});

// La prueba de integración: el modelo entero, renderizado, con datos de un
// contrato real.
test('el modelo completo se imprime sin marcadores sueltos ni tablas rotas', () => {
  const html = buildContractDocument({
    id: 6,
    status: 'borrador',
    title: SERVICE_CONTRACT_MODEL.title,
    intro: SERVICE_CONTRACT_MODEL.intro,
    closing: SERVICE_CONTRACT_MODEL.closing,
    clauses,
    client_name: 'Elena Milagro Félix Ramirez',
    client_dni: '25699591',
    client_address: 'Jr Tupac Amaru 1039-3 La Perla Callao',
    university: 'USIL',
    career: 'Gestión Educativa',
    total_amount: '1500.00',
    currency: 'PEN',
    city: 'HUANCAYO',
    contract_date: '2026-09-29',
    installments: [
      { monto: '750', due_date: '2026-09-29' },
      { monto: '750', due_date: '2026-09-30' }
    ],
    deliverables: [
      { due_date: null, avance: 'Firma de contrato' },
      { due_date: '2026-10-15', avance: 'Capítulo I y II' }
    ]
  });

  // Ningún marcador sin reemplazar llega al documento.
  assert.doesNotMatch(html, /\{\{\s*\w+\s*\}\}/);

  assert.match(html, /CLÁUSULA PRIMERA:<\/span> FINALIDAD DEL CONTRATO/);
  assert.match(html, /CLÁUSULA DÉCIMA CUARTA:<\/span> ALCANCE DE LA GARANTÍA/);
  assert.match(html, /representada legalmente por <strong>Julio Fabián Ninamango, Gerente General<\/strong>/);
  assert.match(html, /S\/\. 1,500\.00 \(MIL QUINIENTOS CON 00\/100 SOLES\)/);
  assert.match(html, /S\/\. 750\.00/);
  assert.match(html, /Julio Fabián Ninamango — Gerente General/);
  assert.match(html, /<td>Capítulo I y II<\/td>/);
  assert.match(html, /<li>Elaboración de la tesis, con rigor metodológico, hasta su aprobación\.<\/li>/);
});
