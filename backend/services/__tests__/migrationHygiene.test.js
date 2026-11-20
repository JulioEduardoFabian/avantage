import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dos reglas de las migraciones, comprobadas sobre los archivos.
 *
 * Las dos salen del mismo fallo en producción, el 01/11/2026. La migración
 * `20261125000000_create_attribution_evidence.js` hacía su backfill con
 * `.select('id', ...LEAD_ORIGIN_COLUMNS)`, importando esa constante de
 * `leadOrigin.js` para no repetir la lista. Después se le agregaron a esa
 * constante las columnas de Smart+, que las crea una migración **posterior**:
 * así que la de atribución empezó a pedirle a MySQL columnas que todavía no
 * existían y murió con "Unknown column".
 *
 * Y como en MySQL el DDL **no es transaccional**, al morir dejó sus cuatro
 * columnas ya agregadas y a sí misma sin registrar. El reintento chocó contra
 * "Duplicate column name 'origin_platform'" y quedó trabado sin forma de
 * avanzar ni de volver atrás: la única salida habría sido tocar la base a mano.
 *
 * Ninguno de los dos problemas se ve leyendo el diff, y los dos se detectan
 * leyendo el archivo. De ahí estas pruebas.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'backend', 'db', 'migrations');

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();
}

const read = (file) => fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

/** Las líneas de `import` de un archivo, sin comentarios de bloque. */
function importLines(source) {
  return source
    .split('\n')
    .filter((line) => /^\s*import\s/.test(line));
}

test('hay migraciones que revisar', () => {
  assert.ok(migrationFiles().length > 0, 'no se encontró ninguna migración');
});

// ───────── Una migración no importa listas de columnas de un servicio ───────

test('ninguna migración importa una lista de columnas de un servicio', () => {
  /*
   * La regla: una migración puede importar **funciones puras** —la lógica
   * conviene que sea una sola, porque una copia en la migración dice lo viejo el
   * día que alguien corrija la original— pero nunca una **lista de columnas**.
   *
   * Una lista de columnas es una foto del esquema EN ESE punto de la historia, y
   * por definición no puede venir de un archivo que sigue creciendo: el día que
   * alguien le agregue una columna nueva, todas las migraciones viejas que la
   * importaban empiezan a pedir columnas que en su momento no existían.
   */
  const culpables = [];

  for (const file of migrationFiles()) {
    for (const line of importLines(read(file))) {
      // Cualquier identificador importado que termine en `_COLUMNS`: el nombre
      // es la convención del repo para una lista de columnas.
      const match = line.match(/\b([A-Z][A-Z0-9_]*_COLUMNS)\b/);
      if (match) culpables.push(`${file} importa ${match[1]}`);
    }
  }

  assert.deepEqual(
    culpables,
    [],
    'Una migración no puede importar una lista de columnas: congelala en el propio archivo.\n'
      + culpables.join('\n')
  );
});

// ─────────── Lo que puede morir a la mitad tiene que poder reintentarse ─────

test('toda migración que agrega columnas pregunta antes si ya están', () => {
  /*
   * En MySQL el DDL no es transaccional: si una migración muere después de su
   * `alterTable`, las columnas quedan y la migración no se registra. Sin un
   * `hasColumn` delante, el reintento choca contra "Duplicate column name" y no
   * hay forma de avanzar ni de volver atrás sin tocar la base a mano.
   *
   * Solo se exige a las migraciones nuevas (desde la que lo descubrió): las
   * anteriores ya corrieron en producción y reescribirlas no arregla nada que
   * esté roto — cambiar una migración aplicada es, de hecho, la otra forma de
   * dejar la base y el código diciendo cosas distintas.
   */
  const DESDE = '20261125000000';
  const culpables = [];

  for (const file of migrationFiles()) {
    if (file < DESDE) continue;
    const source = read(file);

    // `alterTable` con un `table.string(...)`/`timestamp(...)` adentro es un
    // agregado de columnas; `createTable` no necesita guarda de columna.
    const agregaColumnas = /alterTable\(/.test(source)
      && /table\.(string|timestamp|integer|boolean|text|decimal)\(/.test(source);
    if (!agregaColumnas) continue;

    if (!/hasColumn\(/.test(source)) culpables.push(`${file} no usa hasColumn()`);
  }

  assert.deepEqual(culpables, [], 'Migraciones que no se pueden reintentar:\n' + culpables.join('\n'));
});

test('toda migración que crea tablas pregunta antes si ya están', () => {
  const DESDE = '20261125000000';
  const culpables = [];

  for (const file of migrationFiles()) {
    if (file < DESDE) continue;
    const source = read(file);
    if (!/schema\.createTable\(/.test(source)) continue;

    if (!/hasTable\(/.test(source)) culpables.push(`${file} no usa hasTable()`);
  }

  assert.deepEqual(culpables, [], 'Migraciones que no se pueden reintentar:\n' + culpables.join('\n'));
});

test('toda migración que crea índices pregunta antes si ya están', () => {
  /*
   * Knex no tiene `hasIndex`, así que la comprobación es una consulta a
   * `information_schema`. Un índice que ya está falla igual que una columna
   * repetida, y por el mismo motivo deja la migración trabada.
   *
   * Un `table.index()` DENTRO de un `createTable` no cuenta: ahí la tabla es
   * nueva y el índice no puede existir todavía.
   */
  const DESDE = '20261125000000';
  const culpables = [];

  for (const file of migrationFiles()) {
    if (file < DESDE) continue;
    const source = read(file);

    // Índices agregados sobre una tabla que ya existe.
    const enAlterTable = /alterTable\([^)]*\)[\s\S]{0,400}?table\.index\(/.test(source)
      || /=> table\.index\(/.test(source);
    if (!enAlterTable) continue;

    if (!/information_schema\.STATISTICS/i.test(source)) {
      culpables.push(`${file} agrega un índice sin comprobar si existe`);
    }
  }

  assert.deepEqual(culpables, [], 'Migraciones que no se pueden reintentar:\n' + culpables.join('\n'));
});

// ──────────────────────── Todas exportan up y down ──────────────────────────

test('toda migración exporta up y down', () => {
  /*
   * Una migración sin `down` no se puede revertir, y la que la sigue tampoco
   * (knex revierte por lote).
   *
   * Se admiten las dos formas: las migraciones viejas declaran `export function
   * up` y devuelven la promesa del `schema`, las nuevas son `async`. knex acepta
   * ambas, así que exigir una sola sería una regla de estilo disfrazada de
   * comprobación.
   */
  for (const file of migrationFiles()) {
    const source = read(file);
    assert.match(source, /export\s+(async\s+)?function\s+up\b/, `${file} no exporta up()`);
    assert.match(source, /export\s+(async\s+)?function\s+down\b/, `${file} no exporta down()`);
  }
});
