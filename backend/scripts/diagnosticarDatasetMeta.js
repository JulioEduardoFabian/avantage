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
  const url = new URL(`https://graph.facebook.com/${version}/${id}`);
  url.searchParams.set('fields', 'id,name,owner_business{id,name}');
  url.searchParams.set('access_token', token);

  console.log(`\n▶ ${id} — ${etiqueta}`);
  try {
    const response = await fetch(url);
    const body = await response.json();

    if (response.ok) {
      console.log(`  ✅ El token LO VE: "${body.name || 'sin nombre'}"`);
      if (body.owner_business) {
        console.log(`     Negocio dueño: ${body.owner_business.name} (${body.owner_business.id})`);
      }
      console.log('     Si aun así rechaza los eventos, no es permiso: ese conjunto no admite');
      console.log('     esta operación y hace falta uno creado como origen de mensajes.');
    } else {
      const error = body.error || {};
      console.log(`  ❌ El token NO LO VE (HTTP ${response.status}, código ${error.code}${error.error_subcode ? '/' + error.error_subcode : ''})`);
      console.log(`     ${error.message || 'sin mensaje'}`);
      // El 190 no es del conjunto sino del token: mandarlo a revisar permisos
      // del conjunto sería mandarlo a buscar donde no está (y fallarían los
      // dos conjuntos, no uno).
      if (Number(error.code) === 190) {
        console.log('     El token es inválido o caducó. Genera uno nuevo (usuario del sistema con');
        console.log('     ads_management) y reemplázalo en META_CAPI_ACCESS_TOKEN.');
      } else {
        console.log('     Es permisos: asigna ese conjunto de datos al usuario del sistema del token');
        console.log('     en Configuración del negocio > Orígenes de datos > Conjuntos de datos,');
        console.log('     o genera el token desde ese mismo conjunto en el Administrador de eventos.');
      }
    }
  } catch (error) {
    console.log(`  ⚠️ No se pudo consultar a Meta: ${error.message}`);
  }
}

console.log('');
