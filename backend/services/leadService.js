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
import { MetaConversionsService } from './metaConversionsService.js';
import { TikTokConversionsService } from './tiktokConversionsService.js';
import { ctwaAttribution, leadOrigin } from './leadOrigin.js';
import { ATTRIBUTION_METHODS, confidenceFor, writesAttribution } from './attributionEvidence.js';
import { activeMeetingForLead } from './scheduledMeetingService.js';

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

/**
 * Acota una consulta sobre `leads` a lo que esta persona puede ver.
 *
 * Es la regla de "cada quien ve sus leads" escrita en SQL una sola vez, para
 * que cualquier listado nuevo que lea la tabla —el Reporte de Leads fue el
 * primero— no tenga que copiarla: una copia que se olvide de los tres roles o
 * del Setter Funnel completo no es un filtro distinto, es una fuga.
 *
 * Sin `viewerId` no filtra nada (es el alcance `all`, el del administrador
 * comercial). `setterFunnelStatuses` suma lo que todavía no graduó a Ventas y
 * es el espejo en SQL de `leadHasGraduated()`: sin sello y con un status que no
 * es comercial.
 */
export function applyLeadVisibility(query, { viewerId = null, setterFunnelStatuses = null } = {}) {
  if (!viewerId) return query;

  return query.where(function () {
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

/**
 * La etapa que afirma que hay una reunión. Es la clave fija —la que pone el
 * bot al reservar y la que traen de fábrica los dos tableros—: una columna que
 * el equipo cree con otro nombre no se adivina, y adivinarla acá sería frenar
 * movimientos legítimos por el parecido de una etiqueta.
 */
export const APPOINTMENT_STATUS = 'cita_agendada';

/**
 * La columna `phone` sin separadores, calculada en SQL: los mismos caracteres
 * que quita `phoneMatchKey()` acá arriba.
 *
 * Está aparte de `PHONE_MATCH_KEY_SQL` porque hay dos preguntas distintas sobre
 * el mismo teléfono y solo una se contesta con los últimos 9 dígitos. "¿Es la
 * misma persona?" sí (de ahí el duplicado y el cruce del bot). "¿Este número
 * contiene lo que escribí en el buscador?" no: quien busca escribe un pedazo
 * —los últimos cuatro dígitos, o el número con el prefijo— y recortar a nueve
 * antes de comparar deja fuera justo la mitad de los casos. Las dos salen de la
 * misma limpieza para que no pueda pasar que una encuentre un teléfono que la
 * otra no reconoce.
 */
export const PHONE_DIGITS_SQL =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(leads.phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', '')";

export const PHONE_MATCH_KEY_SQL = `RIGHT(${PHONE_DIGITS_SQL}, 9)`;

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
  constructor({ stageChangeService, userService, commissionService, routingService, metaConversionsService, tiktokConversionsService } = {}) {
    this.stageChanges = stageChangeService || new LeadStageChangeService();
    this.users = userService || new UserService();
    this.commissions = commissionService || new CommissionService();
    this.routing = routingService || new LeadRoutingService({ userService: this.users });
    this.metaConversions = metaConversionsService || new MetaConversionsService();
    /*
     * La misma vuelta para TikTok. Queda apagada sin credenciales y no se
     * intenta nada, así que instanciarla acá no tiene costo (ver
     * `tiktokConversionsService.js`).
     */
    this.tiktokConversions = tiktokConversionsService || new TikTokConversionsService();
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
    metaAdName,
    metaAdsetName,
    metaCampaignName,
    metaPlatform,
    metaCreatedTime,
    tiktokLeadId,
    tiktokPageId,
    tiktokAdId,
    tiktokAdgroupId,
    tiktokCampaignId,
    tiktokAdName,
    tiktokAdgroupName,
    tiktokCampaignName,
    tiktokCreatedTime,
    tiktokParentAdId,
    tiktokCreativeId,
    tiktokVideoId,
    tiktokVideoName,
    ctwaAdId,
    ctwaClid,
    ctwaSourceType,
    ctwaHeadline,
    ctwaCreatedTime,
    autoRoute = true,
    botWillAttend = false
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
     * `botWillAttend` separa los dos casos que antes se trataban igual: el lead
     * que nace de una conversación de WhatsApp lo atiende Avan mientras el bot
     * esté encendido, y por eso ahí el reparto espera; el de un formulario
     * (TikTok, Meta) o el del evaluador **no lo atiende nadie**, así que se
     * reparte siempre — con el bot encendido quedaban sin responsable, y un
     * lead sin responsable no lo ve nadie salvo quien reparte. Ver `routesNow()`.
     *
     * Un fallo del reparto NO puede tumbar el alta: un lead sin responsable se
     * arregla asignándolo a mano, y un lead que no se guardó se perdió.
     */
    let assignedUser = null;
    if (autoRoute) {
      try {
        assignedUser = await this.routing.pickAssignee({ botWillAttend });
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

    const fila = {
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
      // El nombre que la plataforma dio al momento del alta. Se copia y no se
      // vuelve a resolver: el enlace es por id (ver `leadOrigin.js`).
      meta_ad_name: metaAdName || null,
      meta_adset_name: metaAdsetName || null,
      meta_campaign_name: metaCampaignName || null,
      meta_platform: metaPlatform || null,
      meta_created_time: metaCreatedTime ? new Date(metaCreatedTime) : null,
      tiktok_lead_id: tiktokLeadId || null,
      tiktok_page_id: tiktokPageId || null,
      tiktok_ad_id: tiktokAdId || null,
      tiktok_adgroup_id: tiktokAdgroupId || null,
      tiktok_campaign_id: tiktokCampaignId || null,
      tiktok_ad_name: tiktokAdName || null,
      tiktok_adgroup_name: tiktokAdgroupName || null,
      tiktok_campaign_name: tiktokCampaignName || null,
      tiktok_created_time: tiktokCreatedTime ? new Date(tiktokCreatedTime) : null,
      /*
       * Smart+: el anuncio PADRE es el nivel en el que TikTok reporta el gasto,
       * y la pieza es la combinación que la plataforma armó. Vacíos es el caso
       * normal y significa "pieza desconocida" — nunca se infiere.
       */
      tiktok_parent_ad_id: tiktokParentAdId || null,
      tiktok_creative_id: tiktokCreativeId || null,
      tiktok_video_id: tiktokVideoId || null,
      tiktok_video_name: tiktokVideoName || null,
      // El anuncio del que salió el clic que abrió esta conversación. Se
      // escribe en el lead y no solo en el `referral` del mensaje porque el
      // webhook responde 200 antes de procesar: un primer mensaje que no se
      // guardó dejaba al lead sin origen y lo hacía pasar por orgánico.
      ctwa_ad_id: ctwaAdId || null,
      ctwa_clid: ctwaClid || null,
      ctwa_source_type: ctwaSourceType || null,
      ctwa_headline: ctwaHeadline || null,
      ctwa_created_time: ctwaCreatedTime ? new Date(ctwaCreatedTime) : null
    };

    /*
     * El sello del origen, escrito UNA vez y en el único momento en que se
     * sabe con certeza: el alta. Después de esto, ninguna conciliación lo
     * reescribe — lo que llegue más tarde se informa como secundario (ver
     * `leadOrigin()`). Antes el origen se DEDUCÍA en cada lectura del orden
     * en que estaban escritas las columnas, así que una ficha de Meta a la
     * que se le colgaba un formulario de TikTok pasaba a ser de TikTok en
     * todas las hojas de marketing.
     *
     * Y queda escrito con qué evidencia: un id que emitió la plataforma es
     * alta (no se llega a él por descarte), lo que cargó una persona es
     * media, y el resto no tiene atribución que respaldar y va en null, que
     * es información y no un hueco.
     */
    const method = (tiktokLeadId || metaLeadgenId)
      ? ATTRIBUTION_METHODS.platformLeadId
      : ctwaClid ? ATTRIBUTION_METHODS.webhook
      : createdBy ? ATTRIBUTION_METHODS.manual
      : null;
    fila.origin_platform = leadOrigin(fila).platform;
    fila.attribution_method = method;
    fila.attribution_confidence = confidenceFor(method);

    const [id] = await db('leads').insert(fila);
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
      metaAdName: data.metaAdName,
      metaAdsetName: data.metaAdsetName,
      metaCampaignName: data.metaCampaignName,
      metaPlatform: data.metaPlatform,
      metaCreatedTime: data.metaCreatedTime,
      tiktokLeadId: data.tiktokLeadId,
      tiktokPageId: data.tiktokPageId,
      tiktokAdId: data.tiktokAdId,
      tiktokAdgroupId: data.tiktokAdgroupId,
      tiktokCampaignId: data.tiktokCampaignId,
      tiktokAdName: data.tiktokAdName,
      tiktokAdgroupName: data.tiktokAdgroupName,
      tiktokCampaignName: data.tiktokCampaignName,
      tiktokCreatedTime: data.tiktokCreatedTime,
      ctwaAdId: data.ctwaAdId,
      ctwaClid: data.ctwaClid,
      ctwaSourceType: data.ctwaSourceType,
      ctwaHeadline: data.ctwaHeadline,
      ctwaCreatedTime: data.ctwaCreatedTime,
      // Por acá entran los leads de formulario (Meta y TikTok) y los del
      // evaluador: todos se reparten, y SIEMPRE, porque el bot no los atiende
      // (`botWillAttend` queda en false). El alta manual entra por
      // `registerManualLead()`, que pone `autoRoute` en `false`.
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
    const grupos = groupDuplicateLeads(rows);
    // Una sola pasada por las cinco tablas para todas las fichas repetidas.
    const workload = await this.workloadByLead(grupos.flatMap((group) => group.leads.map((lead) => lead.id)));

    return grupos
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
          visible: this.canView(row, viewer, salesStatuses),
          // La misma regla que aplica el borrado, viajando a la pantalla: el
          // botón que se ve y lo que el servidor acepta no pueden decir cosas
          // distintas (mismo criterio que `delivery_blocked` en Entregables).
          delete_blocked_reason: deletionBlockReason(workload.get(row.id))
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
        'autor.name as created_by_name',
        // Quién lo calificó. La ficha de los dos tableros sale de esta lista,
        // así que el nombre tiene que viajar acá y no solo en `getLeadById`.
        'calificador.name as qualified_by_name'
      )
      .leftJoin('projects', 'projects.lead_id', 'leads.id')
      .leftJoin('users as asesor', 'asesor.id', 'leads.assigned_user_id')
      .leftJoin('users as setter', 'setter.id', 'leads.setter_user_id')
      .leftJoin('users as closer', 'closer.id', 'leads.closer_user_id')
      .leftJoin('users as autor', 'autor.id', 'leads.created_by')
      // Quién calificó el lead: la ficha lo muestra al lado de la marca, para
      // poder preguntarle por un "No" que no se entiende.
      .leftJoin('users as calificador', 'calificador.id', 'leads.qualified_by')
      .leftJoin('finance_income as pago', function () {
        this.on('pago.lead_id', '=', 'leads.id').andOn('pago.is_initial_payment', '=', db.raw('1'));
      })
      .orderBy('leads.created_at', 'desc');

    return applyLeadVisibility(query, { viewerId, setterFunnelStatuses });
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

  /**
   * El alcance de esta persona traducido a los argumentos con los que se acota
   * una consulta sobre `leads` (`applyLeadVisibility()`). Lo usan el listado de
   * los tableros y el Reporte de Leads: que `scope: 'all'` signifique "no
   * filtres nada" se decide una vez acá y no en cada llamador.
   */
  async visibilityQueryFor(user) {
    const { scope, salesStatuses } = await this.visibilityFor(user);
    if (scope === 'all') return { scope, viewerId: null, setterFunnelStatuses: null };
    return { scope, viewerId: user.id, setterFunnelStatuses: salesStatuses };
  }

  /** Los leads que le tocan a esta persona según `visibilityFor()`. */
  async getLeadsVisibleTo(user) {
    const { scope, viewerId, setterFunnelStatuses } = await this.visibilityQueryFor(user);
    const leads = await this.getAllLeads({ viewerId, setterFunnelStatuses });
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
  async attachMetaLeadToExisting(lead, { leadgenId, formId, adId, adsetId, campaignId, adName, adsetName, campaignName, platform, createdTime, note, method = null }) {
    const patch = {};

    /*
     * La misma regla que en TikTok, y por la misma razón: solo la evidencia
     * independiente —el `leadgen_id` que emitió Meta para este envío, o su
     * marcador en las notas— habilita escribir la atribución. Un match por los
     * últimos 9 dígitos del teléfono alcanza para colgar el envío de la ficha
     * que ya existe (una persona es un lead) y no para decir de qué anuncio
     * salió.
     *
     * Acá el riesgo es menor que en TikTok porque el webhook trae el envío con
     * su id y el camino por teléfono es el raro, pero la regla se escribe igual
     * en los dos lados: la próxima conciliación que alguien agregue va a copiar
     * la que encuentre, y si una de las dos es laxa el agujero vuelve.
     */
    const puedeAtribuir = writesAttribution(method);

    if (puedeAtribuir) {
      if (!lead.meta_leadgen_id && leadgenId) patch.meta_leadgen_id = leadgenId;
      if (!lead.meta_form_id && formId) patch.meta_form_id = formId;
      if (!lead.meta_ad_id && adId) patch.meta_ad_id = adId;
      if (!lead.meta_adset_id && adsetId) patch.meta_adset_id = adsetId;
      if (!lead.meta_campaign_id && campaignId) patch.meta_campaign_id = campaignId;
      if (!lead.meta_ad_name && adName) patch.meta_ad_name = adName;
      if (!lead.meta_adset_name && adsetName) patch.meta_adset_name = adsetName;
      if (!lead.meta_campaign_name && campaignName) patch.meta_campaign_name = campaignName;
      if (!lead.meta_platform && platform) patch.meta_platform = platform;
      if (!lead.meta_created_time && createdTime) patch.meta_created_time = new Date(createdTime);
    }

    // El marcador va SIEMPRE a las notas aunque la columna ya esté ocupada por
    // un envío anterior: es lo que hace que la conciliación reconozca este
    // leadgen_id como ya visto y no lo reporte como faltante para siempre.
    const notasPrevias = String(lead.additional_notes || '').trim();
    if (note && !notasPrevias.includes(`[Meta leadgen_id=${leadgenId}]`)) {
      patch.additional_notes = notasPrevias ? `${notasPrevias}\n\n${note}` : note;
    }

    Object.assign(patch, this.#evidenceFor(lead, method));

    if (Object.keys(patch).length) await db('leads').where({ id: lead.id }).update(patch);
    return this.getLeadById(lead.id);
  }

  /**
   * El mismo teléfono ya es un lead y además llenó un formulario instantáneo
   * de TikTok: el envío se cuelga de esa ficha en vez de abrir una segunda.
   *
   * Es `attachMetaLeadToExisting` para la otra plataforma, con la misma regla
   * de fondo —una persona es un lead, no uno por cada formulario que llena— y
   * el mismo cuidado: no se pisa el estado ni ningún dato que el equipo ya
   * haya trabajado. La atribución se completa solo si estaba vacía, y el
   * marcador va SIEMPRE a las notas aunque la columna ya esté ocupada por un
   * envío anterior, que es lo que hace que la importación reconozca este
   * `lead_id` como ya visto y no lo reporte como faltante para siempre.
   *
   * Que esto importe más acá que en Meta tiene una razón concreta: en TikTok
   * el anuncio y el formulario conviven con campañas de Meta corriendo a la
   * vez sobre el mismo público, así que el contacto que ya escribió por
   * WhatsApp y después llenó el formulario de TikTok es el caso normal, no la
   * excepción.
   */
  async attachTikTokLeadToExisting(lead, { leadId, pageId, adId, adgroupId, campaignId, adName, adgroupName, campaignName, parentAdId, creativeId, videoId, videoName, createdTime, note, method = null }) {
    const patch = {};

    /*
     * Acá está la regla que costó un error real. `method` es CÓMO se encontró
     * esta ficha, y solo la evidencia independiente —el id que emitió TikTok
     * para este envío, o el marcador que ese id dejó en las notas— habilita
     * escribir la atribución. Un match por los últimos 9 dígitos del teléfono
     * NO alcanza: con las dos plataformas corriendo sobre el mismo público, el
     * contacto que llenó el formulario de TikTok y además escribió por WhatsApp
     * desde un anuncio de Meta es el caso normal, y escribirle `tiktok_*` lo
     * convertía en un lead de TikTok en todas las hojas de marketing.
     *
     * El `tiktok_lead_id` está gateado como el resto a propósito: de esa
     * columna cuelga el bloque de TikTok de `leadOrigin()`, así que escribirla
     * ES atribuir, no solo etiquetar.
     */
    const puedeAtribuir = writesAttribution(method);

    if (puedeAtribuir) {
      if (!lead.tiktok_lead_id && leadId) patch.tiktok_lead_id = leadId;
      if (!lead.tiktok_page_id && pageId) patch.tiktok_page_id = pageId;
      if (!lead.tiktok_ad_id && adId) patch.tiktok_ad_id = adId;
      if (!lead.tiktok_adgroup_id && adgroupId) patch.tiktok_adgroup_id = adgroupId;
      if (!lead.tiktok_campaign_id && campaignId) patch.tiktok_campaign_id = campaignId;
      if (!lead.tiktok_ad_name && adName) patch.tiktok_ad_name = adName;
      if (!lead.tiktok_adgroup_name && adgroupName) patch.tiktok_adgroup_name = adgroupName;
      if (!lead.tiktok_campaign_name && campaignName) patch.tiktok_campaign_name = campaignName;
      if (!lead.tiktok_created_time && createdTime) patch.tiktok_created_time = new Date(createdTime);
      // La jerarquía de Smart+: el padre (donde TikTok reporta el gasto) y la
      // pieza, que son niveles distintos y no se deducen uno del otro.
      if (!lead.tiktok_parent_ad_id && parentAdId) patch.tiktok_parent_ad_id = parentAdId;
      if (!lead.tiktok_creative_id && creativeId) patch.tiktok_creative_id = creativeId;
      if (!lead.tiktok_video_id && videoId) patch.tiktok_video_id = videoId;
      if (!lead.tiktok_video_name && videoName) patch.tiktok_video_name = videoName;
    }

    /*
     * El marcador va SIEMPRE, incluso con evidencia débil y aunque la columna
     * ya esté ocupada por otro envío: es lo que hace que la importación
     * reconozca este `lead_id` como ya visto y no lo reporte como faltante en
     * cada corrida. Es un acuse de "este envío ya se miró en esta ficha", no
     * una afirmación sobre de dónde salió el lead.
     */
    const notasPrevias = String(lead.additional_notes || '').trim();
    if (note && !notasPrevias.includes(`[TikTok lead_id=${leadId}]`)) {
      patch.additional_notes = notasPrevias ? `${notasPrevias}\n\n${note}` : note;
    }

    Object.assign(patch, this.#evidenceFor(lead, method));

    if (Object.keys(patch).length) await db('leads').where({ id: lead.id }).update(patch);
    return this.getLeadById(lead.id);
  }

  /**
   * Las columnas de evidencia que deja una conciliación al mirar esta ficha.
   *
   * La fecha se escribe aunque la atribución no se haya podido resolver: "ya
   * se comparó contra la plataforma y quedó pendiente" es distinto de "nunca se
   * la comparó", y esa es la diferencia entre un pendiente y un agujero que
   * nadie vio.
   *
   * El método NO se degrada: una ficha emparejada en su día por su `lead_id`
   * no pasa a `phone_match` porque una corrida posterior la encontrara por el
   * teléfono. Lo mejor que se supo sobre esta ficha sigue siendo lo que se
   * supo.
   */
  #evidenceFor(lead, method) {
    if (!method) return {};

    const patch = { attribution_reconciled_at: new Date() };
    const yaFuerte = lead.attribution_confidence === 'alta';
    if (!yaFuerte || writesAttribution(method)) {
      patch.attribution_method = method;
      patch.attribution_confidence = confidenceFor(method);
    }
    return patch;
  }

  /**
   * Los `lead_id` de TikTok ya guardados, para restarlos contra los que
   * devuelve la Business API sin traer un lead entero por cada uno.
   *
   * Mira la columna **y** el marcador de las notas, igual que
   * `getKnownMetaLeadgenIds()`: una ficha que se cuelga de otra por teléfono
   * puede tener la columna ya ocupada por un envío anterior, y ahí el único
   * rastro del segundo formulario es el marcador. Sin leerlo, la importación
   * volvería a dar de alta ese lead en cada pasada.
   */
  /**
   * Marca el lead como calificado, no calificado, o sin calificar.
   *
   * Tres estados y no dos: `null` es "nadie lo miró todavía", y es un dato —el
   * que separa al lead sin revisar del revisado y descartado—. La columna
   * anterior no existía: "Calificado" se DERIVABA de que el lead hubiera
   * salido de `nuevo`, con lo que decía "Sí" en 403 de 403 leads y no se podía
   * medir la calidad de ningún anuncio.
   *
   * Lo marca una persona y nunca un automatismo: es un juicio sobre el
   * contacto (tiene tesis en curso, está en el país, puede invertir), no algo
   * que se deduzca de por dónde pasó la tarjeta. Queda escrito quién y cuándo
   * para poder preguntarle.
   *
   * No toca el funnel: calificar es describir al lead, no moverlo. Por eso no
   * pasa por `updateLeadStatus()` ni deja nada en `lead_stage_changes` — misma
   * razón que asignar un responsable.
   */
  async setQualified(id, value, { actor = null } = {}) {
    const lead = await db('leads').where({ id }).first();
    if (!lead) return null;

    const empty = value === null || value === undefined || value === '';
    await db('leads').where({ id }).update({
      qualified: empty ? null : !!value,
      qualified_at: empty ? null : new Date(),
      // Sin autor cuando se borra la marca: lo que no está calificado no lo
      // calificó nadie.
      qualified_by: empty ? null : (actor?.id || null)
    });

    return this.getLeadById(id);
  }

  /**
   * La ficha de un lead de TikTok, buscada como se lo reconoce: por su columna
   * y, si no, por el marcador de las notas.
   *
   * Los dos caminos y no solo el primero, por la misma razón que
   * `getKnownTikTokLeadIds()`: cuando el formulario se colgó de una ficha que
   * ya existía, el marcador de las notas es el único rastro que queda si esa
   * ficha ya tenía su propio `tiktok_lead_id` de otro envío.
   */
  async findByTikTokLeadId(leadId) {
    const id = String(leadId || '').trim();
    if (!id) return null;

    return db('leads')
      .where((q) => q
        .where('tiktok_lead_id', id)
        .orWhere('additional_notes', 'like', `%[TikTok lead_id=${id}]%`))
      .orderBy('id', 'asc')
      .first();
  }

  async getKnownTikTokLeadIds() {
    const rows = await db('leads')
      .select('tiktok_lead_id', 'additional_notes')
      .where((builder) => {
        builder.whereNotNull('tiktok_lead_id').orWhere('additional_notes', 'like', '%[TikTok lead_id=%');
      });

    const ids = new Set();
    for (const row of rows) {
      if (row.tiktok_lead_id) ids.add(String(row.tiktok_lead_id));
      for (const m of String(row.additional_notes || '').matchAll(/\[TikTok lead_id=([^\]]+)\]/g)) {
        ids.add(m[1]);
      }
    }
    return ids;
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
   * De los leads de formulario ya guardados, cuáles tienen su anuncio.
   *
   * Es la otra mitad de la comprobación que pide la conciliación: que el lead
   * esté en el CRM no alcanza si llegó sin `meta_ad_id`, porque entonces no
   * hay anuncio al que acreditarle nada y el lead no aparece en el reporte de
   * Campañas. Se devuelve el conjunto de los que SÍ lo tienen para poder
   * restarlo contra los conocidos sin traer un lead entero por cada uno.
   *
   * Solo cuenta la columna y no el marcador de las notas: el `leadgen_id` se
   * escribió ahí desde siempre, pero el `ad_id` nunca — las fichas anteriores
   * a la columna de atribución se completan con el backfill, y darlas por
   * buenas acá sería esconder justo lo que hay que arreglar.
   */
  async getMetaLeadgenIdsWithAd() {
    const rows = await db('leads')
      .select('meta_leadgen_id')
      .whereNotNull('meta_leadgen_id')
      .whereNotNull('meta_ad_id')
      .andWhere('meta_ad_id', '!=', '');
    return new Set(rows.map((row) => String(row.meta_leadgen_id)));
  }

  /**
   * TODAS las fichas cuyo teléfono coincide, y no solo la que gana el
   * desempate.
   *
   * `findByPhone()` elige una para que el bot y las altas no dupliquen a una
   * persona, y para eso el desempate está bien. Pero para ATRIBUIR —decirle
   * a marketing de qué anuncio salió este lead— quedarse con la primera es
   * una moneda al aire: dos fichas con el mismo sufijo de 9 dígitos pueden
   * ser dos personas distintas, y el presupuesto se reparte con eso.
   *
   * Por eso la conciliación pregunta por acá: con más de una candidata el
   * caso va a `attribution_conflicts` para que lo resuelva una persona, en
   * vez de escribirle la campaña a la que el ORDER BY dejó arriba.
   */
  async findAllByPhone(phone) {
    const exact = await db('leads').where({ phone });
    if (exact.length) return exact;

    const key = phoneMatchKey(phone);
    if (!key) return [];

    return db('leads')
      .whereRaw(`${PHONE_MATCH_KEY_SQL} = ?`, [key])
      .orderByRaw('CASE WHEN leads.sales_funnel_at IS NULL THEN 1 ELSE 0 END')
      .orderBy('leads.created_at', 'desc');
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
  async findOrCreateFromWhatsApp({ phone, fullName, source, referral = null }) {
    const atribucion = ctwaAttribution(referral);
    const existing = await this.findByPhone(phone);
    if (existing) return this.attachCtwaToExisting(existing, atribucion);

    return this.createLead({
      fullName: fullName || GENERIC_CONTACT_NAME,
      phone,
      topic: `Consulta por WhatsApp de ${fullName || phone}`,
      source: source || 'WhatsApp Directo',
      status: 'conversacion_abierta',
      // El ÚNICO camino de alta que el bot atiende: de acá en adelante hay una
      // conversación, y mientras Avan esté encendido la lleva él. Por eso este
      // lead se reparte solo con el bot apagado, a diferencia de los de
      // formulario (ver `routesNow()`).
      botWillAttend: true,
      ...atribucion
    });
  }

  /**
   * Le escribe a un lead que ya existe la atribución del anuncio por el que
   * acaba de llegar, si todavía no tenía ninguna.
   *
   * Hace falta porque el lead puede haber nacido por otro camino —un
   * formulario, el evaluador, una carga a mano— y recién después hacer clic en
   * un anuncio para escribir: ahí el clic es el único dato de atribución que
   * va a existir de esa persona. No pisa lo que ya está escrito, por la misma
   * razón que `attachMetaLeadToExisting`: el PRIMER origen es el que explica
   * de dónde salió el contacto, y el segundo toque no lo reemplaza.
   */
  async attachCtwaToExisting(lead, atribucion) {
    if (!lead || !atribucion || (!atribucion.ctwaAdId && !atribucion.ctwaClid)) return lead;

    const patch = {};
    if (!lead.ctwa_ad_id && atribucion.ctwaAdId) patch.ctwa_ad_id = atribucion.ctwaAdId;
    if (!lead.ctwa_clid && atribucion.ctwaClid) patch.ctwa_clid = atribucion.ctwaClid;
    if (!lead.ctwa_source_type && atribucion.ctwaSourceType) patch.ctwa_source_type = atribucion.ctwaSourceType;
    if (!lead.ctwa_headline && atribucion.ctwaHeadline) patch.ctwa_headline = atribucion.ctwaHeadline;
    if (!lead.ctwa_created_time && atribucion.ctwaCreatedTime) patch.ctwa_created_time = new Date(atribucion.ctwaCreatedTime);

    if (!Object.keys(patch).length) return lead;
    await db('leads').where({ id: lead.id }).update(patch);
    return this.getLeadById(lead.id);
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
        'autor.name as created_by_name',
        'calificador.name as qualified_by_name'
      )
      .leftJoin('projects', 'projects.lead_id', 'leads.id')
      .leftJoin('users as asesor', 'asesor.id', 'leads.assigned_user_id')
      .leftJoin('users as setter', 'setter.id', 'leads.setter_user_id')
      .leftJoin('users as closer', 'closer.id', 'leads.closer_user_id')
      .leftJoin('users as autor', 'autor.id', 'leads.created_by')
      .leftJoin('users as calificador', 'calificador.id', 'leads.qualified_by')
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

    /*
     * "Cita agendada" es la única etapa que afirma un HECHO con fecha y hora,
     * y se puede afirmar arrastrando una tarjeta: el lead queda en esa columna
     * sin ninguna reunión detrás, así que el Calendario no la muestra, el bot
     * no manda su recordatorio y en el reporte el embudo cuenta una cita que
     * nadie puede ir a buscar.
     *
     * Entre el 01 y el 02/11/2026 eso se frenó con un 409, y frenaba de más:
     * la reunión se carga con "Agendar reunión", que exige `calendar.view`, y
     * el setter puede no tenerlo — con lo que el pase le quedaba cerrado sin
     * nada que pudiera hacer al respecto. Ahora **avisa y deja pasar**: el
     * movimiento se hace siempre y lo que queda es el rastro. Sin él, "cita
     * sin reunión" y "cita con reunión" se escriben igual en la columna, que
     * es lo que hacía imposible separarlas después.
     *
     * Solo se le pregunta a una PERSONA: el bot llega a esta etapa después de
     * reservar el bloque (`scheduledMeetingService`), así que para él la
     * reunión existe siempre. Y solo al ENTRAR: un lead que ya estaba en la
     * etapa se mueve a cualquier otra sin que esto opine.
     */
    let appointmentWithoutMeeting = false;
    if (actorType === 'user' && status === APPOINTMENT_STATUS && current.status !== APPOINTMENT_STATUS) {
      appointmentWithoutMeeting = !(await activeMeetingForLead(id));
      if (appointmentWithoutMeeting) {
        reason = reason
          ? `${reason} (sin reunión cargada en el panel)`
          : 'Cita agendada sin reunión cargada en el panel: no aparece en el Calendario del closer.';
      }
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
    const stageChangeId = await this.stageChanges.record(current.id, {
      fromStatus: current.status,
      toStatus: status,
      actor,
      reason
    });

    /*
     * Devolverle a Meta en qué etapa quedó el lead que nos mandó
     * (`metaConversionsService`). Va acá por lo mismo que la comisión: hay
     * varios caminos a cada etapa y todos pasan por este método.
     *
     * NO se espera a propósito. Es una llamada HTTP a la Graph API, y arrastrar
     * una tarjeta en el Kanban no puede quedarse esperando a que Meta
     * responda; el servicio se traga sus propios errores y deja cada intento en
     * `meta_capi_events`, que es donde se revisa. Un evento que no salió se
     * puede reenviar (botón "Reenviar últimos 7 días"); un movimiento de lead
     * que se cayó por un timeout de Meta, no.
     */
    void this.metaConversions.reportStageChange({ ...current, status }, {
      status,
      movedAt: new Date(),
      stageChangeId
    });

    /*
     * Y lo mismo para TikTok, por las mismas razones y con el mismo cuidado:
     * sin esperarla, porque es otra llamada HTTP en el camino de arrastrar una
     * tarjeta, y sin que pueda tumbar el movimiento.
     *
     * Son dos llamadas y no una con un `if`: un lead puede tener atribución de
     * las dos plataformas (el contacto que llenó el formulario de TikTok y
     * además escribió desde un anuncio de Meta es el caso normal), y cada
     * plataforma tiene que enterarse del desenlace del lead que ELLA mandó.
     * Cada servicio se omite solo cuando el lead no trae su identificador.
     */
    void this.tiktokConversions.reportStageChange({ ...current, status }, {
      status,
      movedAt: new Date(),
      stageChangeId
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

    const updated = await this.getLeadById(id);
    /*
     * La pantalla avisa con esto cuando el pase se hizo sin reunión. Viaja
     * derivado en cada respuesta y no se guarda en ninguna columna: en cuanto
     * alguien cargue la reunión deja de ser cierto, igual que `is_locked` de
     * un hito o `delivery_blocked` de un entregable.
     */
    if (updated && appointmentWithoutMeeting) updated.appointment_without_meeting = true;
    return updated;
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
    /*
     * La ATRIBUCIÓN no se edita por acá, y es a propósito: `meta_*`,
     * `tiktok_*` y `ctwa_*` las escribe la plataforma al entrar el lead y
     * nadie más (ver `leadOrigin.js`). Es lo que hace que la plataforma, la
     * campaña, el anuncio y el "ID de origen" sean de solo lectura para
     * cualquiera que use el panel: un id de anuncio corregido a mano es un
     * lead acreditado a una campaña que no lo trajo, y de esos números cuelga
     * el presupuesto. Lo que sí es libre es `source`, el canal escrito a mano
     * de un lead que no vino de un anuncio — ahí no hay nada que falsear.
     */
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

  /**
   * Cuánto trabajo cuelga de cada uno de estos leads.
   *
   * Cinco consultas agrupadas para TODA la lista, no cinco por lead: se usa
   * desde el listado de duplicados, que puede traer cientos de fichas.
   */
  async workloadByLead(ids = []) {
    const unicos = [...new Set(ids.map(Number).filter(Boolean))];
    const mapa = new Map(unicos.map((id) => [id, { projects: 0, income: 0, contracts: 0, quotes: 0, commissions: 0, signedContracts: 0 }]));
    if (unicos.length === 0) return mapa;

    const contar = async (tabla, campo) => {
      const filas = await db(tabla).whereIn('lead_id', unicos).select('lead_id').count({ n: '*' }).groupBy('lead_id');
      for (const fila of filas) {
        const registro = mapa.get(Number(fila.lead_id));
        if (registro) registro[campo] = Number(fila.n) || 0;
      }
    };

    await Promise.all([
      contar('projects', 'projects'),
      contar('finance_income', 'income'),
      contar('contracts', 'contracts'),
      contar('quotes', 'quotes'),
      contar('sales_commissions', 'commissions'),
      contar('signed_contracts', 'signedContracts')
    ]);
    return mapa;
  }

  /**
   * Borra la ficha de un lead. Devuelve cuántas filas borró.
   *
   * Se niega si de esa ficha cuelga trabajo, y no es una precaución de más:
   * `projects`, `quotes`, `sales_commissions`, las notas y el historial de
   * etapas están en CASCADE, así que borrar el lead **borra el proyecto con
   * todo lo suyo**; y `finance_income` y `contracts` están en SET NULL, así
   * que las cuotas sobreviven pero se quedan **sin cliente** — desaparecen del
   * cierre en INGRESOS y de Cobranzas, y ya no hay forma de saber de quién
   * eran. Hasta acá el borrado no comprobaba nada, y el botón nuevo del modal
   * de duplicados lo pone justo al lado de una ficha marcada "🏆 con proyecto".
   *
   * La regla es la MISMA que viaja al listado de duplicados
   * (`deletionBlockReason`), para que el botón que se ve y lo que el servidor
   * acepta no puedan decir cosas distintas.
   */
  async deleteLead(id, { actor = null } = {}) {
    const workload = (await this.workloadByLead([id])).get(Number(id));
    const motivo = deletionBlockReason(workload);
    if (motivo) {
      const error = new Error(motivo);
      error.code = 'LEAD_HAS_WORK';
      throw error;
    }

    /*
     * La ficha se lee ANTES de borrarla: después no queda nada de ella (sus
     * notas, su historial de etapas y sus comisiones están en CASCADE), así que
     * este es el único momento en que se puede dejar constancia.
     */
    const lead = await db('leads').where({ id }).first();
    const borrados = await db('leads').where({ id }).del();
    if (!borrados || !lead) return borrados;

    try {
      await db('lead_deletions').insert({
        lead_id: lead.id,
        full_name: lead.full_name || null,
        phone: lead.phone || null,
        phone_key: phoneMatchKey(lead.phone),
        status: lead.status || null,
        deleted_by_user_id: actor?.id || null,
        deleted_by_name: actor?.name || null
      });
    } catch (error) {
      // La bitácora no puede deshacer un borrado que ya ocurrió ni fallarle a
      // quien lo pidió: si la tabla todavía no existe en este entorno (falta
      // `npm run migrate`), el lead se borró igual y queda dicho en el log.
      console.warn('⚠️ No se pudo registrar el borrado del lead', id, '—', error.message);
    }

    return borrados;
  }
}

/**
 * Por qué NO se puede borrar esta ficha, o `null` si se puede.
 *
 * Nombra lo que hay colgando y lo que pasaría, en vez de un "no se puede" a
 * secas: de un duplicado casi siempre se borra el gemelo vacío, y si justo el
 * que se eligió es el que tiene el proyecto hay que poder darse cuenta sin
 * salir del modal.
 */
export function deletionBlockReason(workload) {
  if (!workload) return null;

  const tiene = [];
  const pasaria = [];
  if (workload.projects > 0) {
    tiene.push('un proyecto abierto');
    pasaria.push('se borraría el proyecto con todo su trabajo');
  }
  if (workload.quotes > 0) {
    tiene.push(`${workload.quotes} cotización(es)`);
    pasaria.push('se borrarían sus cotizaciones');
  }
  if (workload.commissions > 0) {
    tiene.push(`${workload.commissions} comisión(es) devengada(s)`);
    pasaria.push('se borrarían sus comisiones');
  }
  // Las dos SET NULL van juntas: la fila sobrevive pero se queda huérfana, que
  // en los libros es casi peor que perderla — nadie sabe de quién era.
  if (workload.income > 0) tiene.push(`${workload.income} cuota(s) en Finanzas`);
  if (workload.contracts > 0) tiene.push(`${workload.contracts} contrato(s)`);
  if (workload.income > 0 || workload.contracts > 0) pasaria.push('el dinero quedaría sin cliente');
  // El contrato firmado está en CASCADE y es el respaldo legal de la venta: de
  // todo lo que cuelga de una ficha, es lo único que no se puede volver a
  // generar desde el sistema.
  if (workload.signedContracts > 0) {
    tiene.push(`${workload.signedContracts} contrato(s) firmado(s)`);
    pasaria.push('se borraría el respaldo de la firma');
  }

  if (tiene.length === 0) return null;

  return `Esta ficha tiene ${tiene.join(', ')}: ${pasaria.join(' y ')}. `
    + 'Si la repetida es esta, primero hay que mover ese trabajo a la ficha que se queda.';
}
