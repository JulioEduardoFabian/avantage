import 'dotenv/config';
import { db } from '../db/connection.js';
import { leadOrigin, LEAD_ORIGIN_COLUMNS } from '../services/leadOrigin.js';

/**
 * ¿Se puede confiar en la calificación comercial de los leads?
 *
 * Solo LEE: no escribe en ninguna tabla y no toca ninguna ficha.
 *
 * Existe porque `leads.qualified` ya se rompió una vez de la peor manera
 * posible: se **derivaba** de que el lead hubiera salido de `nuevo`, con lo que
 * decía "Sí" en 403 de 403 leads. Un campo así no falla —devuelve un valor,
 * llena su columna en el exportable y se grafica— pero no mide nada, y de él
 * cuelga la decisión de cortarle el presupuesto a un anuncio.
 *
 * Lo que este script contesta son tres cosas distintas, y conviene no
 * confundirlas:
 *
 *  1. **Cobertura**: cuántos leads tienen la marca puesta. El vacío es
 *     información —separa al lead que nadie revisó del revisado y descartado—
 *     pero una cobertura del 3% quiere decir que las tasas que salen de este
 *     campo se calculan sobre casi nada.
 *  2. **Sesgo**: cómo se reparten los "Sí" y los "No". **Que casi todos sean
 *     "Sí" es una ALERTA y no una prueba**: puede ser un campo roto como el de
 *     antes, o puede ser que los anuncios estén trayendo gente buena de verdad.
 *     Lo que sigue imprime el número y nombra las dos lecturas; la conclusión
 *     sale de mirar la muestra, no de la cifra.
 *  3. **Quién califica**: si la marca la pone una sola persona, el criterio es
 *     el de esa persona. Si la ponen cinco, el criterio escrito
 *     (`src/leadQualificationCriteria.js`) es lo único que las mantiene
 *     diciendo lo mismo, y conviene comprobar que coincidan.
 *
 * Y termina con una **muestra** para revisar a mano, que es lo único que de
 * verdad valida el dato: diez leads calificados al azar con los datos en los
 * que se apoya ese juicio. Sin eso, "el 98% dice Sí" es una cifra sin veredicto.
 *
 * Uso:
 *   node backend/scripts/auditarCalificacion.js [--meses 3] [--muestra 10]
 *
 * No imprime teléfonos ni correos completos: de cada lead sale el id, el
 * nombre, el origen y los datos académicos, que es lo que hace falta para
 * juzgar si estaba bien calificado. Los datos de contacto se miran en el CRM.
 */

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(`--${nombre}`);
  if (i < 0) return porDefecto;
  const valor = Number(args[i + 1]);
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto;
};

const MESES = opcion('meses', 3);
const MUESTRA = opcion('muestra', 10);

const linea = (texto = '') => console.log(texto);
const pct = (parte, total) => (total > 0 ? `${Math.round((parte / total) * 1000) / 10}%` : '—');

function desde(meses) {
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  const inicio = desde(MESES);

  linea('═'.repeat(74));
  linea('  AUDITORÍA DE LA CALIFICACIÓN COMERCIAL');
  linea(`  Leads creados desde ${inicio.toISOString().slice(0, 10)} (${MESES} meses)`);
  linea('═'.repeat(74));
  linea();

  const leads = await db('leads')
    .select(
      'id', 'full_name', 'qualified', 'qualified_at', 'qualified_by',
      'university', 'field_of_study', 'academic_level', 'thesis_situation',
      'overall_viability_score', 'status',
      ...LEAD_ORIGIN_COLUMNS
    )
    .where('created_at', '>=', inicio);

  if (!leads.length) {
    linea('No hay leads en el período. Probá con --meses 12.');
    return;
  }

  // ───────────────────────────── 1. Cobertura ──────────────────────────────
  const si = leads.filter((l) => l.qualified === 1 || l.qualified === true);
  const no = leads.filter((l) => l.qualified === 0 || l.qualified === false);
  const sinMarcar = leads.filter((l) => l.qualified === null || l.qualified === undefined);
  const marcados = si.length + no.length;

  linea('1. COBERTURA — ¿cuántos leads tienen la marca puesta?');
  linea('─'.repeat(74));
  linea(`   Total de leads          ${String(leads.length).padStart(6)}`);
  linea(`   Calificados (Sí o No)   ${String(marcados).padStart(6)}   ${pct(marcados, leads.length)}`);
  linea(`   Sin calificar           ${String(sinMarcar.length).padStart(6)}   ${pct(sinMarcar.length, leads.length)}`);
  linea();
  if (marcados === 0) {
    linea('   ⚠️  Nadie calificó ni un lead en el período. Cualquier tasa que salga de');
    linea('       este campo hoy se calcula sobre cero.');
  } else if (marcados / leads.length < 0.25) {
    linea('   ⚠️  Menos de un cuarto de los leads está calificado. El vacío es');
    linea('       información —el lead que nadie revisó— pero las tasas por anuncio');
    linea('       que salen de acá se apoyan en una minoría de las fichas.');
  }
  linea();

  // ─────────────────────────────── 2. Sesgo ────────────────────────────────
  linea('2. SESGO — ¿cómo se reparten los Sí y los No?');
  linea('─'.repeat(74));
  linea(`   Sí  ${String(si.length).padStart(6)}   ${pct(si.length, marcados)} de los calificados`);
  linea(`   No  ${String(no.length).padStart(6)}   ${pct(no.length, marcados)} de los calificados`);
  linea();

  /*
   * El umbral es alto (95%) y el mensaje nombra las DOS lecturas a propósito.
   * El campo ya estuvo roto de esta forma exacta —decía "Sí" en el 100% porque
   * se derivaba de la etapa— así que la señal hay que darla; pero un 97% de
   * "Sí" también es lo que se ve cuando el equipo califica solo lo que piensa
   * trabajar y deja el resto en vacío, que es un uso legítimo. Declarar roto el
   * dato desde la cifra es el mismo error con el signo cambiado.
   */
  if (marcados >= 20 && si.length / marcados >= 0.95) {
    linea('   ⚠️  ALERTA, no veredicto: más del 95% de los calificados dice "Sí".');
    linea('       Esto es exactamente lo que se veía cuando la marca se DERIVABA de la');
    linea('       etapa del lead (403 de 403 en "Sí"), y también lo que se ve cuando el');
    linea('       equipo solo califica lo que piensa trabajar y deja el resto vacío.');
    linea('       Las dos lecturas se distinguen mirando la muestra del punto 4:');
    linea('       si entre los "Sí" hay leads sin tesis, fuera del país o sin datos,');
    linea('       la marca no se está usando como juicio.');
  } else if (marcados >= 20 && no.length / marcados >= 0.95) {
    linea('   ⚠️  ALERTA: más del 95% dice "No". Revisá si el criterio se endureció o');
    linea('       si alguien está usando la marca para archivar leads.');
  } else if (marcados >= 20) {
    linea('   El reparto tiene variación en los dos sentidos, que es lo que se espera');
    linea('   de un juicio. Eso no dice que el criterio sea el correcto: eso lo dice');
    linea('   la muestra.');
  } else {
    linea('   Muy pocos calificados para hablar de reparto (hacen falta 20).');
  }
  linea();

  // ───────────────────────── 3. Quién califica ─────────────────────────────
  const autores = new Map();
  for (const lead of [...si, ...no]) {
    const key = lead.qualified_by || 0;
    const entrada = autores.get(key) || { si: 0, no: 0 };
    if (lead.qualified) entrada.si += 1;
    else entrada.no += 1;
    autores.set(key, entrada);
  }

  const usuarios = new Map(
    (await db('users').select('id', 'name').whereIn('id', [...autores.keys()].filter(Boolean)))
      .map((u) => [u.id, u.name])
  );

  linea('3. QUIÉN CALIFICA — el criterio es el de quien pone la marca');
  linea('─'.repeat(74));
  if (!autores.size) {
    linea('   Nadie.');
  } else {
    for (const [id, { si: s, no: n }] of [...autores.entries()].sort((a, b) => (b[1].si + b[1].no) - (a[1].si + a[1].no))) {
      const nombre = id ? (usuarios.get(id) || `usuario #${id} (ya no está en el panel)`) : 'sin autor registrado';
      const total = s + n;
      linea(`   ${nombre.padEnd(38)} ${String(total).padStart(5)} leads   Sí ${pct(s, total)}`);
    }
    linea();
    if (autores.size === 1) {
      linea('   Una sola persona califica: el criterio es el de esa persona, y el');
      linea('   escrito (src/leadQualificationCriteria.js) no se está contrastando con');
      linea('   nadie. No es un error; es un punto único de criterio.');
    } else {
      linea('   Varias personas califican. El criterio escrito es lo único que las');
      linea('   mantiene diciendo lo mismo: si dos tienen tasas de "Sí" muy distintas');
      linea('   sobre leads parecidos, la marca mide al calificador y no al lead.');
    }
  }
  linea();

  // ──────────────────────── 4. Muestra para revisar ───────────────────────
  linea(`4. MUESTRA PARA REVISAR A MANO (${MUESTRA} leads calificados al azar)`);
  linea('─'.repeat(74));
  linea('   Esto es lo único que valida el dato. Para cada uno: ¿la marca coincide');
  linea('   con lo que dicen sus datos, según el criterio escrito?');
  linea();

  const calificados = [...si, ...no];
  // Mezcla de Fisher-Yates sobre una copia: la muestra tiene que poder caer en
  // cualquier parte del período, no en las últimas fichas cargadas.
  for (let i = calificados.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [calificados[i], calificados[j]] = [calificados[j], calificados[i]];
  }

  for (const lead of calificados.slice(0, MUESTRA)) {
    const origin = leadOrigin(lead);
    const marca = lead.qualified ? 'Sí ' : 'No ';
    linea(`   #${String(lead.id).padEnd(6)} ${marca}  ${(lead.full_name || 'sin nombre').slice(0, 30)}`);
    linea(`           origen: ${origin.platform} / ${origin.channel}`
      + `${origin.campaignName ? ` · ${origin.campaignName.slice(0, 34)}` : ''}`);
    linea(`           ${lead.academic_level || 'sin nivel'} · ${lead.field_of_study || 'sin carrera'}`
      + ` · ${lead.university || 'sin universidad'}`);
    linea(`           tesis: ${lead.thesis_situation || 'sin dato'}`
      + ` · viabilidad: ${lead.overall_viability_score ?? 'sin informe'}`
      + ` · etapa: ${lead.status}`);
    linea();
  }

  if (!calificados.length) linea('   (no hay leads calificados que mostrar)');

  linea('═'.repeat(74));
  linea('  El criterio escrito está en src/leadQualificationCriteria.js, que es el');
  linea('  que ven las dos pantallas al calificar. Si la muestra no lo sigue, el');
  linea('  arreglo es ahí y hablando con quien califica — no en este script.');
  linea('═'.repeat(74));
}

main()
  .catch((error) => {
    console.error('❌ Error en la auditoría:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
