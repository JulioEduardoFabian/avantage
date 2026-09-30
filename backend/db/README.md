# Base de datos (MySQL + Knex)

Este proyecto usa [Knex](https://knexjs.org/) como query builder / migrador contra MySQL para
registrar los **leads** (usuarios que completaron el chatbot y recibieron el reporte por correo).

## 1. Configuración

Copia las variables de `.env.example` a tu `.env` y ajústalas a tu instancia MySQL local
(por defecto asume XAMPP: `root` sin contraseña en `127.0.0.1:3306`):

```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=minirag_leads
```

Crea la base de datos (una sola vez) si no existe:

```bash
mysql -u root -e "CREATE DATABASE IF NOT EXISTS minirag_leads CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

## 2. Migraciones

Los scripts están definidos en `package.json`:

```bash
npm run migrate          # aplica todas las migraciones pendientes
npm run migrate:rollback # revierte el último batch de migraciones
npm run migrate:status   # lista qué migraciones se aplicaron / faltan
npm run migrate:make -- nombre_migracion  # crea un nuevo archivo de migración
```

Los archivos de migración viven en `backend/db/migrations/` y se ejecutan en orden por su prefijo de
timestamp. Cada uno exporta `up()` (aplicar cambio) y `down()` (revertirlo).

### Migraciones existentes

| Archivo | Descripción |
|---|---|
| `20260803000000_create_leads_table.js` | Crea la tabla `leads` (tema, nivel, carrera, email, teléfono, score de viabilidad, estado del lead, fecha). |
| `20260803010000_create_projects_table.js` | Crea la tabla `projects`. Un proyecto se genera automáticamente cuando un lead llega al estado final del funnel Kanban (`ganado`), con estado inicial `"Creado"`. Relación 1:1 con `leads` vía `lead_id`. |
| `20260803020000_create_tasks_table.js` | Crea la tabla `tasks` (N:1 con `projects` vía `project_id`). El % de avance del proyecto = tareas con `status = 'completado'` / total de tareas. |
| `20260803030000_create_quotes_table.js` | Crea la tabla `quotes` (N:1 con `leads` vía `lead_id`). Se genera al usar la opción "Generar Cotización" sobre un lead en estado `contactado` o `en_negociacion`. |
| `20260804000000_create_roles_table.js` | Crea la tabla `roles`. |
| `20260804010000_create_permissions_table.js` | Crea la tabla `permissions`: cada fila es una "herramienta" interna habilitable (existente o por desarrollar), p. ej. `leads.view`, `projects.view`, `roles.manage`. |
| `20260804020000_create_role_permissions_table.js` | Tabla pivote N:N `roles` ↔ `permissions`. |
| `20260804030000_create_users_table.js` | Crea la tabla `users` (usuarios internos), N:1 con `roles` vía `role_id`. |
| `20260805000000_alter_projects_add_deadline_and_leader.js` | Agrega `deadline` y `leader_id` (N:1 con `users`) a `projects`. |
| `20260805010000_create_project_collaborators_table.js` | Tabla pivote N:N `projects` ↔ `users`: colaboradores asignados a un proyecto. |
| `20260805020000_create_project_updates_table.js` | Crea `project_updates` (N:1 con `projects`): hitos de la línea de tiempo, texto + un adjunto opcional (archivo guardado en `uploads/project-updates/`). |
| `20260806000000_alter_projects_lead_id_nullable.js` | `projects.lead_id` pasa a ser opcional, para poder crear proyectos manualmente sin que provengan de un lead ganado. |
| `20260807000000_alter_leads_add_prospect_fields.js` | Agrega a `leads` los campos detallados de prospecto: datos personales, académicos, ubicación, origen y asesor asignado. |
| `20260814000000_create_funnel_columns_table.js` | Crea la tabla `funnel_columns`: las etapas (columnas) del Kanban de Leads, antes almacenadas solo en `localStorage` del navegador. Cada fila tiene `key`, `label`, `icon`, `color`, `final` y `position` (orden de despliegue). |
| `20261015000000_payment_schedule_and_gated_deliverables.js` | Agrega `finance_income.due_date` (la fecha **pactada** de la cuota, distinta de `fecha`, el día en que el dinero entró) y `project_updates.income_id` (la cuota que libera el adjunto de ese avance). Con las dos, el cronograma de pagos que se acuerda al ganar el lead **son** las cuotas de Finanzas, y un entregable puede quedar retenido en el portal del cliente hasta que Finanzas verifique el pago. |
| `20261016000000_create_task_templates.js` | Crea `task_templates` (conjuntos de tareas guardados con nombre y, opcionalmente, la universidad a la que pertenecen) y `task_template_items` (las tareas de cada plantilla, en orden). Al importar una plantilla las tareas se **copian** a `tasks`: editar después la plantilla no altera los proyectos que ya la usaron. |
| `20261017000000_normalize_initial_payment_flag.js` | Mueve `finance_income.is_initial_payment` a la primera cuota de cada cierre que ya tenía marcador (y activa el proyecto si esa cuota estaba verificada). Arregla los cierres donde el marcador había quedado en una cuota posterior, que dejaban el proyecto bloqueado para siempre. |
| `20261018000000_alter_quotes_add_offer_fields.js` | Agrega a `quotes` los campos que la cotización impresa ya tenía y el sistema no guardaba: `code`, `estimated_time`, `status_label`, `regular_amount` + `discount` (el descuento exclusivo; `amount` sigue siendo el precio FINAL acordado), `service_subtitle`, `warranty_text` y `commercial_terms`. Todos opcionales: una cotización vieja se imprime igual con los textos por defecto del documento. |
| `20261020000000_create_careers_catalog.js` | Crea `career_groups` (las áreas que agrupan el desplegable) y `careers` (las carreras, únicas en todo el catálogo, con `position` y `is_active`), y las siembra con la lista que antes vivía en `src/data/careers.js`. Agrega el permiso `careers.manage`. Los leads, proyectos y contratos siguen guardando la carrera como **texto**: quitar una del catálogo no toca las fichas que ya la usaron, solo deja de ofrecerse. |
| `20261021000000_create_finance_salaries.js` | Crea `finance_salaries`: la planilla de pagos al personal (persona, cargo, **fecha** del pago, periodo que cubre, monto, moneda, método, banco y detalle). Es un registro **aparte** de la contabilidad: no se relaciona con `finance_income` ni con `finance_journal`, no tiene llaves hacia ellas y no entra en los totales ni en el flujo de caja de `getOverview()`. `persona` es texto libre (se le paga a gente sin cuenta en el panel, y dar de baja a un usuario no debe reescribir la planilla). |
| `20261023000000_create_finance_salary_receipts.js` | Crea `finance_salary_receipts`: los comprobantes (imágenes o PDF) que respaldan cada pago de la planilla, 1:N contra `finance_salaries` y en cascada con él. Son los mismos archivos y la misma carpeta (`uploads/finance-receipts/`) que usan los comprobantes de ingresos y del libro diario, pero siguen sin tocar la contabilidad: solo son el respaldo del pago. |

### Cronograma de pagos y entregables bloqueados

El plan de cobro no vive en una tabla propia: **las cuotas del cronograma son las filas de
`finance_income` del lead**, ordenadas por `due_date`. Así no hay dos verdades sobre cuánto debe
el cliente, y el mismo plan se edita desde tres sitios sin copiar datos:

1. **Modal de "lead ganado"** (`WinDealModal.vue` → `POST /api/leads/:id/win`): el vendedor
   registra el primer pago y pacta las cuotas que faltan (monto + vencimiento).
2. **Contrato** (`ContractsTab.vue` → `PUT /api/contracts/:id`, campo `installments`): se
   reprograma el mismo plan; el marcador `{{cronograma_pagos}}` imprime la tabla en el documento.
3. **Finanzas** (pestaña INGRESOS): campo "Vence" en el formulario del ingreso.

El pago que desbloquea el proyecto (`finance_income.is_initial_payment`) es **siempre la primera
cuota del cronograma** — la de `due_date` más antiguo — y solo una por lead:
`financeLedgerService` recalcula el marcador después de cada alta, edición, borrado o
reprogramación de cuotas. Antes se guardaba al crear el ingreso y no se volvía a tocar, así que
podía quedar en una cuota posterior y el proyecto no se activaba nunca aunque el cliente ya
hubiera pagado. Un cierre que nunca tuvo marcador (anterior a este flujo) se deja como está: su
proyecto nunca estuvo bloqueado.

Una cuota ya cobrada (`estado` distinto de `pendiente`, o con comprobantes subidos) queda
bloqueada: no se puede borrar del cronograma ni cambiarle el monto, porque el asiento tiene que
seguir cuadrando con el banco. La suma del plan nunca puede superar `leads.total_amount`.

El **cronograma de entregas** del contrato es otra cosa y por eso tiene su propia tabla,
`contract_deliverables` (`contract_id`, `position`, `due_date`, `avance`): una entrega es un
compromiso escrito en el contrato, no dinero que Finanzas cobre, así que no se relaciona con
`finance_income` ni con la contabilidad. Se edita en el mismo formulario del contrato y se
imprime con el marcador `{{cronograma_entregas}}`. `due_date` es nullable a propósito —"Firma de
contrato" no tiene fecha propia y el documento imprime "Por definir"—, y una fila sin `avance` se
descarta al guardar. Las dos tablas del contrato salen de marcador y no se teclean dentro del
texto de la cláusula: cuando se escribían a mano quedaban contratos emitidos con la tabla vacía, o
con fechas que ya no coincidían porque alguien reprogramó un pago en Finanzas.

El ciclo completo de un entregable retenido:

```
avance subido con income_id  →  el cliente lo ve en su portal con el adjunto 🔒
        ↓
cliente sube su comprobante  →  la cuota pasa a "pagado" (en revisión)
        ↓
Finanzas verifica (finance.verify)  →  is_locked pasa a false solo, se habilita la descarga
                                        y sale el aviso por correo al cliente
```

`project_updates.is_locked` no se guarda: se deriva del `estado` del ingreso asociado en cada
lectura (`projectUpdateService`), igual que `projects.is_locked` se deriva del pago inicial. El
bloqueo se aplica también en la descarga (`GET /api/portal/projects/:id/updates/:updateId/attachment`
responde 403), no solo en la pantalla.

## 3. Seeds (datos iniciales de roles, permisos, columnas del funnel y leads de prueba)

```bash
npm run seed   # ejecuta backend/db/seeds/001_init_rbac.js y 002_seed_funnel_columns_and_leads.js
```

Crea los permisos base, los roles **Administrador** (todos los permisos) y **Comercial**
(solo `leads.view`), y un usuario administrador por defecto:

```
Email:    admin@tesisperu.local
Password: admin123
```

**Cambia esta contraseña después del primer inicio de sesión** — el seed es solo para
arrancar el sistema en desarrollo/local.

El segundo seed (`002_seed_funnel_columns_and_leads.js`) crea las 5 columnas por defecto del
Kanban de Leads (`nuevo`, `contactado`, `en_negociacion`, `ganado`, `perdido`) y ~20 leads de
prueba por columna (100 en total), con datos ficticios (nombre, universidad, carrera, score de
viabilidad, etc.) coherentes con la etapa del funnel en la que se encuentran. **Este seed borra
todos los `leads` existentes** (y en cascada sus `projects`/`quotes` asociados) antes de volver a
insertarlos — solo úsalo en un entorno de desarrollo/demo, no contra datos reales de producción.

## 4. Uso en el código

`backend/db/connection.js` exporta una instancia única de Knex (`db`) que reutilizan los
servicios (p. ej. `backend/services/leadService.js`). No se crea una conexión nueva por request.

Si la base de datos no está disponible, el guardado de leads falla de forma controlada
(se loguea una advertencia) sin interrumpir la respuesta al usuario — el reporte y el correo
ya se generaron independientemente del registro en MySQL.
