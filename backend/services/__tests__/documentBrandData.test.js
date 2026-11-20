import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPANY, buildQuotationDocument } from '../quotationDocument.js';
import { buildContractDocument, contractPlaceholders } from '../contractDocument.js';

/*
 * Los datos de la empresa que el cliente usa para comprobar con quién trata:
 * el RUC, las sedes de atención y los teléfonos. Están en el HTML y no en una
 * tabla, así que lo único que puede guardar que sigan impresos es una prueba
 * que los busque en el documento armado.
 */

const QUOTE = { id: 1, quote_number: 'COT-0001', total: 2500, currency: 'PEN', items: [] };
const LEAD = { full_name: 'Ana Pérez', field_of_study: 'Ingeniería de Sistemas' };

test('la cotización lleva el RUC en el encabezado y no solo al pie', () => {
  const html = buildQuotationDocument({ quote: QUOTE, lead: LEAD });
  // El del encabezado va en su propia clase: al pie el RUC ya estaba, así que
  // buscar el número suelto pasaría aunque el del encabezado desapareciera.
  assert.match(html, /class="q-ruc">RUC 20615846971</);
  assert.equal(COMPANY.ruc, '20615846971');
});

test('la cotización imprime las dos sedes de atención', () => {
  const html = buildQuotationDocument({ quote: QUOTE, lead: LEAD });
  // La de Lima va con el piso y el número de oficina: es la misma cadena que
  // el bot le manda a quien pregunta "¿tienen sede en Lima?" (ver
  // `officeLocation.js`), y quien pregunta eso va a ir — la calle a secas lo
  // deja parado en la puerta del edificio.
  assert.match(html, /LIMA<\/strong> Jirón Washington 1420, 2\.º piso, oficina 10/);
  assert.match(html, /HUANCAYO<\/strong> Calle Neptuno 185/);
});

test('las sedes no pisan el domicilio legal del contrato', () => {
  // `offices` es dónde se atiende; `address` es el domicilio inscrito, el que
  // firma el contrato. Confundirlos haría que el contrato dijera una dirección
  // que no es la de la ficha RUC.
  const values = contractPlaceholders({ id: 1, contract_number: 'CON-0001' });
  assert.equal(values.domicilio_empresa, COMPANY.address);
  assert.equal(COMPANY.address, 'Calle Neptuno 185');
});

test('el contrato lleva los teléfonos de contacto en el encabezado', () => {
  const html = buildContractDocument({ id: 1, contract_number: 'CON-0001', cliente_nombre: 'Ana Pérez' });
  assert.match(html, /class="c-contact">904 961 715 · 936 271 254</);
  assert.deepEqual(COMPANY.contactPhones, ['904 961 715', '936 271 254']);
});
