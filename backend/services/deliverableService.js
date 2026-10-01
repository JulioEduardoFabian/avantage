import { db } from '../db/connection.js';

/**
 * Módulo "Entregables": el registro operativo de qué hay que entregar en cada
 * proyecto, qué se entregó ya, y cómo se cruza eso con el cobro.
 *
 * Los entregables ya no se liberan por el portal del cliente: la entrega ocurre
 * fuera del sistema (correo, WhatsApp, presencial) y se registra acá, en la
 * tabla `deliverables`. Por eso tiene tabla propia — ver la migración
 * `20261025000000_create_deliverables_table.js`: ninguna de las tablas que ya
 * existían puede decir "esto FALTA entregar", que es la mitad que importa.
 *
 * Lo único que se sigue derivando en cada lectura (y no se guarda) es el estado
 * operativo, porque depende del estado de la cuota, que lo mueve Finanzas desde
 * su propia pantalla. Guardarlo sería una copia que se desincroniza el primer
 * día, igual que pasaría con `projects.is_locked`.
 */

/** Los dos únicos estados que se guardan en la fila. */
export const DELIVERABLE_STATUSES = ['pendiente', 'entregado'];

/** Por dónde se entregó. Texto libre no: con una lista cerrada se puede filtrar. */
export const DELIVERY_CHANNELS = ['correo', 'whatsapp', 'presencial', 'drive', 'otro'];

/**
 * Estado operativo: el cruce entre la entrega y el cobro. Se llama por lo que
 * falta, no por lo que pasó, y cada nombre apunta a un responsable distinto:
 *
 *   ENTREGADO     entregado y con la cuota verificada (o sin cuota atada, que
 *                 es no tener nada que esperar). Cerrado.
 *   SIN_COBRAR    se entregó y la cuota NO está verificada → el trabajo salió
 *                 sin que el dinero esté confirmado. Es cobranza, y es el aviso
 *                 que antes daba solo el candado del portal.
 *   POR_ENTREGAR  la cuota ya está verificada y el entregable sigue pendiente →
 *                 ya cobramos y debemos. Lo que operaciones mira cada día.
 *   PENDIENTE     ni lo uno ni lo otro: todavía no le toca a nadie.
 */
export const DELIVERABLE_STATES = ['entregado', 'sin_cobrar', 'por_entregar', 'pendiente'];

/**
 * ¿El estado de la cuota atada impide entregar?
 *
 * Solo `pendiente`: ahí no entró nada de dinero y entregar sería regalar el
 * trabajo. `pagado` (el cliente pagó y Finanzas todavía no da el visto bueno) y
 * `verificado` dejan entregar — la diferencia entre esos dos es un trámite
 * interno, no una deuda del cliente.
 *
 * Un entregable sin cuota atada no depende de ningún cobro y nunca se bloquea.
 */
export function blocksDelivery(incomeEstado) {
  return incomeEstado === 'pendiente';
}

export const DELIVERABLE_STATE_INFO = {
  entregado: { label: 'Entregado', pending: null },
  sin_cobrar: { label: 'Entregado sin cobrar', pending: 'Ya se entregó y Finanzas todavía no verifica el pago.' },
  // "Falta entregar" se llega por dos caminos distintos y el motivo no es el
  // mismo: con una cuota verificada detrás es una deuda nuestra ("ya cobramos");
  // sin cuota atada no hay nada cobrado que reclamar, así que decir "el pago ya
  // está verificado" sería mentir sobre un pago que no existe.
  por_entregar: {
    label: 'Falta entregar',
    pending: 'El pago ya está verificado: falta hacer la entrega.',
    pendingWithoutIncome: 'Falta hacer la entrega. No está atado a ninguna cuota.'
  },
  pendiente: { label: 'Pendiente', pending: 'Falta el pago verificado y la entrega.' }
};

/**
 * mysql2 devuelve las columnas DATE como un Date a medianoche LOCAL, y pasarlo
 * por JSON (UTC) corre el día hacia atrás. Las fechas salen siempre como
 * "YYYY-MM-DD", igual que en `financeLedgerService`.
 */
function isoDay(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }
  return String(value).slice(0, 10);
}

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
}

/** Columnas de la cuota atada, por LEFT JOIN: el estado del pago se lee siempre fresco. */
const INCOME_COLUMNS = [
  'finance_income.code as income_code',
  'finance_income.cuota as income_cuota',
  'finance_income.estado as income_estado',
  'finance_income.due_date as income_due_date'
];

export class DeliverableService {
  /**
   * `projectService` se inyecta para no reescribir el avance de tareas ni la
   * puerta del pago inicial (`is_locked`): ese criterio ya vive en un solo
   * lugar y tiene que seguir así.
   */
  constructor({ projectService } = {}) {
    this.projectService = projectService;
  }

  // ------------------------------------------------------------------ LECTURA

  /**
   * Todo el tablero en una petición: cada proyecto con sus entregables ya
   * cruzados con el cobro, más los contadores globales. Son pocas filas por
   * proyecto, así que el filtrado y la búsqueda se hacen en el panel — así los
   * contadores de arriba siguen contando TODO y no solo lo filtrado.
   */
  async getOverview() {
    const projects = await this.projectService.getAllProjects();
    if (projects.length === 0) {
      return { projects: [], totals: emptyTotals(), generated_at: new Date().toISOString() };
    }

    const projectIds = projects.map((p) => p.id);
    const leadIds = projects.map((p) => p.lead_id).filter(Boolean);

    const [leads, rows, schedule, contractPlan] = await Promise.all([
      leadIds.length > 0
        ? db('leads').whereIn('id', leadIds).select('id', 'full_name', 'email', 'university', 'field_of_study')
        : [],
      this.#baseQuery().whereIn('deliverables.project_id', projectIds),
      // El cronograma completo alimenta el selector "se entrega contra la
      // cuota…" del panel, sin pedir otra ruta por proyecto.
      leadIds.length > 0
        ? db('finance_income')
          .whereIn('lead_id', leadIds)
          .select('id', 'lead_id', 'code', 'cuota', 'estado', 'due_date')
          .orderBy('due_date', 'asc').orderBy('id', 'asc')
        : [],
      this.#contractPlanByLead(leadIds)
    ]);

    const leadById = new Map(leads.map((l) => [l.id, l]));
    const rowsByProject = groupBy(rows, 'project_id');
    const scheduleByLead = groupBy(schedule, 'lead_id');
    const today = todayIso();

    const result = projects.map((project) => {
      const deliverables = (rowsByProject.get(project.id) || []).map((row) => shapeRow(row, today));
      const counts = countStates(deliverables);
      const plan = contractPlan.get(project.lead_id) || [];

      return {
        project_id: project.id,
        lead_id: project.lead_id,
        topic: project.topic,
        status: project.status,
        // La puerta del pago inicial, tal como la calcula projectService.
        is_locked: Boolean(project.is_locked),
        initial_payment_code: project.initial_payment?.code || null,
        progress_percentage: project.progress_percentage,
        total_tasks: project.total_tasks,
        completed_tasks: project.completed_tasks,
        deadline: isoDay(project.deadline),
        client_name: leadById.get(project.lead_id)?.full_name || null,
        client_email: project.client_email || leadById.get(project.lead_id)?.email || null,
        university: leadById.get(project.lead_id)?.university || null,
        field_of_study: project.field_of_study || null,
        deliverables,
        // Cuotas del cliente, para el selector de "contra qué cobro se entrega".
        schedule: (scheduleByLead.get(project.lead_id) || []).map((income) => ({
          income_id: income.id,
          code: income.code,
          cuota: income.cuota,
          estado: income.estado,
          due_date: isoDay(income.due_date)
        })),
        // Cuántas entregas tiene el contrato vigente que todavía no están en la
        // tabla: es lo que habilita el botón de importar sin tener que abrir el
        // contrato para comprobarlo.
        contract_plan_available: plan.filter((item) => !hasTitle(deliverables, item.avance)).length,
        counts,
        needs_attention: counts.por_entregar > 0 || counts.sin_cobrar > 0 || counts.overdue > 0
      };
    });

    return { projects: result, totals: sumTotals(result), generated_at: new Date().toISOString() };
  }

  async getById(id) {
    const row = await this.#baseQuery().where('deliverables.id', id).first();
    return row ? shapeRow(row, todayIso()) : null;
  }

  async listByProject(projectId) {
    const rows = await this.#baseQuery().where('deliverables.project_id', projectId);
    const today = todayIso();
    return rows.map((row) => shapeRow(row, today));
  }

  #baseQuery() {
    return db('deliverables')
      .leftJoin('finance_income', 'finance_income.id', 'deliverables.income_id')
      .leftJoin('users as entregador', 'entregador.id', 'deliverables.delivered_by')
      .select('deliverables.*', 'entregador.name as delivered_by_name', ...INCOME_COLUMNS)
      .orderBy('deliverables.position', 'asc')
      .orderBy('deliverables.id', 'asc');
  }

  /**
   * Las entregas comprometidas en el contrato vigente de cada lead. Si hay más
   * de un contrato se toma el más reciente que no esté anulado: una
   * reprogramación emite un contrato nuevo con el plan corregido, y mezclar los
   * dos haría ver compromisos duplicados.
   */
  async #contractPlanByLead(leadIds) {
    if (leadIds.length === 0) return new Map();
    const rows = await db('contract_deliverables')
      .join('contracts', 'contracts.id', 'contract_deliverables.contract_id')
      .whereIn('contracts.lead_id', leadIds)
      .whereNot('contracts.status', 'anulado')
      .select(
        'contract_deliverables.avance',
        'contract_deliverables.due_date',
        'contract_deliverables.position',
        'contracts.id as contract_id',
        'contracts.lead_id'
      )
      .orderBy('contracts.created_at', 'desc')
      .orderBy('contract_deliverables.position', 'asc');

    const byLead = new Map();
    const chosen = new Map();
    for (const row of rows) {
      if (!chosen.has(row.lead_id)) chosen.set(row.lead_id, row.contract_id);
      if (chosen.get(row.lead_id) !== row.contract_id) continue;
      if (!byLead.has(row.lead_id)) byLead.set(row.lead_id, []);
      byLead.get(row.lead_id).push(row);
    }
    return byLead;
  }

  // ---------------------------------------------------------------- ESCRITURA

  async create({ projectId, title, description, dueDate, incomeId, createdBy }) {
    const clean = (title || '').trim();
    if (!clean) throw new Error('El título del entregable es obligatorio.');

    const [id] = await db('deliverables').insert({
      project_id: projectId,
      income_id: incomeId || null,
      position: await this.#nextPosition(projectId),
      title: clean,
      description: (description || '').trim() || null,
      due_date: dueDate || null,
      created_by: createdBy || null
    });
    return this.getById(id);
  }

  /**
   * Edita el plan del entregable. El estado de entrega NO se toca por acá:
   * entregar y des-entregar tienen sus propios métodos porque arrastran fecha,
   * responsable, canal y archivo, y mezclarlos dejaría filas "entregadas" sin
   * ninguno de esos datos.
   */
  async update(id, { title, description, dueDate, incomeId, notes }) {
    const payload = { updated_at: db.fn.now() };
    if (title !== undefined) {
      const clean = (title || '').trim();
      if (!clean) throw new Error('El título del entregable es obligatorio.');
      payload.title = clean;
    }
    if (description !== undefined) payload.description = (description || '').trim() || null;
    if (dueDate !== undefined) payload.due_date = dueDate || null;
    if (incomeId !== undefined) payload.income_id = incomeId || null;
    if (notes !== undefined) payload.notes = (notes || '').trim() || null;

    await db('deliverables').where({ id }).update(payload);
    return this.getById(id);
  }

  /**
   * Marca la entrega. El archivo es opcional a propósito: la entrega ocurre
   * fuera del sistema, así que puede no haber nada que guardar — pero el
   * registro de cuándo, quién y por dónde sí tiene que quedar.
   *
   * Una cuota atada que TODAVÍA NO SE PAGÓ bloquea la entrega (ver
   * `blocksDelivery`). No alcanza con esconder el botón en la pantalla: si la
   * regla no está acá, una pestaña vieja o una llamada directa a la API la
   * saltan igual.
   *
   * No se exige, en cambio, que la cuota esté *verificada*: ahí el cliente ya
   * pagó y lo único que falta es el visto bueno de Finanzas, así que frenar la
   * entrega sería castigar al cliente por un trámite interno. Esa entrega se
   * registra y el tablero la muestra como "Entregado sin cobrar", que es
   * exactamente lo que es.
   */
  async markDelivered(id, { deliveredAt, deliveredBy, channel, notes, attachment }) {
    const existing = await db('deliverables')
      .leftJoin('finance_income', 'finance_income.id', 'deliverables.income_id')
      .where('deliverables.id', id)
      .first(
        'deliverables.*',
        'finance_income.estado as income_estado',
        'finance_income.code as income_code',
        'finance_income.cuota as income_cuota'
      );
    if (!existing) throw new Error('Entregable no encontrado.');

    if (existing.income_id && blocksDelivery(existing.income_estado)) {
      const error = new Error(
        `La cuota ${existing.income_cuota} (${existing.income_code}) todavía no está pagada, `
        + 'así que este entregable no se puede marcar como entregado. '
        + 'Cuando Finanzas registre el pago, la opción se habilita sola.'
      );
      error.code = 'UNPAID_INCOME';
      throw error;
    }

    if (channel && !DELIVERY_CHANNELS.includes(channel)) {
      throw new Error(`El canal de entrega debe ser uno de: ${DELIVERY_CHANNELS.join(', ')}.`);
    }

    const payload = {
      status: 'entregado',
      delivered_at: deliveredAt || todayIso(),
      delivered_by: deliveredBy || null,
      delivery_channel: channel || null,
      updated_at: db.fn.now()
    };
    if (notes !== undefined) payload.notes = (notes || '').trim() || null;
    if (attachment) {
      payload.attachment_filename = attachment.filename;
      payload.attachment_original_name = attachment.originalname;
      payload.attachment_mime_type = attachment.mimetype;
      payload.attachment_size = attachment.size;
    }

    await db('deliverables').where({ id }).update(payload);
    // El archivo anterior queda huérfano en disco si se reemplazó: lo borra la
    // ruta, que es la que sabe de `uploads/`.
    return { deliverable: await this.getById(id), replacedFile: attachment ? existing.attachment_filename : null };
  }

  /** Deshace la marca de entregado (se marcó por error). El archivo se conserva. */
  async markPending(id) {
    await db('deliverables').where({ id }).update({
      status: 'pendiente',
      delivered_at: null,
      delivered_by: null,
      delivery_channel: null,
      updated_at: db.fn.now()
    });
    return this.getById(id);
  }

  /**
   * Borra el entregable y devuelve la fila para que la ruta pueda quitar su
   * archivo del disco: de eso la base no sabe nada, y un archivo huérfano en
   * `uploads/` no lo vuelve a mirar nadie.
   */
  async remove(id) {
    const existing = await db('deliverables').where({ id }).first();
    if (!existing) return null;
    await db('deliverables').where({ id }).del();
    return existing;
  }

  async reorder(projectId, orderedIds) {
    await Promise.all(orderedIds.map((id, index) => db('deliverables')
      .where({ id, project_id: projectId })
      .update({ position: index, updated_at: db.fn.now() })));
    return this.listByProject(projectId);
  }

  /**
   * Copia al proyecto las entregas comprometidas en el contrato vigente del
   * cliente, para no teclear dos veces lo mismo. Mismo criterio que la
   * importación de plantillas de tareas: **copia**, y saltea las que ya existen
   * con el mismo título, así que reimportar no duplica nada.
   *
   * Se copia en vez de leerse del contrato porque un contrato emitido es
   * inmutable: si la entrega se reprograma, se mueve la fecha acá sin reescribir
   * un documento ya firmado.
   */
  async importFromContract(projectId, { createdBy } = {}) {
    const project = await db('projects').where({ id: projectId }).first();
    if (!project) throw new Error('Proyecto no encontrado.');
    if (!project.lead_id) throw new Error('Este proyecto no viene de un lead, así que no tiene contrato del que importar.');

    const plan = (await this.#contractPlanByLead([project.lead_id])).get(project.lead_id) || [];
    if (plan.length === 0) throw new Error('El cliente no tiene un contrato vigente con cronograma de entregas.');

    const existing = await this.listByProject(projectId);
    const pending = plan.filter((item) => !hasTitle(existing, item.avance));
    if (pending.length === 0) return { imported: 0, deliverables: existing };

    let position = await this.#nextPosition(projectId);
    await db('deliverables').insert(pending.map((item) => ({
      project_id: projectId,
      position: position++,
      title: item.avance,
      due_date: item.due_date || null,
      created_by: createdBy || null
    })));

    return { imported: pending.length, deliverables: await this.listByProject(projectId) };
  }

  async #nextPosition(projectId) {
    const row = await db('deliverables').where({ project_id: projectId }).max('position as max').first();
    return row?.max == null ? 0 : Number(row.max) + 1;
  }
}

// ------------------------------------------------------------------ HELPERS

/**
 * Deriva el estado operativo de una fila. Sin cuota atada no hay nada que
 * esperar del dinero, así que cuenta como cobro resuelto: el entregable depende
 * solo de si se entregó.
 */
function shapeRow(row, today) {
  const delivered = row.status === 'entregado';
  const paymentSettled = !row.income_id || row.income_estado === 'verificado';

  const state = delivered
    ? (paymentSettled ? 'entregado' : 'sin_cobrar')
    : (paymentSettled ? 'por_entregar' : 'pendiente');

  const dueDate = isoDay(row.due_date);
  const incomeDue = isoDay(row.income_due_date);

  return {
    id: row.id,
    project_id: row.project_id,
    position: row.position,
    title: row.title,
    description: row.description,
    due_date: dueDate,
    status: row.status,
    delivered_at: isoDay(row.delivered_at),
    delivered_by_name: row.delivered_by_name,
    delivery_channel: row.delivery_channel,
    has_attachment: Boolean(row.attachment_filename),
    attachment_original_name: row.attachment_original_name,
    attachment_size: row.attachment_size,
    notes: row.notes,

    // La cuota que lo condiciona. Sin importes: en la pantalla operativa una
    // cuota se nombra por su código, igual que en el módulo de Proyectos.
    income_id: row.income_id,
    income_code: row.income_code,
    income_cuota: row.income_cuota,
    income_estado: row.income_estado,
    payment_verified: Boolean(row.income_id) && row.income_estado === 'verificado',

    // ¿Se puede registrar la entrega? Lo decide el backend, igual que `state`:
    // la pantalla solo pinta, y así el botón que se ve y la regla que aplica
    // `markDelivered()` no pueden decir cosas distintas.
    delivery_blocked: !delivered && Boolean(row.income_id) && blocksDelivery(row.income_estado),
    delivery_blocked_reason: !delivered && Boolean(row.income_id) && blocksDelivery(row.income_estado)
      ? `La cuota ${row.income_cuota} (${row.income_code}) todavía no está pagada.`
      : null,

    state,
    state_label: DELIVERABLE_STATE_INFO[state].label,
    pending_reason: (!row.income_id && DELIVERABLE_STATE_INFO[state].pendingWithoutIncome)
      || DELIVERABLE_STATE_INFO[state].pending,
    // La ENTREGA venció: la fecha pasó y sigue sin entregarse. Una entrega ya
    // hecha fuera de fecha no es un pendiente, es historia.
    is_overdue: Boolean(dueDate) && dueDate < today && !delivered,
    // La CUOTA venció y sigue sin verificarse. Es otra alarma y de otra área,
    // así que se informa aparte en vez de mezclarse con la de arriba.
    payment_overdue: Boolean(incomeDue) && incomeDue < today && row.income_estado !== 'verificado'
  };
}

/** ¿Ya hay un entregable con ese título? Comparación laxa, como la de plantillas de tareas. */
function hasTitle(deliverables, title) {
  const needle = String(title || '').trim().toLowerCase();
  return deliverables.some((d) => String(d.title || '').trim().toLowerCase() === needle);
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key];
    if (value == null) continue;
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
}

function emptyTotals() {
  return {
    projects: 0,
    projects_needing_attention: 0,
    deliverables: 0,
    entregado: 0,
    sin_cobrar: 0,
    por_entregar: 0,
    pendiente: 0,
    overdue: 0
  };
}

function countStates(deliverables) {
  const counts = { entregado: 0, sin_cobrar: 0, por_entregar: 0, pendiente: 0, overdue: 0, total: deliverables.length };
  for (const d of deliverables) {
    counts[d.state] += 1;
    if (d.is_overdue) counts.overdue += 1;
  }
  return counts;
}

function sumTotals(projects) {
  const totals = emptyTotals();
  totals.projects = projects.length;
  for (const project of projects) {
    if (project.needs_attention) totals.projects_needing_attention += 1;
    totals.deliverables += project.counts.total;
    for (const state of DELIVERABLE_STATES) totals[state] += project.counts[state];
    totals.overdue += project.counts.overdue;
  }
  return totals;
}
