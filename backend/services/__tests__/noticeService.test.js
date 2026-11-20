import test from 'node:test';
import assert from 'node:assert/strict';
import { NoticeService, MANUAL_NOTICE_TYPE } from '../noticeService.js';

/**
 * Las reglas del aviso manual que se pueden comprobar sin base, y que son las
 * que deciden a qué teléfonos llega y con qué nombre.
 */

// ─────────────────────── A quién le llega, resuelto ─────────────────────────

test('elegir a alguien a dedo Y por su rol le manda UN aviso', () => {
  // Sin el desduplicado le llegarían dos avisos idénticos y dos pushes.
  const destino = NoticeService.resolveRecipients({ userIds: [3], roleUsers: [3, 7, 9] });
  assert.deepEqual([...destino.userIds].sort((a, b) => a - b), [3, 7, 9]);
  assert.equal(destino.everyone, false);
});

test('"a todo el equipo" no enumera a nadie', () => {
  /*
   * Un aviso a todos es UNA fila con `user_id` en NULL, que es como nacen todas
   * las automáticas: la campana la ve cualquiera con sesión. Enumerar a los
   * usuarios del panel crearía una fila por persona y afirmaría que le llegó a
   * gente que quizá nunca abrió la app.
   */
  const destino = NoticeService.resolveRecipients({ everyone: true, userIds: [1, 2], roleUsers: [3] });
  assert.equal(destino.everyone, true);
  assert.deepEqual(destino.userIds, []);
});

test('los ids que no son ids se descartan', () => {
  const destino = NoticeService.resolveRecipients({ userIds: [1, null, 'abc', 0, -4, '5'] });
  assert.deepEqual(destino.userIds.sort((a, b) => a - b), [1, 5]);
});

// ──────────────────────────── Lo que se rechaza ─────────────────────────────

function servicioFalso() {
  const creadas = [];
  const service = new NoticeService({
    notificationService: {
      create: async (fila) => {
        creadas.push(fila);
        return { id: creadas.length, ...fila };
      }
    }
  });
  return { service, creadas };
}

test('un aviso sin título se rechaza', async () => {
  const { service } = servicioFalso();
  await assert.rejects(() => service.send({ title: '   ', everyone: true, senderId: 1 }), /necesita un título/);
});

test('un título larguísimo se rechaza acá y no con un error de MySQL', async () => {
  const { service } = servicioFalso();
  await assert.rejects(
    () => service.send({ title: 'x'.repeat(121), everyone: true, senderId: 1 }),
    /no puede pasar de 120/
  );
});

test('un enlace a un dominio de AFUERA se rechaza', async () => {
  /*
   * Es la comprobación que más importa de este archivo. Un aviso que lleva a un
   * dominio de afuera es exactamente la forma de un phishing interno: le suena
   * en el teléfono a todo el equipo, con el nombre de la empresa arriba, y el
   * que lo toca va a donde lo mandaron. Solo se admiten rutas del panel.
   */
  const { service } = servicioFalso();
  // `//evil.com` y `/\evil.com` empiezan por "/" y el navegador los resuelve
  // igual contra OTRO dominio (son URLs relativas al protocolo). La primera
  // versión de esta comprobación —un `startsWith('/')` a secas— los dejaba
  // pasar, y este test la pilló.
  const afuera = [
    'https://sitio-falso.com',
    'javascript:alert(1)',
    '//evil.com',
    '/\\evil.com',
    'data:text/html,x'
  ];
  for (const link of afuera) {
    await assert.rejects(
      () => service.send({ title: 'Ojo', link, everyone: true, senderId: 1 }),
      /ruta del panel/,
      `tendría que rechazar ${link}`
    );
  }
});

test('una ruta del panel se admite', async () => {
  const { service, creadas } = servicioFalso();
  await service.send({ title: 'Mirá esto', link: '/admin/cobranzas', everyone: true, senderId: 1 });
  assert.equal(creadas[0].link, '/admin/cobranzas');
});

test('no elegir a nadie se rechaza diciendo qué falta', async () => {
  const { service } = servicioFalso();
  await assert.rejects(
    () => service.send({ title: 'Hola', everyone: false, userIds: [], roleIds: [], senderId: 1 }),
    /Elegí a quién/
  );
});

// ─────────────────────── Cómo quedan escritas las filas ─────────────────────

test('un aviso a todos es UNA fila sin destinatario', async () => {
  const { service, creadas } = servicioFalso();
  const resumen = await service.send({ title: 'Reunión a las 5', body: 'Sala de arriba', everyone: true, senderId: 7 });
  assert.equal(creadas.length, 1);
  assert.equal(creadas[0].userId, null, 'user_id en NULL es lo que significa "para todos"');
  assert.equal(creadas[0].createdBy, 7);
  assert.equal(creadas[0].type, MANUAL_NOTICE_TYPE);
  assert.equal(resumen.everyone, true);
});

test('un aviso a tres personas son TRES filas, una por cada una', async () => {
  /*
   * Y no una fila con una lista: es lo que hace que `is_read` siga significando
   * lo que significa. Con una fila compartida, el primero que lo abre lo marca
   * leído para los otros dos.
   */
  const { service, creadas } = servicioFalso();
  const resumen = await service.send({ title: 'Ojo', everyone: false, userIds: [4, 5, 6], senderId: 2 });
  assert.equal(creadas.length, 3);
  assert.deepEqual(creadas.map((c) => c.userId).sort((a, b) => a - b), [4, 5, 6]);
  assert.equal(resumen.recipients, 3);
});

test('las filas de un mismo envío comparten el lote', async () => {
  // Sin `batch_id`, un aviso a diez personas se lee en el historial como diez
  // avisos distintos y no se puede decir "esto se mandó una vez, a diez".
  const { service, creadas } = servicioFalso();
  await service.send({ title: 'Ojo', everyone: false, userIds: [1, 2], senderId: 1 });
  assert.equal(creadas[0].batchId, creadas[1].batchId);
  assert.ok(creadas[0].batchId.length >= 16, 'el lote tiene que ser difícil de adivinar');
});

test('dos envíos distintos no comparten el lote', async () => {
  const { service, creadas } = servicioFalso();
  await service.send({ title: 'Uno', everyone: true, senderId: 1 });
  await service.send({ title: 'Dos', everyone: true, senderId: 1 });
  assert.notEqual(creadas[0].batchId, creadas[1].batchId);
});

test('un cuerpo vacío se guarda como null y no como cadena vacía', async () => {
  // De eso depende que la app no dibuje una segunda línea en blanco debajo del
  // título, ni el push un cuerpo vacío.
  const { service, creadas } = servicioFalso();
  await service.send({ title: 'Solo título', body: '   ', everyone: true, senderId: 1 });
  assert.equal(creadas[0].body, null);
});
