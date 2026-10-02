/**
 * Aviso automático de "se creó un proyecto nuevo".
 *
 * Un proyecto nace casi siempre **solo**: cuando una venta se cierra en el
 * Funnel de Ventas, el sistema lo crea sin que nadie lo pida. Hasta ahora eso
 * no se le contaba a nadie, así que el equipo se enteraba cuando entraba a
 * mirar la pantalla — y mientras tanto el proyecto ya existía, con su cliente
 * esperando que alguien lo tomara.
 *
 * Es un aviso, no parte de la creación: nada de lo que pase acá puede impedir
 * que el proyecto se cree (ver cómo lo llama `projectService`).
 *
 * **Sin importes.** En Proyectos no se muestra dinero: el primer pago se nombra
 * por su código, igual que en el resto del módulo. El detalle del cobro se
 * consulta en Finanzas, que tiene su propio permiso.
 */
export class ProjectNoticeService {
  constructor({ emailService, notificationService, projectSettingsService } = {}) {
    this.emailService = emailService;
    this.notificationService = notificationService;
    this.projectSettingsService = projectSettingsService;
  }

  /**
   * A quién le llega el aviso: el correo configurado en la pantalla de
   * Proyectos. Uno solo, por la misma razón que en Entregables — repartirlo
   * entre todos lo convierte en ruido que nadie termina de mirar.
   */
  async noticeRecipient() {
    const settings = await this.projectSettingsService?.get();
    const configured = (settings?.noticeEmail || '').trim();
    if (configured) return configured;

    const fallback = (process.env.INTERNAL_ALERT_EMAIL || '').trim();
    return fallback || null;
  }

  /**
   * Avisa de un proyecto recién creado. No lanza nunca: un fallo de correo no
   * puede romper el cierre de una venta.
   *
   * `origin` dice de dónde salió: `lead` (una venta cerrada) o `manual` (lo
   * creó alguien a mano). No es lo mismo para quien lo lee — uno hay que
   * tomarlo, el otro ya lo está tomando alguien.
   */
  async notifyProjectCreated(project, { origin = 'lead', createdByName = null, clientName = null } = {}) {
    try {
      if (!project?.id) return { sent: false, reason: 'sin_proyecto' };

      const notice = buildProjectCreatedNotice({ project, origin, createdByName, clientName });

      // La campana del panel primero: es lo que queda registrado aunque el
      // correo no salga (SMTP caído, destinatario mal puesto).
      await this.notificationService?.create({
        type: 'project_created',
        title: notice.title,
        body: notice.notificationBody,
        link: `/admin/projects/${project.id}`
      });

      const recipient = await this.noticeRecipient();
      if (!recipient) {
        console.warn(`⚠️ [Proyectos] Proyecto #${project.id} creado sin destinatario para el aviso `
          + '(no hay correo guardado en Proyectos ni INTERNAL_ALERT_EMAIL).');
        return { sent: false, reason: 'sin_destinatario' };
      }

      await this.emailService?.sendInternalAlertEmail(recipient, {
        subject: notice.title,
        title: notice.title,
        bodyText: notice.body,
        actionUrl: projectUrl(project.id),
        actionLabel: 'Abrir el proyecto'
      });

      console.log(`📧 [Proyectos] Aviso de proyecto nuevo #${project.id} enviado a ${recipient}.`);
      return { sent: true, recipient };
    } catch (error) {
      console.error('❌ [Proyectos] Error al avisar del proyecto nuevo:', error.message);
      return { sent: false, reason: 'error', error: error.message };
    }
  }

  /**
   * Envío de prueba: el mismo correo que saldría de verdad, con datos de
   * ejemplo y dicho desde el asunto. Existe porque un correo que se manda solo
   * y a una sola persona es justamente el que nadie descubre que está roto.
   */
  async sendTestNotice(recipient) {
    const to = (recipient || '').trim() || await this.noticeRecipient();
    if (!to) {
      const error = new Error('No hay a quién mandarle la prueba: guarda primero un correo.');
      error.code = 'NO_RECIPIENT';
      throw error;
    }

    const notice = buildProjectCreatedNotice(SAMPLE_NOTICE_DATA);
    const result = await this.emailService?.sendInternalAlertEmail(to, {
      subject: `[PRUEBA] ${notice.title}`,
      title: `[PRUEBA] ${notice.title}`,
      bodyText: 'Este es un correo de prueba enviado desde el módulo de Proyectos.\n'
        + 'Los datos de abajo son inventados; un aviso de verdad se ve exactamente así.\n'
        + '\n'
        + '------------------------------------------------------------\n'
        + `${notice.body}`,
      actionUrl: projectUrl(0),
      actionLabel: 'Abrir el proyecto'
    });

    if (result && result.success === false) {
      const error = new Error(result.error || 'El servidor de correo rechazó el envío.');
      error.code = 'SEND_FAILED';
      throw error;
    }
    return { sent: true, recipient: to };
  }
}

/** Datos de ejemplo del envío de prueba, con la misma forma que los de verdad. */
const SAMPLE_NOTICE_DATA = {
  project: {
    id: 0,
    topic: 'Tesis de ejemplo para probar el aviso',
    client_email: 'maria.ejemplo@correo.com',
    client_phone: '987 654 321',
    academic_level: 'Pregrado (Bachiller/Título)',
    field_of_study: 'Administración',
    deadline: null,
    is_locked: true,
    initial_payment: { code: 'EJEMPLO-001', estado: 'pagado' }
  },
  origin: 'lead',
  createdByName: 'Ventas',
  clientName: 'María Ejemplo Rodríguez'
};

/** El enlace al proyecto, solo si el entorno sabe cuál es su dirección pública. */
function projectUrl(projectId) {
  const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/admin/projects/${projectId}` : null;
}

/**
 * El texto del aviso, separado del envío para poder leerlo y probarlo sin base
 * de datos ni servidor de correo.
 */
export function buildProjectCreatedNotice({ project, origin = 'lead', createdByName = null, clientName = null }) {
  const client = clientName || project?.client_email || 'Cliente sin nombre';
  const title = `Proyecto nuevo: ${client} · ${project?.topic || 'Sin tema'}`;

  const lines = [
    origin === 'manual'
      ? `Se registró un proyecto a mano${createdByName ? ` (lo creó ${createdByName})` : ''}.`
      : 'Se cerró una venta en el Funnel de Ventas y el proyecto se creó solo.',
    ''
  ];

  lines.push('CLIENTE');
  lines.push(`Nombre: ${client}`);
  lines.push(`Correo: ${project?.client_email || '—'}`);
  lines.push(`Celular: ${project?.client_phone || '—'}`);
  const studies = [project?.academic_level, project?.field_of_study].filter(Boolean).join(' · ');
  if (studies) lines.push(`Estudios: ${studies}`);
  lines.push('');

  lines.push('PROYECTO');
  lines.push(`Tema: ${project?.topic || '—'}`);
  lines.push(`Fecha límite: ${project?.deadline ? formatDay(project.deadline) : 'todavía sin definir'}`);
  lines.push(`Estado: ${project?.status || 'Creado'}`);
  lines.push('');

  // El bloqueo se nombra por el CÓDIGO del pago, nunca por su monto: es la
  // misma regla que sigue el resto del módulo de Proyectos.
  if (project?.is_locked) {
    lines.push('⚠️ Está bloqueado hasta que Finanzas verifique el primer pago'
      + `${project?.initial_payment?.code ? ` (${project.initial_payment.code})` : ''}.`);
    lines.push('Hasta entonces se puede consultar pero no gestionar: ni tareas, ni equipo, ni avances.');
  } else {
    lines.push('Ya se puede trabajar: asignar líder y colaboradores, cargar las tareas y planificar las entregas.');
  }

  return {
    title,
    body: lines.join('\n'),
    // La campana del panel no tiene espacio para el detalle.
    notificationBody: `${project?.topic || 'Proyecto nuevo'} · ${client}`
      + (project?.is_locked ? ' — bloqueado hasta que se verifique el primer pago.' : '')
  };
}

/**
 * Las fechas de estas tablas son días de calendario, no instantes: mysql2 las
 * devuelve como `Date` a medianoche local y pasarlas por `toISOString()` las
 * corre un día hacia atrás.
 */
function formatDay(value) {
  if (!value) return '—';
  if (value instanceof Date) {
    const day = String(value.getDate()).padStart(2, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${value.getFullYear()}`;
  }
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}
