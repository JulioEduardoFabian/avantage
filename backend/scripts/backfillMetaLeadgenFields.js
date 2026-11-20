/**
 * Backfill: completa celular, correo, grado académico, universidad, carrera y
 * las demás respuestas de los leads que ya se importaron desde un formulario
 * de Meta Lead Ads (metaWebhookService.importLead()) con menos campos de los
 * que Meta había mandado — se quedaron con los valores por defecto
 * ("Pregrado (Bachiller/Título)", "General", sin universidad) o directamente
 * "Sin celular" aunque la persona sí los hubiera contestado.
 *
 * El caso del celular son los formularios que se contestan dentro de
 * Messenger o de Instagram: sus preguntas no usan la clave canónica de Meta
 * (`phone_number`) sino el texto de la pregunta, así que hasta el 26/10/2026
 * el importador solo guardaba el nombre (ver `metaLeadFields.js`).
 *
 * Vuelve a pedirle el lead a la Graph API usando el `leadgen_id` que ya quedó
 * guardado (en su columna o en el marcador de `additional_notes`), y solo
 * completa los campos que todavía están vacíos o en su valor por
 * defecto — nunca pisa un dato que el equipo ya haya corregido a mano.
 *
 * Desde el 01/11/2026 rescata además la **atribución**: el anuncio, el
 * conjunto, la campaña, sus NOMBRES y la fecha de envío en Meta. Las fichas
 * anteriores guardaban el `ad_id` y no el nombre, que se resolvía contra las
 * métricas sincronizadas de la campaña —donde solo están los anuncios que
 * siguen entregando—, así que un anuncio pausado dejaba al lead figurando
 * como "Sin campaña asignada" en la hoja de marketing. Es la mitad
 * recuperable de los datos históricos: lo que Meta ya no devuelve queda en
 * "sin dato" y no se inventa.
 *
 * `runMetaLeadgenBackfill()` se reutiliza desde POST
 * /api/leads/backfill-meta-fields (server.js) para que corra DENTRO del
 * proceso de la app ya arrancado por Passenger/Hostinger — ahí `db` y
 * `META_PAGE_ACCESS_TOKEN` ya están configurados correctamente. Correrlo
 * como script suelto por SSH (`node backend/scripts/backfillMetaLeadgenFields.js`)
 * requiere exportar esas mismas variables a mano en la sesión, porque un
 * proceso lanzado por SSH no hereda las variables de entorno que Hostinger
 * solo inyecta al proceso de la app.
 */
import { db } from '../db/connection.js';
import { extractMetaLeadForm, formatCustomFieldsNote } from '../services/metaLeadFields.js';
import { LeadService } from '../services/leadService.js';

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const LEADGEN_MARKER_RE = /\[Meta leadgen_id=(\d+)\]/;
// El encabezado ("[Meta leadgen_id=...] form_id=...") es lo único del
// additional_notes original que se conserva siempre — el resto (el bloque
// de respuestas del formulario) se reconstruye entero en cada corrida para
// no arrastrar un formato viejo (p. ej. la primera versión de este backfill
// guardaba el avance tal cual venía de Meta, a veces en snake_case).
const HEADER_RE = /^\[Meta leadgen_id=\d+\]\s+form_id=\S+/;
const DEFAULT_ACADEMIC_LEVEL = 'Pregrado (Bachiller/Título)';
const DEFAULT_FIELD_OF_STUDY = 'General';

/*
 * Se le pide a Meta el formulario Y la atribución. Los `*_name` hacen falta
 * acá tanto como en el alta: las fichas anteriores al 01/11/2026 guardaron el
 * `ad_id` pero no el nombre del anuncio, y el nombre se resolvía contra las
 * métricas sincronizadas de la campaña —donde solo están los anuncios que
 * siguen entregando—, así que en la hoja de marketing salían sin campaña.
 */
const META_BACKFILL_FIELDS = 'field_data,created_time,form_id,platform,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name';

async function fetchLead(leadgenId, token) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${leadgenId}?fields=${META_BACKFILL_FIELDS}&access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`);
  return data || {};
}

/**
 * Qué columnas de atribución le faltan a esta ficha.
 *
 * Solo los huecos: un `ad_id` ya guardado no se vuelve a escribir, y un nombre
 * que el equipo haya corregido a mano tampoco. Es la misma regla de
 * `attachMetaLeadToExisting()`.
 */
function missingAttribution(lead) {
  return [
    'meta_leadgen_id', 'meta_form_id', 'meta_ad_id', 'meta_adset_id', 'meta_campaign_id',
    'meta_ad_name', 'meta_adset_name', 'meta_campaign_name', 'meta_platform', 'meta_created_time'
  ].filter((col) => !lead[col]);
}

export async function runMetaLeadgenBackfill() {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error('Falta META_PAGE_ACCESS_TOKEN en el entorno del servidor.');

  /*
   * Se recorren las fichas que llevan el marcador del formulario y, además,
   * las que tienen el `leadgen_id` en su columna: desde que la atribución vive
   * en columnas, el id puede estar ahí sin que el marcador esté en las notas
   * (y es justo la ficha a la que le falta el nombre del anuncio).
   */
  const leads = await db('leads')
    .where('additional_notes', 'like', '%[Meta leadgen_id=%')
    .orWhereNotNull('meta_leadgen_id');

  const leadService = new LeadService();
  const result = { totalFound: leads.length, updated: [], skipped: 0, failed: [], phoneConflicts: [] };

  for (const lead of leads) {
    const leadgenId = lead.meta_leadgen_id
      || String(lead.additional_notes || '').match(LEADGEN_MARKER_RE)?.[1]
      || null;
    if (!leadgenId) { result.skipped++; continue; }

    const missingAcademicLevel = !lead.academic_level || lead.academic_level === DEFAULT_ACADEMIC_LEVEL;
    const missingFieldOfStudy = !lead.field_of_study || lead.field_of_study === DEFAULT_FIELD_OF_STUDY;
    const missingUniversity = !lead.university;
    // El celular es el que más falta hace: sin él la ficha no se puede llamar
    // y el lead no se cruza con el contacto que escriba después por WhatsApp.
    const missingPhone = !lead.phone;
    const missingEmail = !lead.email;
    // La atribución es la otra mitad del backfill: una ficha completa de datos
    // personales puede estar igual de incompleta para marketing.
    const faltaAtribucion = missingAttribution(lead);
    if (!missingAcademicLevel && !missingFieldOfStudy && !missingUniversity && !missingPhone
      && !missingEmail && !faltaAtribucion.length) {
      result.skipped++;
      continue;
    }

    try {
      const data = await fetchLead(leadgenId, token);
      const custom = extractMetaLeadForm(data.field_data || []);

      const patch = {};

      /*
       * La atribución, campo por campo y solo donde falta. Lo que Meta no
       * manda se queda sin escribir: "sin dato" es una respuesta legítima y
       * rellenarlo con algo plausible es justo lo que hacía que un lead
       * figurara en una campaña que no lo trajo.
       */
      const atribucion = {
        meta_leadgen_id: leadgenId,
        meta_form_id: data.form_id || null,
        meta_ad_id: data.ad_id || null,
        meta_adset_id: data.adset_id || null,
        meta_campaign_id: data.campaign_id || null,
        meta_ad_name: data.ad_name || null,
        meta_adset_name: data.adset_name || null,
        meta_campaign_name: data.campaign_name || null,
        meta_platform: data.platform || null,
        // El momento del envío en Meta, que no es cuándo entró acá: de esa
        // diferencia depende que el reporte cierre contra el Ads Manager.
        meta_created_time: data.created_time ? new Date(data.created_time) : null
      };
      for (const col of faltaAtribucion) {
        if (atribucion[col]) patch[col] = atribucion[col];
      }
      if (missingAcademicLevel && custom.academicLevel) patch.academic_level = custom.academicLevel;
      if (missingFieldOfStudy && custom.fieldOfStudy) patch.field_of_study = custom.fieldOfStudy;
      if (missingUniversity && custom.university) patch.university = custom.university;
      if (missingEmail && custom.email) patch.email = custom.email;
      // Un celular rescatado puede ser el de un lead que ya existe (la ficha
      // sin teléfono nunca se pudo cruzar contra él). Escribirlo igual deja
      // dos fichas con el mismo número, que es justo lo que `findByPhone`
      // existe para evitar: ahí se informa y se deja la decisión al equipo.
      if (missingPhone && custom.phone) {
        const duplicado = await leadService.findByPhone(custom.phone);
        if (duplicado && duplicado.id !== lead.id) {
          result.phoneConflicts.push({ id: lead.id, leadgenId, phone: custom.phone, existingLeadId: duplicado.id });
        } else {
          patch.phone = custom.phone;
        }
      }

      // Notas: se reconstruyen con lo que YA quedó bien en el lead (si no
      // era el valor por defecto) más lo que se acaba de rescatar de Meta,
      // para que el bloque de respuestas del formulario quede completo y
      // legible sea cual sea el estado previo del lead.
      const merged = {
        academicLevel: patch.academic_level || (!missingAcademicLevel ? lead.academic_level : null),
        fieldOfStudy: patch.field_of_study || (!missingFieldOfStudy ? lead.field_of_study : null),
        university: patch.university || (!missingUniversity ? lead.university : null),
        progressNote: custom.progressNote || null,
        // Las respuestas sin campo propio en la ficha: antes se descartaban.
        extras: custom.extras || []
      };
      const headerMatch = String(lead.additional_notes || '').match(HEADER_RE);
      const header = headerMatch ? headerMatch[0] : `[Meta leadgen_id=${leadgenId}] form_id=desconocido`;
      const rebuiltNotes = [header, formatCustomFieldsNote(merged)].filter(Boolean).join('\n');
      if (rebuiltNotes !== lead.additional_notes) patch.additional_notes = rebuiltNotes;

      if (Object.keys(patch).length === 0) {
        result.skipped++;
        continue;
      }

      await db('leads').where({ id: lead.id }).update(patch);
      result.updated.push({ id: lead.id, leadgenId, patch });
    } catch (error) {
      result.failed.push({ id: lead.id, leadgenId, error: error.message });
    }
  }

  return result;
}

// Uso por CLI: node backend/scripts/backfillMetaLeadgenFields.js
// (requiere exportar META_PAGE_ACCESS_TOKEN y las variables DB_* a mano en
// la sesión — en Hostinger es más simple disparar esto por HTTP, ver arriba).
if (import.meta.url === `file://${process.argv[1]}`) {
  const dotenv = await import('dotenv');
  dotenv.config();

  runMetaLeadgenBackfill()
    .then((result) => {
      console.log(`🔍 ${result.totalFound} lead(s) con marca de formulario de Meta encontrados.`);
      for (const u of result.updated) console.log(`✅ Lead #${u.id} (leadgen_id=${u.leadgenId}) actualizado:`, u.patch);
      for (const f of result.failed) console.error(`❌ Lead #${f.id} (leadgen_id=${f.leadgenId}): ${f.error}`);
      console.log(`\nListo. Actualizados: ${result.updated.length} · Sin cambios: ${result.skipped} · Con error: ${result.failed.length}`);
      return db.destroy();
    })
    .catch((error) => {
      console.error('❌ Error inesperado en el backfill:', error);
      process.exit(1);
    });
}
