import test from 'node:test';
import assert from 'node:assert/strict';

import { LEADGEN_FIELD, subscriptionState } from '../metaLeadReconciliationService.js';

/*
 * La suscripción al webhook es la causa más silenciosa de leads de formulario
 * perdidos: sin el campo `leadgen` suscrito, Meta no llama al webhook y no hay
 * error en ningún log — el CRM se ve igual que un día sin campañas. Estas son
 * las cuatro respuestas posibles y cada una se arregla distinto.
 */

const NUESTRA_APP = '1234567890';

const appSuscrita = (campos, { id = NUESTRA_APP, name = 'CRM Avantage' } = {}) => ({
  id,
  name,
  subscribed_fields: campos
});

test('la Página suscrita a "leadgen" está conectada', () => {
  const estado = subscriptionState([appSuscrita([LEADGEN_FIELD, 'feed'])], NUESTRA_APP);
  assert.equal(estado.estado, 'conectado');
  assert.equal(estado.leadgen, true);
});

test('sin ninguna app suscrita se dice que Meta no avisa de nada', () => {
  const estado = subscriptionState([], NUESTRA_APP);
  assert.equal(estado.estado, 'sin_apps');
  assert.equal(estado.leadgen, false);
  assert.match(estado.detalle, /leadgen/);
});

test('suscrita a la Página pero sin "leadgen" es su propio caso', () => {
  // Pasa de verdad: la app se suscribe para los comentarios del muro ("feed")
  // y los formularios quedan afuera. Se arregla agregando el campo, no
  // volviendo a suscribir la app.
  const estado = subscriptionState([appSuscrita(['feed', 'messages'])], NUESTRA_APP);
  assert.equal(estado.estado, 'sin_leadgen');
  assert.equal(estado.leadgen, false);
  assert.match(estado.detalle, /feed/);
});

test('otra app suscrita a "leadgen" no cuenta como nuestra', () => {
  /*
   * Los leads le llegan al webhook de ESA app, no al nuestro. Contarla como
   * "conectado" diría que todo está bien mientras los leads siguen sin entrar
   * al CRM, que es el peor diagnóstico posible.
   */
  const estado = subscriptionState(
    [appSuscrita([LEADGEN_FIELD], { id: '999', name: 'Otra herramienta' })],
    NUESTRA_APP
  );
  assert.equal(estado.estado, 'sin_apps');
  assert.equal(estado.leadgen, false);
  assert.match(estado.detalle, /Otra herramienta/);
});

test('sin META_APP_ID se mira cualquier app suscrita, que es lo único que se puede saber', () => {
  // No es tan preciso, pero es mejor que no contestar: el caso que importa
  // —nadie suscrito a leadgen— se detecta igual.
  const estado = subscriptionState([appSuscrita([LEADGEN_FIELD], { id: '999' })], null);
  assert.equal(estado.estado, 'conectado');

  const sinLeadgen = subscriptionState([appSuscrita(['feed'], { id: '999' })], null);
  assert.equal(sinLeadgen.estado, 'sin_leadgen');
});

test('una respuesta sin la lista de campos no se lee como suscrita', () => {
  // Meta omite `subscribed_fields` cuando el token no alcanza a leerlos:
  // asumir que incluye leadgen sería dar por bueno lo que no se comprobó.
  const estado = subscriptionState([{ id: NUESTRA_APP, name: 'CRM Avantage' }], NUESTRA_APP);
  assert.equal(estado.estado, 'sin_leadgen');
  assert.equal(estado.leadgen, false);
});

test('la suscripción vale para todos los formularios de la Página, también los nuevos', () => {
  /*
   * Es la razón por la que esta pregunta se contesta una vez y no formulario
   * por formulario: la suscripción se declara de la app a la PÁGINA. Un
   * formulario creado hoy —"FORM | Confianza | contrato | Jair | 25Oct"— queda
   * cubierto sin tocar nada, y si sus leads no llegan la causa es otra (y la
   * encuentra la comparación de `reconcile()`, no esto).
   */
  const estado = subscriptionState([appSuscrita([LEADGEN_FIELD])], NUESTRA_APP);
  assert.equal(estado.leadgen, true);
  assert.match(estado.detalle, /se creen después/);
});
