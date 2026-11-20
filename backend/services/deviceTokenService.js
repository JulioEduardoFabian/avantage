import { db } from '../db/connection.js';

/**
 * Los dispositivos a los que se les empuja una notificación.
 *
 * La campana del panel (`notifications`) dice QUÉ pasó; esta tabla dice a qué
 * pantallas hay que avisarle. Ver la cabecera de la migración
 * `20261203000000_create_device_tokens.js` para por qué el token identifica al
 * dispositivo y no a la persona.
 */

/** Plataformas que la app declara al registrarse. */
export const DEVICE_PLATFORMS = ['android', 'ios', 'web', 'macos', 'windows', 'linux'];

/**
 * Cómo recibe cada plataforma. Firebase Cloud Messaging **no existe en Windows
 * ni en Linux**, así que esas instalaciones trabajan por sondeo y no tienen
 * token que registrar: son las dos únicas que nacen en 'polling'.
 */
export const DEVICE_TRANSPORTS = ['fcm', 'polling'];

const MAX_TOKEN_LENGTH = 512;

/** Lo que se le devuelve a la app: nunca el token entero. */
const DEVICE_PUBLIC_COLUMNS = [
  'id', 'platform', 'transport', 'device_label', 'app_version',
  'last_seen_at', 'revoked_at', 'revoked_reason', 'created_at'
];

/**
 * Un token caducado se marca en vez de borrarse (`UNREGISTERED` de Firebase):
 * así el envío deja de reintentarlo y la pantalla de dispositivos puede decir
 * que esa instalación dejó de responder, que es lo único que explica por qué a
 * alguien no le llega nada.
 */
export const REVOKED_REASONS = {
  UNREGISTERED: 'unregistered',
  INVALID: 'invalid',
  LOGOUT: 'logout'
};

export class DeviceTokenService {
  /**
   * Registra (o actualiza) el token de ESTE dispositivo para ESTE usuario.
   *
   * Es un upsert por token y no un insert, y el token **se muda** de dueño si
   * en el aparato entra otra persona: con un insert por sesión, el panel le
   * mandaría a la pantalla de bloqueo de quien usó el teléfono antes las
   * notificaciones de los leads de quien lo usa ahora.
   *
   * Registrar un token revocado lo revive (`revoked_at` a null): si la app
   * volvió a mandarlo, la instalación está viva otra vez — reinstalada, o con
   * el permiso de notificaciones recién concedido.
   */
  async register({ userId, token, platform, transport = 'fcm', deviceLabel = null, appVersion = null }) {
    const normalized = String(token || '').trim();
    if (!normalized) throw new Error('El token del dispositivo es obligatorio.');
    if (normalized.length > MAX_TOKEN_LENGTH) {
      throw new Error(`El token del dispositivo supera los ${MAX_TOKEN_LENGTH} caracteres.`);
    }
    if (!DEVICE_PLATFORMS.includes(platform)) {
      throw new Error(`Plataforma no reconocida: ${platform}. Debe ser una de ${DEVICE_PLATFORMS.join(', ')}.`);
    }
    if (!DEVICE_TRANSPORTS.includes(transport)) {
      throw new Error(`Transporte no reconocido: ${transport}. Debe ser uno de ${DEVICE_TRANSPORTS.join(', ')}.`);
    }

    const now = new Date();
    const existing = await db('device_tokens').where({ token: normalized }).first();

    if (existing) {
      await db('device_tokens').where({ id: existing.id }).update({
        user_id: userId,
        platform,
        transport,
        device_label: deviceLabel,
        app_version: appVersion,
        last_seen_at: now,
        revoked_at: null,
        revoked_reason: null,
        updated_at: now
      });
      return db('device_tokens').where({ id: existing.id }).first();
    }

    const [id] = await db('device_tokens').insert({
      user_id: userId,
      token: normalized,
      platform,
      transport,
      device_label: deviceLabel,
      app_version: appVersion,
      last_seen_at: now,
      created_at: now,
      updated_at: now
    });
    return db('device_tokens').where({ id }).first();
  }

  /**
   * Cierre de sesión: el token se **borra**, no se marca. No hay nada que
   * diagnosticar y lo que importa es que a ese teléfono no le siga llegando
   * nada de una sesión que ya se cerró.
   *
   * No se exige que el token sea del usuario que lo manda: el que tiene el
   * token es el dispositivo, y es justamente el caso de "en este celular ahora
   * entra otra persona" el que tiene que poder soltarlo.
   */
  async unregister(token) {
    const normalized = String(token || '').trim();
    if (!normalized) return 0;
    return db('device_tokens').where({ token: normalized }).del();
  }

  /** Los tokens vivos a los que se les puede mandar un push por FCM. */
  async activeFcmTokens({ userIds = null } = {}) {
    const query = db('device_tokens')
      .whereNull('revoked_at')
      .where({ transport: 'fcm' })
      .select('id', 'token', 'user_id', 'platform');
    if (Array.isArray(userIds)) {
      if (userIds.length === 0) return [];
      query.whereIn('user_id', userIds);
    }
    return query;
  }

  /** Los dispositivos de un usuario, para su propia pantalla. Sin el token. */
  async listForUser(userId) {
    return db('device_tokens')
      .where({ user_id: userId })
      .orderBy('last_seen_at', 'desc')
      .select(DEVICE_PUBLIC_COLUMNS);
  }

  /**
   * Firebase rechazó el token: la instalación ya no existe (app desinstalada,
   * datos borrados, token rotado). Se marca para que el próximo envío no gaste
   * una llamada en ella.
   */
  async revoke(token, reason = REVOKED_REASONS.UNREGISTERED) {
    const normalized = String(token || '').trim();
    if (!normalized) return 0;
    return db('device_tokens').where({ token: normalized }).update({
      revoked_at: new Date(),
      revoked_reason: reason,
      updated_at: new Date()
    });
  }

  /** La app sigue abierta: sirve para saber qué instalaciones están vivas. */
  async touch(token) {
    const normalized = String(token || '').trim();
    if (!normalized) return 0;
    return db('device_tokens').where({ token: normalized }).update({ last_seen_at: new Date() });
  }

  /** Cuántos dispositivos puede recibir un push, para la pantalla de estado. */
  async counts() {
    const rows = await db('device_tokens')
      .select('platform', 'transport')
      .count('* as total')
      .whereNull('revoked_at')
      .groupBy('platform', 'transport');
    return rows.map((row) => ({ ...row, total: Number(row.total) }));
  }
}
