import { db } from '../db/connection.js';

/**
 * Servicio de acceso a datos para las tareas de un proyecto (lista de
 * pendientes + tablero Kanban).
 *
 * Una tarea puede colgar de un entregable (`deliverable_id`): así "Capítulo I y
 * II" deja de ser un título suelto en el plan y pasa a ser el paquete de
 * trabajo que hay que terminar para poder entregarlo. Es opcional — hay tareas
 * internas que no corresponden a ninguna entrega (ver la migración
 * `20261028000000_alter_tasks_add_deliverable_id.js`).
 */
export class TaskService {
  async createTask(projectId, title, { deliverableId = null } = {}) {
    const [id] = await db('tasks').insert({
      project_id: projectId,
      title,
      status: 'pendiente',
      deliverable_id: await this.#validDeliverableId(projectId, deliverableId)
    });
    return this.getTaskById(id);
  }

  async getTasksByProject(projectId) {
    return db('tasks').where({ project_id: projectId }).orderBy('created_at', 'asc');
  }

  async getTaskById(id) {
    return db('tasks').where({ id }).first();
  }

  async updateTaskStatus(id, status) {
    await db('tasks').where({ id }).update({ status });
    return this.getTaskById(id);
  }

  /**
   * Mueve la tarea a otro entregable, o la deja suelta (`null`). El entregable
   * tiene que ser del MISMO proyecto: si no, una tarea aparecería contando el
   * avance de un entregable de otro cliente.
   */
  async setTaskDeliverable(id, deliverableId) {
    const task = await this.getTaskById(id);
    if (!task) return null;
    await db('tasks').where({ id }).update({
      deliverable_id: await this.#validDeliverableId(task.project_id, deliverableId)
    });
    return this.getTaskById(id);
  }

  async deleteTask(id) {
    return db('tasks').where({ id }).del();
  }

  /**
   * Cuántas tareas tiene cada entregable y cuántas están completadas. Una
   * consulta para todo el proyecto en vez de una por entregable.
   */
  async countsByDeliverable(projectId) {
    const rows = await db('tasks')
      .where({ project_id: projectId })
      .whereNotNull('deliverable_id')
      .select('deliverable_id')
      .count('* as total')
      .sum({ done: db.raw("CASE WHEN status = 'completado' THEN 1 ELSE 0 END") })
      .groupBy('deliverable_id');

    const byDeliverable = new Map();
    for (const row of rows) {
      byDeliverable.set(Number(row.deliverable_id), {
        total: Number(row.total) || 0,
        done: Number(row.done) || 0
      });
    }
    return byDeliverable;
  }

  /**
   * `null` si no se indicó entregable; si se indicó, se comprueba que exista y
   * que sea de este proyecto. Mandar uno ajeno es un error de quien llama, no
   * algo que haya que guardar a medias.
   */
  async #validDeliverableId(projectId, deliverableId) {
    if (deliverableId === null || deliverableId === undefined || deliverableId === '') return null;

    const id = Number(deliverableId);
    if (!Number.isInteger(id)) throw invalidDeliverable('El entregable indicado no es válido.');

    const deliverable = await db('deliverables').where({ id }).first('id', 'project_id');
    if (!deliverable || Number(deliverable.project_id) !== Number(projectId)) {
      throw invalidDeliverable('Ese entregable no pertenece a este proyecto.');
    }
    return id;
  }
}

/**
 * Pedir un entregable de otro proyecto es un error de quien llama, no una falla
 * del servidor: el código deja que la ruta responda 400 en vez de 500.
 */
function invalidDeliverable(message) {
  const error = new Error(message);
  error.code = 'INVALID_DELIVERABLE';
  return error;
}
