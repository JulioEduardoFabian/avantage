import { db } from '../db/connection.js';

/**
 * El contrato **ya firmado** por el cliente: el PDF, el Word o el enlace de
 * Drive que vuelve con la firma.
 *
 * Tiene tabla propia (`signed_contracts`, ver su migración) porque hay
 * contratos firmados que el sistema nunca emitió —se arman por fuera y vuelven
 * escaneados— y porque un lead puede tener más de uno (el contrato y su
 * adenda). Cuelga del LEAD y no del proyecto: se firma antes de que el proyecto
 * exista, y es justamente lo que habilita abrirlo.
 *
 * Tres decisiones que conviene no deshacer:
 *
 * 1. **Un archivo o un enlace, nunca los dos ni ninguno** (`validateSource`).
 *    Las dos formas conviven porque el equipo usa las dos: el escaneo que llega
 *    por WhatsApp se sube, y el que ya vive en la carpeta de Drive del cliente
 *    se enlaza —copiarlo sería tener dos originales y no saber cuál manda—.
 *    Aceptar ambos a la vez es crear ese problema a propósito; aceptar ninguno
 *    es guardar una fila que dice "hay contrato firmado" sin el contrato.
 *
 * 2. **Registrar el firmado marca el contrato emitido como `firmado`** cuando
 *    se lo ata (`contract_id`). No es editar el contrato —su contenido, sus
 *    cláusulas y sus importes quedan intactos—: es anotar un hecho que el
 *    documento recién subido ya prueba. Sin eso, el contrato quedaría en
 *    "borrador" en su pantalla con su copia firmada adjunta en la otra, que es
 *    exactamente el tipo de contradicción que después nadie sabe cuál creer.
 *    Quitar el documento **no** lo devuelve a borrador: se firmó igual, y
 *    borrar la copia no deshace la firma.
 *
 * 3. **El enlace se valida de verdad** (`normalizeExternalUrl`). Lo que se
 *    guarda termina siendo un `href` en la ficha, así que solo entran `http` y
 *    `https`: un `javascript:` pegado ahí se ejecutaría al hacer clic.
 */

/** Lo máximo que entra en la columna `external_url`. */
const MAX_URL = 1000;

/**
 * El enlace, normalizado, o `null` si no vino ninguno. Lanza si vino algo que
 * no es una dirección web.
 *
 * Solo `http`/`https`: ver la decisión 3 del encabezado. Se rechaza también lo
 * que no se puede parsear en vez de guardarlo "por las dudas" — un enlace roto
 * guardado se descubre el día que hace falta el contrato.
 */
export function normalizeExternalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length > MAX_URL) {
    throw Object.assign(new Error('El enlace es demasiado largo.'), { status: 400 });
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(
      new Error('El enlace no parece una dirección válida. Pega la URL completa, empezando por https://'),
      { status: 400 }
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('El enlace tiene que empezar por http:// o https://'), { status: 400 });
  }
  return url.toString();
}

/**
 * Comprueba que venga exactamente una de las dos formas. Es pura y exportada
 * porque es la regla del módulo y la pantalla la aplica antes de dejar guardar:
 * lo que se ve y lo que el servidor acepta no pueden decir cosas distintas.
 */
export function validateSource({ file = null, externalUrl = null } = {}) {
  if (file && externalUrl) {
    throw Object.assign(
      new Error('Sube el archivo o pega el enlace, no las dos cosas: si no, quedan dos originales y ninguno manda.'),
      { status: 400 }
    );
  }
  if (!file && !externalUrl) {
    throw Object.assign(
      new Error('Falta el documento: sube el PDF o el Word firmado, o pega el enlace de Drive.'),
      { status: 400 }
    );
  }
}

/** Una columna DATE a "YYYY-MM-DD", sin que el paso a UTC le corra el día. */
export function isoDay(value) {
  if (!value) return null;
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/** Un día de calendario tal como lo escribe un `<input type="date">`, o null. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanDay = (value) => (DAY_RE.test(String(value || '')) ? String(value) : null);

/**
 * Cómo está guardado este documento. La pantalla necesita distinguirlo para
 * saber si ofrece "Descargar" o "Abrir en Drive", y se deriva en cada lectura
 * en vez de guardarse: es la misma razón por la que no se guarda el `is_locked`
 * de un hito — un dato que ya está en la fila, repetido, es un dato que puede
 * quedar diciendo otra cosa.
 */
export function sourceOf(row) {
  return row?.file_filename ? 'archivo' : 'enlace';
}

/** Cómo se llama el documento en pantalla cuando nadie le puso título. */
export function displayTitle(row) {
  const title = String(row?.title || '').trim();
  if (title) return title;
  return row?.file_original_name || 'Contrato firmado';
}

function present(row) {
  return {
    id: row.id,
    lead_id: row.lead_id,
    contract_id: row.contract_id,
    contract_title: row.contract_title || null,
    title: displayTitle(row),
    source: sourceOf(row),
    file_original_name: row.file_original_name,
    file_mime_type: row.file_mime_type,
    file_size: row.file_size,
    external_url: row.external_url,
    signed_at: isoDay(row.signed_at),
    notes: row.notes,
    uploaded_by_name: row.uploaded_by_name || null,
    created_at: row.created_at
  };
}

export class SignedContractService {
  /** La consulta base, con el nombre de quien subió y el del contrato atado. */
  #query() {
    return db('signed_contracts as sc')
      .leftJoin('users as u', 'u.id', 'sc.uploaded_by')
      .leftJoin('contracts as c', 'c.id', 'sc.contract_id')
      .select('sc.*', 'u.name as uploaded_by_name', 'c.title as contract_title');
  }

  /** Los contratos firmados de un lead, del más nuevo al más viejo. */
  async listByLead(leadId) {
    const rows = await this.#query().where('sc.lead_id', leadId).orderBy('sc.created_at', 'desc');
    return rows.map(present);
  }

  /**
   * Los contratos EMITIDOS de un lead, para poder atar el firmado al que
   * corresponde.
   *
   * Viaja deliberadamente corto —id, título, estado y fecha— y **sin importes**:
   * esto se lee desde la ficha del lead, que es `leads.view`, y el dinero del
   * contrato es de quien tiene el permiso del dinero. Es la misma regla de
   * "en Proyectos no se muestran importes".
   */
  async listContractOptions(leadId) {
    const rows = await db('contracts')
      .where({ lead_id: leadId })
      .orderBy('created_at', 'desc')
      .select('id', 'title', 'status', 'contract_date');
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      contract_date: isoDay(row.contract_date)
    }));
  }

  /** El documento con ese id, o nada. */
  async getById(id) {
    const row = await db('signed_contracts').where({ id }).first();
    return row || null;
  }

  /**
   * Registra un contrato firmado.
   *
   * `contractId` solo se acepta si ese contrato es de ESTE lead: si no, atar el
   * documento del cliente A al contrato del cliente B sería un formulario
   * manipulado de distancia, y además marcaría como firmado un contrato ajeno.
   */
  async create(leadId, {
    title = null,
    contractId = null,
    externalUrl = null,
    signedAt = null,
    notes = null,
    file = null,
    uploadedBy = null
  } = {}) {
    const url = normalizeExternalUrl(externalUrl);
    validateSource({ file, externalUrl: url });

    let contrato = null;
    if (contractId) {
      contrato = await db('contracts').where({ id: contractId }).first();
      if (!contrato || Number(contrato.lead_id) !== Number(leadId)) {
        throw Object.assign(
          new Error('Ese contrato no es de este lead.'),
          { status: 400 }
        );
      }
    }

    const [id] = await db('signed_contracts').insert({
      lead_id: leadId,
      contract_id: contrato ? contrato.id : null,
      title: String(title || '').trim().slice(0, 200) || null,
      file_filename: file?.filename || null,
      file_original_name: file?.originalname || null,
      file_mime_type: file?.mimetype || null,
      file_size: file?.size || null,
      external_url: url,
      signed_at: cleanDay(signedAt),
      notes: String(notes || '').trim().slice(0, 500) || null,
      uploaded_by: uploadedBy
    });

    // Ver la decisión 2 del encabezado: el contrato emitido queda `firmado`.
    if (contrato && contrato.status !== 'firmado') {
      await db('contracts').where({ id: contrato.id }).update({ status: 'firmado' });
    }

    return present(await this.#query().where('sc.id', id).first());
  }

  /**
   * Borra el registro y devuelve la fila que borró, para que la ruta pueda
   * quitar también el archivo del disco. El contrato emitido NO vuelve a
   * borrador (ver la decisión 2).
   */
  async remove(id) {
    const row = await this.getById(id);
    if (!row) return null;
    await db('signed_contracts').where({ id }).del();
    return row;
  }
}
