import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRIDGE_SCHEMAS,
  MINIMUM_ACCESS,
  bridgeEnvelope,
  listCapNotice,
  pageCapNotice
} from '../bridgeContract.js';

/*
 * Todos los puentes de datos de este CRM tenían el mismo agujero: recortaban en
 * silencio.
 *
 *  - `forms.slice(0, MAX_FORMS)` cortaba a 100 formularios en la importación de
 *    TikTok y no lo decía en ninguna parte del reporte.
 *  - `listForms()` de Meta corta a MAX_PAGES páginas de la Graph API; si quedaba
 *    un `paging.next`, los formularios que seguían no existían para la
 *    comparación.
 *  - `#getPaged()` de TikTok se detenía en la página 20 aunque `total_page`
 *    dijera 35.
 *
 * El daño es el mismo en los tres y es peor que un error: la comparación
 * devuelve un resultado que PARECE completo. "Están todos" y "están todos los
 * que miré" se escriben igual en la pantalla, y de esa diferencia cuelga ir a
 * buscar leads perdidos o darlos por recuperados.
 */

// ──────────────────────────── El sobre del puente ───────────────────────────

test('cuando se entregó todo, el sobre no dice que falte nada', () => {
  const sobre = bridgeEnvelope({
    esquema: BRIDGE_SCHEMAS.tiktokLeads,
    totalFilas: 12,
    filas: 12
  });

  assert.equal(sobre.recortado, false);
  assert.deepEqual(sobre.avisos, []);
  assert.equal(sobre.total_filas, 12);
  assert.equal(sobre.filas, 12);
});

test('cuando se recortó, el sobre lo dice Y lo explica', () => {
  const sobre = bridgeEnvelope({
    esquema: BRIDGE_SCHEMAS.tiktokLeads,
    totalFilas: 137,
    filas: 100
  });

  // Los tres juntos y no uno: un total sin `recortado` obliga al consumidor a
  // restar para enterarse, y el que no resta se lleva la mitad de los datos
  // creyendo que son todos.
  assert.equal(sobre.recortado, true);
  assert.equal(sobre.avisos.length, 1);
  assert.match(sobre.avisos[0], /100 de 137/);
  assert.match(sobre.avisos[0], /antes de concluir que falta algo/);
});

test('el offset entra en la cuenta del recorte', () => {
  // La última página de una paginación no está recortada aunque su `filas` sea
  // menor que el total.
  const ultima = bridgeEnvelope({ esquema: BRIDGE_SCHEMAS.attributionConflicts, totalFilas: 137, filas: 37, offset: 100 });
  assert.equal(ultima.recortado, false);

  const primera = bridgeEnvelope({ esquema: BRIDGE_SCHEMAS.attributionConflicts, totalFilas: 137, filas: 100, offset: 0 });
  assert.equal(primera.recortado, true);
});

test('un total desconocido no se inventa ni se lee como recorte', () => {
  /*
   * La Graph API pagina por cursor y no dice cuántas filas hay. `null` es "no se
   * puede saber" y no 0: afirmar un recorte sin saber el total manda a buscar
   * algo que puede estar completo, que es el error con el signo cambiado.
   */
  const sobre = bridgeEnvelope({ esquema: BRIDGE_SCHEMAS.metaReconciliation, totalFilas: null, filas: 40 });

  assert.equal(sobre.total_filas, null);
  assert.equal(sobre.recortado, false);
  assert.deepEqual(sobre.avisos, []);
});

test('los límites se publican siempre, incluso cuando nada se recortó', () => {
  // Un límite que solo se descubre al chocarlo es un límite indocumentado.
  const sobre = bridgeEnvelope({
    esquema: BRIDGE_SCHEMAS.tiktokLeads,
    totalFilas: 3,
    filas: 3,
    limites: { formularios_max: 100, formularios_por_pagina: 100 }
  });

  assert.deepEqual(sobre.limites, { formularios_max: 100, formularios_por_pagina: 100 });
});

test('el aviso de recorte se suma a los que ya venían, no los reemplaza', () => {
  const sobre = bridgeEnvelope({
    esquema: BRIDGE_SCHEMAS.tiktokLeads,
    totalFilas: 137,
    filas: 100,
    avisos: ['El token no pudo leer la suscripción de la Página.']
  });

  assert.equal(sobre.avisos.length, 2);
  assert.match(sobre.avisos[0], /suscripción/);
  assert.match(sobre.avisos[1], /100 de 137/);
});

// ───────────────────────────── Avisos de recorte ────────────────────────────

test('la paginación cortada nombra el tope y cuántas páginas había', () => {
  const aviso = pageCapNotice({ que: 'Formularios', paginasLeidas: 20, paginasTotales: 35, tope: 20 });

  // Sin el segundo número no se sabe si falta una página o treinta.
  assert.match(aviso, /20 de 35/);
  assert.match(aviso, /tope 20/);
  assert.match(aviso, /puede ser de acá y no de la plataforma/);
});

test('una paginación que llegó al final no genera aviso', () => {
  assert.equal(pageCapNotice({ que: 'Formularios', paginasLeidas: 3, paginasTotales: 3, tope: 20 }), null);
  // Y sin total conocido tampoco se inventa uno.
  assert.equal(pageCapNotice({ que: 'Formularios', paginasLeidas: 3, paginasTotales: 0, tope: 20 }), null);
});

test('la lista cortada dice que lo que quedó fuera no se comparó contra nada', () => {
  const aviso = listCapNotice({ que: 'Formularios revisados', revisados: 100, totales: 137, tope: 100 });

  assert.match(aviso, /100 de 137/);
  // Lo importante no es que falten: es que no figuran NI como presentes ni como
  // faltantes, así que la diferencia del reporte no los incluye.
  assert.match(aviso, /ni como presentes ni como faltantes/);
});

test('una lista entera no genera aviso', () => {
  assert.equal(listCapNotice({ que: 'Formularios', revisados: 12, totales: 12, tope: 100 }), null);
});

// ───────────────────────────── Esquema y versión ────────────────────────────

test('cada puente tiene nombre y versión', () => {
  for (const [clave, esquema] of Object.entries(BRIDGE_SCHEMAS)) {
    assert.equal(typeof esquema.nombre, 'string', `${clave} sin nombre`);
    assert.ok(esquema.nombre.length > 0, `${clave} con nombre vacío`);
    assert.equal(typeof esquema.version, 'number', `${clave} sin versión`);
  }
});

test('el sobre copia el esquema y no lo comparte por referencia', () => {
  // Mutar el sobre de una respuesta no puede cambiar la versión de todas las
  // demás.
  const sobre = bridgeEnvelope({ esquema: BRIDGE_SCHEMAS.tiktokLeads, totalFilas: 1, filas: 1 });
  sobre.esquema.version = 99;

  assert.notEqual(BRIDGE_SCHEMAS.tiktokLeads.version, 99);
});

// ──────────────────────────── El acceso mínimo ──────────────────────────────

test('cada permiso dice para qué es, qué se pierde sin él y cómo se consigue', () => {
  /*
   * El reflejo ante un 403 de una API de anuncios es pedir todos los permisos y
   * reautorizar la app, y eso amplía el alcance del token a ciegas: un token
   * con más permisos de los que usa es un token que, filtrado, hace más daño.
   * Cada entrada nombra UN permiso y UNA consecuencia, así que ante un fallo se
   * agrega el que corresponde y nada más.
   */
  for (const [clave, entrada] of Object.entries(MINIMUM_ACCESS)) {
    assert.ok(entrada.para, `${clave} sin "para"`);
    assert.ok(entrada.sin_el, `${clave} sin "sin_el"`);
    assert.ok(entrada.como, `${clave} sin "como"`);
  }
});

test('la pieza creativa de Smart+ se declara desconocida, no se infiere', () => {
  // La ruta no está habilitada en esta cuenta. Lo que NO se hace es deducir la
  // pieza por descarte: el gasto se reporta al anuncio padre y la pieza queda
  // sin saber, que es lo correcto mientras el dato no se pueda leer.
  const smart = MINIMUM_ACCESS['tiktok:smart_plus_creative'];

  assert.match(smart.sin_el, /anuncio padre/);
  assert.match(smart.sin_el, /NO se infiere/);
  assert.match(smart.como, /no se amplía ningún otro scope/);
});
