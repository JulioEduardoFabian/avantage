import { db } from '../db/connection.js';

/**
 * Módulo "Entregables": el cruce entre lo que el cliente pagó y lo que
 * operaciones subió.
 *
 * Hoy esa respuesta —"¿ya puedo liberar este entregable?"— exige tres pantallas:
 * Finanzas para ver si la cuota está verificada, el detalle del proyecto para
 * ver si el avance está subido, y el contrato para recordar qué se prometió. Acá
 * se lee todo junto, con una fila por cuota, que es la unidad que el modelo de
 * datos ya usa para unir las dos cosas (`project_updates.income_id`).
 *
 * No hay tabla nueva: el estado de cada entregable se DERIVA en cada lectura,
 * igual que `projects.is_locked` y `project_updates.is_locked`. Guardarlo sería
 * una cuarta copia del mismo hecho, y se desincronizaría en cuanto Finanzas
 * verificara un pago desde su propia pantalla.
 */

/**
 * Estado operativo de un entregable. Es la combinación de las dos únicas
 * preguntas que importan acá, y el nombre dice qué falta, no qué pasó:
 *
 *   ENTREGADO      pago verificado + trabajo subido con adjunto → el cliente ya
 *                  lo descarga de su portal. Nada que hacer.
 *   RETENIDO       el trabajo está subido pero el pago no está verificado → el
 *                  cliente lo ve con el candado. Falta Finanzas.
 *   FALTA_TRABAJO  el pago ya está verificado y nadie subió el entregable → es
 *                  lo único que operaciones debe mirar todos los días.
 *   PENDIENTE      ni pago verificado ni trabajo subido: la cuota todavía no le
 *                  toca a nadie.
 */
export const DELIVERABLE_STATES = ['entregado', 'retenido', 'falta_trabajo', 'pendiente'];

/** Etiquetas y qué falta en cada estado, para que el panel y la API digan lo mismo. */
export const DELIVERABLE_STATE_INFO = {
  entregado: { label: 'Entregado', pending: null },
  retenido: { label: 'Retenido por pago', pending: 'Falta que Finanzas verifique el pago.' },
  falta_trabajo: { label: 'Falta subir el trabajo', pending: 'El pago ya está verificado: falta subir el entregable al proyecto.' },
  pendiente: { label: 'Pendiente', pending: 'Falta el pago verificado y el entregable.' }
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

export class DeliverableService {
  /**
   * `projectService` se inyecta para no reescribir el cálculo del avance de
   * tareas ni la puerta del pago inicial (`is_locked`): ese criterio ya vive en
   * un solo lugar y tiene que seguir así.
   */
  constructor({ projectService } = {}) {
    this.projectService = projectService;
  }

  /**
   * Todo el tablero en una sola petición: los proyectos con sus entregables ya
   * cruzados, más los contadores globales. Son pocas filas por proyecto, así que
   * se traen enteras y el filtrado y la búsqueda se hacen en el panel — así los
   * contadores de arriba siguen contando TODO y no solo lo filtrado.
   */
  async getOverview() {
    const projects = await this.projectService.getAllProjects();
    if (projects.length === 0) {
      return { projects: [], totals: emptyTotals(), generated_at: new Date().toISOString() };
    }

    const projectIds = projects.map((p) => p.id);
    const leadIds = projects.map((p) => p.lead_id).filter(Boolean);

    const [leads, incomes, updates, contractDeliverables] = await Promise.all([
      leadIds.length > 0
        ? db('leads').whereIn('id', leadIds).select('id', 'full_name', 'email', 'phone', 'university', 'field_of_study')
        : [],
      leadIds.length > 0
        ? db('finance_income')
          .whereIn('lead_id', leadIds)
          .select('id', 'lead_id', 'code', 'cuota', 'due_date', 'fecha', 'estado', 'is_initial_payment')
          .orderBy('due_date', 'asc')
          .orderBy('id', 'asc')
        : [],
      db('project_updates')
        .leftJoin('users', 'users.id', 'project_updates.author_id')
        .whereIn('project_updates.project_id', projectIds)
        .select(
          'project_updates.id',
          'project_updates.project_id',
          'project_updates.income_id',
          'project_updates.content',
          'project_updates.attachment_filename',
          'project_updates.attachment_original_name',
          'project_updates.created_at',
          'users.name as author_name'
        )
        .orderBy('project_updates.created_at', 'asc'),
      // Lo prometido por escrito. Si hay más de un contrato por lead se toma el
      // más reciente: es el que está vigente, igual que en el módulo de
      // contratos.
      leadIds.length > 0
        ? db('contract_deliverables')
          .join('contracts', 'contracts.id', 'contract_deliverables.contract_id')
          .whereIn('contracts.lead_id', leadIds)
          .whereNot('contracts.status', 'anulado')
          .select(
            'contract_deliverables.id',
            'contract_deliverables.avance',
            'contract_deliverables.due_date',
            'contract_deliverables.position',
            'contracts.id as contract_id',
            'contracts.lead_id',
            'contracts.status as contract_status',
            'contracts.created_at as contract_created_at'
          )
          .orderBy('contracts.created_at', 'desc')
          .orderBy('contract_deliverables.position', 'asc')
        : []
    ]);

    const leadById = new Map(leads.map((l) => [l.id, l]));
    const incomesByLead = groupBy(incomes, 'lead_id');
    const updatesByProject = groupBy(updates, 'project_id');
    const deliverablesByLead = latestContractPerLead(contractDeliverables);

    const today = todayIso();
    const rows = projects.map((project) => this.#buildProject(project, {
      lead: project.lead_id ? leadById.get(project.lead_id) || null : null,
      incomes: incomesByLead.get(project.lead_id) || [],
      updates: updatesByProject.get(project.id) || [],
      contractDeliverables: deliverablesByLead.get(project.lead_id) || [],
      today
    }));

    return { projects: rows, totals: sumTotals(rows), generated_at: new Date().toISOString() };
  }

  /** Un proyecto con sus entregables ya cruzados. */
  #buildProject(project, { lead, incomes, updates, contractDeliverables, today }) {
    // Los avances se reparten por la cuota a la que se ataron. Un avance sin
    // cuota no es un error: la mayoría de los hitos son solo texto ("ya
    // conversamos con el asesor"), y los anteriores a este flujo tampoco la
    // tienen. Los que SÍ llevan adjunto y no están atados a nada se listan
    // aparte, porque son los que alguien debería atar a un cobro.
    const updatesByIncome = groupBy(updates.filter((u) => u.income_id), 'income_id');

    const deliverables = incomes.map((income) => {
      const linked = (updatesByIncome.get(income.id) || []).map(shapeUpdate);
      const withAttachment = linked.filter((u) => u.has_attachment);
      const paymentVerified = income.estado === 'verificado';
      const workUploaded = withAttachment.length > 0;

      const state = paymentVerified
        ? (workUploaded ? 'entregado' : 'falta_trabajo')
        : (workUploaded ? 'retenido' : 'pendiente');

      const dueDate = isoDay(income.due_date);

      return {
        income_id: income.id,
        code: income.code,
        cuota: income.cuota,
        due_date: dueDate,
        paid_at: isoDay(income.fecha),
        is_initial_payment: Boolean(income.is_initial_payment),
        // El estado crudo del ingreso, sin el monto: en la pantalla operativa
        // una cuota se nombra por su código, nunca por su importe (misma regla
        // que el módulo de Proyectos).
        payment_estado: income.estado,
        payment_verified: paymentVerified,
        work_uploaded: workUploaded,
        // Hitos atados a esta cuota, con y sin adjunto: el adjunto es lo que se
        // entrega, el texto suelto es contexto de la conversación.
        updates: linked,
        attachments: withAttachment,
        state,
        state_label: DELIVERABLE_STATE_INFO[state].label,
        pending_reason: DELIVERABLE_STATE_INFO[state].pending,
        // Vencida y sin verificar: es la cobranza que operaciones debería
        // empujar. Una cuota vencida YA verificada no es noticia.
        is_overdue: Boolean(dueDate) && dueDate < today && !paymentVerified
      };
    });

    const unlinkedAttachments = updates
      .filter((u) => !u.income_id && u.attachment_filename)
      .map(shapeUpdate);

    const counts = countStates(deliverables);

    return {
      project_id: project.id,
      lead_id: project.lead_id,
      topic: project.topic,
      status: project.status,
      // La puerta del pago inicial, tal como la calcula projectService: mientras
      // siga cerrada el proyecto no se puede gestionar, así que ningún
      // entregable suyo va a avanzar por más que se mire este tablero.
      is_locked: Boolean(project.is_locked),
      initial_payment_code: project.initial_payment?.code || null,
      progress_percentage: project.progress_percentage,
      total_tasks: project.total_tasks,
      completed_tasks: project.completed_tasks,
      deadline: isoDay(project.deadline),
      client_name: lead?.full_name || null,
      client_email: project.client_email || lead?.email || null,
      university: lead?.university || null,
      field_of_study: project.field_of_study || lead?.field_of_study || null,
      deliverables,
      unlinked_attachments: unlinkedAttachments,
      // Lo comprometido en el contrato. No se cruza con las cuotas porque no
      // comparten llave —una entrega es un compromiso escrito, no dinero que
      // Finanzas cobre— así que se muestra al lado, para comparar fechas.
      contract_deliverables: contractDeliverables.map((d) => ({
        id: d.id,
        contract_id: d.contract_id,
        contract_status: d.contract_status,
        position: d.position,
        avance: d.avance,
        due_date: isoDay(d.due_date)
      })),
      counts,
      // Un proyecto "al día" no tiene nada retenido, nada sin subir y nada
      // vencido. Es lo que permite esconder de un golpe lo que no necesita
      // atención.
      needs_attention: counts.retenido > 0 || counts.falta_trabajo > 0 || counts.overdue > 0
    };
  }
}

function shapeUpdate(update) {
  return {
    update_id: update.id,
    project_id: update.project_id,
    income_id: update.income_id,
    content: update.content,
    attachment_original_name: update.attachment_original_name,
    has_attachment: Boolean(update.attachment_filename),
    author_name: update.author_name,
    created_at: update.created_at
  };
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

/**
 * Las entregas vienen ordenadas por contrato más reciente primero: se queda el
 * primer contrato que aparece por lead. Mostrar las entregas de dos contratos
 * mezcladas haría ver compromisos duplicados (una reprogramación emite un
 * contrato nuevo con el plan corregido).
 */
function latestContractPerLead(rows) {
  const byLead = new Map();
  const chosenContract = new Map();
  for (const row of rows) {
    if (!chosenContract.has(row.lead_id)) chosenContract.set(row.lead_id, row.contract_id);
    if (chosenContract.get(row.lead_id) !== row.contract_id) continue;
    if (!byLead.has(row.lead_id)) byLead.set(row.lead_id, []);
    byLead.get(row.lead_id).push(row);
  }
  return byLead;
}

function emptyTotals() {
  return {
    projects: 0,
    projects_needing_attention: 0,
    deliverables: 0,
    entregado: 0,
    retenido: 0,
    falta_trabajo: 0,
    pendiente: 0,
    overdue: 0,
    unlinked_attachments: 0
  };
}

function countStates(deliverables) {
  const counts = { entregado: 0, retenido: 0, falta_trabajo: 0, pendiente: 0, overdue: 0, total: deliverables.length };
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
    totals.unlinked_attachments += project.unlinked_attachments.length;
  }
  return totals;
}
