import test from 'node:test';
import assert from 'node:assert/strict';

import {
  metaColumnFor,
  parseLeadCsv,
  leadFromRow,
  parseTikTokTime,
  looksLikePermissionError,
  isRoutingError
} from '../tiktokLeadsService.js';
import { formContactsFromLeads, TIKTOK_FORM_SPEC } from '../campaignService.js';
import { extractMetaLeadForm } from '../metaLeadFields.js';

/*
 * Los leads de formulario instantáneo de TikTok no llegaban al CRM por ningún
 * camino: no hay webhook, así que se quedaban en el Centro de clientes
 * potenciales de TikTok mientras la campaña marcaba 21 conversiones en el Ads
 * Manager y su trazabilidad decía "todavía no hay contactos atribuidos".
 *
 * Lo que sigue fija las reglas de esa importación que son puras —texto que
 * entra, campos del lead que salen—, que son justamente las que no se pueden
 * probar contra la API.
 */

// ─────────────────────────── Cabeceras del archivo ──────────────────────────

test('las cabeceras de metadato se reconocen en inglés y en español', () => {
  assert.equal(metaColumnFor('Lead ID'), 'leadId');
  assert.equal(metaColumnFor('lead_id'), 'leadId');
  assert.equal(metaColumnFor('ID del cliente potencial'), 'leadId');
  assert.equal(metaColumnFor('Create Time'), 'createdTime');
  assert.equal(metaColumnFor('Fecha de creación'), 'createdTime');
  assert.equal(metaColumnFor('Ad ID'), 'adId');
  assert.equal(metaColumnFor('ID del anuncio'), 'adId');
  assert.equal(metaColumnFor('Campaign ID'), 'campaignId');
});

test('una pregunta del formulario NO es un metadato', () => {
  // El caso que hay que proteger: la pregunta por el celular dice "número" y
  // se parece a un id, pero es una respuesta y tiene que llegar al extractor.
  assert.equal(metaColumnFor('¿Cuál es tu número de celular?'), null);
  assert.equal(metaColumnFor('Nombre completo'), null);
  assert.equal(metaColumnFor('Universidad'), null);
});

// ──────────────────────────────── El CSV ────────────────────────────────────

test('el CSV se parsea respetando comillas, comas y saltos de línea internos', () => {
  const csv = [
    'Lead ID,Nombre completo,¿Cuál es tu universidad?,Comentario',
    '7412,Lucía Quispe,UNCP,"Estoy en el capítulo 3, casi terminando"',
    '7413,"Pérez, Juan",PUCP,"Línea uno\nlínea dos"'
  ].join('\n');

  const filas = parseLeadCsv(csv);
  assert.equal(filas.length, 2);
  assert.equal(filas[0]['Comentario'], 'Estoy en el capítulo 3, casi terminando');
  // Partir por split(',') habría roto justo acá, dejando "Pérez" y "Juan" en
  // dos columnas distintas y corriendo todo el resto de la fila.
  assert.equal(filas[1]['Nombre completo'], 'Pérez, Juan');
  assert.equal(filas[1]['Comentario'], 'Línea uno\nlínea dos');
});

test('una comilla doble dentro de un campo entrecomillado es una comilla literal', () => {
  const filas = parseLeadCsv('Lead ID,Comentario\n7414,"Dijo ""ya tengo el plan"""');
  assert.equal(filas[0]['Comentario'], 'Dijo "ya tengo el plan"');
});

test('el CSV vacío o sin filas no revienta', () => {
  assert.deepEqual(parseLeadCsv(''), []);
  assert.deepEqual(parseLeadCsv('Lead ID,Nombre\n'), []);
});

// ─────────────────────── De fila a lead importable ──────────────────────────

const FILA = {
  'Lead ID': '7412000111',
  'Create Time': '2026-10-27 14:05:31',
  'Ad ID': '1792000000000001',
  'Adgroup ID': '1792000000000002',
  'Campaign ID': '1792000000000003',
  'Nombre completo': 'Lucía Quispe',
  '¿Cuál es tu número de celular?': '987654321',
  '¿Cuál es el nombre de tu universidad?': 'UNCP',
  'Carrera': 'Ingeniería de Sistemas',
  '¿En qué turno te contactamos?': 'Por la tarde'
};

test('los metadatos salen a sus campos y el resto queda como respuestas', () => {
  const lead = leadFromRow(FILA, { pageId: '555' });
  assert.equal(lead.leadId, '7412000111');
  assert.equal(lead.adId, '1792000000000001');
  assert.equal(lead.adgroupId, '1792000000000002');
  assert.equal(lead.campaignId, '1792000000000003');
  assert.equal(lead.pageId, '555');
  // Las cinco preguntas del formulario, sin un solo metadato colado entre
  // ellas: un "Campaign ID" tratado como respuesta terminaría en las notas de
  // la ficha como si la persona lo hubiera contestado.
  assert.equal(lead.fieldData.length, 5);
  assert.ok(lead.fieldData.every((f) => Array.isArray(f.values)));
});

test('las respuestas las lee el MISMO extractor que las de Meta', () => {
  /*
   * Esta es la razón de ser de reusar `extractMetaLeadForm`: las reglas que
   * costaron casos reales en Meta valen igual acá. En particular que
   * "¿cuál es el NOMBRE de tu UNIVERSIDAD?" resuelva como universidad y no
   * como el nombre de la persona.
   */
  const lead = leadFromRow(FILA, { pageId: '555' });
  const form = extractMetaLeadForm(lead.fieldData);

  assert.equal(form.university, 'UNCP');
  assert.equal(form.fullName, 'Lucía Quispe');
  assert.equal(form.phone, '987654321');
  assert.equal(form.fieldOfStudy, 'Ingeniería de Sistemas');
  // Lo que no tiene campo propio en la ficha no se tira: va a las notas.
  assert.deepEqual(form.extras, [{ label: '¿En qué turno te contactamos?', value: 'Por la tarde' }]);
});

test('un valor vacío no se convierte en una respuesta en blanco', () => {
  const lead = leadFromRow({ 'Lead ID': '1', 'Carrera': '   ' });
  assert.equal(lead.fieldData.length, 0);
});

// ─────────────────────────────── La fecha ───────────────────────────────────

test('la fecha de TikTok se entiende en sus tres formas', () => {
  assert.equal(parseTikTokTime('1761580000').toISOString(), new Date(1761580000 * 1000).toISOString());
  assert.equal(parseTikTokTime('1761580000000').toISOString(), new Date(1761580000000).toISOString());
  // "2026-10-27 14:05:31" se lee como hora local del servidor, que corre en el
  // huso de Lima igual que la cuenta.
  const local = parseTikTokTime('2026-10-27 14:05:31');
  assert.equal(local.getFullYear(), 2026);
  assert.equal(local.getHours(), 14);
});

test('una fecha ausente o ilegible es null y no una fecha inventada', () => {
  assert.equal(parseTikTokTime(''), null);
  assert.equal(parseTikTokTime(null), null);
  assert.equal(parseTikTokTime('no es una fecha'), null);
});

// ──────────────────────── Atribución en Campañas ────────────────────────────

const LEAD_TIKTOK = {
  id: 902,
  phone: '+51 987 654 321',
  full_name: 'Lucía Quispe',
  tiktok_ad_id: '1792000000000001',
  tiktok_page_id: '555',
  tiktok_created_time: '2026-10-27T19:05:31.000Z',
  created_at: '2026-10-30T15:00:00.000Z'
};

test('el anuncio de TikTok viaja prefijado para no pisar a uno de Meta', () => {
  const [contacto] = formContactsFromLeads([LEAD_TIKTOK], new Map(), TIKTOK_FORM_SPEC);
  /*
   * `campaign_ads.ad_source_id` es ÚNICA y la comparten las dos plataformas;
   * los ids de anuncio de las dos son numéricos. Sin el prefijo, un anuncio de
   * TikTok podría quedarse con la fila de uno de Meta y mandarle sus leads a
   * la campaña equivocada.
   */
  assert.equal(contacto.sourceId, 'tt:1792000000000001');
  assert.equal(contacto.platform, 'tiktok');
  assert.equal(contacto.formId, '555');
  assert.equal(contacto.leadId, 902);
  assert.equal(contacto.origin, 'form');
});

test('el contacto se ubica el día en que llenó el formulario, no el día en que se importó', () => {
  const [contacto] = formContactsFromLeads([LEAD_TIKTOK], new Map(), TIKTOK_FORM_SPEC);
  // Lo llenó el 27/10 y la importación lo trajo el 30/10: cuenta el 27, o el
  // reporte nunca cierra contra el Administrador de anuncios de TikTok.
  assert.equal(contacto.firstMessageAt, '2026-10-27T19:05:31.000Z');
});

test('sin fecha de TikTok se cae a la del alta en el CRM', () => {
  const [contacto] = formContactsFromLeads(
    [{ ...LEAD_TIKTOK, tiktok_created_time: null }], new Map(), TIKTOK_FORM_SPEC
  );
  assert.equal(contacto.firstMessageAt, '2026-10-30T15:00:00.000Z');
});

test('si esa persona después escribió por WhatsApp, se le cuenta su conversación', () => {
  const indice = new Map([['987654321', '51987654321']]);
  const [contacto] = formContactsFromLeads([LEAD_TIKTOK], indice, TIKTOK_FORM_SPEC);
  assert.equal(contacto.waId, '51987654321');
});

test('un lead de TikTok sin anuncio no se atribuye a ninguna campaña', () => {
  const contactos = formContactsFromLeads(
    [{ ...LEAD_TIKTOK, tiktok_ad_id: null }], new Map(), TIKTOK_FORM_SPEC
  );
  assert.equal(contactos.length, 0);
});

// ───────────────────── Qué consejo da cada error ────────────────────────────

test('un error de validación NO manda a reautorizar la app', () => {
  /*
   * Caso real del 30/10/2026: `page/get/` topa el tamaño de página en 100 y
   * devolvió "page_size: number must be most 100". El aviso de "falta el scope
   * de Lead Generation" iba colgado de CUALQUIER fallo, así que mandaba a
   * rehacer el OAuth entero para volver exactamente al mismo error.
   */
  assert.equal(looksLikePermissionError({ message: 'TikTok Business API: page_size: number must be most 100' }), false);
  assert.equal(looksLikePermissionError({ message: 'TikTok Business API: Service error, please retry' }), false);
});

test('un error de permisos sí lo manda', () => {
  assert.equal(looksLikePermissionError({ tiktokCode: 40002 }), true);
  assert.equal(looksLikePermissionError({ message: 'You do not have permission to access this resource' }), true);
  assert.equal(looksLikePermissionError({ message: 'El token no tiene el scope requerido' }), true);
  assert.equal(looksLikePermissionError({ message: 'No autorizado para leer esta pagina' }), true);
});

test('solo un fallo de RUTA justifica probar el endpoint siguiente', () => {
  /*
   * La ruta de la tarea de descarga se resuelve probando variantes. Si
   * cualquier error hiciera avanzar a la siguiente, un fallo de permisos o de
   * parámetros terminaría reportado como "ninguna ruta respondió" —un 404
   * engañoso que esconde justo el error que hay que leer.
   */
  assert.equal(isRoutingError({ httpStatus: 404 }), true);
  assert.equal(isRoutingError({ httpStatus: 405 }), true);
  assert.equal(isRoutingError({ httpStatus: 200, tiktokCode: 40002 }), false);
  assert.equal(isRoutingError({ httpStatus: 400 }), false);
  assert.equal(isRoutingError({}), false);
});
