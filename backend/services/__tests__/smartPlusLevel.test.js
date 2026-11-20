import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEVELS,
  SPEND_LEVEL,
  creativeOf,
  levelLabel,
  withinValidity
} from '../smartPlusLevel.js';
import { leadOrigin, PLATFORMS } from '../leadOrigin.js';

/*
 * Las campañas Smart+ de TikTok no tienen un anuncio y una pieza: tienen un
 * anuncio PADRE y, debajo, piezas creativas que la plataforma combina y rota
 * sola. El CRM guardaba un solo `tiktok_ad_id`, así que de un lead de Smart+ no
 * se podía decir qué pieza lo trajo NI se podía decir que no se sabía: salía
 * como un lead de ese anuncio, igual que uno de una campaña simple.
 *
 * El error que estas pruebas cierran es inferir la pieza por descarte. Si una
 * campaña tiene tres videos y el lead trae solo el id del padre, atribuirlo al
 * video que más impresiones tuvo ese día produce un número que parece cierto,
 * que nadie puede auditar, y del que cuelga cortar una pieza que quizá era la
 * que vendía.
 */

// ──────────────────────── En qué nivel se puede atribuir ────────────────────

test('con la pieza conocida se atribuye a la pieza', () => {
  const creative = creativeOf({
    tiktok_parent_ad_id: '1800000000000000001',
    tiktok_creative_id: '1900000000000000009',
    tiktok_video_id: 'v-7412'
  });

  assert.equal(creative.level, LEVELS.pieza);
  assert.equal(creative.pieceKnown, true);
  assert.equal(creative.attributionAdId, '1900000000000000009');
});

test('sin pieza se atribuye al PADRE y la pieza queda desconocida', () => {
  /*
   * El caso normal hoy. El padre es además el nivel en que TikTok reporta el
   * gasto, así que los dos lados de la división —gasto y citas— hablan del
   * mismo objeto. Con el gasto en el padre y las citas en la pieza, el
   * resultado no es el costo de nada.
   */
  const creative = creativeOf({ tiktok_parent_ad_id: '1800000000000000001' });

  assert.equal(creative.level, LEVELS.padre);
  assert.equal(creative.pieceKnown, false);
  assert.equal(creative.attributionAdId, '1800000000000000001');
  assert.equal(creative.creativeId, null);
  assert.equal(creative.videoId, null);
});

test('en una campaña que no es Smart+ el anuncio es su propio padre', () => {
  // Sin esto, la mayoría de los leads quedaría "sin padre" por una distinción
  // que a ellos no les aplica, y perderían su atribución.
  const creative = creativeOf({ tiktok_ad_id: '1800000000000000002' });

  assert.equal(creative.parentAdId, '1800000000000000002');
  assert.equal(creative.level, LEVELS.padre);
});

test('sin ningún id el nivel es desconocido y no se inventa uno', () => {
  const creative = creativeOf({});

  assert.equal(creative.level, LEVELS.desconocido);
  assert.equal(creative.attributionAdId, null);
  assert.equal(creative.pieceKnown, false);
});

test('el gasto se mide en el padre, y está escrito como constante', () => {
  // Es la mitad de la división: mientras esto diga "padre", todo costo por
  // etapa se reporta al padre.
  assert.equal(SPEND_LEVEL, LEVELS.padre);
});

// ───────────────── Los tres identificadores no son lo mismo ─────────────────

test('anuncio, pieza y video son tres ids distintos y se guardan aparte', () => {
  /*
   * Un mismo video vive en varias piezas y una pieza puede cambiar de anuncio.
   * Mezclarlos hace que "el video que mejor convierte" y "el anuncio que mejor
   * convierte" devuelvan respuestas distintas sin que se sepa cuál es cuál.
   */
  const creative = creativeOf({
    tiktok_parent_ad_id: '1800000000000000001',
    tiktok_creative_id: '1900000000000000009',
    tiktok_video_id: 'v-7412',
    tiktok_ad_name: 'TT | WA | Asesor | 27Oct',
    tiktok_video_name: 'testimonial-lucia-v3.mp4'
  });

  assert.equal(creative.parentAdId, '1800000000000000001');
  assert.equal(creative.creativeId, '1900000000000000009');
  assert.equal(creative.videoId, 'v-7412');
  // Y los nombres tampoco se confunden: el del anuncio no es el del archivo.
  assert.equal(creative.adName, 'TT | WA | Asesor | 27Oct');
  assert.equal(creative.videoName, 'testimonial-lucia-v3.mp4');
});

test('los ids viajan como texto: 19 dígitos no pasan por Number', () => {
  const creative = creativeOf({ tiktok_parent_ad_id: '1800000000000000001' });

  assert.equal(typeof creative.parentAdId, 'string');
  assert.equal(creative.parentAdId, '1800000000000000001');
});

// ───────────────────────────── Cómo se nombra ───────────────────────────────

test('el nivel se nombra siempre, y "desconocido" es un valor y no un hueco', () => {
  assert.equal(levelLabel(LEVELS.pieza), 'Pieza creativa');
  // El texto dice las dos cosas: a qué nivel es el número, y que la pieza no se
  // sabe. Es lo que permite leer un costo sin creer que mide una creatividad.
  assert.equal(levelLabel(LEVELS.padre), 'Anuncio padre (pieza desconocida)');
  assert.equal(levelLabel(LEVELS.desconocido), 'Desconocido');
  assert.equal(levelLabel(null), 'Desconocido');
});

// ──────────────────────────────── La vigencia ───────────────────────────────

test('sin vigencia guardada la respuesta es null, que no es false', () => {
  // No se puede comprobar algo que no está guardado, y afirmar que el lead cae
  // fuera sería inventar.
  assert.equal(withinValidity({ tiktok_created_time: '2026-10-27T10:00:00Z' }), null);
});

test('un lead dentro de la vigencia de su pieza cae dentro', () => {
  const dentro = withinValidity({
    tiktok_created_time: '2026-10-27T10:00:00Z',
    tiktok_creative_valid_from: '2026-10-20T00:00:00Z',
    tiktok_creative_valid_to: '2026-11-05T00:00:00Z'
  });
  assert.equal(dentro, true);
});

test('un lead anterior a que su pieza existiera cae fuera', () => {
  /*
   * Es la forma más silenciosa de que un costo por lead salga absurdo: dividir
   * el gasto de un período por leads cuya pieza ni existía entonces.
   */
  const fuera = withinValidity({
    tiktok_created_time: '2026-10-01T10:00:00Z',
    tiktok_creative_valid_from: '2026-10-20T00:00:00Z'
  });
  assert.equal(fuera, false);
});

test('la vigencia se puede consultar para un momento distinto del ingreso', () => {
  const lead = {
    tiktok_created_time: '2026-10-27T10:00:00Z',
    tiktok_creative_valid_to: '2026-10-30T00:00:00Z'
  };
  assert.equal(withinValidity(lead), true);
  assert.equal(withinValidity(lead, '2026-11-15T00:00:00Z'), false);
});

// ───────────── La jerarquía llega al origen y no se pierde ──────────────────

test('leadOrigin entrega la creatividad dentro del bloque de TikTok', () => {
  const origin = leadOrigin({
    origin_platform: PLATFORMS.tiktok,
    tiktok_lead_id: '7412',
    tiktok_ad_id: '1800000000000000001',
    tiktok_creative_id: '1900000000000000009'
  });

  assert.equal(origin.platform, PLATFORMS.tiktok);
  assert.equal(origin.creative.level, LEVELS.pieza);
  assert.equal(origin.creative.attributionAdId, '1900000000000000009');
});

test('un lead de Meta no trae bloque de creatividad de TikTok', () => {
  // Las dos plataformas tienen jerarquías distintas: inventarle a Meta una
  // "pieza" sería la misma confusión en el otro sentido.
  const origin = leadOrigin({
    origin_platform: PLATFORMS.meta,
    meta_leadgen_id: '99001',
    meta_ad_id: '120210000000000001'
  });

  assert.equal(origin.creative, undefined);
});
