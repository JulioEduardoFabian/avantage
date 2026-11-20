import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { CampaignExportService } from '../campaignExportService.js';
import { bareSourceId, ctwaAttribution, leadOrigin, onlyGreeted } from '../leadOrigin.js';
import { GENERIC_CONTACT_NAME } from '../contactName.js';

/**
 * De dónde salió cada lead y cómo sale escrito en la hoja que marketing
 * importa.
 *
 * Las dos mitades están en el mismo archivo a propósito: la regla que resuelve
 * el origen y la columna que lo publica tienen que decir lo mismo, y lo que se
 * rompió en producción fue justamente el tramo entre las dos — el CRM tenía el
 * `ad_id` de 21 leads de TikTok y la hoja los mostraba sin campaña y como si
 * fueran de Meta.
 */

// ─────────────────────────── El origen del lead ───────────────────────────

test('un lead de TikTok es de TikTok y no de Meta', () => {
  const origin = leadOrigin({
    tiktok_lead_id: '1824030199203841',
    tiktok_ad_id: '1824030199203842',
    tiktok_adgroup_id: '1824030199203843',
    tiktok_campaign_id: '1824030199203844',
    tiktok_ad_name: 'TT | WA | Asesor | 27Oct',
    tiktok_campaign_name: 'TT | WA | Asesor | 27Oct',
    tiktok_adgroup_name: 'Perú | 25-44 | Amplio | Form',
    source: 'TikTok Ads'
  });

  assert.equal(origin.platform, 'TikTok');
  assert.equal(origin.channel, 'Formulario');
  assert.equal(origin.paid, true);
  assert.equal(origin.adId, '1824030199203842');
  assert.equal(origin.adName, 'TT | WA | Asesor | 27Oct');
  assert.equal(origin.platformLeadId, '1824030199203841');
});

test('un lead de formulario de Meta trae su red, su campaña y su leadgen_id', () => {
  const origin = leadOrigin({
    meta_leadgen_id: '1202238475019384',
    meta_form_id: '900112233445566',
    meta_ad_id: '120223847501938',
    meta_adset_id: '120223847501937',
    meta_campaign_id: '120223847501936',
    meta_ad_name: 'FORM | Confianza | contrato | Jair | 25Oct',
    meta_adset_name: 'Perú | 24-45',
    meta_campaign_name: 'FORM | Octubre',
    meta_platform: 'ig',
    meta_created_time: '2026-10-25T14:05:00.000Z',
    created_at: '2026-10-28T09:00:00.000Z'
  });

  assert.equal(origin.platform, 'Meta');
  assert.equal(origin.network, 'Instagram');
  assert.equal(origin.channel, 'Formulario');
  assert.equal(origin.campaignName, 'FORM | Octubre');
  assert.equal(origin.platformLeadId, '1202238475019384');
  // La fecha de ingreso es la del envío en Meta, no la del rescate en el CRM.
  assert.equal(origin.enteredAt, '2026-10-25T14:05:00.000Z');
});

test('un clic en un anuncio que abrió WhatsApp es Meta por el canal de WhatsApp', () => {
  const origin = leadOrigin({
    ctwa_ad_id: '120223847501939',
    ctwa_clid: 'ARAbcdef123',
    ctwa_source_type: 'ad',
    ctwa_headline: '¿Cuánto te cuesta tu tesis?',
    source: 'Anuncio de Meta'
  });

  assert.equal(origin.platform, 'Meta');
  assert.equal(origin.channel, 'WhatsApp');
  assert.equal(origin.paid, true);
  assert.equal(origin.adId, '120223847501939');
  // El click id hace el papel del leadgen_id: es con lo que Meta reconoce esta
  // conversación en la Conversions API.
  assert.equal(origin.platformLeadId, 'ARAbcdef123');
});

test('un clic desde una publicación es de Meta y no es pagado', () => {
  const origin = leadOrigin({ ctwa_source_type: 'post', ctwa_ad_id: null, ctwa_clid: 'ARxyz' });

  assert.equal(origin.platform, 'Meta');
  assert.equal(origin.paid, false, 'una publicación orgánica no gastó presupuesto');
  assert.equal(origin.adId, null, 'el id de un post no es un id de anuncio');
});

test('lo que no vino de un anuncio nunca se escribe como Meta', () => {
  assert.equal(leadOrigin({ source: 'WhatsApp Directo' }).platform, 'Orgánico');
  assert.equal(leadOrigin({ source: 'WhatsApp Directo' }).channel, 'WhatsApp');
  assert.equal(leadOrigin({ source: 'Chatbot Web' }).platform, 'Orgánico');
  assert.equal(leadOrigin({ source: 'Referido' }).platform, 'Referido');
  assert.equal(leadOrigin({ source: 'Presencial' }).platform, 'Orgánico');
  // Un origen que nadie reconoce es "Otro": contarlo como Meta es lo que
  // hacía que una venta de TikTok se le acreditara a Meta.
  assert.equal(leadOrigin({ source: 'Volanteo en la universidad' }).platform, 'Otro');
  assert.equal(leadOrigin({}).platform, 'Otro');
});

test('un lead cuyo source dice "Ads" es de Meta aunque no se sepa el anuncio', () => {
  const origin = leadOrigin({ source: 'Facebook Ads' });
  assert.equal(origin.platform, 'Meta');
  assert.equal(origin.paid, false, 'sin ad_id no hay anuncio al que atribuirle el gasto');
  assert.equal(origin.adId, null);
});

test('el prefijo interno de TikTok no sale en el ID de origen', () => {
  assert.equal(bareSourceId('tt:1824030199203842'), '1824030199203842');
  assert.equal(bareSourceId('120223847501938'), '120223847501938');
  assert.equal(bareSourceId(null), null);
});

test('el referral del primer mensaje se traduce a las columnas del lead', () => {
  const anuncio = ctwaAttribution({
    source_type: 'ad',
    source_id: '120223847501939',
    ctwa_clid: 'ARabc',
    headline: 'Asesoría de tesis'
  });
  assert.equal(anuncio.ctwaAdId, '120223847501939');
  assert.equal(anuncio.ctwaClid, 'ARabc');

  // El `source_id` de una publicación es el id del post: escribirlo como id de
  // anuncio la haría pasar por pagada.
  const post = ctwaAttribution({ source_type: 'post', source_id: '998877', ctwa_clid: 'ARdef' });
  assert.equal(post.ctwaAdId, null);
  assert.equal(post.ctwaClid, 'ARdef');

  // Sin nada que guardar no se devuelve un objeto con nulos, para poder
  // esparcirlo sobre el alta sin ensuciarla.
  assert.deepEqual(ctwaAttribution(null), {});
  assert.deepEqual(ctwaAttribution({ source_type: 'ad' }), {});
});

test('"solo saludó" es el contacto que no dejó un dato más que su número', () => {
  const opciones = { genericName: GENERIC_CONTACT_NAME };

  assert.equal(onlyGreeted({ full_name: GENERIC_CONTACT_NAME }, opciones), true);
  assert.equal(onlyGreeted({ full_name: 'Rafael Gonzales' }, opciones), false);
  assert.equal(onlyGreeted({ full_name: GENERIC_CONTACT_NAME, email: 'a@b.pe' }, opciones), false);
  assert.equal(onlyGreeted({ overall_viability_score: 0 }, opciones), false, 'un 0 es un informe hecho');
});

// ──────────────────── Cómo sale escrito en la hoja ────────────────────

/**
 * Los encabezados que el importador de marketing busca por su nombre. El
 * orden no le importa; el texto sí, y renombrar uno lo deja fuera del reporte
 * sin que nada falle a la vista.
 */
const COLUMNAS_CONTRATO = [
  'Lead', 'Carrera', 'Canal', 'Plataforma', 'Campaña', 'ID de campaña',
  'Conjunto de anuncios', 'ID de conjunto', 'Anuncio', 'Titular del anuncio', 'ID de origen',
  'ID del lead en la plataforma', 'Fecha de ingreso', 'Primer mensaje', 'Calificado', 'Viabilidad',
  'Cita agendada', 'Columna del funnel', 'Etapa comercial', 'Fecha de cierre'
];

function trailFixture() {
  return {
    campaigns: [{ id: 1, name: 'FORM | Octubre', currency: 'PEN', metaAds: [], adBreakdown: [], metrics: {} }],
    leadTrail: [
      {
        leadId: 1, name: 'Rafael Gonzales', phone: '+51 987 654 321', email: 'rafael@correo.pe',
        career: 'Ingeniería Civil', origin: 'Formulario', channel: 'Formulario', platform: 'Meta',
        network: 'Instagram', paid: true,
        campaignId: '120223847501936', campaignName: 'FORM | Octubre',
        adsetId: '120223847501937', adsetName: 'Perú | 24-45',
        adName: 'FORM | Confianza | contrato | Jair | 25Oct', adHeadline: null,
        adSourceId: '120223847501938', platformLeadId: '1202238475019384', crmCampaignId: 1,
        enteredAt: '2026-10-25T14:05:00.000Z', firstMessageAt: '2026-10-25T14:05:00.000Z',
        // Le contestó una persona: el acuse y la atención humana coinciden.
        firstResponseMinutes: 4.5, firstResponseBy: 'Lucía Ramos', firstResponseIsHuman: true,
        humanFirstResponseMinutes: 4.5,
        qualified: true, viability: 72, meetingAt: null, appointmentWithoutMeeting: false,
        onlyGreeted: false, funnelColumn: 'Cotizado', commercialStage: 'Cotización / propuesta',
        closedAt: '2026-10-29T16:00:00.000Z', quotedValue: 3500, paidRevenue: 1500,
        // Cotizado y con cuotas asentadas, pero la venta no se ganó: todo lo
        // registrado es acuerdo, nada es facturación.
        wonRevenue: 0, pactedRevenue: 3500, billedRevenue: 3500
      },
      {
        // El caso de los 21 leads de TikTok: id de anuncio guardado y prefijo
        // interno `tt:` ya quitado por el servicio.
        leadId: 2, name: 'Prospecto de TikTok', phone: '987654322', email: null, career: null,
        origin: 'Formulario', channel: 'Formulario', platform: 'TikTok', network: 'TikTok', paid: true,
        campaignId: '1824030199203844', campaignName: 'TT | WA | Asesor | 27Oct',
        adsetId: '1824030199203843', adsetName: 'Perú | 25-44 | Amplio | Form',
        adName: null, adHeadline: null,
        adSourceId: '1824030199203842', platformLeadId: '1824030199203841', crmCampaignId: null,
        enteredAt: '2026-10-27T19:05:00.000Z', firstMessageAt: '2026-10-27T19:05:00.000Z',
        // Nadie le contestó nunca, y su etapa dice "cita agendada" sin que
        // haya una reunión con fecha y hora detrás: los dos casos que el
        // reporte no sabía nombrar.
        firstResponseMinutes: null, firstResponseBy: null, firstResponseIsHuman: false,
        humanFirstResponseMinutes: null,
        qualified: null, viability: null, meetingAt: null, appointmentWithoutMeeting: true,
        onlyGreeted: true, funnelColumn: 'Conversación abierta', commercialStage: 'En seguimiento',
        closedAt: null, quotedValue: null, paidRevenue: 0,
        wonRevenue: 0, pactedRevenue: 0, billedRevenue: 0
      },
      {
        // Un lead que no vino de ningún anuncio: va en la misma hoja, con
        // plataforma y sin campaña inventada.
        leadId: 3, name: 'Lucía Ramos', phone: '987654323', email: null, career: null,
        origin: 'WhatsApp', channel: 'WhatsApp', platform: 'Orgánico', network: null, paid: false,
        campaignId: null, campaignName: null, adsetId: null, adsetName: null,
        adName: null, adHeadline: null, adSourceId: null, platformLeadId: null, crmCampaignId: null,
        enteredAt: '2026-10-30T11:00:00.000Z', firstMessageAt: '2026-10-30T11:00:00.000Z',
        // Respuesta registrada sin persona detrás: Avan o el eco de la app de
        // WhatsApp Business. No hay reloj humano que publicar.
        firstResponseMinutes: 2, firstResponseBy: null, firstResponseIsHuman: false,
        humanFirstResponseMinutes: null,
        qualified: false, viability: null, meetingAt: null, appointmentWithoutMeeting: false,
        onlyGreeted: false, funnelColumn: 'Nuevo', commercialStage: 'En seguimiento',
        closedAt: null, quotedValue: null, paidRevenue: 0,
        wonRevenue: 0, pactedRevenue: 0, billedRevenue: 0
      }
    ]
  };
}

async function trailSheet(options = {}) {
  const service = new CampaignExportService({
    campaignService: { async getPerformance() { return trailFixture(); } }
  });
  const { workbook, filename } = await service.buildWorkbook(options);

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lead-trail-')), filename);
  await workbook.xlsx.writeFile(file);
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.readFile(file);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });

  const sheet = reopened.getWorksheet('Ruta de leads');
  const headers = sheet.getRow(1).values.slice(1);
  return {
    sheet,
    headers,
    cell: (row, header) => sheet.getRow(row).getCell(headers.indexOf(header) + 1).value
  };
}

test('la hoja lleva todas las columnas que el importador de marketing busca', async () => {
  const { headers } = await trailSheet();
  for (const columna of COLUMNAS_CONTRATO) {
    assert.ok(headers.includes(columna), `falta la columna "${columna}"`);
  }
});

test('los identificadores salen como texto, dígito por dígito', async () => {
  const { sheet, headers, cell } = await trailSheet();

  for (const header of ['ID de origen', 'ID de campaña', 'ID de conjunto', 'ID del lead en la plataforma']) {
    const valor = cell(2, header);
    assert.equal(typeof valor, 'string', `"${header}" tiene que viajar como texto`);
    assert.ok(!/[eE]\+/.test(valor), `"${header}" no puede salir en notación científica`);
  }

  assert.equal(cell(2, 'ID de origen'), '120223847501938');
  assert.equal(cell(2, 'ID de campaña'), '120223847501936');
  // El prefijo interno de TikTok no llega a la hoja.
  assert.equal(cell(3, 'ID de origen'), '1824030199203842');

  // La columna lleva además formato de texto, para que Excel no reinterprete
  // el valor si alguien la pega en otra hoja.
  const columna = sheet.getColumn(headers.indexOf('ID de origen') + 1);
  assert.equal(columna.numFmt, '@');
});

test('ningún lead sale sin plataforma, y el orgánico no se disfraza de campaña', async () => {
  const { sheet, cell } = await trailSheet();

  assert.equal(sheet.rowCount, 4, 'cabecera + 3 leads, atribuidos y no atribuidos');
  assert.equal(cell(2, 'Plataforma'), 'Meta');
  assert.equal(cell(3, 'Plataforma'), 'TikTok');
  assert.equal(cell(4, 'Plataforma'), 'Orgánico');
  assert.equal(cell(4, 'Campaña'), 'Sin campaña asignada');
  assert.equal(cell(4, 'ID de origen'), '-', 'sin anuncio no hay nada que poner');
});

test('al lead pagado al que le falta el nombre del anuncio se le dice "sin dato"', async () => {
  const { cell } = await trailSheet();
  // La fila 3 vino de un anuncio y su nombre no se guardó: es un dato que hay
  // que ir a buscar, no un lead sin anuncio.
  assert.equal(cell(3, 'Anuncio'), 'sin dato');
});

test('"Calificado" distingue el lead sin revisar del revisado y descartado', async () => {
  const { cell } = await trailSheet();

  assert.equal(cell(2, 'Calificado'), 'Sí');
  assert.equal(cell(4, 'Calificado'), 'No');
  /*
   * El tercer estado se ESCRIBE. Antes la celda quedaba vacía y eso era
   * información solo para quien conoce la regla: el importador de marketing la
   * leyó como un "No" y la planilla del corte del 10/11/2026 terminó diciendo
   * que los 450 leads estaban descalificados — el mismo error con el signo
   * cambiado que esta columna vino a evitar cuando se derivaba de la etapa y
   * decía "Sí" en 403 de 403 filas. Un valor que no se puede colapsar no se
   * colapsa.
   */
  assert.equal(cell(3, 'Calificado'), 'Sin calificar');
});

test('el tercer estado de la cita asistida también va escrito', async () => {
  const { cell } = await trailSheet();
  // Ninguno de los tres leads de la muestra tiene desenlace registrado: la
  // celda lo dice en vez de dejar que se lea como una ausencia.
  assert.equal(cell(2, 'Cita asistida'), 'Sin registrar');
});

test('la hoja separa el acuse de Avan de la atención humana', async () => {
  const { cell } = await trailSheet();

  /*
   * Con una sola cifra de primera respuesta, el lead al que Avan le contestó
   * en segundos y nadie volvió a escribirle se ve igual que el que un setter
   * atendió de verdad. Son dos relojes y se arreglan distinto.
   */
  assert.equal(cell(2, 'Quién respondió primero'), 'Lucía Ramos');
  assert.equal(cell(2, 'Respuesta humana (min)'), 4.5);

  // Respuesta registrada sin persona detrás: no se afirma que fue el bot —un
  // asesor escribiendo desde WhatsApp Business llega por el mismo camino.
  assert.equal(cell(4, 'Quién respondió primero'), 'Avan o app de WhatsApp');
  assert.equal(cell(4, 'Respuesta humana (min)'), '-');

  // Y el lead al que nadie contestó lo dice con todas las letras: es el caso
  // que hay que ir a buscar, no una celda que se olvidaron de llenar.
  assert.equal(cell(3, 'Quién respondió primero'), 'Sin respuesta registrada');
});

test('lo registrado en Finanzas se parte en venta ganada y cuota pactada', async () => {
  const { cell } = await trailSheet();

  /*
   * El lead de la fila 2 tiene S/ 3.500 asentados y todavía no se ganó: es un
   * acuerdo, no facturación. Sumado con las ventas cerradas en una sola
   * columna daba los S/ 40.600 que el reporte del 10/11/2026 presentaba como
   * contratos, siendo S/ 25.800 de ellos acuerdos sin un solo cobro.
   */
  assert.equal(cell(2, 'Registrado de venta ganada (PEN)'), 0);
  assert.equal(cell(2, 'Cuota pactada sin cerrar (PEN)'), 3500);
  // El total sigue publicándose: lo que cambia es que ya no es la única cifra.
  assert.equal(cell(2, 'Registrado, incl. por cobrar (PEN)'), 3500);
});

test('la cita que no tiene reunión detrás queda marcada', async () => {
  const { cell } = await trailSheet();

  /*
   * Es lo que explica la diferencia entre las 43 citas que contaba la etapa y
   * las 36 que tenían fecha: sin esta columna, la resta parece un error del
   * reporte y no una cita que nadie puede ir a buscar en una agenda.
   */
  assert.equal(cell(3, 'Cita sin reunión registrada'), 'Sí');
  assert.equal(cell(2, 'Cita sin reunión registrada'), '-');
});

test('la fecha de ingreso y la de cierre viajan como fechas', async () => {
  const { cell } = await trailSheet();

  assert.ok(cell(2, 'Fecha de ingreso') instanceof Date);
  assert.ok(cell(2, 'Fecha de cierre') instanceof Date);
  assert.equal(cell(3, 'Fecha de cierre'), null, 'una venta que no cerró no tiene fecha');
});

test('el filtro de campañas de la pantalla no esconde a los leads sin campaña', async () => {
  const { sheet } = await trailSheet({ campaignIds: [1] });
  // Los dos leads sin campaña del CRM se conservan: no pertenecen a ninguna,
  // así que ningún filtro por campaña debería hacerlos desaparecer.
  assert.equal(sheet.rowCount, 4);
});
