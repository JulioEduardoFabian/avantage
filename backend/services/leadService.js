import { db } from '../db/connection.js';
import { LeadStageChangeService } from './leadStageChangeService.js';
import { UserService } from './userService.js';
import {
  SETTER_ONLY_STATUSES,
  isSalesFunnelStatus,
  leadHasGraduated,
  loadSalesFunnelStatuses,
  loadWinningStatuses
} from './salesFunnelStage.js';
import { CommissionService } from './commissionService.js';

/**
 * Dígitos con los que se compara un teléfono.
 *
 * El mismo contacto llega con formatos distintos según la puerta por la que
 * entre: el bot guarda el `wa_id` crudo ("51987654321"), el formulario de Meta
 * y el alta manual guardan lo que escribió la persona ("+51 987 654 321",
 * "987654321"). Comparar las cadenas tal cual hacía que el bot NO encontrara al
 * lead que ya existía: le creaba un gemelo en "conversación abierta" y lo
 * trabajaba como si fuera nuevo — otra forma de ver "el lead volvió al Setter
 * Funnel" aunque el original siguiera cotizado en el funnel del closer.
 *
 * Se comparan los últimos 9 dígitos, que es el número nacional en Perú (el
 * prefijo 51 puede estar o no). Menos de 8 dígitos no identifica a nadie: ahí
 * se devuelve null y no se cruza con nada.
 */
export function phoneMatchKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.slice(-9);
}

/**
 * Lo que se escribe en la ficha al asignarla a alguien (o al soltarla).
 *
 * Escribe las DOS columnas a propósito: `assigned_user_id` es el enlace con la
 * cuenta —la verdad, la que sobrevive a que la persona cambie de nombre— y
 * `assigned_to` es la copia legible que ya leían la Base de Datos, el buscador
 * de los dos tableros y el bot. Dejar el texto viejo en pie haría que la misma
 * ficha dijera "Kevin" en una pantalla y "Lucía" en la otra.
 *
 * Es una función aparte y exportada porque es la regla del módulo: cualquier
 * camino nuevo de asignación tiene que pasar por acá para que las dos columnas
 * no se separen nunca.
 */
export function assignmentPatch(user) {
  if (!user) return { assigned_user_id: null, assigned_to: null };
  return { assigned_user_id: user.id, assigned_to: user.name };
}

/**
 * ¿Este texto libre que llega por `updateLead()` rompe el enlace con el usuario?
 *
 * La ficha de la Base de Datos manda `assignedTo` como texto en cada guardado,
 * casi siempre con el mismo nombre que ya tiene. Si eso soltara el enlace,
 * editar el DNI de un lead lo dejaría "sin asignar" en los tableros. Solo se
 * suelta cuando el texto nombra a otra persona (alguien de fuera del panel,
 * que es para lo que el campo libre sigue sirviendo).
 */
export function freeTextBreaksLink(lead, text) {
  if (!lead?.assigned_user_id) return false;
  const current = String(lead.assigned_to || '').trim().toLowerCase();
  return String(text || '').trim().toLowerCase() !== current;
}

/**
 * Quién le pasó este lead al closer, sellado en el momento de la graduación.
 *
 * Se guarda al entrar al Funnel de Ventas y nunca después: ahí el responsable
 * del lead todavía es la setter que lo trabajó, y apenas lo toma el closer la
 * ficha pasa a nombre de él. Calculada al cerrar la venta, la comisión sería
 * siempre del closer.
 *
 * Primero el responsable asignado (es el dato del trabajo real) y, si el lead
 * no tenía a nadie, la persona que hizo el pase. El bot no cuenta: cuando
 * gradúa un lead sin responsable no hay a quién comisionar, y eso es más
 * honesto que atribuírselo a cualquiera.
 */
export function setterSeal(lead, actor, actorType) {
  if (lead?.setter_user_id) return {};
  const setterId = lead?.assigned_user_id || (actorType === 'user' ? actor?.id : null);
  return setterId ? { setter_user_id: setterId } : {};
}

/** Los mismos dígitos, calculados en SQL sobre la columna `phone`. */
export const PHONE_MATCH_KEY_SQL = "RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(leads.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), 9)";

/**
 * Servicio de acceso a datos para los leads y prospectos (registro comercial de usuarios
 * del chatbot y prospectos capturados en la Base de Datos).
 */
export class LeadService {
  constructor({ stageChangeService, userService, commissionService } = {}) {
    this.stageChanges = stageChangeService || new LeadStageChangeService();
    this.users = userService || new UserService();
    this.commissions = commissionService || new CommissionService();
  }

  async createLead({
    topic,
    academicLevel,
    fieldOfStudy,
    email,
    phone,
    additionalNotes,
    overallViabilityScore,
    viabilityLevel,
    fullName,
    dni,
    gender,
    birthDate,
    university,
    thesisSituation,
    academicStatus,
    academicCycle,
    department,
    province,
    address,
    assignedTo,
    source,
    status,
    metaLeadgenId,
    metaFormId,
    metaAdId,
    metaAdsetId,
    metaCampaignId,
    metaPlatform,
    metaCreatedTime
  }) {
    /*
     * Si el responsable llega como texto y nombra a alguien del área comercial
     * (el alta manual lo elige de la lista del equipo), el lead nace ya
     * enlazado a esa cuenta. El valor por defecto —"Kevin", de cuando el campo
     * era texto libre— no corresponde a ninguna cuenta mientras nadie se llame
     * así en el panel: queda como nombre y el tablero lo muestra igual.
     */
    const assignedText = assignedTo || 'Kevin';
    const assignedUser = await this.users.findCommercialByName(assignedText);

    const [id] = await db('leads').insert({
      topic: topic || 'Asesoría de Tesis',
      academic_level: academicLevel || 'Pregrado (Bachiller/Título)',
      field_of_study: fieldOfStudy || 'General',
      email: email || '',
      phone: phone || '',
      additional_notes: additionalNotes || null,
      overall_viability_score: overallViabilityScore ?? null,
      viability_level: viabilityLevel || null,
      full_name: fullName || null,
      dni: dni || null,
      gender: gender || null,
      birth_date: birthDate || null,
      university: university || null,
      thesis_situation: thesisSituation || null,
      academic_status: academicStatus || null,
      academic_cycle: academicCycle ?? null,
      department: department || null,
      province: province || null,
      address: address || null,
      assigned_to: assignedUser ? assignedUser.name : assignedText,
      assigned_user_id: assignedUser ? assignedUser.id : null,
      source: source || 'Chatbot Web',
      status: status || 'nuevo',
      meta_leadgen_id: metaLeadgenId || null,
      meta_form_id: metaFormId || null,
      meta_ad_id: metaAdId || null,
      meta_adset_id: metaAdsetId || null,
      meta_campaign_id: metaCampaignId || null,
      meta_platform: metaPlatform || null,
      meta_created_time: metaCreatedTime ? new Date(metaCreatedTime) : null
    });
    return this.getLeadById(id);
  }

  async createProspect(data) {
    return this.createLead({
      fullName: data.fullName || data.full_name,
      phone: data.phone,
      email: data.email,
      dni: data.dni,
      gender: data.gender,
      birthDate: data.birthDate || data.birth_date,
      university: data.university,
      fieldOfStudy: data.fieldOfStudy || data.career || data.field_of_study,
      academicLevel: data.academicLevel || data.academic_level || 'Pregrado (Bachiller/Título)',
      thesisSituation: data.thesisSituation || data.thesis_situation,
      topic: data.topic || `Asesoría para ${data.fullName || 'Prospecto'}`,
      department: data.department,
      province: data.province,
      address: data.address,
      assignedTo: data.assignedTo || data.assigned_to || 'Kevin',
      source: data.source || 'Manual',
      status: data.status || 'nuevo',
      additionalNotes: data.additionalNotes || data.additional_notes || null,
      metaLeadgenId: data.metaLeadgenId,
      metaFormId: data.metaFormId,
      metaAdId: data.metaAdId,
      metaAdsetId: data.metaAdsetId,
      metaCampaignId: data.metaCampaignId,
      metaPlatform: data.metaPlatform,
      metaCreatedTime: data.metaCreatedTime
    });
  }

  /**
   * Todos los leads, o solo los de una persona.
   *
   * `viewerId` es el filtro de visibilidad del funnel: quien no administra el
   * área comercial (`leads.manage_all`) ve únicamente los leads que tiene
   * asignados. Se filtra en la consulta y no en la pantalla porque lo que no
   * viaja no se puede mirar con las herramientas del navegador.
   *
   * Los leads **sin responsable** no entran en esa vista: un lead que nadie
   * tiene asignado no es de nadie, y aparecerle a todos sería volver al tablero
   * compartido por la puerta de atrás. Los ve quien reparte, que es quien puede
   * hacer algo con ellos.
   */
  async getAllLeads({ viewerId = null } = {}) {
    const query = db('leads')
      .select(
        'leads.*',
        'projects.id as project_id',
        'projects.status as project_status',
        'pago.id as initial_payment_id',
        'pago.code as initial_payment_code',
        'pago.monto as initial_payment_monto',
        'pago.estado as initial_payment_estado',
        // El nombre se lee de `users` y no de la copia en `assigned_to`: así
        // renombrar a alguien en Roles y Permisos se ve al instante en los dos
        // tableros, sin reescribir leads.
        'asesor.name as assigned_user_name',
        'asesor.email as assigned_user_email',
        // Quién lo pasó al funnel de ventas y quién lo cerró: los dos sellos se
        // leen por nombre desde la ficha y desde Comisiones.
        'setter.name as setter_name',
        'closer.name as closer_name'
      )
      .leftJoin('projects', 'projects.lead_id', 'leads.id')
      .leftJoin('users as asesor', 'asesor.id', 'leads.assigned_user_id')
      .leftJoin('users as setter', 'setter.id', 'leads.setter_user_id')
      .leftJoin('users as closer', 'closer.id', 'leads.closer_user_id')
      .leftJoin('finance_income as pago', function () {
        this.on('pago.lead_id', '=', 'leads.id').andOn('pago.is_initial_payment', '=', db.raw('1'));
      })
      .orderBy('leads.created_at', 'desc');

    if (viewerId) query.where('leads.assigned_user_id', viewerId);
    return query;
  }

  /**
   * ¿Esta persona puede ver este lead? Es la misma regla de `getAllLeads()`,
   * escrita una vez para que la lista y la ficha no puedan discrepar: con el
   * permiso de administrador comercial, todo; sin él, solo lo propio.
   */
  canView(lead, user) {
    if (!lead) return false;
    if (user?.permissions?.includes('leads.manage_all')) return true;
    return Boolean(user?.id) && lead.assigned_user_id === user.id;
  }

  async findByAdditionalNotesContaining(text) {
    return db('leads').where('additional_notes', 'like', `%${text}%`).first();
  }

  /**
   * El lead ya importado de un `leadgen_id` de Meta, o nada.
   *
   * Mira la columna y TAMBIÉN el marcador viejo en las notas: los leads
   * anteriores a la migración de atribución tienen el id solo ahí, y la
   * conciliación los tiene que reconocer o los volvería a importar a todos
   * como si faltaran.
   */
  async findByMetaLeadgenId(leadgenId) {
    const id = String(leadgenId || '').trim();
    if (!id) return null;

    const byColumn = await db('leads').where({ meta_leadgen_id: id }).first();
    if (byColumn) return byColumn;

    return this.findByAdditionalNotesContaining(`[Meta leadgen_id=${id}]`);
  }

  /**
   * Cuelga un envío de formulario de Meta de un lead que YA existe con ese
   * teléfono, en vez de crear una segunda ficha de la misma persona.
   *
   * Los leads de formulario no se cruzaban por teléfono —solo por
   * `leadgen_id`— así que la misma persona que ya venía trabajándose por
   * WhatsApp, o que llenó el formulario dos veces, terminaba con dos filas. Y
   * una fila nueva en "conversación abierta" al lado de una que ya tenía cita
   * agendada o estaba ganada no es solo ruido: tapaba a la buena en los
   * índices por teléfono y el contacto desaparecía de las métricas de campaña.
   *
   * Nunca pisa el estado ni los datos que el equipo ya trabajó: suma el
   * marcador y las respuestas del formulario a las notas, y completa la
   * atribución de Meta solo si estaba vacía.
   */
  async attachMetaLeadToExisting(lead, { leadgenId, formId, adId, adsetId, campaignId, platform, createdTime, note }) {
    const patch = {};
    if (!lead.meta_leadgen_id && leadgenId) patch.meta_leadgen_id = leadgenId;
    if (!lead.meta_form_id && formId) patch.meta_form_id = formId;
    if (!lead.meta_ad_id && adId) patch.meta_ad_id = adId;
    if (!lead.meta_adset_id && adsetId) patch.meta_adset_id = adsetId;
    if (!lead.meta_campaign_id && campaignId) patch.meta_campaign_id = campaignId;
    if (!lead.meta_platform && platform) patch.meta_platform = platform;
    if (!lead.meta_created_time && createdTime) patch.meta_created_time = new Date(createdTime);

    // El marcador va SIEMPRE a las notas aunque la columna ya esté ocupada por
    // un envío anterior: es lo que hace que la conciliación reconozca este
    // leadgen_id como ya visto y no lo reporte como faltante para siempre.
    const notasPrevias = String(lead.additional_notes || '').trim();
    if (note && !notasPrevias.includes(`[Meta leadgen_id=${leadgenId}]`)) {
      patch.additional_notes = notasPrevias ? `${notasPrevias}

${note}` : note;
    }

    if (Object.keys(patch).length) await db('leads').where({ id: lead.id }).update(patch);
    return this.getLeadById(lead.id);
  }

  /**
   * Los `form_id` de Meta que ya produjeron al menos un lead acá.
   *
   * Es el plan B para descubrir formularios cuando la Graph API no deja
   * listarlos: `/{page_id}/leadgen_forms` exige `pages_manage_ads`, que es un
   * permiso que el token puede no tener, mientras que leer los leads de un
   * formulario solo pide `leads_retrieval`. Cubre todos los formularios menos
   * los que nunca entregaron un lead al CRM — y de esos no se puede saber que
   * existen sin preguntarle a Meta.
   */
  async getKnownMetaFormIds() {
    const rows = await db('leads')
      .distinct('meta_form_id')
      .whereNotNull('meta_form_id')
      .andWhere('meta_form_id', '!=', '');
    return rows.map((row) => row.meta_form_id);
  }

  /** Los `leadgen_id` ya guardados, para diferenciarlos contra los que
   * devuelve la Graph API sin traer un lead entero por cada uno. */
  async getKnownMetaLeadgenIds() {
    const rows = await db('leads')
      .select('meta_leadgen_id', 'additional_notes')
      .where((builder) => {
        builder.whereNotNull('meta_leadgen_id').orWhere('additional_notes', 'like', '%[Meta leadgen_id=%');
      });

    const ids = new Set();
    for (const row of rows) {
      if (row.meta_leadgen_id) ids.add(String(row.meta_leadgen_id));
      for (const m of String(row.additional_notes || '').matchAll(/\[Meta leadgen_id=(\d+)\]/g)) {
        ids.add(m[1]);
      }
    }
    return ids;
  }

  /**
   * El lead de un teléfono. Primero la coincidencia exacta; si no hay, se
   * compara por los últimos 9 dígitos (ver `phoneMatchKey`), que es lo que
   * reconoce al mismo contacto guardado con otro formato.
   *
   * Si hay varias filas del mismo número —el daño ya hecho por los gemelos que
   * se crearon antes— gana el lead que ya graduó al Funnel de Ventas: es el que
   * el closer está trabajando y el que los topes tienen que proteger. Entre
   * iguales, el más reciente.
   */
  async findByPhone(phone) {
    const exact = await db('leads').where({ phone }).first();
    if (exact) return exact;

    const key = phoneMatchKey(phone);
    if (!key) return null;

    const matches = await db('leads')
      .whereRaw(`${PHONE_MATCH_KEY_SQL} = ?`, [key])
      .orderByRaw('CASE WHEN leads.sales_funnel_at IS NULL THEN 1 ELSE 0 END')
      .orderBy('leads.created_at', 'desc')
      .first();

    return matches || null;
  }

  /**
   * Registra como lead al primer contacto por WhatsApp de un número nuevo
   * (si ya existe un lead con ese teléfono, no crea uno duplicado). Arranca
   * en "conversacion_abierta" (una etapa exclusiva del Setter Funnel, donde
   * Avan todavía lo está calificando) para que NO aparezca todavía en el
   * Funnel de Ventas — ahí solo debe llegar una vez que se agenda una
   * llamada o se transfiere a un asesor (ver whatsappBotService.js).
   */
  async findOrCreateFromWhatsApp({ phone, fullName, source }) {
    const existing = await this.findByPhone(phone);
    if (existing) return existing;

    return this.createLead({
      fullName: fullName || 'Contacto de WhatsApp',
      phone,
      topic: `Consulta por WhatsApp de ${fullName || phone}`,
      source: source || 'WhatsApp Directo',
      status: 'conversacion_abierta'
    });
  }

  async getLeadById(id) {
    return db('leads')
      .select(
        'leads.*',
        'projects.id as project_id',
        'projects.status as project_status',
        'pago.id as initial_payment_id',
        'pago.code as initial_payment_code',
        'pago.monto as initial_payment_monto',
        'pago.estado as initial_payment_estado',
        'asesor.name as assigned_user_name',
        'asesor.email as assigned_user_email',
        'setter.name as setter_name',
        'closer.name as closer_name'
      )
      .leftJoin('projects', 'projects.lead_id', 'leads.id')
      .leftJoin('users as asesor', 'asesor.id', 'leads.assigned_user_id')
      .leftJoin('users as setter', 'setter.id', 'leads.setter_user_id')
      .leftJoin('users as closer', 'closer.id', 'leads.closer_user_id')
      .leftJoin('finance_income as pago', function () {
        this.on('pago.lead_id', '=', 'leads.id').andOn('pago.is_initial_payment', '=', db.raw('1'));
      })
      .where('leads.id', id)
      .first();
  }

  /**
   * Pone (o saca) al responsable comercial de un lead. `userId` null = sin
   * asignar.
   *
   * Verifica acá —y no solo en el desplegable del tablero— que el usuario sea
   * del área comercial: la regla que se ve y la que se aplica no pueden decir
   * cosas distintas, y esta ruta la puede llamar cualquier cliente con el
   * permiso `leads.view`.
   *
   * No toca el status ni el funnel: asignar es decir quién trabaja el lead, no
   * moverlo de etapa. Por eso tampoco pasa por `updateLeadStatus()` ni deja
   * nada en `lead_stage_changes`.
   */
  async assignLead(id, userId) {
    const lead = await this.getLeadById(id);
    if (!lead) return null;

    const empty = userId === null || userId === undefined || userId === '';
    let user = null;
    if (!empty) {
      user = await this.users.findCommercialMember(userId);
      if (!user) {
        const error = new Error('Ese usuario no existe o no pertenece al área comercial.');
        error.code = 'NOT_COMMERCIAL';
        throw error;
      }
    }

    await db('leads').where({ id }).update(assignmentPatch(user));
    return this.getLeadById(id);
  }

  /**
   * Punto ÚNICO por el que cambia la etapa de un lead, y donde viven las dos
   * reglas que impedían que esto funcionara:
   *
   *   1. **Sellar la graduación.** Al pasar a una etapa del Funnel de Ventas se
   *      escribe `sales_funnel_at`. A partir de ahí el lead es del closer
   *      aunque después se borre o se renombre la columna en la que está: la
   *      pregunta deja de depender del texto del status (ver
   *      `salesFunnelStage.js`).
   *   2. **Nadie lo devuelve solo.** A un lead ya graduado, el bot y los
   *      automatismos del backend NO pueden ponerle una etapa que esté fuera
   *      del funnel comercial. El intento queda registrado en la bitácora como
   *      `blocked` en vez de desaparecer sin rastro. Solo una persona puede
   *      devolverlo al setter, y recién ahí se borra el sello.
   *
   * `actor` es `req.user` (una persona), `{ type: 'bot' }` o nada (el backend).
   */
  async updateLeadStatus(id, status, { actor = null, reason = null } = {}) {
    const current = await db('leads').where({ id }).first();
    if (!current) return null;

    const actorType = actor?.type === 'bot' ? 'bot' : (actor?.id ? 'user' : 'system');
    const salesStatuses = await loadSalesFunnelStatuses();

    if (current.status === status) {
      // No es un movimiento, pero sí la ocasión de poner el sello que falte:
      // los leads que nacieron ya con una etapa comercial nunca pasan por el
      // camino de abajo.
      if (!current.sales_funnel_at && isSalesFunnelStatus(status, salesStatuses)) {
        await db('leads').where({ id }).update({
          sales_funnel_at: db.fn.now(),
          ...setterSeal(current, actor, actorType)
        });
      }
      return this.getLeadById(id);
    }

    const graduated = leadHasGraduated(current, salesStatuses);
    const staysCommercial = isSalesFunnelStatus(status, salesStatuses);

    if (graduated && !staysCommercial && actorType !== 'user') {
      await this.stageChanges.record(current.id, {
        fromStatus: current.status,
        toStatus: status,
        actor,
        blocked: true,
        reason: reason || 'El lead ya está en el Funnel de Ventas: solo una persona puede devolverlo al Setter Funnel.'
      });
      return this.getLeadById(id);
    }

    const patch = { status };
    if (staysCommercial && !current.sales_funnel_at) {
      patch.sales_funnel_at = db.fn.now();
      Object.assign(patch, setterSeal(current, actor, actorType));
    } else if (current.sales_funnel_at && actorType === 'user' && SETTER_ONLY_STATUSES.includes(status)) {
      // Una persona lo devolvió a propósito a una etapa del setter. Las etapas
      // de bandeja ("nuevo") no cuentan: están en la primera columna de los dos
      // tableros, así que arrastrar un lead ahí dentro del funnel del closer no
      // puede significar que deje de ser suyo.
      patch.sales_funnel_at = null;
    }

    await db('leads').where({ id }).update(patch);
    await this.stageChanges.record(current.id, {
      fromStatus: current.status,
      toStatus: status,
      actor,
      reason
    });

    /*
     * Venta ganada: se sella quién cerró y nace la comisión de la setter.
     *
     * Va acá y no en la ruta de cierre porque hay más de un camino a la etapa
     * final (el modal de cierre con el primer pago, y el arrastre en el Kanban
     * de un lead que ya lo tenía), y todos pasan por este método.
     *
     * No puede tumbar la venta: si el registro de la comisión falla, el lead
     * queda ganado igual y el error se ve en el log. Una comisión que falta se
     * detecta en la pantalla de Comisiones; un cierre perdido, no.
     */
    const winning = await loadWinningStatuses();
    if (winning.has(status)) {
      try {
        const ganado = await this.getLeadById(id);
        const closerId = actorType === 'user' ? actor.id : (ganado.assigned_user_id || null);
        if (closerId && !ganado.closer_user_id) {
          await db('leads').where({ id }).update({ closer_user_id: closerId });
          ganado.closer_user_id = closerId;
        }
        const { commission, reason } = await this.commissions.registerForWonLead(ganado);
        if (commission) {
          console.log(`💰 [Comisiones] ${commission.beneficiary_name} suma S/ ${commission.monto} por el lead #${id}.`);
        } else if (reason) {
          console.log(`ℹ️ [Comisiones] El lead #${id} se ganó sin comisión: ${reason}`);
        }
      } catch (error) {
        console.error(`❌ [Comisiones] No se pudo registrar la comisión del lead #${id}:`, error.message);
      }
    }

    return this.getLeadById(id);
  }

  /**
   * Actualiza los datos del lead. La etapa NO se escribe acá aunque venga en
   * `data`: se delega en `updateLeadStatus()`, que es donde viven el sello de
   * graduación y el tope que impide devolver al setter un lead del closer. Si
   * se escribiera de paso, cualquier guardado de la ficha podría saltárselos.
   */
  async updateLead(id, data, { actor = null, reason = null } = {}) {
    const updatePayload = {};

    if (data.fullName !== undefined || data.full_name !== undefined) {
      updatePayload.full_name = data.fullName !== undefined ? data.fullName : data.full_name;
    }
    if (data.phone !== undefined) updatePayload.phone = data.phone;
    if (data.email !== undefined) updatePayload.email = data.email;
    if (data.dni !== undefined) updatePayload.dni = data.dni;
    if (data.gender !== undefined) updatePayload.gender = data.gender;
    if (data.birthDate !== undefined || data.birth_date !== undefined) {
      updatePayload.birth_date = data.birthDate !== undefined ? data.birthDate : data.birth_date;
    }
    if (data.university !== undefined) updatePayload.university = data.university;
    if (data.fieldOfStudy !== undefined || data.field_of_study !== undefined || data.career !== undefined) {
      updatePayload.field_of_study = data.fieldOfStudy || data.field_of_study || data.career;
    }
    if (data.academicLevel !== undefined || data.academic_level !== undefined) {
      updatePayload.academic_level = data.academicLevel || data.academic_level;
    }
    if (data.thesisSituation !== undefined || data.thesis_situation !== undefined) {
      updatePayload.thesis_situation = data.thesisSituation || data.thesis_situation;
    }
    if (data.academicStatus !== undefined) updatePayload.academic_status = data.academicStatus;
    if (data.academicCycle !== undefined) updatePayload.academic_cycle = data.academicCycle;
    if (data.topic !== undefined) updatePayload.topic = data.topic;
    if (data.department !== undefined) updatePayload.department = data.department;
    if (data.province !== undefined) updatePayload.province = data.province;
    if (data.address !== undefined) updatePayload.address = data.address;
    if (data.assignedTo !== undefined || data.assigned_to !== undefined) {
      const texto = (data.assignedTo ?? data.assigned_to) || null;
      updatePayload.assigned_to = texto;
      /*
       * La asignación también llega como texto desde la ficha de la Base de
       * Datos. Mientras nombre a la misma persona no se toca nada (ese
       * formulario reenvía el campo en cada guardado, y soltar el enlace al
       * corregir un DNI dejaría el lead "sin asignar" en los tableros).
       *
       * Si nombra a otra: cuando es alguien del área comercial se enlaza su
       * cuenta —la misma asignación hecha desde dos pantallas tiene que dejar
       * la ficha en el mismo estado— y cuando no (un asesor sin cuenta en el
       * panel, que es para lo que el campo libre sigue sirviendo) queda solo
       * el texto, sin enlace.
       */
      const actual = await this.getLeadById(id);
      const sigueSiendoElMismo = Boolean(actual?.assigned_user_id) && !freeTextBreaksLink(actual, texto);
      if (!sigueSiendoElMismo) {
        const user = texto ? await this.users.findCommercialByName(texto) : null;
        updatePayload.assigned_user_id = user ? user.id : null;
        if (user) updatePayload.assigned_to = user.name;
      }
    }
    if (data.source !== undefined) updatePayload.source = data.source;
    if (data.overallViabilityScore !== undefined) updatePayload.overall_viability_score = data.overallViabilityScore;
    if (data.viabilityLevel !== undefined) updatePayload.viability_level = data.viabilityLevel;
    if (data.additionalNotes !== undefined || data.additional_notes !== undefined) {
      updatePayload.additional_notes = data.additionalNotes !== undefined ? data.additionalNotes : data.additional_notes;
    }

    if (Object.keys(updatePayload).length > 0) {
      await db('leads').where({ id }).update(updatePayload);
    }
    if (data.status !== undefined && data.status !== null && data.status !== '') {
      const moved = await this.updateLeadStatus(id, data.status, { actor, reason });
      if (moved) return moved;
    }
    return this.getLeadById(id);
  }

  async deleteLead(id) {
    return db('leads').where({ id }).del();
  }
}
