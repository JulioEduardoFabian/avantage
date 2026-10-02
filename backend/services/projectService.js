import fs from 'fs';
import path from 'path';
import { db } from '../db/connection.js';
import { uploadDir as projectUploadDir } from '../middleware/upload.js';

/**
 * Estado con el que nace un proyecto recién ganado, todavía sin el primer pago
 * verificado, y estado al que pasa cuando finanzas lo verifica.
 */
export const PROJECT_STATUS_LOCKED = 'Creado';
export const PROJECT_STATUS_ACTIVE = 'Activo';

/**
 * Añade a cada proyecto el pago inicial de su lead (`initial_payment`) y si eso
 * lo mantiene bloqueado (`is_locked`).
 *
 * El bloqueo se deriva del ingreso, no se guarda en el proyecto: así no hay dos
 * fuentes de verdad que puedan desincronizarse. Un proyecto sin pago inicial
 * registrado —los creados a mano y todos los anteriores a este flujo— no se
 * bloquea nunca.
 */
async function attachPaymentGate(rows) {
  if (rows.length === 0) return rows;
  const leadIds = rows.map((r) => r.lead_id).filter(Boolean);
  if (leadIds.length === 0) {
    return rows.map((r) => ({ ...r, initial_payment: null, is_locked: false }));
  }

  const payments = await db('finance_income')
    .whereIn('lead_id', leadIds)
    .where('is_initial_payment', true)
    .select('id', 'lead_id', 'code', 'monto', 'estado')
    .orderBy('id', 'asc');

  const byLead = new Map();
  for (const p of payments) {
    if (!byLead.has(p.lead_id)) byLead.set(p.lead_id, p);
  }

  return rows.map((row) => {
    const payment = row.lead_id ? byLead.get(row.lead_id) || null : null;
    return {
      ...row,
      initial_payment: payment,
      is_locked: Boolean(payment) && payment.estado !== 'verificado'
    };
  });
}

/**
 * Servicio de acceso a datos para los proyectos generados automáticamente
 * cuando un lead alcanza el estado final del funnel de ventas ("ganado").
 */
export class ProjectService {
  /**
   * `projectNoticeService` avisa al equipo de que nació un proyecto. Se dispara
   * desde acá y no desde las rutas porque hay TRES caminos de alta (lead
   * ganado, cierre con pago inicial y alta manual): puesto en cada ruta, el
   * cuarto que se agregue se olvida.
   */
  constructor({ clientAccountService, emailService, projectNoticeService } = {}) {
    this.clientAccountService = clientAccountService;
    this.emailService = emailService;
    this.projectNoticeService = projectNoticeService;
  }

  /**
   * Avisa de un proyecto recién creado sin hacer esperar a quien lo creó: el
   * aviso es un efecto secundario y un correo lento o caído no puede demorar
   * —ni mucho menos tumbar— el cierre de una venta.
   */
  #announceCreated(project, context) {
    this.projectNoticeService?.notifyProjectCreated(project, context).catch(() => {});
  }

  /**
   * Da de alta (si no existía) la cuenta del portal para el correo del
   * cliente y le manda la invitación por correo. Nunca debe tumbar la
   * creación del proyecto: cualquier falla acá solo se loguea, igual que el
   * resto de los efectos secundarios de notificación del sistema.
   */
  async #inviteClientToPortal(email, name) {
    if (!this.clientAccountService || !this.emailService || !email) return;
    try {
      const { account, isNew } = await this.clientAccountService.ensureAccountForEmail(email, name);
      if (!isNew) return;

      const activationUrl = `${(process.env.APP_BASE_URL || '').replace(/\/$/, '')}/portal/activar?token=${account.activation_token}`;
      const result = await this.emailService.sendClientPortalInviteEmail(account.email, { name, activationUrl });
      if (result?.success) {
        console.log(`📧 [Portal] Invitación enviada a ${account.email}${result.previewUrl ? ` (preview: ${result.previewUrl})` : ''}`);
      } else {
        console.warn(`⚠️ [Portal] No se pudo enviar la invitación a ${account.email}:`, result?.error);
      }
    } catch (error) {
      console.error(`❌ [Portal] Error al invitar al cliente ${email}:`, error.message);
    }
  }

  async createProjectFromLead(lead) {
    const existing = await db('projects').where({ lead_id: lead.id }).first();
    if (existing) return existing;

    const [id] = await db('projects').insert({
      lead_id: lead.id,
      topic: lead.topic,
      client_email: lead.email,
      client_phone: lead.phone,
      academic_level: lead.academic_level,
      field_of_study: lead.field_of_study,
      status: 'Creado'
    });
    await this.#inviteClientToPortal(lead.email, lead.full_name);

    const project = await this.getProjectById(id);
    this.#announceCreated(project, { origin: 'lead', clientName: lead.full_name || null });
    return project;
  }

  /**
   * Crea un proyecto manualmente, sin que provenga de un lead ganado en el funnel.
   */
  async createManualProject({ topic, clientEmail, clientPhone, academicLevel, fieldOfStudy, deadline, createdByName = null }) {
    const [id] = await db('projects').insert({
      lead_id: null,
      topic,
      client_email: clientEmail,
      client_phone: clientPhone,
      academic_level: academicLevel,
      field_of_study: fieldOfStudy,
      deadline: deadline || null,
      status: 'Creado'
    });
    await this.#inviteClientToPortal(clientEmail, null);

    const project = await this.getProjectById(id);
    this.#announceCreated(project, { origin: 'manual', createdByName });
    return project;
  }

  /** Proyectos del cliente autenticado en el portal, por su correo. */
  async getProjectsByClientEmail(email) {
    const rows = await db('projects')
      .select(
        'projects.*',
        db.raw('COUNT(tasks.id) as total_tasks'),
        db.raw("SUM(CASE WHEN tasks.status = 'completado' THEN 1 ELSE 0 END) as completed_tasks")
      )
      .leftJoin('tasks', 'tasks.project_id', 'projects.id')
      .where('projects.client_email', email)
      .groupBy('projects.id')
      .orderBy('projects.created_at', 'desc');

    return attachPaymentGate(rows.map(this.withProgress));
  }

  /**
   * El listado de Proyectos. Trae además **quién lo trabaja** (líder y
   * colaboradores) y el nombre del cliente, que vive en el lead: la tabla los
   * muestra como círculos y antes había que entrar a cada proyecto para saber
   * de quién era.
   *
   * Los colaboradores se piden en UNA consulta para todos los proyectos y se
   * reparten acá: una por fila convertía abrir la pantalla en N+1 consultas.
   */
  async getAllProjects() {
    const rows = await db('projects')
      .select(
        'projects.*',
        db.raw('MAX(leader.name) as leader_name'),
        db.raw('MAX(lead.full_name) as client_name'),
        db.raw('COUNT(tasks.id) as total_tasks'),
        db.raw("SUM(CASE WHEN tasks.status = 'completado' THEN 1 ELSE 0 END) as completed_tasks")
      )
      .leftJoin('tasks', 'tasks.project_id', 'projects.id')
      .leftJoin('users as leader', 'leader.id', 'projects.leader_id')
      .leftJoin('leads as lead', 'lead.id', 'projects.lead_id')
      .groupBy('projects.id')
      .orderBy('projects.created_at', 'desc');

    const collaboratorsByProject = await this.#collaboratorsByProject(rows.map((row) => row.id));
    const withTeam = rows.map((row) => ({
      ...this.withProgress(row),
      collaborators: collaboratorsByProject.get(row.id) || []
    }));

    return attachPaymentGate(withTeam);
  }

  /** Los colaboradores de varios proyectos de una sola vez, agrupados por proyecto. */
  async #collaboratorsByProject(projectIds) {
    const byProject = new Map();
    if (projectIds.length === 0) return byProject;

    const rows = await db('project_collaborators')
      .join('users', 'users.id', 'project_collaborators.user_id')
      .whereIn('project_collaborators.project_id', projectIds)
      .select('project_collaborators.project_id', 'users.id', 'users.name')
      .orderBy('users.name', 'asc');

    for (const row of rows) {
      if (!byProject.has(row.project_id)) byProject.set(row.project_id, []);
      byProject.get(row.project_id).push({ id: row.id, name: row.name });
    }
    return byProject;
  }

  async getProjectById(id) {
    const [row] = await db('projects')
      .leftJoin('users as leader', 'leader.id', 'projects.leader_id')
      // La universidad vive en el lead, no en el proyecto: se trae de ahí para
      // poder sugerir la plantilla de tareas que le corresponde.
      .leftJoin('leads as lead', 'lead.id', 'projects.lead_id')
      .select(
        'projects.*',
        db.raw('MAX(leader.name) as leader_name'),
        db.raw('MAX(lead.university) as university'),
        db.raw('COUNT(tasks.id) as total_tasks'),
        db.raw("SUM(CASE WHEN tasks.status = 'completado' THEN 1 ELSE 0 END) as completed_tasks")
      )
      .leftJoin('tasks', 'tasks.project_id', 'projects.id')
      .where('projects.id', id)
      .groupBy('projects.id');

    if (!row) return undefined;

    const collaborators = await this.getCollaborators(id);
    const [withGate] = await attachPaymentGate([this.withProgress(row)]);
    return { ...withGate, collaborators };
  }

  /**
   * Puerta que usan las rutas que modifican un proyecto: mientras el primer
   * pago no esté verificado por finanzas, el proyecto se puede mirar pero no
   * gestionar. Devuelve el proyecto si se puede tocar; lanza si no.
   */
  async assertManageable(id) {
    const project = await this.getProjectById(id);
    if (!project) return null;
    if (project.is_locked) {
      // Sin el monto a propósito: en el módulo de proyectos no se muestran
      // importes — el dinero se consulta en Finanzas, con su propio permiso.
      const error = new Error(
        `Este proyecto está a la espera de que Finanzas verifique el primer pago ` +
        `(${project.initial_payment?.code || 'ingreso'}). Hasta entonces solo se puede consultar.`
      );
      error.code = 'PROJECT_LOCKED';
      throw error;
    }
    return project;
  }

  /**
   * Sincroniza el estado del proyecto de un lead con la verificación de su
   * pago inicial. Solo mueve la pareja "Creado" ⇄ "Activo": si el equipo ya
   * avanzó el proyecto a otro estado, no se le toca.
   */
  async syncStatusWithPayment(leadId, { verified } = {}) {
    if (!leadId) return null;
    const project = await db('projects').where({ lead_id: leadId }).first();
    if (!project) return null;

    const from = verified ? PROJECT_STATUS_LOCKED : PROJECT_STATUS_ACTIVE;
    const to = verified ? PROJECT_STATUS_ACTIVE : PROJECT_STATUS_LOCKED;
    if (project.status !== from) return this.getProjectById(project.id);

    await db('projects').where({ id: project.id }).update({ status: to });
    return this.getProjectById(project.id);
  }

  /**
   * Edita los datos del proyecto (tema, cliente, nivel, carrera, plazo).
   *
   * No pasa por la puerta del pago verificado: el bloqueo existe para que no
   * se trabaje un proyecto todavía sin cobrar, no para impedir corregir el
   * correo o el celular con el que se creó. Solo se tocan los campos que
   * llegan, para que la pantalla pueda mandar un formulario parcial.
   */
  async updateProject(id, { topic, clientEmail, clientPhone, academicLevel, fieldOfStudy, deadline }) {
    const project = await db('projects').where({ id }).first();
    if (!project) return null;

    const changes = {};
    if (topic !== undefined) {
      const clean = String(topic).trim();
      if (!clean) throw new Error('El tema/nombre del proyecto es requerido.');
      changes.topic = clean;
    }
    if (clientEmail !== undefined) {
      const clean = String(clientEmail).trim();
      if (!clean.includes('@')) throw new Error('Proporcione un correo de cliente válido.');
      changes.client_email = clean;
    }
    if (clientPhone !== undefined) changes.client_phone = String(clientPhone).trim() || null;
    if (academicLevel !== undefined) changes.academic_level = String(academicLevel).trim() || null;
    if (fieldOfStudy !== undefined) changes.field_of_study = String(fieldOfStudy).trim() || null;
    if (deadline !== undefined) changes.deadline = deadline || null;

    if (Object.keys(changes).length > 0) await db('projects').where({ id }).update(changes);

    // El correo del cliente es su identidad en el portal: si cambia, hay que
    // darle de alta la cuenta nueva o nunca vería este proyecto.
    if (changes.client_email && changes.client_email !== project.client_email) {
      await this.#inviteClientToPortal(changes.client_email, null);
    }
    return this.getProjectById(id);
  }

  /**
   * Borra el proyecto y todo lo que cuelga de él (tareas, colaboradores y
   * línea de tiempo caen por CASCADE en la base). Los adjuntos de los hitos se
   * borran del disco acá, porque de esos la base no sabe nada.
   *
   * Lo que NO se toca es el dinero: los ingresos del lead siguen en Finanzas,
   * que es donde tienen que cuadrar con el banco aunque el proyecto se haya
   * creado por error.
   */
  async deleteProject(id) {
    const project = await db('projects').where({ id }).first();
    if (!project) return null;

    const attachments = await db('project_updates')
      .where({ project_id: id })
      .whereNotNull('attachment_filename')
      .select('attachment_filename');

    await db('projects').where({ id }).del();

    for (const { attachment_filename: filename } of attachments) {
      fs.unlink(path.join(projectUploadDir, filename), () => {});
    }
    return project;
  }

  async updateProjectStatus(id, status) {
    await db('projects').where({ id }).update({ status });
    return this.getProjectById(id);
  }

  async updateDeadline(id, deadline) {
    await db('projects').where({ id }).update({ deadline: deadline || null });
    return this.getProjectById(id);
  }

  async updateLeader(id, leaderId) {
    let validLeaderId = null;
    if (leaderId) {
      const userExists = await db('users').where({ id: leaderId }).first();
      if (userExists) validLeaderId = leaderId;
    }
    await db('projects').where({ id }).update({ leader_id: validLeaderId });
    return this.getProjectById(id);
  }

  async getCollaborators(projectId) {
    return db('project_collaborators')
      .join('users', 'users.id', 'project_collaborators.user_id')
      .where('project_collaborators.project_id', projectId)
      .select('users.id', 'users.name', 'users.email')
      .orderBy('users.name', 'asc');
  }

  async addCollaborator(projectId, userId) {
    if (userId) {
      const userExists = await db('users').where({ id: userId }).first();
      if (!userExists) {
        throw new Error('El usuario seleccionado ya no existe en el sistema.');
      }
    }
    const existing = await db('project_collaborators').where({ project_id: projectId, user_id: userId }).first();
    if (!existing) {
      await db('project_collaborators').insert({ project_id: projectId, user_id: userId });
    }
    return this.getProjectById(projectId);
  }

  async removeCollaborator(projectId, userId) {
    await db('project_collaborators').where({ project_id: projectId, user_id: userId }).del();
    return this.getProjectById(projectId);
  }

  withProgress(row) {
    const totalTasks = Number(row.total_tasks) || 0;
    const completedTasks = Number(row.completed_tasks) || 0;
    return {
      ...row,
      total_tasks: totalTasks,
      completed_tasks: completedTasks,
      progress_percentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    };
  }
}
