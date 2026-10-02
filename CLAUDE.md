# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Flujo de trabajo obligatorio (git)

- **Antes de empezar a trabajar**, ejecuta `git pull` para traer los últimos cambios del remoto.
- **Después de completar un cambio** (o un conjunto de cambios relacionados), crea automáticamente
  un commit con un mensaje descriptivo en español que explique el *qué* y el *porqué* del cambio,
  siguiendo el estilo de los commits existentes (`feat(alcance): descripción`, `fix(alcance): ...`,
  `refactor(alcance): ...`), y a continuación haz `git push` a la rama actual.
- No pidas confirmación para el `git pull`, el commit ni el `push` salvo que el usuario indique lo
  contrario explícitamente en la conversación.
- Si el `push` es rechazado (la rama remota avanzó), haz `git pull` (o `git pull --rebase`) para
  integrar los cambios remotos y reintenta el `push` — nunca uses `--force` salvo que el usuario lo
  pida explícitamente.

## Comandos

```bash
npm install              # instalar dependencias
cp .env.example .env     # completar credenciales (ver tabla en README.md)

npm run dev               # backend con recarga automática (node --watch), http://localhost:3000
npx vite                  # dev server del frontend, http://localhost:5173 (proxy /api -> :3000)

npm run build             # compila el frontend a dist/ (servido como estático por Express)
npm run preview           # sirve el build de Vite localmente

npm run migrate           # aplica migraciones pendientes (Knex)
npm run migrate:rollback  # revierte el último batch de migraciones
npm run migrate:status    # lista migraciones aplicadas/pendientes
npm run migrate:make -- nombre_migracion   # crea un nuevo archivo de migración en backend/db/migrations/
npm run seed               # ejecuta los seeds (roles/permisos base, usuario admin, columnas del funnel)
```

No hay suite de tests ni linter configurados en `package.json`.

## Arquitectura

Full-stack monolítico: **Express (backend/) sirve tanto la API REST como el build estático de
Vue (dist/)** en el mismo puerto. En producción, `boot.cjs` (CommonJS) hace `import()` dinámico
de `backend/server.js` (ESM) porque el hosting compartido (Hostinger/Passenger) arranca con
`require()`, que no puede cargar ESM directamente — ver la nota "Por qué boot.cjs" en README.md
antes de tocar el arranque de producción.

### Backend (`backend/`)

- **`server.js`** es un único archivo con todas las rutas Express (endpoints `/api/*` y webhooks).
  Instancia todos los servicios al arrancar y los inyecta por closure a las rutas; los servicios
  con dependencias cruzadas se inyectan por constructor (p. ej. `whatsappBotService` recibe
  `ollamaService`, `emailService`, `leadService`, `whatsappMessageService`, `googleCalendarService`,
  `scheduledMeetingService`, `notificationService`).
- **`services/`**: toda la lógica de negocio y acceso a datos vive aquí, un archivo por dominio
  (leads, projects, quotes, roles, users, campañas, WhatsApp, Instagram, Meta Ads, TikTok Ads, Google Calendar,
  finanzas, etc.). `server.js` debería quedar delgado — la lógica nueva va en un servicio, no
  inline en la ruta.
- **`middleware/auth.js`**: JWT stateless. `requireAuth` exige un Bearer token válido y adjunta el
  payload decodificado a `req.user` (incluye `permissions: string[]`, embebidas en el token desde
  el login — no se re-consultan en cada request). `requirePermission(key)` exige que
  `req.user.permissions` incluya esa clave (p. ej. `'leads.view'`, `'roles.manage'`,
  `'finance.view'`). También firma/verifica el `state` corto usado en el callback OAuth de Google.
- **`middleware/upload.js`**: configuración de Multer para adjuntos de línea de tiempo de proyectos
  y comprobantes de finanzas (se guardan en disco bajo `uploads/`, que debe persistir entre
  despliegues).
- **`db/connection.js`** exporta una única instancia de Knex (`db`) reutilizada por todos los
  servicios — no crear conexiones nuevas por request.
- **`db/migrations/`**: una migración por cambio de esquema, nombradas por timestamp
  (`YYYYMMDDHHMMSS_descripcion.js`), cada una con `up()`/`down()`. Ver `backend/db/README.md` para
  el propósito de cada tabla y las relaciones entre ellas (leads → projects → tasks/quotes,
  roles ↔ permissions ↔ users, funnel_columns, whatsapp_*, page_*, etc.).
- **`db/seeds/`**: `001_init_rbac.js` crea roles/permisos base + usuario admin
  (`admin@tesisperu.local` / `admin123` — cambiar tras el primer login);
  `002_seed_funnel_columns_and_leads.js` crea las columnas del Kanban y leads de prueba, y
  **borra los leads existentes** — no ejecutar contra datos reales.

### Frontend (`src/`)

- Vue 3 + Vue Router, compilado con Vite. `src/apiClient.js` centraliza las llamadas a la API
  (adjunta el JWT desde `src/auth.js`, que también expone `isAuthenticated()`/`hasPermission()`).
- **`router/index.js`**: cada ruta protegida declara `meta: { requiresAuth: true, permission: '<key>' }`;
  el guard global (`router.beforeEach`) redirige a `/login` si no hay sesión, o a `/dashboard` si
  falta el permiso. Cualquier vista nueva bajo `/admin/*` debe seguir este patrón y el permiso
  correspondiente debe existir en la tabla `permissions` (migración + seed).
- **`views/`**: una vista por pantalla del panel interno (Leads/Kanban, Proyectos, Roles, WhatsApp,
  Campañas, Finanzas, Instagram/redes, Disponibilidad, guion del bot, etc.). Varias son archivos
  grandes (>500 líneas) que combinan estado, llamadas a la API y UI de una sección completa.
- **`components/`**: piezas reutilizadas entre vistas (layout admin, navbar, sidebar, chatbot de
  evaluación de tesis, reporte de viabilidad).
- **Densidad del panel interno**: todo el aire alrededor de las pantallas de `/admin` sale de los
  tokens `--shell-px/--shell-py/--shell-max` (contenedor de `AdminLayout`) y `--page-px/--page-py/
  --page-pb` (wrapper de cada vista, `<main class="container-fluid ...-page">`). Una vista nueva usa
  esos tokens en su wrapper en vez de un padding propio. La escala compacta de títulos, botones,
  inputs y modales vive en la sección "DENSIDAD Y ESTILO DEL PANEL INTERNO" de `src/style.css`,
  acotada a `.admin-layout`: el evaluador público conserva la escala espaciosa de landing.
- El evaluador público de viabilidad de tesis (`/evaluador-tesis`, `HomeView` + `ThesisForm` +
  `ThesisChatbot` + `ViabilityReport`) es una funcionalidad separada del CRM interno: genera un
  lead vía IA (Ollama Cloud, con fallback local) y no requiere autenticación.

### Dominio

- El **Kanban de Leads** (`SetterFunnelView.vue` / `LeadsView.vue`) tiene columnas configurables
  (`funnel_columns`, con `key`, `label`, `final`, `position`). Cuando un lead llega a la columna
  marcada `final` (`ganado`), se genera automáticamente un `project` asociado (1:1 vía `lead_id`).
- En el módulo de **proyectos no se muestran importes** (ni en la lista, ni en el detalle, ni en sus
  notificaciones): el dinero se consulta en Finanzas, que tiene su propio permiso. Los avisos de
  bloqueo se refieren al pago por su código (`finance_income.code`), nunca por su monto.
- Las **plantillas de tareas** (`task_templates` + `task_template_items`, `taskTemplateService.js`)
  guardan un conjunto de tareas con nombre y, opcionalmente, la universidad a la que pertenece. Un
  proyecto sin tareas sugiere por defecto la plantilla de su universidad (la del lead), o la
  general. Importar **copia** las tareas al proyecto y saltea las que ya existen con el mismo
  título, así que reimportar no duplica nada.
- El **plan de entregas se trabaja también desde la ficha del proyecto**
  (`/api/projects/:id/deliverables`, bajo `projects.view` y no `deliverables.view`: planificar QUÉ
  hay que entregar es parte de llevar el proyecto; marcar entregado, el archivo de respaldo y el
  cruce con el cobro siguen siendo del módulo de Entregables). Ahí se agregan, se quitan y se traen
  del contrato, y cada entregable muestra **su** avance porque las tareas cuelgan de él
  (`tasks.deliverable_id`, opcional y ON DELETE SET NULL: quitar un entregable del plan nunca borra
  el trabajo ya registrado — las tareas quedan sueltas). Elegir un entregable filtra el tablero de
  tareas del proyecto. Un entregable sin tareas tiene `task_progress: null`, no 0 (`taskProgress()`):
  un plan que recién se arma no es un plan atrasado.
- Los **proyectos** tienen tareas (`tasks`, N:1) cuyo `% avance = completadas / total`, colaboradores
  (N:N vía `project_collaborators`), un líder (`leader_id` → `users`) y una línea de tiempo de
  hitos con adjuntos opcionales (`project_updates`).
- El **cronograma de pagos** no tiene tabla propia: son las filas de `finance_income` del lead,
  ordenadas por `due_date` (la fecha *pactada*, distinta de `fecha`, el día en que entró el dinero).
  El mismo plan se edita desde el modal de "lead ganado", desde el contrato (campo `installments`
  del `PUT /api/contracts/:id`, que imprime la tabla con el marcador `{{cronograma_pagos}}`) y desde
  Finanzas — `financeLedgerService.replaceScheduleForLead()` es el único camino, y rechaza quitar o
  cambiar el monto de una cuota ya cobrada, o pasarse de `leads.total_amount`.
- Un hito de la línea de tiempo puede atarse a una cuota (`project_updates.income_id`): el cliente
  lo ve en su portal con el adjunto **bloqueado** hasta que Finanzas verifique ese pago. Como
  `projects.is_locked`, el `is_locked` del hito se deriva del estado del ingreso en cada lectura —
  nunca se guarda— y la descarga del portal lo verifica también en el servidor (403). Del
  entregable retenido el portal sí muestra un **adelanto parcial**
  (`attachmentPreviewService.js`): un extracto de texto de las primeras líneas — PDF, DOCX/ODT y
  texto plano, extraído solo con `zlib`, sin dependencias nuevas — o los primeros bytes si es una
  imagen. El recorte se hace en el servidor: el archivo completo nunca viaja al navegador antes de
  que el pago esté verificado.
- El módulo **Entregables** (`/admin/entregables`, `DeliverablesView.vue`, permiso `deliverables.view`,
  `deliverableService.js`) tiene **tabla propia**, `deliverables`: desde que las entregas dejaron de
  liberarse por el portal del cliente, la entrega ocurre fuera del sistema (correo, WhatsApp,
  presencial) y hay que registrarla. Ninguna de las tablas anteriores servía: `project_updates` solo
  sabe de lo ya publicado y no puede decir qué **falta** entregar; `contract_deliverables` es el
  compromiso de un contrato emitido y es inmutable a propósito; `finance_income` es el dinero.
  Una fila es un entregable **planificado** (título, fecha pactada, `income_id` opcional = la cuota
  que lo condiciona) que después se marca entregado (fecha, responsable, canal y copia opcional del
  archivo, en `uploads/deliverables/`). `status` guarda solo `pendiente`/`entregado`: el estado
  operativo se **deriva** en cada lectura cruzándolo con el estado de la cuota —`entregado`,
  `sin_cobrar` (salió el trabajo y Finanzas no verificó), `por_entregar` (ya se cobró y falta
  entregar) y `pendiente`— porque ese dato lo mueve Finanzas desde su propia pantalla. Sin cuota
  atada no hay nada que esperar del cobro.
  **Una cuota atada que todavía no se pagó (`finance_income.estado = 'pendiente'`) impide marcar el
  entregable como entregado**: entregar ahí es regalar el trabajo. La regla es
  `blocksDelivery()` en `deliverableService.js`, se aplica en `markDelivered()` (la ruta responde
  409) y viaja a la pantalla en `delivery_blocked`/`delivery_blocked_reason`, que es lo único que
  mira la vista — el botón que se ve y la regla que se aplica no pueden decir cosas distintas.
  Una cuota `pagado` (el cliente pagó y Finanzas todavía no da el visto bueno) **sí** deja entregar:
  esa diferencia es un trámite interno, no una deuda del cliente, y la entrega queda registrada como
  `sin_cobrar`, que es justamente para lo que existe ese estado.
  Como la verificación ocurre en Finanzas —otra pantalla, casi siempre otra persona—, al verificar
  una cuota sale un **aviso automático al equipo** (`paymentNoticeService.js`): correo + campana del
  panel con los datos del cliente, el pago y los entregables atados a esa cuota, marcando cuáles
  faltan entregar. Va a **un solo** correo —el de `deliverable_settings.notice_email`, que se edita
  en la propia pantalla de Entregables (`/api/deliverable-settings`), con un botón de envío de
  prueba al lado— y **sin importes**, por la misma razón que el resto del módulo. Es uno y no todos
  los usuarios con `deliverables.view` a propósito: de las entregas se encarga una persona, y
  repartirlo lo vuelve ruido que nadie mira. `INTERNAL_ALERT_EMAIL` queda de red de seguridad
  mientras el campo esté vacío. Solo sale cuando la cuota pasa de verdad a `verificado`: volver a
  verificar algo ya verificado no vuelve a avisar. Es un aviso, no parte de la verificación — si el
  correo falla, el pago queda verificado igual. Como Proyectos, **no muestra importes**: las cuotas se
  nombran por `finance_income.code`. El botón "Importar del contrato" **copia** las filas de
  `contract_deliverables` del contrato vigente y saltea las que ya existen con el mismo título
  (mismo criterio que las plantillas de tareas), porque un contrato emitido no se reescribe al
  reprogramar una entrega. El portal del cliente **no se tocó**: su línea de tiempo y el bloqueo de
  adjuntos por pago (`project_updates.income_id`) siguen funcionando igual.
  **Su pantalla es la única de `/admin` que se sale de la escala compacta del panel**, y es a
  propósito: la usa a diario una persona que no trabaja con software. Por eso tiene su propia escala
  (texto ~1rem, botones de 48 px de alto, campos de 1rem para que iOS no haga zoom al enfocarlos),
  cada estado va con una frase que dice **qué hacer** —no solo cómo se llama—, las fechas se cuentan
  en lenguaje llano ("faltan 3 días", "pasó hace 2 días") y editar/deshacer/eliminar viven detrás de
  "Más opciones" para que el botón grande sea siempre el de entregar. No hay tabla: cada entregable
  es una tarjeta en una sola columna, así que se usa igual en el celular que en el escritorio y sin
  desplazamiento horizontal. Unificarla con la densidad del resto del panel deshace justo lo que se
  pidió. Los nombres de estado que se ven en pantalla salen de `STATE_META` en la vista, no de
  `row.state_label` (el vocabulario del dominio): dentro de esa pantalla se habla un solo idioma.
- La pestaña **Salarios** de Finanzas (`finance_salaries`, `financeSalaryService.js`) es un
  registro de pagos al personal **independiente de la contabilidad**: no se relaciona con
  `finance_income` ni con `finance_journal`, no tiene llaves hacia ellas y no debe sumarse en los
  totales ni en el flujo de caja de `getOverview()`. Guarda la persona como texto libre (se paga a
  gente sin cuenta en el panel) y la fecha del pago es el dato que ordena la planilla. Cada fila
  tiene `estado` (`pagado`/`pendiente`) y el `monto` se guarda en **negativo** por ser un egreso
  (el formulario lo pide en positivo y `normalize()` le pone el signo).
- Los **documentos de marca** (cotización, contrato, comprobante de pago) comparten paleta, logo e
  iconos desde `quotationDocument.js`: si cambia la marca, cambian los tres juntos. El comprobante
  tiene además una versión **PDF** (`paymentReceiptPdf.js`, dibujada con `pdf-lib` en JavaScript
  puro porque el hosting compartido no corre un navegador headless): es la que se adjunta al correo
  del cliente y la que muestra la vista previa antes de enviarlo, así que lo que se ve es
  exactamente lo que se manda.
- El **catálogo de carreras** (`career_groups` + `careers`, `careerCatalogService.js`) es lo que
  alimenta todos los desplegables de "Carrera", incluido el evaluador público. Se administra en
  `/admin/carreras` (`CareersView.vue`, permiso `careers.manage`) y se lee en `GET /api/careers`,
  el único endpoint **público** del módulo (el evaluador no pide sesión). En el frontend,
  `src/data/careers.js` guarda el catálogo en un `ref` que se carga una vez al arrancar
  (`loadCareerCatalog()` en `main.js`); la lista literal que quedó en ese archivo es solo el
  **respaldo** mientras la petición viaja o si falla. Leads, proyectos y contratos guardan la
  carrera como **texto**, así que quitar o renombrar una carrera no toca las fichas existentes
  (el desplegable reagrega ese valor como "Registrado anteriormente"); renombrar con
  `propagate: true` sí reescribe `leads.field_of_study` y `projects.field_of_study`, nunca
  cotizaciones ni contratos ya emitidos.
- Los dos tableros de leads leen la **misma** columna `leads.status`, pero "¿este lead ya es del
  closer?" **no** se deduce de ese texto: se sella en `leads.sales_funnel_at` al entrar al funnel
  comercial. La deducción por status dejaba de reconocer al lead en cuanto el equipo borraba o
  recreaba una columna, y por ahí volvían los leads cotizados al Setter Funnel. La regla vive en
  `backend/services/salesFunnelStage.js` y su espejo `src/salesFunnelStage.js`:
  `leadHasGraduated(lead, salesStatuses)` es la pregunta que se le hace a un **lead** (mira el sello
  primero); `isSalesFunnelStatus(status, ...)` solo DETECTA la graduación al moverlo — status que no
  esté en `SETTER_ONLY_STATUSES` ni sea de bandeja (`nuevo`/`inbox`/`abierto`), y que sea una clave
  de `funnel_columns` o uno de los desenlaces fijos (`cita_agendada`, `en_negociacion`, `ganado`,
  `perdido`). Hay que consultarla por ahí y no con listas propias: las columnas de Ventas las crea el
  equipo y sus claves se generan solas (`col_mtc2nwec_fij`).
  **Sobre un lead que ya graduó, el bot de WhatsApp no actúa**: no le responde (pausa el bot para
  ese contacto y avisa al equipo), no le manda recordatorios de inactividad, no lo congela y
  `moveFunnelStage()` se niega a cambiarle el status — el bot solo manda leads HACIA Ventas
  (`cita_agendada`), nunca de vuelta. La única excepción es un lead con una reunión próxima
  agendada, que sigue recibiendo el recordatorio de esa reunión y las respuestas sobre el
  link/la hora (`handlePostBookingMessage`), caminos que no mueven el funnel.
- `leadService.updateLeadStatus()` es el **único** camino por el que cambia `leads.status` (incluso
  `updateLead()` delega ahí si le llega un `status`), y es donde viven las dos reglas: sella
  `sales_funnel_at` al pasar a una etapa comercial, y a un lead ya sellado **solo una persona** puede
  ponerle una etapa fuera del funnel comercial — el bot y los automatismos reciben el lead sin
  cambios. Cada movimiento (y cada intento rechazado, con `blocked`) queda en `lead_stage_changes`,
  que se lee desde la ficha del lead en el Funnel de Ventas y por `GET /api/leads/:id/stage-history`.
- `leadService.findByPhone()` cruza primero la cadena exacta y después los últimos 9 dígitos
  (`phoneMatchKey`): el `wa_id` del bot (`51987654321`) y lo que escribe la persona en el formulario
  de Meta (`+51 987 654 321`) son el mismo contacto, y compararlos tal cual hacía que el bot le
  creara un gemelo en "conversación abierta" y lo trabajara de cero.
- **RBAC**: `roles` ↔ `permissions` (N:N vía `role_permissions`) ↔ `users` (N:1 vía `role_id`). Los
  permisos son "herramientas" habilitables (`leads.view`, `projects.view`, `roles.manage`,
  `finance.view`, ...); se resuelven una vez en el login y se embeben en el JWT.
- **Bot de WhatsApp** (`whatsappBotService.js`, el servicio más grande del backend): conversa con
  leads, agenda reuniones vía `googleCalendarService`/`scheduledMeetingService`, y hace seguimiento
  de conversaciones inactivas (recordatorio a la 1h, estado "Congelado" a las 2h — barrido cada
  `STALE_CONVERSATION_SWEEP_INTERVAL_MS`, definido en `server.js`).
- El **conteo de seguidores de la página de Meta** se sondea periódicamente
  (`FOLLOWER_POLL_INTERVAL_MS` en `server.js`) porque Meta no lo notifica vía webhook.
- Los **webhooks de Meta/WhatsApp** validan la firma `X-Hub-Signature-256` contra `req.rawBody`
  (el body crudo se conserva explícitamente en el middleware `express.json` de `server.js` para
  esto).
- Errores no capturados en flujos de fondo (p. ej. un envío de WhatsApp fallido) no deben tumbar
  el servidor: `server.js` registra `unhandledRejection`/`uncaughtException` a nivel de proceso en
  vez de dejar que el proceso muera.
