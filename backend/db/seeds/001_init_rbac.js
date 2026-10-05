import bcrypt from 'bcryptjs';

/**
 * Siembra el esquema de roles y permisos inicial:
 * - Un permiso por herramienta: son exactamente los botones del menú lateral.
 * - Roles "Administrador" (todo), "Setter" y "Closer" (las dos mitades del área
 *   comercial) y "Comercial" (el puesto único de antes, que sigue existiendo
 *   para los equipos que no están partidos).
 * - Un usuario administrador por defecto para el primer acceso.
 *
 * La lista de permisos es la MISMA que arman las migraciones. Este seed borra
 * `permissions` y la vuelve a escribir, así que una lista corta acá deja una
 * base recién sembrada sin Finanzas, Contratos ni Carreras aunque sus
 * migraciones ya hayan corrido.
 *
 * Credenciales por defecto (CAMBIAR después del primer login):
 *   Email:    admin@tesisperu.local
 *   Password: admin123
 */
const PERMISOS = [
  { key: 'leads.view', label: 'Funnel de Ventas' },
  { key: 'setter.view', label: 'Setter Funnel' },
  { key: 'database.view', label: 'Base de Datos' },
  { key: 'campaigns.view', label: 'Campañas' },
  { key: 'webhooks.view', label: 'Webhooks' },
  { key: 'social.view', label: 'Interacciones (Facebook)' },
  { key: 'instagram.view', label: 'Instagram' },
  { key: 'whatsapp.view', label: 'WhatsApp' },
  { key: 'bot.manage', label: 'Personalidad del Bot' },
  { key: 'availability.view', label: 'Disponibilidad' },
  { key: 'documents.view', label: 'Documentos' },
  { key: 'projects.view', label: 'Proyectos' },
  { key: 'deliverables.view', label: 'Entregables' },
  { key: 'finance.view', label: 'Finanzas (Ingresos y Egresos)' },
  { key: 'finance.verify', label: 'Verificar ingresos (Finanzas)' },
  { key: 'contracts.manage', label: 'Contratos' },
  { key: 'careers.manage', label: 'Catálogo de Carreras' },
  { key: 'roles.manage', label: 'Roles y Permisos' }
];

const ROLES = [
  {
    name: 'Administrador',
    description: 'Acceso completo a todas las herramientas internas',
    permissions: PERMISOS.map((p) => p.key)
  },
  {
    name: 'Comercial',
    description: 'Acceso al funnel de ventas (leads)',
    permissions: ['leads.view', 'setter.view', 'database.view', 'documents.view', 'availability.view', 'whatsapp.view']
  },
  {
    name: 'Setter',
    description: 'Califica y agenda: Setter Funnel, WhatsApp e interacciones de redes',
    permissions: ['setter.view', 'whatsapp.view', 'instagram.view', 'social.view', 'availability.view']
  },
  {
    name: 'Closer',
    description: 'Cierra la venta: Funnel de Ventas, documentos y contratos',
    permissions: ['leads.view', 'documents.view', 'contracts.manage', 'availability.view', 'whatsapp.view']
  }
];

export async function seed(knex) {
  await knex('role_permissions').del();
  await knex('users').del();
  await knex('permissions').del();
  await knex('roles').del();

  await knex('permissions').insert(PERMISOS);
  const insertados = await knex('permissions').select('id', 'key');
  const idPorClave = new Map(insertados.map((p) => [p.key, p.id]));

  let adminRoleId = null;
  for (const rol of ROLES) {
    const [roleId] = await knex('roles').insert({ name: rol.name, description: rol.description });
    if (rol.name === 'Administrador') adminRoleId = roleId;
    const filas = rol.permissions
      .map((key) => idPorClave.get(key))
      .filter(Boolean)
      .map((permissionId) => ({ role_id: roleId, permission_id: permissionId }));
    if (filas.length > 0) await knex('role_permissions').insert(filas);
  }

  const passwordHash = await bcrypt.hash('admin123', 10);
  await knex('users').insert({
    name: 'Administrador',
    email: 'admin@tesisperu.local',
    password_hash: passwordHash,
    role_id: adminRoleId
  });
}
