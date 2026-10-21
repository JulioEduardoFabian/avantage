/**
 * Crea `setter_funnel_columns`: las etapas del Setter Funnel, que hasta ahora
 * vivían SOLO en el `localStorage` del navegador.
 *
 * Por eso el tablero era distinto en cada máquina aunque entrara la misma
 * persona: el 16/10/2026 el mismo usuario veía 7 etapas en una computadora y 4
 * en otra, con los mismos 17 leads repartidos distinto. Y no era solo visual —
 * arrastrar un lead escribe `leads.status` con la clave de la columna, que sí
 * es compartida: un lead movido a una etapa que solo existe en una máquina
 * aparece en la primera columna de todas las demás.
 *
 * **Tabla propia y no una fila más en `funnel_columns` con un campo "tablero".**
 * `loadSalesFunnelStatuses()` trata TODA clave de `funnel_columns` como "este
 * lead ya es del closer", y `loadWinningStatuses()` toma las marcadas `final`
 * como venta ganada. Compartir la tabla haría que cada etapa que el setter
 * cree gradúe leads al Funnel de Ventas (sacándolos de su propio tablero y
 * dejando al bot sin trabajarlos), y que su etapa "Ganado / Cerrado" —que
 * viene marcada `final` de fábrica— abriera proyectos y devengara comisiones.
 * El precio de separarlas es un servicio más; el de unirlas es revisar cada
 * lectura de `funnel_columns` que ya existe y todas las que vengan.
 *
 * Las etapas de fábrica se siembran acá copiadas tal cual (y no importadas de
 * un módulo): una migración es una foto de un momento, y si el día de mañana
 * cambian los valores por defecto, lo que ya corrió no puede cambiar con ellos.
 */

const DEFAULT_SETTER_COLUMNS = [
  { key: 'conversacion_abierta', label: 'Conversación Abierta', icon: '💬', color: '#2C8C99', final: false },
  { key: 'calificando', label: 'En Calificación', icon: '🎯', color: '#6F8125', final: false },
  { key: 'congelado', label: 'Congelado', icon: '🧊', color: '#8D9199', final: false },
  { key: 'cita_agendada', label: 'Cita Agendada', icon: '📅', color: '#C9922E', final: false },
  { key: 'transferido_closer', label: 'Transferido a Closer', icon: '🤝', color: '#56624A', final: false },
  { key: 'ganado', label: 'Ganado / Cerrado', icon: '🏆', color: '#2F7D5A', final: true },
  { key: 'descartado', label: 'No Califica / Sin Resp.', icon: '🚫', color: '#B23A45', final: false }
];

/** Desenlaces y bandeja: nunca son una etapa propia del setter. */
const AJENOS = ['cita_agendada', 'en_negociacion', 'ganado', 'perdido', 'nuevo', 'inbox', 'abierto', 'contactado'];

/** `setter_col_m2x_ab1` no se puede convertir en un nombre: solo el equipo sabe cómo se llamaba. */
function esClaveGenerada(key) {
  return /^(?:setter_)?col_/.test(key);
}

function humanizar(key) {
  const texto = String(key).replace(/[_-]+/g, ' ').trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export async function up(knex) {
  await knex.schema.createTable('setter_funnel_columns', (table) => {
    table.increments('id').primary();
    table.string('key', 60).notNullable().unique();
    table.string('label', 150).notNullable();
    table.string('icon', 20).nullable();
    table.string('color', 20).nullable();
    table.boolean('final').notNullable().defaultTo(false);
    table.integer('position').unsigned().notNullable().defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex('setter_funnel_columns').insert(
    DEFAULT_SETTER_COLUMNS.map((column, position) => ({ ...column, position }))
  );

  /*
   * Rescate: una etapa que alguien creó en SU navegador no está en ningún
   * lado del servidor, pero los leads que dejó ahí sí guardaron su clave en
   * `leads.status`. Sin esta parte, al estrenar el tablero compartido todos
   * esos leads caerían de golpe en la primera columna ("si no coincide,
   * ubicar en la primera columna") y nadie sabría de dónde salieron.
   *
   * Se miran solo los leads que NO graduaron al Funnel de Ventas: los
   * comerciales no se dibujan en este tablero, así que sus etapas no son suyas.
   * El nombre no se puede recuperar —vivía en el navegador—, así que la columna
   * entra como "Etapa recuperada" para que el equipo la renombre una vez, y
   * esta vez para todos.
   */
  const enUso = await knex('leads').whereNull('sales_funnel_at').distinct('status').pluck('status');
  const clavesVentas = await knex('funnel_columns').pluck('key');
  const conocidas = new Set([
    ...DEFAULT_SETTER_COLUMNS.map((column) => column.key),
    ...clavesVentas,
    ...AJENOS
  ]);

  const huerfanas = enUso.filter((status) => status && !conocidas.has(status));
  if (huerfanas.length > 0) {
    await knex('setter_funnel_columns').insert(huerfanas.map((key, i) => ({
      key,
      label: esClaveGenerada(key) ? `Etapa recuperada ${i + 1}` : humanizar(key),
      icon: '📌',
      color: '#8D9199',
      final: false,
      position: DEFAULT_SETTER_COLUMNS.length + i
    })));
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('setter_funnel_columns');
}
