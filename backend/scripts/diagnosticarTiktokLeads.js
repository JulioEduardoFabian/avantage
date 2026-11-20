import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/connection.js';
import { TikTokAdsService } from '../services/tiktokAdsService.js';
import { TikTokLeadsService } from '../services/tiktokLeadsService.js';

/**
 * ¿Puede este token traer los leads de los formularios instantáneos de TikTok?
 *
 * Solo LEE: no da de alta ningún lead, no escribe en ninguna tabla. Existe
 * porque de la importación (`tiktokLeadsService.js`) cuelgan tres cosas que no
 * se pueden comprobar mirando el código, y que fallan de maneras muy
 * distintas:
 *
 *  1. **El permiso.** El scope de Lead Generation es propio y va aparte de
 *     Ads Management. Una app autorizada solo con "Ads Management" y
 *     "Reporting" —que es lo que alcanza para sincronizar campañas— sincroniza
 *     perfecto y NO puede leer un solo lead. Es el fallo más probable y el
 *     único que se arregla reautorizando la app, no tocando código.
 *  2. **Que la cuenta tenga formularios.** Una campaña de generación de leads
 *     puede estar mandando a un sitio web en vez de a un formulario
 *     instantáneo, y entonces no hay leads que traer por acá.
 *  3. **Cómo vienen las respuestas.** El nombre de cada pregunta lo escribe
 *     quien arma el formulario, así que el extractor se prueba contra las
 *     preguntas REALES de esta cuenta y no contra las que uno se imagina.
 *
 * Uso:
 *   node backend/scripts/diagnosticarTiktokLeads.js
 *
 * No imprime ni un teléfono ni un correo completos: de cada respuesta se
 * muestra la PREGUNTA y si vino con contenido, que es lo que hace falta para
 * saber si el extractor la está leyendo bien. Los datos de las personas se
 * miran en el CRM, no en la consola de nadie.
 */

const ads = new TikTokAdsService();
const leads = new TikTokLeadsService({ ads, leadService: null });

function linea(texto = '') {
  console.log(texto);
}

linea('🔎 Diagnóstico de leads de formulario instantáneo de TikTok\n');

// ── 1) El token y la cuenta ──────────────────────────────────────────────────
const status = await ads.status();
if (!status.configured) {
  linea(`❌ La integración de TikTok no está configurada: ${status.reason}${status.error ? ` — ${status.error}` : ''}`);

  /*
   * "No hay token" y "este proceso no ve el token" se escriben igual acá y son
   * cosas distintas, con arreglos distintos.
   *
   * El panel de la aplicación lee `process.env`, que en un hosting lo llena el
   * panel de variables de entorno (Hostinger, Passenger) al arrancar el
   * proceso. Este script, en cambio, se corre a mano en una shell y toma las
   * variables del archivo `.env` del directorio desde el que se lo invocó. Con
   * el token cargado SOLO en el panel del hosting, el panel funciona y este
   * script dice "no_token" — y manda a reconectar una integración que estaba
   * bien (09/11/2026).
   *
   * Por eso se informa dónde se buscó y qué se encontró, en vez de mandar al
   * README a secas.
   */
  if (status.reason === 'no_token') {
    const envPath = path.resolve(process.cwd(), '.env');
    const hayArchivo = fs.existsSync(envPath);
    const enArchivo = hayArchivo
      && /^\s*TIKTOK_ACCESS_TOKEN\s*=\s*\S/m.test(fs.readFileSync(envPath, 'utf8'));

    linea('');
    linea('   Dónde se buscó el token:');
    linea(`     · archivo .env  → ${envPath}`);
    linea(`       ${hayArchivo ? (enArchivo ? 'tiene TIKTOK_ACCESS_TOKEN con valor' : 'existe, pero sin TIKTOK_ACCESS_TOKEN') : 'no existe'}`);
    linea(`     · entorno del proceso (process.env) → ${process.env.TIKTOK_ACCESS_TOKEN ? 'definido' : 'no definido'}`);
    linea('');
    linea('   Si la aplicación SÍ está conectada a TikTok (Panel → Campañas muestra');
    linea('   "🟢 Conectado a TikTok Ads"), entonces el token está cargado en el panel de');
    linea('   variables del hosting y no en este archivo: el que no lo ve es este script,');
    linea('   no la aplicación. Corrélo con la variable a mano para diagnosticar igual:');
    linea('');
    linea('     TIKTOK_ACCESS_TOKEN=xxx node backend/scripts/diagnosticarTiktokLeads.js');
    linea('');
    linea('   Si la aplicación tampoco está conectada, ahí sí falta configurarla:');
    linea('   ver README > "Conectar TikTok Ads".');
  } else {
    linea('   Sin esto no hay nada que diagnosticar. Ver README > "Conectar TikTok Ads".');
  }

  await db.destroy();
  process.exit(0);
}

linea(`✅ Token válido · cuenta ${status.advertiserName || '(sin nombre)'} (${status.advertiserId})`);
if (status.advertiserDisabled) {
  linea(`   ⚠️ TikTok reporta la cuenta ${status.advertiserStatusLabel}; lo ya entregado se sigue pudiendo leer.`);
}

// ── 2) Los formularios ───────────────────────────────────────────────────────
linea('\n▶ Formularios instantáneos (Instant Pages) de la cuenta');

let forms = [];
try {
  const res = await leads.listForms(status.advertiserId);
  forms = res.forms;
  if (res.source === 'crm') {
    linea('   ⚠️ TikTok no dejó listarlos; se usan los que ya figuran en la base.');
    linea(`   ${res.aviso}`);
  }
  if (!forms.length) {
    linea('   (ninguno) — esta cuenta no tiene formularios instantáneos, o el token no los ve.');
  }
  for (const form of forms) {
    linea(`   · ${form.id}  ${form.name || '(sin nombre)'}${form.status ? `  [${form.status}]` : ''}`);
  }
} catch (error) {
  linea(`   ❌ ${error.message}`);
  linea('\n   Si el error habla de permisos: la app necesita el scope de Lead Generation.');
  linea('   Se agrega en business-api.tiktok.com > My Apps > tu app > Scope of permission,');
  linea('   y DESPUÉS hay que volver a autorizar y canjear un token nuevo (pasos 3 y 4 del');
  linea('   README): un token emitido antes de agregar el permiso no lo tiene.');
  await db.destroy();
  process.exit(0);
}

// ── 3) Una descarga de verdad, del primer formulario ─────────────────────────
if (forms.length) {
  const form = forms[0];
  linea(`\n▶ Prueba de descarga sobre el formulario ${form.id} (${form.name || 'sin nombre'})`);
  try {
    // Se usa el método privado a través de la corrida completa pero SIN
    // aplicar: `run({ apply: false })` compara y no escribe, que es justo lo
    // que este script quiere hacer.
    const fake = { getKnownTikTokLeadIds: async () => new Set() };
    const probe = new TikTokLeadsService({ ads, leadService: fake });
    const report = await probe.run({ apply: false });

    linea(`   Leads que TikTok tiene en total: ${report.totals.en_tiktok}`);
    linea(`   De esos, ya en el CRM (con este índice vacío, siempre 0): ${report.totals.en_crm}`);
    if (report.errores.length) {
      for (const err of report.errores) linea(`   ⚠️ ${err.page_id}: ${err.error}`);
    }
    for (const row of report.forms) {
      linea(`   · ${row.page_id}: ${row.en_tiktok} lead(s)`);
    }
  } catch (error) {
    linea(`   ❌ ${error.message}`);
  }
}

// ── 4) Lo que ya está en el CRM ──────────────────────────────────────────────
linea('\n▶ Lo que el CRM ya tiene de TikTok');
const [{ total = 0 } = {}] = await db('leads').whereNotNull('tiktok_lead_id').count({ total: '*' });
const [{ conAnuncio = 0 } = {}] = await db('leads').whereNotNull('tiktok_ad_id').count({ conAnuncio: '*' });
linea(`   Leads importados de TikTok: ${total}`);
linea(`   De esos, con su anuncio (los que figuran en la trazabilidad de Campañas): ${conAnuncio}`);
if (Number(total) > 0 && Number(conAnuncio) === 0) {
  linea('   ⚠️ Hay leads de TikTok sin `tiktok_ad_id`: entraron al CRM pero no se pueden');
  linea('      acreditar a ninguna campaña, así que no salen en la trazabilidad.');
}

await db.destroy();
