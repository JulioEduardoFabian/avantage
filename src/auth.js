import { reactive } from 'vue';

const storedUser = localStorage.getItem('auth_user');

export const authState = reactive({
  token: localStorage.getItem('auth_token') || null,
  user: storedUser ? JSON.parse(storedUser) : null
});

export function setSession(token, user) {
  authState.token = token;
  authState.user = user;
  localStorage.setItem('auth_token', token);
  localStorage.setItem('auth_user', JSON.stringify(user));
}

export function clearSession() {
  authState.token = null;
  authState.user = null;
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
}

export function isAuthenticated() {
  return !!authState.token;
}

/**
 * ¿La sesión tiene este permiso? Acepta también una lista, y entonces alcanza
 * con tener UNO: hay pantallas que son la misma herramienta vista desde dos
 * puestos (la ficha del lead la abren el setter y el closer).
 */
export function hasPermission(key) {
  const granted = authState.user?.permissions || [];
  if (Array.isArray(key)) return key.some((k) => granted.includes(k));
  return granted.includes(key);
}
