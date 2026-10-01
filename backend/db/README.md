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
| `20261024000000_create_deliverables_permission.js` | Agrega el permiso `deliverables.view` (módulo **Entregables**) y lo asigna al rol Administrador. **No crea tablas**: el módulo es una lectura que cruza `finance_income` (¿el pago está verificado?), `project_updates.income_id` (¿el trabajo está subido y contra qué cobro?) y `contract_deliverables` (lo comprometido por escrito). Una tabla propia sería una cuarta verdad sobre el mismo hecho. |
| `20261025000000_create_deliverables_table.js` | Crea `deliverables`: el registro propio de las entregas de cada proyecto, desde que dejaron de liberarse por el portal del cliente. Una fila es un entregable **planificado** (título, `due_date`, `income_id` opcional = la cuota que lo condiciona) que luego se marca entregado (`delivered_at`, `delivered_by`, `delivery_channel` y copia opcional del archivo). `income_id` va con ON DELETE SET NULL, no CASCADE: borrar una cuota del cronograma no puede borrar el registro de un trabajo ya entregado. |
| `20261026000000_alter_leads_add_sales_funnel_at.js` | Agrega `leads.sales_funnel_at`: el sello de que el lead ya graduó al Funnel de Ventas y es del closer. Hasta ahora eso se **deducía** del texto de `leads.status`, y la deducción dejaba de funcionar en cuanto se borraba o recreaba una columna — por ahí volvían los leads cotizados al Setter Funnel. Rellena el sello para los que hoy son comerciales por su status y, además, para los que tienen cotización, proyecto o ingreso aunque su status diga otra cosa (son los que el bot ya había devuelto); excluye `descartado`, que es una decisión explícita de una persona. |
| `20261026010000_create_lead_stage_changes_table.js` | Crea `lead_stage_changes`: la bitácora de movimientos de etapa de cada lead (de dónde, a dónde, quién — `user`/`bot`/`system` —, por qué y cuándo), **incluidos los intentos rechazados**, marcados con `blocked`. Sin ella, cada reporte de "este lead se regresó solo" había que reconstruirlo a mano, y un tope que funciona se veía igual que uno que nunca se activó. |

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

### El módulo de Entregables

Las entregas **ya no se liberan por el portal del cliente**: ocurren fuera del sistema (correo,
WhatsApp, presencial) y se registran en la tabla `deliverables`
(`/admin/entregables`, permiso `deliverables.view`, `deliverableService.js`). Hizo falta tabla
propia porque ninguna de las que ya existían podía llevar ese registro:

- `project_updates` solo sabe de lo que YA se publicó, así que no puede decir qué **falta** entregar
  — y eso es la mitad del tablero.
- `contract_deliverables` es el compromiso escrito en un contrato emitido, inmutable a propósito: un
  contrato firmado no cambia porque alguien reprograme una entrega.
- `finance_income` es el dinero, no el trabajo.

Una fila es un entregable **planificado** que después se marca como entregado. Lo único que no se
guarda es el estado operativo, que se deriva en cada lectura cruzando `status` con el `estado` de la
cuota atada (`income_id`) — ese dato lo mueve Finanzas desde su propia pantalla, así que guardarlo
sería una copia que se desincroniza:

| cuota verificada | entregado | estado | falta |
|---|---|---|---|
| sí (o sin cuota atada) | sí | `entregado` | nada |
| no | sí | `sin_cobrar` | salió el trabajo y Finanzas aún no verifica → cobranza |
| sí (o sin cuota atada) | no | `por_entregar` | hacer la entrega |
| no | no | `pendiente` | las dos cosas |

Hay dos alarmas y son de áreas distintas, por eso van separadas: `is_overdue` (pasó la fecha pactada
de la ENTREGA y sigue sin entregarse) y `payment_overdue` (venció la CUOTA y sigue sin verificarse).

### Una cuota sin pagar frena la entrega

Si el entregable está atado a una cuota que **todavía no se pagó** (`finance_income.estado =
'pendiente'`), no se puede marcar como entregado: entregar ahí es regalar el trabajo. La regla es
`blocksDelivery()` en `deliverableService.js` y se aplica dentro de `markDelivered()`, no solo en el
botón — una pestaña abierta hace rato o una llamada directa a la API se saltarían una regla que
viviera únicamente en la pantalla. La ruta responde **409** (es un estado del cobro, no un error de
quien lo intentó) y borra el archivo que Multer ya había dejado en disco.

La pantalla no vuelve a derivar la regla: lee `delivery_blocked` y `delivery_blocked_reason`, que
salen de `shapeRow()` igual que `state`. Así el botón que se ve y la regla que se aplica no pueden
decir cosas distintas.

Una cuota **`pagado`** (el cliente pagó y subió su comprobante; falta el visto bueno de Finanzas) sí
deja entregar: esa diferencia es un trámite interno nuestro, no una deuda del cliente. Esa entrega
queda como `sin_cobrar`, que es exactamente para lo que existe ese estado.

El botón **"Importar del contrato"** copia a `deliverables` las filas de `contract_deliverables` del
contrato vigente del cliente (el más reciente no anulado) y saltea las que ya existen con el mismo
título, así que reimportar no duplica nada — mismo criterio que la importación de plantillas de
tareas. Se **copia** en vez de leerse en vivo justamente porque el contrato emitido es inmutable.

El módulo **no muestra importes**, igual que Proyectos: una cuota se nombra por su
`finance_income.code`. Así operaciones trabaja sin que eso implique abrir la contabilidad, que tiene
su propio permiso.

El portal del cliente **no cambió**: su línea de tiempo (`project_updates`) y el bloqueo de adjuntos
por pago que describe la sección anterior siguen funcionando igual. Son dos registros distintos — lo
que el cliente ve publicado, y lo que operaciones entregó — y a propósito no comparten tabla.

### Quién es "del closer": `leads.sales_funnel_at`

Los dos tableros de leads (Setter Funnel y Funnel de Ventas) leen la **misma** columna
`leads.status`, así que durante mucho tiempo la pregunta "¿este lead ya graduó al funnel comercial?"
se respondía **deduciéndola** de ese texto: si el status era la clave de una columna de
`funnel_columns`, o uno de los desenlaces fijos (`cita_agendada`, `en_negociacion`, `ganado`,
`perdido`), el lead era del closer.

Esa deducción se cae sola, y es el origen de los reportes repetidos de *"dejé el lead cotizado en el
funnel del closer y se regresó al del setter"*:

- si alguien borra, recrea o reemplaza una columna, los leads que estaban ahí se quedan con una clave
  que ya no existe en `funnel_columns`. Desde ese momento nada los reconoce: el Setter Funnel vuelve
  a mostrarlos y el bot vuelve a moverlos (congelarlos por inactividad a las 2 h);
- un lead que el closer dejó en la primera columna tiene un status de bandeja (`nuevo`), que a
  propósito no cuenta como comercial — y quedaba igual de desprotegido;
- si la petición de columnas falla en el navegador, el tablero del setter se quedaba sin la lista y
  mostraba todo.

`leads.sales_funnel_at` no se deduce: se **sella** cuando el lead entra a una etapa del funnel
comercial y solo lo borra una persona que lo devuelva a propósito a una etapa del setter. Sobrevive a
cualquier cambio de columnas. La regla vive en `backend/services/salesFunnelStage.js` y su espejo
`src/salesFunnelStage.js` — `leadHasGraduated()` es la pregunta que hay que hacerle a un lead;
`isSalesFunnelStatus()` solo DETECTA la graduación al moverlo.

El único lugar donde se escribe `leads.status` es `leadService.updateLeadStatus()`, y ahí viven las
dos reglas: sellar al entrar, y **no dejar salir** salvo que el actor sea una persona. El bot y los
automatismos del backend reciben el lead sin cambios y el intento queda registrado.

### `lead_stage_changes`: por qué se movió este lead

Cada cambio de etapa deja una fila: de qué etapa, a cuál, quién (`actor_type`: `user` / `bot` /
`system`, con copia del nombre como en `lead_notes`), por qué y cuándo — **incluidos los intentos
rechazados**, marcados con `blocked`. Se lee desde la ficha del lead en el Funnel de Ventas
("Ver historial de etapas") y por `GET /api/leads/:id/stage-history`.

Existe porque cada vez que el equipo reportaba un lead "regresado" había que reconstruir a mano qué
pudo haberlo movido: `leads.status` solo guarda el valor actual. Un tope que funciona y un tope que
nunca se activó también se veían idénticos hasta que `blocked` los separó.

### El mismo contacto con dos teléfonos distintos

El `wa_id` que guarda el bot (`51987654321`) y lo que escribe una persona en el formulario de Meta o
en el alta manual (`+51 987 654 321`) son el mismo número con distinta cadena. Comparar `phone` tal
cual hacía que el bot **no encontrara** al lead que ya existía: le creaba un gemelo en
`conversacion_abierta` y lo trabajaba de cero — otra forma de ver "el lead volvió al Setter Funnel"
aunque el original siguiera cotizado. `leadService.findByPhone()` compara primero la cadena exacta y
después los últimos 9 dígitos (`phoneMatchKey`); si hay varias filas del mismo número gana la que ya
graduó, que es la que el closer trabaja.

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
