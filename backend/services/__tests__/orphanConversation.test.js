import test from 'node:test';
import assert from 'node:assert/strict';
import { isOrphanConversation, wasDeletedOnPurpose } from '../orphanConversationService.js';
import { phoneMatchKey } from '../leadService.js';

/**
 * La regla que decide si una conversación se quedó sin ficha.
 *
 * Se prueba aparte de la consulta porque de ella cuelga una acción que crea
 * leads: un falso positivo abre una ficha duplicada de alguien que ya está en
 * el funnel, y un falso negativo deja a una persona escribiendo sin que nadie
 * la vea. Las dos son peores que el error que vienen a arreglar.
 */

const indexDe = (telefonos) => ({
  exactPhones: new Set(telefonos.map(String)),
  phoneKeys: new Set(telefonos.map(phoneMatchKey).filter(Boolean))
});

test('el wa_id que coincide exacto con un teléfono no es huérfano', () => {
  const index = indexDe(['+51931261225']);
  assert.equal(isOrphanConversation('+51931261225', index), false);
});

test('cruza por los últimos 9 dígitos, como findByPhone', () => {
  // La ficha y el webhook escriben el número distinto: el `wa_id` llega sin
  // el "+" y la ficha lo guarda con separadores. Comparar las cadenas tal cual
  // daría por perdido a un contacto que sí está.
  const index = indexDe(['+51 931 261 225']);
  assert.equal(isOrphanConversation('51931261225', index), false);
  assert.equal(isOrphanConversation('931261225', index), false);
});

test('un número que no tiene ficha es huérfano', () => {
  const index = indexDe(['+51987654321']);
  assert.equal(isOrphanConversation('+51931261225', index), true);
});

test('dos números distintos con el mismo sufijo no se confunden', () => {
  // Nueve dígitos es el largo de un celular peruano completo, así que dos
  // números que compartan el sufijo de 9 son el mismo número con distinto
  // prefijo — no dos personas.
  const index = indexDe(['+51931261225']);
  assert.equal(isOrphanConversation('+51931261226', index), true);
});

test('un wa_id que no es teléfono solo vale por coincidencia exacta', () => {
  // Los "PE.xxxx" de quien escribe desde un anuncio sin compartir su celular:
  // no hay sufijo de 9 dígitos con el que cruzarlos, y cruzarlos por sus
  // últimos caracteres emparejaría contactos distintos.
  const conFicha = indexDe(['PE.1093306950275407']);
  assert.equal(isOrphanConversation('PE.1093306950275407', conFicha), false);

  const sinFicha = indexDe(['+51931261225']);
  assert.equal(isOrphanConversation('PE.1093306950275407', sinFicha), true);
});

test('un wa_id vacío no se reporta como huérfano', () => {
  // No hay a quién abrirle una ficha: reportarlo solo agrega ruido a una lista
  // que se mira justamente para actuar sobre cada renglón.
  const index = indexDe([]);
  assert.equal(isOrphanConversation('', index), false);
  assert.equal(isOrphanConversation(null, index), false);
});

test('sin índice de teléfonos no se da por hecho que todo está registrado', () => {
  // El valor por defecto tiene que ser "falta", no "está": dar por registrada
  // una conversación que no se pudo comprobar esconde justo lo que se busca.
  assert.equal(isOrphanConversation('+51931261225', {}), true);
});


/* ──────────── La ficha que alguien borró no se vuelve a abrir ──────────── */

/**
 * Desde que el barrido adopta solo, "nunca se abrió" y "la sacaron a
 * propósito" se ven igual —conversación sí, ficha no— y se resuelven al revés.
 * Lo que las separa es la fecha, y eso es lo que se prueba acá.
 */

const borradoEl = (fecha) => [{ deleted_at: fecha }];

test('una conversación anterior al borrado no se vuelve a adoptar', () => {
  assert.equal(
    wasDeletedOnPurpose({ lastAt: '2026-11-05T10:00:00Z' }, borradoEl('2026-11-06T09:00:00Z')),
    true
  );
});

test('si el contacto volvió a escribir DESPUÉS del borrado, su ficha se abre igual', () => {
  // Es actividad nueva, no el rastro de lo que alguien sacó: el webhook haría
  // lo mismo con ese mensaje.
  assert.equal(
    wasDeletedOnPurpose({ lastAt: '2026-11-07T08:00:00Z' }, borradoEl('2026-11-06T09:00:00Z')),
    false
  );
});

test('sin ningún borrado registrado, nada queda excluido', () => {
  assert.equal(wasDeletedOnPurpose({ lastAt: '2026-11-07T08:00:00Z' }, []), false);
});

test('con varios borrados del mismo número alcanza con que uno tape la conversación', () => {
  const borrados = [{ deleted_at: '2026-10-01T00:00:00Z' }, { deleted_at: '2026-11-08T00:00:00Z' }];
  assert.equal(wasDeletedOnPurpose({ lastAt: '2026-11-07T08:00:00Z' }, borrados), true);
});

test('un borrado sin fecha no excluye nada', () => {
  // Preferir recuperar de más antes que dejar a una persona fuera del funnel
  // por una fila a la que le falta el dato.
  assert.equal(wasDeletedOnPurpose({ lastAt: '2026-11-07T08:00:00Z' }, [{ deleted_at: null }]), false);
});
