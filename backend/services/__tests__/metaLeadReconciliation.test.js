import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MetaLeadReconciliationService } from '../metaLeadReconciliationService.js';

/**
 * El 39% de los leads de los formularios de Meta de septiembre nunca llegó al
 * CRM (95 en el Administrador de anuncios contra 58 en la base), y no quedó
 * rastro de por qué: el webhook responde 200 antes de procesar, así que un
 * fallo posterior no se reintenta y solo deja una línea en un log que se rota.
 *
 * La conciliación es la respuesta a eso, y lo que estas pruebas fijan es lo
 * que la hace confiable: que no vuelva a importar lo que ya está (incluidos
 * los leads viejos, que tienen el id solo en las notas), que separe el conteo
 * por plataforma —la pista de dónde se pierden— y que comparar no escriba.
 */

const originalFetch = globalThis.fetch;

/**
 * Respuestas de la Graph API por ruta, sin red. `apps` es la suscripción al
 * webhook de la Página; sin pasarla, esa ruta no se simula y la conciliación
 * tiene que seguir funcionando igual (el estado queda en "desconocido"), que
 * es lo que pasa cuando al token le falta `pages_manage_metadata`.
 */
function stubGraph({ forms, leadsByForm, apps = null }) {
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    const json = (body) => ({ ok: true, json: async () => body });

    if (path.endsWith('/me/accounts')) return json({ data: [{ id: 'PAGE_1', name: 'Avantage Group' }] });
    if (path.endsWith('/subscribed_apps')) {
      if (!apps) throw new Error('sin permiso para leer la suscripción');
      return json({ data: apps });
    }
    if (path.endsWith('/leadgen_forms')) return json({ data: forms });

    const formId = path.split('/').filter(Boolean).at(-2);
    if (path.endsWith('/leads')) return json({ data: leadsByForm[formId] || [] });

    throw new Error(`ruta no simulada: ${path}`);
  };
}

/**
 * leadService mínimo: solo lo que toca la conciliación. `idsConAnuncio` son
 * los leads que además guardaron su `meta_ad_id`; por defecto son todos los
 * conocidos, porque lo que entra por el webhook lo trae.
 */
function fakeLeadService(knownIds = [], knownFormIds = [], idsConAnuncio = knownIds) {
  return {
    creados: [],
    async getKnownMetaLeadgenIds() {
      return new Set(knownIds.map(String));
    },
    async getMetaLeadgenIdsWithAd() {
      return new Set(idsConAnuncio.map(String));
    },
    async getKnownMetaFormIds() {
      return knownFormIds;
    },
    adjuntados: [],
    // Por defecto ningun telefono existe todavia; los tests que necesitan el
    // cruce lo sobreescriben.
    async findByPhone() {
      return null;
    },
    async attachMetaLeadToExisting(lead, datos) {
      this.adjuntados.push({ leadId: lead.id, datos });
      return lead;
    },
    async createProspect(data) {
      this.creados.push(data);
      return { id: 900 + this.creados.length };
    }
  };
}

const lead = (id, platform, createdTime) => ({
  id,
  created_time: createdTime,
  platform,
  form_id: 'F1',
  field_data: [
    { name: 'full_name', values: ['Persona ' + id] },
    { name: 'phone_number', values: ['+51 987 654 3' + String(id).slice(-2)] }
  ]
});

beforeEach(() => {
  process.env.META_PAGE_ACCESS_TOKEN = 'token-de-prueba';
  process.env.META_PAGE_ID = 'PAGE_1';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.META_PAGE_ID;
});

test('comparar no escribe nada, solo reporta lo que falta', async () => {
  stubGraph({
    forms: [{ id: 'F1', name: 'Bachiller', status: 'ACTIVE' }],
    leadsByForm: { F1: [lead('11', 'fb', '2026-09-20T10:00:00+0000'), lead('22', 'ig', '2026-09-20T11:00:00+0000')] }
  });
  const leadService = fakeLeadService(['11']);

  const report = await new MetaLeadReconciliationService(leadService).reconcile({ apply: false });

  assert.equal(report.totals.en_meta, 2);
  assert.equal(report.totals.en_crm, 1);
  assert.equal(report.totals.faltantes, 1);
  assert.equal(report.totals.importados, 0);
  // Lo esencial: un "comparar" no puede dar de alta a nadie.
  assert.deepEqual(leadService.creados, []);
});

test('recuperar importa solo los que faltan y no duplica los que ya están', async () => {
  stubGraph({
    forms: [{ id: 'F1', name: 'Bachiller', status: 'ACTIVE' }],
    leadsByForm: { F1: [lead('11', 'fb', '2026-09-20T10:00:00+0000'), lead('22', 'ig', '2026-09-20T11:00:00+0000')] }
  });
  const leadService = fakeLeadService(['11']);

  const report = await new MetaLeadReconciliationService(leadService).reconcile({ apply: true });

  assert.equal(report.totals.importados, 1);
  assert.equal(leadService.creados.length, 1);
  assert.equal(leadService.creados[0].metaLeadgenId, '22');
  // La atribución viaja a columnas propias, que es lo que permite contestar
  // "¿cuántos leads trajo este anuncio?" sin exportar el CSV a mano.
  assert.equal(leadService.creados[0].metaFormId, 'F1');
  assert.equal(leadService.creados[0].metaPlatform, 'ig');
  // Y entra al Setter Funnel, no al funnel comercial: llenó un formulario,
  // todavía no habló con nadie.
  assert.equal(leadService.creados[0].status, 'conversacion_abierta');
});

test('el desglose por plataforma dice de dónde se pierden los leads', async () => {
  stubGraph({
    forms: [{ id: 'F1', name: 'Bachiller', status: 'ACTIVE' }],
    leadsByForm: {
      F1: [
        lead('1', 'fb', '2026-09-20T10:00:00+0000'),
        lead('2', 'fb', '2026-09-20T10:05:00+0000'),
        lead('3', 'ig', '2026-09-20T10:10:00+0000'),
        lead('4', 'ig', '2026-09-20T10:15:00+0000')
      ]
    }
  });
  // Facebook llegó entero; de Instagram no llegó nada.
  const report = await new MetaLeadReconciliationService(fakeLeadService(['1', '2'])).reconcile({ apply: false });

  assert.deepEqual(report.by_platform.fb, { en_meta: 2, en_crm: 2, faltantes: 0, importados: 0, adjuntados: 0 });
  assert.deepEqual(report.by_platform.ig, { en_meta: 2, en_crm: 0, faltantes: 2, importados: 0, adjuntados: 0 });
});

test('el rango se mide por la fecha de envío en Meta, no por la de alta en el CRM', async () => {
  stubGraph({
    forms: [{ id: 'F1', name: 'Bachiller', status: 'ACTIVE' }],
    leadsByForm: {
      F1: [
        lead('viejo', 'fb', '2026-08-31T23:00:00+0000'),
        lead('dentro', 'fb', '2026-09-15T12:00:00+0000'),
        lead('nuevo', 'fb', '2026-10-05T01:00:00+0000')
      ]
    }
  });

  const report = await new MetaLeadReconciliationService(fakeLeadService())
    .reconcile({ since: '2026-09-01', until: '2026-09-30', apply: false });

  assert.equal(report.totals.en_meta, 1);
  assert.equal(report.forms[0].ejemplos_faltantes[0].leadgen_id, 'dentro');
});

test('un formulario que falla no tumba la conciliación de los demás', async () => {
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/me/accounts')) return { ok: true, json: async () => ({ data: [{ id: 'PAGE_1' }] }) };
    if (path.endsWith('/leadgen_forms')) {
      return { ok: true, json: async () => ({ data: [{ id: 'ROTO' }, { id: 'F1', name: 'Bachiller' }] }) };
    }
    if (path.includes('/ROTO/')) {
      return { ok: false, json: async () => ({ error: { code: 10, message: 'sin permiso' } }) };
    }
    return { ok: true, json: async () => ({ data: [lead('33', 'fb', '2026-09-20T10:00:00+0000')] }) };
  };

  const report = await new MetaLeadReconciliationService(fakeLeadService()).reconcile({ apply: false });

  assert.equal(report.errores.length, 1);
  assert.equal(report.errores[0].form_id, 'ROTO');
  // El formulario sano se contó igual.
  assert.equal(report.totals.faltantes, 1);
});

test('sin token no se consulta nada', async () => {
  process.env.META_PAGE_ACCESS_TOKEN = '';
  await assert.rejects(
    () => new MetaLeadReconciliationService(fakeLeadService()).reconcile({}),
    /META_PAGE_ACCESS_TOKEN/
  );
});

test('si Meta no deja listar los formularios, se comparan los que ya están en la base', async () => {
  // `/{page_id}/leadgen_forms` exige pages_manage_ads; leer los leads de un
  // formulario, solo leads_retrieval. Quedarse sin conciliar por un permiso
  // que no hace falta para traer los leads sería perderlos por nada.
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/leadgen_forms')) {
      return { ok: false, json: async () => ({ error: { code: 200, message: 'Requires pages_manage_ads permission to manage the object' } }) };
    }
    return { ok: true, json: async () => ({ data: [lead('44', 'ig', '2026-09-20T10:00:00+0000')] }) };
  };

  const report = await new MetaLeadReconciliationService(fakeLeadService([], ['F1'])).reconcile({ apply: false });

  assert.equal(report.forms_source, 'crm');
  assert.match(report.aviso, /pages_manage_ads/);
  assert.equal(report.totals.faltantes, 1);
});

test('sin formularios conocidos en la base, el fallo de listado sí corta', async () => {
  // Acá no hay nada que conciliar y callar el error escondería el problema.
  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ error: { code: 200, message: 'Requires pages_manage_ads permission to manage the object' } })
  });

  await assert.rejects(
    () => new MetaLeadReconciliationService(fakeLeadService()).reconcile({ apply: false }),
    /pages_manage_ads/
  );
});

test('un envio de un telefono que ya es lead se cuelga de esa ficha, no abre otra', async () => {
  // Es lo que rompio las metricas de campana: la fila nueva nace en
  // "conversacion abierta" y, al indexar por telefono, tapaba a la que el
  // equipo venia trabajando — un contacto ganado desaparecia del tablero.
  stubGraph({
    forms: [{ id: 'F1', name: 'Bachiller', status: 'ACTIVE' }],
    leadsByForm: { F1: [lead('77', 'fb', '2026-09-20T10:00:00+0000')] }
  });
  const leadService = fakeLeadService();
  leadService.findByPhone = async () => ({ id: 42, status: 'ganado', additional_notes: null });

  const report = await new MetaLeadReconciliationService(leadService).reconcile({ apply: true });

  assert.deepEqual(leadService.creados, []);
  assert.equal(leadService.adjuntados.length, 1);
  assert.equal(leadService.adjuntados[0].leadId, 42);
  assert.equal(leadService.adjuntados[0].datos.leadgenId, '77');
  // Y se cuenta aparte: no es una persona nueva para trabajar.
  assert.equal(report.totals.importados, 0);
  assert.equal(report.totals.adjuntados, 1);
});

/*
 * Lo que sigue es la otra mitad de la comprobación que pide el equipo: no solo
 * "¿llegaron los mismos leads que registró Meta?" sino "¿cada uno con su
 * anuncio?", y antes de eso "¿Meta está avisando?". Las tres se contestan en el
 * mismo reporte porque la primera explica a las otras dos.
 */

test('el reporte dice si la Página está suscrita al campo leadgen', async () => {
  stubGraph({
    forms: [{ id: 'F1', name: 'Bachiller', status: 'ACTIVE' }],
    leadsByForm: { F1: [] },
    apps: [{ id: 'APP_1', name: 'CRM Avantage', subscribed_fields: ['leadgen', 'feed'] }]
  });

  const report = await new MetaLeadReconciliationService(fakeLeadService()).reconcile({ apply: false });
  assert.equal(report.suscripcion.estado, 'conectado');
  assert.equal(report.suscripcion.leadgen, true);
});

test('sin leadgen suscrito lo dice, que es la causa de que no llegue ninguno', async () => {
  stubGraph({
    forms: [{ id: 'F1', name: 'Bachiller', status: 'ACTIVE' }],
    leadsByForm: { F1: [lead('11', 'fb', '2026-10-25T10:00:00+0000')] },
    apps: [{ id: 'APP_1', name: 'CRM Avantage', subscribed_fields: ['feed'] }]
  });

  const report = await new MetaLeadReconciliationService(fakeLeadService()).reconcile({ apply: false });
  assert.equal(report.suscripcion.estado, 'sin_leadgen');
  // Y el síntoma que esa causa explica: el lead está en Meta y no en el CRM.
  assert.equal(report.totals.faltantes, 1);
});

test('no poder leer la suscripción no tumba la conciliación', async () => {
  // Leerla exige pages_manage_metadata, que el token puede no tener; recuperar
  // los leads perdidos —que es para lo que existe esto— no lo necesita.
  stubGraph({
    forms: [{ id: 'F1', name: 'Bachiller', status: 'ACTIVE' }],
    leadsByForm: { F1: [lead('11', 'fb', '2026-10-25T10:00:00+0000')] }
  });

  const report = await new MetaLeadReconciliationService(fakeLeadService()).reconcile({ apply: false });
  assert.equal(report.suscripcion.estado, 'desconocido');
  assert.equal(report.totals.en_meta, 1);
});

test('un lead que está en el CRM pero sin su anuncio no cuenta como conciliado', async () => {
  /*
   * Es la ficha anterior a la columna de atribución: su leadgen_id está en las
   * notas pero nunca se le guardó el ad_id, así que no aparece en el reporte de
   * Campañas. Contarla solo en `en_crm` daría por cerrada una comparación que
   * no cerró; se arregla con el botón de completar datos del formulario.
   */
  stubGraph({
    forms: [{ id: 'F1', name: 'Bachiller', status: 'ACTIVE' }],
    leadsByForm: {
      F1: [lead('11', 'fb', '2026-10-25T10:00:00+0000'), lead('12', 'fb', '2026-10-25T11:00:00+0000')]
    }
  });

  // Los dos están en el CRM; solo el 12 tiene su anuncio.
  const report = await new MetaLeadReconciliationService(
    fakeLeadService(['11', '12'], [], ['12'])
  ).reconcile({ apply: false });

  assert.equal(report.totals.en_crm, 2);
  assert.equal(report.totals.faltantes, 0);
  assert.equal(report.totals.sin_anuncio, 1);
  assert.equal(report.forms[0].sin_anuncio, 1);
});

test('lo que la conciliación acaba de importar no se reporta como sin anuncio', async () => {
  // La Graph API manda el ad_id junto al lead y `persistMetaLead` lo guarda:
  // contarlo como incompleto en la misma corrida que lo completó mandaría a
  // revisar algo que ya está bien.
  stubGraph({
    forms: [{ id: 'F1', name: 'Bachiller', status: 'ACTIVE' }],
    leadsByForm: { F1: [{ ...lead('13', 'fb', '2026-10-25T10:00:00+0000'), ad_id: '120210000000123456' }] }
  });

  const report = await new MetaLeadReconciliationService(fakeLeadService()).reconcile({ apply: true });
  assert.equal(report.totals.importados, 1);
  assert.equal(report.totals.sin_anuncio, 0);
});

test('un formulario activo sin un solo lead en el CRM se señala aparte', async () => {
  // En una lista de treinta formularios (la mayoría viejos y vacíos) ese es el
  // que hay que ir a revisar, y se pierde entre los demás.
  stubGraph({
    forms: [
      { id: 'F1', name: 'FORM | Confianza | contrato | Jair | 25Oct', status: 'ACTIVE' },
      { id: 'F2', name: 'Formulario viejo', status: 'ARCHIVED' }
    ],
    leadsByForm: { F1: [lead('21', 'fb', '2026-10-25T10:00:00+0000')], F2: [] }
  });

  const report = await new MetaLeadReconciliationService(fakeLeadService()).reconcile({ apply: false });

  assert.equal(report.formularios_activos_sin_leads.length, 1);
  assert.equal(report.formularios_activos_sin_leads[0].form_id, 'F1');
  assert.equal(report.formularios_activos_sin_leads[0].en_meta, 1);
});

test('un formulario archivado y vacío no se señala: no es una falla', async () => {
  stubGraph({
    forms: [{ id: 'F2', name: 'Formulario viejo', status: 'ARCHIVED' }],
    leadsByForm: { F2: [] }
  });

  const report = await new MetaLeadReconciliationService(fakeLeadService()).reconcile({ apply: false });
  assert.deepEqual(report.formularios_activos_sin_leads, []);
});
