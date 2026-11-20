import { LeadService } from './leadService.js';
import { META_LEAD_FIELDS, persistMetaLead } from './metaWebhookService.js';
import { extractMetaLeadForm } from './metaLeadFields.js';
import { PHONE_MATCH_KEY_SQL } from './leadService.js';
import { db } from '../db/connection.js';
import {
  BUCKETS,
  COMPARABILIDAD,
  classifySubmission,
  emptyBuckets,
  phoneKeyOf
} from './reconciliationBuckets.js';
import {
  BRIDGE_SCHEMAS,
  MINIMUM_ACCESS,
  bridgeEnvelope,
  pageCapNotice
} from './bridgeContract.js';

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/**
 * El campo del webhook del que cuelga TODO lo de los formularios: si la Página
 * no está suscrita a él, Meta no avisa de un solo lead nuevo.
 */
export const LEADGEN_FIELD = 'leadgen';

/**
 * Qué dice la lista de apps suscritas a la Página sobre si los leads de
 * formulario pueden llegar.
 *
 * La suscripción al webhook **no es por formulario**: se declara una vez, de la
 * app a la Página, y vale para todos sus formularios —los que ya existen y los
 * que el equipo cree mañana—. Por eso "revisar que estén suscritos todos los
 * formularios" se contesta acá y no formulario por formulario; lo que sí se
 * revisa de a uno es si cada formulario activo entregó sus leads, y eso es la
 * comparación que hace `reconcile()`.
 *
 * Es la causa más silenciosa de leads perdidos: sin `leadgen` suscrito no hay
 * error en ningún log —Meta simplemente no llama— y el CRM se ve igual que un
 * día sin campañas. Se reporta como `conectado | sin_leadgen | sin_apps` en vez
 * de un booleano porque las tres se arreglan distinto: la primera no se toca,
 * la segunda es agregar el campo a la suscripción que ya existe, y la tercera
 * es que la app nunca se suscribió a esta Página.
 *
 * Vive fuera de la clase y recibe la respuesta cruda para poder probarse sin
 * llamar a Meta.
 */
export function subscriptionState(apps = [], appId = null) {
  const lista = Array.isArray(apps) ? apps : [];
  if (!lista.length) {
    return {
      estado: 'sin_apps',
      leadgen: false,
      apps: [],
      detalle: 'Ninguna app está suscrita a los webhooks de esta Página, así que Meta no avisa de ningún lead nuevo. Hay que suscribir la app a la Página con el campo "leadgen".'
    };
  }

  const resumen = lista.map((app) => ({
    id: app.id ? String(app.id) : null,
    nombre: app.name || null,
    campos: Array.isArray(app.subscribed_fields) ? app.subscribed_fields : []
  }));

  /*
   * Si sabemos cuál es NUESTRA app se mira solo la suya: otra app suscrita a
   * `leadgen` sobre la misma Página recibe los leads en su propio webhook y no
   * en el nuestro, así que contarla como "conectado" diría que todo está bien
   * mientras los leads siguen sin entrar.
   */
  const propias = appId ? resumen.filter((app) => app.id === String(appId)) : resumen;
  if (appId && !propias.length) {
    return {
      estado: 'sin_apps',
      leadgen: false,
      apps: resumen,
      detalle: `La app ${appId} no figura entre las suscritas a esta Página (sí lo están: ${resumen.map((a) => a.nombre || a.id).join(', ')}). Los leads de formulario llegan al webhook de otra app, no al nuestro.`
    };
  }

  const conLeadgen = propias.filter((app) => app.campos.includes(LEADGEN_FIELD));
  if (!conLeadgen.length) {
    return {
      estado: 'sin_leadgen',
      leadgen: false,
      apps: resumen,
      detalle: `La app está suscrita a la Página pero sin el campo "leadgen" (tiene: ${propias.flatMap((a) => a.campos).join(', ') || 'ninguno'}). Meta no va a avisar de ningún lead de formulario hasta que se agregue.`
    };
  }

  return {
    estado: 'conectado',
    leadgen: true,
    apps: resumen,
    detalle: 'La Página está suscrita al campo "leadgen": Meta avisa de cada lead nuevo de cualquiera de sus formularios, incluidos los que se creen después.'
  };
}

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
   *
   * Si Meta no deja listarlos se cae a los `form_id` que ya figuran en la base.
   * No es un detalle de implementación: listar formularios exige
   * `pages_manage_ads` —un permiso de ADMINISTRACIÓN de la página— mientras
   * que leer los leads de un formulario solo pide `leads_retrieval`. Abortar
   * ahí dejaría sin recuperar leads que el token sí puede traer, por un
   * permiso que no hace falta para traerlos. El precio es que un formulario
   * que nunca entregó un lead al CRM queda fuera, y eso el reporte lo dice.
   */
  async listForms() {
    const pageId = await this.resolvePageId();
    const forms = [];
    let next = null;
    let pages = 0;

    try {
      do {
        const data = next
          ? await this.graph(next)
          : await this.graph(`${pageId}/leadgen_forms`, { fields: 'id,name,status', limit: PAGE_SIZE });
        forms.push(...(data.data || []));
        next = data.paging?.next || null;
      } while (next && ++pages < MAX_PAGES);

      /*
       * Quedó un `paging.next` y se acabaron las páginas permitidas: los
       * formularios que seguían no existen para esta comparación. Antes esto
       * no se decía en ninguna parte, así que sus leads no figuraban ni como
       * presentes ni como faltantes — y la conciliación devolvía un resultado
       * con pinta de completo.
       *
       * La Graph API pagina por cursor y no dice cuántas páginas hay, así que
       * el aviso se arma con `MAX_PAGES + 1` como "al menos una más": el
       * número exacto no se puede saber, y lo que importa es que falta.
       */
      const recortes = next
        ? [pageCapNotice({
          que: 'Formularios de la Página en Meta',
          paginasLeidas: pages,
          paginasTotales: pages + 1,
          tope: MAX_PAGES
        })].filter(Boolean)
        : [];

      return { forms, source: 'meta', aviso: null, recortes };
    } catch (error) {
      const knownIds = await this.leadService.getKnownMetaFormIds();
      if (!knownIds.length) throw error;

      console.warn(`⚠️ [Conciliación Meta] No se pudieron listar los formularios (${error.message}). Se usan los ${knownIds.length} que ya figuran en la base.`);
      return {
        forms: knownIds.map((id) => ({ id, name: null, status: null })),
        source: 'crm',
        aviso: `No se pudieron listar los formularios desde Meta (${error.message}). Se compararon los ${knownIds.length} que ya tienen al menos un lead en el CRM; un formulario que nunca entregó ninguno queda fuera de esta comparación. Agregá el permiso pages_manage_ads al token para cubrirlos todos.`,
        recortes: []
      };
    }
  }

  /**
   * Si Meta está avisando de los leads nuevos de esta Página.
   *
   * Un fallo acá no puede tumbar la conciliación: leer la suscripción exige
   * `pages_manage_metadata`, un permiso que el token puede no tener, y la
   * comparación de leads —que es lo que recupera lo perdido— funciona igual
   * sin esto. Por eso el error se devuelve como dato y no se lanza.
   */
  async checkSubscription() {
    try {
      const pageId = await this.resolvePageId();
      const data = await this.graph(`${pageId}/subscribed_apps`, { fields: 'id,name,subscribed_fields' });
      return subscriptionState(data.data || [], process.env.META_APP_ID || null);
    } catch (error) {
      return {
        estado: 'desconocido',
        leadgen: null,
        apps: [],
        detalle: `No se pudo leer la suscripción al webhook (${error.message}). Hace falta el permiso pages_manage_metadata en el token para comprobarla desde acá; mientras tanto se revisa en Meta > Configuración de la app > Webhooks > Página.`
      };
    }
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
  /**
   * Las fichas que ya existen para los teléfonos de un lote de envíos,
   * indexadas por los últimos 9 dígitos.
   *
   * Una consulta para todo el lote y no una por envío: esto corre sobre todos
   * los formularios de la cuenta en el barrido diario. Se queda con la ficha
   * más ANTIGUA de cada teléfono porque la pregunta es "¿esta persona ya
   * estaba?", y eso lo contesta la primera vez que entró.
   */
  async #existingByPhoneKey(metaLeads) {
    const keys = [...new Set(
      (metaLeads || [])
        .map((lead) => phoneKeyOf(extractMetaLeadForm(lead.field_data).phone))
        .filter(Boolean)
    )];
    if (!keys.length) return new Map();

    const rows = await db('leads')
      .select('id', 'created_at', 'phone')
      .whereRaw(`${PHONE_MATCH_KEY_SQL} IN (${keys.map(() => '?').join(', ')})`, keys)
      .orderBy('created_at', 'asc');

    const out = new Map();
    for (const row of rows) {
      const key = phoneKeyOf(row.phone);
      if (key && !out.has(key)) out.set(key, row);
    }
    return out;
  }

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

    const [known, withAd] = await Promise.all([
      this.leadService.getKnownMetaLeadgenIds(),
      this.leadService.getMetaLeadgenIdsWithAd()
    ]);
    const [{ forms, source, aviso, recortes = [] }, suscripcion] = await Promise.all([
      this.listForms(),
      this.checkSubscription()
    ]);

    const report = {
      page_id: await this.resolvePageId(),
      range: { since, until },
      applied: apply,
      forms_source: source,
      aviso,
      /*
       * Va en el mismo reporte y no en una pantalla aparte porque es la
       * primera pregunta que hay que hacerse cuando faltan leads: con
       * `leadgen` sin suscribir, "faltan 37" no es un fallo del webhook sino
       * que el webhook nunca se llamó, y la conciliación es lo único que los
       * trae mientras eso no se arregle.
       */
      suscripcion,
      /*
       * El sobre del puente: cuántos formularios hay, cuántos entraron en la
       * comparación, con qué límites y si algo quedó fuera. La Graph API pagina
       * por cursor y no dice el total, así que `total_filas` es lo que se pudo
       * leer: cuando el tope de páginas cortó el listado, el aviso lo dice con
       * todas las letras en vez de dejar un total que parece completo.
       */
      ...bridgeEnvelope({
        esquema: BRIDGE_SCHEMAS.metaReconciliation,
        totalFilas: forms.length,
        filas: forms.length,
        limites: {
          formularios_por_pagina: PAGE_SIZE,
          leads_por_pagina: PAGE_SIZE,
          paginas_max: MAX_PAGES
        },
        avisos: recortes
      }),
      acceso_minimo: MINIMUM_ACCESS,
      forms: [],
      by_platform: {},
      /*
       * `sin_anuncio` es la segunda mitad de "tienen que aparecer los mismos,
       * cada uno con su anuncio": un lead que entró pero sin `meta_ad_id` no
       * figura en el reporte de Campañas, así que contarlo solo en `en_crm`
       * daría por cerrada una comparación que no cerró. Se arregla con el
       * botón de completar datos del formulario, no volviendo a importar.
       */
      totals: {
        en_meta: 0, en_crm: 0, sin_anuncio: 0, faltantes: 0, importados: 0, adjuntados: 0, fallidos: 0,
        /*
         * Los cinco cajones del corte, con las MISMAS definiciones que la
         * importación de TikTok (`reconciliationBuckets.js`). Sin ellos, "faltan
         * 37" podía ser 37 leads perdidos o 12 duplicados + 9 reingresos + 6
         * formularios sin un dato de contacto + 10 entregados tarde, y tres de
         * esos cinco no se arreglan: están bien así. Compartir el módulo es lo
         * que permite comparar esta conciliación con la otra.
         */
        cajones: emptyBuckets()
      },
      comparabilidad: COMPARABILIDAD,
      errores: []
    };

    /*
     * De la CORRIDA y no del formulario: un mismo envío puede venir en dos
     * formularios y la misma persona puede haber llenado dos. Reiniciarlos por
     * formulario contaría el repetido como nuevo en el segundo.
     */
    const seenLeadIds = new Set();
    const seenPhoneKeys = new Set();
    const windowStart = sinceTs !== null ? new Date(sinceTs) : null;

    for (const form of forms) {
      const row = {
        form_id: form.id,
        nombre: form.name || null,
        estado: form.status || null,
        en_meta: 0,
        en_crm: 0,
        sin_anuncio: 0,
        faltantes: 0,
        importados: 0,
        adjuntados: 0,
        fallidos: 0,
        cajones: emptyBuckets(),
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

      /*
       * Las fichas que ya existen para los teléfonos de este formulario, en UNA
       * consulta. Distingue al reingreso —la persona que ya estaba ANTES del
       * corte y volvió a llenar el formulario— del alta nueva, que es la
       * diferencia que explica por qué el total de Meta es legítimamente mayor
       * que el de altas del CRM.
       */
      const fichasPorTelefono = await this.#existingByPhoneKey(metaLeads);

      for (const lead of metaLeads) {
        const respuestas = extractMetaLeadForm(lead.field_data);
        const phoneKey = phoneKeyOf(respuestas.phone);
        const cajon = classifySubmission(
          {
            platformLeadId: lead.id,
            phone: respuestas.phone,
            email: respuestas.email,
            createdTime: lead.created_time
          },
          {
            windowStart,
            seenLeadIds,
            seenPhoneKeys,
            existingLead: phoneKey ? fichasPorTelefono.get(phoneKey) || null : null
          }
        );

        /*
         * El envío anterior al corte se CUENTA y recién después se saltea.
         * Antes `inRange` lo descartaba en silencio, así que un formulario que
         * Meta entregó tarde no aparecía en ninguna cifra — y es justo el caso
         * que impide que el reporte cierre contra el Administrador de anuncios,
         * porque el lead pertenece al día en que la persona lo llenó.
         */
        if (cajon === BUCKETS.retrasado) {
          row.cajones[cajon]++;
          report.totals.cajones[cajon]++;
          continue;
        }
        if (!inRange(lead.created_time)) continue;

        row.cajones[cajon]++;
        report.totals.cajones[cajon]++;
        seenLeadIds.add(String(lead.id));
        if (phoneKey) seenPhoneKeys.add(phoneKey);

        // Un envío que Meta devolvió dos veces no se procesa dos veces: contarlo
        // como faltante infla la brecha que la conciliación viene a explicar.
        if (cajon === BUCKETS.duplicado) continue;

        const platform = lead.platform || 'desconocida';
        report.by_platform[platform] ??= { en_meta: 0, en_crm: 0, faltantes: 0, importados: 0, adjuntados: 0 };

        row.en_meta++;
        report.totals.en_meta++;
        report.by_platform[platform].en_meta++;

        if (known.has(String(lead.id))) {
          row.en_crm++;
          report.totals.en_crm++;
          report.by_platform[platform].en_crm++;
          // Está en el CRM, pero ¿con su anuncio? Las fichas anteriores a la
          // columna de atribución entraron sin él.
          if (!withAd.has(String(lead.id))) {
            row.sin_anuncio++;
            report.totals.sin_anuncio++;
          }
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
          const { lead: prospect, created } = await persistMetaLead(this.leadService, lead);
          // Se marca como conocido en el acto: si el mismo leadgen_id volviera
          // a aparecer en esta misma corrida, no se duplica.
          known.add(String(lead.id));

          // "Adjuntado" se cuenta aparte de "importado" porque no es lo mismo
          // para quien lee el reporte: un lead nuevo es una persona más para
          // trabajar, y un adjuntado es un envío que se sumó a una ficha que
          // el equipo ya tenía. Sumarlos juntos haría ver gente nueva donde no
          // la hay.
          // Lo recién traído cuenta como conocido Y con anuncio: la Graph
          // API manda el `ad_id` junto al lead y `persistMetaLead` lo guarda,
          // así que dejarlo fuera del índice lo reportaría como incompleto en
          // la misma corrida que lo completó.
          if (lead.ad_id) withAd.add(String(lead.id));

          if (created) {
            row.importados++;
            report.totals.importados++;
            report.by_platform[platform].importados++;
          } else {
            row.adjuntados++;
            report.totals.adjuntados++;
            report.by_platform[platform].adjuntados++;
          }

          console.log(created
            ? `🔁 [Conciliación Meta] Lead ${lead.id} recuperado como prospecto #${prospect.id}.`
            : `🔗 [Conciliación Meta] Lead ${lead.id} colgado del lead existente #${prospect.id} (mismo teléfono).`);
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

    /*
     * Un formulario ACTIVO que en el rango no entregó un solo lead al CRM es
     * el síntoma de la suscripción caída, y se dice aparte porque en una lista
     * de treinta formularios (la mayoría viejos y vacíos) no se distingue del
     * ruido. "Activo" lo dice Meta en `status`; cuando los formularios se
     * listaron desde la base (sin `pages_manage_ads`) no hay estado y esta
     * lista queda vacía en vez de inventar uno.
     */
    report.formularios_activos_sin_leads = report.forms
      .filter((f) => String(f.estado || '').toUpperCase() === 'ACTIVE' && f.en_crm === 0)
      .map((f) => ({ form_id: f.form_id, nombre: f.nombre, en_meta: f.en_meta }));

    return report;
  }
}
