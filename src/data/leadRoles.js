/**
 * Qué roles del panel trabajan leads.
 *
 * Va en un módulo propio —y no junto a la lista del equipo— por dos razones:
 * es una regla **pura**, así que se puede probar sin levantar la app (la lista
 * del equipo trae el cliente de la API, que necesita `localStorage`), y es la
 * misma pregunta que hacen las tres pantallas que ofrecen asignar un lead. Con
 * una copia por pantalla, el día que un rol se llame distinto una ofrecería a
 * una persona y la otra no.
 */

/**
 * Palabras de rol que trabajan leads. Quien las tenga en el nombre de su rol es
 * a quien se le OFRECE un lead en los desplegables de asignación.
 *
 * Se busca palabra por palabra y por su comienzo, así que "Setter Junior",
 * "Ejecutivo Comercial", "Jefe de Ventas" y los plurales ("Setters",
 * "Comerciales") entran solos el día que el equipo los cree — un rol que no
 * entra es un desplegable sin la persona que de verdad trabaja el lead, y eso
 * se descubre tarde. No alcanza con que la palabra esté adentro de otra
 * ("Ventanilla" no es "Ventas"). Para admitir un rol que se llame de otra
 * forma se agrega su palabra acá, que es el único sitio donde está escrita.
 */
export const LEAD_ROLE_WORDS = ['setter', 'closer', 'comercial', 'ventas', 'vendedor'];

/**
 * ¿Esta persona trabaja leads?
 *
 * Por el NOMBRE de su rol, y no por el permiso: el área comercial se define por
 * `leads.view` / `setter.view`, y los **administradores los tienen por tenerlos
 * todos**, no porque trabajen leads — igual que Marketing, que necesita ver el
 * funnel para medir campañas. Por eso el desplegable de "Asignar a" ofrecía
 * siete personas de las que solo tres iban a trabajar el lead, y elegir una por
 * error deja la ficha a nombre de alguien que nunca la va a mirar.
 *
 * Esto acota lo que se **ofrece**, no lo que es válido: el servidor sigue
 * aceptando a cualquiera del área comercial (`assignLead()` responde 422 solo
 * fuera de ella), así que los leads que hoy están a nombre de un administrador
 * siguen como están y se pueden seguir guardando.
 */
export function worksLeads(user) {
  const palabras = String(user?.role_name || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z]+/);
  return palabras.some((palabra) => LEAD_ROLE_WORDS.some((raiz) => palabra.startsWith(raiz)));
}
