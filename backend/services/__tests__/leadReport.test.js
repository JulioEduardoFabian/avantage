import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  ORIGIN_OPTIONS,
  actorKey,
  actorLabel,
  applySearch,
  buildTimeline,
  matchesOrigin,
  nextDay,
  normalizeFilters,
  parseActor,
  parseOrigin
} from '../leadReportService.js';
import { db } from '../../db/connection.js';
import { leadOrigin } from '../leadOrigin.js';
import { buildStatusLabeler } from '../funnelStageLabel.js';

/**
 * Reporte de Leads: las reglas que se pueden probar sin base de datos — cómo se
 * entiende lo que manda la pantalla y cómo se arma la trayectoria de un lead.
 */

const labelStatus = buildStatusLabeler({
  salesColumns: [
    { key: 'cita_agendada', label: 'Agendado con el closer', icon: '📅' },
    { key: 'col_mtc2nwec_fij', label: 'Cotizado', icon: '📄' }
  ],
  setterColumns: [
    { key: 'conversacion_abierta', label: 'Conversación Abierta', icon: '💬' },
    { key: 'cita_agendada', label: 'Cita Agendada', icon: '📅' }
  ]
});

test('el actor del filtro solo se acepta en los tres formatos posibles', () => {
  assert.deepEqual(parseActor('user:7'), { type: 'user', id: 7 });
  assert.deepEqual(parseActor('bot'), { type: 'bot', id: null });
  assert.deepEqual(parseActor('system'), { type: 'system', id: null });
  // Cualquier otra cosa es "sin filtro", no un pedazo de texto que termina en
  // un where.
  assert.equal(parseActor("user:1 OR 1=1"), null);
  assert.equal(parseActor('cualquiera'), null);
  assert.equal(parseActor(''), null);
});

test('el código del desplegable y el que entiende el filtro son el mismo', () => {
  const actores = [
    { actorType: 'user', actorId: 7, actorName: 'Lucía' },
    { actorType: 'bot', actorId: null, actorName: null },
    { actorType: 'system', actorId: null, actorName: null }
  ];
  for (const actor of actores) {
    const key = actorKey(actor);
    assert.deepEqual(parseActor(key)?.type, actor.actorType, `${key} tiene que volver a leerse igual`);
  }
});

test('quien movió el lead siempre tiene nombre', () => {
  assert.equal(actorLabel({ actorType: 'user', actorName: 'Kevin' }), 'Kevin');
  assert.equal(actorLabel({ actorType: 'bot' }), 'Avan (bot)');
  assert.equal(actorLabel({ actorType: 'system' }), 'El sistema');
  // Un usuario dado de baja antes de que se guardara la copia del nombre: se
  // dice lo único que se sabe de él en vez de dejar el movimiento sin autor.
  assert.equal(actorLabel({ actorType: 'user', actorName: null }), 'Un usuario del panel');
});

test('un rango de fechas escrito al revés se usa como rango igual', () => {
  // Devolver cero filas se lee como "el reporte está roto".
  const filters = normalizeFilters({ from: '2026-10-18', to: '2026-10-01' });
  assert.equal(filters.from, '2026-10-01');
  assert.equal(filters.to, '2026-10-18');
});

test('una fecha que no es una fecha no filtra nada', () => {
  const filters = normalizeFilters({ from: 'ayer', to: '2026-13' });
  assert.equal(filters.from, null);
  assert.equal(filters.to, null);
});

test('la paginación tiene piso y techo', () => {
  assert.equal(normalizeFilters({}).page, 1);
  assert.equal(normalizeFilters({ page: '0' }).page, 1);
  assert.equal(normalizeFilters({ page: '-3' }).page, 1);
  assert.equal(normalizeFilters({}).pageSize, DEFAULT_PAGE_SIZE);
  assert.equal(normalizeFilters({ pageSize: '5000' }).pageSize, MAX_PAGE_SIZE);
});

test('el rango se cierra con el día siguiente, así el "hasta" entra completo', () => {
  // Comparar contra `to 00:00:00` dejaría afuera todo lo que pasó ese día.
  assert.equal(nextDay('2026-10-18'), '2026-10-19');
  assert.equal(nextDay('2026-10-31'), '2026-11-01');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
});

test('la trayectoria empieza por el alta y sigue en orden', () => {
  const lead = {
    id: 12,
    created_at: '2026-10-01T14:00:00Z',
    created_by: 4,
    created_by_name: 'Lucía',
    source: 'Manual'
  };
  const timeline = buildTimeline(lead, [
    { id: 1, fromStatus: 'nuevo', toStatus: 'conversacion_abierta', actorType: 'bot', actorName: null, blocked: false, reason: null, createdAt: '2026-10-02T10:00:00Z' },
    { id: 2, fromStatus: 'conversacion_abierta', toStatus: 'cita_agendada', actorType: 'user', actorName: 'Kevin', blocked: false, reason: null, createdAt: '2026-10-03T10:00:00Z' }
  ], labelStatus, 'setter');

  assert.equal(timeline.length, 3);
  assert.equal(timeline[0].kind, 'alta');
  assert.equal(timeline[0].derived, true);
  assert.equal(timeline[0].actorLabel, 'Lucía');
  assert.equal(timeline[1].from.label, 'Nuevo');
  assert.equal(timeline[1].to.label, 'Conversación Abierta');
  assert.equal(timeline[1].actorLabel, 'Avan (bot)');
  assert.equal(timeline[2].actorLabel, 'Kevin');
});

test('el lead sin movimientos igual tiene su alta: la bitácora es más nueva que él', () => {
  const timeline = buildTimeline(
    { id: 3, created_at: '2026-09-01T10:00:00Z', created_by: null, created_by_name: null, source: 'WhatsApp Directo' },
    [],
    labelStatus
  );
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].kind, 'alta');
  // Lo que entró solo no tiene autor y no se le inventa uno: lo que se sabe es
  // por dónde entró.
  assert.equal(timeline[0].actorLabel, null);
  assert.equal(timeline[0].source, 'WhatsApp Directo');
});

test('la etapa de cada movimiento se nombra con la etiqueta del tablero del lead', () => {
  // `cita_agendada` existe en los dos tableros con nombres distintos, y la del
  // tablero equivocado diría que el lead está donde no está.
  const changes = [{ id: 9, fromStatus: 'conversacion_abierta', toStatus: 'cita_agendada', actorType: 'user', actorName: 'Kevin', blocked: false, reason: null, createdAt: '2026-10-05T10:00:00Z' }];
  const lead = { id: 5, created_at: '2026-10-01T10:00:00Z' };

  assert.equal(buildTimeline(lead, changes, labelStatus, 'setter')[1].to.label, 'Cita Agendada');
  assert.equal(buildTimeline(lead, changes, labelStatus, 'ventas')[1].to.label, 'Agendado con el closer');
});

test('el intento rechazado viaja marcado y con su motivo', () => {
  // Un tope que funciona y un tope que nunca se activó se ven idénticos si el
  // reporte no muestra lo bloqueado.
  const timeline = buildTimeline(
    { id: 8, created_at: '2026-10-01T10:00:00Z' },
    [{ id: 4, fromStatus: 'ganado', toStatus: 'conversacion_abierta', actorType: 'bot', actorName: null, blocked: true, reason: 'el lead ya es del closer', createdAt: '2026-10-06T10:00:00Z' }],
    labelStatus,
    'ventas'
  );
  assert.equal(timeline[1].blocked, true);
  assert.equal(timeline[1].reason, 'el lead ya es del closer');
});

test('el origen del filtro solo se acepta en los códigos del desplegable', () => {
  assert.deepEqual(parseOrigin('platform:meta'), { kind: 'platform', key: 'meta', label: 'Meta' });
  assert.deepEqual(parseOrigin('channel:whatsapp'), { kind: 'channel', key: 'whatsapp', label: 'WhatsApp' });
  // Lo que no es uno de los códigos no filtra: ni una clave inventada, ni el
  // tipo cambiado, ni texto suelto que terminaría en una comparación.
  assert.equal(parseOrigin('platform:google'), null);
  assert.equal(parseOrigin('canal:whatsapp'), null);
  assert.equal(parseOrigin('meta'), null);
  assert.equal(parseOrigin(''), null);
});

test('cada opción del desplegable la entiende el filtro', () => {
  // Las dos puntas del mismo contrato: una opción que el parser rechaza es un
  // filtro que no devuelve nada y parece la pantalla rota.
  for (const option of ORIGIN_OPTIONS) {
    assert.ok(parseOrigin(option.key), `sin parsear: ${option.key}`);
    assert.equal(parseOrigin(option.key).label, option.label);
  }
  assert.deepEqual([...new Set(ORIGIN_OPTIONS.map((o) => o.group))], ['Plataforma', 'Canal']);
});

test('el filtro de origen compara contra lo que dice leadOrigin, no contra el texto de source', () => {
  // Un lead de formulario de Meta: la plataforma sale de sus columnas de
  // atribución y no de `source`, que acá dice otra cosa.
  const formMeta = leadOrigin({
    source: 'WhatsApp',
    meta_leadgen_id: '123',
    meta_ad_id: '456',
    origin_platform: 'Meta'
  });
  assert.equal(formMeta.platform, 'Meta');
  assert.ok(matchesOrigin(formMeta, parseOrigin('platform:meta')));
  assert.ok(matchesOrigin(formMeta, parseOrigin('channel:form')));
  assert.ok(!matchesOrigin(formMeta, parseOrigin('channel:whatsapp')));
  assert.ok(!matchesOrigin(formMeta, parseOrigin('platform:tiktok')));

  // Sin filtro pasa todo, y un lead sin origen resuelto no se cuela.
  assert.ok(matchesOrigin(formMeta, null));
  assert.ok(!matchesOrigin(null, parseOrigin('platform:meta')));
});

test('el origen viaja normalizado en los filtros, como el actor', () => {
  const filtros = normalizeFilters({ origin: 'channel:whatsapp' });
  assert.deepEqual(filtros.origin, { kind: 'channel', key: 'whatsapp', label: 'WhatsApp' });
  assert.equal(normalizeFilters({ origin: 'channel:fax' }).origin, null);
  assert.equal(normalizeFilters({}).origin, null);
});

/*
 * El buscador del reporte, leído como SQL. Knex arma la consulta sin tocar la
 * base, así que esto se puede probar igual que el resto: lo que se comprueba es
 * contra QUÉ se compara el número, que es de donde vino el fallo.
 */

/** El SQL que arma el buscador para esa consulta. */
const sqlDe = (texto) => applySearch(db('leads').select('leads.id'), texto).toString();

test('un número se busca contra los dígitos del teléfono, no contra el texto', () => {
  const sql = sqlDe('982768859');

  // La comparación va sobre la columna limpia (los REPLACE de PHONE_DIGITS_SQL),
  // que es lo que encuentra al lead de Meta guardado como "+51 982 768 859".
  assert.match(sql, /REPLACE\(/);
  assert.match(sql, /%982768859%/);

  // Y NO contra la columna cruda: ese era el LIKE que no encontraba nada en
  // cuanto el teléfono traía espacios.
  assert.doesNotMatch(sql, /`phone`\s+like\s+'%982768859%'/i);
});

test('un número no se busca en el nombre, el tema ni la universidad', () => {
  const sql = sqlDe('982768859');

  // Misma regla que los dos tableros (`src/leadSearch.js`): en un número, un
  // dígito de diferencia es otra persona, y un tema de tesis que contenga esa
  // cifra no es la ficha que se está buscando.
  assert.doesNotMatch(sql, /full_name/);
  assert.doesNotMatch(sql, /topic/);
  assert.doesNotMatch(sql, /university/);

  // El id sí, que es como se nombra un lead entre pantallas ("el #412").
  assert.match(sql, /`leads`\.`id`\s*=\s*982768859/);
});

test('el número encuentra también el documento escrito con puntos', () => {
  // `DNI_MATCH_KEY_SQL` quita los separadores, así que "70123456" encuentra
  // al lead cargado como "70.123.456".
  assert.match(sqlDe('70123456'), /UPPER\(REPLACE\(/);
});

test('un texto se sigue buscando en todos los campos de siempre', () => {
  const sql = sqlDe('Cielo Padilla');
  for (const campo of ['full_name', 'phone', 'email', 'dni', 'university', 'topic', 'assigned_to']) {
    assert.match(sql, new RegExp(campo), `falta ${campo} en la búsqueda por texto`);
  }
});

test('una búsqueda vacía no agrega ninguna condición', () => {
  const base = db('leads').select('leads.id').toString();
  assert.equal(sqlDe('   '), base);
});
