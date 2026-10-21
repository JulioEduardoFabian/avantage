/**
 * Conversiones hacia Meta (Conversions API): devolverle a Meta en qué etapa del
 * funnel terminó cada lead que nos mandó.
 *
 * Meta ya nos manda los leads (formularios instantáneos y anuncios
 * Click-to-WhatsApp), pero nunca se enteraba de lo que pasaba después. Sin esa
 * vuelta, su optimización solo puede perseguir "más formularios llenados", que
 * es justo la métrica que se llena de números equivocados y curiosos: el 39% de
 * leads perdidos de septiembre no era lo único roto del circuito.
 *
 * Dos tablas, ninguna de ellas una copia de nada:
 *
 * 1. `meta_capi_stage_events` — qué etapa se reporta y con qué nombre de
 *    evento. Es una tabla y no una constante porque las columnas del funnel las
 *    crea el equipo y sus claves se generan solas (`col_mtc2nwec_fij`): una
 *    lista en el código no podría nombrar la columna "Cotizado" de este equipo,
 *    y renombrarla desde el Kanban no puede romper el reporte. Se siembra con
 *    las cuatro etapas clave resueltas como las resuelve el resto del sistema
 *    (el desenlace fijo, la columna marcada `final`, la de cotización), no con
 *    claves escritas a mano.
 *
 * 2. `meta_capi_events` — la bitácora de lo que se envió, con su respuesta.
 *    Cumple tres funciones y por eso existe: deja ver por qué un evento no
 *    llegó (la pantalla muestra el error de Meta tal cual), evita mandar dos
 *    veces el mismo evento del mismo lead (reabrir y volver a ganar una venta
 *    no es una segunda venta) y es lo que hace posible reenviar lo que falló
 *    dentro de la ventana de 7 días que Meta acepta hacia atrás.
 *
 * Las credenciales NO van acá: `META_CAPI_DATASET_ID` y
 * `META_CAPI_ACCESS_TOKEN` son del `.env`, como el resto de lo de Meta. Lo que
 * vive en la base es lo que cambia porque el equipo cambió de idea.
 */

/** Mismo criterio que `isQuotedLabel()` en funnelColumnService.js. */
function pareceCotizacion(label) {
  const clean = String(label || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  if (!clean || /\bsin\s+cotiza/.test(clean)) return false;
  return /cotiza/.test(clean);
}

export async function up(knex) {
  await knex.schema.createTable('meta_capi_stage_events', (table) => {
    table.increments('id').primary();
    // La clave del status, no un id de columna: `leads.status` es texto y los
    // desenlaces fijos (`ganado`, `perdido`) no son columna de nadie.
    table.string('status_key', 60).notNullable().unique();
    table.string('event_name', 60).notNullable();
    table.boolean('enabled').notNullable().defaultTo(true);
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('meta_capi_events', (table) => {
    table.increments('id').primary();
    // SET NULL y no CASCADE: el envío ya ocurrió, y borrar un lead duplicado no
    // puede borrar la prueba de lo que Meta recibió.
    table.integer('lead_id').unsigned().nullable()
      .references('id').inTable('leads').onDelete('SET NULL');
    table.integer('stage_change_id').unsigned().nullable()
      .references('id').inTable('lead_stage_changes').onDelete('SET NULL');
    table.string('status_key', 60).nullable();
    table.string('event_name', 60).notNullable();
    table.timestamp('event_time').nullable();
    // Con qué lo identificó Meta: `lead_id` (formulario instantáneo) o
    // `ctwa_clid` (anuncio Click-to-WhatsApp). Son los dos únicos caminos por
    // los que Meta puede reconocer a este lead como suyo.
    table.string('identifier_kind', 20).nullable();
    table.string('identifier', 255).nullable();
    table.string('state', 20).notNullable().defaultTo('enviado'); // enviado | error | omitido
    table.string('reason', 255).nullable();
    table.integer('http_status').nullable();
    table.text('response').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // "¿este lead ya reportó este evento?" es la consulta del camino caliente.
    table.index(['lead_id', 'event_name']);
    table.index('created_at');
  });

  /*
   * Siembra de las etapas clave. Se resuelven preguntando a las mismas tablas
   * que usa el resto del sistema en vez de escribir claves a mano: la columna
   * ganadora es la marcada `final` (puede llamarse "Cerrado" o "Matriculado") y
   * la de cotización es la marcada `quoted` o, si nadie la marcó, la que se
   * llama así — es lo mismo que hace `getQuotedColumn()`.
   */
  const etapas = [
    { status_key: 'cita_agendada', event_name: 'Cita agendada', enabled: true },
    { status_key: 'ganado', event_name: 'Venta ganada', enabled: true },
    { status_key: 'perdido', event_name: 'Lead perdido', enabled: true },
    // El descarte del setter casi siempre es un número equivocado o un
    // curioso, no una etapa del funnel: queda cargado para poder encenderlo,
    // pero apagado.
    { status_key: 'descartado', event_name: 'Lead descartado', enabled: false }
  ];

  if (await knex.schema.hasTable('funnel_columns')) {
    const columnas = await knex('funnel_columns').select('key', 'label', 'final', 'quoted');

    for (const columna of columnas.filter((c) => c.final)) {
      etapas.push({ status_key: columna.key, event_name: 'Venta ganada', enabled: true });
    }

    const cotizada = columnas.find((c) => c.quoted) || columnas.find((c) => pareceCotizacion(c.label));
    if (cotizada) etapas.push({ status_key: cotizada.key, event_name: 'Cotizado', enabled: true });
  }

  const vistas = new Set();
  const filas = etapas.filter((etapa) => {
    if (vistas.has(etapa.status_key)) return false;
    vistas.add(etapa.status_key);
    return true;
  });
  await knex('meta_capi_stage_events').insert(filas);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('meta_capi_events');
  await knex.schema.dropTableIfExists('meta_capi_stage_events');
}
