import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * ¿Por qué Meta rechaza los eventos de este conjunto de datos?
 *
 * Solo LEE (un GET a la Graph API). Existe porque el error que devuelve Meta
 * cuando falla un envío mete tres causas distintas en la misma frase: "does
 * not exist, cannot be loaded due to missing permissions, or does not support
 * this operation". Las tres se arreglan de forma diferente y la frase no dice
 * cuál es:
 *
 *   - El objeto NO se puede leer → es permisos: el token no tiene asignado ese
 *     conjunto de datos (Configuración del negocio > Orígenes de datos >
 *     Conjuntos de datos > asignar el usuario del sistema).
 *   - El objeto SÍ se lee pero el envío falla → el conjunto existe y es tuyo,
 *     pero no admite esa operación: hace falta otro conjunto, creado como
 *     origen de mensajes.
 *
 * Uso:
 *   node backend/scripts/diagnosticarDatasetMeta.js [id ...]
 *
 * Sin argumentos revisa los dos de la configuración (CRM y mensajería), que es
 * lo útil: compara el que funciona contra el que no.
 */

const version = process.env.META_CAPI_GRAPH_API_VERSION?.trim() || 'v26.0';
const token = (process.env.META_CAPI_ACCESS_TOKEN || process.env.META_ADS_ACCESS_TOKEN || '').trim();

if (!token) {
  console.error('❌ No hay token (META_CAPI_ACCESS_TOKEN o META_ADS_ACCESS_TOKEN) en el .env de este entorno.');
  console.error('');
  console.error('   Si el token está puesto como variable del hosting (hPanel > Node.js >');
  console.error('   Variables), NO está en esta terminal: el hosting la inyecta en el proceso de');
  console.error('   la app, no en la sesión de la consola. Dos salidas:');
  console.error('     · usa el botón "Revisar acceso a los conjuntos" del panel, en');
  console.error('       /admin/webhooks, que corre dentro de la app y sí la tiene; o');
  console.error('     · pásala en la misma línea: META_CAPI_ACCESS_TOKEN=xxx node backend/scripts/diagnosticarDatasetMeta.js');
  process.exit(1);
}

const ids = process.argv.slice(2).filter(Boolean);
const objetivos = ids.length > 0
  ? ids.map((id) => ({ id, etiqueta: 'indicado a mano' }))
  : [
    { id: (process.env.META_CAPI_DATASET_ID || '').trim(), etiqueta: 'CRM (META_CAPI_DATASET_ID)' },
    { id: (process.env.META_CAPI_MESSAGING_DATASET_ID || '').trim(), etiqueta: 'mensajería (META_CAPI_MESSAGING_DATASET_ID)' }
  ].filter((objetivo) => objetivo.id);

if (objetivos.length === 0) {
  console.error('❌ No hay ningún conjunto de datos configurado ni indicado como argumento.');
  process.exit(1);
}

for (const { id, etiqueta } of objetivos) {
  /*
   * Se prueba el permiso de ENVÍO y no la lectura del objeto: un token
   * generado desde el Administrador de eventos puede mandar eventos a un
   * conjunto sin poder leer su ficha, así que un GET devuelve "(#100) Missing
   * Permission" incluso para el conjunto que funciona. Se hace un POST al
   * endpoint real con la lista de eventos VACÍA: no manda ninguna conversión
   * y recorre el mismo permiso.
   */
  const url = `https://graph.facebook.com/${version}/${id}/events`;

  console.log(`
▶ ${id} — ${etiqueta}`);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [], access_token: token })
    });
    const body = await response.json().catch(() => ({}));
    const error = body.error || {};
    const code = Number(error.code) || null;
    const mensaje = error.message || '';
    const bloqueadoPorObjeto = code === 100 && /does not exist|missing permission|does not support/i.test(mensaje);

    if (code === 190) {
      console.log('  ❌ El token es inválido o caducó.');
      console.log(`     ${mensaje}`);
      console.log('     Genera uno nuevo (usuario del sistema con ads_management).');
    } else if (bloqueadoPorObjeto) {
      console.log(`  ❌ Por este conjunto NO se puede enviar (código ${code}).`);
      console.log(`     ${mensaje}`);
      console.log('     O el token no lo tiene asignado (Configuración del negocio > Orígenes de');
      console.log('     datos > Conjuntos de datos), o el conjunto no admite la Conversions API y');
      console.log('     hace falta uno creado como origen de mensajes.');
    } else {
      console.log('  ✅ El token PUEDE enviar a este conjunto.');
      if (mensaje) console.log(`     (Meta respondió "${mensaje}" a la petición vacía, que es lo esperable.)`);
    }
  } catch (error) {
    console.log(`  ⚠️ No se pudo consultar a Meta: ${error.message}`);
  }
}

console.log('');
