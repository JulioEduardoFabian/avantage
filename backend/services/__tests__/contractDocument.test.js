import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContractDocument,
  clauseHeadingTitle,
  clauseOrdinal,
  contractPlaceholders,
  fillPlaceholders,
  formatAmountLegal,
  numberToWords
} from '../contractDocument.js';

test('numberToWords escribe montos en letras con las formas correctas', () => {
  assert.equal(numberToWords(0), 'cero');
  assert.equal(numberToWords(100), 'cien');
  assert.equal(numberToWords(101), 'ciento uno');
  assert.equal(numberToWords(5200), 'cinco mil doscientos');
  assert.equal(numberToWords(21000), 'veintiún mil');
  assert.equal(numberToWords(31500), 'treinta y un mil quinientos');
  assert.equal(numberToWords(1000000), 'un millón');
  assert.equal(numberToWords(2345678), 'dos millones trescientos cuarenta y cinco mil seiscientos setenta y ocho');
});

test('formatAmountLegal arma el monto en cifras y letras', () => {
  assert.equal(formatAmountLegal(5200, 'PEN'), 'S/ 5,200.00 (CINCO MIL DOSCIENTOS CON 00/100 SOLES)');
  assert.equal(formatAmountLegal('1500.5', 'USD'), 'US$ 1,500.50 (MIL QUINIENTOS CON 50/100 DÓLARES AMERICANOS)');
  assert.equal(formatAmountLegal(99.995), 'S/ 100.00 (CIEN CON 00/100 SOLES)');
  assert.equal(formatAmountLegal(null), null);
});

test('clauseOrdinal numera las cláusulas como en un contrato', () => {
  assert.equal(clauseOrdinal(1), 'PRIMERA');
  assert.equal(clauseOrdinal(10), 'DÉCIMA');
  assert.equal(clauseOrdinal(12), 'DÉCIMA SEGUNDA');
  assert.equal(clauseOrdinal(20), 'VIGÉSIMA');
});

test('fillPlaceholders reemplaza, deja línea para lo que falta y escapa HTML', () => {
  const html = fillPlaceholders('Cliente {{cliente}}, DNI {{dni}}, {{desconocido}} <b>', { cliente: 'Ana <x>', dni: null });
  assert.equal(html, 'Cliente <strong>Ana &lt;x&gt;</strong>, DNI ____________________, {{desconocido}} &lt;b&gt;');
});

test('buildContractDocument incluye las cláusulas numeradas y marca el borrador', () => {
  const html = buildContractDocument({
    id: 7,
    created_at: '2026-09-18T10:00:00Z',
    intro: 'Conste que {{cliente}} contrata.',
    closing: 'Firmado el {{fecha}}.',
    title: 'CONTRATO DE LOCACIÓN DE SERVICIOS',
    status: 'borrador',
    client_name: 'Carlos Flores',
    total_amount: '3000.00',
    currency: 'PEN',
    contract_date: '2026-09-18',
    clauses: [{ title: 'OBJETO', body: 'Servicio para {{cliente}}.' }, { title: 'PLAZO', body: 'Un año.' }]
  });
  assert.match(html, /CTR-2026-0007/);
  assert.match(html, /PRIMERA:<\/span> OBJETO/);
  assert.match(html, /SEGUNDA:<\/span> PLAZO/);
  assert.match(html, /Servicio para <strong>Carlos Flores<\/strong>/);
  assert.match(html, /Conste que <strong>Carlos Flores<\/strong> contrata\./);
  assert.match(html, /BORRADOR/);
  assert.match(html, /18 de se(p)?tiembre de 2026/);
});

test('{{cronograma_pagos}} imprime las cuotas pactadas como tabla', () => {
  const html = buildContractDocument({
    id: 8,
    title: 'CONTRATO',
    status: 'firmado',
    currency: 'PEN',
    installments: [
      { cuota: '1era', monto: '1000.00', due_date: '2026-09-22' },
      { cuota: '2da', monto: '2000.00', due_date: '2026-12-01' }
    ],
    clauses: [{ title: 'CONTRAPRESTACIÓN', body: 'Se pagará así:\n\n{{cronograma_pagos}}' }]
  });
  // Las columnas son las del modelo legal: fecha y monto, sin el número de
  // cuota (la tabla va dentro de una cláusula que ya habla de los tramos).
  assert.match(html, /<th>Fecha<\/th>/);
  assert.match(html, /<th>Monto en soles<\/th>/);
  assert.match(html, /22 de se(p)?tiembre de 2026/);
  assert.match(html, /S\/ 2,000\.00/);
});

// Un contrato que dice "S/ 750" se presta a discusión sobre los céntimos.
test('{{cronograma_pagos}} imprime siempre los dos decimales', () => {
  const html = buildContractDocument({
    id: 81,
    title: 'CONTRATO',
    status: 'firmado',
    currency: 'PEN',
    installments: [{ cuota: '1era', monto: '750', due_date: '2026-09-20' }],
    clauses: [{ title: 'CONTRAPRESTACIÓN', body: '{{cronograma_pagos}}' }]
  });
  assert.match(html, /S\/ 750\.00/);
  assert.doesNotMatch(html, /S\/ 750</);
});

test('{{cronograma_pagos}} deja la fila a convenir cuando no hay cuotas pactadas', () => {
  const html = buildContractDocument({
    id: 9,
    title: 'CONTRATO',
    status: 'borrador',
    installments: [],
    clauses: [{ title: 'CONTRAPRESTACIÓN', body: '{{cronograma_pagos}}' }]
  });
  assert.match(html, /A convenir entre las partes/);
});

test('buildContractDocument incluye la firma del locador salvo en contratos anulados', () => {
  const base = { id: 1, title: 'CONTRATO', clauses: [] };
  assert.match(buildContractDocument({ ...base, status: 'borrador' }), /<img src="data:image\/png;base64,/);
  assert.match(buildContractDocument({ ...base, status: 'firmado' }), /<img src="data:image\/png;base64,/);
  assert.doesNotMatch(buildContractDocument({ ...base, status: 'anulado' }), /<img src="data:image/);
});

// ---------------------------------------------------------------------------
// Correcciones pedidas por gerencia el 29/09/2026
// ---------------------------------------------------------------------------

test('el encabezado dice "CLÁUSULA PRIMERA" y no repite el ordinal escrito a mano', () => {
  const html = buildContractDocument({
    id: 20,
    title: 'CONTRATO',
    status: 'borrador',
    clauses: [
      { title: 'CLÁUSULA PRIMERA: FINALIDAD DEL CONTRATO', body: 'Texto.' },
      { title: 'COMPROMISOS DEL LOCADOR', body: 'Texto.' }
    ]
  });
  assert.match(html, /CLÁUSULA PRIMERA:<\/span> FINALIDAD DEL CONTRATO/);
  assert.match(html, /CLÁUSULA SEGUNDA:<\/span> COMPROMISOS DEL LOCADOR/);
  assert.doesNotMatch(html, /PRIMERA:<\/span> CLÁUSULA PRIMERA/);
});

test('clauseHeadingTitle quita el ordinal escrito a mano en sus formas habituales', () => {
  assert.equal(clauseHeadingTitle('CLÁUSULA PRIMERA: FINALIDAD'), 'FINALIDAD');
  assert.equal(clauseHeadingTitle('CLAUSULA DÉCIMA SEGUNDA - SANCIONES'), 'SANCIONES');
  assert.equal(clauseHeadingTitle('SEGUNDA: COMPROMISOS'), 'COMPROMISOS');
  assert.equal(clauseHeadingTitle('OBJETO DEL CONTRATO'), 'OBJETO DEL CONTRATO');
});

// Un título que es SOLO el ordinal no debe quedar vacío en el encabezado.
test('clauseHeadingTitle no vacía un título que no tiene nada más', () => {
  assert.equal(clauseHeadingTitle('CLÁUSULA PRIMERA:'), 'CLÁUSULA PRIMERA:');
});

test('{{domicilio_empresa}} es solo la calle: la comparecencia sigue con el representante', () => {
  const values = contractPlaceholders({ id: 1 });
  assert.equal(values.domicilio_empresa, 'Calle Neptuno 185');
  assert.doesNotMatch(values.domicilio_empresa, /Huancayo/);
});

test('la cuenta de Interbank se imprime a nombre de su titular, no de la empresa', () => {
  const html = buildContractDocument({
    id: 21,
    title: 'CONTRATO',
    status: 'borrador',
    clauses: [{ title: 'PAGO', body: '{{cuentas_bancarias}}' }]
  });
  assert.match(html, /Julio Fabián Ninamango — Gerente General/);
  // La de BCP sigue a nombre de la empresa.
  assert.match(html, /Avantage Group S\.A\.C\. Cuenta Corriente/);
});

test('{{cronograma_entregas}} imprime las entregas pactadas como tabla', () => {
  const html = buildContractDocument({
    id: 22,
    title: 'CONTRATO',
    status: 'firmado',
    deliverables: [
      { due_date: '2026-09-20', avance: 'Firma de contrato' },
      { due_date: '2026-10-05', avance: 'Capítulo I y II' }
    ],
    clauses: [{ title: 'ENTREGAS', body: 'Se entregará así:\n\n{{cronograma_entregas}}' }]
  });
  assert.match(html, /<th>Fecha<\/th>/);
  assert.match(html, /<th>Avance<\/th>/);
  assert.match(html, /<td>Firma de contrato<\/td>/);
  assert.match(html, /5 de octubre de 2026/);
});

test('una entrega sin fecha se imprime "Por definir" en vez de dejar la celda vacía', () => {
  const html = buildContractDocument({
    id: 23,
    title: 'CONTRATO',
    status: 'borrador',
    deliverables: [{ due_date: null, avance: 'Firma de contrato' }],
    clauses: [{ title: 'ENTREGAS', body: '{{cronograma_entregas}}' }]
  });
  assert.match(html, /Por definir/);
  assert.match(html, /Firma de contrato/);
});

test('{{cronograma_entregas}} sin entregas no rompe el documento', () => {
  const html = buildContractDocument({
    id: 24,
    title: 'CONTRATO',
    status: 'borrador',
    clauses: [{ title: 'ENTREGAS', body: '{{cronograma_entregas}}' }]
  });
  assert.match(html, /Por definir/);
});
