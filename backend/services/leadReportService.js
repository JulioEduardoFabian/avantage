import { db } from '../db/connection.js';
import { DNI_MATCH_KEY_SQL, PHONE_DIGITS_SQL, applyLeadVisibility } from './leadService.js';
import { CHANNELS, LEAD_ORIGIN_COLUMNS, PLATFORMS, leadOrigin } from './leadOrigin.js';
import { LeadStageChangeService } from './leadStageChangeService.js';
import {
  buildStageResolver,
  buildStatusLabeler,
  loadFunnelStageIndex,
  stageOptions
} from './funnelStageLabel.js';

/**
 * Reporte de Leads: todos los leads con su trazabilidad — quién movió a cada
 * uno, hacia qué etapa y en qué fecha y hora.
 *
 * **No tiene tabla propia**, por la misma razón que Cobranzas: es
 * `lead_stage_changes` —la bitácora que ya se escribe en cada cambio de
 * `leads.status`— mirada desde la pregunta de quien revisa el trabajo del
 * equipo, y no desde la ficha de un lead. Hasta ahora esa bitácora solo se
 * podía leer de a un lead y entrando a su ficha en el Funnel de Ventas
 * (`GET /api/leads/:id/stage-history`), así que "¿qué movió ayer cada persona?"
 * o "¿quién devolvió este lead al Setter Funnel?" se contestaba abriendo fichas
 * de una en una. Inventarle una tabla de reporte obligaría a escribir cada
 * movimiento en dos lados, y el día que se separen nadie sabría cuál dice la
 * verdad.
 *
 * Tres decisiones que conviene no deshacer:
 *
 * 1. **La visibilidad es la misma del funnel.** El reporte no puede ser una
 *    puerta de atrás a los leads que alguien no ve en su tablero, así que reusa
 *    `leadService.visibilityQueryFor()` + `applyLeadVisibility()` y no una
 *    condición propia: cada quien ve sus leads, `setter.view_all` suma el
 *    Setter Funnel entero y `leads.manage_all` ve todo. `scope` viaja a la
 *    pantalla para que pueda explicar por qué la lista es corta en vez de
 *    parecer rota.
 *
 * 2. **Los filtros eligen LEADS, y de cada uno se muestra la trazabilidad
 *    completa.** Filtrar por persona o por fechas acota qué leads aparecen
 *    (`whereExists` sobre la bitácora), pero no recorta su historia: la
 *    pregunta que trae a alguien acá es "¿qué pasó con este lead?", y media
 *    historia —justo la mitad que el filtro dejó afuera— es la clase de dato
 *    con el que se saca una conclusión equivocada.
 *
 * 3. **El alta del lead entra como primer hito, derivado y marcado como tal.**
 *    La bitácora nace con su migración (26/10/2026), así que de los leads
 *    anteriores no tiene una sola fila; y ningún lead tiene registrado su
 *    propio nacimiento, que es el punto de partida de cualquier trayectoria.
 *    Se arma en cada lectura desde `leads.created_at` / `created_by` / `source`
 *    (no se guarda, por lo mismo que el `is_locked` de un hito) y lleva
 *    `derived: true` para que la pantalla no la muestre como un movimiento que
 *    alguien hizo.
 */

/**
 * Las columnas de origen que se le piden a MySQL en la página de leads.
 * `source` y `created_at` ya van en el select por su cuenta, así que se
 * descuentan para no pedirlas dos veces.
 */
const ORIGIN_SELECT = LEAD_ORIGIN_COLUMNS
  .filter((column) => column !== 'source' && column !== 'created_at')
  .map((column) => `leads.${column}`);

/** Cuántos leads por página. Es una pantalla de lectura, no un tablero. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Un día de calendario tal como lo escribe un `<input type="date">`. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El actor del filtro "Movido por", codificado como lo manda el desplegable:
 * `user:7`, `bot` o `system`. Se parsea acá —y no en la consulta— para que un
 * valor cualquiera llegue como `null` (sin filtro) en vez de como un pedazo de
 * texto que termina en un `where`.
 */
export function parseActor(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw === 'bot' || raw === 'system') return { type: raw, id: null };
  const match = /^user:(\d+)$/.exec(raw);
  return match ? { type: 'user', id: Number(match[1]) } : null;
}

/** El mismo código que entiende `parseActor()`, para armar el desplegable. */
export function actorKey({ actorType, actorId } = {}) {
  if (actorType === 'user' && actorId) return `user:${actorId}`;
  return actorType === 'bot' ? 'bot' : 'system';
}

/**
 * Cómo se nombra a quien movió el lead.
 *
 * Vive en el servicio y no en la pantalla porque lo dicen dos cosas que no
 * pueden discrepar: cada movimiento de la línea de tiempo y la opción del
 * desplegable que filtra por esa misma persona. Un `user` sin nombre —se dio de
 * baja antes de que la bitácora guardara la copia— se nombra por lo único que
 * se sabe de él, que es que fue alguien del panel: inventarle un nombre sería
 * peor, y dejarlo vacío haría parecer que el movimiento no tuvo autor.
 */
export function actorLabel({ actorType, actorName } = {}) {
  if (actorName) return actorName;
  if (actorType === 'bot') return 'Avan (bot)';
  if (actorType === 'user') return 'Un usuario del panel';
  return 'El sistema';
}

/**
 * El filtro de origen, codificado como lo manda el desplegable: `platform:meta`
 * o `channel:whatsapp`.
 *
 * Son las claves de `PLATFORMS` y `CHANNELS` y no sus etiquetas porque viajan
 * en la URL: "Orgánico" y "Mensaje directo" ahí se escriben con escapes, y un
 * acento mal codificado dejaría el filtro sin coincidencias sin que nada falle
 * a la vista. Igual que `parseActor()`, lo que no es uno de los códigos
 * posibles vuelve como `null` —o sea, sin filtro— en vez de llegar a la
 * consulta como un pedazo de texto.
 */
export function parseOrigin(value) {
  const raw = String(value || '').trim();
  const [kind, key] = raw.split(':');
  if (kind === 'platform' && PLATFORMS[key]) return { kind, key, label: PLATFORMS[key] };
  if (kind === 'channel' && CHANNELS[key]) return { kind, key, label: CHANNELS[key] };
  return null;
}

/** Las opciones del desplegable, agrupadas como se ven en la barra. */
export const ORIGIN_OPTIONS = [
  ...Object.entries(PLATFORMS).map(([key, label]) => ({ key: `platform:${key}`, label, group: 'Plataforma' })),
  ...Object.entries(CHANNELS).map(([key, label]) => ({ key: `channel:${key}`, label, group: 'Canal' }))
];

/**
 * ¿Este lead es del origen que pide el filtro?
 *
 * La respuesta sale de `leadOrigin()` y no de una condición propia: de dónde
 * salió un lead se contesta en UN solo sitio (`leadOrigin.js`), porque la
 * respuesta vive repartida en tres juegos de columnas más el texto libre de
 * `source` y cada pantalla que la resolvía por su cuenta llegaba a otra cosa.
 * Es la misma función con la que la hoja «Ruta de leads» arma su columna de
 * plataforma, así que el reporte y el exportable no pueden discrepar.
 */
export function matchesOrigin(origin, filter) {
  if (!filter) return true;
  if (!origin) return false;
  return filter.kind === 'platform' ? origin.platform === filter.label : origin.channel === filter.label;
}

/** El día siguiente a `YYYY-MM-DD`, para cerrar el rango por arriba. */
export function nextDay(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Deja los parámetros de la URL en algo con lo que se pueda consultar: una
 * página válida, un tamaño de página con tope, los días solo si son días y el
 * actor solo si es uno de los tres códigos posibles.
 *
 * Es pura y exportada porque es el contrato de la pantalla con el reporte: lo
 * normalizado vuelve en la respuesta (`filters`), así que lo que se ve aplicado
 * es exactamente lo que se aplicó.
 */
export function normalizeFilters(query = {}) {
  const day = (value) => (DAY_RE.test(String(value || '')) ? String(value) : null);
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE)
  );

  let from = day(query.from);
  let to = day(query.to);
  // Un rango al revés no devuelve nada y eso se lee como "el reporte está
  // roto": si las fechas vinieron invertidas, se usan como rango igual.
  if (from && to && from > to) [from, to] = [to, from];

  return {
    search: String(query.search || '').trim().slice(0, 120),
    actor: parseActor(query.actor),
    status: String(query.status || '').trim().slice(0, 60),
    origin: parseOrigin(query.origin),
    from,
    to,
    onlyBlocked: query.onlyBlocked === '1' || query.onlyBlocked === 'true' || query.onlyBlocked === true,
    page,
    pageSize
  };
}

/**
 * La trayectoria de un lead: su alta y después cada movimiento, del más viejo
 * al más nuevo.
 *
 * `labelStatus` traduce las claves de status a los nombres que el equipo le
 * puso a sus columnas, prefiriendo el tablero del lead por la misma razón que
 * en la bandeja de WhatsApp: `cita_agendada` existe en los dos y la etiqueta
 * del tablero equivocado diría que el lead está donde no está.
 */
export function buildTimeline(lead, changes = [], labelStatus = () => null, board = 'setter') {
  const alta = {
    id: `alta-${lead.id}`,
    kind: 'alta',
    derived: true,
    from: null,
    to: null,
    actorType: lead.created_by ? 'user' : 'system',
    actorName: lead.created_by_name || null,
    actorLabel: lead.created_by_name || null,
    source: lead.source || null,
    blocked: false,
    reason: null,
    createdAt: lead.created_at
  };

  const movimientos = changes.map((change) => ({
    id: `mov-${change.id}`,
    kind: 'movimiento',
    derived: false,
    from: labelStatus(change.fromStatus, board),
    to: labelStatus(change.toStatus, board),
    actorType: change.actorType,
    actorName: change.actorName,
    actorLabel: actorLabel(change),
    source: null,
    blocked: change.blocked,
    reason: change.reason,
    createdAt: change.createdAt
  }));

  return [alta, ...movimientos];
}

/**
 * El filtro de texto del reporte.
 *
 * **Una consulta de puros dígitos no se compara contra el texto del teléfono**:
 * se compara contra sus dígitos (`PHONE_DIGITS_SQL`, la misma limpieza del
 * cruce por teléfono del resto del sistema) y contra el documento sin
 * separadores. El mismo número está escrito de maneras distintas según la
 * puerta por la que entró —el bot guarda "51982768859", el formulario de Meta
 * guarda "+51 982 768 859", el alta manual lo que haya tecleado la persona—,
 * así que un `LIKE '%982768859%'` sobre la columna cruda **no encuentra al lead
 * de Meta**: los espacios caen justo en medio de lo que se buscó. Los dos
 * tableros ya buscaban por dígitos (`src/leadSearch.js`), así que el mismo
 * número aparecía ahí y no acá — y de las dos respuestas la del reporte es la
 * que manda a revisar el webhook por un lead que estaba todo el tiempo.
 *
 * Con dígitos se miran solo id, teléfono y documento, que es la regla que ya
 * tienen los tableros: en un número, un dígito de diferencia es otra persona,
 * y nada bueno sale de que "982768859" encuentre un tema de tesis que
 * casualmente contiene esa cifra.
 */
export function applySearch(query, search) {
  const texto = String(search || '').trim();
  if (!texto) return query;

  const digits = texto.replace(/\D/g, '');
  const soloNumeros = digits.length > 0 && digits === texto.replace(/\s/g, '');

  if (soloNumeros) {
    return query.where(function () {
      this.whereRaw(`${PHONE_DIGITS_SQL} LIKE ?`, [`%${digits}%`])
        .orWhereRaw(`${DNI_MATCH_KEY_SQL} LIKE ?`, [`%${digits}%`])
        // El id es cómo se nombra un lead entre pantallas ("el #412").
        .orWhere('leads.id', Number(digits));
    });
  }

  const like = `%${texto}%`;
  return query.where(function () {
    this.where('leads.full_name', 'like', like)
      .orWhere('leads.phone', 'like', like)
      .orWhere('leads.email', 'like', like)
      .orWhere('leads.dni', 'like', like)
      .orWhere('leads.university', 'like', like)
      .orWhere('leads.topic', 'like', like)
      .orWhere('leads.assigned_to', 'like', like);
  });
}

export class LeadReportService {
  constructor({ leadService, stageChangeService } = {}) {
    this.leads = leadService;
    this.changes = stageChangeService || new LeadStageChangeService();
  }

  /**
   * Los leads que el filtro elige, sin selects ni orden: es la MISMA consulta
   * que cuenta el total, la que trae la página y la que resume los
   * movimientos, así que las tres no pueden terminar mirando conjuntos
   * distintos.
   *
   * Las fechas se comparan contra la hora con la que MySQL escribió la bitácora
   * (la del servidor, Lima en producción), igual que el resto de los filtros
   * por día del panel.
   */
  #matching(filters, visibility, originIds = null) {
    const query = applyLeadVisibility(db('leads'), visibility);

    /*
     * El origen NO se pregunta en SQL: lo resuelve `leadOrigin()` sobre una
     * docena de columnas y con reglas de prioridad (el sello manda, el bloque
     * más antiguo gana, el texto de `source` es el último recurso). Escrito
     * como un `where` sería una segunda versión de esas reglas, y el día que
     * se separen el reporte diría una plataforma y el exportable otra. Así que
     * se resuelve aparte, sobre este mismo conjunto, y vuelve como una lista de
     * ids — que es lo que mantiene mirando lo mismo al total, a la página y al
     * resumen. Una lista vacía filtra a cero, que es la respuesta correcta.
     */
    if (originIds) query.whereIn('leads.id', originIds);

    if (filters.search) applySearch(query, filters.search);

    if (filters.status) query.where('leads.status', filters.status);

    const porMovimiento = filters.actor || filters.from || filters.to || filters.onlyBlocked;
    if (porMovimiento) {
      query.whereExists(function () {
        this.select(db.raw('1')).from('lead_stage_changes as c').whereRaw('c.lead_id = leads.id');
        if (filters.actor) {
          this.where('c.actor_type', filters.actor.type);
          if (filters.actor.id) this.where('c.actor_id', filters.actor.id);
        }
        if (filters.onlyBlocked) this.where('c.blocked', true);
        if (filters.from) this.where('c.created_at', '>=', `${filters.from} 00:00:00`);
        if (filters.to) this.where('c.created_at', '<', `${nextDay(filters.to)} 00:00:00`);
      });
    }

    return query;
  }

  /**
   * Los ids de los leads que son del origen pedido, calculados sobre el MISMO
   * conjunto que el resto de los filtros ya eligió. Sin filtro de origen
   * devuelve `null` y no se consulta nada: es una pasada extra sobre los leads
   * visibles y solo la paga quien usa el filtro.
   */
  async #originIds(filters, visibility) {
    if (!filters.origin) return null;
    const rows = await this.#matching(filters, visibility)
      .select('leads.id', ...LEAD_ORIGIN_COLUMNS.map((column) => `leads.${column}`));
    return rows
      .filter((row) => matchesOrigin(leadOrigin(row), filters.origin))
      .map((row) => row.id);
  }

  /**
   * Una página del reporte: los leads, su trazabilidad, el resumen de lo
   * filtrado y las opciones de los desplegables.
   *
   * Las opciones viajan en la misma respuesta porque son dos consultas a tablas
   * chicas, y la alternativa es que la pantalla haga tres llamadas para dibujar
   * una barra de filtros.
   */
  async report(user, query = {}) {
    const filters = normalizeFilters(query);
    const visibility = await this.leads.visibilityQueryFor(user);

    const index = await loadFunnelStageIndex();
    const stageOf = buildStageResolver(index);
    const labelStatus = buildStatusLabeler(index);

    const originIds = await this.#originIds(filters, visibility);

    const [{ total = 0 } = {}] = await this.#matching(filters, visibility, originIds)
      .countDistinct({ total: 'leads.id' });

    const rows = await this.#matching(filters, visibility, originIds)
      .leftJoin('users as asesor', 'asesor.id', 'leads.assigned_user_id')
      .leftJoin('users as setter', 'setter.id', 'leads.setter_user_id')
      .leftJoin('users as closer', 'closer.id', 'leads.closer_user_id')
      .leftJoin('users as autor', 'autor.id', 'leads.created_by')
      .select(
        'leads.id',
        'leads.full_name',
        'leads.phone',
        'leads.email',
        'leads.dni',
        'leads.university',
        'leads.topic',
        'leads.status',
        'leads.source',
        'leads.sales_funnel_at',
        'leads.created_at',
        'leads.created_by',
        'leads.assigned_to',
        'asesor.name as assigned_user_name',
        'setter.name as setter_name',
        'closer.name as closer_name',
        'autor.name as created_by_name',
        // De dónde salió el lead: las mismas columnas que lee `leadOrigin()`,
        // para poder decirlo en cada fila y no solo filtrar por ello (un
        // filtro de canal sin el canal escrito al lado no se puede comprobar).
        // `source` y `created_at` ya están arriba.
        ...ORIGIN_SELECT,
        // El único dato de la bitácora que hace falta en SQL es el del ORDEN:
        // los movimientos se traen después, en una sola consulta para toda la
        // página, y de ahí salen los conteos de cada fila.
        db.raw('(SELECT MAX(c.created_at) FROM lead_stage_changes c WHERE c.lead_id = leads.id) as last_move_at')
      )
      // Primero el que se movió hace menos: es la pregunta con la que se entra
      // al reporte. MySQL deja los nulos al final en DESC, así que los leads
      // que nadie movió quedan después, que es donde van.
      .orderBy('last_move_at', 'desc')
      .orderBy('leads.created_at', 'desc')
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);

    const historias = await this.changes.listForLeads(rows.map((row) => row.id));

    const leads = rows.map((row) => {
      const movimientos = historias.get(row.id) || [];
      const stage = stageOf(row);
      const board = stage?.board || 'setter';
      const origin = leadOrigin(row);
      const ultimo = movimientos[movimientos.length - 1] || null;

      return {
        id: row.id,
        full_name: row.full_name,
        phone: row.phone,
        email: row.email,
        dni: row.dni,
        university: row.university,
        topic: row.topic,
        status: row.status,
        stage,
        source: row.source,
        // Lo que la fila necesita del origen: la plataforma y el canal, y el
        // nombre de la campaña y del anuncio para el detalle. Los ids no
        // viajan: acá no se concilia nada contra el Ads Manager.
        origin: {
          platform: origin.platform,
          channel: origin.channel,
          network: origin.network,
          paid: origin.paid,
          campaignName: origin.campaignName,
          adName: origin.adName,
          conflict: origin.conflict
        },
        created_at: row.created_at,
        created_by_name: row.created_by_name || null,
        // El nombre vivo manda sobre la copia, y la copia sostiene al asesor
        // que no tiene cuenta en el panel (ver `assignmentPatch()`).
        assigned_user_name: row.assigned_user_name || row.assigned_to || null,
        setter_name: row.setter_name || null,
        closer_name: row.closer_name || null,
        sales_funnel_at: row.sales_funnel_at,
        moves: movimientos.length,
        blocked_moves: movimientos.filter((move) => move.blocked).length,
        last_move: ultimo
          ? {
            to: labelStatus(ultimo.toStatus, board),
            actorLabel: actorLabel(ultimo),
            actorType: ultimo.actorType,
            blocked: ultimo.blocked,
            createdAt: ultimo.createdAt
          }
          : null,
        timeline: buildTimeline(row, movimientos, labelStatus, board)
      };
    });

    const [resumen = {}] = await db('lead_stage_changes')
      .whereIn('lead_id', this.#matching(filters, visibility).select('leads.id'))
      .select(
        db.raw('COUNT(*) as moves'),
        db.raw('SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) as blocked'),
        db.raw('COUNT(DISTINCT lead_id) as moved_leads')
      );

    const actores = await this.changes.listActors();

    return {
      leads,
      total: Number(total || 0),
      page: filters.page,
      pageSize: filters.pageSize,
      pages: Math.max(1, Math.ceil(Number(total || 0) / filters.pageSize)),
      scope: visibility.scope,
      // Lo normalizado vuelve a la pantalla (el actor, como el código que ella
      // manda) para que los filtros que se ven sean los que se aplicaron.
      filters: {
        ...filters,
        actor: query.actor ? String(query.actor) : '',
        origin: filters.origin ? `${filters.origin.kind}:${filters.origin.key}` : ''
      },
      summary: {
        leads: Number(total || 0),
        moves: Number(resumen.moves || 0),
        blocked: Number(resumen.blocked || 0),
        // Los que nadie movió desde que existe la bitácora: son los que están
        // quietos, que es la otra cosa que se viene a buscar acá.
        unmoved: Math.max(0, Number(total || 0) - Number(resumen.moved_leads || 0))
      },
      options: {
        actors: actores.map((actor) => ({
          key: actorKey(actor),
          label: actorLabel(actor),
          type: actor.actorType,
          moves: actor.moves
        })),
        stages: stageOptions(index),
        // Fijas y no sacadas de los datos: una opción que desaparece porque
        // hoy nadie entró por ahí se lee como que el filtro está roto.
        origins: ORIGIN_OPTIONS
      }
    };
  }
}
