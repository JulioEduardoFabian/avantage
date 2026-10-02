import { LeadService } from './leadService.js';
import { META_LEAD_FIELDS, persistMetaLead } from './metaWebhookService.js';

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/**
 * Conciliación de leads de Meta Lead Ads: le pregunta a la Graph API qué
 * leads tiene CADA formulario y los compara contra los que llegaron al CRM.
 *
 * Existe porque el webhook es hoy el único camino de entrada y es un punto
 * único de falla silencioso: `/api/webhooks/meta` responde 200 ANTES de
 * procesar (para no hacer esperar a Meta), así que un fallo posterior —token
 * sin alcance de página, error de la Graph API, reinicio de Passenger a mitad
 * del fetch— pierde el lead sin reintento y sin dejar más rastro que una línea
 * en un log que se rota. Comparando contra la fuente se ve cuántos faltan, de
 * qué formulario y de qué plataforma, y se recuperan.
 *
 * Meta conserva los leads de un formulario 90 días: pasado ese plazo lo que no
 * se concilió se perdió de verdad, así que esto es un botón y no solo un
 * script de mantenimiento.
 */
export class MetaLeadReconciliationService {
  constructor(leadService = new LeadService()) {
    this.leadService = leadService;
    this.cachedPageId = null;
  }

  get token() {
    return process.env.META_PAGE_ACCESS_TOKEN || '';
  }

  async graph(path, params = {}) {
    const url = new URL(path.startsWith('http') ? path : `${GRAPH_BASE}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', this.token);

    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) {
      const error = data?.error || {};
      throw new Error(`Graph API ${error.code || response.status}: ${error.message || 'error desconocido'}`);
    }
    return data;
  }

  /**
   * El id de la página dueña de los formularios. `META_PAGE_ID` lo evita, pero
   * si no está se resuelve por `/me/accounts`, que es una llamada a nivel de
   * actor y por eso funciona incluso con un token de usuario de sistema (las
   * de alcance de página, en cambio, exigen un token de página).
   */
  async resolvePageId() {
    if (process.env.META_PAGE_ID) return process.env.META_PAGE_ID;
    if (this.cachedPageId) return this.cachedPageId;

    const data = await this.graph('me/accounts', { fields: 'id,name' });
    const page = (data.data || [])[0];
    if (!page?.id) {
      throw new Error('No se pudo resolver la página: /me/accounts no devolvió ninguna. Definí META_PAGE_ID.');
    }
    this.cachedPageId = page.id;
    return page.id;
  }

  /**
   * Los formularios instantáneos de la página, incluidos los que hoy no tienen
   * ningún lead en el CRM — que son justamente los más sospechosos.
   */
  async listForms() {
    const pageId = await this.resolvePageId();
    const forms = [];
    let next = null;
    let pages = 0;

    do {
      const data = next
        ? await this.graph(next)
        : await this.graph(`${pageId}/leadgen_forms`, { fields: 'id,name,status', limit: PAGE_SIZE });
      forms.push(...(data.data || []));
      next = data.paging?.next || null;
    } while (next && ++pages < MAX_PAGES);

    return forms;
  }

  /** Todos los leads que Meta tiene registrados para un formulario. */
  async fetchFormLeads(formId) {
    const leads = [];
    let next = null;
    let pages = 0;

    do {
      const data = next
        ? await this.graph(next)
        : await this.graph(`${formId}/leads`, { fields: META_LEAD_FIELDS, limit: PAGE_SIZE });
      leads.push(...(data.data || []));
      next = data.paging?.next || null;
    } while (next && ++pages < MAX_PAGES);

    return leads;
  }

  /**
   * Compara Meta contra el CRM y, si `apply` es true, importa lo que falta.
   *
   * `since`/`until` acotan por `created_time` (el momento del envío en Meta) y
   * no por la fecha en que el lead entró al CRM: un lead recuperado hoy sigue
   * perteneciendo al día en que la persona llenó el formulario, y mezclar las
   * dos fechas es lo que haría que la comparación contra el Administrador de
   * anuncios no cerrara nunca.
   */
  async reconcile({ since = null, until = null, apply = false } = {}) {
    if (!this.token) {
      throw new Error('Falta META_PAGE_ACCESS_TOKEN en el entorno del servidor.');
    }

    const sinceTs = since ? Date.parse(`${since}T00:00:00.000Z`) : null;
    const untilTs = until ? Date.parse(`${until}T23:59:59.999Z`) : null;
    const inRange = (createdTime) => {
      const ts = Date.parse(createdTime);
      if (Number.isNaN(ts)) return true;
      if (sinceTs !== null && ts < sinceTs) return false;
      if (untilTs !== null && ts > untilTs) return false;
      return true;
    };

    const known = await this.leadService.getKnownMetaLeadgenIds();
    const forms = await this.listForms();

    const report = {
      page_id: await this.resolvePageId(),
      range: { since, until },
      applied: apply,
      forms: [],
      by_platform: {},
      totals: { en_meta: 0, en_crm: 0, faltantes: 0, importados: 0, fallidos: 0 },
      errores: []
    };

    for (const form of forms) {
      const row = {
        form_id: form.id,
        nombre: form.name || null,
        estado: form.status || null,
        en_meta: 0,
        en_crm: 0,
        faltantes: 0,
        importados: 0,
        fallidos: 0,
        ejemplos_faltantes: []
      };

      let metaLeads;
      try {
        metaLeads = await this.fetchFormLeads(form.id);
      } catch (error) {
        row.error = error.message;
        report.errores.push({ form_id: form.id, nombre: form.name || null, error: error.message });
        report.forms.push(row);
        continue;
      }

      for (const lead of metaLeads) {
        if (!inRange(lead.created_time)) continue;

        const platform = lead.platform || 'desconocida';
        report.by_platform[platform] ??= { en_meta: 0, en_crm: 0, faltantes: 0, importados: 0 };

        row.en_meta++;
        report.totals.en_meta++;
        report.by_platform[platform].en_meta++;

        if (known.has(String(lead.id))) {
          row.en_crm++;
          report.totals.en_crm++;
          report.by_platform[platform].en_crm++;
          continue;
        }

        row.faltantes++;
        report.totals.faltantes++;
        report.by_platform[platform].faltantes++;
        if (row.ejemplos_faltantes.length < 5) {
          row.ejemplos_faltantes.push({ leadgen_id: lead.id, created_time: lead.created_time, platform });
        }

        if (!apply) continue;

        try {
          const prospect = await persistMetaLead(this.leadService, lead);
          // Se marca como conocido en el acto: si el mismo leadgen_id volviera
          // a aparecer en esta misma corrida, no se duplica.
          known.add(String(lead.id));
          row.importados++;
          report.totals.importados++;
          report.by_platform[platform].importados++;
          console.log(`🔁 [Conciliación Meta] Lead ${lead.id} recuperado como prospecto #${prospect.id}.`);
        } catch (error) {
          row.fallidos++;
          report.totals.fallidos++;
          report.errores.push({ form_id: form.id, leadgen_id: lead.id, error: error.message });
          console.error(`❌ [Conciliación Meta] No se pudo importar el lead ${lead.id}:`, error);
        }
      }

      report.forms.push(row);
    }

    report.forms.sort((a, b) => b.faltantes - a.faltantes || b.en_meta - a.en_meta);
    return report;
  }
}
