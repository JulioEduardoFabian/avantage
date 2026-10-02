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

/** Respuestas de la Graph API por ruta, sin red. */
function stubGraph({ forms, leadsByForm }) {
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    const json = (body) => ({ ok: true, json: async () => body });

    if (path.endsWith('/me/accounts')) return json({ data: [{ id: 'PAGE_1', name: 'Avantage Group' }] });
    if (path.endsWith('/leadgen_forms')) return json({ data: forms });

    const formId = path.split('/').filter(Boolean).at(-2);
    if (path.endsWith('/leads')) return json({ data: leadsByForm[formId] || [] });

    throw new Error(`ruta no simulada: ${path}`);
  };
}

/** leadService mínimo: solo lo que toca la conciliación. */
function fakeLeadService(knownIds = []) {
  return {
    creados: [],
    async getKnownMetaLeadgenIds() {
      return new Set(knownIds.map(String));
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

  assert.deepEqual(report.by_platform.fb, { en_meta: 2, en_crm: 2, faltantes: 0, importados: 0 });
  assert.deepEqual(report.by_platform.ig, { en_meta: 2, en_crm: 0, faltantes: 2, importados: 0 });
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
