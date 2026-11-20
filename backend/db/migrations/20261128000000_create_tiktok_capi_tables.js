/**
 * Conversiones hacia TikTok (Events API): devolverle a TikTok en qué etapa del
 * funnel terminó cada lead que nos mandó.
 *
 * Es la hermana de `meta_capi_*` y existe por el mismo agujero visto desde el
 * otro lado. TikTok nos manda los leads de formulario instantáneo —desde el
 * 30/10/2026, y a mano, porque **no hay webhook**— y nunca se entera de lo que
 * pasó después. Sin esa vuelta su optimización solo puede perseguir "más
 * formularios llenados", que es justo la métrica que se llena de leads que no
 * contestan: la campaña aprende a traer gente que completa un formulario, no
 * gente que compra.
 *
 * Dos tablas, calcadas de las de Meta a propósito (las dos integraciones
 * contestan las mismas preguntas y el día que alguien arregle una tiene que
 * poder leer la otra sin reaprender nada):
 *
 * 1. `tiktok_capi_stage_events` — qué etapa se reporta y con qué nombre de
 *    evento. Es una tabla y no una constante porque las columnas del funnel las
 *    crea el equipo y sus claves se generan solas (`col_mtc2nwec_fij`): una
 *    lista en el código no podría nombrar la columna "Cotizado" de este equipo,
 *    y renombrarla desde el Kanban no puede romper el reporte.
 *
 * 2. `tiktok_capi_events` — la bitácora de lo enviado, con la respuesta. Cumple
 *    tres funciones: deja ver por qué un evento no llegó, evita mandar dos
 *    veces el mismo evento del mismo lead (reabrir y volver a ganar una venta
 *    no es una segunda venta) y es lo que permite reenviar lo que falló.
 *
 * Dos cosas propias de TikTok que no se heredan de Meta:
 *
 *  - **El identificador es el `lead_id` de TikTok** (`leads.tiktok_lead_id`) y
 *    nada más. No hay equivalente del `ctwa_clid`: TikTok no manda un referral
 *    al chat, así que un lead que no vino de un formulario instantáneo no se
 *    puede reportar — y eso se omite, no se fuerza con un identificador
 *    aproximado.
 *  - **Que TikTok acepte un evento no significa que la campaña optimice por
 *    él.** La aceptación es del Events API; la optimización depende del
 *    `optimization_goal` del grupo de anuncios y de que el evento esté
 *    configurado en el origen. Por eso la bitácora guarda la respuesta cruda y
 *    el servicio tiene una comprobación de elegibilidad aparte: dar por buena
 *    la optimización porque el POST devolvió 200 es el fallo silencioso de esta
 *    integración, el mismo que en Meta era mandar al conjunto de datos
 *    equivocado.
 *
 * Las credenciales NO van acá: `TIKTOK_EVENTS_SOURCE_ID` y
 * `TIKTOK_EVENTS_ACCESS_TOKEN` son del `.env`. Lo que vive en la base es lo que
 * cambia porque el equipo cambió de idea.
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

/*
 * Las dos tablas se crean solo si faltan, y la siembra usa `onConflict`:
 * en MySQL el DDL no es transaccional, así que una migración que muere a la
 * mitad deja sus tablas creadas y a sí misma sin registrar, y el reintento
 * choca sin forma de avanzar ni de volver atrás (pasó el 01/11/2026 con la
 * migración de atribución).
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('tiktok_capi_stage_events'))) {
    await knex.schema.createTable('tiktok_capi_stage_events', (table) => {
      table.increments('id').primary();
      // La clave del status y no un id de columna: `leads.status` es texto y los
      // desenlaces fijos (`ganado`, `perdido`) no son columna de nadie.
      table.string('status_key', 60).notNullable().unique();
      table.string('event_name', 60).notNullable();
      table.boolean('enabled').notNullable().defaultTo(true);
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('tiktok_capi_events'))) {
    await knex.schema.createTable('tiktok_capi_events', (table) => {
      table.increments('id').primary();
      // SET NULL y no CASCADE: el envío ya ocurrió, y borrar un lead duplicado no
      // puede borrar la prueba de lo que TikTok recibió.
      table.integer('lead_id').unsigned().nullable()
        .references('id').inTable('leads').onDelete('SET NULL');
      table.integer('stage_change_id').unsigned().nullable()
        .references('id').inTable('lead_stage_changes').onDelete('SET NULL');
      table.string('status_key', 60).nullable();
      table.string('event_name', 60).notNullable();
      /*
       * El momento REAL del hecho, no el del envío. Para el alta es
       * `tiktok_created_time` (cuándo se llenó el formulario en TikTok) y no
       * `created_at` (cuándo entró acá): un lead recuperado por la importación
       * tres días después tiene las dos fechas muy separadas, y una plataforma
       * descarta el evento anterior a la generación del lead.
       */
      table.timestamp('event_time').nullable();
      /*
       * El `lead_id` que emitió TikTok, preservado tal cual. Es con lo único que
       * TikTok puede reconocer a este lead como suyo, y por eso se guarda en la
       * bitácora además de en la ficha: si la ficha se borra o se fusiona, el
       * envío tiene que poder explicarse igual.
       */
      table.string('tiktok_lead_id', 64).nullable();
      table.string('state', 20).notNullable().defaultTo('enviado'); // enviado | error | omitido
      table.string('reason', 255).nullable();
      table.integer('http_status').nullable();
      /*
       * El código propio de TikTok, que viaja DENTRO de un HTTP 200: la API
       * responde 200 con el fallo en `code`, así que mirar solo el estado HTTP da
       * por enviado lo que se rechazó (es la misma trampa que el resto de la
       * Business API, ver `tiktokAdsService.js`).
       */
      table.integer('tiktok_code').nullable();
      table.text('response').nullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());

      // "¿este lead ya reportó este evento?" es la consulta del camino caliente.
      table.index(['lead_id', 'event_name']);
      table.index('created_at');
    });
  }

  /*
   * Siembra de las etapas clave, resueltas como las resuelve el resto del
   * sistema y no con claves escritas a mano: el desenlace fijo, la columna que
   * el equipo marcó como `final` y la de cotización.
   *
   * Los nombres de evento son los **estándar de TikTok** y no libres: a
   * diferencia de la mitad de formularios de Meta, acá el conjunto válido lo
   * fija la plataforma, y ofrecer un campo de texto solo daría la oportunidad
   * de escribir algo que el Events API va a rechazar.
   */
  const columnas = await knex('funnel_columns').select('key', 'label', 'final');

  const final = columnas.find((c) => c.final);
  const cotizacion = columnas.find((c) => pareceCotizacion(c.label));

  const filas = [
    // La cita agendada es el primer hecho que distingue a un lead que vale: es
    // la señal más temprana que TikTok puede usar para optimizar.
    { status_key: 'cita_agendada', event_name: 'Contact' },
    { status_key: 'ganado', event_name: 'CompletePayment' }
  ];
  if (cotizacion) filas.push({ status_key: cotizacion.key, event_name: 'SubmitForm' });
  if (final && final.key !== 'ganado') filas.push({ status_key: final.key, event_name: 'CompletePayment' });

  // `onConflict` por si alguna clave se repite entre el desenlace fijo y una
  // columna que el equipo nombró igual.
  for (const fila of filas) {
    await knex('tiktok_capi_stage_events')
      .insert({ ...fila, enabled: true })
      .onConflict('status_key')
      .ignore();
  }

  console.log(`✅ [Migración] Etapas sembradas para el postback a TikTok: ${filas.map((f) => f.status_key).join(', ')}.`);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('tiktok_capi_events');
  await knex.schema.dropTableIfExists('tiktok_capi_stage_events');
}
