import { db } from '../db/connection.js';
import { LeadStageChangeService } from './leadStageChangeService.js';
import {
  SETTER_ONLY_STATUSES,
  isSalesFunnelStatus,
  leadHasGraduated,
  loadSalesFunnelStatuses
} from './salesFunnelStage.js';

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

/** Los mismos dígitos, calculados en SQL sobre la columna `phone`. */
export const PHONE_MATCH_KEY_SQL = "RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(leads.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), 9)";

/**
 * Servicio de acceso a datos para los leads y prospectos (registro comercial de usuarios
 * del chatbot y prospectos capturados en la Base de Datos).
 */
export class LeadService {
  constructor({ stageChangeService } = {}) {
    this.stageChanges = stageChangeService || new LeadStageChangeService();
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
      assigned_to: assignedTo || 'Kevin',
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

  async getAllLeads() {
    return db('leads')
      .select(
        'leads.*',
        'projects.id as project_id',
        'projects.status as project_status',
        'pago.id as initial_payment_id',
        'pago.code as initial_payment_code',
        'pago.monto as initial_payment_monto',
        'pago.estado as initial_payment_estado'
      )
      .leftJoin('projects', 'projects.lead_id', 'leads.id')
      .leftJoin('finance_income as pago', function () {
        this.on('pago.lead_id', '=', 'leads.id').andOn('pago.is_initial_payment', '=', db.raw('1'));
      })
      .orderBy('leads.created_at', 'desc');
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
      const legacy = String(row.additional_notes || '').match(/\[Meta leadgen_id=(\d+)\]/);
      if (legacy) ids.add(legacy[1]);
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
        'pago.estado as initial_payment_estado'
      )
      .leftJoin('projects', 'projects.lead_id', 'leads.id')
      .leftJoin('finance_income as pago', function () {
        this.on('pago.lead_id', '=', 'leads.id').andOn('pago.is_initial_payment', '=', db.raw('1'));
      })
      .where('leads.id', id)
      .first();
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
        await db('leads').where({ id }).update({ sales_funnel_at: db.fn.now() });
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
      updatePayload.assigned_to = data.assignedTo || data.assigned_to;
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
