import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlaceholderTopic,
  leadProfilePayload,
  mainInquiryFrom,
  memoryCompleteness,
  memorySnapshot,
  rehydrateAnswers,
  thesisSituationFrom
} from '../botMemory.js';

/**
 * Los cinco datos de la memoria estructurada —carrera, universidad, nivel,
 * etapa y consulta principal— y los dos caminos entre la sesión del bot y la
 * ficha del lead.
 */

test('los cinco datos de la conversación llegan a la ficha del lead', () => {
  const payload = leadProfilePayload({
    field: 'Ingeniería de Sistemas y Computación',
    university: 'Universidad Nacional del Centro del Perú',
    level: 'Posgrado (Maestría)',
    stage: 'capitulos',
    problem: 'Aplicación móvil para el control de inventarios en MYPEs de Huancayo'
  }, { topic: 'Consulta por WhatsApp de 51987654321' });

  assert.equal(payload.fieldOfStudy, 'Ingeniería de Sistemas y Computación');
  assert.equal(payload.university, 'Universidad Nacional del Centro del Perú');
  assert.equal(payload.academicLevel, 'Posgrado (Maestría)');
  assert.equal(payload.thesisSituation, 'Borrador de Tesis (Capítulos 1-3)');
  assert.equal(payload.topic, 'Aplicación móvil para el control de inventarios en MYPEs de Huancayo');
});

test('el nivel, la etapa y la consulta son los tres que antes no se guardaban', () => {
  // Es la regresión concreta: `_syncLeadProfile` escribía carrera y
  // universidad, y estos tres se quedaban en el JSON de la sesión.
  const payload = leadProfilePayload({ level: 'Pregrado (Bachiller/Título)', stage: 'proyecto', problem: 'Gestión de residuos sólidos' }, null);
  assert.ok('academicLevel' in payload);
  assert.ok('thesisSituation' in payload);
  assert.ok('topic' in payload);
});

test('la consulta principal NO pisa un tema escrito a mano', () => {
  const answers = { problem: 'Lo que el contacto contó por WhatsApp' };

  const conMarcador = leadProfilePayload(answers, { topic: 'Consulta por WhatsApp de Ana' });
  assert.equal(conMarcador.topic, 'Lo que el contacto contó por WhatsApp');

  const corregido = leadProfilePayload(answers, { topic: 'Modelo predictivo de deserción universitaria' });
  assert.equal(corregido.topic, undefined, 'un tema que alguien escribió es un dato del equipo');
});

test('se reconocen los marcadores que pone el alta automática', () => {
  assert.ok(isPlaceholderTopic(''));
  assert.ok(isPlaceholderTopic(null));
  assert.ok(isPlaceholderTopic('Consulta por WhatsApp de 51987654321'));
  assert.ok(isPlaceholderTopic('Asesoría de Tesis'));
  assert.ok(isPlaceholderTopic('Asesoría para Prospecto'));
  assert.ok(isPlaceholderTopic('Tema de tesis por definir'));
  assert.ok(!isPlaceholderTopic('Asesoría estadística para una tesis de enfermería'),
    'nombra un caso concreto: no es el marcador');
  assert.ok(!isPlaceholderTopic('Impacto del teletrabajo en la productividad'));
});

test('la etapa sale del avance y, si no lo hay, del servicio que pide', () => {
  assert.equal(thesisSituationFrom({ stage: 'sin_tema' }), 'Tesis sin avance');
  assert.equal(thesisSituationFrom({ stage: 'final' }), 'Tesis Completa / En Revisión');
  assert.equal(thesisSituationFrom({ need: 'correcciones' }), 'Levantamiento de Observaciones');
  // Lo ya normalizado gana sobre la etapa cruda.
  assert.equal(
    thesisSituationFrom({ stage: 'proyecto', thesisSituation: 'Artículo Científico' }),
    'Artículo Científico'
  );
  assert.equal(thesisSituationFrom({}), null);
  assert.equal(thesisSituationFrom({ stage: 'cualquier_cosa' }), null,
    'lo que no calza con el catálogo no se guarda: un valor huérfano no se puede editar después');
});

test('una consulta que no dice nada no se guarda como tema', () => {
  assert.equal(mainInquiryFrom({ problem: 'sí' }), null);
  assert.equal(mainInquiryFrom({ problem: '  ok ' }), null);
  assert.equal(mainInquiryFrom({}), null);
  assert.equal(mainInquiryFrom({ problem: '  Riesgo   crediticio  en cajas municipales ' }),
    'Riesgo crediticio en cajas municipales');
  assert.equal(mainInquiryFrom({ problem: 'x'.repeat(600) }).length, 500, 'se recorta a lo que entra en leads.topic');
});

test('la sesión nueva hereda de la ficha lo que el contacto ya dijo', () => {
  const seed = rehydrateAnswers({
    field_of_study: 'Derecho y Ciencias Políticas',
    university: 'Universidad Nacional Mayor de San Marcos',
    academic_level: 'Pregrado (Bachiller/Título)',
    thesis_situation: 'Proyecto / Plan de Tesis',
    academic_status: 'Egresado',
    academic_cycle: 10,
    topic: 'Tutela de derechos en procesos de alimentos',
    email: 'ana@gmail.com'
  });

  assert.equal(seed.field, 'Derecho y Ciencias Políticas');
  assert.equal(seed.university, 'Universidad Nacional Mayor de San Marcos');
  assert.equal(seed.level, 'Pregrado (Bachiller/Título)');
  assert.equal(seed.thesisSituation, 'Proyecto / Plan de Tesis');
  assert.equal(seed.academicStatus, 'Egresado');
  assert.equal(seed.cycle, 10);
  assert.equal(seed.problem, 'Tutela de derechos en procesos de alimentos');
  assert.equal(seed.email, 'ana@gmail.com');
});

test('los valores por defecto del alta NO se heredan', () => {
  // Si se heredaran, el bot no le preguntaría la carrera a nadie.
  const seed = rehydrateAnswers({
    field_of_study: 'General',
    academic_level: '',
    topic: 'Consulta por WhatsApp de 51999888777',
    email: 'sin-correo@avantage.local'
  });

  assert.equal(seed.field, undefined);
  assert.equal(seed.level, undefined);
  assert.equal(seed.problem, undefined);
  assert.equal(seed.email, undefined, 'el correo marcador agendaría la reunión contra una dirección que no existe');
  assert.deepEqual(seed, {});
});

test('sin ficha la sesión arranca en blanco y no lanza', () => {
  assert.deepEqual(rehydrateAnswers(null), {});
  assert.deepEqual(rehydrateAnswers(undefined), {});
});

test('la ida y la vuelta de la memoria dicen lo mismo', () => {
  // La propiedad que justifica que las dos direcciones vivan en un módulo: lo
  // que se escribe en la ficha es lo que la sesión siguiente vuelve a leer.
  const original = {
    field: 'Ciencias de la Salud y Medicina',
    university: 'Universidad Peruana Cayetano Heredia',
    level: 'Posgrado (Doctorado)',
    stage: 'final',
    problem: 'Adherencia al tratamiento en pacientes con diabetes tipo 2'
  };

  const payload = leadProfilePayload(original, { topic: '' });
  const lead = {
    field_of_study: payload.fieldOfStudy,
    university: payload.university,
    academic_level: payload.academicLevel,
    thesis_situation: payload.thesisSituation,
    topic: payload.topic
  };

  assert.deepEqual(memorySnapshot(rehydrateAnswers(lead)), memorySnapshot(original));
});

test('la memoria se puede contar: cinco datos, los que estén', () => {
  assert.deepEqual(memoryCompleteness({}), { known: 0, total: 5 });
  assert.deepEqual(memoryCompleteness({ field: 'X', university: 'Y' }), { known: 2, total: 5 });
  assert.deepEqual(
    memoryCompleteness({ field: 'X', university: 'Y', level: 'Z', stage: 'final', problem: 'Un tema real' }),
    { known: 5, total: 5 }
  );
});

test('la memoria no arrastra los marcadores internos de la conversación', () => {
  // Un horario propuesto o los intentos gastados son del hilo que terminó:
  // sembrarlos dejaría la sesión nueva creyéndose a mitad de un agendamiento.
  const seed = rehydrateAnswers({ field_of_study: 'Educación y Psicología', topic: 'Clima escolar' });
  assert.ok(!Object.keys(seed).some((key) => key.startsWith('__')));
});
