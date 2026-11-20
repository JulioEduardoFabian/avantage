/**
 * `signed_contracts` — el contrato YA FIRMADO por el cliente.
 *
 * Es una tabla propia y no unas columnas en `contracts` por dos razones que se
 * ven apenas se abre la ficha de un lead:
 *
 *  1. **Hay contratos firmados que el sistema nunca emitió.** Se arman en Word
 *     por fuera, se firman y vuelven escaneados. Colgando el documento de una
 *     fila de `contracts`, justo esos —que son los que más falta hace guardar,
 *     porque no están en ningún otro lado— no se podrían subir.
 *  2. **Un lead puede tener más de uno**: el contrato y después su adenda, o la
 *     versión corregida que se volvió a firmar. En columnas, el segundo pisa al
 *     primero.
 *
 * `contract_id` ata el documento al contrato emitido CUANDO lo hay, que es el
 * caso normal: así el contrato del sistema y el papel firmado son la misma
 * cosa y no dos registros que nadie cruza. Es opcional y va en SET NULL por lo
 * de arriba.
 *
 * Cada fila es un archivo guardado en disco **o** un enlace (Drive). Las dos
 * formas conviven porque el equipo usa las dos: el escaneo que llega por
 * WhatsApp se sube, y el que ya vive en la carpeta de Drive del cliente se
 * enlaza — copiarlo sería tener dos originales y no saber cuál manda. La regla
 * de "uno u otro, nunca ninguno" se aplica en el servicio (`validateSource`),
 * no acá: en MySQL un CHECK de ese tipo no se puede expresar sin disparadores.
 */
export async function up(knex) {
  await knex.schema.createTable('signed_contracts', (table) => {
    table.increments('id').primary();

    // El documento es del LEAD: es desde su ficha que se sube y es ahí donde se
    // busca después. CASCADE porque sin lead no significa nada — y por eso
    // `deletionBlockReason()` impide borrar una ficha que tenga uno.
    table.integer('lead_id').unsigned().notNullable()
      .references('id').inTable('leads').onDelete('CASCADE');

    // El contrato emitido al que corresponde, si lo hay.
    table.integer('contract_id').unsigned().nullable()
      .references('id').inTable('contracts').onDelete('SET NULL');

    // Cómo nombrarlo cuando hay varios ("Contrato firmado", "Adenda 1").
    table.string('title', 200).nullable();

    // Una de las dos formas: el archivo en `uploads/signed-contracts/`...
    table.string('file_filename', 255).nullable();
    table.string('file_original_name', 255).nullable();
    table.string('file_mime_type', 150).nullable();
    table.integer('file_size').unsigned().nullable();
    // ...o el enlace al documento que vive afuera (Drive).
    table.string('external_url', 1000).nullable();

    // El día en que se firmó, que no es el día en que alguien lo subió.
    table.date('signed_at').nullable();
    table.string('notes', 500).nullable();

    table.integer('uploaded_by').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    // El único acceso es "los documentos de este lead, del más nuevo al más
    // viejo": el índice compuesto cubre el filtro y el orden de una vez.
    table.index(['lead_id', 'created_at']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('signed_contracts');
}
