import fs from 'node:fs';
import { google } from 'googleapis';

/**
 * El push de verdad: Firebase Cloud Messaging (HTTP v1).
 *
 * La campana del panel ya avisaba al equipo, pero solo a quien tuviera el panel
 * abierto en una pestaña. Esto le llega al teléfono con la app cerrada, que es
 * lo que hace que una reunión agendada por Avan o un pago verificado se vean
 * cuando pasan y no cuando alguien se acuerda de mirar.
 *
 * **Se cuelga de `notificationService.create()` y no de cada ruta.** Es el
 * punto único por el que nace toda notificación del panel —hoy ocho sitios: el
 * bot, los dos avisos de Finanzas, el de proyecto nuevo, el del portal del
 * cliente— y es la misma razón por la que el aviso de proyecto nuevo vive en
 * `projectService` y no en las tres rutas de alta: puesto en cada llamador, el
 * noveno que se agregue se olvida y nadie se entera de que no avisó.
 *
 * **No usa `firebase-admin`.** El SDK trae su propia cadena de dependencias y
 * esto corre en hosting compartido; la llamada que hace falta son treinta
 * líneas de REST y el token OAuth lo firma `googleapis`, que ya es una
 * dependencia directa del proyecto (la usa Google Calendar). Lo que se pierde
 * es el multicast del SDK: HTTP v1 manda **un mensaje por token**, así que un
 * aviso a diez dispositivos son diez llamadas. Para un equipo de un puñado de
 * personas eso es irrelevante, y si algún día deja de serlo el cambio es acá
 * adentro.
 *
 * El envío **no espera ni lanza**: una notificación que quedó asentada en la
 * base ya cumplió, y un FCM lento o caído no puede demorar el cierre de una
 * venta ni tumbar el webhook del bot. Misma regla que el correo de
 * `projectNoticeService`.
 */

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/**
 * El canal de Android. Tiene que ser el MISMO que crea la app Flutter: si no
 * coinciden, Android cae al canal por defecto y el aviso sale sin sonido y sin
 * poder despertar la pantalla.
 */
export const ANDROID_CHANNEL_ID = 'avantage_avisos';

/**
 * Cuántos envíos en paralelo. HTTP v1 no tiene multicast, así que son N
 * llamadas; de a 8 para no abrir una ráfaga de sockets en hosting compartido.
 */
const CONCURRENCY = 8;

/**
 * Un minuto de margen antes de que caduque el token OAuth: pedirlo de nuevo
 * cuesta una llamada, usar uno vencido cuesta el envío entero.
 */
const TOKEN_SKEW_MS = 60 * 1000;

/**
 * Las credenciales salen del `.env` de tres formas, por orden: el JSON de la
 * cuenta de servicio en una variable, la ruta a ese archivo, o los tres campos
 * sueltos. Las tres existen porque el hosting compartido no siempre deja subir
 * un archivo fuera del repo, y una clave privada pegada en una variable de
 * entorno con los saltos de línea escapados es el caso normal.
 */
export function readServiceAccount(env = process.env) {
  const inline = (env.FCM_SERVICE_ACCOUNT_JSON || '').trim();
  if (inline && inline.startsWith('{')) {
    return normalizeServiceAccount(JSON.parse(inline));
  }

  const file = (env.FCM_SERVICE_ACCOUNT_FILE || '').trim();
  if (file) {
    if (!fs.existsSync(file)) {
      throw new Error(`FCM_SERVICE_ACCOUNT_FILE apunta a un archivo que no existe: ${file}`);
    }
    return normalizeServiceAccount(JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  const projectId = (env.FCM_PROJECT_ID || '').trim();
  const clientEmail = (env.FCM_CLIENT_EMAIL || '').trim();
  const privateKey = (env.FCM_PRIVATE_KEY || '').trim();
  if (projectId && clientEmail && privateKey) {
    return normalizeServiceAccount({ project_id: projectId, client_email: clientEmail, private_key: privateKey });
  }

  return null;
}

function normalizeServiceAccount(raw) {
  const projectId = raw.project_id || raw.projectId;
  const clientEmail = raw.client_email || raw.clientEmail;
  // La clave privada pegada en una variable de entorno llega con los saltos de
  // línea escapados: sin deshacerlos, la firma del JWT falla con un error de
  // OpenSSL que no menciona el `.env` en ninguna parte.
  const privateKey = String(raw.private_key || raw.privateKey || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('La cuenta de servicio de FCM necesita project_id, client_email y private_key.');
  }
  return { projectId, clientEmail, privateKey };
}

/**
 * El cuerpo que entiende FCM HTTP v1.
 *
 * Van el bloque `notification` **y** el `data`: con el primero, Android e iOS
 * muestran el aviso solos cuando la app está cerrada (que es para lo que existe
 * esto); con el segundo, la app sabe a qué pantalla llevar al que lo toca. Solo
 * `data` obligaría a que la app estuviera corriendo para que se viera algo.
 *
 * Todo lo de `data` viaja como **texto**: FCM rechaza cualquier otro tipo, y un
 * id numérico ahí hace fallar el envío entero con un 400 que no dice cuál era.
 */
export function buildMessage({ token, title, body, data = {} }) {
  const stringData = Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  );

  return {
    message: {
      token,
      notification: { title, body: body || '' },
      data: stringData,
      android: {
        // 'high' es lo que despierta el teléfono; con la normal, Android puede
        // guardarse el aviso hasta la próxima vez que lo encienda el usuario.
        priority: 'high',
        notification: {
          channel_id: ANDROID_CHANNEL_ID,
          // Agrupa por tipo: veinte avisos del bot no pueden tapar la pantalla
          // entera y dejar fuera de vista el pago que se acaba de verificar.
          tag: stringData.type || 'avantage',
          default_sound: true
        }
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', badge: 1 } }
      },
      webpush: {
        notification: { title, body: body || '', icon: '/favicon.ico' },
        // A dónde lleva el clic en el navegador. En el móvil lo decide la app.
        fcm_options: stringData.link ? { link: stringData.link } : undefined
      }
    }
  };
}

/**
 * Qué hacer con el token según lo que contestó Firebase.
 *
 * Es puro para poder probarlo: la diferencia entre "este token ya no existe" y
 * "las credenciales del servidor están mal" decide si se da de baja la
 * dirección de envío o si no hay que tocar nada, y equivocarse en el segundo
 * caso **deja a todo el equipo sin dispositivos** por una variable de entorno
 * mal pegada.
 */
export function classifyFcmError({ status, body }) {
  const errorStatus = body?.error?.status || '';
  const details = body?.error?.details || [];
  const fcmCode = details.map((detail) => detail?.errorCode).find(Boolean) || '';

  // La instalación ya no existe: app desinstalada, datos borrados, token
  // rotado. Es el único caso en que el token se da de baja.
  if (status === 404 || errorStatus === 'NOT_FOUND' || fcmCode === 'UNREGISTERED') {
    return { revoke: 'unregistered', retry: false, configProblem: false };
  }
  // El token está mal formado: tampoco sirve de nada guardarlo.
  if (status === 400 && (fcmCode === 'INVALID_ARGUMENT' || errorStatus === 'INVALID_ARGUMENT')) {
    return { revoke: 'invalid', retry: false, configProblem: false };
  }
  // 401/403: la cuenta de servicio, el proyecto o el permiso. NO se toca ningún
  // token — el problema es del servidor y los dispositivos están bien.
  if (status === 401 || status === 403) {
    return { revoke: null, retry: false, configProblem: true };
  }
  // 429 y 5xx son de Firebase y pasan: se reintentan en el próximo aviso.
  if (status === 429 || status >= 500) {
    return { revoke: null, retry: true, configProblem: false };
  }
  return { revoke: null, retry: false, configProblem: false };
}

export class PushService {
  constructor({ deviceTokenService, env = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.deviceTokenService = deviceTokenService;
    this.fetch = fetchImpl;
    this.configError = null;
    try {
      this.serviceAccount = readServiceAccount(env);
    } catch (error) {
      // Credenciales presentes pero mal escritas: queda apagado y dicho, no
      // reventando el arranque del servidor por una variable de entorno.
      this.serviceAccount = null;
      this.configError = error.message;
      console.warn(`[Push] Credenciales de FCM inválidas: ${error.message}`);
    }
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  /** Sin credenciales la integración queda apagada y no se intenta nada. */
  isConfigured() {
    return Boolean(this.serviceAccount);
  }

  /** Lo que la app necesita para decidir si registra un token o se pone a sondear. */
  status() {
    return {
      configured: this.isConfigured(),
      projectId: this.serviceAccount?.projectId || null,
      error: this.configError,
      androidChannelId: ANDROID_CHANNEL_ID
    };
  }

  /**
   * El token OAuth de la cuenta de servicio, cacheado hasta que caduque. Son
   * ~60 minutos: pedirlo en cada notificación sería una llamada de más por
   * aviso, cada una con una firma RSA.
   */
  async #getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - TOKEN_SKEW_MS) {
      return this.accessToken;
    }
    const jwt = new google.auth.JWT({
      email: this.serviceAccount.clientEmail,
      key: this.serviceAccount.privateKey,
      scopes: [FCM_SCOPE]
    });
    const credentials = await jwt.authorize();
    this.accessToken = credentials.access_token;
    this.accessTokenExpiresAt = credentials.expiry_date || (Date.now() + 55 * 60 * 1000);
    return this.accessToken;
  }

  async #sendOne({ token, title, body, data }) {
    const accessToken = await this.#getAccessToken();
    const url = `https://fcm.googleapis.com/v1/projects/${this.serviceAccount.projectId}/messages:send`;
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(buildMessage({ token, title, body, data }))
    });

    if (response.ok) return { ok: true };

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    // Un 401 puede ser el token OAuth caducado antes de lo que decía: se tira
    // el cacheado para que el próximo envío pida uno nuevo.
    if (response.status === 401) {
      this.accessToken = null;
      this.accessTokenExpiresAt = 0;
    }
    return {
      ok: false,
      status: response.status,
      payload,
      verdict: classifyFcmError({ status: response.status, body: payload })
    };
  }

  /**
   * Manda la notificación a los dispositivos indicados (o a todos los del
   * equipo, que es lo que hace la campana del panel: `notifications` no tiene
   * columna de usuario, así que lo que sale en la campana lo ve cualquiera con
   * sesión y el push replica exactamente eso — no lo amplía).
   *
   * Devuelve el resumen para que la pantalla de diagnóstico pueda decir qué
   * pasó; nunca lanza.
   */
  async send({ title, body = '', data = {}, userIds = null } = {}) {
    if (!this.isConfigured()) {
      return { sent: 0, failed: 0, revoked: 0, skipped: 'no_configurado' };
    }
    if (!title) return { sent: 0, failed: 0, revoked: 0, skipped: 'sin_titulo' };

    let devices = [];
    try {
      devices = await this.deviceTokenService.activeFcmTokens({ userIds });
    } catch (error) {
      console.error(`[Push] No se pudieron leer los dispositivos: ${error.message}`);
      return { sent: 0, failed: 0, revoked: 0, error: error.message };
    }
    if (devices.length === 0) {
      return { sent: 0, failed: 0, revoked: 0, skipped: 'sin_dispositivos' };
    }

    const summary = { sent: 0, failed: 0, revoked: 0, devices: devices.length, configProblem: false };
    const queue = [...devices];

    const worker = async () => {
      while (queue.length > 0) {
        const device = queue.shift();
        try {
          const result = await this.#sendOne({ token: device.token, title, body, data });
          if (result.ok) {
            summary.sent += 1;
            continue;
          }
          summary.failed += 1;
          if (result.verdict.configProblem) {
            summary.configProblem = true;
            summary.error ??= result.payload?.error?.message || `HTTP ${result.status}`;
          }
          if (result.verdict.revoke) {
            await this.deviceTokenService.revoke(device.token, result.verdict.revoke);
            summary.revoked += 1;
          }
        } catch (error) {
          summary.failed += 1;
          summary.error ??= error.message;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, devices.length) }, worker));

    if (summary.configProblem) {
      console.error(`[Push] Firebase rechazó las credenciales (${summary.error}). Ningún token se dio de baja.`);
    } else if (summary.failed > 0) {
      console.warn(`[Push] ${summary.sent} enviados, ${summary.failed} fallidos, ${summary.revoked} dados de baja.`);
    }
    return summary;
  }

  /**
   * Lo que llama `notificationService.create()`: dispara y se olvida.
   *
   * La notificación ya quedó asentada en la base, así que esto es la capa de
   * encima. Se envuelve acá y no en el llamador para que ningún camino futuro
   * pueda, por olvidarse un `.catch()`, hacer caer un webhook por un push.
   */
  sendForNotification(notification, { audienceUserIds = null } = {}) {
    if (!this.isConfigured() || !notification) return;
    /*
     * Un público acotado por perfiles que hoy no tiene a NADIE es una lista
     * vacía, y entonces no hay a quién empujar: mandarlo igual sería ignorar
     * justo el recorte que alguien configuró. Distinto de `null`, que es "no
     * hay reparto para este tipo" y significa todos.
     */
    if (Array.isArray(audienceUserIds) && audienceUserIds.length === 0) return;
    this.send({
      title: notification.title,
      body: notification.body || '',
      data: {
        notificationId: notification.id,
        type: notification.type,
        link: notification.link || ''
      },
      // El destinatario de la fila decide a qué teléfonos va. `user_id` en NULL
      // significa "para todos" —así nacen todas las automáticas, que son avisos
      // del negocio— y un aviso dirigido va solo al suyo. Esto tiene que salir
      // de la MISMA columna que decide quién lo ve en la campana: si el push
      // fuera a todos y la campana solo al destinatario, el aviso dirigido le
      // sonaría en el bolsillo a gente que después no lo encuentra en el panel.
      //
      // `audienceUserIds` es la misma idea un escalón más abajo: lo que el
      // reparto por perfiles (`notification_routing`) dejó como público de
      // este TIPO. Lo resuelve `notificationService.create()` con las mismas
      // filas que filtran la campana, por la razón de arriba; acá solo se usa.
      userIds: notification.user_id ? [notification.user_id] : audienceUserIds
    }).catch((error) => console.error(`[Push] Fallo al empujar la notificación: ${error.message}`));
  }
}
