import { db } from '../db/connection.js';
import { SETTER_ONLY_STATUSES } from './salesFunnelStage.js';

export const CONTRACT_STATUSES = ['borrador', 'firmado', 'anulado'];

const EDITABLE_FIELDS = {
  title: 'title',
  status: 'status',
  clientName: 'client_name',
  clientDni: 'client_dni',
  clientAddress: 'client_address',
  clientEmail: 'client_email',
  clientPhone: 'client_phone',
  serviceDescription: 'service_description',
  university: 'university',
  career: 'career',
  totalAmount: 'total_amount',
  currency: 'currency',
  city: 'city',
  contractDate: 'contract_date',
  representativeName: 'representative_name',
  intro: 'intro',
  closing: 'closing'
};

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
}

// mysql2 entrega DATE como un Date a medianoche LOCAL; serializado a JSON
// (UTC) podía correrse un día. Se devuelve siempre como "YYYY-MM-DD".
/**
 * Una columna DATE a "YYYY-MM-DD". Se toman los componentes LOCALES y no
 * `toISOString()`: la fecha llega como medianoche local y pasarla a UTC puede
 * correrla un día.
 */
function isoDay(value) {
  if (!value) return null;
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function withIsoDate(contract) {
  contract.contract_date = isoDay(contract.contract_date);
  return contract;
}

/** Normaliza una lista de cláusulas: sin vacías, con `position` 1..n en el orden recibido. */
export function cleanClauses(clauses) {
  return (clauses || [])
    .map((c) => ({ title: String(c.title || '').trim(), body: String(c.body || '').trim() }))
    .filter((c) => c.title || c.body)
    .map((c, index) => ({ position: index + 1, title: c.title || 'CLÁUSULA', body: c.body }));
}

/**
 * Filas del cronograma de entregas, listas para guardar. Lo que manda el
 * formulario se numera acá por su orden en la lista, así que mover una fila
 * arriba o abajo cambia el orden en que se imprime sin tocar nada más.
 *
 * Una fila sin descripción se descarta: una entrega con fecha pero sin decir
 * QUÉ se entrega no significa nada en el contrato. Al revés sí vale —
 * "Firma de contrato" no necesita fecha propia y se imprime "Por definir".
 */
export function cleanDeliverables(rows) {
  return (rows || [])
    .map((r) => ({
      due_date: r.dueDate || r.due_date || null,
      avance: String(r.avance || '').trim().slice(0, 500)
    }))
    .filter((r) => r.avance)
    .map((r, index) => ({ position: index + 1, due_date: r.due_date || null, avance: r.avance }));
}

export class ContractService {
  /**
   * `financeLedgerService` se inyecta porque el cronograma de pagos del
   * contrato NO es una copia: son las cuotas reales del lead en Finanzas. Lo
   * que se pacta acá es lo que se cobra allá, sin sincronizaciones que se
   * puedan desfasar.
   */
  constructor({ financeLedgerService } = {}) {
    this.financeLedgerService = financeLedgerService;
  }

  async list({ leadId } = {}) {
    const query = db('contracts')
      .leftJoin('leads', 'contracts.lead_id', 'leads.id')
      .select('contracts.*', 'leads.full_name as lead_name')
      .orderBy('contracts.created_at', 'desc');
    if (leadId) query.where('contracts.lead_id', leadId);
    return (await query).map(withIsoDate);
  }

  /**
   * Clientes del Funnel de Ventas para asociar un contrato: se excluyen las
   * etapas que solo existen en el Setter Funnel (el bot aún los califica) y
   * los descartados.
   *
   * El sello `sales_funnel_at` entra igual aunque el status diga otra cosa: un
   * lead que ya graduó y quedó con una etapa del setter sigue siendo un cliente
   * del closer, y no poder emitirle el contrato sería el mismo problema visto
   * desde otra pantalla.
   */
  async listClientLeads() {
    return db('leads')
      .where(function () {
        this.whereNotIn('status', SETTER_ONLY_STATUSES).orWhereNotNull('sales_funnel_at');
      })
      .select('id', 'full_name', 'phone', 'dni', 'status')
      .orderBy('created_at', 'desc');
  }

  async getById(id) {
    const contract = await db('contracts').where({ id }).first();
    if (!contract) return null;
    contract.clauses = await db('contract_clauses').where({ contract_id: id }).orderBy('position');
    contract.installments = contract.lead_id && this.financeLedgerService
      ? await this.financeLedgerService.listScheduleByLead(contract.lead_id)
      : [];
    // Las entregas son del contrato y no dependen del lead: un contrato sin
    // lead asociado también puede tener su cronograma de entregas.
    //
    // La fecha se normaliza a "YYYY-MM-DD" igual que hace Finanzas con las
    // cuotas: de una columna DATE el driver devuelve un Date, y eso rompía
    // tanto el `<input type="date">` del formulario como el formateo del
    // documento, que imprimía "Por definir" sobre una fecha ya cargada.
    const deliverables = await db('contract_deliverables')
      .where({ contract_id: id })
      .orderBy('position')
      .select('id', 'due_date', 'avance');
    contract.deliverables = deliverables.map((row) => ({ ...row, due_date: isoDay(row.due_date) }));
    return withIsoDate(contract);
  }

  /**
   * Crea un contrato desde un tipo de contrato: copia su título, apertura,
   * cierre y cláusulas, y los datos de la parte cliente desde el lead. Todo
   * queda editable en el contrato sin afectar al tipo ni al lead.
   */
  async create({ templateId, leadId = null, createdBy = null }) {
    const template = templateId ? await db('contract_templates').where({ id: templateId }).first() : null;
    if (!template) throw Object.assign(new Error('Tipo de contrato no encontrado.'), { status: 400 });

    const lead = leadId ? await db('leads').where({ id: leadId }).first() : null;
    if (leadId && !lead) throw Object.assign(new Error('Lead no encontrado.'), { status: 404 });

    const location = [lead?.address, lead?.province, lead?.department].filter(Boolean).join(', ');
    const templateClauses = await db('contract_template_clauses').where({ template_id: template.id }).orderBy('position');

    const id = await db.transaction(async (trx) => {
      const [contractId] = await trx('contracts').insert({
        lead_id: lead?.id || null,
        template_id: template.id,
        title: template.title,
        intro: template.intro,
        closing: template.closing,
        client_name: lead?.full_name || null,
        client_dni: lead?.dni || null,
        client_address: location || null,
        client_email: lead?.email || null,
        client_phone: lead?.phone || null,
        service_description: lead?.topic || null,
        // La cláusula primera del modelo nombra el reglamento de la
        // universidad y la carrera del asesorado: se traen del lead para no
        // escribirlos a mano en el texto de la cláusula.
        university: lead?.university || null,
        career: lead?.field_of_study || null,
        total_amount: lead?.total_amount ?? null,
        city: lead?.province || lead?.department || null,
        contract_date: todayIso(),
        created_by: createdBy
      });
      const clauses = cleanClauses(templateClauses).map((c) => ({ ...c, contract_id: contractId }));
      if (clauses.length) await trx('contract_clauses').insert(clauses);
      return contractId;
    });
    return this.getById(id);
  }

  /**
   * Actualiza los datos del contrato y, si vienen, REEMPLAZA sus cláusulas
   * por la lista recibida (en ese orden): así agregar, quitar y reordenar es
   * una sola operación atómica.
   */
  async update(id, data) {
    const payload = {};
    for (const [key, column] of Object.entries(EDITABLE_FIELDS)) {
      if (data[key] !== undefined) payload[column] = data[key] === '' ? null : data[key];
    }
    if (payload.status && !CONTRACT_STATUSES.includes(payload.status)) {
      throw Object.assign(new Error('Estado de contrato no válido.'), { status: 400 });
    }
    if (payload.title === null) delete payload.title;

    // El monto total y el cronograma viven en el lead / en Finanzas, no en el
    // contrato: se guardan primero, y si algo no cuadra (una cuota ya cobrada
    // que se intenta borrar, un plan que supera el precio) la operación corta
    // antes de tocar el contrato.
    const contract = await db('contracts').where({ id }).first();
    if (!contract) return null;
    if (contract.lead_id && this.financeLedgerService) {
      if (payload.total_amount !== undefined) {
        await this.financeLedgerService.setLeadTotalAmount(contract.lead_id, payload.total_amount);
      }
      if (Array.isArray(data.installments)) {
        await this.financeLedgerService.replaceScheduleForLead(contract.lead_id, data.installments);
      }
    }

    const updated = await db.transaction(async (trx) => {
      const count = await trx('contracts').where({ id }).update({ ...payload, updated_at: trx.fn.now() });
      if (!count) return false;
      if (Array.isArray(data.clauses)) {
        await trx('contract_clauses').where({ contract_id: id }).del();
        const clauses = cleanClauses(data.clauses).map((c) => ({ ...c, contract_id: id }));
        if (clauses.length) await trx('contract_clauses').insert(clauses);
      }
      if (Array.isArray(data.deliverables)) {
        await trx('contract_deliverables').where({ contract_id: id }).del();
        const rows = cleanDeliverables(data.deliverables).map((d) => ({ ...d, contract_id: id }));
        if (rows.length) await trx('contract_deliverables').insert(rows);
      }
      return true;
    });
    return updated ? this.getById(id) : null;
  }

  /**
   * Vuelve a copiar el texto del tipo de contrato sobre un contrato ya creado:
   * título, apertura, cierre y cláusulas.
   *
   * Un contrato guarda su PROPIA copia del texto al crearse, y eso no se toca:
   * es lo que impide que editar un tipo altere un contrato ya emitido. El
   * efecto secundario es que un contrato creado antes de una mejora del modelo
   * se queda con la versión vieja para siempre, y la única salida era
   * recrearlo a mano (caso real: CTR-2026-0004 y CTR-2026-0005, cada uno con
   * una redacción distinta de la cláusula primera).
   *
   * Por eso esto es una acción explícita y no algo que pase solo:
   *   - solo en BORRADOR. Un contrato firmado o anulado no se reescribe nunca,
   *     aunque el tipo haya cambiado: lo que se firmó es lo que dice el papel.
   *   - solo el TEXTO. Los datos de las partes, el monto, el cronograma de
   *     pagos y el de entregas se conservan enteros — no salen del tipo.
   *   - pisa lo editado a mano en ESE contrato, que es justamente el punto, y
   *     por eso quien llama tiene que confirmarlo antes.
   */
  async resyncFromTemplate(id) {
    const contract = await db('contracts').where({ id }).first();
    if (!contract) return null;

    if (contract.status !== 'borrador') {
      throw Object.assign(
        new Error('Solo se puede actualizar un contrato en borrador: uno firmado o anulado conserva el texto con el que se emitió.'),
        { status: 409 }
      );
    }
    if (!contract.template_id) {
      throw Object.assign(
        new Error('Este contrato no está asociado a ningún tipo de contrato, así que no hay texto desde el cual actualizarlo.'),
        { status: 409 }
      );
    }

    const template = await db('contract_templates').where({ id: contract.template_id }).first();
    if (!template) {
      throw Object.assign(
        new Error('El tipo de contrato del que salió este contrato ya no existe.'),
        { status: 409 }
      );
    }

    const templateClauses = await db('contract_template_clauses')
      .where({ template_id: template.id })
      .orderBy('position');

    await db.transaction(async (trx) => {
      await trx('contracts').where({ id }).update({
        title: template.title,
        intro: template.intro,
        closing: template.closing,
        updated_at: trx.fn.now()
      });
      await trx('contract_clauses').where({ contract_id: id }).del();
      const clauses = cleanClauses(templateClauses).map((c) => ({ ...c, contract_id: id }));
      if (clauses.length) await trx('contract_clauses').insert(clauses);
    });

    return this.getById(id);
  }

  async remove(id) {
    return db('contracts').where({ id }).del();
  }
}
