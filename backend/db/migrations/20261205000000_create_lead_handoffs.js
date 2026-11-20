/**
 * `lead_handoffs`: la derivación de una conversación del bot al equipo, con
 * dueño y con acuse de atención.
 *
 * `handOffToAdvisor()` ya movía el lead a "transferido_closer", le avisaba al
 * contacto y mandaba el aviso al equipo, pero nada de eso deja constancia de
 * lo único que se pregunta después: **a quién le toca y si alguien lo
 * atendió**. El aviso va a la campana y al correo, o sea a una bandeja
 * compartida donde se lee una vez; de las 17 transferencias del período medido
 * (08/09–05/10/2026), 0 terminaron en una reunión agendada, y no había forma
 * de distinguir "nadie la atendió" de "se atendió y no cerró".
 *
 * `_followUpStaleHandoffs()` escalaba a las 3 h deduciendo el estado del
 * último saliente de la conversación: es lo mejor que se podía hacer sin una
 * fila, pero así el dato existe solo mientras el barrido corre y no se puede
 * listar, contar ni repartir. Y el asesor que atiende por TELÉFONO no deja
 * ningún saliente, así que ese caso escalaba para siempre.
 *
 * **Tabla propia y no `tasks`.** Esa cuelga de `projects` en CASCADE —un lead
 * transferido todavía no tiene proyecto, y el día que lo tenga, borrarlo se
 * llevaría el rastro— y su vocabulario (`pendiente`/`completado`) no tiene
 * dónde guardar a quién le toca ni cuándo se hizo cargo. Mismas razones por
 * las que Entregables tiene tabla propia en vez de reusar `project_updates`.
 *
 * `lead_id` va en SET NULL y no en CASCADE: esto documenta algo que una
 * persona hizo (derivar, atender), así que sobrevive a que la ficha se borre
 * —igual que `finance_income` y `contracts`—. `wa_id` queda como la forma de
 * reconocer al contacto cuando ya no hay ficha.
 *
 * `intents` guarda las intenciones detectadas (`botIntent.js`) como texto JSON
 * y no como columnas: la lista crece, y de ella no cuelga ninguna consulta —se
 * lee para explicar por qué se derivó—. Lo que SÍ es columna es `priority`,
 * porque de ella depende el orden de la cola.
 *
 * Los índices van DENTRO del `createTable`, como en `lead_deletions`: en MySQL
 * el DDL no es transaccional, así que el único punto donde una migración puede
 * morir a la mitad es ENTRE dos sentencias — declarados acá no hay un "entre",
 * y el `hasTable` de arriba es toda la guarda que hace falta para reintentarla.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('lead_handoffs'))) {
    await knex.schema.createTable('lead_handoffs', (table) => {
      table.increments('id').primary();

      table.integer('lead_id').unsigned().nullable()
        .references('id').inTable('leads').onDelete('SET NULL');
      table.string('wa_id', 30).notNullable();

      // Por qué se derivó, en la frase que ya se le manda al equipo.
      table.string('reason', 500).nullable();
      // Las intenciones detectadas en el mensaje que la disparó.
      table.text('intents').nullable();
      table.string('urgency', 20).nullable();   // deadline | rush | soon
      table.string('priority', 10).notNullable().defaultTo('normal'); // alta | media | normal

      // A quién le toca. Las DOS columnas, por la misma razón que
      // `leads.assigned_user_id` / `assigned_to`: el enlace es la verdad y la
      // copia legible sobrevive a que la cuenta se borre.
      table.integer('assigned_user_id').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      table.string('assigned_to', 150).nullable();

      // Confirmación de atención. `_via` separa el acuse derivado de que una
      // persona le escribió del que alguien marcó a mano desde el panel: el
      // primero es una prueba, el segundo es una afirmación, y conviene poder
      // distinguirlos al medir el plazo de atención.
      table.timestamp('acknowledged_at').nullable();
      table.integer('acknowledged_by').unsigned().nullable()
        .references('id').inTable('users').onDelete('SET NULL');
      table.string('acknowledged_by_name', 150).nullable();
      table.string('acknowledged_via', 20).nullable(); // panel | respuesta | whatsapp_app

      // Cuándo se escaló hacia adentro por falta de atención, para que el
      // barrido de cada diez minutos no avise una vez por vuelta.
      table.timestamp('escalated_at').nullable();
      // Cuántas veces se volvió a pedir lo mismo mientras seguía abierta.
      table.integer('nudges').notNullable().defaultTo(0);

      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      // `wa_id` es la consulta de cada derivación (`openFor`), `created_at` la
      // de la cola y del barrido, y `acknowledged_at` la que separa lo
      // pendiente de lo atendido.
      table.index('wa_id');
      table.index('created_at');
      table.index('acknowledged_at');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('lead_handoffs');
}
