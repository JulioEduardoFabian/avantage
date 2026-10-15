import { db } from '../db/connection.js';
import { GENERIC_CONTACT_NAME } from './contactName.js';
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
import { LeadRoutingService } from './leadRoutingService.js';

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

/**
 * Las tres formas en que un lead es "de" alguien: quien lo tiene a cargo hoy,
 * la setter que lo trabajó y el closer que lo cierra. Un lead le aparece a
 * cualquiera de los tres (`canView()` y `getAllLeads()` leen esta lista).
 */
export const LEAD_PEOPLE_FIELDS = ['assigned_user_id', 'setter_user_id', 'closer_user_id'];

/** Columna de `leads` que guarda a cada miembro del equipo del lead. */
const LEAD_TEAM_COLUMNS = { setter: 'setter_user_id', closer: 'closer_user_id' };

/** Los mismos dígitos, calculados en SQL sobre la columna `phone`. */
export const PHONE_MATCH_KEY_SQL = "RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(leads.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), 9)";

/**
 * Caracteres con los que se compara un documento de identidad.
 *
 * Mismo problema que el teléfono: el DNI se carga "70123456", "70.123.456" o
 * "70 123 456" según quién lo escriba, y comparar las cadenas tal cual deja
 * entrar al mismo cliente dos veces. Se quitan los separadores que la gente usa
 * de verdad (espacio, guion, punto, barra) y nada más — ni se exige que sean
 * dígitos: un carné de extranjería o un pasaporte llevan letras y también se
 * guardan en esta columna. Esta función y `DNI_MATCH_KEY_SQL` limpian lo mismo
 * a propósito: son la misma regla en los dos lados de la consulta.
 *
 * Menos de 6 caracteres no identifica a nadie (es lo que hay escrito a medias
 * mientras alguien tipea): ahí devuelve null y no se cruza con nada.
 */
export function dniMatchKey(dni) {
  const clean = String(dni || '').replace(/[\s.\-/]/g, '').toUpperCase();
  return clean.length < 6 ? null : clean;
}

/** Los mismos caracteres, calculados en SQL sobre la columna `dni`. */
export const DNI_MATCH_KEY_SQL =
  "UPPER(REPLACE(REPLACE(REPLACE(REPLACE(leads.dni, ' ', ''), '-', ''), '.', ''), '/', ''))";

/**
 * Por qué el lead que ya existe es la misma persona que se está cargando:
 * `'phone'`, `'dni'`, o los dos.
 *
 * Es la regla del duplicado escrita una vez y sin base de datos de por medio:
 * la consulta solo trae candidatos y esta función es la que decide, así que el
 * alta manual, la edición de la ficha y el aviso que se ve en pantalla no
 * pueden discrepar sobre qué cuenta como repetido.
 *
 * Un campo vacío nunca es una coincidencia: dos leads sin DNI no son la misma
 * persona, y si lo fueran igual no hay forma de saberlo.
 */
export function duplicateReasons(candidate, lead) {
  const reasons = [];
  const phoneKey = phoneMatchKey(candidate?.phone);
  if (phoneKey && phoneKey === phoneMatchKey(lead?.phone)) reasons.push('phone');
  const dniKey = dniMatchKey(candidate?.dni);
  if (dniKey && dniKey === dniMatchKey(lead?.dni)) reasons.push('dni');
  return reasons;
}

/**
 * Agrupa los leads que son la misma persona: los que comparten celular (últimos
 * 9 dígitos) o documento, con la misma regla de `duplicateReasons()`.
 *
 * Es transitivo a propósito (unión de conjuntos): si A comparte celular con B
 * y B comparte DNI con C, los tres son una persona — mostrarlos en dos grupos
 * separados escondería justo el eslabón que los une. Cada grupo dice qué dato
 * se repite (`reasons`) y se devuelven solo los de dos o más fichas, el más
 * reciente primero: el gemelo recién creado es el que el equipo todavía puede
 * cortar antes de que lo trabajen dos personas.
 */
export function groupDuplicateLeads(leads = []) {
  const parent = new Map();
  const find = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const byKey = new Map();
  for (const lead of leads) {
    parent.set(lead.id, lead.id);
    const keys = [
      ['phone', phoneMatchKey(lead.phone)],
      ['dni', dniMatchKey(lead.dni)]
    ];
    for (const [kind, key] of keys) {
      if (!key) continue;
      const mapKey = `${kind}:${key}`;
      if (byKey.has(mapKey)) union(lead.id, byKey.get(mapKey));
      else byKey.set(mapKey, lead.id);
    }
  }

  const groups = new Map();
  for (const lead of leads) {
    const root = find(lead.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(lead);
  }

  const time = (lead) => new Date(lead.created_at || 0).getTime() || 0;
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const sorted = [...group].sort((a, b) => time(b) - time(a));
      const reasons = [];
      const repeats = (fn) => {
        const seen = new Set();
        return sorted.some((lead) => {
          const key = fn(lead);
          if (!key) return false;
          if (seen.has(key)) return true;
          seen.add(key);
          return false;
        });
      };
      if (repeats((lead) => phoneMatchKey(lead.phone))) reasons.push('phone');
      if (repeats((lead) => dniMatchKey(lead.dni))) reasons.push('dni');
      return { reasons, leads: sorted };
    })
    .sort((a, b) => time(b.leads[0]) - time(a.leads[0]));
}

/**
 * Lo que se le dice a quien está cargando el lead.
 *
 * Nombra el DATO repetido (el celular, el documento o los dos), a la persona
 * que ya está en la base y de quién es su ficha: "ya existe un lead con estos
 * datos" obliga a salir a buscarla para entender qué pasó, y mientras se busca
 * es cuando se carga igual.
 */
export function duplicateMessage(duplicates) {
  const lead = (duplicates || [])[0];
  if (!lead) return 'Ya existe un lead registrado con estos datos.';
  const reasons = lead.reasons || [];
  const dato = reasons.includes('phone') && reasons.includes('dni')
    ? 'ese celular y ese DNI'
    : reasons.includes('dni') ? 'ese DNI' : 'ese celular';
  const quien = lead.assigned_user_name ? `, a cargo de ${lead.assigned_user_name}` : '';
  const nombre = lead.full_name || `El lead #${lead.id}`;
  return `${nombre} ya está registrado con ${dato}${quien}. No se carga dos veces: abre su ficha y trabaja sobre ella.`;
}

/** El rechazo del alta duplicada, con las fichas que lo provocaron adjuntas
 * para que la pantalla pueda mostrarlas (la ruta responde 409). */
export function duplicateLeadError(duplicates) {
  const error = new Error(duplicateMessage(duplicates));
  error.code = 'DUPLICATE_LEAD';
  error.duplicates = duplicates;
  return error;
}

/**
 * Servicio de acceso a datos para los leads y prospectos (registro comercial de usuarios
 * del chatbot y prospectos capturados en la Base de Datos).
 */
export class LeadService {
  constructor({ stageChangeService, userService, commissionService, routingService } = {}) {
    this.stageChanges = stageChangeService || new LeadStageChangeService();
    this.users = userService || new UserService();
    this.commissions = commissionService || new CommissionService();
    this.routing = routingService || new LeadRoutingService({ userService: this.users });
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
    createdBy,
    source,
    status,
    metaLeadgenId,
    metaFormId,
    metaAdId,
    metaAdsetId,
    metaCampaignId,
    metaPlatform,
    metaCreatedTime,
    autoRoute = true
  }) {
    /*
     * El reparto automático (`/admin/reparto`) va primero y le gana al texto:
     * cuando está corriendo —o sea, cuando el bot está apagado— es ÉL quien
     * decide de quién es el lead, y por eso pisa el valor por defecto "Kevin",
     * que es un resto de cuando el campo era texto libre y hoy además nombra a
     * una persona real del panel. Respetarlo haría que todos los leads de Meta
     * y del evaluador siguieran cayéndole a Kevin con el reparto encendido.
     *
     * `autoRoute` viene en `true` a propósito: los caminos automáticos son los
     * que hay que repartir y son los que se van a seguir agregando, así que el
     * que tiene que acordarse de algo es el alta MANUAL, que es una sola
     * (`registerManualLead()`) y se desvía poniéndolo en `false`. Al revés —que
     * cada camino automático tenga que pedirlo— el cuarto que aparezca se
     * olvida y nadie se entera, porque un lead sin repartir no falla: solo
     * queda sin dueño.
     *
     * Un fallo del reparto NO puede tumbar el alta: un lead sin responsable se
     * arregla asignándolo a mano, y un lead que no se guardó se perdió.
     */
    let assignedUser = null;
    if (autoRoute) {
      try {
        assignedUser = await this.routing.pickAssignee();
      } catch (error) {
        console.error('❌ Error al repartir el lead automáticamente (queda sin responsable):', error.message);
      }
    }

    /*
     * Sin reparto (o sin nadie elegible), lo de siempre: si el responsable
     * llega como texto y nombra a alguien del área comercial (el alta manual lo
     * elige de la lista del equipo), el lead nace ya enlazado a esa cuenta.
     */
    const assignedText = assignedTo || 'Kevin';
    if (!assignedUser) assignedUser = await this.users.findCommercialByName(assignedText);

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
      // Solo el alta manual trae autor: lo que entra por el bot, por Meta o por
      // el evaluador no lo cargó nadie (ver la migración de `created_by`).
      created_by: createdBy || null,
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
      createdBy: data.createdBy || null,
      source: data.source || 'Manual',
      status: data.status || 'nuevo',
      additionalNotes: data.additionalNotes || data.additional_notes || null,
      metaLeadgenId: data.metaLeadgenId,
      metaFormId: data.metaFormId,
      metaAdId: data.metaAdId,
      metaAdsetId: data.metaAdsetId,
      metaCampaignId: data.metaCampaignId,
      metaPlatform: data.metaPlatform,
      metaCreatedTime: data.metaCreatedTime,
      // Por acá entran los leads de Meta, que SÍ se reparten; el alta manual
      // entra por `registerManualLead()`, que lo pone en `false`.
      autoRoute: data.autoRoute !== false
    });
  }

  /**
   * Los leads que ya existen con este celular o este documento.
   *
   * Pregunta sobre TODA la tabla y no solo sobre lo que el que carga puede ver:
   * el duplicado que más daño hace es justamente el del lead que trabaja otra
   * persona — quien carga no lo tiene en su tablero, así que lo vuelve a cargar
   * de buena fe y el contacto termina en dos funnels a la vez. Por eso de una
   * ficha ajena viaja un RESUMEN y no el lead: nombre, celular, documento,
   * etapa y de quién es, lo justo para entender que ya está cargado y a quién
   * preguntarle. `visible` dice si además la puede abrir, para no ofrecerle un
   * enlace que `requireLeadVisible` le va a negar.
   *
   * `excludeId` es el propio lead cuando se está editando su ficha: nadie es
   * duplicado de sí mismo.
   */
  async findDuplicates({ phone, dni, excludeId = null, viewer = null } = {}) {
    const phoneKey = phoneMatchKey(phone);
    const dniKey = dniMatchKey(dni);
    if (!phoneKey && !dniKey) return [];

    const query = db('leads')
      .select(
        'leads.id',
        'leads.full_name',
        'leads.phone',
        'leads.dni',
        'leads.status',
        'leads.source',
        'leads.created_at',
        'leads.sales_funnel_at',
        'leads.assigned_to',
        'leads.assigned_user_id',
        'leads.setter_user_id',
        'leads.closer_user_id',
        'asesor.name as assigned_user_name'
      )
      .leftJoin('users as asesor', 'asesor.id', 'leads.assigned_user_id')
      .where(function () {
        if (phoneKey) this.orWhereRaw(`${PHONE_MATCH_KEY_SQL} = ?`, [phoneKey]);
        if (dniKey) this.orWhereRaw(`${DNI_MATCH_KEY_SQL} = ?`, [dniKey]);
      })
      .orderBy('leads.created_at', 'desc')
      .limit(5);
    if (excludeId) query.whereNot('leads.id', excludeId);

    const rows = await query;
    // El alcance se resuelve UNA vez para todas las filas (lo mismo que hace
    // `getLeadsVisibleTo`): son como máximo cinco, pero `visibilityFor()`
    // consulta las etapas comerciales y no hay por qué preguntarlas cinco veces.
    const salesStatuses = viewer ? (await this.visibilityFor(viewer)).salesStatuses : null;

    return rows
      .map((row) => ({ row, reasons: duplicateReasons({ phone, dni }, row) }))
      .filter(({ reasons }) => reasons.length > 0)
      .map(({ row, reasons }) => ({
        id: row.id,
        full_name: row.full_name,
        phone: row.phone,
        dni: row.dni,
        status: row.status,
        source: row.source,
        created_at: row.created_at,
        assigned_user_name: row.assigned_user_name || row.assigned_to || null,
        reasons,
        visible: viewer ? this.canView(row, viewer, salesStatuses) : false
      }));
  }

  /**
   * Las personas que están cargadas más de una vez (botón "Duplicados" del
   * Funnel de Ventas). Agrupa con `groupDuplicateLeads()` —la misma regla del
   * tope del alta manual— sobre TODA la tabla, porque el gemelo que más daño
   * hace es el que trabaja otra persona.
   *
   * Pero no le abre la base entera a cualquiera: quien no administra el área
   * comercial recibe solo los grupos donde al menos una ficha es suya (la que
   * él trabaja y su gemela ajena), y de cada ficha viaja el mismo RESUMEN que
   * en `findDuplicates()` con `visible` para saber si la puede abrir.
   */
  async listDuplicateGroups(viewer) {
    const rows = await db('leads')
      .select(
        'leads.id',
        'leads.full_name',
        'leads.phone',
        'leads.dni',
        'leads.status',
        'leads.source',
        'leads.created_at',
        'leads.sales_funnel_at',
        'leads.assigned_to',
        'leads.assigned_user_id',
        'leads.setter_user_id',
        'leads.closer_user_id',
        'asesor.name as assigned_user_name',
        'projects.id as project_id'
      )
      .leftJoin('users as asesor', 'asesor.id', 'leads.assigned_user_id')
      .leftJoin('projects', 'projects.lead_id', 'leads.id')
      .where(function () {
        this.whereNotNull('leads.phone').orWhereNotNull('leads.dni');
      });

    const { scope, salesStatuses } = await this.visibilityFor(viewer);
    return groupDuplicateLeads(rows)
      .map((group) => ({
        reasons: group.reasons,
        leads: group.leads.map((row) => ({
          id: row.id,
          full_name: row.full_name,
          phone: row.phone,
          dni: row.dni,
          status: row.status,
          source: row.source,
          created_at: row.created_at,
          has_project: Boolean(row.project_id),
          assigned_user_name: row.assigned_user_name || row.assigned_to || null,
          visible: this.canView(row, viewer, salesStatuses)
        }))
      }))
      .filter((group) => scope === 'all' || group.leads.some((lead) => lead.visible));
  }

  /**
   * El alta MANUAL de un lead: el modal de los dos tableros y la ficha de la
   * Base de Datos (`POST /api/leads`).
   *
   * Es un método aparte de `createProspect()` —por donde siguen entrando los
   * leads de Meta— porque el tope de duplicados vale para la persona que carga
   * a mano y no para el webhook: ahí un alta rechazada no se reintenta nunca y
   * el lead se pierde en silencio (y Meta ya cruza por teléfono antes de
   * llamar, ver `persistMetaLead`). Va en el servicio y no en la ruta porque es
   * la regla del módulo: el día que haya un tercer formulario de alta, el tope
   * viene puesto.
   *
   * `actor` es quien está cargando, y se usa para dos cosas distintas: queda
   * escrito en `created_by` —la ficha dice a quién preguntarle por lo que se
   * cargó a mano— y decide de cuál de las fichas repetidas la pantalla puede
   * ofrecer un enlace y de cuál tiene que decir "no está en tu cartera". Lo que
   * se RECHAZA no depende de quién mire: el duplicado que más daño hace es
   * justamente el que esa persona no ve.
   */
  async registerManualLead(data, { actor = null } = {}) {
    const duplicates = await this.findDuplicates({ phone: data.phone, dni: data.dni, viewer: actor });
    if (duplicates.length > 0) throw duplicateLeadError(duplicates);
    /*
     * El alta manual NO pasa por el reparto automático. Quien carga la ficha
     * suele estar cargando SU lead (lo consiguió, se lo pasaron por fuera), y
     * mandárselo a otro del grupo es quitárselo; además el formulario ya tiene
     * su propio campo de responsable, que es el que manda acá.
     */
    return this.createProspect({ ...data, createdBy: actor?.id || null, autoRoute: false });
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
   *
   * `setterFunnelStatuses` abre, además de lo propio, todo el Setter Funnel
   * (`setter.view_all`): los leads que todavía no graduaron a Ventas, tengan o
   * no responsable. Es el conjunto de `loadSalesFunnelStatuses()` y la
   * condición es el espejo en SQL de `leadHasGraduated()` — sin sello y con un
   * status que no es comercial.
   */
  async getAllLeads({ viewerId = null, setterFunnelStatuses = null } = {}) {
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
        'closer.name as closer_name',
        // Quién lo cargó a mano, para que la ficha diga a quién preguntarle.
        // Solo lo tienen los leads del alta manual (ver `created_by`).
        'autor.name as created_by_name'
      )
      .leftJoin('projects', 'projects.lead_id', 'leads.id')
      .leftJoin('users as asesor', 'asesor.id', 'leads.assigned_user_id')
      .leftJoin('users as setter', 'setter.id', 'leads.setter_user_id')
      .leftJoin('users as closer', 'closer.id', 'leads.closer_user_id')
      .leftJoin('users as autor', 'autor.id', 'leads.created_by')
      .leftJoin('finance_income as pago', function () {
        this.on('pago.lead_id', '=', 'leads.id').andOn('pago.is_initial_payment', '=', db.raw('1'));
      })
      .orderBy('leads.created_at', 'desc');

    if (viewerId) {
      query.where(function () {
        this.where('leads.assigned_user_id', viewerId)
          .orWhere('leads.setter_user_id', viewerId)
          .orWhere('leads.closer_user_id', viewerId);
        if (setterFunnelStatuses) {
          this.orWhere(function () {
            this.whereNull('leads.sales_funnel_at').andWhere(function () {
              this.whereNull('leads.status').orWhereNotIn('leads.status', [...setterFunnelStatuses]);
            });
          });
        }
      });
    }
    return query;
  }

  /**
   * Qué alcance tiene esta persona sobre los leads, resuelto una vez por
   * request: `all` (`leads.manage_all`), `setter` (`setter.view_all`: lo propio
   * más todo el Setter Funnel) o `mine`. Solo el alcance `setter` necesita
   * saber qué status son comerciales, así que solo ahí se consulta.
   */
  async visibilityFor(user) {
    const permissions = user?.permissions || [];
    if (permissions.includes('leads.manage_all')) return { scope: 'all', salesStatuses: null };
    if (permissions.includes('setter.view_all')) {
      return { scope: 'setter', salesStatuses: await loadSalesFunnelStatuses() };
    }
    return { scope: 'mine', salesStatuses: null };
  }

  /** Los leads que le tocan a esta persona según `visibilityFor()`. */
  async getLeadsVisibleTo(user) {
    const { scope, salesStatuses } = await this.visibilityFor(user);
    const leads = await this.getAllLeads(
      scope === 'all' ? {} : { viewerId: user.id, setterFunnelStatuses: salesStatuses }
    );
    return { leads, scope };
  }

  /**
   * ¿Esta persona puede ver este lead? Es la misma regla de `getAllLeads()`,
   * escrita una vez para que la lista y la ficha no puedan discrepar: con el
   * permiso de administrador comercial, todo; sin él, solo lo propio.
   *
   * Con `setter.view_all` se suma el Setter Funnel entero: cualquier lead que
   * todavía no graduó a Ventas. `salesStatuses` es lo que devuelve
   * `visibilityFor()`; sin él esa parte de la regla no se puede contestar y se
   * responde que no — negar de más es el error barato.
   */
  canView(lead, user, salesStatuses = null) {
    if (!lead) return false;
    if (user?.permissions?.includes('leads.manage_all')) return true;
    if (!user?.id) return false;
    if (LEAD_PEOPLE_FIELDS.some((field) => lead[field] === user.id)) return true;
    if (salesStatuses && user.permissions?.includes('setter.view_all')) {
      return !leadHasGraduated(lead, salesStatuses);
    }
    return false;
  }

  /** `canView()` para un solo lead, cuando no hay un alcance ya resuelto. */
  async canViewLead(lead, user) {
    const { salesStatuses } = await this.visibilityFor(user);
    return this.canView(lead, user, salesStatuses);
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
   * El evaluador público lo volvió a usar alguien que YA es un lead: la
   * evaluación se cuelga de su ficha en vez de abrir una segunda.
   *
   * Una persona es un lead, no uno por cada vez que entra al evaluador. La
   * ficha nueva nacía en "nuevo" y, al indexar por teléfono, tapaba a la que
   * el equipo venía trabajando: así un lead ya GANADO aparecía en la
   * trazabilidad de Campañas como "En espera de la reunión" (caso real:
   * Rafael Anderson Gonzales Ureta, con una ficha ganada del 26/09 y un gemelo
   * del 02/10). Es exactamente el mismo problema que `attachMetaLeadToExisting`
   * resuelve para los formularios de Meta, y se arregla igual.
   *
   * Lo que se escribe es deliberadamente poco: la viabilidad nueva (que es el
   * dato que acaba de calcularse) y las notas, agregadas al final. **No se
   * toca el status** — moverlo es trabajo de `updateLeadStatus()` y haría que
   * una evaluación nueva retrocediera a un lead cerrado — ni el tema ni los
   * datos académicos que el equipo ya pudo haber corregido a mano.
   */
  async attachEvaluationToExisting(lead, { overallViabilityScore, viabilityLevel, topic, additionalNotes }) {
    const patch = {};
    if (overallViabilityScore != null) patch.overall_viability_score = overallViabilityScore;
    if (viabilityLevel) patch.viability_level = viabilityLevel;

    const notasPrevias = String(lead.additional_notes || '').trim();
    const encabezado = `[Evaluador ${new Date().toISOString().slice(0, 10)}]${topic ? ` ${topic}` : ''}`;
    const nota = [encabezado, String(additionalNotes || '').trim()].filter(Boolean).join('\n');
    patch.additional_notes = notasPrevias ? `${notasPrevias}\n\n${nota}` : nota;

    await db('leads').where({ id: lead.id }).update(patch);
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
      fullName: fullName || GENERIC_CONTACT_NAME,
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
        'closer.name as closer_name',
        'autor.name as created_by_name'
      )
      .leftJoin('projects', 'projects.lead_id', 'leads.id')
      .leftJoin('users as asesor', 'asesor.id', 'leads.assigned_user_id')
      .leftJoin('users as setter', 'setter.id', 'leads.setter_user_id')
      .leftJoin('users as closer', 'closer.id', 'leads.closer_user_id')
      .leftJoin('users as autor', 'autor.id', 'leads.created_by')
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
   * Pone (o saca) a la setter o al closer de un lead a mano, desde la ficha.
   * `role` es `'setter'` o `'closer'`; `userId` null = nadie.
   *
   * Son las mismas dos columnas que se sellan solas —la setter al graduar, el
   * closer al ganar— y los sellos nunca pisan un valor ya puesto, así que lo
   * que se elige acá manda: el lead queda asociado a esas dos personas desde
   * antes del pase y del cierre. De `setter_user_id` cuelga la comisión de la
   * setter, que se calcula al ganar con quien figure entonces; cambiarla
   * después no reescribe una comisión ya devengada.
   *
   * Como `assignLead()`, verifica el área comercial en el servidor y no mueve
   * el funnel.
   */
  async setLeadTeamMember(id, role, userId) {
    const column = LEAD_TEAM_COLUMNS[role];
    if (!column) throw new Error(`Rol de lead desconocido: ${role}`);

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

    await db('leads').where({ id }).update({ [column]: user ? user.id : null });
    return this.getLeadById(id);
  }

  /**
   * Asignación masiva: pone (o saca) responsable, setter y/o closer a muchos
   * leads de una vez. De `team` solo se tocan las claves que vienen
   * (`assignee`, `setter`, `closer`): ausente = no cambiar, null = dejar vacío,
   * un id = esa persona.
   *
   * Es la misma escritura que `assignLead()` y `setLeadTeamMember()` —el
   * responsable sale de `assignmentPatch()` para que el enlace y la copia del
   * nombre sigan yendo juntos— hecha en una sola consulta. Tampoco mueve el
   * funnel. `canSee` filtra los leads que quien la pide no puede ver: un id
   * ajeno en la lista se saltea, no se asigna a ciegas.
   */
  async bulkSetLeadTeam(leadIds, team = {}, { canSee = () => true } = {}) {
    const ids = [...new Set((Array.isArray(leadIds) ? leadIds : []).map(Number))]
      .filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length === 0) throw new Error('Elige al menos un lead.');

    const patch = {};
    for (const key of ['assignee', 'setter', 'closer']) {
      if (!(key in team) || team[key] === undefined) continue;
      const empty = team[key] === null || team[key] === '';
      let user = null;
      if (!empty) {
        user = await this.users.findCommercialMember(team[key]);
        if (!user) {
          const error = new Error('Ese usuario no existe o no pertenece al área comercial.');
          error.code = 'NOT_COMMERCIAL';
          throw error;
        }
      }
      if (key === 'assignee') Object.assign(patch, assignmentPatch(user));
      else patch[LEAD_TEAM_COLUMNS[key]] = user ? user.id : null;
    }
    if (Object.keys(patch).length === 0) throw new Error('Elige qué asignar: responsable, setter o closer.');

    const rows = await db('leads').whereIn('id', ids);
    const visibles = rows.filter(canSee).map((lead) => lead.id);
    if (visibles.length > 0) await db('leads').whereIn('id', visibles).update(patch);
    return { updated: visibles.length, skipped: ids.length - visibles.length };
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

    /*
     * Editar la ficha tampoco puede dejar dos veces a la misma persona: si el
     * celular o el documento cambian y el valor nuevo ya es de otro lead, el
     * guardado se rechaza igual que el alta.
     *
     * Se miran solo los campos que DE VERDAD cambian, y no el estado final de
     * la ficha: en la base quedaron gemelos de antes (los que abrían el
     * evaluador público y el webhook de Meta, ver `esMejorLead` en
     * campaignService.js), y chequear el valor que ya estaba guardado haría
     * imposible corregirle el nombre o el correo a uno de ellos — un tope que
     * impide arreglar justo el problema que viene a evitar.
     */
    if (updatePayload.phone !== undefined || updatePayload.dni !== undefined) {
      const actual = await this.getLeadById(id);
      const phoneChanged = updatePayload.phone !== undefined
        && phoneMatchKey(updatePayload.phone) !== phoneMatchKey(actual?.phone);
      const dniChanged = updatePayload.dni !== undefined
        && dniMatchKey(updatePayload.dni) !== dniMatchKey(actual?.dni);
      if (phoneChanged || dniChanged) {
        const duplicates = await this.findDuplicates({
          phone: phoneChanged ? updatePayload.phone : null,
          dni: dniChanged ? updatePayload.dni : null,
          excludeId: id,
          viewer: actor
        });
        if (duplicates.length > 0) throw duplicateLeadError(duplicates);
      }
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
