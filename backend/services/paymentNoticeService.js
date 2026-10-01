import { db } from '../db/connection.js';

/**
 * Aviso automático de "esta cuota ya está verificada".
 *
 * Verificar un pago es el momento en que el trabajo atado a esa cuota se
 * desbloquea: hasta entonces el módulo de Entregables no deja marcarlo como
 * entregado (ver `blocksDelivery()` en `deliverableService.js`). Ese momento
 * ocurre en Finanzas, en otra pantalla y casi siempre a cargo de otra persona,
 * así que quien tiene que entregar no se enteraba — salvo que se acordara de
 * entrar a mirar. Este aviso cierra ese hueco.
 *
 * Es un aviso, no parte de la verificación: nada de lo que pase acá puede
 * impedir que el pago quede verificado (ver cómo lo llama la ruta).
 *
 * **Sin importes.** El correo nombra la cuota por su código, igual que los
 * módulos de Proyectos y Entregables: el dinero se consulta en Finanzas, que
 * tiene su propio permiso, y quien recibe este aviso no tiene por qué tenerlo.
 */
export class PaymentNoticeService {
  constructor({ emailService, notificationService, deliverableSettingsService } = {}) {
    this.emailService = emailService;
    this.notificationService = notificationService;
    this.deliverableSettingsService = deliverableSettingsService;
  }

  /**
   * A quién le llega el aviso: el correo configurado en la pantalla de
   * Entregables.
   *
   * Es UNO solo a propósito. De las entregas se encarga una persona, y repartir
   * el aviso entre todos los que pueden abrir el módulo lo convierte en ruido
   * que nadie termina de mirar. `INTERNAL_ALERT_EMAIL` queda como red de
   * seguridad para que un aviso no se pierda en silencio mientras nadie
   * configuró el campo.
   */
  async noticeRecipient() {
    const settings = await this.deliverableSettingsService?.get();
    const configured = (settings?.noticeEmail || '').trim();
    if (configured) return configured;

    const fallback = (process.env.INTERNAL_ALERT_EMAIL || '').trim();
    return fallback || null;
  }

  /**
   * Envío de prueba: el mismo correo que saldría de verdad, con datos de
   * ejemplo y dicho desde el asunto. Existe porque un correo que se manda solo,
   * cada tanto y a una sola persona es justamente el que nadie descubre que
   * está roto — y cuando se descubre, ya se perdieron entregas.
   */
  async sendTestNotice(recipient) {
    const to = (recipient || '').trim() || await this.noticeRecipient();
    if (!to) {
      const error = new Error('No hay a quién mandarle la prueba: guarda primero un correo.');
      error.code = 'NO_RECIPIENT';
      throw error;
    }

    const notice = buildVerifiedPaymentNotice(SAMPLE_NOTICE_DATA);
    const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
    const result = await this.emailService?.sendInternalAlertEmail(to, {
      subject: `[PRUEBA] ${notice.title}`,
      title: `[PRUEBA] ${notice.title}`,
      bodyText: 'Este es un correo de prueba enviado desde el módulo de Entregables.\n'
        + 'Los datos de abajo son inventados; un aviso de verdad se ve exactamente así.\n'
        + '\n'
        + '------------------------------------------------------------\n'
        + `${notice.body}`,
      actionUrl: base ? `${base}/admin/entregables` : null,
      actionLabel: 'Abrir Entregables'
    });

    if (result && result.success === false) {
      const error = new Error(result.error || 'El servidor de correo rechazó el envío.');
      error.code = 'SEND_FAILED';
      throw error;
    }
    return { sent: true, recipient: to };
  }

  /**
   * Arma y manda el aviso de una cuota recién verificada. No lanza nunca: un
   * fallo de correo no puede romper la verificación ni la respuesta de la API.
   */
  async notifyIncomeVerified(income, { verifiedBy = null } = {}) {
    try {
      if (!income?.id) return { sent: false, reason: 'sin_ingreso' };

      const lead = income.lead_id ? await db('leads').where({ id: income.lead_id }).first() : null;
      const project = income.lead_id ? await db('projects').where({ lead_id: income.lead_id }).first() : null;
      const deliverables = await db('deliverables')
        .where({ income_id: income.id })
        .orderBy('position', 'asc')
        .orderBy('id', 'asc')
        .select('title', 'due_date', 'status', 'delivered_at');

      const notice = buildVerifiedPaymentNotice({
        income,
        lead,
        project,
        deliverables,
        verifiedByName: verifiedBy?.name || null
      });

      // La campana del panel primero: es lo que queda registrado aunque el
      // correo no salga (SMTP caído, destinatario mal puesto).
      await this.notificationService?.create({
        type: 'income_verified',
        title: notice.title,
        body: notice.notificationBody,
        link: project ? '/admin/entregables' : '/admin/finanzas'
      });

      const recipient = await this.noticeRecipient();
      if (!recipient) {
        console.warn(`⚠️ [Finanzas] Cuota ${income.code} verificada sin destinatario para el aviso `
          + '(no hay correo guardado en Entregables ni INTERNAL_ALERT_EMAIL).');
        return { sent: false, reason: 'sin_destinatario' };
      }

      const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
      await this.emailService?.sendInternalAlertEmail(recipient, {
        subject: notice.title,
        title: notice.title,
        bodyText: notice.body,
        actionUrl: base ? `${base}/admin/entregables` : null,
        actionLabel: 'Abrir Entregables'
      });

      console.log(`📧 [Finanzas] Aviso de cuota verificada ${income.code} enviado a ${recipient}.`);
      return { sent: true, recipient };
    } catch (error) {
      console.error('❌ [Finanzas] Error al avisar de la cuota verificada:', error.message);
      return { sent: false, reason: 'error', error: error.message };
    }
  }
}

/**
 * Datos de ejemplo del envío de prueba. Son inventados pero con la misma forma
 * que los de verdad —cuota con código, un entregable pendiente y otro ya
 * entregado— para que la prueba muestre el correo completo y no una versión
 * recortada que no se parece a lo que va a llegar.
 */
const SAMPLE_NOTICE_DATA = {
  income: { id: 0, code: 'EJEMPLO-001', cuota: '2da', due_date: '2026-10-03' },
  lead: {
    full_name: 'María Ejemplo Rodríguez',
    phone: '987 654 321',
    email: 'maria.ejemplo@correo.com',
    university: 'Universidad de Ejemplo',
    field_of_study: 'Administración'
  },
  project: { id: 0, topic: 'Tesis de ejemplo para probar el aviso' },
  deliverables: [
    { title: 'Capítulo I y II', due_date: '2026-10-03', status: 'pendiente' },
    { title: 'Resumen ejecutivo', due_date: '2026-09-28', status: 'entregado', delivered_at: '2026-09-29' }
  ],
  verifiedByName: 'Finanzas'
};

/**
 * El texto del aviso, separado del envío para poder leerlo y probarlo sin
 * base de datos ni servidor de correo.
 */
export function buildVerifiedPaymentNotice({ income, lead, project, deliverables = [], verifiedByName = null }) {
  const clientName = lead?.full_name || lead?.email || 'Cliente sin nombre';
  // "cuota 2da (20260930-3)": el número de cuota es como se habla del cobro y
  // el código es como se lo identifica sin decir el importe.
  const cuota = income?.cuota
    ? `cuota ${income.cuota}${income.code ? ` (${income.code})` : ''}`
    : (income?.code ? `cuota ${income.code}` : 'la cuota');

  const title = `Pago verificado: ${clientName} · ${cuota}`;

  const lines = [
    `Finanzas verificó la ${cuota} de ${clientName}.`
      + (verifiedByName ? ` Lo hizo ${verifiedByName}.` : ''),
    ''
  ];

  lines.push('CLIENTE');
  lines.push(`Nombre: ${clientName}`);
  lines.push(`Celular: ${lead?.phone || '—'}`);
  lines.push(`Correo: ${lead?.email || '—'}`);
  const studies = [lead?.university, lead?.field_of_study].filter(Boolean).join(' · ');
  if (studies) lines.push(`Estudios: ${studies}`);
  if (project?.topic) lines.push(`Proyecto: ${project.topic}`);
  lines.push('');

  lines.push('PAGO');
  lines.push(`Código: ${income?.code || '—'}`);
  if (income?.cuota) lines.push(`Cuota: ${income.cuota}`);
  if (income?.due_date) lines.push(`Fecha pactada: ${formatDay(income.due_date)}`);
  // El monto no va a propósito: ver la nota de la clase.
  lines.push('El importe se consulta en Finanzas.');
  lines.push('');

  lines.push('ENTREGABLES ATADOS A ESTA CUOTA');
  if (deliverables.length === 0) {
    lines.push('Ninguno: esta cuota no condiciona ningún entregable.');
    lines.push('Si tenía que haber uno, se agrega desde el módulo de Entregables.');
  } else {
    for (const item of deliverables) lines.push(`• ${deliverableLine(item)}`);
    const pending = deliverables.filter((item) => item.status !== 'entregado').length;
    lines.push('');
    lines.push(pending > 0
      ? `Ya se puede${pending === 1 ? '' : 'n'} marcar como entregado${pending === 1 ? '' : 's'} en el módulo de Entregables.`
      : 'Todos ya estaban entregados: no queda nada pendiente por esta cuota.');
  }

  return {
    title,
    body: lines.join('\n'),
    // La campana del panel no tiene espacio para el detalle: una línea que
    // diga qué pasó y cuánto queda por hacer.
    notificationBody: deliverables.length === 0
      ? `La ${cuota} de ${clientName} quedó verificada. No tiene entregables atados.`
      : `La ${cuota} de ${clientName} quedó verificada: ${deliverables.length} entregable(s) atado(s).`
  };
}

function deliverableLine(item) {
  const due = item.due_date ? ` — fecha pactada ${formatDay(item.due_date)}` : '';
  if (item.status === 'entregado') {
    return `${item.title}${due} — ya entregado${item.delivered_at ? ` el ${formatDay(item.delivered_at)}` : ''}`;
  }
  return `${item.title}${due} — FALTA ENTREGAR`;
}

/**
 * Las fechas de estas tablas son días de calendario, no instantes: mysql2 las
 * devuelve como `Date` a medianoche local y pasarlas por un `toISOString()`
 * las corre un día hacia atrás. Mismo criterio que `isoDay()` en
 * `deliverableService`.
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
