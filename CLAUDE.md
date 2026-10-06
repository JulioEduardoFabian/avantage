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

```bash
npm test                  # suite de pruebas (node --test sobre backend/**/*.test.js)
```

No hay linter configurado en `package.json`.

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
  **Desde Proyectos no se ve ni se registra nada del cobro del entregable**: ni la cuota atada, ni su
  estado, ni el estado operativo que sale de cruzarlos (`por_entregar`, `sin_cobrar`), ni el bloqueo
  por pago. El filtro vive en el servidor (`forProjectView()` en `deliverableService.js`, y la ruta
  de alta ni siquiera lee `incomeId`), no escondiendo campos en la pantalla: lo que no viaja no se
  puede filtrar después por error. Atar la cuota es del módulo de Entregables, que es el que tiene
  el permiso para ver el dinero. Es la misma regla de "en Proyectos no se muestran importes",
  llevada a la asociación completa.
- Cuando **nace un proyecto** sale un aviso automático al equipo (`projectNoticeService.js`): correo
  + campana del panel con el cliente, el tema, la fecha límite y si queda bloqueado esperando la
  verificación del primer pago (nombrado por su **código**, nunca por su monto). Se dispara desde
  `projectService` y no desde las rutas porque hay **tres** caminos de alta (lead ganado, cierre con
  pago inicial y alta manual): puesto en cada ruta, el cuarto que se agregue se olvida. Va a un solo
  correo, `project_settings.notice_email`, que se edita en la pantalla de Proyectos
  (`/api/project-settings`) y tiene su botón de envío de prueba — mismo patrón y mismas razones que
  `deliverable_settings`; `INTERNAL_ALERT_EMAIL` es la red de seguridad mientras esté vacío. El
  aviso no espera ni lanza: un correo lento o caído no puede demorar el cierre de una venta.
- La **tabla de Proyectos** muestra el equipo (líder + colaboradores) como círculos con las
  iniciales: `getAllProjects()` trae ya el `leader_name`, los `collaborators` —en UNA consulta para
  todos los proyectos, no una por fila— y el `client_name` del lead. El color del círculo se deriva
  del nombre (`avatarColor()`), así que la misma persona se ve siempre igual y no hay nada que
  guardar; el líder lleva anillo y estrella, y si además figura como colaborador no se repite. Los
  usuarios **no tienen foto** hoy: el template ya usa `member.avatar_url` si existe, así que
  agregarla después es sumar la columna y el formulario de carga, sin tocar la tabla.
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
  faltan entregar. Nombra además al **Asesor Operativo** (el líder del proyecto, `projects.leader_id`)
  y a la cuota por su **posición en el cronograma** ("segunda de 4"): quien entrega necesita saber a
  quién pedirle el trabajo y de qué cobro se trata, y ninguno de los dos salía en el aviso. La
  posición se calcula en cada envío con el orden de vencimiento del lead (el mismo de
  `listScheduleByLead()`, que es el que ve Finanzas en pantalla) y **no** se lee de
  `finance_income.cuota`: ese texto solo se renumera cuando el plan se reemplaza entero, así que una
  cuota creada o movida por otro camino queda diciendo "3era" siendo la segunda que vence. Los dos
  datos salen siempre, y si faltan dicen "No asignado" — omitir el renglón hace creer que el aviso
  no trae el dato, y el asunto usa el mismo ordinal que el cuerpo para que no se contradigan.
  Va a **un solo** correo —el de `deliverable_settings.notice_email`, que se edita
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
- El **responsable comercial** de un lead se asigna desde la propia tarjeta de los dos tableros
  (`LeadAssignee.vue`, el círculo con las iniciales a la derecha; `PATCH /api/leads/:id/assignee`).
  Son dos columnas y no una: `leads.assigned_user_id` es el enlace con la cuenta —la verdad, la que
  sobrevive a que la persona se renombre— y `leads.assigned_to` es la **copia legible** del nombre,
  que ya leían la Base de Datos, el buscador de los dos tableros y el bot. Se escriben siempre
  juntas (`assignmentPatch()` en `leadService.js`, el único sitio que las toca) porque una ficha que
  dice "Kevin" en una pantalla y "Lucía" en la otra es peor que no tener la función; el nombre que
  se **muestra** sale del join (`assigned_user_name`), no de la copia. La asignación también llega
  como **texto** desde la ficha de la Base de Datos: si nombra a alguien del área comercial se
  enlaza su cuenta, y si nombra a otro (un asesor sin cuenta en el panel, que es para lo que el
  campo libre sigue sirviendo) queda solo el texto. Reenviar el mismo nombre no suelta el enlace —
  ese formulario manda el campo en cada guardado, y corregir un DNI no puede dejar el lead sin
  asignar.
  El **área comercial** no es una columna ni una lista de nombres: son los usuarios con `leads.view`
  o `setter.view` **efectivos** (`userService.listCommercialTeam()`, `GET
  /api/leads/assignable-users`), o sea los que pueden trabajar un lead en alguno de los dos
  tableros. Definirlo por el permiso es lo que hace que los roles que el equipo cree después entren
  solos. La regla se verifica en el servidor (`assignLead()` rechaza con 422 a quien no es del área)
  y no solo en el desplegable.
  Asignar **no mueve el funnel**: no pasa por `updateLeadStatus()` ni deja nada en
  `lead_stage_changes`. La tarjeta tiene alto fijo (`--lead-card-h`, calibrado para que entren
  cinco/diez por columna sin scroll), así que el círculo va en una franja reservada a la derecha y
  el menú se teletransporta al `body`: dentro de la tarjeta quedaría recortado.
- En **Campañas**, "venta ganada" no es la cadena `'ganado'`: es lo que devuelve
  `loadWinningStatuses()` —el desenlace fijo más la clave de la columna que el equipo marcó como
  `final`, que se genera sola (`col_mtc2nwec_fij`)— **o** que el lead ya tenga un proyecto abierto
  (`isWonLead()` en `campaignService.js`). Con la lista fija que había, un lead cerrado salía en la
  trazabilidad como "En espera de la reunión" mientras el funnel lo mostraba en Ganado, y los
  contadores de la campaña lo dejaban afuera. El segundo camino es el respaldo del primero: si
  alguien recrea la columna sin marcarla `final`, el proyecto abierto sigue estando ahí, y mostrar
  "en espera" a un cliente al que ya se le entrega trabajo es el peor de los dos errores. Es la
  misma pregunta de la que cuelgan la creación del proyecto y la comisión de la setter, y se
  contesta en un solo sitio a propósito: tres pantallas con tres listas propias es como se llega a
  que cada una diga un número distinto.
- Los leads de **Meta Lead Ads** entran por el webhook (`metaWebhookService.importLead()`), que es
  un punto único de falla **silencioso**: `/api/webhooks/meta` responde 200 ANTES de procesar (Meta
  espera una respuesta rápida), así que un fallo posterior no se reintenta y solo deja una línea en
  un log que se rota. En septiembre de 2026 se perdió así el 39% de los leads de formulario (95 en
  el Administrador de anuncios contra 58 en la base). La **conciliación**
  (`metaLeadReconciliationService.js`, `GET`/`POST /api/leads/meta-reconciliation` bajo
  `leads.view`, botón "Conciliar Meta" en el Kanban) le pregunta a la Graph API qué leads tiene cada
  formulario y los compara contra los guardados: el `GET` solo reporta y el `POST` importa lo que
  falta — traer leads perdidos agrega gente al funnel que el equipo va a trabajar, así que no puede
  ser un efecto de abrir una pantalla. Meta conserva los leads de un formulario **90 días**: pasado
  ese plazo lo que no se concilió se perdió de verdad.
  `persistMetaLead()` (exportado por `metaWebhookService.js`) es el único camino de alta y lo usan
  las dos vías; repetido en cada llamador, la conciliación termina guardando campos distintos que el
  webhook y las dos mitades de la misma tabla dejan de ser comparables, que es justo lo que viene a
  medir. La atribución vive en columnas propias (`meta_leadgen_id`, `meta_form_id`, `meta_ad_id`,
  `meta_adset_id`, `meta_campaign_id`, `meta_platform`, `meta_created_time`) y ya no solo en el
  marcador de texto de `additional_notes`, que se sigue escribiendo porque es lo que hace legible la
  ficha. `meta_created_time` es el momento del envío en Meta y **no** `created_at` (cuándo entró
  acá): un lead recuperado hoy pertenece al día en que la persona llenó el formulario, y mezclar las
  dos fechas es lo que impide que el cruce contra el Administrador de anuncios cierre.
  El token tiene que ser de **página**: uno de usuario de sistema pasa el `debug_token` como válido
  y con todos los permisos, pero falla toda llamada de alcance de página (ver `.env.example`).
- **Cada quien ve sus leads.** Los dos tableros (y la Base de Datos) muestran solo los leads cuyo
  responsable es quien mira; `leads.manage_all` —"administrador del área comercial"— es el que ve el
  total y el **único** que puede asignar (`PATCH /api/leads/:id/assignee` lo exige, y el círculo de
  la tarjeta queda como indicador para el resto: si cualquiera pudiera reasignarse un lead, el
  filtro no significaría nada). El filtro vive en el servidor: `getAllLeads({ viewerId })` para la
  lista y el middleware `requireLeadVisible` en TODAS las rutas de un lead concreto, porque filtrar
  la lista y dejar la ficha abierta por id sería una cortina y no un permiso. La regla se escribe
  una vez en `leadService.canView()`.
  Un lead **sin responsable no lo ve nadie** salvo quien reparte: un lead de nadie que le aparezca a
  todos es el tablero compartido entrando por la puerta de atrás. El primer día, entonces, los
  tableros se ven vacíos para todos menos para el administrador — es a propósito, no se borra ni se
  toca ningún dato, y la pantalla lo dice en vez de parecer rota (`scope: 'mine' | 'all'` viaja en
  la respuesta justamente para poder explicarlo).
- El módulo de **Calendario** (`/admin/calendario`, `CalendarView.vue`, permiso `calendar.view`) es
  la agenda del closer: las reuniones que agendó el bot por WhatsApp y las cargadas a mano, en una
  grilla mensual. Lee `scheduled_meetings`, que dejó de ser solo del bot — `wa_id` admite nulos (una
  reunión manual no tiene conversación detrás) y se guarda `created_by`, `attendee_email` y
  `source` (`bot` | `manual`), que es lo que después deja ver si está agendando el bot o el equipo.
  Agendar a mano (`scheduledMeetingService.bookManual()`, `POST /api/meetings`) crea el evento en el
  Google Calendar **del closer**; si él no tiene su cuenta conectada, lo crea en el de quien agenda
  y lo invita por correo, para que le llegue igual. Si no hay ninguna conexión, **la reunión se
  guarda lo mismo** sin evento ni enlace de Meet y la pantalla lo avisa: perder la reunión por no
  poder crear el evento sería el peor desenlace. Borrarla del panel no cancela el evento en Google
  (el panel no puede tocar el calendario de otra persona) y eso también se dice.
  El mismo modal (`MeetingModal.vue`) se abre desde la ficha del lead en los **dos funnels**: es la
  misma reunión y el mismo endpoint, y copiado en cada pantalla el tercero se queda con el
  formulario viejo. **La hora no se escribe: se elige entre las que de verdad se pueden** — el
  horario del asesor cruzado con sus reuniones de ese día y con el reloj. Una hora entra solo si
  **toda** la duración elegida cae dentro de su horario (una reunión de una hora que arranca a las
  12:30 cuando él atiende hasta las 13:00 no es media hora libre, es media hora de ausencia), así
  que la lista se rearma también al cambiar la duración. Las ocupadas y las que ya pasaron se
  muestran **deshabilitadas y distintas entre sí** (tachada = hay algo ahí, apagada = ya fue) en vez
  de desaparecer: una lista que salta de las 09:00 a las 11:00 no dice si el asesor no atiende o si
  ya tiene algo, y de eso depende si conviene pedirle que lo mueva. Queda el escape de "escribir
  otra hora" con el motivo a la vista, porque a veces hay que salirse del horario; y una hora que
  vino pedida desde el calendario y no está libre **no se reemplaza en silencio**: se pasa a ese
  modo con el aviso. La hora se manda con el huso de Lima escrito a mano (`-05:00`) y no con el del
  navegador: una laptop configurada en otra zona agendaría a una hora distinta de la que se escribió.
  **La agenda es del equipo, no de cada uno**: a diferencia del funnel —donde cada quien ve SUS
  leads—, quien tenga `calendar.view` ve las reuniones de toda el área comercial, las filtra por
  asesor y puede agendarle a cualquiera de ella (`userService.listCommercialTeam()`, el mismo
  criterio por permiso que la asignación de leads; el servidor lo verifica con 422 y no solo el
  desplegable). Una reunión no es un lead en disputa: la coordina quien está libre, y esconderle al
  setter la agenda del closer al que le pasa el lead es lo que obligaba a preguntarla por WhatsApp.
  Ver la agenda de todos **no** es poder borrarla: quitar una reunión del panel lo pueden su asesor,
  quien la cargó (`created_by` — el que se equivocó de hora tiene que poder deshacerlo) y
  `leads.manage_all`.
  **La disponibilidad se pinta sobre el calendario.** El selector de asesores es múltiple
  (`AdvisorPicker.vue`) y lo que se dibuja es el **cruce** de los horarios de los elegidos: en la
  vista de día cada franja de media hora se tiñe, y en la de mes cada celda lleva una franja de 5 px
  con la forma del día. No es sí/no sino un conteo de cuántos de los elegidos pueden — `full`
  (pueden todos, el cruce de verdad), `mid`, `low` —, porque con tres asesores el cruce completo
  suele ser chico y pintar solo eso haría desaparecer la franja en la que faltaba uno, que es
  justamente la que se negocia. El cruce se arma en la pantalla a partir de los bloques crudos que
  devuelve `GET /api/availability/team?userIds=` (una consulta para todos, `getByUsers()`): marcar a
  alguien más tiene que repintar al instante. Por la misma razón las reuniones se traen del mes
  entero sin filtrar por asesor y el recorte se hace en el cliente. La aritmética del horario
  (0 = **lunes**, bloques de 30 min nombrados por su inicio, unión en rangos corridos) vive en
  `src/availabilityGrid.js` y la usan las tres pantallas que la necesitan.
  **Dos vistas, Mes y Día.** La de día es una línea de tiempo de 07:00 a 21:00 con las reuniones
  ubicadas por su hora y repartidas en carriles cuando se pisan —dos reuniones superpuestas, una
  encima de la otra, esconden justo el choque que hay que ver—, la línea de "ahora", y el clic sobre
  una franja abre el alta **con esa hora puesta** (`time` en `MeetingModal.vue`): ya se eligió la
  hora mirando el cruce, y volver a escribirla es pedir dos veces lo mismo. Lo que cae fuera de esa
  franja no se tira: se lista al pie. En el celular el mes queda como mapa (número, franja de
  disponibilidad y una raya por reunión con el color de su asesor) y el detalle se mira en la vista
  de día, que es la que entra en una columna.
  El botón "Ver horario" (`AvailabilityPeekModal.vue`, `GET /api/availability/:userId` bajo
  `calendar.view`) muestra el horario semanal de UN asesor de **solo lectura**, en rangos y no en
  casillas. La ruta va **después** de `/api/availability/me` (Express resuelve por orden y `:userId`
  la taparía) y, como `/team`, se limita al área comercial: que la agenda sea del equipo no vuelve
  pública la semana de cualquiera. Pintarlo sigue siendo de cada uno en "Mi Disponibilidad".
- El módulo de **Cobranzas** (`/admin/cobranzas`, `CollectionsView.vue`, permiso `collections.view`,
  `collectionService.js`) **no tiene tabla propia**: es `finance_income` mirada desde el trabajo de
  cobrar — las cuotas en `pendiente` y en `pagado`, o sea todo lo que Finanzas todavía no verificó,
  con el teléfono y el correo del cliente en la misma fila para no entrar a la ficha. Una tabla
  paralela de cuotas obligaría a mantener dos listas sincronizadas, y el día que se separen nadie
  sabría cuál dice la verdad. Lo único que no existía —quién cobró y cuándo— son dos columnas en esa
  misma tabla (`collected_by`, `collected_at`).
  **Cobrar no es verificar**: marcar "cobrado" deja la cuota en `pagado`, que es el estado que ya
  significaba "el cliente pagó y Finanzas no dio el visto bueno". El visto bueno sigue siendo de
  Finanzas con `finance.verify`, porque de él cuelgan el desbloqueo del proyecto, el aviso de
  entregables y las cifras del módulo — por eso esta pantalla puede estar en manos de quien persigue
  los pagos sin darle acceso al dinero. El cambio de estado pasa por
  `financeLedgerService.updateIncomeEstado()`, el camino que ya existía (es el que impide tocar una
  cuota verificada); Cobranzas no escribe `estado` por su cuenta.
  Cada fila cruza además los **entregables atados a esa cuota** (`deliverables.income_id`) en una
  **columna propia**, con el estado derivado en el servidor (`delivery_status`: `no_asignado` |
  `pendiente` | `parcial` | `entregado`). "No asignado" se dice con todas las letras y no se deja la
  celda vacía: hay cuotas que son solo plata —un adelanto, la cuota final— y una celda en blanco se
  lee como "falta cargar algo". La que tiene trabajo ya entregado tiene además su propio total y su
  filtro. Es el
  mismo cruce que el módulo de Entregables llama `sin_cobrar` —el cliente tiene su capítulo y
  nosotros no tenemos su plata— pero ahí solo se ve desde la otra pantalla, que casi siempre maneja
  otra persona; acá es lo que ordena a quién llamar primero. Alcanza con que **uno** de los
  entregables haya salido, y una cuota verificada nunca cuenta (esa plata ya entró): la regla es
  `deliveryState()`.
  Al cobrar se puede registrar el **2% para quien cobra** (`role: 'cobranza'` en
  `sales_commissions`, sobre el monto de ESA cuota). Es opcional en cada cobro y no automático: hay
  cuotas que entran solas y ahí no hay cobranza que comisionar. El beneficiario es **la sesión**, no
  un campo del formulario: elegirlo abriría la puerta a acreditárselo a cualquiera. Deshacer un
  cobro borra la comisión que generó **salvo que ya figure pagada** — esa es plata que salió y se
  corrige a mano.
  Por eso `sales_commissions.income_id` existe y el índice único es
  (`lead_id`, `user_id`, `role`, `income_id`): la comisión de cobranza es por **cuota** y la de la
  setter por **venta**, así que dos cuotas del mismo lead comisionan las dos, y el mismo cobro
  marcado dos veces no paga dos veces. `lead_id` admite nulos porque hay ingresos que no cuelgan de
  ningún lead y también se cobran.
- Los botones de barra y de fila del panel (`.btn-action-primary` / `-secondary` / `-ghost`), el
  encabezado de los modales (`.modal-title`, `.modal-close-btn`) y `.heading-icon` viven en
  `src/style.css`. Estaban copiados dentro del `<style scoped>` de cada vista, así que una pantalla
  nueva que los usara los pintaba con el estilo por defecto del navegador — un botón gris y plano
  que en tema oscuro se lee como un error. Van **sin** el prefijo `.admin-layout`: con 0,1,0 de
  especificidad, la copia scoped de cualquier vista (clase + atributo, 0,2,0) sigue ganando, así que
  las pantallas viejas no cambian y las nuevas heredan lo correcto. Una pantalla nueva no necesita
  volver a definirlos.
- **En el celular, la tabla no se achica: se vuelve tarjetas.** En Cobranzas cada `<td>` lleva su
  `data-label` y por debajo de 760 px el encabezado se oculta y cada fila pasa a ser una tarjeta con
  los rótulos adentro — una tabla de seis columnas en 380 px solo se puede leer arrastrándola de
  lado, y cobrar es justo lo que se hace con el teléfono en la mano. Los dos tableros, por su parte,
  pasan a **una columna por pantalla** (86vw) con `scroll-snap`, así cada gesto deja una columna
  entera a la vista; arrastrar tarjetas entre columnas no funciona en táctil (es HTML5 drag and
  drop), y por eso en el celular el tablero es para mirar y entrar a la ficha, donde el desplegable
  de etapa sí mueve el lead.
- **RBAC**: `roles` ↔ `permissions` (N:N vía `role_permissions`) ↔ `users` (N:1 vía `role_id`), más
  `user_permissions`, que son las **excepciones de una persona** sobre lo que le da su rol. Los
  permisos efectivos (rol + otorgados − revocados) se resuelven en UN solo sitio
  (`userService.getUserWithPermissions()`), una vez en el login, y viajan embebidos en el JWT: un
  cambio de permisos se ve cuando el navegador refresca la sesión (`/api/auth/me`), no al instante.
  Cada permiso es **un botón del menú lateral** y no un paquete de pantallas: `leads.view` abría
  once, y con el equipo partido en setter y closer dar el tablero del setter obligaba a dar también
  el bot y los documentos. Las claves nuevas (`setter.view`, `campaigns.view`, `webhooks.view`,
  `social.view`, `instagram.view`, `whatsapp.view`, `bot.manage`, `availability.view`,
  `documents.view`, `database.view`) se reparten igual en las rutas de `server.js`; las de datos
  compartidos —`/api/leads*`, `/api/funnel-columns*`, las notas— van con
  `requireAnyPermission('leads.view', 'setter.view')`, porque son el mismo lead visto desde los dos
  tableros. Cotizar y cerrar (`/win`, `/quote`) siguen siendo solo del closer.
  Una excepción que repite lo que el rol ya dice **se borra en vez de guardarse**
  (`setUserPermissionOverrides()`): guardada, cambiar de rol a esa persona no cambiaría nada: sus
  permisos viejos quedarían congelados como excepciones.
  La lista de permisos del seed `001_init_rbac.js` tiene que ser la misma que arman las migraciones:
  ese seed **borra** `permissions` y la reescribe, así que una lista corta deja una base recién
  sembrada sin Finanzas ni Contratos aunque sus migraciones ya hayan corrido.
- **Setter y Closer** son dos roles y un área. La setter trabaja el Setter Funnel y agenda; el
  closer recibe el lead agendado, cotiza y cierra. A los dos se les asignan leads porque el **área
  comercial** se define por permiso y no por nombre de rol: `listCommercialTeam()` toma a quien
  tenga `leads.view` o `setter.view` —efectivos, con las excepciones aplicadas— o sea a quien pueda
  trabajar un lead en alguno de los dos tableros.
- La **comisión de la setter** (`role: 'setter'`, la otra es la de cobranza) es el 2% de la venta que el closer cerró con el lead que ella le
  pasó (`sales_commissions`, `commissionService.js`, pestaña "Comisiones" en Finanzas bajo
  `finance.view`). Dos sellos en `leads` la sostienen: `setter_user_id` se escribe UNA vez, en el
  instante de la graduación (el mismo que `sales_funnel_at`), con quien tenía el lead asignado
  entonces — calculada al cerrar mirando el responsable actual, la comisión sería siempre del
  closer, porque para entonces la ficha ya está a su nombre; `closer_user_id` se escribe al ganar,
  con quien registró el cierre. No comisiona si no hay setter sellado, si lo cerró la misma persona
  que lo trabajó, o si la venta no tiene `total_amount`, y el motivo queda en el log
  (`commissionEligibility()`).
  Nace desde `leadService.updateLeadStatus()` y no desde la ruta de cierre: hay más de un camino a
  la etapa final —el modal de cierre con el primer pago y el arrastre en el Kanban de un lead que ya
  lo tenía— y puesta en cada ruta, a la tercera se le olvida (misma razón que el aviso de proyecto
  nuevo en `projectService`). **No puede tumbar la venta**: si falla, el lead queda ganado igual y
  el error va al log. Un lead comisiona una sola vez por persona (índice único), así que reabrir y
  volver a cerrar no paga dos veces. La etapa ganadora se pregunta con `loadWinningStatuses()`
  (`ganado` + la columna marcada `final`), no comparando contra una constante: el que renombra la
  columna no sabe que de eso cuelga la comisión. El porcentaje y la base se guardan en cada fila:
  cambiar el 2% no reescribe lo ya devengado. Es el **devengo**, no el pago — cuando se le abone,
  ese egreso se registra en Salarios, y por eso las comisiones no entran en `finance_journal` ni en
  los totales de Finanzas.
- La **bandeja de WhatsApp** (`/api/whatsapp/conversations`) está **paginada**: devolvía las 100 más
  recientes y el resto no existía para el panel, y además leía la tabla entera de mensajes en cada
  refresco para plegarla en memoria (crece con cada mensaje de cada conversación). Ahora primero se
  pide la PÁGINA de contactos con un `GROUP BY wa_id` ordenado por `MAX(received_at)` —para eso está
  el índice compuesto (`wa_id`, `received_at`)— y recién después los mensajes de esos contactos. El
  plegado sigue en JavaScript porque la bandeja necesita datos que no salen de la última fila: el
  canal del PRIMER mensaje, si ese primer entrante era el resumen de un formulario, y el último
  nombre de perfil conocido (los salientes lo traen en null). El cursor es el par
  (`received_at`, `wa_id`) y no solo la fecha: dos conversaciones pueden tener su último mensaje en
  el mismo segundo y una se perdería entre páginas. **La búsqueda se resuelve en el servidor** —
  filtrarla en el navegador sobre lo cargado es "busca entre las primeras 30", y el contacto viejo
  que no se encuentra a mano es justo el que se escribe; el nombre real del lead no está en
  `whatsapp_messages`, así que se traduce a los últimos 9 dígitos de los teléfonos de los leads que
  coinciden (`phoneKey`) y se cruza por sufijo. En la pantalla, el sondeo automático trae la primera
  página y la **mezcla** con lo ya cargado (reemplazarla tiraría todo lo que el operador bajó), y el
  cursor se recalcula desde la última conversación de la lista y no desde el que devuelve esa
  respuesta. `total` viaja aparte y solo en la primera página: "100 conversaciones" era el tamaño de
  la página disfrazado de dato.
- **Bot de WhatsApp** (`whatsappBotService.js`, el servicio más grande del backend): conversa con
  leads, agenda reuniones vía `googleCalendarService`/`scheduledMeetingService`, y hace seguimiento
  de conversaciones inactivas (recordatorio a la 1h, estado "Congelado" a las 2h — barrido cada
  `STALE_CONVERSATION_SWEEP_INTERVAL_MS`, definido en `server.js`).
  **Seis reglas más salieron de revisar las 2.723 conversaciones del 08/09 al 05/10/2026** (258
  contactos, 43 reuniones agendadas) y cada una ataca una fuga medida:
  (1) **el lead que avisa que ya está esperando en la reunión** ("Estoy en sala de espera", "No hay
  nadie quien me acepte") se atiende ANTES que todo lo demás, incluso antes que las señales
  críticas, incluso con el bot pausado y aunque el lead ya haya graduado a Ventas
  (`isWaitingInMeeting` + `_handleWaitingInMeeting`). No entra por `_handleCriticalSignal` porque
  ahí todo termina en `handOffToAdvisor()`, que cierra la sesión y mueve el funnel: no hay nada que
  transferir, hay una reunión en curso. Es la **única excepción** a "con el bot pausado el bot se
  calla", y es legítima porque el acuse no conversa (no pregunta nada, no mueve nada): del otro lado
  hay alguien mirando una sala vacía. Los cuatro casos reales del período no recibieron respuesta ni
  generaron aviso;
  (2) **el recordatorio de inactividad en conversación libre nombra el dato que falta** en vez de
  "¿Sigues por ahí?" — el genérico fue el último mensaje de 72 conversaciones con 26% de respuesta.
  No promete un horario: en ese punto todavía faltan datos para reservarlo, y prometer un bloque que
  después no se reserva es peor que el genérico. Quien se quedó mudo frente a los horarios o en
  `warmup` sigue recibiendo el suyo, con un bloque concreto;
  (3) **preguntar el precio es la señal de intención más fuerte del embudo** (42% agenda contra 19%
  del resto): si ya no falta ningún dato, el ancla de precio sale junto con los horarios en el mismo
  turno en vez de contestar "¿coordinamos?" y esperar un sí — ese turno de más es el más caro de
  perder;
  (4) **lo que el bot no puede leer** (una foto, un PDF, un audio sin transcribir) ya no cae en el
  vacío: `handleUnreadableMessage` admite que llegó, pide el dato por escrito y avisa al equipo por
  si era un documento que importa. Nunca pide "vuelve a enviármelo" —lo mandó bien, el que no puede
  leerlo es el bot— y no contesta a reacciones, ediciones ni mensajes borrados (`IGNORED_MESSAGE_TYPES`),
  que son ruido del protocolo y no alguien escribiendo;
  (5) **un lead transferido al que nadie le escribió en 3 horas escala hacia adentro**
  (`_followUpStaleHandoffs`): 17 transferencias en el período, 0 reuniones agendadas. El bot **no**
  vuelve a hablarle a propósito — ya le prometió que seguía una persona, y aparecer él otra vez
  convierte esa promesa en una del robot. La condición es dura: solo cuenta si el último saliente
  sigue siendo el mensaje de la transferencia (un asesor que contestó desde el panel o desde
  WhatsApp Business ya dejó el suyo vía `recordOutboundEcho`);
  (6) **un mensaje sin responder en una sesión cerrada, congelada o con el bot pausado también
  avisa** (`_alertUnansweredInbounds`): los dos bucles de inactividad solo recorren sesiones vivas,
  así que el peor caso quedaba afuera — 35 conversaciones terminaron con el contacto hablando y
  nadie respondiendo, cinco de ellas con un "Sí" a una propuesta de reserva que nunca se confirmó.
  Comparte el marcador `paused_alert_at` con `_alertPausedInbound` porque los dos avisan del mismo
  silencio y dos avisos son ruido.
  Cinco reglas de UX conversacional salieron de revisar las conversaciones del 01/10/2026 (1 cita de
  25 contactos) y conviene no deshacerlas: (1) la apertura pide **solo la carrera**, y la universidad
  en el turno siguiente — pedirlas juntas abandonaba 9 de 25 ahí (`nextDataQuestion()` es el único
  sitio donde vive ese orden); (2) la franja de silencio es **22:00–08:00** y lo acumulado sale
  escalonado (`NUDGE_BURST_LIMIT`), porque antes era 01:00–05:00 y tres contactos recibieron su
  recordatorio a las 05:06 en el mismo minuto; (3) un contacto que escribe con el **bot pausado**
  dispara un aviso al equipo (`_alertPausedInbound`, espaciado por `paused_alert_at`): antes solo
  quedaba en la bitácora interna y se perdía — así se quedó sin respuesta un lead que preguntó el
  precio dos veces; (4) el nombre que la persona **escribe** gana sobre el del perfil de WhatsApp en
  cualquier turno (`_adoptDeclaredName`), y las fichas se leen aunque no lleven dos puntos
  (`BARE_FORM_LABEL_RE`); (5) un "ok/sí/dale" **suelto** después de una propuesta es una aceptación
  (`isExplicitYes` + `answers.__awaitingYes`), no un mensaje al que responder repitiendo la pregunta
  anterior.
- El **conteo de seguidores de la página de Meta** se sondea periódicamente
  (`FOLLOWER_POLL_INTERVAL_MS` en `server.js`) porque Meta no lo notifica vía webhook.
- Los **webhooks de Meta/WhatsApp** validan la firma `X-Hub-Signature-256` contra `req.rawBody`
  (el body crudo se conserva explícitamente en el middleware `express.json` de `server.js` para
  esto).
- Errores no capturados en flujos de fondo (p. ej. un envío de WhatsApp fallido) no deben tumbar
  el servidor: `server.js` registra `unhandledRejection`/`uncaughtException` a nivel de proceso en
  vez de dejar que el proceso muera.
