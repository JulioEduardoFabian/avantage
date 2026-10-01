import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Exige una sesión válida (token JWT) y adjunta el usuario decodificado a req.user.
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No autenticado.' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
}

/**
 * Exige que el usuario autenticado tenga el permiso indicado (una "herramienta" habilitada por su rol).
 */
export function requirePermission(key) {
  return (req, res, next) => {
    if (!req.user?.permissions?.includes(key)) {
      return res.status(403).json({ error: 'No tienes permiso para acceder a este recurso.' });
    }
    next();
  };
}

/**
 * Exige al menos UNO de varios permisos. Lo necesitan las rutas que son la
 * misma acción vista desde dos módulos: atar un avance a una cuota se hace
 * desde Proyectos (`projects.view`) y desde Entregables (`deliverables.view`),
 * y duplicar el endpoint solo para cambiarle el permiso dejaría dos sitios
 * donde arreglar la próxima regla.
 */
export function requireAnyPermission(...keys) {
  return (req, res, next) => {
    const granted = req.user?.permissions || [];
    if (!keys.some((key) => granted.includes(key))) {
      return res.status(403).json({ error: 'No tienes permiso para acceder a este recurso.' });
    }
    next();
  };
}

const CLIENT_JWT_EXPIRES_IN = '30d';

/**
 * Token del portal de clientes: namespace de auth separado del panel interno
 * (`type: 'client'`) para que un JWT de staff nunca sirva en `/api/portal/*`
 * ni viceversa, aunque compartan el mismo secreto. Sesión larga (30 días)
 * porque es un cliente entrando desde su celular, no un operador.
 */
export function signClientToken(account) {
  return jwt.sign(
    { type: 'client', id: account.id, email: account.email, name: account.name },
    JWT_SECRET,
    { expiresIn: CLIENT_JWT_EXPIRES_IN }
  );
}

/** Exige una sesión válida del portal de clientes y adjunta el cliente a req.client. */
export function requireClientAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No autenticado.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'client') {
      return res.status(401).json({ error: 'Sesión inválida.' });
    }
    req.client = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
}

/**
 * Token corto (10 min) que viaja como `state` en el flujo OAuth de Google:
 * identifica a qué usuario pertenece la conexión cuando Google redirige de
 * vuelta a /api/google/callback, un request de navegador plano que no lleva
 * el header Authorization de la sesión.
 */
export function signGoogleOAuthState(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '10m' });
}

export function verifyGoogleOAuthState(state) {
  const payload = jwt.verify(state, JWT_SECRET);
  return payload.userId;
}
