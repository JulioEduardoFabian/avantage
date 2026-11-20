import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { CampaignExportService } from '../campaignExportService.js';

/**
 * El valor de la exportación está en que las columnas calcen exactamente con
 * el informe que exporta el Administrador de anuncios de Meta: así el archivo
 * se puede comparar o pegar sobre uno descargado de ahí. Estas pruebas fijan
 * ese orden y comprueban que los valores llegan con el tipo correcto (fechas
 * como fecha, importes como número), no como texto.
 */

/** Las 30 columnas del informe de anuncios de Meta, en su orden exacto. */
const COLUMNAS_META = [
  'Inicio del informe', 'Fin del informe', 'Nombre del anuncio', 'Entrega de anuncios',
  'Configuración de atribución', 'Resultados', 'Indicador de resultado', 'Alcance', 'Frecuencia',
  'Coste por resultados', 'Presupuesto del conjunto de anuncios',
  'Tipo de presupuesto del conjunto de anuncios', 'Importe gastado (PEN)', 'Fin',
  'Clasificación por calidad', 'Clasificación por tasas de interacción',
  'Clasificación por tasa de conversión', 'Impresiones', 'CPM (coste por 1000 impresiones) (PEN)',
  'Clics en el enlace', 'shop_clicks', 'CPC (Coste por clic en el enlace) (PEN)',
  'CTR (tasa de clics en el enlace)', 'Clics (todos)', 'CTR (todos)', 'CPC (todos) (PEN)',
  'Visitas a la página de destino', 'Coste por visita a la página de destino (PEN)',
  'Resultados (iniciales)', 'Indicador de resultados (inicial)'
];

/**
 * Las 21 columnas de la hoja de atribución, en su orden exacto.
 *
 * Desde el 01/11/2026 los cinco desenlaces del funnel van separados —agendada,
 * asistida, cotizada, ganada y cobrada—. Antes agendada y asistida eran una
 * sola columna, así que un anuncio que trae gente que agenda y no aparece se
 * leía exactamente igual que uno que trae gente que se presenta; y 'cerrada'
 * se confundía con 'cobrada', que es lo verificado en Finanzas.
 */
const COLUMNAS_ATRIBUCION = [
  'Campaña', 'ID del conjunto de anuncios', 'Conjunto de anuncios', 'ID del anuncio', 'Anuncio',
  'Inversión (PEN)', 'Impresiones', 'Clics en el enlace', 'CTR del enlace (%)', 'Leads generados',
  'Costo por lead (PEN)', 'Leads sin respuesta', 'Citas agendadas', 'Citas asistidas',
  'Leads en cotización', 'Leads en seguimiento', 'Leads descartados', 'Ventas cerradas',
  'Leads cobrados',
  // Las cuatro cifras de dinero separadas: lo propuesto, lo de ventas ya
  // ganadas, lo de acuerdos sin cerrar y lo cobrado. Antes eran dos, y la
  // segunda mezclaba ventas con acuerdos.
  'Leads con cotización', 'Valor cotizado (PEN)',
  'Registrado de ventas ganadas (PEN)', 'Cuota pactada sin cerrar (PEN)',
  'Ingreso cobrado (PEN)',
  'Ingreso registrado, incl. cuotas por cobrar (PEN)', 'ROAS real (CRM, sobre cobrado)',
  'Contactos sin ficha en el CRM', 'Leads con pieza desconocida'
];

function campaignFixture() {
  return {
    campaigns: [
      {
        id: 1,
        name: 'Ingeniería Civil — Lima Norte',
        platform: 'instagram',
        objective: 'OUTCOME_LEADS',
        status: 'activa',
        source: 'meta',
        currency: 'PEN',
        startDate: '2026-08-01',
        endDate: null,
        lastSyncedAt: '2026-09-17T14:03:00.000Z',
        metrics: {
          metaSpend: 850.12, spend: 850.12, impressions: 12500, reach: 9800, frequency: 1.28,
          clicks: 430, ctr: 3.44, cpc: 1.98, cpm: 68, linkClicks: 310, linkCtr: 2.48,
          costPerLinkClick: 2.74, landingPageViews: 180, costPerLandingPageView: 4.72,
          shopClicks: 7, metaResults: 64, metaResultIndicator: 'Conversaciones con mensajes iniciadas',
          metaCostPerResult: 13.28, attributionSetting: '7d_click_1d_view',
          reportStart: '2026-08-19', reportStop: '2026-09-17', metaMessagingStarted: 64,
          // 58 conversaciones atribuidas, de las que 47 trajeron a alguien que
          // NO estaba en la base: sin ese tercer nivel, un anuncio de
          // retargeting se lee tan eficiente como uno que trae gente nueva.
          conversations: 58, newOpportunities: 47,
          responded: 55, qualified: 31, appointments: 12, won: 4, lost: 9,
          qualificationRate: 53.4, conversationToAppointmentRate: 20.7, appointmentToWonRate: 33.3,
          avgViability: 72, medianFirstResponseMin: 3.5, costPerConversation: 14.66,
          costPerAppointment: 70.84, costPerWon: 212.53, quotedValue: 9600, roas: 11.29
        },
        metaAds: [
          {
            adId: '1', adName: 'Video testimonial — asesoría de tesis',
            adsetId: '11', adsetName: 'Lima Norte 22-35',
            delivery: 'ACTIVE', adsetBudget: 50, adsetBudgetType: 'diario', endTime: null,
            qualityRanking: 'above_average', engagementRanking: 'average',
            conversionRanking: 'below_average_20', impressions: 8200, reach: 6400, frequency: 1.28,
            spend: 560.4, clicks: 280, ctr: 3.41, cpc: 2, cpm: 68.34, linkClicks: 205, linkCtr: 2.5,
            costPerLinkClick: 2.73, landingPageViews: 120, costPerLandingPageView: 4.67, shopClicks: 4,
            messagingStarted: 44, results: 44, resultIndicator: 'Conversaciones con mensajes iniciadas',
            costPerResult: 12.74, attributionSetting: '7d_click_1d_view',
            dateStart: '2026-08-19', dateStop: '2026-09-17'
          },
          {
            adId: '2', adName: 'Carrusel — planes y precios', adsetId: null, adsetName: null, delivery: 'PAUSED',
            adsetBudget: null, adsetBudgetType: null, endTime: '2026-09-30',
            qualityRanking: 'unknown', engagementRanking: null, conversionRanking: null,
            impressions: 4300, reach: 3400, frequency: 1.26, spend: 289.72, clicks: 150, ctr: 3.49,
            cpc: 1.93, cpm: 67.38, linkClicks: 105, linkCtr: 2.44, costPerLinkClick: 2.76,
            landingPageViews: 60, costPerLandingPageView: 4.83, shopClicks: 3, messagingStarted: 20,
            results: 20, resultIndicator: 'Conversaciones con mensajes iniciadas', costPerResult: 14.49,
            attributionSetting: '7d_click_1d_view', dateStart: '2026-08-19', dateStop: '2026-09-17'
          },
          {
            // Gastó presupuesto y no trajo ni un lead: no tiene grupo en
            // `adBreakdown` y debe salir igual, al final del ranking.
            adId: '3', adName: 'Imagen estática — beca 2026', adsetId: '12',
            adsetName: 'Retargeting visitantes', delivery: 'ACTIVE', adsetBudget: 20,
            adsetBudgetType: 'diario', endTime: null, qualityRanking: null,
            engagementRanking: null, conversionRanking: null, impressions: 3000, reach: 2600,
            frequency: 1.15, spend: 120.5, clicks: 55, ctr: 1.83, cpc: 2.19, cpm: 40.17,
            linkClicks: 40, linkCtr: 1.33, costPerLinkClick: 3.01, landingPageViews: 12,
            costPerLandingPageView: 10.04, shopClicks: 0, messagingStarted: 0, results: 0,
            resultIndicator: 'Conversaciones con mensajes iniciadas', costPerResult: null,
            attributionSetting: '7d_click_1d_view', dateStart: '2026-08-19', dateStop: '2026-09-17'
          }
        ],
        adBreakdown: [
          {
            key: 'ad:1', adId: '1', adName: 'Video testimonial — asesoría de tesis',
            adsetId: '11', adsetName: 'Lima Norte 22-35', adSourceId: '1', headline: null,
            leads: 41, responded: 39, qualified: 25, appointments: 10,
            // De las 10 citas agendadas solo 7 ocurrieron: esa brecha es la
            // calidad del público, y se perdía con las dos en una columna.
            attended: 7, collected: 3,
            quotation: 6, followUp: 27, discarded: 4, won: 4,
            paidRevenue: 9600, billedRevenue: 12000, quotedValue: 9600
          },
          {
            key: 'ad:2', adId: '2', adName: 'Carrusel — planes y precios',
            adsetId: null, adsetName: null, adSourceId: '2', headline: null,
            leads: 14, responded: 12, qualified: 5, appointments: 2,
            quotation: 0, followUp: 8, discarded: 6, won: 0,
            paidRevenue: 0, billedRevenue: 0, quotedValue: 0
          },
          {
            // El anuncio ya no existe en Meta pero sus leads —y su venta— sí.
            key: 'src:9001', adId: null, adName: null, adsetId: null, adsetName: null,
            adSourceId: '9001', headline: 'Post antiguo — promo julio',
            leads: 3, responded: 3, qualified: 2, appointments: 2,
            quotation: 1, followUp: 1, discarded: 0, won: 1,
            paidRevenue: 2500, billedRevenue: 3000, quotedValue: 2500
          }
        ]
      },
      {
        id: 2, name: 'Campaña manual sin Meta', platform: 'whatsapp', objective: null,
        status: 'pausada', source: 'manual', currency: 'PEN', startDate: null, endDate: null,
        lastSyncedAt: null,
        metrics: {
          metaSpend: null, spend: 300, impressions: null, reach: null, frequency: null, clicks: null,
          ctr: null, cpc: null, cpm: null, linkClicks: null, linkCtr: null, costPerLinkClick: null,
          landingPageViews: null, costPerLandingPageView: null, shopClicks: null, metaResults: null,
          metaResultIndicator: null, metaCostPerResult: null, attributionSetting: null,
          reportStart: null, reportStop: null, metaMessagingStarted: null,
          conversations: 5, responded: 4, qualified: 2, appointments: 1, won: 0, lost: 1,
          qualificationRate: 40, conversationToAppointmentRate: 20, appointmentToWonRate: 0,
          avgViability: null, medianFirstResponseMin: null, costPerConversation: 60,
          costPerAppointment: 300, costPerWon: null, quotedValue: 0, roas: null
        },
        metaAds: [],
        adBreakdown: [
          {
            key: 'src:7777', adId: null, adName: null, adsetId: null, adsetName: null,
            adSourceId: '7777', headline: 'Enlace directo a WhatsApp',
            leads: 5, responded: 4, qualified: 2, appointments: 1,
            quotation: 2, followUp: 2, discarded: 1, won: 0,
            paidRevenue: 0, billedRevenue: 0, quotedValue: 0
          }
        ]
      }
    ]
  };
}

/** Escribe el libro a disco y lo vuelve a leer, como haría Excel al abrirlo. */
async function buildAndReopen(options = {}) {
  const service = new CampaignExportService({
    campaignService: { async getPerformance() { return campaignFixture(); } }
  });
  const { workbook, filename } = await service.buildWorkbook(options);

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-export-')), filename);
  await workbook.xlsx.writeFile(file);
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.readFile(file);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });

  return { workbook: reopened, filename };
}

function headersOf(sheet) {
  return sheet.getRow(1).values.slice(1);
}

test('la hoja de anuncios reproduce las columnas del informe de Meta en orden', async () => {
  const { workbook } = await buildAndReopen();
  const headers = headersOf(workbook.getWorksheet('Anuncios'));

  assert.deepEqual(headers.slice(0, COLUMNAS_META.length), COLUMNAS_META);
  // La campaña y el conjunto van al final para no alterar ese orden.
  assert.deepEqual(headers.slice(COLUMNAS_META.length), ['Campaña', 'Conjunto de anuncios']);
});

test('cada anuncio sale como una fila con sus valores traducidos', async () => {
  const { workbook } = await buildAndReopen();
  const sheet = workbook.getWorksheet('Anuncios');
  const headers = headersOf(sheet);
  const cell = (row, header) => sheet.getRow(row).getCell(headers.indexOf(header) + 1).value;

  assert.equal(sheet.rowCount, 4, 'cabecera + 3 anuncios');
  assert.equal(cell(2, 'Nombre del anuncio'), 'Video testimonial — asesoría de tesis');
  assert.equal(cell(2, 'Entrega de anuncios'), 'activo');
  assert.equal(cell(3, 'Entrega de anuncios'), 'en pausa');
  assert.equal(cell(2, 'Clasificación por calidad'), 'Por encima del promedio');
  assert.equal(cell(2, 'Clasificación por tasa de conversión'), 'Por debajo del promedio (20% inferior de los anuncios)');
  assert.equal(cell(2, 'Tipo de presupuesto del conjunto de anuncios'), 'Presupuesto diario');
  assert.equal(cell(2, 'Campaña'), 'Ingeniería Civil — Lima Norte');

  // Sin clasificación (o 'unknown') Meta escribe un guion, no un vacío.
  assert.equal(cell(3, 'Clasificación por calidad'), '-');
  assert.equal(cell(3, 'Clasificación por tasas de interacción'), '-');
});

test('los importes y conteos salen como números, no como texto', async () => {
  const { workbook } = await buildAndReopen();
  const sheet = workbook.getWorksheet('Anuncios');
  const headers = headersOf(sheet);
  const cell = (header) => sheet.getRow(2).getCell(headers.indexOf(header) + 1).value;

  assert.equal(cell('Resultados'), 44);
  assert.equal(cell('Coste por resultados'), 12.74);
  assert.equal(cell('Importe gastado (PEN)'), 560.4);
  assert.equal(cell('Impresiones'), 8200);
  assert.equal(cell('shop_clicks'), 4);
  assert.equal(cell('Visitas a la página de destino'), 120);
  assert.equal(sheet.getColumn(headers.indexOf('Importe gastado (PEN)') + 1).numFmt, '#,##0.00');
});

test('las fechas del informe no se desfasan un día por la zona horaria', async () => {
  const { workbook } = await buildAndReopen();
  const sheet = workbook.getWorksheet('Anuncios');
  const headers = headersOf(sheet);
  const inicio = sheet.getRow(2).getCell(headers.indexOf('Inicio del informe') + 1).value;

  assert.ok(inicio instanceof Date, 'debería ser una fecha de Excel, no texto');
  assert.equal(inicio.getFullYear(), 2026);
  assert.equal(inicio.getMonth(), 7); // agosto
  assert.equal(inicio.getDate(), 19);
});

test('las columnas de resultados iniciales quedan vacías (Meta no las expone)', async () => {
  const { workbook } = await buildAndReopen();
  const sheet = workbook.getWorksheet('Anuncios');
  const headers = headersOf(sheet);

  assert.equal(sheet.getRow(2).getCell(headers.indexOf('Resultados (iniciales)') + 1).value, null);
  assert.equal(sheet.getRow(2).getCell(headers.indexOf('Indicador de resultados (inicial)') + 1).value, null);
});

test('la hoja de campañas trae el agregado de Meta y el funnel del CRM', async () => {
  const { workbook } = await buildAndReopen();
  const sheet = workbook.getWorksheet('Campañas');
  const headers = headersOf(sheet);
  const cell = (row, header) => sheet.getRow(row).getCell(headers.indexOf(header) + 1).value;

  assert.equal(sheet.rowCount, 3, 'cabecera + 2 campañas');
  assert.equal(cell(2, 'Campaña'), 'Ingeniería Civil — Lima Norte');
  assert.equal(cell(2, 'Resultados'), 64);
  assert.equal(cell(2, 'Citas agendadas'), 12);
  // El ROAS se calcula sobre lo COBRADO y verificado, y el encabezado lo dice:
  // con el valor cotizado ahora completo (incluye el pipeline abierto), un
  // ROAS sobre cotizaciones premiaría al anuncio que nunca cierra ninguna.
  assert.equal(cell(2, 'ROAS (sobre cobrado)'), 11.29);
  // Una campaña manual no tiene métricas de Meta pero sí funnel propio.
  assert.equal(cell(3, 'Campaña'), 'Campaña manual sin Meta');
  assert.equal(cell(3, 'Impresiones'), null);
  assert.equal(cell(3, 'Conversaciones atribuidas (CRM)'), 5);
});

test('campaignIds limita la exportación a las campañas filtradas en pantalla', async () => {
  const { workbook } = await buildAndReopen({ campaignIds: [2] });

  assert.equal(workbook.getWorksheet('Campañas').rowCount, 2, 'cabecera + 1 campaña');
  // La campaña 2 no tiene anuncios: la hoja queda con la fila de aviso.
  const ads = workbook.getWorksheet('Anuncios');
  const headers = headersOf(ads);
  assert.equal(ads.rowCount, 2);
  assert.match(String(ads.getRow(2).getCell(headers.indexOf('Nombre del anuncio') + 1).value), /Sincronizar con Meta/);
});

test('la hoja de atribución trae las columnas de los tres bloques', async () => {
  const { workbook } = await buildAndReopen();

  /*
   * Primero va "Cómo leer este libro" y después la atribución. El libro se
   * compara a diario contra el Administrador de anuncios y contra la planilla
   * de marketing, y las tres fuentes cuentan cosas distintas con los mismos
   * nombres: qué universo cuenta cada cifra y hasta cuándo llegan los datos de
   * cada lado es lo primero que hay que leer, no un anexo al final.
   */
  assert.equal(workbook.worksheets[0].name, 'Cómo leer este libro');
  assert.equal(workbook.worksheets[1].name, 'Atribución anuncio → venta',
    'la hoja de trabajo va inmediatamente después');
  assert.deepEqual(headersOf(workbook.getWorksheet('Atribución anuncio → venta')), COLUMNAS_ATRIBUCION);
});

test('cada fila es la combinación campaña > conjunto > anuncio', async () => {
  const { workbook } = await buildAndReopen();
  const sheet = workbook.getWorksheet('Atribución anuncio → venta');
  const headers = headersOf(sheet);
  const cell = (row, header) => sheet.getRow(row).getCell(headers.indexOf(header) + 1).value;

  assert.equal(cell(2, 'Campaña'), 'Ingeniería Civil — Lima Norte');
  assert.equal(cell(2, 'ID del conjunto de anuncios'), '11');
  assert.equal(cell(2, 'Conjunto de anuncios'), 'Lima Norte 22-35');
  assert.equal(cell(2, 'ID del anuncio'), '1');
  assert.equal(cell(2, 'Anuncio'), 'Video testimonial — asesoría de tesis');
});

test('el ranking baja por ingreso, ventas, cotizaciones y leads', async () => {
  const { workbook } = await buildAndReopen();
  const sheet = workbook.getWorksheet('Atribución anuncio → venta');
  const headers = headersOf(sheet);
  const col = (header) => headers.indexOf(header) + 1;
  const columna = (header) => sheet.getRows(2, sheet.rowCount - 1).map((r) => r.getCell(col(header)).value);

  assert.equal(sheet.rowCount, 6, 'cabecera + 3 anuncios de Meta + 2 grupos sin anuncio');
  assert.deepEqual(columna('Anuncio'), [
    'Video testimonial — asesoría de tesis', // 9600 cobrados
    'Post antiguo — promo julio',            // 2500 cobrados
    'Enlace directo a WhatsApp',             // sin ingreso, pero 2 en cotización
    'Carrusel — planes y precios',           // sin ingreso ni cotizaciones, 14 leads
    'Imagen estática — beca 2026'            // gastó sin traer un solo lead
  ]);
  assert.deepEqual(columna('Ingreso cobrado (PEN)'), [9600, 2500, 0, 0, 0]);
});

test('el funnel del CRM se reparte en cajones excluyentes que suman los leads', async () => {
  const { workbook } = await buildAndReopen();
  const sheet = workbook.getWorksheet('Atribución anuncio → venta');
  const headers = headersOf(sheet);
  const cell = (row, header) => sheet.getRow(row).getCell(headers.indexOf(header) + 1).value;

  const etapas = ['Leads en cotización', 'Leads en seguimiento', 'Leads descartados', 'Ventas cerradas'];
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    const suma = etapas.reduce((total, header) => total + cell(row, header), 0);
    assert.equal(suma, cell(row, 'Leads generados'), 'las etapas deben sumar los leads de la fila ' + row);
  }

  assert.equal(cell(2, 'Leads en cotización'), 6);
  assert.equal(cell(2, 'Leads descartados'), 4);
  assert.equal(cell(2, 'Ventas cerradas'), 4);
  assert.equal(cell(2, 'Ingreso registrado, incl. cuotas por cobrar (PEN)'), 12000);
});

test('ninguna columna declarada queda sin escribir', async () => {
  const { workbook } = await buildAndReopen();
  const sheet = workbook.getWorksheet('Atribución anuncio → venta');
  const headers = headersOf(sheet);
  const cell = (row, header) => sheet.getRow(row).getCell(headers.indexOf(header) + 1).value;

  /*
   * "Citas agendadas", "Citas asistidas" y "Leads cobrados" estaban declaradas
   * como columnas y nunca se llenaban, así que salían en blanco en TODAS las
   * filas del libro que se reporta: una columna vacía se lee como un cero, y
   * con eso ningún anuncio parecía haber traído una sola cita. Es un fallo que
   * no rompe nada y que solo se ve mirando el archivo.
   */
  assert.equal(cell(2, 'Citas agendadas'), 10);
  assert.equal(cell(2, 'Citas asistidas'), 7);
  assert.equal(cell(2, 'Leads cobrados'), 3);

  // Y el mismo descuido en la hoja de campañas, con el nivel que separa la
  // conversación de la persona que NO estaba en la base.
  const campañas = workbook.getWorksheet('Campañas');
  const hc = headersOf(campañas);
  assert.equal(
    campañas.getRow(2).getCell(hc.indexOf('Personas nuevas (CRM)') + 1).value,
    47
  );
});

test('el costo por lead y el ROAS se calculan con la inversión del anuncio', async () => {
  const { workbook } = await buildAndReopen();
  const sheet = workbook.getWorksheet('Atribución anuncio → venta');
  const headers = headersOf(sheet);
  const cell = (row, header) => sheet.getRow(row).getCell(headers.indexOf(header) + 1).value;

  assert.equal(cell(2, 'Inversión (PEN)'), 560.4);
  assert.equal(cell(2, 'Costo por lead (PEN)'), 13.67);  // 560.40 / 41
  assert.equal(cell(2, 'ROAS real (CRM, sobre cobrado)'), 17.13);       // 9600 / 560.40

  // Sin leads no hay costo por lead, y sin ingreso no hay ROAS: la celda va
  // vacía en vez de mostrar un 0 que se leería como "cuesta 0".
  assert.equal(cell(6, 'Leads generados'), 0);
  assert.equal(cell(6, 'Costo por lead (PEN)'), null);
  assert.equal(cell(6, 'ROAS real (CRM, sobre cobrado)'), null);
  assert.equal(cell(6, 'Inversión (PEN)'), 120.5);
});

test('un anuncio que ya no está en Meta conserva sus leads bajo el id del referral', async () => {
  const { workbook } = await buildAndReopen();
  const sheet = workbook.getWorksheet('Atribución anuncio → venta');
  const headers = headersOf(sheet);
  const cell = (row, header) => sheet.getRow(row).getCell(headers.indexOf(header) + 1).value;

  assert.equal(cell(3, 'ID del anuncio'), '9001', 'cae al source_id del referral');
  assert.equal(cell(3, 'Anuncio'), 'Post antiguo — promo julio');
  assert.equal(cell(3, 'Ventas cerradas'), 1);
  // No hay métricas de Meta para él: la inversión queda vacía, no en cero.
  assert.equal(cell(3, 'Inversión (PEN)'), null);
  assert.equal(cell(3, 'ROAS real (CRM, sobre cobrado)'), null);
});

test('el archivo se nombra con la fecha de generación', async () => {
  const { filename } = await buildAndReopen();
  assert.match(filename, /^campanas-meta-ads-\d{4}-\d{2}-\d{2}\.xlsx$/);
});
