import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readServiceAccount,
  buildMessage,
  classifyFcmError,
  PushService,
  ANDROID_CHANNEL_ID
} from '../pushService.js';

/**
 * Las tres reglas del push que no se pueden comprobar mandando una
 * notificación de verdad (hace falta un proyecto de Firebase y un teléfono),
 * y que son justamente las que, equivocadas, hacen daño en silencio.
 */

// ───────────────────────── Credenciales del .env ────────────────────────────

test('sin credenciales la integración queda apagada, no rota', () => {
  const push = new PushService({ deviceTokenService: null, env: {} });
  assert.equal(push.isConfigured(), false);
  assert.deepEqual(push.status().configured, false);
});

test('los tres campos sueltos alcanzan, y la clave privada se desescapa', () => {
  const account = readServiceAccount({
    FCM_PROJECT_ID: 'avantage-crm',
    FCM_CLIENT_EMAIL: 'push@avantage-crm.iam.gserviceaccount.com',
    // Tal como queda pegada en un .env: los saltos de línea escapados.
    FCM_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n'
  });
  assert.equal(account.projectId, 'avantage-crm');
  assert.ok(
    account.privateKey.includes('\n'),
    'la clave tiene que llegar con saltos de línea de verdad: con los \\n escapados, la firma del JWT falla'
  );
  assert.ok(!account.privateKey.includes('\\n'));
});

test('el JSON entero de la cuenta de servicio también sirve', () => {
  const account = readServiceAccount({
    FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: 'avantage-crm',
      client_email: 'push@x.iam.gserviceaccount.com',
      private_key: 'KEY'
    })
  });
  assert.equal(account.projectId, 'avantage-crm');
});

test('unas credenciales a medias se rechazan diciendo qué falta', () => {
  assert.throws(
    () => readServiceAccount({ FCM_SERVICE_ACCOUNT_JSON: '{"project_id":"x"}' }),
    /project_id, client_email y private_key/
  );
});

test('credenciales inválidas apagan el push sin tumbar el arranque', () => {
  // El servidor no puede dejar de arrancar por una variable de entorno mal
  // pegada: queda apagado y dicho.
  const push = new PushService({ deviceTokenService: null, env: { FCM_SERVICE_ACCOUNT_JSON: '{"project_id":"x"}' } });
  assert.equal(push.isConfigured(), false);
  assert.match(push.status().error, /private_key/);
});

// ──────────────────────────── El cuerpo del mensaje ─────────────────────────

test('el mensaje lleva notification Y data', () => {
  const { message } = buildMessage({
    token: 'tok',
    title: 'Reunión agendada',
    body: 'Hoy 4:30 p.m.',
    data: { type: 'meeting_booked', notificationId: 12, link: '/admin/calendario' }
  });
  // `notification` es lo que hace que Android e iOS muestren el aviso solos
  // con la app cerrada, que es para lo que existe todo esto.
  assert.equal(message.notification.title, 'Reunión agendada');
  // `data` es lo que le dice a la app a qué pantalla llevar al que lo toca.
  assert.equal(message.data.link, '/admin/calendario');
});

test('todo lo de data viaja como texto', () => {
  // FCM rechaza cualquier otro tipo, y un id numérico ahí hace fallar el envío
  // entero con un 400 que no dice cuál de los campos era.
  const { message } = buildMessage({ token: 'tok', title: 't', data: { notificationId: 12, veces: 3 } });
  for (const [key, value] of Object.entries(message.data)) {
    assert.equal(typeof value, 'string', `${key} tiene que ser texto`);
  }
});

test('data no arrastra nulos', () => {
  const { message } = buildMessage({ token: 'tok', title: 't', data: { link: null, type: undefined } });
  assert.deepEqual(Object.keys(message.data), []);
});

test('Android recibe prioridad alta y el canal de la app', () => {
  const { message } = buildMessage({ token: 'tok', title: 't' });
  // Con la prioridad normal, Android puede guardarse el aviso hasta la próxima
  // vez que el usuario encienda la pantalla.
  assert.equal(message.android.priority, 'high');
  // Si el canal no es el mismo que crea la app, Android cae al de por defecto
  // y el aviso sale sin sonido.
  assert.equal(message.android.notification.channel_id, ANDROID_CHANNEL_ID);
});

// ─────────────── Qué se hace con el token según lo que contestó ─────────────

test('un token caducado se da de baja', () => {
  const verdict = classifyFcmError({
    status: 404,
    body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }
  });
  assert.equal(verdict.revoke, 'unregistered');
  assert.equal(verdict.configProblem, false);
});

test('un token mal formado se da de baja', () => {
  const verdict = classifyFcmError({
    status: 400,
    body: { error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'INVALID_ARGUMENT' }] } }
  });
  assert.equal(verdict.revoke, 'invalid');
});

test('un 403 NO da de baja ningún token', () => {
  /*
   * Es la comprobación que más importa de este archivo. Un 401/403 es la cuenta
   * de servicio, el proyecto o el permiso: el problema es del servidor y los
   * dispositivos están perfectos. Tratarlo como "este token no sirve" dejaría a
   * TODO el equipo sin dispositivos registrados por una credencial mal pegada,
   * y volver a registrarlos exige que cada persona abra su app.
   */
  for (const status of [401, 403]) {
    const verdict = classifyFcmError({ status, body: { error: { status: 'PERMISSION_DENIED' } } });
    assert.equal(verdict.revoke, null, `un ${status} no puede dar de baja un token`);
    assert.equal(verdict.configProblem, true);
  }
});

test('un 503 de Firebase se reintenta y tampoco toca el token', () => {
  const verdict = classifyFcmError({ status: 503, body: {} });
  assert.equal(verdict.revoke, null);
  assert.equal(verdict.retry, true);
});

// ────────────────────── El envío no espera ni lanza ─────────────────────────

test('el push de una notificación nunca lanza hacia afuera', async () => {
  // La fila ya quedó asentada en `notifications`: la campana del panel ya
  // cumplió. Un FCM caído no puede tumbar el webhook del bot ni demorar el
  // cierre de una venta.
  const push = new PushService({
    deviceTokenService: {
      activeFcmTokens: async () => { throw new Error('la base se cayó'); },
      revoke: async () => 0
    },
    env: { FCM_PROJECT_ID: 'p', FCM_CLIENT_EMAIL: 'e', FCM_PRIVATE_KEY: 'k' }
  });
  assert.doesNotThrow(() => push.sendForNotification({ id: 1, type: 'x', title: 'y', body: 'z' }));
  const summary = await push.send({ title: 'x' });
  assert.equal(summary.sent, 0);
  assert.match(summary.error, /la base se cayó/);
});

test('sin dispositivos registrados no se gasta ninguna llamada', async () => {
  let llamadas = 0;
  const push = new PushService({
    deviceTokenService: { activeFcmTokens: async () => [], revoke: async () => 0 },
    env: { FCM_PROJECT_ID: 'p', FCM_CLIENT_EMAIL: 'e', FCM_PRIVATE_KEY: 'k' },
    fetchImpl: async () => { llamadas += 1; return { ok: true }; }
  });
  const summary = await push.send({ title: 'x' });
  assert.equal(summary.skipped, 'sin_dispositivos');
  assert.equal(llamadas, 0);
});

test('un token rechazado se da de baja y los demás siguen saliendo', async () => {
  const revocados = [];
  const push = new PushService({
    deviceTokenService: {
      activeFcmTokens: async () => [
        { id: 1, token: 'viejo', user_id: 1, platform: 'android' },
        { id: 2, token: 'bueno', user_id: 2, platform: 'ios' }
      ],
      revoke: async (token, reason) => { revocados.push([token, reason]); return 1; }
    },
    env: { FCM_PROJECT_ID: 'p', FCM_CLIENT_EMAIL: 'e', FCM_PRIVATE_KEY: 'k' },
    fetchImpl: async (_url, options) => {
      const sent = JSON.parse(options.body);
      if (sent.message.token === 'viejo') {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } })
        };
      }
      return { ok: true };
    }
  });
  // El token OAuth se da por resuelto: lo que se prueba acá es el reparto de
  // los resultados, no la firma del JWT.
  push.accessToken = 'fake';
  push.accessTokenExpiresAt = Date.now() + 3600 * 1000;

  const summary = await push.send({ title: 'Pago verificado' });
  assert.equal(summary.sent, 1);
  assert.equal(summary.failed, 1);
  assert.deepEqual(revocados, [['viejo', 'unregistered']]);
});

// ──────────── La validación del registro de un dispositivo ──────────────────

test('el registro rechaza lo que no puede guardar, antes de tocar la base', async () => {
  /*
   * Las tres validaciones corren ANTES de la primera consulta, así que se
   * pueden probar sin base. Importan porque la ruta las traduce a un 422 con el
   * motivo: un token vacío o una plataforma inventada es culpa de quien llama, y
   * un 500 ahí manda a revisar el servidor.
   */
  const { DeviceTokenService } = await import('../deviceTokenService.js');
  const service = new DeviceTokenService();

  await assert.rejects(
    () => service.register({ userId: 1, token: '   ', platform: 'android' }),
    /token del dispositivo es obligatorio/
  );
  await assert.rejects(
    () => service.register({ userId: 1, token: 'tok', platform: 'blackberry' }),
    /Plataforma no reconocida/
  );
  await assert.rejects(
    () => service.register({ userId: 1, token: 'tok', platform: 'android', transport: 'carrier_pigeon' }),
    /Transporte no reconocido/
  );
  // 512 es el ancho de la columna, y es lo que la deja entrar en un índice
  // único de InnoDB con utf8mb4. Más largo se rechaza acá y no con un
  // "Data too long for column" de MySQL.
  await assert.rejects(
    () => service.register({ userId: 1, token: 'x'.repeat(513), platform: 'android' }),
    /supera los 512 caracteres/
  );
});

test('las plataformas sin FCM están en la lista de plataformas válidas', async () => {
  // Windows y Linux se registran igual, con `transport: 'polling'`: así se sabe
  // cuántas instalaciones hay, y `activeFcmTokens()` las excluye del envío.
  const { DEVICE_PLATFORMS, DEVICE_TRANSPORTS } = await import('../deviceTokenService.js');
  for (const platform of ['android', 'ios', 'web', 'macos', 'windows', 'linux']) {
    assert.ok(DEVICE_PLATFORMS.includes(platform), `falta la plataforma ${platform}`);
  }
  assert.deepEqual(DEVICE_TRANSPORTS, ['fcm', 'polling']);
});
