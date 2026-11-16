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

### App de notificaciones (`mobile/`)

App Flutter multiplataforma que recibe las notificaciones del panel en el dispositivo.
Vive en `mobile/` y tiene su propio `README.md` con la configuración de Firebase.

```bash
cd mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000   # emulador Android
flutter analyze           # sin avisos
flutter test              # pruebas de los modelos
flutter build apk --debug # Android
flutter build web --release
```

`API_BASE_URL` por defecto es `http://10.0.2.2:3000`, que es cómo el emulador de Android ve
el `localhost` de la máquina anfitriona. En un teléfono de verdad va la IP de la máquina en la
red local. **Windows pide activar el «Modo de desarrollador»** para compilar (Flutter necesita
enlaces simbólicos para los plugins).

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
- **Dos reglas de las migraciones**, las dos salidas del mismo fallo en producción (01/11/2026) y
  comprobadas por `__tests__/migrationHygiene.test.js`:
  (1) **Una migración puede importar funciones puras pero NUNCA una lista de columnas.** La
  migración de atribución hacía su backfill con `.select('id', ...LEAD_ORIGIN_COLUMNS)` para no
  repetir la lista; después se le agregaron a esa constante las columnas de Smart+, que las crea
  una migración **posterior**, así que la de atribución empezó a pedirle a MySQL columnas que
  todavía no existían y murió con «Unknown column». La función es la lógica y conviene que sea una
  sola —una copia en la migración dice lo viejo el día que alguien corrija la original—, pero una
  lista de columnas es una **foto del esquema en ese punto de la historia** y no puede venir de un
  archivo que sigue creciendo. Se congela en el propio archivo.
  (2) **En MySQL el DDL no es transaccional**, así que toda migración tiene que poder
  **reintentarse**: `hasColumn()` antes de agregar una columna, `hasTable()` antes de crear una
  tabla, y una consulta a `information_schema.STATISTICS` antes de crear un índice (knex no tiene
  `hasIndex`). Cuando aquella murió en el backfill, sus cuatro columnas ya estaban agregadas y
  knex no pudo deshacerlas ni registró la migración: el reintento chocó contra «Duplicate column
  name» y quedó trabado sin forma de avanzar ni de volver atrás. El `down()` se escribe simétrico
  por lo mismo — uno que asume el estado completo no se puede correr después de un `up()` que
  murió a la mitad, que es lo único para lo que existe. El ayudante de índices se **repite** en
  cada migración en vez de vivir en un módulo compartido: lo que una migración importa de afuera
  tiene que poder cambiar sin cambiarla.
  Las migraciones **ya aplicadas no se reescriben** para cumplir esto: cambiar una que corrió en
  producción es la otra forma de dejar la base y el código diciendo cosas distintas. El test las
  exige desde `20261125000000`.
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
  El editor que comparten esas dos pantallas (`PaymentScheduleEditor.vue`, con la aritmética en
  `src/paymentSchedulePlan.js`) **propone el plan completo y no cuota por cuota**: la primera vence
  **hoy** (es la que se cobra al firmar; proponerla para el mes siguiente obligaba a corregir la
  fecha en todos los cierres) y el precio total se **divide en partes iguales** entre las cuotas que
  el editor propuso — 1500 en una da 1500, en dos 750 y 750, en tres 500/500/500. Lo bloqueado (ya
  cobrado) y lo que alguien escribió a mano se descuenta primero y no se toca: sin esa distinción,
  agregar la última cuota le borraría al vendedor el monto que acaba de pactar. Las cuotas que
  llegan de afuera —un contrato ya guardado— nacen marcadas como escritas a mano, así que cambiar
  el precio total nunca reescribe un cronograma que ya está en Finanzas. La diferencia del
  redondeo va a la **última** cuota (1000 en tres es 333.33 · 333.33 · 333.34): un céntimo de menos
  y el cronograma nunca dice "completo ✓"; uno de más y `replaceScheduleForLead()` lo rechaza por
  pasarse del precio. Las fechas se corren con aritmética en UTC y el "hoy" sale de `limaDay()`:
  con el reloj del navegador en otra zona, un `new Date()` a las 20:00 de Lima ya es mañana.
  `offset > 0` (el modal de cierre, donde el primer pago se registra arriba) significa que lo de
  acá es la cola del cronograma y no la primera cuota, así que esa empieza el mes siguiente.
  Una venta firmada que **no llega a concretarse** (el cliente se retracta) se marca desde su propia
  fila en INGRESOS: `leads.deal_cancelled_at` / `_by` / `_reason`,
  `PATCH /api/finance/leads/:id/deal-cancelled` → `setDealCancelled()`. Se marca el **cierre** y no
  cada cuota porque el trato es del lead —ahí viven el precio total y el cronograma—, así que la
  decisión se escribe una vez: marcando fila por fila, basta olvidar una para que el cliente
  reaparezca en Cobranzas. Y **no se toca `finance_income.estado`**: lo ya verificado entró de
  verdad y sigue en los libros (una devolución es un egreso del Libro Diario, no un cobro que se
  borra), y deshacerlo es borrar la marca en vez de tener que recordar en qué estado estaba cada
  cuota. Los efectos se derivan en cada lectura, no se guardan: Cobranzas excluye esos leads
  (`whereNull('leads.deal_cancelled_at')` en `collectionService.list()`, y `summary()` lo hereda
  porque reusa `list()`) y la pestaña INGRESOS saca lo que ya no va a entrar de «Por cobrar» y lo
  muestra aparte como «No concretado» — el precio pactado no se reescribe, que es historia. Esa
  resta vive en `src/views/finance/dealCancellation.js` y no copiada en la tira de totales y en la
  banda de la fila, que son los dos sitios que la dicen. El `getOverview()` de Finanzas no cambia:
  ya contaba solo lo `verificado`.
  Desde el 16/11/2026 esos cierres **no se listan** en INGRESOS salvo que se pidan con el
  interruptor «🚫 Ver no concretados (N)» de la barra (`showCancelled` + `groupFilter` de
  `useLedgerTable`, que va aparte de los filtros de fila porque la marca es del CIERRE entero y
  porque no cuenta como «la tabla está filtrada», de lo que depende que los cierres se abran
  solos). Arranca apagado y **no se recuerda entre visitas**, al revés que la vista elegida de
  Entregables o del Setter Funnel: aquellas son dos maneras de mirar lo mismo, esto esconde filas,
  y un recorte que sobrevive a la recarga esconde sin que nadie lo haya pedido ese día.
  Y con eso **las cifras de arriba cuentan dos universos y no uno** (`summariseDeals()`, en el
  mismo archivo y con test): las del trato —precio total, registrado, verificado, por verificar,
  ITF, y el conteo de «Cierres»— cuentan solo lo que se está listando, porque sumaban también los
  caídos y entonces «Precio total» decía una cifra que no se podía comprobar sumando lo que había
  en pantalla (S/ 88.500 con S/ 26.900 de tratos que ya nadie espera); «No concretado» cuenta
  **siempre** los caídos, se vean o no, porque esconderlos es sacarlos de la lista de a quién
  cobrar y no olvidarse de que existieron — un recuadro que desaparece al esconder las filas
  convierte el dato en algo que solo se encuentra sabiendo que hay que buscarlo, de ahí que lleve
  el conteo de cierres y diga «fuera de la tabla». `porCobrar` se calcula **cierre por cierre** y
  por eso vale lo mismo con los caídos a la vista o escondidos (uno caído aporta cero): es lo que
  permite esconderlos sin mover la única cifra que de verdad se mira.
  **Marcar un cierre como no concretado no es un movimiento del funnel**: no toca `leads.status`
  ni deja rastro en `lead_stage_changes`, así que Ventas no lo ve pasar — es una decisión sobre el
  cobro, se toma desde Finanzas con `finance.view` y casi siempre la toma otra persona. Eso es lo
  que hay detrás de «nosotros no los movimos» (reporte del 16/11/2026); quién marcó cada uno lo
  contesta `backend/scripts/diagnosticarCierresNoConcretados.js` (solo lee), que además separa el
  caso que SÍ sería un fallo: un `deal_cancelled_by` en NULL, porque la ruta siempre escribe el id
  de quien aprieta el botón.
  Como el dinero puede nacer por cualquiera de esos tres caminos, **el cierre de venta no da por
  hecho que la plata empieza en él**: el modal lee primero lo ya asentado
  (`getLeadSettlement()`, `GET /api/leads/:id/win-preview`), lo muestra cuota por cuota y propone
  solo el saldo. Si las cuotas que ya existen cubren el precio total, el cierre **no registra otro
  ingreso** — solo gana el lead, abre su proyecto y adopta ese cronograma, poniéndole el marcador de
  pago inicial a la primera cuota (`ensureInitialPayment()`) para que el proyecto espere su
  verificación igual que cualquier otro cierre. Antes se pedía igual "el primer pago" y el alta
  chocaba contra `#assertWithinLeadTotal` ("supera el saldo pendiente de este lead: S/ 0.00"): un
  cliente que pagaba todo de una no se podía ganar. Las reglas de plata del cierre viven en
  `backend/services/winDeal.js` (`planWinDeal()`) y corren **antes** de mover nada: puestas después,
  como estaban, un monto que no cuadraba dejaba el lead ya ganado y su proyecto abierto pero sin
  ingreso, y el vendedor solo veía el error.
- **Una cuota pendiente avisa tres días antes de su fecha pactada**
  (`src/views/finance/dueSoon.js`: `DUE_SOON_DAYS`, `dueState()`, `nextDueState()`, con prueba
  propia). El cronograma guardaba `due_date` y la pantalla solo la escribía, así que una cuota que
  vencía pasado mañana se veía igual que una de marzo y había que abrir los cierres uno por uno
  para saber a quién llamar esta semana. Tres decisiones: **solo las `pendiente`** —una `pagado` es
  plata que el cliente ya mandó y está esperando el visto bueno, y pintarla de rojo manda a llamar
  a alguien que ya pagó—; la **vencida sigue roja y con el mismo rojo**, porque pasarse de la fecha
  no es salir del aviso sino la forma más grave de estar dentro, y lo que cambia es la frase
  («vence mañana», «venció hace 6 días»), que es de lo que depende cómo se encara la llamada; y la
  cuenta va en **días de calendario de Lima** (`limaToday()`) y no en horas, porque la fecha
  pactada es un día y no un instante — con el reloj del navegador en otra zona la cuota se pondría
  roja un día antes. El **color nunca va solo**: cada aviso lleva su plazo escrito al lado, porque
  el rojo y el ámbar son el mismo color con deuteranopía y de esta marca depende a quién se llama
  hoy. Se ve en los tres sitios que hablan de la misma cuota —la pastilla de estado, la fecha
  pactada del renglón y una insignia en la **cabecera del cierre**—, y lo tercero no es un adorno:
  los cierres están plegados de fábrica, así que un aviso que solo existe dentro de la fila solo lo
  encuentra quien ya fue a buscarlo. El de la cabecera sale del plan **completo** del lead
  (`plansByLead`) y no de las cuotas que pasaron los filtros, para que un recorte de fechas no
  esconda justo la que está por vencer, y un **cierre dado por caído no avisa**: perseguir ese
  cobro es lo que se dio por terminado.
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
  Tiene **dos pestañas sobre los mismos datos**: «Por cliente» (la lista de siempre, que contesta
  qué le falta a cada proyecto) y «Calendario» (un mes de lunes a domingo, que contesta qué toca
  esta semana — la otra mitad del trabajo, que obligaba a abrir las tarjetas una por una para
  descubrir las fechas). El calendario **no pide otra ruta ni calcula otro estado**: se arma sobre
  `visibleProjects`, así que los recuadros de estado y la búsqueda filtran las dos vistas por igual
  y los colores son los mismos de las tarjetas. Dos pantallas con dos criterios propios de "lo
  urgente" es como se llega a que cada una diga un número distinto. Una entrega se ubica en su
  **fecha pactada** (`due_date`) incluso ya entregada: el calendario es el plan, y ver cumplido el
  día que se prometió es justo lo que se revisa. Tocar un día lo abre debajo con las mismas
  tarjetas y el mismo botón de entregar, y los entregables **sin fecha** —que no caen en ningún
  día y desaparecerían sin que nadie lo note— se listan al pie, que es donde se les pone fecha.
  En el celular el mes se vuelve un mapa de números y puntos de color y el detalle se lee en el
  día abierto: el nombre de una entrega no entra en una celda de 50 px, y apretarlo para que entre
  deja texto cortado que no dice nada. La vista elegida se recuerda en `localStorage`
  (`entregables.view`), entre `try` porque en una ventana privada el acceso lanza.
- El **calendario de Entregables se cruza con una cuenta de Google**
  (`deliverableCalendarService.js`, `/api/deliverable-calendar*`, botón en la pestaña Calendario de
  `DeliverablesView.vue`, tabla `deliverable_calendar_connection` + tres columnas en
  `deliverables`). Son **dos sentidos y hacen cosas distintas**: **de ida** (el botón) las entregas
  del panel se escriben como eventos, y **de vuelta** (solo al abrir el mes) los eventos que el
  equipo ya tiene en ese calendario —los «Fecha Tentativa», los «PRE-AVISO», las reuniones— se
  **muestran** en la cuadrícula del panel. La vuelta **no importa ni guarda nada**: son de Google,
  y una copia en la base se desactualizaría sola y haría creer que el panel es dueño de eventos que
  no son suyos. La ida solo toca los eventos que creó él, así que apretar el botón no puede
  estropear el calendario de nadie — por eso puede ser un botón y no un proceso supervisado.
  Los eventos traídos **no son entregables**: van en `cell.events` y no en `cell.items`, en gris y
  sin estado, no cuentan en los recuadros de arriba ni en el resumen del mes, y no se pueden marcar
  como entregados. Mezclarlos haría que los totales dijeran una cosa y la lista otra. Para no verlos
  dos veces, lo que escribe el panel va marcado con `extendedProperties.private.avantage_entregables`
  y se filtra al leer: la marca viaja con el evento, así que lo reconoce aunque de este lado ya no
  quede rastro (una entrega borrada se lleva su id), y la lista de ids guardados cubre al revés los
  eventos creados antes de que la marca existiera. Un fallo de lectura **no rompe la pantalla**:
  vuelve con la lista vacía y el motivo adentro, porque las entregas son lo que esta vista tiene
  que mostrar sí o sí y los eventos de Google son una capa encima. Los días que ocupa cada evento
  los calcula `daysCoveredBy()`: el `end.date` de Google es **exclusivo** (sin restarle un día,
  cada evento de un día se dibuja en dos) y los que tienen hora se ubican por su día **en Lima**,
  que no es el del servidor.
  La cuenta es **una sola, de la empresa**, y no la de cada quien: el calendario de las entregas es
  uno —el que el equipo mira para saber qué toca esta semana— y con una conexión por usuario
  cambiaría según quién sincronizó último y nadie sabría en cuál mirar. Es el mismo patrón y las
  mismas razones que `deliverable_settings.notice_email`. Por eso vive en tabla propia y no en
  `google_calendar_connections`, que es la de cada asesor (`user_id` único, con su Meet y su
  disponibilidad colgando). El callback de OAuth es **uno solo** para las dos conexiones y cuál es
  cuál lo dice el `target` **firmado dentro del `state`** (`signGoogleOAuthState(userId, target)`):
  de él depende en qué tabla se guarda el token, así que no puede venir de algo que se pueda
  escribir a mano en la URL.
  Van **todas las entregas con fecha pactada**, las entregadas incluidas y marcadas con ✅: el
  calendario es el plan, y ver cumplido el día que se prometió es justo lo que se revisa — la misma
  regla por la que el calendario del panel ubica una entrega en su `due_date` aunque ya esté
  entregada. Son eventos de **día completo** (una entrega tiene día y no hora; ponerle una de las
  9:00 inventa una precisión que nadie acordó) y `end.date` es el día siguiente, porque en Google
  el fin de un evento de día completo es exclusivo y con el mismo día no se dibuja. Sin
  recordatorios ni invitados: son decenas de entregas y el calendario se mira, no notifica. Y
  **sin importes**, como todo el módulo: la cuota se nombra por su código.
  `deliverables.google_event_id` es lo que hace que sincronizar dos veces **actualice** en vez de
  duplicar, y `google_signature` —una foto de título, cliente, fecha y estado— lo que evita gastar
  una llamada por entrega que no cambió; de ahí que el botón apretado dos veces seguidas conteste
  "no hubo nada que cambiar" en vez de no decir nada. Un evento borrado a mano en Google **no es un
  error**: se vuelve a crear, que es lo que el panel afirma. Lo que sí se hace en el momento es
  quitar el evento de una entrega que se **borra** (`deliverableService.remove()`): el id vive en la
  fila, así que borrada la fila no hay forma de saber cuál era y en Google quedaría una entrega
  fantasma que ninguna sincronización va a limpiar — el barrido solo mira las filas que existen.
  Desconectar la cuenta **no borra los eventos** (lo que ya está en el calendario de la empresa es
  información que alguien puede seguir mirando; un botón que vacía un calendario ajeno es un botón
  que nadie aprieta), pero sí olvida los ids: sin cuenta no hay nada que actualizar. Cambiar de
  cuenta los olvida por lo mismo — los eventos viejos viven en el calendario anterior y sus ids no
  sirven en la nueva.
- El **gráfico de Flujo de Fondos** del Resumen (`OverviewTab.vue`, geometría en
  `src/views/finance/chartGeometry.js`) tiene tres reglas que vinieron de arreglarlo y no conviene
  deshacer: (1) la curva es **monótona** (Fritsch–Carlson) y no una spline Catmull-Rom — aquella se
  pasaba de los datos: entre un mes en cero y el siguiente dibujaba ingresos **negativos** y
  exageraba el pico, o sea el gráfico decía algo distinto de la tabla; (2) el eje sube a una cifra
  **limpia** (`niceAxisMax`) y no al máximo × 1.15, que daba "S/ 22.5k · 14.9k · 7.4k", números con
  los que no se estima nada; (3) el `viewBox` sigue al ancho **medido** del contenedor
  (`ResizeObserver`) en vez de ser fijo y estirarse con `preserveAspectRatio="none"`, que deformaba
  los trazos, convertía los puntos en óvalos y estrechaba la tipografía del eje. Los huecos
  laterales están medidos contra la etiqueta más larga posible; el gráfico **crece con la tarjeta**
  (antes tenía 250 px fijos y dejaba medio panel vacío); los dos colores tienen un paso **propio
  para el modo oscuro**, validados con el script de la guía de visualización contra cada fondo; y el
  texto del gráfico usa tokens de texto, nunca el color de la serie — la identidad la da el punto
  de color que tiene al lado. El último valor de cada línea va **escrito**: es la única cifra que se
  lee sin pasar el mouse, y es lo que releva el aviso de contraste de esos dos tonos sobre el fondo
  claro.
- El **ITF resta**: es la comisión que el banco cobra por cada transferencia, o sea dinero que
  nunca llegó a la cuenta (o que salió de ella). Se mostraba como una cifra suelta en cada pestaña
  sin descontarse en ningún lado, así que el Balance Neto en Caja daba de más. Entra en los egresos
  de `getOverview()` —con su propia línea en `egresosPorOrigen`, en la gráfica mensual y en la
  tarjeta de SU cuenta, porque el banco lo descuenta de esa cuenta y no de un fondo común— contando
  el **mismo universo** que el resto del resumen: ingresos `verificado` y asientos `pagado` en
  soles (el ITF de una cuota que no se verificó todavía no se cobró). Viaja en las MISMAS consultas
  agrupadas que ya suman esas filas, no en consultas aparte: dos consultas distintas terminan
  contando universos distintos. En el Libro Diario el **Neto** también lo descuenta; las columnas
  de Ingresos y Egresos no, porque son la suma de las filas y tienen que seguir cuadrando con ellas.
- El **ITF se propone, no se impone** (`resolveItf()` en `financeLedgerService.js`, usado por el
  alta y la edición de INGRESOS y del Libro Diario). La fórmula del Excel del área
  (`|monto| < 1000 ? 0 : INT(|monto|/1000) × 0.05`, en `calcItf`) sigue siendo el valor por
  defecto, pero el campo es editable: el banco cobra lo que cobra —cuentas exoneradas, traspasos
  entre cuentas propias, redondeos— y con el campo de solo lectura esa diferencia se quedaba fuera
  de los libros. Un `itf` **ausente, nulo o vacío** significa "calculalo"; un **cero escrito a
  mano** se respeta, porque es justamente el caso de la cuenta exonerada y tratarlo como ausente
  volvería imposible registrar lo que más justifica que el campo se pueda editar. En pantalla el
  campo sigue al monto **mientras nadie lo toque** (lo que hacía de solo lectura) y se congela en
  cuanto alguien lo corrige — recalcularlo por debajo le borraría la corrección a quien acaba de
  hacerla—; al abrir una fila para editarla, un valor que no coincide con la fórmula se considera
  corregido a mano. Por lo mismo, `replaceScheduleForLead()` recalcula el ITF **solo si el monto
  cambió**: el cronograma no tiene campo de ITF, así que recalcularlo siempre borraría la
  corrección por abrir el plan de pagos y guardarlo sin tocar importes. `calcItf` vive en
  `src/views/finance/incomeOptions.js` para todo el frontend (el Libro Diario tenía su propia
  copia, que podía quedar diciendo otra cosa).
- El **estado de un asiento del Libro Diario** (`finance_journal.estado`, `pagado`/`pendiente`) se
  cambia de un clic sobre su propia celda: la píldora de la tabla es un `<button>` y llama a
  `PATCH /api/finance/journal/:id/estado` → `updateJournalEstado()`. Va aparte del
  `PUT /api/finance/journal/:id` del formulario a propósito: ese pide el asiento entero (y pasa por
  multer porque admite comprobantes), y reenviarlo para cambiar una palabra reescribe de paso
  campos que nadie tocó — una fecha normalizada distinto, un ITF corregido a mano que el
  formulario vuelve a mandar. De ese estado cuelgan
  los totales de la pestaña (lo pendiente es dinero que todavía no se movió y suma aparte), así que
  el clic cambia las cifras de arriba y no solo el color; al volver se escribe **la fila en
  memoria** y no se recarga la tabla, que devolvería al usuario al principio de la paginación y
  volvería a bajar las miniaturas de los comprobantes. La píldora pulsable es `.pill` + `.pill-toggle`
  de `src/style.css` —no una copia en el `<style scoped>` de cada pestaña—, y `.pill-toggle` agrega
  **solo** el cursor y el realce: el color, el borde y la tipografía los sigue poniendo `.pill-*`,
  que es lo que la mantiene indistinguible de una píldora de solo lectura. La misma pareja la usa
  la pestaña de Salarios.
- Las **áreas de la empresa** del Libro Diario y las **cuentas** (bancos) de Finanzas se amplían
  desde el «＋ Agregar» del formulario del Libro Diario (`FinanceOptionAdder.vue`,
  `financeOptionService.js`, `/api/finance/options`). Las de fábrica siguen en el código
  (`BANCOS`, `DEFAULT_AREAS`) y no se pueden quitar; `finance_options` guarda solo las agregadas.
  Una cuenta nueva vale en **todo** el módulo —la validación de ingresos y asientos y el Resumen
  usan `loadBanks()`, y las pestañas leen el ref `bancos` de `incomeOptions.js`—: si la
  validación la aceptara y el Resumen no la conociera, su dinero contaría en el total y en ninguna
  tarjeta. Una cuenta con movimientos no se puede quitar (409); un área sí, porque es texto en cada
  asiento.
  Las tres rutas **sobreviven a que la migración no haya corrido** en ese entorno
  (`missingTable()`): el `GET` devuelve las listas de fábrica —la pantalla de Finanzas no se cae
  por una tabla que falta— y el alta y el borrado contestan 503 diciendo que falta `npm run
  migrate`, en vez de devolverle a la pantalla el SQL crudo («Table 'x.finance_options' doesn't
  exist»), que es lo que le llegó al equipo el 06/11/2026 y no le dice a nadie qué hacer.
- El **asiento del Libro Diario se carga en un modal** (`JournalTab.vue`): desplegado bajo la
  barra empujaba la tabla media pantalla hacia abajo —así que al guardar nadie veía la fila recién
  creada— y el botón de guardar quedaba al final de once campos, fuera de la vista; ahora vive en
  un pie fijo. Los campos van agrupados (movimiento · cuenta y estado · clasificación · detalle y
  respaldo) y **no se cierra al hacer clic afuera**, por la misma razón que la ficha del lead:
  adentro hay un asiento a medio escribir con sus comprobantes ya elegidos. Se cierra con la ✕,
  con «Cancelar» o con Esc —menos dentro del «＋ Agregar», donde Esc cierra solo ese panelito— y
  pregunta si hay algo escrito, comparando contra la foto que se toma del formulario **en el tick
  siguiente** al abrirlo: tomada antes, el `watch` que hace seguir el ITF al monto la deja
  desactualizada y un formulario recién abierto ya se considera tocado.
  **El signo del monto se elige y no se teclea**: la pantalla pide un importe en positivo y un
  «↑ Ingreso / ↓ Egreso» que decide el signo con el que se guarda en `finance_journal.monto`
  (que sigue siendo firmado, no cambió nada del esquema ni de la API). Un egreso anotado sin el
  menos entraba al libro como ingreso y desbalanceaba el neto sin que nada fallara a la vista.
  Debajo del campo se lee cómo va a quedar escrito, y al editar una fila el signo guardado es el
  que elige el selector.
- La pestaña **Salarios** de Finanzas (`finance_salaries`, `financeSalaryService.js`) es un
  registro de pagos al personal **sin llaves hacia la contabilidad**: no se relaciona con
  `finance_income` ni con `finance_journal`. Guarda la persona como texto libre (se paga a
  gente sin cuenta en el panel) y la fecha del pago es el dato que ordena la planilla. Cada fila
  tiene `estado` (`pagado`/`pendiente`) y el `monto` se guarda en **negativo** por ser un egreso
  (el formulario lo pide en positivo y `normalize()` le pone el signo).
  Desde el 16/10/2026 la planilla tiene **dos niveles**, en la MISMA tabla y no en una nueva: el
  **acuerdo** (`kind: 'acuerdo'`) es cuánto se le paga a quien consiguió el lead por ESE proyecto
  (`project_id`), y de él cuelgan sus **pagos** (`kind: 'pago'`, `parent_id`, CASCADE). Es la
  estructura que el equipo ya estaba escribiendo a mano en el campo de texto ("Pago del 40% del
  usuario Juan Diego"), y comparten persona, moneda, banco y comprobantes, así que partirlos en dos
  tablas obligaría a duplicar todo eso y a unirlas en cada lectura.
  **Un acuerdo no es dinero que salió**: es el compromiso, como la comisión de la setter, así que
  NO se descuenta en `getOverview()` — las cuatro consultas de salarios filtran `kind = 'pago'`, y
  contar el acuerdo además de sus pagos descontaría dos veces lo mismo. Lo que sí viaja a
  `totals.pendientes` son los pagos pendientes **más la parte del acuerdo que nadie repartió
  todavía**: sumar el acuerdo entero duplicaría la porción ya programada, y mirar solo los pagos
  escondería un acuerdo recién registrado, que es el compromiso más fresco.
  `kind` es **explícito** y no se deduce de que la fila tenga proyecto o hijos: de él depende qué
  plata resta en el Resumen, y una regla implícita ahí se rompe sola. El **porcentaje de cada pago
  no se guarda** (`percentOf()`): se deriva del monto sobre el acuerdo en cada lectura, por lo mismo
  que `is_locked` de un hito — corregido el acuerdo, un porcentaje guardado seguiría diciendo el
  viejo. A quién se le paga tampoco se pregunta: sale del **responsable del proyecto**
  (`resolveProjectOwner()`: el líder y, si todavía no tiene, el responsable comercial del lead —
  ese segundo paso es el que sostiene el alta desde el cierre, cuando el proyecto se acaba de abrir
  y nadie le asignó líder). Se escriben las DOS columnas, `user_id` y `persona`, por la misma razón
  que `leads.assigned_user_id`/`assigned_to`. Un proyecto tiene **un** acuerdo (409 si se repite):
  dos partirían los pagos en dos cuentas que no suman.
  Se registra por **dos caminos**: el botón de la pestaña y el campo opcional del modal de cierre
  (`POST /api/leads/:id/win` con `salaryAmount`), que es el momento en que el vendedor conoce el
  trato y le evita entrar a Finanzas —que además exige un permiso que no tiene por qué tener—. Ese
  segundo camino **no puede tumbar la venta**: si falla, el lead queda ganado, el proyecto abierto y
  el salario se carga después (misma regla que la comisión de la setter).
  **Sí resta en el Resumen Financiero**, desde el 16/10/2026 y por decisión del equipo: lo que sale
  por planilla es plata que sale, y sin ella el Balance Neto en Caja daba de más. Entra solo lo
  `pagado` y solo en soles, el mismo criterio que el resto de `getOverview()` — lo `pendiente` no
  salió de ninguna cuenta y viaja aparte en `totals.pendientes`. La tabla sigue sin llaves hacia la
  contabilidad: lo que se agregó es una **lectura** en `getOverview()`, no una relación.
- Los **documentos de marca** (cotización, contrato, comprobante de pago) comparten paleta, logo e
  iconos desde `quotationDocument.js`: si cambia la marca, cambian los tres juntos. El comprobante
  tiene además una versión **PDF** (`paymentReceiptPdf.js`, dibujada con `pdf-lib` en JavaScript
  puro porque el hosting compartido no corre un navegador headless): es la que se adjunta al correo
  del cliente y la que muestra la vista previa antes de enviarlo, así que lo que se ve es
  exactamente lo que se manda.
  Los datos de la empresa viven en `COMPANY` (en `quotationDocument.js`) y tiene **tres campos de
  domicilio y teléfono que no son intercambiables**: `address`/`addressCity` es el **domicilio
  legal** —el que firma el contrato (`domicilio_empresa`), el que da el bot y el que figura en la
  ficha RUC—, `offices` son las **sedes de atención** que se imprimen al pie de la cotización (LIMA
  y HUANCAYO), y `contactPhones` son los números que van en el encabezado del **contrato**, el
  documento que el cliente se queda y al que recurre para reclamar. Abrir una sede comercial no
  cambia el domicilio inscrito, así que pisar `address` con la dirección de Lima haría que el
  contrato dijera una dirección que no es la de SUNAT. El **RUC va en el encabezado** de la
  cotización y no solo al pie: es el dato con el que el cliente comprueba que la empresa existe, y
  al pie llega recén después de haber leído el precio. Los cuatro los guarda
  `__tests__/documentBrandData.test.js`, porque están escritos en el HTML y no en una tabla.
- La **celda de comprobantes del libro de Finanzas** es `ReceiptCell.vue`, compartida por INGRESOS,
  el Libro Diario, las dos filas de Salarios (el acuerdo y sus pagos) y Comisiones. Estaba copiada
  **cuatro veces**, idéntica hasta el último atributo, así que arreglar la miniatura en una dejaba
  las otras tres mostrando un pedazo del comprobante — y por eso la quinta pantalla que necesitó
  comprobantes no tuvo que escribir nada. Dos decisiones: la miniatura es **vertical** (46×60) y
  con `object-fit: contain`, porque un comprobante es la captura de un Yape o de una transferencia
  —siempre más alta que ancha— y en un cuadrado recortado al centro lo que se veía era una tira del
  medio, sin el monto ni la fecha ni a quién se le pagó (lo que el equipo reportó como «se ve
  cortado» en los pagos hijos); y el clic **abre un visor** teleportado al `body` en vez de una
  pestaña nueva, porque un comprobante se mira para comprobar un dato y después se vuelve a la
  fila. El enlace a la pestaña queda dentro del visor para quien lo quiera.
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
- El **buscador de los dos tableros** es `src/leadSearch.js` y **tolera tildes y dedazos**
  (Levenshtein): "Rodrigez" encuentra a "Rodríguez" y "castanida" a "Castañeda". Eso no lo hace más
  rápido —la distancia cuesta más que un `includes`—, así que el orden importa: primero la
  coincidencia exacta, que resuelve casi todo sin calcular nada, y la corrección solo sobre lo que
  no coincidió. El texto buscable de cada lead se normaliza **una vez** y queda en un `WeakMap`
  (con la concatenación cruda como firma, para que reasignar un lead —que reescribe `assigned_to`
  sobre el mismo objeto— no deje el índice viejo): sin eso, cada tecla volvía a quitarle las tildes
  a nueve campos de cada lead y una consulta de dos palabras sobre 2.000 fichas costaba ~95 ms por
  pulsación (ahora ~13 ms, y 2 ms cuando la coincidencia es exacta).
  **Los números no se corrigen**: una consulta de puros dígitos mira solo id, celular y documento, y
  por substring. En un teléfono un dígito de diferencia es otra persona, y un buscador que lo
  "corrige" muestra la ficha equivocada justo cuando alguien está por llamar. Tampoco se corrige
  nada de menos de 4 caracteres (con "ana" y una letra de margen entra media agenda).
  Los campos son los mismos en los dos tableros: antes cada pantalla tenía su lista —el de Ventas no
  miraba la universidad ni el canal, el del setter no miraba las notas— y el mismo texto encontraba
  cosas distintas según dónde se buscara.
- Las **etapas del Setter Funnel** son `setter_funnel_columns` (`setterFunnelColumnService.js`,
  `/api/setter-funnel-columns`, cliente en `src/setterFunnelColumns.js`), **tabla propia y no filas
  de `funnel_columns` con un campo "tablero"**: `loadSalesFunnelStatuses()` trata TODA clave de
  `funnel_columns` como "este lead ya es del closer" y `loadWinningStatuses()` toma las `final` como
  venta ganada, así que compartir la tabla haría que cada etapa que el setter cree graduara leads
  (sacándolos de su propio tablero y dejando al bot sin trabajarlos) y que su "Ganado / Cerrado"
  —`final` de fábrica— abriera proyectos y devengara comisiones. El precio de separarlas es un
  servicio más; el de unirlas, revisar cada lectura de `funnel_columns` que exista y las que vengan.
  Hasta el 16/10/2026 vivían en el `localStorage` del navegador y el tablero era de la **máquina**,
  no del equipo: la misma persona veía 7 etapas en una computadora y 4 en otra, con los mismos 17
  leads repartidos distinto. Y no era cosmético — arrastrar un lead escribe `leads.status` con la
  clave de la columna, que sí es compartida, así que un lead movido a una etapa que solo existía en
  una máquina caía en la primera columna de todas las demás ("si no coincide, ubicar en la primera
  columna", `SetterFunnelView.vue`). La migración siembra las 7 de fábrica y **rescata** las etapas
  huérfanas: toda clave que algún lead no graduado tenga en `status` y no sea de fábrica, ni de
  Ventas, ni un desenlace o bandeja, entra como "Etapa recuperada" — su nombre vivía en el navegador
  y se perdió, pero sin la columna esos leads se amontonarían en la primera sin que nadie sepa por
  qué. Por la misma razón `resetToDefaults()` conserva las etapas propias **que tengan leads**:
  restablecer es recuperar las de fábrica borradas, no vaciarle el tablero a quien tenga trabajo
  repartido. Borrar una etapa mueve primero los leads y recién después borra la columna (al revés,
  un borrado que sale bien con una reasignación que falla deja leads con un `status` que ya no es
  columna de nadie), y la clave de una etapa nueva la genera el **servidor**: dos personas creándola
  a la vez en dos máquinas es justo lo que esto vino a arreglar.
- El **Setter Funnel tiene dos vistas sobre los mismos leads** (conmutador en la cabecera,
  `viewMode` en `SetterFunnelView.vue`): el **tablero** por etapas, que contesta cómo va el funnel,
  y la **tabla**, que contesta a quién hay que llamar — la otra mitad del trabajo, que en el tablero
  obliga a recorrer columna por columna. Es el mismo recurso y las mismas razones que las dos
  pestañas de Entregables: la tabla **no pide otra ruta ni vuelve a filtrar por su cuenta**, se arma
  sobre `filteredLeadsByColumn`, así que la búsqueda, el canal, la viabilidad, el responsable y el
  rango de fechas de la barra filtran las dos por igual — dos listas con criterios propios es como
  se llega a que cada pantalla diga un número distinto. Cada fila recuerda la **columna en la que el
  tablero la ubica** y no el `status` crudo: un estado que no es ninguna columna cae en la primera
  (misma regla que el tablero) y el desplegable de etapa tiene que decir dónde está de verdad en vez
  de quedarse en blanco. Ese desplegable escribe por el mismo camino que arrastrar una tarjeta
  (`updateLeadStatusFromSelect`) y existe porque en una tabla no se puede arrastrar. La vista
  elegida se recuerda en `localStorage` (`setterFunnel.view`), entre `try` porque en una ventana
  privada el acceso lanza, y en el celular la tabla se vuelve tarjetas con los rótulos adentro
  (`data-label`), igual que Cobranzas.
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
- El módulo **Reporte de Leads** (`/admin/reporte-leads`, `LeadReportView.vue`, permiso
  `leads.report`, `leadReportService.js`, `GET /api/lead-report`) es esa misma bitácora leída de
  corrido: todos los leads con su trazabilidad —quién movió a cada uno, hacia qué etapa y en qué
  fecha y hora—, filtrable por persona (incluido el bot y el sistema), etapa actual, rango de
  fechas de los movimientos y "solo intentos bloqueados". **No tiene tabla propia**, como
  Cobranzas: inventarle una obligaría a escribir cada movimiento en dos lados, y el día que se
  separen nadie sabría cuál dice la verdad. Hasta ahora `lead_stage_changes` solo se podía leer de
  a un lead entrando a su ficha, así que "¿qué movió ayer cada persona?" se contestaba abriendo
  fichas de una en una.
  **La visibilidad es la del funnel y no una propia**: reusa `applyLeadVisibility()` —extraída de
  `getAllLeads()` justamente para esto— vía `leadService.visibilityQueryFor()`, así que el reporte
  no puede ser una puerta de atrás a los leads que alguien no ve en su tablero (`scope` viaja en la
  respuesta para que la pantalla lo explique en vez de parecer vacía por error). El permiso es
  propio porque es una herramienta de **supervisión**, no de trabajar leads, y la migración lo
  siembra a quien ya administra el área comercial (`leads.manage_all`).
  Dos reglas de la pantalla: (1) los **filtros eligen leads** (`whereExists` sobre la bitácora) y de
  cada uno se muestra la historia **completa** — media historia, justo la mitad que el filtro dejó
  afuera, es con lo que se saca una conclusión equivocada; (2) el **alta del lead es el primer hito**
  de la línea de tiempo, derivado en cada lectura de `created_at`/`created_by`/`source` y marcado
  con `derived: true`: la bitácora nace con su migración (26/10/2026), así que de los leads
  anteriores no tiene una sola fila, y una trayectoria que arranca en la nada se lee como una
  pantalla rota. Los nombres de etapa salen de `buildStatusLabeler()` en el servidor (la otra mitad
  de `buildStageResolver()`, la que no necesita un lead: `from_status` ya no es el de la ficha) para
  que el reporte, el tablero y la bandeja de WhatsApp digan lo mismo, y quién movió el lead lo
  nombra `actorLabel()` en un solo sitio, porque lo dicen la línea de tiempo y el desplegable que
  filtra por esa misma persona. El desplegable de actores sale de la bitácora y no del área
  comercial: ahí figuran el bot, los automatismos y la gente que ya no está en el panel —a quien se
  busca justamente cuando se investiga un movimiento viejo—, y no figura quien nunca movió nada.
  Los filtros y la paginación se resuelven en el **servidor** (25 leads por página, y los
  movimientos de esa página en UNA consulta, `listForLeads()`): filtrar en el navegador sobre lo
  cargado es "busca entre los primeros 25", y el movimiento que se viene a investigar es el que no
  está a mano.
  El reporte filtra además por **origen** —plataforma (Meta · TikTok · Orgánico · Referido · Otro)
  o canal (Formulario · WhatsApp · Mensaje directo), en un solo desplegable con las dos listas— y
  lo escribe en cada fila: un filtro cuyo resultado no se puede comprobar al lado no sirve para
  investigar nada. La respuesta sale de `leadOrigin()` y **no de un `where`**: de dónde salió un
  lead se contesta en un solo sitio, y escrita como SQL sería una segunda versión de esas reglas
  —el sello manda, el bloque más antiguo gana, el texto de `source` es el último recurso— que el
  día que se separen haría que el reporte dijera una plataforma y el exportable de Campañas otra.
  Por eso `#originIds()` resuelve el origen en JavaScript sobre el MISMO conjunto que los demás
  filtros ya eligieron y entra en la consulta como una lista de ids: así el total, la página y el
  resumen siguen mirando lo mismo. Es una pasada extra sobre los leads visibles y solo la paga
  quien usa el filtro. Los códigos del desplegable son las claves (`platform:meta`,
  `channel:whatsapp`) y no las etiquetas, porque viajan en la URL y un acento mal codificado
  dejaría el filtro sin coincidencias sin que nada falle a la vista; lo que no es uno de ellos
  vuelve como "sin filtro", igual que en `parseActor()`.
  Desde cada fila se abre también la **conversación de WhatsApp** del lead (`LeadConversation.vue`,
  el mismo componente de los dos tableros, en un modal): la bitácora dice que el bot lo congeló,
  pero no qué le escribieron, y hasta ahora eso obligaba a salir a buscarlo en otra pantalla. El
  botón sale siempre, incluso para un lead que no entró por WhatsApp —saber que nunca hubo
  conversación también es una respuesta, y averiguarlo antes costaría una consulta por fila—.
  **Leer** el hilo y sus adjuntos admite `leads.report` (se agregó al `requireAnyPermission` de los
  dos GET), y **escribir** no: responder y devolverle el chat a Avan siguen pidiendo los permisos
  de los tableros, porque supervisar no es trabajar el lead. No es una puerta de atrás —
  `requireLeadVisible` sigue decidiendo cuál se puede abrir—, y quien solo supervisa lo ve en modo
  lectura (`readonly`, sin cuadro de respuesta) en vez de recibir un 403 al apretar enviar.
  Y cada fila enlaza a **la ficha en su tablero** (`src/leadDeepLink.js`): el reporte mira los dos
  funnels a la vez, así que el destino lo decide `lead.stage.board` —el mismo dato con el que la
  fila escribe "Funnel de Ventas" o "Setter Funnel"—, y el enlace sale solo si esa persona tiene
  el permiso de ese tablero (`leads.view` / `setter.view`): sin él, el guard del router la mandaría
  al Dashboard sin decirle por qué. Las dos puntas del enlace viven en el MISMO módulo —armarlo
  acá y consumirlo allá— porque repartidas en dos pantallas, el día que cambie el nombre del
  parámetro el enlace sigue existiendo y simplemente deja de abrir nada, que es un fallo que nadie
  reporta. El `?lead=666` de los dos tableros es una **orden de una vez** y no el estado de la
  pantalla: se consume al cargar (`consumeLeadParam()`, después de `fetchAll()`) y se borra de la
  URL, porque dejándolo, cerrar la ficha y recargar la volvería a abrir y cualquier enlace que
  alguien copie después arrastraría un lead que ya no estaba mirando. Si ese lead no está en el
  tablero —cambió de etapa entre la carga del reporte y el clic, o no es de quien mira— el tablero
  lo dice en vez de no hacer nada.
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
  el menú se teletransporta al `body`: dentro de la tarjeta quedaría recortado. Por lo mismo, la
  **fecha de registro comparte renglón con el celular** en los dos tableros en vez de sumar una
  línea, y cuando falta espacio lo que se recorta es el celular —se reconoce por sus últimos
  dígitos— y no la fecha. Cómo se escribe vive en `src/leadCardDate.js` y no en cada vista: es la
  misma tarjeta del mismo lead, y con una copia por pantalla el mismo lead terminaría diciendo dos
  fechas distintas según desde dónde se lo mire. El año sale solo si no es el actual (en 52 px cada
  carácter compite con el nombre) y la fecha completa con la hora queda en el `title` y en la ficha;
  `limaDay()` está ahí también porque de él cuelgan los filtros "Registrado: desde / hasta", y con
  el huso del navegador un lead de las 23:00 cae en otro día.
- **Una persona es un lead, no uno por cada formulario que llena.** Los tres caminos que crean leads
  desde afuera cruzan primero por teléfono (`findByPhone`, por los últimos 9 dígitos) y cuelgan lo
  nuevo de la ficha que ya existe: el webhook de Meta (`attachMetaLeadToExisting`), el primer
  mensaje de WhatsApp (`findOrCreateFromWhatsApp`) y el **evaluador público**
  (`attachEvaluationToExisting`). El evaluador era el que faltaba: abría una ficha por cada vuelta,
  la nueva nacía en `nuevo` y, al indexar por teléfono, tapaba a la que el equipo venía trabajando —
  así un lead ya ganado aparecía en la trazabilidad de Campañas como "En espera de la reunión"
  (Rafael Anderson Gonzales Ureta: ficha ganada del 26/09 y gemela del 02/10). Al colgarse de la
  ficha existente se escribe deliberadamente poco: la viabilidad recién calculada y las notas al
  final. **No se toca el status** —eso es trabajo de `updateLeadStatus()` y haría retroceder a un
  lead cerrado— ni el tema ni los datos académicos que alguien pudo haber corregido a mano.
  Para los duplicados que ya existen, `esMejorLead()` en `campaignService.js` elige entre las fichas
  de un mismo teléfono: primero la que está **ganada**, después la que graduó, y recién al final la
  más reciente. "La más reciente" sola era un desempate razonable mientras la gemela era una ficha
  recién creada, y una moneda al aire en cuanto las dos graduaban.
  `backend/scripts/diagnosticarLeadCampana.js` (solo lee) imprime todas las fichas de una persona,
  de dónde salió cada una, cuál elige Campañas y por qué.
- **El alta manual tampoco carga a la misma persona dos veces.** El celular y el DNI son los dos
  datos con los que se reconoce a alguien, así que el formulario de alta manual (modal del Setter
  Funnel y ficha de la Base de Datos, los dos contra `POST /api/leads`) pregunta primero si ya hay
  un lead con ese celular —últimos 9 dígitos, el mismo `phoneMatchKey` del bot— o con ese documento
  (`dniMatchKey`: sin espacios, guiones, puntos ni barras, y admitiendo letras porque un carné de
  extranjería las tiene). La regla es `duplicateReasons()` en `leadService.js` —la consulta solo
  trae candidatos y esa función pura es la que decide— y el tope es
  `registerManualLead()`, que es **otro método** que `createProspect()`: por ahí siguen entrando los
  leads de Meta, donde un alta rechazada no se reintenta nunca y el lead se pierde en silencio (y el
  webhook ya cruza por teléfono antes de llamar, ver `persistMetaLead`). La ruta responde **409** con
  las fichas repetidas adjuntas.
  Editar la ficha pasa por el mismo tope (`updateLead()`, también 409): cambiarle el número a una
  para que coincida con otra es el mismo duplicado por otra puerta. Pero se miran **solo los campos
  que de verdad cambian** y no el estado final de la ficha: en la base quedaron gemelos de antes, y
  chequear el valor ya guardado haría imposible corregirle el nombre o el correo a uno de ellos — un
  tope que impide arreglar justo lo que viene a evitar.
  La pregunta se hace **sobre toda la tabla** y no sobre lo que el que carga puede ver: el duplicado
  que más daño hace es justamente el del lead que trabaja otra persona, que no le aparece en su
  tablero y por eso lo vuelve a cargar de buena fe. De una ficha ajena viaja un **resumen**
  (`findDuplicates()`: nombre, celular, documento, etapa y de quién es) y nunca el lead, y `visible`
  dice si además la puede abrir, para no ofrecerle un enlace que `requireLeadVisible` le va a negar.
  Desde ese modal se puede **eliminar la ficha repetida**, pero `deleteLead()` se niega si de ella
  cuelga trabajo (`deletionBlockReason()`: proyecto, cuotas de Finanzas, contratos, cotizaciones o
  comisiones; la ruta responde **409**). No es una precaución de más: `projects`, `quotes`,
  `sales_commissions`, las notas y el historial de etapas están en **CASCADE**, así que borrar el
  lead borra el proyecto con todo lo suyo; y `finance_income` y `contracts` están en **SET NULL**,
  así que las cuotas sobreviven pero se quedan **sin cliente** —desaparecen del cierre en INGRESOS y
  de Cobranzas y ya no hay forma de saber de quién eran—. Hasta el 16/10/2026 el borrado no
  comprobaba nada y el botón nuevo quedaba justo al lado de una ficha marcada "🏆 con proyecto". El
  motivo viaja al listado (`delete_blocked_reason`, calculado con la MISMA función que aplica el
  borrado, igual que `delivery_blocked` en Entregables) y se lee debajo de la fila, no solo en el
  título del botón: es lo que hay que saber ANTES de elegir cuál de las dos se borra. El botón sale
  solo en las fichas visibles —`requireLeadVisible` rechaza las ajenas y un botón que siempre falla
  es peor que no tenerlo— y el cálculo del trabajo colgante son **cinco consultas agrupadas para
  toda la lista** (`workloadByLead()`), no cinco por ficha.
  La ficha dice además **quién cargó el lead a mano** (`leads.created_by`, escrito solo por
  `registerManualLead()`; viaja como `created_by_name` y se muestra al lado del canal en el modal
  del Setter Funnel y en la ficha de la Base de Datos). No es lo mismo que el responsable comercial
  que figura al lado: ese se asigna aparte y el que reparte puede cambiarlo, así que sin el autor
  una ficha incompleta que apareció en el tablero no tiene a quién consultarle. Lo que entró por el
  bot, por Meta o por el evaluador **no tiene autor** y ahí la ficha calla: el canal ya dice de
  dónde salió, e inventar un nombre es peor que no decir nada. Es la misma columna y las mismas
  razones que la de la reunión cargada a mano en `scheduled_meetings`.
  En pantalla el aviso sale **mientras se escribe** (`GET /api/leads/check-duplicate`, el composable
  `src/leadDuplicateCheck.js` y el componente `LeadDuplicateAlert.vue`, compartidos por las tres
  pantallas que piden esos dos datos): un error recién al apretar "Registrar" llega después de haber
  tipeado la ficha entera. Pero el aviso **no es la regla** — si la comprobación falla no se bloquea
  el alta, y lo que impide el duplicado es el 409, que vale aunque el formulario estuviera abierto
  desde antes de que otra persona cargara ese contacto.
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
- **La atribución de Campañas tiene dos caminos y no uno** (`#buildAttribution()` en
  `campaignService.js`, con las reglas puras en `formContactsFromLeads()` y `dedupeAttribution()`):
  el `referral` de WhatsApp (el clic en el anuncio que abre una conversación) y los leads de
  **formulario instantáneo**, atribuidos por el `ad_id` que Meta manda junto al lead
  (`leads.meta_ad_id`). Hasta el 29/10/2026 era solo el primero, así que el formulario —que es la
  mayoría de lo que entra— no figuraba en ninguna hoja de Campañas: sus columnas de atribución se
  guardaban desde el webhook pero **nadie las leía**, y el reporte por anuncio contaba la mitad de
  los leads y la mitad del dinero de cada anuncio. El formulario entra por el **MISMO** campo
  `sourceId` —el "ID de origen"— que ya usaba el referral y no por uno nuevo: de `sourceId` cuelgan
  el mapeo a campaña, el funnel por anuncio, la trazabilidad y el exportable, y un campo paralelo
  obligaría a enseñarle los dos caminos a cada uno de ellos. El mapeo anuncio → campaña ya
  funcionaba para esto sin tocarlo: `metaAdsService` registra `String(ad.id)` entre los candidatos.
  Lo ubica en el tiempo `meta_created_time` —cuándo se envió el formulario en Meta— y no
  `created_at`: un lead que la conciliación rescató tres días después pertenece al día en que lo
  llenó, y mezclar las dos fechas es lo que impide que el reporte cierre contra el Administrador de
  anuncios. La misma persona por los dos caminos es **un** contacto y gana el de WhatsApp: contarla
  dos veces infla las conversaciones atribuidas y abarata el costo por lead, y así los números que
  el equipo ya venía mirando no se mueven — lo que esta mitad suma son los leads que no estaban en
  ninguna parte. Se le busca además su `wa_id` por los últimos 9 dígitos (si después escribió por
  WhatsApp, esa conversación es la suya) y la reunión se cruza también por `lead_id`, porque a un
  lead de formulario la cita se le carga desde su ficha y `scheduled_meetings.wa_id` queda en null.
  Un formulario **sin celular** entra igual, desduplicado por su id: es justo el lead incompleto el
  que además desaparecía del reporte.
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
  **Las respuestas del formulario se leen por patrón y no por la clave exacta de Meta**
  (`metaLeadFields.js` → `extractMetaLeadForm()`, usado por `persistMetaLead()` y por el backfill).
  En un formulario instantáneo clásico las preguntas prellenadas llegan con la clave canónica
  (`full_name`, `phone_number`, `email`), pero el formulario que se contesta DENTRO de Messenger o
  de Instagram arma sus preguntas propias y la clave es el texto de la pregunta convertido a slug
  (`cual_es_tu_numero_de_celular`). Buscando `fields.phone_number` a secas, de esos leads entraba
  solo el nombre —lo único que Messenger prellena— y la tarjeta quedaba en «Sin celular» con la
  universidad y la carrera en su valor por defecto, aunque Meta sí las hubiera mandado (caso real
  del 25/10/2026). Ahora la clave se normaliza (sin tildes, sin signos, guiones como espacio) y se
  busca por patrón, con tres cuidados: la universidad se resuelve ANTES que el nombre («¿cuál es el
  **nombre** de tu **universidad**?» tiene las dos palabras y lo que pide es la universidad), un
  documento nunca entra como celular aunque su pregunta diga «número» (el DNI peruano tiene 8
  dígitos), y como última red una respuesta de **9 dígitos o más** que no sea un documento se toma
  como celular se llame como se llame la pregunta. Lo que no cae en ningún campo de la ficha
  **tampoco se tira**: va al bloque de respuestas de `additional_notes` con el nombre de su
  pregunta — el equipo agrega preguntas al formulario sin avisarle al CRM, y una respuesta que no se
  guarda en ningún lado es una respuesta que la persona contestó para nadie. Un lead de formulario
  que igual llega sin celular deja un `console.warn` con las preguntas que SÍ vinieron: es lo que
  permite corregir el formulario (o el extractor) sin reproducir el caso.
  Para las fichas dadas de alta antes, el backfill (`runMetaLeadgenBackfill()`,
  `POST /api/leads/backfill-meta-fields`, botón «Completar datos del formulario» en el modal de
  Conciliación) vuelve a pedirle el `field_data` a Meta y rellena solo lo que falta. Un celular
  rescatado que ya pertenece a otra ficha **no se escribe**: se informa como conflicto, porque
  escribirlo deja dos leads con el mismo número — justo lo que `findByPhone()` existe para evitar.
  El token tiene que ser de **página**: uno de usuario de sistema pasa el `debug_token` como válido
  y con todos los permisos, pero falla toda llamada de alcance de página (ver `.env.example`).
  La conciliación contesta además las otras dos mitades de "¿llegaron todos?". **(1) Si Meta está
  avisando**: `checkSubscription()` → `subscriptionState()` lee `/{page_id}/subscribed_apps` y dice
  `conectado | sin_leadgen | sin_apps | desconocido`, porque las cuatro se arreglan distinto. Es la
  causa más silenciosa de leads perdidos: sin el campo `leadgen` suscrito Meta no llama al webhook,
  no hay error en ningún log y el CRM se ve igual que un día sin campañas, así que con eso roto
  "faltan 37" no es un fallo del webhook sino que el webhook nunca se llamó. La suscripción es de la
  app a la **Página** y no por formulario, así que cubre los formularios que existen y los que se
  creen después — esa pregunta se contesta una vez; lo que sí se revisa de a uno es si cada
  formulario activo entregó sus leads. Una app ajena suscrita a `leadgen` **no** cuenta como nuestra
  (los leads le llegan a SU webhook) y una respuesta sin `subscribed_fields` no se lee como
  suscrita: dar por bueno lo que no se comprobó es el peor diagnóstico posible. Leerla exige
  `pages_manage_metadata`, que el token puede no tener, así que el fallo viaja como dato y no
  tumba la conciliación — recuperar los leads perdidos no necesita ese permiso.
  **(2) Si cada lead entró con su anuncio**: `totals.sin_anuncio` cuenta los que están en el CRM sin
  `meta_ad_id` (`getMetaLeadgenIdsWithAd()`), que son las fichas anteriores a la columna de
  atribución — están en el CRM pero no figuran en Campañas, así que contarlas solo en `en_crm`
  daría por cerrada una comparación que no cerró. Se arreglan con el botón de completar datos del
  formulario, no volviendo a importar; lo que la conciliación acaba de traer no se reporta como
  incompleto porque la Graph API manda el `ad_id` junto al lead. Y los **formularios activos sin un
  solo lead** se listan aparte (`formularios_activos_sin_leads`): en una lista de treinta
  formularios, la mayoría viejos y vacíos, el que hay que ir a revisar se pierde entre los demás.
- Los leads de **formulario instantáneo de TikTok** (TikTok Lead Generation) se traen a mano con el
  botón «📥 Leads de TikTok» de Campañas (`tiktokLeadsService.js`, `GET`/`POST
  /api/campaigns/tiktok/leads` bajo `campaigns.view` o `leads.view`). Es la conciliación de Meta
  vista desde el otro lado: allá el webhook perdía leads en silencio y había que ir a buscarlos,
  acá **no hay webhook en absoluto** —TikTok no llama a nadie—, así que los leads se quedaban en el
  Centro de clientes potenciales de TikTok y el CRM nunca se enteraba de que existían. El síntoma
  (30/10/2026): la campaña «TT | WA | Asesor | 27Oct» marcaba 21 conversiones en el Ads Manager y
  su trazabilidad decía «todavía no hay contactos atribuidos a esta campaña».
  **Las respuestas las lee el MISMO extractor que las de Meta** (`extractMetaLeadForm` en
  `metaLeadFields.js`): las dos plataformas tienen idéntico problema —el nombre de cada pregunta no
  es estable, es el texto que escribió el equipo convertido a slug— y ahí ya están resueltas las
  reglas que costaron casos reales (la universidad antes que el nombre, un documento que nunca
  entra como celular, los 9 dígitos como última red). Copiarlas daría dos extractores que el día
  que alguien corrija uno dicen cosas distintas según de qué plataforma venga el lead. Por eso
  `leadFromRow()` entrega las respuestas con la forma del `field_data` de Meta (`{name, values}`):
  el adaptador va del lado de TikTok, no en el extractor.
  Las columnas de atribución son **propias** (`tiktok_lead_id`, `tiktok_page_id`, `tiktok_ad_id`,
  `tiktok_adgroup_id`, `tiktok_campaign_id`, `tiktok_created_time`) y no las `meta_*`: de
  `meta_leadgen_id` cuelgan la conciliación de Meta y el backfill, que le preguntan a la **Graph
  API** por cada id que encuentran, así que un id de TikTok ahí se reportaría para siempre como
  "falta en el CRM" y gastaría una llamada por lead contra la API equivocada.
  `persistTikTokLead()` es el **camino único** de alta (como `persistMetaLead`) y cruza por
  teléfono con `findByPhone()` antes de crear nada: acá pesa más que en Meta, porque estas campañas
  corren a la vez que las de Meta sobre el mismo público y el contacto que ya escribió por WhatsApp
  y además llenó el formulario de TikTok es el caso normal. Un lead ya importado no se vuelve a dar
  de alta (`getKnownTikTokLeadIds()` mira la columna **y** el marcador `[TikTok lead_id=...]` de
  las notas, que es el único rastro que queda cuando la ficha se colgó de otra), así que correr la
  importación dos veces no duplica a nadie. El `GET` solo compara y el `POST` importa, por la misma
  razón que en Meta: traer leads agrega gente al funnel que el equipo va a trabajar y a repartir.
  TikTok **no entrega los leads de una**: hay que pedir una tarea de descarga, esperar a que la
  prepare y bajar el archivo (CSV, con el JSON admitido por si la cuenta lo devuelve así). De ahí
  que el botón tarde unos segundos y que el CSV se parsee **de verdad** y no con `split(',')`: una
  respuesta de texto libre trae comas y comillas, y partir por coma rompe justo en el lead cuya
  respuesta era interesante. El permiso de **Lead Generation va aparte de Ads Management**: un
  token sin él sincroniza las campañas perfecto y no lee un solo lead, sin que nada falle a la
  vista — es el fallo más probable y el único que se arregla reautorizando.
  `backend/scripts/diagnosticarTiktokLeads.js` (solo lee) lo comprueba antes de tocar nada.
  Como consecuencia de que ahora SÍ hay algo que atribuir, `tiktokAdsService` **escribe
  `campaign_ads`**, cosa que antes no hacía a propósito. El `ad_source_id` va prefijado con `tt:`
  (igual que el `external_id` de la campaña) porque esa columna es ÚNICA y la comparten las dos
  plataformas, y los ids de anuncio de las dos son numéricos: sin el prefijo un anuncio de TikTok
  podría quedarse con la fila de uno de Meta y mandarle sus leads a la campaña equivocada. Por lo
  mismo `#resolveContactAd()` le quita el prefijo para buscar en las MÉTRICAS, que se guardan con
  el id pelado. La atribución entra por `#attributionFromTikTokForms()` con el mismo `sourceId` y
  la misma forma que los dos caminos de Meta (`TIKTOK_FORM_SPEC`), y la misma persona por varios
  caminos se cuenta UNA vez (`dedupeAttribution`): alguien que hizo clic en un anuncio de Meta y
  además llenó el formulario de TikTok es un contacto, y contarlo dos veces infla las
  conversaciones atribuidas y abarata el costo por lead de las dos campañas a la vez. El lead se
  ubica en `tiktok_created_time` —cuándo lo llenó en TikTok— y no en `created_at`: uno del 27 de
  octubre rescatado el 30 pertenece al 27, o el reporte no cierra contra el Ads Manager.
- **De dónde salió un lead se contesta en un solo sitio**, `backend/services/leadOrigin.js`
  (`leadOrigin(lead)`): plataforma (`Meta` · `TikTok` · `Orgánico` · `Referido` · `Otro`), canal
  (`Formulario` · `WhatsApp` · `Mensaje directo`), campaña, conjunto, anuncio, el id del lead en la
  plataforma y la fecha de ingreso. La respuesta vive repartida en tres juegos de columnas que
  escriben tres caminos distintos (`meta_*`, `tiktok_*`, `ctwa_*`) más el texto libre de
  `leads.source`, y cada pantalla que lo resolvía por su cuenta llegaba a una respuesta distinta:
  así la exportación de marketing terminó marcando como "Meta" hasta los leads de TikTok, con la
  venta de S/ 8.500 del 27/10/2026 acreditada a la plataforma equivocada. **"Meta" no es el valor
  por defecto de nada**: lo que no se reconoce es `Otro`, porque un origen que no se sabe tiene que
  poder contarse como tal en vez de abultar el de una plataforma que quizá no lo trajo.
  Tres reglas que vinieron de arreglarlo: (1) **los NOMBRES se copian de la API al entrar el lead**
  (`meta_ad_name`, `tiktok_campaign_name`, …) y no se resuelven después contra las métricas
  sincronizadas de la campaña, donde solo están los anuncios que siguen entregando — un anuncio
  pausado o borrado dejaba al lead como "Sin campaña asignada" teniendo su `ad_id` guardado; el
  enlace sigue siendo por **id**, así que un nombre que cambie en la plataforma no rompe nada y el
  guardado es el que ese lead tuvo. (2) **La atribución de un Click-to-WhatsApp vive en el lead**
  (`ctwa_ad_id`, `ctwa_clid`, `ctwa_source_type`, `ctwa_headline`) y no solo en el `referral` del
  primer mensaje: el webhook responde 200 ANTES de procesar, así que un primer mensaje que no se
  guardó se llevaba el único rastro del anuncio y el contacto pasaba por orgánico — de ahí
  `CTWA_LEAD_SPEC` en `campaignService`, que recupera a esos contactos desde su propia ficha y va
  último en el desduplicado (cuando el mensaje sí está, gana la fila de `whatsapp_messages`, que
  trae además el titular y la conversación). (3) Los ids viajan como **texto**: son números de 15 a
  17 dígitos y cualquier paso por `Number` les cambia los últimos o los pasa a notación científica.
  El prefijo `tt:` es interno del CRM (`campaign_ads.ad_source_id` es única y la comparten las dos
  plataformas) y `bareSourceId()` lo quita antes de publicar el "ID de origen", que es lo que se
  compara dígito por dígito contra el Ads Manager.
  La atribución **no se edita desde ninguna pantalla**: `updateLead()` tiene lista blanca y esas
  columnas no están en ella. Un id de anuncio corregido a mano es un lead acreditado a una campaña
  que no lo trajo, y de esos números cuelga el presupuesto. Lo que sí es libre es `source`, el canal
  escrito a mano de un lead que no vino de un anuncio.
- **Coincidir no es identificar.** El origen de un lead es un **sello**
  (`leads.origin_platform`), escrito una vez al nacer la ficha y nunca reescrito, y queda asentado
  con qué evidencia se lo supo (`attribution_method`, `attribution_confidence`,
  `attribution_reconciled_at`). La regla vive en `backend/services/attributionEvidence.js`
  (`resolveMatch()`, `writesAttribution()`, `demoteLaunderedMarker()`).
  Vino de un error que corría solo: la importación de TikTok, cuando no encontraba la ficha por el
  `lead_id` del envío, la buscaba por los **últimos 9 dígitos del teléfono** y con eso le escribía
  campaña, grupo y anuncio. Como `leadOrigin()` preguntaba por las columnas `tiktok_*` **antes** que
  por las demás, esa ficha pasaba a ser "TikTok" en todas las hojas de marketing y tapaba su origen
  real; y la conciliación diaria corre con `apply: true`, así que eso se escribía sin que nadie lo
  mirara. Que TikTok reporte 21 leads y el CRM tenga 21 fichas del mismo corte **no empareja ninguna
  de las 21 con ninguna de las otras**.
  Solo la evidencia **independiente** habilita escribir la atribución: el id que la plataforma
  emitió para ESE envío (`tiktok_lead_id`, `meta_leadgen_id`), su marcador en las notas, o la
  recepción del webhook. El teléfono sigue sirviendo para **no duplicar a una persona**, que es otro
  problema: dos fichas de la misma persona son un estorbo, una ficha con la plataforma equivocada es
  un presupuesto mal repartido. Con el teléfono como única evidencia el envío se cuelga de la ficha
  —el marcador en las notas, que es lo que impide volver a darlo de alta en cada pasada— y la
  atribución **no se escribe**. El `tiktok_lead_id` está gateado como el resto a propósito: de esa
  columna cuelga el bloque de TikTok de `leadOrigin()`, así que escribirla ES atribuir.
  `demoteLaunderedMarker()` cierra el camino que lavaba la evidencia débil: un envío colgado por
  teléfono deja igual su marcador, y en la corrida siguiente ese marcador se encontraría como
  evidencia ALTA — el teléfono habría atribuido el lead dos días después y por la puerta de atrás.
  La ficha recuerda con qué se la emparejó y una confianza baja no se asciende sola.
  **Las coincidencias ambiguas no se asignan: se anotan.** `findAllByPhone()` devuelve TODAS las
  candidatas (y no la que gana el `ORDER BY`, que entre dos personas con el mismo sufijo es una
  moneda al aire); con más de una no se toca ninguna ficha y el caso va a `attribution_conflicts`
  (`attributionConflictService.js`, `GET /api/attribution/conflicts`,
  `PATCH /api/attribution/conflicts/:id/resolve`) con las candidatas, el motivo
  (`multiple_phone_match` · `phone_only_match` · `origin_conflict`) y el **payload** del envío —la
  atribución y las respuestas del formulario—, porque TikTok conserva los leads de un formulario
  solo 90 días y después ya no hay a quién volvérselos a pedir. Tampoco se abre una tercera ficha:
  la persona ya está en el funnel (por eso hay fichas que coinciden) y lo único pendiente es de qué
  anuncio salió. El registro es **idempotente** por (plataforma, id del envío) y no reabre un caso
  ya resuelto: la conciliación diaria vuelve a encontrarlo en cada corrida mientras nadie lo
  resuelva, y una fila por día es la forma más común de que una lista de pendientes deje de mirarse.
  Resolver **no escribe la atribución** —eso se hace sobre el lead, con método `manual`—: asienta que
  alguien lo decidió y quién.
  Los pendientes se cuentan **aparte de los fallidos** en el reporte de la importación y en el
  resumen del barrido diario (`totals.pendientes`): no falló nada, falta decidir, y mezclarlos hace
  que un pendiente se lea como un error del que no hay que hacer nada.
  `leadOrigin()` cambia en consecuencia: lo que llegó después del sello se informa en `secondary` y
  la ficha queda marcada con `conflict: true` en vez de que la columna nueva reescriba la historia.
  Sin sello —las fichas anteriores a la migración, que el backfill sella con el MISMO
  `leadOrigin()` y no con una copia de sus reglas— gana la evidencia **más antigua**, que es lo más
  cerca de "cuál fue primero" a lo que se puede llegar sin preguntarle nada a nadie.
- La hoja **"Ruta de leads"** del exportable de Campañas es un **contrato con marketing**: su
  importador busca las columnas por el **nombre del encabezado** (sin distinguir mayúsculas ni
  tildes), así que renombrar una la deja fuera del reporte sin que nada falle a la vista. Lleva una
  fila por lead —**atribuido o no**: la pregunta que contesta es de dónde salió cada lead, y con
  solo los de campaña no se puede comprobar que ninguno se haya quedado sin plataforma—. Los leads
  no atribuidos se enriquecen por el MISMO camino que los atribuidos (`#nonAttributedContacts()` +
  `#enrichContacts()`), así que su etapa, su cita y su dinero se calculan con las mismas reglas:
  dos criterios para lo mismo es como se llega a que cada mitad de la hoja diga otra cosa. Dos
  reglas de redacción, y la diferencia importa: **`-` es "acá no hay nada que poner"** (un lead
  orgánico no tiene anuncio) y **`sin dato` es "esto vino de un anuncio y el dato falta"**, que es
  lo que marketing va a buscar y nunca trata como cero.
  La hoja publica además **con qué evidencia** se supo cada origen —«Fuente de atribución»,
  «Confianza de atribución», «Conciliado» y «Plataforma secundaria»— y la **versión del esquema**
  (`LEAD_TRAIL_SCHEMA_VERSION`, hoy 3), por fila y no en una celda al margen: una fila copiada a
  otra herramienta tiene que poder decir sola con qué esquema se generó, y sin la fuente la hoja
  afirma una plataforma sin dejar comprobar cómo se llegó a ella.
  Y hay una tercera convención, que es de dinero: **`0` es "no entró nada" y `sin dato` es "no se
  puede saber"**. Un contacto sin ficha en el CRM no tiene cobros que consultar, y escribir «S/ 0»
  de él afirma que no pagó nada cuando lo que pasa es que no lo sabemos — con eso se apaga un
  anuncio que sí vendía. En el agregado por anuncio la diferencia viaja como `sinFicha`, el conteo
  de contactos cuyo dinero no se puede sumar: una suma no puede sumar un desconocido, y sin el
  conteo el total se lee como completo cuando puede no estarlo. La clave de agrupación por anuncio
  lleva la **plataforma** adelante, porque los ids de Meta y de TikTok son los dos numéricos.
- La **calificación comercial** es un dato propio en TRES estados (`leads.qualified`, vacío por
  defecto; `PATCH /api/leads/:id/qualified`, `LeadQualification.vue` en la ficha de los dos
  tableros). Antes se **derivaba** de que el lead hubiera salido de `nuevo`, con lo que decía "Sí"
  en 403 de 403 leads y no servía para medir la calidad de ningún anuncio, que es justo para lo que
  se la mira. El vacío es información —separa al lead que nadie revisó del revisado y descartado—, y
  un "No" por defecto haría el mismo daño con el signo cambiado. La pone una **persona** y nunca un
  automatismo (es un juicio sobre el contacto, no algo que se deduzca de por dónde pasó la
  tarjeta), queda escrito quién y cuándo, y el **criterio va escrito y a la vista**
  (`src/leadQualificationCriteria.js`, un solo sitio para las dos pantallas): de esa marca cuelga la
  decisión de cortarle el presupuesto a un anuncio, y dos personas calificando con criterios
  distintos la vuelven tan inútil como cuando decía "Sí" siempre. Va aparte del `PUT /api/leads/:id`
  del formulario por lo mismo que la píldora de estado del Libro Diario. No toca el funnel.
- **La etapa de cita avisa si le falta su reunión, pero no frena.** Un lead en `cita_agendada` sin
  una reunión no cancelada en `scheduled_meetings` es una cita sin fecha ni hora: el closer no la ve
  en su Calendario, el bot no manda el recordatorio y el embudo cuenta una cita que nadie puede ir a
  buscar. Entre el 01 y el 02/11/2026 eso se frenó con un 409 y **frenaba de más**: la reunión se
  carga con "Agendar reunión", que exige `calendar.view`, y el setter puede no tenerlo — con lo que
  el pase le quedaba cerrado sin nada que pudiera hacer al respecto. Ahora el movimiento se hace
  siempre y lo que queda es el **rastro**, que es lo que de verdad hacía falta: sin él, "cita con
  reunión" y "cita sin reunión" se escriben igual en la columna y no hay forma de separarlas después.
  Son tres piezas y una sola pregunta: `activeMeetingForLead()` (en `scheduledMeetingService.js`) la
  contesta para todos; `updateLeadStatus()` escribe el motivo en `lead_stage_changes` y devuelve
  `appointment_without_meeting` **derivado en cada lectura**, nunca guardado —en cuanto alguien
  cargue la reunión deja de ser cierto, igual que `is_locked` de un hito—; y las pantallas avisan con
  eso. Al **bot no se le pregunta**: llega ahí después de reservar el bloque, así que para él la
  reunión existe siempre. Y solo al ENTRAR a la etapa: un lead que ya estaba ahí se mueve a donde sea
  sin que esto opine. El pase manual al closer del Setter Funnel ("ya coordiné la reunión por mi
  cuenta") pregunta antes por `GET /api/leads/:id/meeting` y lo advierte en el propio diálogo —si esa
  consulta falla **no** se avisa, porque un aviso que nombra un problema inexistente enseña a
  ignorarlo—; arrastrar una tarjeta o usar el desplegable lo dice después, en el aviso de la barra y
  no en un `alert`: mover tarjetas es trabajo en serie, y un diálogo por tarjeta se aprende a cerrar
  sin leerlo.
- **"A este lead ya se le contestó" es una columna** (`leads.first_response_at` / `_by`) y no una
  consulta sobre la tabla de mensajes. Se escribe sola desde los dos caminos por los que de verdad
  se contesta (`leadFirstResponse.js`): cualquier saliente de WhatsApp —lo mande Avan, una persona
  desde el panel o un asesor desde la app de WhatsApp Business vía el eco— y la **primera nota de la
  ficha**, que es el único registro que deja una llamada (el teléfono no pasa por el sistema). El
  cálculo anterior vivía solo en el exportable y miraba el primer saliente de la conversación, así
  que dejaba fuera a los leads que son el problema: el de formulario que nunca escribió por WhatsApp
  no tiene conversación, y no se podía distinguir "no se le contactó" de "se le llamó y nadie lo
  registró" (12 de los 22 leads de "FORM | contrato | 25Oct", 31/10/2026). Nunca pisa la marca
  existente —interesa la PRIMERA— y nunca puede tumbar un envío. Pasadas 24 h sin respuesta la
  tarjeta de los dos tableros muestra un reloj (`src/leadFirstResponse.js`,
  `needsFirstResponse()`): va como marca en el renglón del nombre y no como línea propia porque la
  tarjeta tiene alto fijo, y un lead con proyecto abierto no avisa — el aviso sirve para perseguir
  lo que falta, no para auditar el pasado.
- En el reporte de Campañas, **"Cobrado" es lo `verificado`** y no lo `pagado`: de los tres estados
  de una cuota, `verificado` es el único que suma en los libros de Finanzas (`ESTADOS_INGRESO`) —
  `pagado` es "el cliente dice que pagó y Finanzas todavía no dio el visto bueno". Contando `pagado`
  el reporte sumaba dinero que podía no haber llegado y dejaba FUERA el confirmado, así que el
  ingreso y el ROAS por anuncio no coincidían con el Resumen Financiero. Por lo mismo `isWonLead()`
  tiene un **tercer camino**: un lead con una cuota verificada es una venta cerrada aunque su
  tarjeta se haya quedado sin mover (la plata es el hecho más difícil de discutir de los tres), y
  sin él la hoja mostraba dinero cobrado en una fila cuya etapa decía "cotización" — S/ 2.300 en
  "Acompañamiento 17 Sep" con cero leads en Ganado. El lead que todavía no se ganó y YA tiene
  cronograma registrado se nombra **"Cuota pactada"** en la hoja: el precio está acordado y el
  dinero no entró, y sin ese nombre se confundía con una cotización. Esa etiqueta es solo de la
  hoja: los cuatro cajones de `crmStage` con los que se cuentan los leads por anuncio siguen siendo
  cuatro, porque su suma tiene que ser el total de leads del anuncio.
- **La conversación de WhatsApp que se quedó sin ficha se recupera sola, cada diez minutos**
  (`orphanConversationService.js` + la tercera pata de `leadReconciliationSweep.tick()`). Guardar el
  mensaje entrante y abrir la ficha son **dos escrituras del mismo webhook**, que ya respondió 200:
  si la segunda falla no se reintenta nunca y lo que queda es una persona que escribió, a la que el
  bot hasta le contestó, y que no figura en ningún tablero — un contacto perdido no falla,
  simplemente no está. El servicio y los dos scripts existían desde el 02/11/2026 (ocho
  conversaciones así) y dependían de que **alguien los corriera**, o sea el mismo botón de las otras
  dos conciliaciones: el 09/11/2026 apareció otra, y se descubrió igual que la primera vez, porque
  alguien buscó a mano a UN contacto que no encontraba. Corre en **cada vuelta** del temporizador y
  no a las 07:00 como las de anuncios —a un contacto sin ficha no lo ve el setter, así que esperar
  al día siguiente es perderle el día en que escribió—, y puede hacerlo porque no le pregunta nada a
  ninguna API de afuera y porque adoptar es idempotente (`findOrCreateFromWhatsApp()` cruza por
  teléfono antes de crear). La corrida diaria repite el repaso con la ventana de **30 días**, que es
  la red para lo que quedó atrás con el proceso caído; la frecuente mira **2 días**, y al **arrancar** el proceso se hace el repaso del mes una vez
  (`catchUpOnStart()`): la primera vuelta del temporizador llega recién a los diez minutos y mira
  dos días, así que sin eso un despliegue hecho para recuperar un contacto no recupera nada — y es
  en ese rato cuando se lo juzga. Es el mismo sondeo inicial que ya hacía `pageFollowerService`.
  Adoptar usa el
  MISMO camino del webhook y no un `insert` propio: de ahí cuelgan el sello de origen, la evidencia
  y el reparto, y si ese camino está roto —la causa más probable de que haya huérfanas— el error se
  ve tal cual, que es lo que hace falta ver.
- **Una ficha borrada a mano no vuelve sola** (`lead_deletions`, `wasDeletedOnPurpose()`). Es la otra
  cara de lo anterior: desde que el barrido adopta solo, "la ficha nunca se abrió" y "alguien la
  sacó a propósito" se ven **igual** —conversación sí, ficha no— y se resuelven al revés, así que
  sin distinguirlas borrar un lead cuya conversación sigue en la bandeja lo haría reaparecer a los
  diez minutos. Lo que las separa es la **fecha**: el borrado tapa lo anterior a él y nunca lo
  posterior, de modo que un contacto que vuelve a escribir después recupera su ficha igual — eso es
  actividad nueva, y es lo mismo que haría el webhook con ese mensaje. `deleteLead()` escribe el
  rastro **leyendo la ficha antes de borrarla**, que es el único momento en que se puede (sus notas,
  su historial de etapas y sus comisiones están en CASCADE), y nunca puede tumbar el borrado: si la
  tabla no existe todavía en ese entorno, el lead se borró igual y queda dicho en el log. La tabla
  es además lo único que queda de un lead borrado —misma idea y misma forma que
  `whatsapp_conversation_deletions`—, no una papelera: guarda con qué se lo reconoce y quién lo
  borró, no la ficha entera. Las conversaciones salteadas por este motivo se **cuentan aparte**
  (`borradas`) en el barrido y en los dos scripts: "no había nada que recuperar" y "había tres y las
  habían borrado" son dos respuestas distintas.
- **En el Reporte de Leads, un número se busca por sus dígitos** (`applySearch()` +
  `PHONE_DIGITS_SQL`). El filtro hacía `LIKE '%982768859%'` sobre la columna cruda y no encontraba al
  lead guardado como "+51 982 768 859" —el formato con el que entra el formulario de Meta, o sea la
  mayoría—: los espacios caen justo en medio de lo que se buscó. Los dos tableros ya buscaban por
  dígitos (`src/leadSearch.js`), así que el mismo número aparecía ahí y no acá, y de las dos
  respuestas la del reporte es la que manda a revisar el webhook por un lead que estaba todo el
  tiempo. Una consulta de puros dígitos mira **solo** id, teléfono y documento —los dos últimos sin
  separadores—, que es la regla que ya tenían los tableros; la búsqueda por texto no cambió.
  `PHONE_DIGITS_SQL` está aparte de `PHONE_MATCH_KEY_SQL` porque son dos preguntas distintas sobre
  el mismo teléfono: "¿es la misma persona?" se contesta con los últimos 9 dígitos, "¿contiene lo
  que escribí?" no — quien busca teclea un pedazo, y recortar a nueve antes de comparar deja fuera
  la mitad de los casos.
- **Las dos conciliaciones corren solas una vez al día** (`leadReconciliationSweep.js`, colgado del
  barrido de diez minutos que ya existía; `LEAD_RECONCILIATION_HOUR`, 07:00 de Lima por defecto).
  Recuperar leads dependía de que alguien apretara un botón, y así se perdió el 39% de los leads de
  formulario de Meta de septiembre de 2026 (95 en el Administrador de anuncios contra 58 en la base)
  sin que nada fallara a la vista: un lead perdido no falla, simplemente no está — y Meta solo
  conserva los de un formulario **90 días**. Tres decisiones: **importa y no solo reporta** (un
  informe que nadie mira es el mismo botón con otra forma, y las dos importaciones son idempotentes
  porque cruzan por el id del lead en la plataforma y por teléfono antes de crear nada); mira una
  **ventana de tres días** y no solo el día de ayer, así el día que falle lo cubre el siguiente; y el
  fallo de una plataforma **no detiene a la otra** (son dos APIs con dos tokens, y el permiso de Lead
  Generation de TikTok se cae solo). El día se marca como corrido ANTES de empezar, para que un
  token rechazado no deje el barrido reintentando cada diez minutos. Los botones de cada
  conciliación siguen existiendo para cuando hay que mirar el detalle ahora mismo.
  La importación de TikTok, además, **completa las fichas que ya están en el CRM** a las que les
  falta atribución (`#completeAttribution()`, cuenta `completados`): los 21 leads del 27 al 31/10
  entraron con los ids y sin los nombres, y traer solo lo que falta por entero dejaría a medio
  arreglar justo lo que se vino a arreglar. Solo escribe los huecos. El backfill de Meta
  (`runMetaLeadgenBackfill()`) hace lo mismo con la atribución histórica preguntándole a la Graph
  API; lo que Meta ya no devuelve queda en "sin dato" y no se inventa.
- **Una conciliación tiene cinco cajones, no dos** (`backend/services/reconciliationBuckets.js`,
  compartido por las conciliaciones de Meta y de TikTok). Las dos reportaban «en la plataforma»,
  «en el CRM», «faltantes» y «fallidos», y con eso una diferencia nunca se terminaba de explicar:
  «faltan 37» podía ser 37 leads perdidos, o 12 **duplicados** que la plataforma devuelve dos
  veces, 9 **reingresos** —personas que ya estaban en el CRM de antes del corte y volvieron a
  llenar el formulario—, 6 **inválidos** sin un dato con el que llamar a nadie y 10 **retrasados**
  entregados fuera de su propio corte. Cada uno se arregla distinto y tres de los cinco **no se
  arreglan: están bien así**. Mezclados, la conciliación produce una alarma que nadie puede cerrar
  — y una alarma que nadie puede cerrar se deja de mirar.
  Los cajones son **excluyentes y ordenados por prioridad**, y eso es una propiedad y no un
  detalle: su suma tiene que ser el total de envíos del corte, que es lo único que permite afirmar
  que la comparación cerró. El duplicado va primero (si no, un envío repetido y sin teléfono se
  contaría dos veces), el retraso antes que el reingreso (lo que define al retraso es CUÁNDO se
  envió, no si la persona ya estaba), y una ficha creada **dentro** del corte no vuelve reingreso a
  su propio envío — eso esconderría el alta que sí ocurrió. El módulo es **puro** y repite
  `phoneKeyOf` en vez de importar `leadService`, con un test que lo compara contra `phoneMatchKey`:
  el día que se separen, un envío se clasificaría como nuevo y después se emparejaría con una ficha
  existente. Los dos conjuntos de «ya visto» son de la **corrida** y no del formulario: un mismo
  envío puede venir en dos formularios. En Meta el envío anterior al corte se **cuenta y recién
  después se saltea** (antes `inRange` lo descartaba en silencio, así que un formulario entregado
  tarde no aparecía en ninguna cifra).
  **Y el reporte dice qué universo cuenta cada cifra** (`COMPARABILIDAD`, en la respuesta y no solo
  en un comentario): el campo «conversiones» del Administrador de anuncios **no** cuenta envíos de
  formulario —cuenta el evento de conversión configurado en la campaña, que puede ser un clic, un
  mensaje iniciado o una compra—, así que exigir que el CRM dé ese mismo número manda a buscar
  leads que nunca existieron. Para comparar contra el Ads Manager se mira su reporte de clientes
  potenciales del formulario, no la columna de conversiones de la campaña.
- **WhatsApp tiene tres niveles y no uno** (`isNewOpportunity()` en `campaignService.js`):
  «Conversaciones (Meta)» es el **evento atribuido** —cualquier clic que abre el chat, siempre el
  número más grande—, «Conversaciones atribuidas (CRM)» es la **conversación entrante** que el CRM
  reconoce, y «Personas nuevas (CRM)» es la que trajo a alguien que **no estaba**: la ficha nació
  de esa conversación. Sin el tercero, el costo por conversación se lee como costo por persona
  nueva, y un anuncio de retargeting —que por definición le habla a quien ya está en la base—
  parece tan eficiente como uno que trae gente nueva. Los tres se publican juntos para que la
  brecha entre ellos se pueda explicar en vez de discutir. El margen de cinco minutos existe
  porque las dos marcas de tiempo las escriben caminos distintos (el webhook y el alta), así que
  comparar por igualdad contaría como «ya estaba» a quien acaba de llegar; un lead de formulario
  que después escribe por WhatsApp queda del lado correcto, porque entre el formulario y el mensaje
  pasan minutos u horas.
- **Un puente de datos se describe a sí mismo** (`backend/services/bridgeContract.js`,
  `bridgeEnvelope()`, `pageCapNotice()`, `listCapNotice()`). Todos los puentes del CRM tenían el
  mismo agujero: **recortaban en silencio**. `forms.slice(0, MAX_FORMS)` cortaba a 100 formularios
  en la importación de TikTok; `listForms()` de Meta corta a `MAX_PAGES` páginas de la Graph API y
  si quedaba un `paging.next` los formularios que seguían no existían para la comparación;
  `#getPaged()` de TikTok se detenía en la página 20 aunque `total_page` dijera 35. El daño es peor
  que un error: la comparación devuelve un resultado que **parece completo**. «Están todos» y
  «están todos los que miré» se escriben igual en la pantalla, y de esa diferencia cuelga ir a
  buscar leads perdidos o darlos por recuperados.
  El sobre lleva `esquema` (nombre y **versión**, que se sube a mano cuando cambia el significado
  de un campo y no cuando se agrega uno), `total_filas`, `filas`, `offset`, `limites` —publicados
  siempre, incluso cuando nada se recortó: un límite que solo se descubre al chocarlo es un límite
  indocumentado— y `recortado` + `avisos`. Los tres últimos juntos y no uno: un total sin
  `recortado` obliga al consumidor a restar para enterarse, y el que no resta se lleva la mitad de
  los datos creyendo que son todos. Un `total_filas` en `null` es «no se puede saber» (la Graph API
  pagina por cursor) y **no** se lee como recorte. El aviso lo agrega `bridgeEnvelope` y no cada
  llamador: puesto en el llamador, el siguiente puente se olvida de ponerlo. `apiPaged()` de TikTok
  acepta `onTruncate` —un callback y no un campo en la instancia, para no dejar estado compartido
  entre corridas—.
  **El acceso mínimo está escrito** (`MINIMUM_ACCESS`, y viaja en la respuesta de las dos
  conciliaciones): cada permiso dice para qué es, qué deja de funcionar sin él y cómo se consigue.
  Va en un solo sitio porque el reflejo ante un 403 de una API de anuncios es pedir todos los
  permisos y reautorizar la app, y eso amplía el alcance del token a ciegas — un token con más
  permisos de los que usa es un token que, filtrado, hace más daño.
- **Smart+ tiene dos niveles, y el que no se sabe se declara desconocido**
  (`backend/services/smartPlusLevel.js`, columnas `tiktok_parent_ad_id`, `tiktok_creative_id`,
  `tiktok_video_id`, `tiktok_video_name`, `tiktok_creative_valid_from` / `_to`). Una campaña Smart+
  no tiene un anuncio y una pieza: tiene un anuncio **padre** y, debajo, piezas creativas que
  TikTok combina y rota sola. El CRM guardaba un solo `tiktok_ad_id`, así que de un lead de Smart+
  no se podía decir qué pieza lo trajo **ni se podía decir que no se sabía**: salía como un lead de
  ese anuncio, igual que uno de una campaña simple.
  El gasto se reporta al **padre** (`SPEND_LEVEL`), así que el costo por cita y por venta se
  calculan ahí: con el gasto en el padre y las citas en la pieza, la división no da el costo de
  nada. Y la pieza queda `desconocida` — **nunca se infiere por descarte**. Si una campaña tiene
  tres videos y el lead trae solo el id del padre, atribuirlo al que más impresiones tuvo ese día
  produce un número que parece cierto, que nadie puede auditar, y del que cuelga cortar una pieza
  que quizá era la que vendía. En una campaña que **no** es Smart+ el anuncio es su propio padre,
  para que la distinción no le quite la atribución a la mayoría de los leads.
  **Anuncio, pieza y video son tres identificadores distintos** y van en columnas separadas: el
  anuncio compra el presupuesto, la pieza es la combinación que armó TikTok y el video es el
  archivo subido. Un mismo video vive en varias piezas y una pieza puede cambiar de anuncio, así
  que mezclarlos hace que «el video que mejor convierte» y «el anuncio que mejor convierte»
  devuelvan respuestas distintas sin que se sepa cuál es cuál; el nombre del **archivo** tampoco es
  ninguno de los tres. La **vigencia** de la pieza se guarda para no dividir el gasto de un período
  por leads cuya pieza ni existía entonces, que es la forma más silenciosa de que un costo por lead
  salga absurdo; `withinValidity()` devuelve `null` —y no `false`— cuando no hay con qué comprobar.
  La hoja «Ruta de leads» publica «Nivel de atribución», el id del padre, el de la pieza, el del
  video, su nombre y la vigencia, y el agregado por anuncio cuenta `piezaDesconocida`.
  Las columnas nacen vacías y **no hay backfill**: TikTok no expone el nivel hijo en esta cuenta
  hoy, el dato histórico no está en ningún lado, y eso es la respuesta correcta y no una tarea mal
  hecha. `backend/scripts/diagnosticarSmartPlus.js` (solo lee) contesta las tres preguntas que no
  se pueden contestar leyendo el código: qué nivel devuelve la descarga de leads, cuál el reporte
  de gasto, y si los ids de los dos lados son del mismo nivel — dos endpoints de la misma API
  pueden devolver niveles distintos con el mismo nombre de campo, y ahí el cruce «cierra»
  emparejando cosas que no son la misma.
- Lo que Meta nos manda **vuelve a Meta**: `metaConversionsService.js` le devuelve, por la
  **Conversions API**, en qué etapa del funnel terminó cada lead que llegó de un anuncio
  (`/api/meta-capi` bajo `webhooks.view`, pantalla en `MetaConversionsPanel.vue` dentro de
  `/admin/webhooks`). Sin esa vuelta, la optimización de Meta solo puede perseguir "más
  formularios llenados", que es justo la métrica que se llena de números equivocados y curiosos.
  **No se hace a través de YCloud** aunque el WhatsApp pase por ahí: su reporte de conversiones
  solo cubre las conversaciones nacidas de un Click-to-WhatsApp (los leads de formulario, que son
  la mayoría, no pasan por YCloud), solo admite dos eventos (`Lead` y `Purchase`) y para saber que
  un lead pasó a "Cotizado" habría que llamarlo igual desde acá — un salto extra para un dato que
  el CRM ya tiene y el proveedor no.
  El evento de formulario lleva además `custom_data.lead_event_source`, que es el texto con el que
  el Administrador de eventos identifica el origen de la "Integración de CRM" —hoy **"CRM
  AVANTAGE"**, `META_CAPI_LEAD_EVENT_SOURCE` para cambiarlo—: es lo único de ese payload que el
  equipo lee en pantalla, y sin él el evento se acepta igual pero queda sin atribuir a ninguna
  integración, el mismo fallo silencioso que el conjunto de datos cruzado.
  Un lead se reporta solo si **Meta puede reconocerlo**, y hay dos caminos: su `lead_id`
  (`leads.meta_leadgen_id`, formularios instantáneos → `action_source: 'system_generated'` +
  `custom_data.event_source: 'crm'`) o su `ctwa_clid` (el click id que viaja en el `referral` del
  primer mensaje y que `whatsapp_messages` ya guarda entero → `action_source:
  'business_messaging'` + `messaging_channel: 'whatsapp'`). El del evaluador público o el cargado a
  mano no se reportan: no hay anuncio al que atribuirlos.
  Y cada origen va a **su propio conjunto de datos** (`datasetFor()`): el de CRM
  (`META_CAPI_DATASET_ID`, el que se crea en Events Manager > Integraciones > CRM) y el que Meta
  mantiene ligado a la cuenta de WhatsApp Business (`META_CAPI_MESSAGING_DATASET_ID`, el único
  contra el que un `ctwa_clid` se atribuye al anuncio). Cruzarlos **no da error**: Meta acepta el
  evento y no lo atribuye a nada, así que la campaña sigue optimizando a ciegas y nadie se entera —
  por eso, sin el de mensajería, esa mitad queda apagada y la pantalla lo dice, en vez de enviar a
  un destino que no sirve. **No viaja ningún importe** — Meta recibe
  la etapa, no cuánto facturó el cliente, misma regla que el resto del sistema.
  La integración quedó funcionando el **20/10/2026** con los dos canales enviando: conjunto de CRM
  (formularios) + conjunto propio de mensajería creado desde "Conectar datos > Mensajes > Página de
  Facebook", un token con los dos conjuntos asignados (se consigue generando el de la Dataset
  Quality API y marcando ambos) y el `page_id` de la Página. Dato verificado contra Meta ese día:
  **`Purchase` se acepta sin divisa ni importe**, así que la decisión de no mandarle cifras del
  negocio no cuesta la señal de venta.
  El evento de Click-to-WhatsApp lleva además, dentro de `user_data`, el **`page_id`** (o el
  `whatsapp_business_account_id`) del conjunto al que se envía: el `ctwa_clid` identifica el clic,
  no el negocio que lo recibió, y sin eso Meta lo rechaza. Sale de `META_CAPI_PAGE_ID` o, si no
  está, del `META_PAGE_ID` que ya se usa para los formularios; sin ninguno, esa mitad se omite
  antes de gastar la llamada y la pantalla lo dice en la configuración. El ejemplo de la
  documentación de Meta NO lo incluye —el asistente de Events Manager sí lo marca como
  obligatorio—, así que el que manda es el asistente.
  **Los nombres de evento solo son libres en la mitad de formularios.** Con
  `action_source: business_messaging` Meta rechaza los nombres propios ("proporciona un valor
  válido como Purchase o LeadSubmitted", error real del 20/10/2026), así que esa mitad se traduce
  sola en `messagingEventName()`: la etapa ganadora —preguntada con `loadWinningStatuses()`, que la
  columna la crea el equipo— viaja como `Purchase`, las demás como `LeadSubmitted`, y los
  desenlaces de pérdida NO se reportan por ahí (mandarlos como `LeadSubmitted` le diría a Meta que
  calificó justo el lead que no calificó, y Meta no optimiza en contra de un evento). No es
  configurable a propósito: el conjunto válido es de Meta y es chico, así que ofrecerlo en la
  pantalla solo daría la oportunidad de escribir algo inválido. La bitácora guarda el nombre que de
  verdad viajó y la etapa de la que salió, que no coinciden en esa mitad.
  Qué etapa se reporta y con qué nombre de evento vive en `meta_capi_stage_events` y **no** en una
  constante: las columnas del funnel las crea el equipo y sus claves se generan solas
  (`col_mtc2nwec_fij`), así que la migración siembra las etapas clave resolviéndolas como el resto
  del sistema (el desenlace fijo, la columna marcada `final`, la de cotización por `quoted` o por
  su nombre) y la pantalla deja editarlas. Dos etapas pueden compartir el nombre del evento
  (`ganado` y la columna `final` son la misma venta) y entonces se manda **una sola vez por lead**:
  reabrir y volver a ganar no es una segunda venta. Eso se decide con `meta_capi_events`, la
  bitácora de envíos, que además es lo que hace posible el botón "Reenviar últimos 7 días" — Meta
  solo acepta eventos con esa antigüedad, así que lo que no se mande en esa ventana ya no entra
  nunca y no puede depender de que alguien se dé cuenta el mismo día. El `event_time` se compara
  contra `meta_created_time` (cuándo se llenó el formulario en Meta) y no contra `created_at`
  (cuándo entró acá): un lead recuperado por la conciliación tres días después tiene las dos fechas
  muy separadas, y Meta descarta el evento anterior a la generación del lead.
  El disparador es `leadService.updateLeadStatus()` —el punto único por el que cambia la etapa,
  igual que la comisión de la setter— y se lanza **sin esperarlo**: arrastrar una tarjeta en el
  Kanban no puede quedarse esperando a que responda la Graph API, y un envío que falla se reenvía
  mientras un movimiento perdido no se recupera. Las credenciales son del `.env`
  (`META_CAPI_DATASET_ID`, `META_CAPI_ACCESS_TOKEN`, que cae a `META_ADS_ACCESS_TOKEN` porque es el
  que ya tiene `ads_management`); sin ellas la integración queda apagada y no se intenta nada.
  Buscar el `ctwa_clid` de un lead tiene los **dos** caminos de `resolveWaIdForPhone()`: primero la
  coincidencia exacta del `wa_id` y después los últimos 9 dígitos. La exacta no es un atajo — hay
  conversaciones cuyo identificador no es un teléfono sino un id de usuario de la empresa
  (`PE.2379096279586501`, el 40% de los contactos de anuncio del período medido el 20/10/2026) y el
  lead que nace de ellas guarda ESE texto en `phone`, donde `phoneKey()` devuelve null con razón:
  no son teléfonos y cruzarlos por sus últimos dígitos emparejaría contactos distintos.
  `backend/scripts/diagnosticarCtwa.js` (solo lee) contesta si el proveedor de WhatsApp está
  reenviando el `ctwa_clid` y cuántos leads se reportarían por él: sin ese click id no hay conjunto
  de datos ni configuración que arregle la mitad de Click-to-WhatsApp, y conviene medirlo antes de
  salir a buscar el `META_CAPI_MESSAGING_DATASET_ID`.
  La **versión de la Graph API de este endpoint es propia** (`META_CAPI_GRAPH_API_VERSION`, v26.0
  por defecto) y no cae a `META_GRAPH_API_VERSION` (v21.0, la que usan los webhooks, Instagram y
  las métricas de anuncios): los campos de mensajería son recientes y una versión vieja no los
  rechaza —acepta el evento y no atribuye nada—, el mismo fallo silencioso que el conjunto de
  datos cruzado. Aparte: v21.0 **expira el 21/01/2027**, así que la versión global hay que subirla
  igual, pero eso toca todas las integraciones y es un cambio con sus propias pruebas.
- **Una cita agendada no es una cita asistida** (`scheduled_meetings.attendance` / `_at` / `_by`,
  `ATTENDANCE_VALUES`, `setAttendance()`, `PATCH /api/meetings/:id/attendance`). La tabla sabía si
  la reunión se había **cancelado** —el evento desapareció del Google Calendar del asesor— pero no
  si alguien se presentó, así que todo lo que mide el embudo contaba como cita a la que nadie fue:
  la tasa por anuncio, el reporte de setters, el costo por cita del exportable. Un anuncio que trae
  gente que agenda y no aparece se leía exactamente igual que uno que trae gente que se presenta, y
  es la diferencia entre un público bueno y uno que hay que dejar de comprar.
  **Tres estados**, por la misma razón que `leads.qualified`: el vacío es «nadie lo registró» y no
  «no vino» — un `false` por defecto mostraría como ausencias todas las reuniones viejas, que son
  casi todas. Por eso el reporte de setters publica `attendanceUnknown` junto a `attendanceRate`:
  una tasa de asistencia en cero puede ser un setter que agenda reuniones a las que nadie va o un
  equipo que no está registrando el desenlace, y a una se le baja el presupuesto y a la otra se le
  pide que complete el registro. La tasa se calcula sobre las **citas conseguidas** y no sobre los
  leads: lo que mide es si las reuniones que ese setter agenda de verdad ocurren.
  Lo marca una **persona** y nunca un automatismo: Google Calendar no sabe quién entró a la sala, y
  deducirlo de que la reunión ya pasó convertiría esto en lo que `qualified` era antes de
  arreglarse. En la agenda el control sale solo en la reunión que **ya pasó y no está cancelada**
  (de una cancelada no se puede decir que alguien no asistió: cancelar es que la reunión no existe
  más), volver a tocar la marca la borra, y la fila se escribe **en memoria** sin recargar el mes —
  recargar volvería a pedir la disponibilidad del equipo, el pedido más caro de esa pantalla.
  `attendance` es texto y no booleano porque esto crece: «reprogramada en el acto» y «asistió
  tarde» son desenlaces que el equipo distingue al hablar.
- **Los cinco desenlaces del funnel van separados** en el exportable de Campañas: «Citas
  agendadas», «Citas asistidas», «Leads en cotización», «Ventas cerradas» y «Leads cobrados»
  (`appointments`, `attended`, `quotation`, `won`, `collected` en `#breakdownByAd()`). Cerrada no
  es cobrada: «cobrado» es lo **verificado** en Finanzas, que es el hecho más difícil de discutir
  del funnel. La hoja «Ruta de leads» lleva además «Cita asistida» con los mismos tres estados.
  Tres de esas columnas —«Citas agendadas», «Citas asistidas» y «Leads cobrados»— estuvieron
  **declaradas y sin escribir** hasta el 12/11/2026: `adAttributionRow()` no copiaba el conteo que
  `#breakdownByAd()` ya calculaba, así que salían en blanco en todas las filas del libro que se
  reporta, y una columna vacía se lee como un cero — con ella así, ningún anuncio parecía haber
  traído una sola cita. Lo mismo le pasaba a «Personas nuevas (CRM)» en la hoja de Campañas. Es un
  fallo que no rompe nada y que solo se ve mirando el archivo, de ahí el test que recorre esas
  columnas por su valor y no por su encabezado.
- **El dinero del funnel son CUATRO cifras y no dos** (`#summariseGroup()`, `#breakdownByAd()` y
  las tres hojas del exportable): lo **cotizado** (el pipeline abierto, lo que se propuso), lo
  **registrado de ventas ganadas**, la **cuota pactada sin cerrar** (asentada en Finanzas para un
  lead que todavía no se ganó) y lo **cobrado y verificado**. Vienen de la auditoría comercial del
  corte del 10/11/2026, donde las dos que había decían cosas que no eran:
  (1) **lo cotizado solo se llenaba para los leads ganados** (`won && lead ? quoteByLead...`), así
  que las 63 oportunidades en «Cotización / propuesta» salían las 63 en cero y el valor del
  pipeline no se podía consultar en ninguna parte — ni cuánto hay en juego, ni qué descuento se
  ofreció, ni qué tan efectivas son las propuestas, que es lo que se mira para saber si el problema
  es el anuncio o el cierre. Lo que se cotizó es un hecho con fecha propia y no un atributo de
  haber ganado.
  (2) **«Registrado» sumaba las ventas ganadas y los acuerdos sin cerrar en una sola celda**: los
  S/ 40.600 que el reporte presentaba como contratos eran S/ 14.800 de 7 ventas ganadas y S/ 25.800
  de 7 leads en «Cuota pactada» sin un solo cobro. El total se sigue publicando —es lo que las
  hojas venían leyendo— pero con sus dos mitades al lado, para que no haga falta restarlas.
  El **ROAS se calcula sobre lo cobrado** y no sobre lo cotizado. Antes dividía el valor cotizado
  de los ganados entre el gasto, lo que ya era discutible; con la cotización abierta ahora incluida
  sería directamente falso — el anuncio que solo genera propuestas que nunca cierran mostraría el
  mejor retorno del libro. El cociente sobre lo cotizado se publica aparte y nombrado por lo que es
  («Cotizado / gasto»), porque de esta cifra cuelga dónde se pone el presupuesto.
- **La primera respuesta sale de la ficha del lead, y son dos relojes** (`leads.first_response_at`
  / `_by`, ver `leadFirstResponse.js`). El exportable la calculaba como el primer saliente de la
  conversación de WhatsApp, que es justo lo que no tiene el lead que importa: el de formulario que
  nunca escribió por WhatsApp salía con la celda vacía, y «no se le contactó» y «se le llamó y
  nadie lo registró» se escribían igual (109 de 450 leads en el corte del 10/11/2026). La columna
  del lead cubre los dos caminos por los que de verdad se contesta —cualquier saliente y la primera
  nota de la ficha, que es el único registro que deja una llamada—.
  Los dos relojes son el **acuse** y la **atención humana**, y se publican separados porque se
  arreglan distinto: la mediana de ~20 segundos del corte era Avan acusando recibo, y debajo de esa
  cifra había 62 leads atendidos después de 15 minutos y 51 después de una hora. Por eso van juntos
  la mediana, el **P90** (`percentile()`, con test propio) y la mediana de la respuesta humana: una
  medida de centro no dice nada de la cola, y la cola es la parte que se arregla; el P90 solo
  tampoco serviría, porque sin la mediana al lado no se distingue un equipo lento de uno rápido con
  unos pocos casos olvidados. `first_response_by` nulo se escribe **«Avan o app de WhatsApp»** y
  no «el bot»: un asesor escribiendo desde WhatsApp Business llega por el mismo camino, y afirmar
  lo primero haría pasar por automática una respuesta humana.
- **El tercer estado se escribe con todas las letras.** «Calificado» y «Cita asistida» dejaban la
  celda **vacía** cuando nadie lo había registrado, y eso era información solo para quien conoce la
  regla: el importador de marketing la leyó como un «No» y la planilla del corte del 10/11/2026
  terminó diciendo que los 450 leads estaban descalificados — el mismo error con el signo cambiado
  que esa columna vino a evitar cuando se derivaba de la etapa y decía «Sí» en 403 de 403 filas.
  Ahora salen «Sin calificar» y «Sin registrar». **Un valor que no se puede colapsar no se
  colapsa**: en una hoja que viaja a otra herramienta, la celda vacía es una invitación a
  rellenarla con lo que le parezca al importador. Por lo mismo se publica «Cita sin reunión
  registrada» (`appointmentWithoutMeeting`, derivado en cada lectura): es lo que explica que la
  etapa contara 43 citas y solo 36 tuvieran fecha, y sin esa columna la resta parece un error del
  reporte en vez de una cita que nadie puede ir a buscar en una agenda.
- **El libro que se reporta se abre diciendo qué cuenta cada cifra** (hoja «Cómo leer este libro»,
  `#addReadMeSheet()`). Va primera y es parte del reporte, no un anexo: estas cifras se comparan a
  diario contra el Administrador de anuncios y contra la planilla de marketing, y las tres fuentes
  cuentan cosas distintas con los mismos nombres —el campo «conversiones» de Meta no cuenta envíos
  de formulario sino el evento de conversión configurado en la campaña—, así que exigir que
  coincidan manda a buscar leads que nunca existieron. Lleva además las **dos marcas de tiempo**,
  la del CRM y la de la última sincronización con Meta: el gasto viene de una y lo comercial de la
  otra, de modo que un cero de ventas en los últimos días puede ser que no se vendió o que la
  sincronización es anterior, y sin la fecha de cada lado las dos se leen igual. El resto de la
  hoja es el glosario de las cuatro cifras de dinero, los tres estados y las dos convenciones de
  redacción (`-` = no corresponde, `sin dato` = vino de un anuncio y falta).
- **La calificación se audita con una muestra, no con una cifra**
  (`backend/scripts/auditarCalificacion.js`, solo lee). Contesta tres cosas distintas: cobertura
  (cuántos leads tienen la marca), sesgo (cómo se reparten los Sí y los No) y quién califica. Y
  termina con diez leads calificados al azar con los datos en los que se apoya ese juicio, que es
  lo único que de verdad valida el dato.
  **Que casi todos sean «Sí» es una ALERTA y no una prueba de que el campo esté roto**: es lo que
  se veía cuando la marca se derivaba de la etapa (403 de 403), y también lo que se ve cuando el
  equipo califica solo lo que piensa trabajar y deja el resto vacío, que es un uso legítimo. El
  script imprime el número y nombra las dos lecturas; declarar roto el dato desde la cifra es el
  mismo error con el signo cambiado. No imprime teléfonos ni correos: de cada lead salen el id, el
  origen y los datos académicos, que es lo que hace falta para juzgar la calificación.
- **Lo que TikTok nos manda también vuelve a TikTok** (`tiktokConversionsService.js`, Events API,
  `/api/tiktok-capi` bajo `webhooks.view`, tablas `tiktok_capi_stage_events` y
  `tiktok_capi_events`). Es la hermana de la integración con Meta y existe por el mismo agujero
  visto desde el otro lado: TikTok nos entrega los leads —a mano, porque no hay webhook— y nunca
  se enteraba de lo que pasó después, así que su optimización solo puede perseguir «más
  formularios llenados», que es justo la métrica que se llena de leads que no contestan: la
  campaña aprende a traer gente que completa un formulario, no gente que compra.
  **El identificador es el `lead_id` de TikTok y nada más** (`leads.tiktok_lead_id`, preservado
  tal cual y guardado también en la bitácora, para que el envío se pueda explicar si la ficha se
  borra o se fusiona). No hay equivalente del `ctwa_clid`: TikTok no manda referral al chat, así
  que un lead del evaluador, del alta manual o de WhatsApp orgánico **no se reporta** — forzarlo
  con un identificador aproximado le enseñaría a la campaña una conversión que no trajo. No viaja
  ningún dato de contacto (con el `lead_id` la plataforma ya sabe quién es) ni ningún importe.
  El `event_time` es el del **hecho real**: `tiktok_created_time` para el alta —un lead que la
  importación rescató tres días después tiene las dos fechas muy separadas— y el momento del
  movimiento para los cambios de etapa; un evento anterior a la generación del lead se **ajusta al
  alta** en vez de perderse, porque la causa normal es una fecha corregida a mano. La
  deduplicación es doble: `tiktok_capi_events` evita el reenvío local y el `event_id` es
  **determinista** (`crm-<lead>-<evento>`), así que un reenvío llega con el mismo id y TikTok lo
  descarta — con un id al azar, reabrir y volver a ganar se contaría como una segunda venta.
  **Que TikTok acepte un evento no significa que la campaña optimice por él.** La aceptación es
  del Events API; la optimización depende del `optimization_goal` del grupo y de que el evento
  figure en el origen. Dar la segunda por buena porque pasó la primera es el fallo silencioso de
  esta integración —el mismo que en Meta era mandar al conjunto de datos equivocado—, así que
  `checkEligibility()` lee el objetivo de los grupos y viaja en la MISMA respuesta del `GET` y no
  detrás de un botón: escondida detrás de un clic, nadie la hace. Sin servicio de anuncios dice
  `no_comprobado` y **no** «todo bien». Y la Business API responde **HTTP 200 con el fallo**
  **adentro** (`code` distinto de 0), así que se mira el código y no el estado: un rechazo anotado
  como enviado no se reintenta nunca.
  Los **nombres de evento no son libres**: el conjunto lo fija TikTok (`TIKTOK_EVENT_NAMES`), y
  `saveMapping()` rechaza con 422 cualquier otro — un nombre propio se aceptaría en la pantalla y
  se rechazaría en el envío, un error que recién se ve días después. Lo que el equipo elige es QUÉ
  etapa manda cada evento estándar, y eso es una tabla y no una constante porque las columnas del
  funnel las crea el equipo y sus claves se generan solas.
  El disparador es `leadService.updateLeadStatus()` —el punto único por el que cambia la etapa— y
  se lanza **sin esperarlo**, junto al de Meta: son dos llamadas y no una con un `if`, porque un
  lead puede tener atribución de las dos plataformas y cada una tiene que enterarse del desenlace
  del lead que ELLA mandó. Las credenciales son del `.env` (`TIKTOK_EVENTS_SOURCE_ID`,
  `TIKTOK_EVENTS_ACCESS_TOKEN`, que cae a `TIKTOK_ACCESS_TOKEN`); sin ellas queda apagada.
  **Lo que todavía no está verificado**: este entorno no tiene credenciales de TikTok, así que la
  forma del payload sale de la documentación del Events API 2.0 y no de una respuesta observada —a
  diferencia de la de Meta, que quedó funcionando el 20/10/2026 con los dos canales enviando—. El
  primer envío real hay que mirarlo con `GET /api/tiktok-capi` en la mano.
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
  "Sus leads" son tres columnas y no una (`LEAD_PEOPLE_FIELDS` en `leadService.js`): quien lo tiene
  a cargo (`assigned_user_id`), su setter (`setter_user_id`) y su closer (`closer_user_id`). Las dos
  últimas se sellan solas —al graduar y al ganar— pero también se eligen **a mano desde la ficha**
  en los dos tableros (`LeadAssignee.vue` con `role="setter"`/`"closer"`, `PATCH
  /api/leads/:id/setter` y `/closer`, bajo `leads.manage_all`); los sellos nunca pisan un valor ya
  puesto, así que lo elegido manda. Para repartir de a muchos está la **asignación masiva**
  (`BulkLeadTeamModal.vue`, botón en los dos tableros, `POST /api/leads/bulk-team`): el lote son los
  leads que el tablero muestra con sus filtros, y cada campo tiene tres estados — no cambiar, una
  persona o dejar vacío — porque un campo que no viaja no se toca.
  Desde el **Funnel de Ventas el lote son los DOS tableros**: sus columnas más los leads que
  todavía están en el Setter Funnel, agrupados por su etapa y pasados por los mismos filtros de la
  barra (`setterGroups` en `LeadsView.vue`). Repartir es un solo trabajo, y hacerlo dos veces —una
  por pantalla— es como se termina con la mitad del equipo sin leads; además el que reparte
  (`leads.manage_all`) es el único que ve los dos tableros completos, así que es el único que puede
  hacerlo de una sola vez. El modal acepta grupos de más de un tablero (`group.board`) y recién ahí
  dibuja el selector «Tablero» y antepone su nombre a la etapa de cada fila —«Cita Agendada» existe
  en los dos—; el Setter Funnel sigue abriendo el mismo modal con un solo tablero y no ve ninguna de
  las dos cosas. Las etiquetas de las etapas del setter salen de `src/setterFunnelColumns.js`, que
  es el cliente de esas columnas: con la lista copiada en la otra pantalla, una etapa renombrada se
  llamaría distinto en cada una. Lo que no cae en ninguna columna conocida se agrupa en «Otras etapas» en vez
  de desaparecer: un lead que no se lista no se puede repartir.
  En «Responsable» y «Setter» el desplegable lista **solo a los setters** (`isSetter()` en
  `src/data/commercialTeam.js`, por el nombre del rol): el área comercial se define por permiso, y
  por eso ahí aparecían también los administradores —que lo tienen por tenerlos todos, no porque
  trabajen leads— y elegir uno por error deja el lote a nombre de alguien que no lo va a trabajar.
  La palabra se busca suelta, así que «Setter Junior» entra solo. «Closer» sigue con el área
  completa: ese es el otro oficio. El servidor no cambia —`bulkSetLeadTeam()` sigue aceptando a
  cualquiera del área comercial—: esto acota lo que se OFRECE, no lo que es válido.
  Entre "lo mío" y "todo" hay un punto medio, `setter.view_all`: lo propio más todo lo que aún no
  graduó a Ventas (`visibilityFor()`, `scope: 'setter'`). No deja asignar. El desplegable
  "Responsable" del Setter Funnel es otro permiso, `setter.filter_assignee`: es la herramienta para
  recorrer el tablero de cada persona y **no abre leads** — filtra lo que el servidor ya mandó.
- El **interruptor global del bot** (`whatsapp_bot_settings.bot_enabled`, botón en la barra de
  `/admin/whatsapp`, `GET`/`PATCH /api/whatsapp/bot/global`) decide **quién atiende**: Avan o el
  equipo. Es otra cosa que la pausa por contacto (`whatsapp_bot_sessions.bot_enabled`, que se pone
  sola en cuanto alguien responde a mano). Leerlo es `whatsapp.view`; cambiarlo, `bot.manage`.
  Con el bot **apagado** no sale un solo mensaje: el freno está al tope de `handleIncomingMessage()`
  —antes incluso que "estoy en sala de espera", que es la excepción a cualquier otra pausa— y en los
  dos barridos que le hablan al lead (`checkStaleConversations`, `sendMeetingReminders`). Se vuelve
  ahí y no en `send()` para no dejar rastro: ni buffer encolado (se procesaría al reencenderlo,
  contestando un mensaje de hace horas), ni sesión creada, ni llamada al LLM; y los barridos RESERVAN
  la fila antes de mandar, así que dejarlos correr contra un envío que falla gasta el único
  recordatorio que a ese lead le tocaba. `send()` igual lanza `BOT_DISABLED` como red de último
  momento, porque "ningún camino llega hasta acá" dura hasta el próximo camino que alguien agregue.
  Los barridos **no marcan** lo que no mandaron, así que al encender el bot el recordatorio sale.
- El **reparto automático de leads** (`/admin/reparto`, `LeadRoutingView.vue`, permiso
  `leads.routing`, `leadRoutingService.js`) decide quién recibe los leads que entran solos
  (formularios de TikTok y de Meta, evaluador, bot) y en qué proporción. **Lo que decide si un lead
  se reparte no es el interruptor del bot sino quién lo atiende** (`routesNow()` en
  `leadRouting.js`, con su espejo en `src/leadRouting.js`): el de **formulario** y el del
  **evaluador** se reparten SIEMPRE y el que nace de una **conversación de WhatsApp** solo con el
  bot apagado. Hasta el 09/11/2026 la regla era una sola para todos —se repartía con el bot
  apagado— y el argumento valía solo para la mitad: a un lead de formulario **el bot no lo atiende
  nunca** (Avan contesta mensajes, no escribe primero), así que con el bot encendido nacía sin
  responsable, y un lead sin responsable **no lo ve nadie** salvo quien reparte. O sea que la mayoría
  de lo que entra por anuncios quedaba en tierra de nadie justo mientras el bot estaba encendido,
  que es casi siempre. Que un lead de formulario tenga dueño no vuelve a pisar al bot si esa persona
  después escribe: en cuanto alguien le responde a mano, el bot se pausa solo para ese contacto
  (`whatsapp_bot_sessions.bot_enabled`) — tener responsable no es que alguien esté escribiendo, es
  que alguien lo ve en su tablero. Quién atiende lo dice el camino de alta: `botWillAttend` viaja
  solo desde `findOrCreateFromWhatsApp()` y viene en **false** por lo mismo que `autoRoute` viene en
  `true` — el camino que tiene que acordarse de algo tiene que ser el excepcional, o el próximo que
  se agregue deja sus leads sin dueño sin que nada falle. `isActive()` sigue existiendo pero ya no
  significa "el reparto está corriendo" sino "también se reparten las conversaciones de WhatsApp",
  que es lo que muestra la banda de la pantalla. No hay un interruptor propio del reparto y
  `lead_routing_pools.enabled` dejó de decidir nada (queda para el día que haya más de un grupo):
  con dos interruptores, la combinación "bot apagado + reparto apagado" deja los leads sin
  responsable Y sin bot — ni los ve nadie ni los contesta nadie, que es el peor estado posible. Cada persona tiene un **peso** (`lead_routing_members.weight`): de cada vuelta
  (la suma de los pesos) le tocan tantos leads como su peso, así que "5 a la setter por cada 1 al
  closer" es peso 5 y peso 1, y con más gente se suman filas sin tocar código. El algoritmo es el
  reparto ponderado **suave** (`backend/services/leadRouting.js`, con su espejo `src/leadRouting.js`
  para la vista previa y un test que verifica que digan lo mismo): intercala (S S S C S S) en vez de
  mandar ráfagas, y su estado (`current_weight`) se guarda para seguir donde quedó. Cada cambio en
  la pantalla pone la vuelta en cero, así la secuencia que se ve es la que va a salir. Se saltea a
  quien está en pausa o dejó de ser del área comercial; sin nadie elegible el lead queda sin
  responsable, como hoy. La pantalla avisa si alguien del reparto **no tiene `setter.view`**: los
  leads automáticos nacen en el Setter Funnel, y el rol Closer tal como viene no lo ve.
  Existe `lead_routing_pools` aunque hoy haya un solo grupo para que repartir distinto por origen
  (campaña, universidad) sea agregar reglas y no migrar miembros. El enganche está en
  `leadService.createLead()` —el punto común de los caminos automáticos— y solo para leads
  **nuevos**: los que se cuelgan de una ficha existente por teléfono siguen con quien la tenía. El
  parámetro es `autoRoute` y viene en **`true`**: el que tiene que acordarse de algo es el alta
  MANUAL, que es una sola (`registerManualLead()`) y lo pone en `false`; al revés, el cuarto camino
  automático que aparezca se olvidaría y nadie se enteraría, porque un lead sin repartir no falla,
  solo queda sin dueño. El reparto **le gana al texto** `assignedTo`, incluido el valor por defecto
  "Kevin" (un resto de cuando el campo era libre, que hoy además nombra a una persona real):
  respetarlo haría que todos los leads de Meta y del evaluador siguieran cayéndole a él.
  `pickAssignee()` lee y escribe `current_weight` en una transacción con `forUpdate`: dos webhooks
  simultáneos sin eso le dan el lead a la misma persona y la proporción configurada deja de
  cumplirse. La pregunta de quién sigue siendo del área comercial se resuelve ANTES de abrir la
  transacción, para no alargar el bloqueo en el camino por el que entra cada lead. Un fallo del
  reparto nunca tumba el alta: un lead sin responsable se asigna a mano, uno que no se guardó se
  perdió.
- **Al lead se le responde desde su propia ficha** (`LeadConversation.vue`, el panel lateral del
  modal en los dos tableros). Era el bloque que estaba copiado en `SetterFunnelView` y `LeadsView` y
  ahora es un componente, porque pasó a tener estado de verdad: cuadro de respuesta, ventana de 24 h,
  autor de cada mensaje y la pausa de Avan. Pide `/api/leads/:id/whatsapp` (GET hilo, POST responder,
  `PATCH .../bot` para devolverle la conversación a Avan, y `.../media/:messageId` para los adjuntos)
  y **no** las rutas de la bandeja: aquellas exigen `whatsapp.view`, que son TODAS las conversaciones
  de todo el mundo, y el setter no la tiene — hasta ahora el panel le respondía 403 y la conversación
  se veía vacía sin decir por qué. Estas van con `requireAnyPermission('leads.view','setter.view')` +
  `requireLeadVisible`, la misma regla de "cada quien ve sus leads", y la ruta del adjunto comprueba
  además que el mensaje sea de ESA conversación y no solo que exista.
  El `wa_id` **no** se toma de `lead.phone` tal cual: se resuelve con `resolveWaIdForPhone()`
  (exacto y después los últimos 9 dígitos, el mismo criterio que `findByPhone`), porque la ficha y el
  webhook escriben el número distinto — el hilo salía vacío para los leads de Meta, y ahora que desde
  ahí se ENVÍA, el mensaje se iría a un identificador que no existe.
  `whatsapp_messages.sent_by` guarda **quién** mandó cada saliente (nulo = Avan, o un eco de la app
  de WhatsApp Business): todo lo saliente se pintaba como "Avan" porque era verdad, y desde que
  responde gente el hilo es una mezcla — sin eso no se sabe si al lead ya le contestaron. El hilo
  lleva además **separador por día** ("Hoy", "Ayer", la fecha): solo con la hora, "10:50" puede ser de
  hace un minuto o de hace tres semanas, y de eso depende si corresponde contestar o presentarse de
  nuevo. El sondeo de 12 s **no arrastra la vista** si el operador subió a releer (`stuckToBottom`).
- El módulo de **Calendario** (`/admin/calendario`, `CalendarView.vue`, permiso `calendar.view`) es
  la agenda del closer: las reuniones que agendó el bot por WhatsApp y las cargadas a mano, en una
  grilla mensual. Lee `scheduled_meetings`, que dejó de ser solo del bot — `wa_id` admite nulos (una
  reunión manual no tiene conversación detrás) y se guarda `created_by`, `attendee_email` y
  `source` (`bot` | `manual`), que es lo que después deja ver si está agendando el bot o el equipo.
  Cada reunión dice **quién la cargó** y no solo a quién: `created_by` se guarda desde que existe
  el alta manual, y la agenda lo muestra (`originOf()` en `CalendarView.vue`, "cargada a mano por
  Lucía"). No es un adorno: el asesor que figura al lado es a quien se le agendó, y como la agenda
  es del equipo —cualquiera del área comercial puede agendarle a cualquiera— casi nunca son la
  misma persona, así que sin el autor no había a quién preguntarle por una cita que apareció sola.
  Sin autor conocido (las anteriores a que se guardara, o las de alguien dado de baja) dice
  "cargada a mano" a secas en vez de inventar un nombre.
  Agendar a mano (`scheduledMeetingService.bookManual()`, `POST /api/meetings`) crea el evento en el
  Google Calendar **del closer**; si él no tiene su cuenta conectada, lo crea en el de quien agenda
  y lo invita por correo, para que le llegue igual. Borrarla del panel no cancela el evento en
  Google (el panel no puede tocar el calendario de otra persona) y eso también se dice.
  **Una reunión por Meet exige que haya una conexión con Google** (`modality`, `meet` | `llamada`).
  Antes se guardaba igual sin evento ni enlace y la pantalla lo avisaba, pero eso deja al asesor con
  una videollamada sin sala: el aviso se lee una vez y la cita queda ahí, con su hora y su cliente,
  pareciendo completa. La comprobación es `meetBlockedReason()` y corre **antes** de guardar nada
  —así no queda a medias—, y si el evento falla igual (token revocado entre medio, red) tampoco se
  guarda. `modality: 'llamada'` es la salida legítima: la reunión telefónica no necesita sala, se
  guarda aunque no haya ninguna conexión y su evento va al calendario sin Meet
  (`createMeetEvent({ withMeet: false })`). Queda escrita en la fila en vez de deducirse de que
  falte el enlace, que es lo mismo que le pasa a una reunión rota. El modal aplica la misma regla
  antes de dejar elegir la hora (`meetBlockedReason` en `MeetingModal.vue`, con
  `viewerGoogleConnected` de `/api/meetings/advisors`): lo que se ve y lo que se hace no pueden
  decir cosas distintas, y el servidor es el que manda.
  **Con quién es la reunión se guarda en la reunión** (`scheduled_meetings.contact_name`) y no se
  deduce solo del lead: desde el Calendario no hay lead ninguno, y la ficha que abrió el bot muchas
  veces todavía no tiene nombre de verdad. Qué se muestra lo resuelve `meetingContactName()` en un
  solo sitio y en cada lectura (viaja como `contact_label`): el nombre escrito al agendar, el del
  lead, y de último el **teléfono**. El marcador `'Contacto de WhatsApp'` que `findOrCreateFromWhatsApp()`
  le pone a un contacto sin nombre de perfil **no cuenta como nombre** en ninguno de los dos pasos
  —llenaba la agenda de filas idénticas que no identifican a nadie, mientras que un número sí—, ni
  se precarga en el formulario, donde se confirmaría sin mirar. La regla vive en
  `backend/services/contactName.js` y su espejo `src/contactName.js`.
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
  El botón **"Sincronizar con Google"** (`POST /api/meetings/sync`, `calendarSyncService.js` +
  `calendarSync.js` para las reglas puras) trae al panel lo que pasó en el Google Calendar de los
  asesores. Es **de Google al panel y en un solo sentido**: no crea, no mueve y no cancela ningún
  evento, así que apretarlo nunca puede estropear el calendario de nadie — por eso puede ser un
  botón y no un proceso supervisado. Cubre las tres fugas de la mitad que faltaba: el asesor mueve
  la reunión en su calendario y el panel seguía mostrando la hora vieja (con la que el bot le
  mandaba el recordatorio al lead), la borra y la reunión seguía en la agenda del equipo, o agenda
  algo directamente en Google y el panel no se enteraba. Recorre a **todo el área comercial** que
  tenga su Google conectado y solo el **rango visible**, y un asesor con el token caducado no
  detiene a los demás: su error viaja en el resumen. Lo que cambió se le dice al que apretó
  (`syncSummary()`), incluido "nada que cambiar" — un botón que no dice qué hizo obliga a revisar el
  mes a mano.
  Una reunión que ya no está en Google se **marca** (`scheduled_meetings.cancelled_at`) y no se
  borra: de ella cuelgan el lead, el autor y el estado del recordatorio, y un botón que destruye
  filas es un botón que nadie aprieta. Marcada, deja de contar en todas las lecturas
  (`getUpcoming`, `getForDay`, `getPendingReminders`, `getLatestForContact`) **menos** en el
  Calendario, donde se ve tachada para que alguien se entere; si el evento reaparece en Google se
  des-cancela sola. Si la reunión se movió y su recordatorio ya había salido, `reminder_sent_at`
  vuelve a null (el que salió decía la hora vieja) salvo que la reunión ya haya pasado.
  Dos cosas que parecen detalles y no lo son: una reunión del panel cuyo evento **no vino** en el
  rango consultado NO se cancela —pudo haberse movido a otro mes— sino que se pregunta de a una con
  `events.get()`; y `calendar_event_id` se compara contra **todo** el panel, no contra el asesor en
  curso, porque un evento con varios invitados es el MISMO evento en los dos calendarios y si no
  entraría dos veces. Los eventos de **día completo** no se importan (no caen en una grilla de
  horas) pero se cuentan y el resumen lo dice. Y quitar del panel una reunión cuyo evento sigue vivo
  en Google es temporal: la próxima sincronización la vuelve a traer, y la pantalla lo avisa al
  quitarla — en esta dirección Google es la verdad.
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
- El **Reporte General** (`/admin/reporte-general`, `GeneralReportView.vue`, permiso `reports.general`,
  `generalReportService.js`, `GET /api/general-report?months=3|6|12`) es la pantalla de gerencia y
  **no tiene tabla propia**: ventas, caja, cartera, embudo y canales, cada KPI comparado con el
  período anterior de la misma duración. La caja (cobrado, egresos, resultado) **no se vuelve a
  sumar**: sale de `financeLedgerService.getOverview()`, la misma fuente que Finanzas, para que las
  dos pantallas no digan cifras distintas. Lo **vendido** es el `total_amount` de los leads ganados,
  fechado por el `created_at` de su proyecto (nace al ganar). La cartera son las cuotas `pendiente`
  por antigüedad de `due_date`; las `pagado` van aparte («falta verificar»), no son deuda. Las ventas
  no concretadas (`deal_cancelled_at`) no cuentan ni como vendido ni como cartera. El embudo y los
  canales se miden por **cohorte** (los leads que entraron en el período y hasta dónde llegaron),
  acumulativo: un ganado sin sello también cuenta como "pasó a Ventas". El permiso se copia de
  entrada solo a quien ya tenía `finance.view`, porque muestra importes. Los gráficos son SVG propios
  (`src/components/report/`), sin librería, y su paleta (oliva + azul) es la que pasó el chequeo de
  daltonismo: el naranja de marca junto al oliva no se distingue con deuteranopía.
- El **contrato firmado** de un lead (`signed_contracts`, `signedContractService.js`, botón
  "📝 Contrato firmado" en la ficha del Funnel de Ventas, `SignedContractModal.vue`) es el PDF, el
  Word o el **enlace de Drive** que vuelve con la firma del cliente. Tiene **tabla propia** y no unas
  columnas en `contracts` por dos razones que se ven apenas se abre una ficha: hay contratos
  firmados que el sistema **nunca emitió** —se arman en Word por fuera y vuelven escaneados, y son
  justo los que más falta hace guardar porque no están en ningún otro lado—, y un lead puede tener
  **más de uno** (el contrato y después su adenda, o la versión corregida que se volvió a firmar).
  Cuelga del **lead** y no del proyecto: se firma antes de que el proyecto exista, y es lo que
  habilita abrirlo.
  Cada fila es **un archivo o un enlace, nunca los dos ni ninguno** (`validateSource()`). Las dos
  formas conviven porque el equipo usa las dos: el escaneo que llega por WhatsApp se sube, y el que
  ya vive en la carpeta de Drive del cliente se enlaza — copiarlo sería tener dos originales y no
  saber cuál manda. El enlace se valida de verdad (`normalizeExternalUrl()`: solo `http`/`https`),
  porque lo guardado termina siendo un `href` en la ficha y un `javascript:` pegado ahí se
  ejecutaría al hacer clic. El archivo acepta PDF, Word, ODT **e imágenes**: el contrato firmado
  llega muchas veces como la foto que el cliente mandó por WhatsApp, y rechazarla obliga a
  convertirla antes, que es el paso en el que el archivo se queda en el escritorio de alguien.
  `contract_id` ata el documento al contrato **emitido** cuando lo hay (el desplegable se
  preselecciona solo si hay uno), y atarlo **marca ese contrato como `firmado`**. No es editar el
  contrato —su contenido, sus cláusulas y sus importes quedan intactos—: es anotar un hecho que el
  documento recién subido ya prueba, y sin eso el contrato quedaría en "borrador" en su pantalla con
  su copia firmada adjunta en la otra. Quitar el documento **no** lo devuelve a borrador: se firmó
  igual, y borrar la copia no deshace la firma.
  Las rutas cuelgan del lead (`/api/leads/:id/signed-contracts`), como las notas y el historial de
  etapas: así reusan `requireLeadVisible` —cada quien ve sus leads, también sus documentos— y el id
  del lead viaja en la ruta, que es lo que permite comprobar que el documento sea de ESE lead y no
  solo que exista (mismo cuidado que la ruta de adjuntos de WhatsApp). El permiso es el del funnel y
  **no `contracts.manage`**: aquel es para EMITIR contratos y esto es parte de cerrar la venta, que
  lo hace quien trabaja el lead. Los contratos emitidos que viajan como opciones del desplegable van
  **sin importes**, por la misma regla de siempre.
  `signed_contracts` está en **CASCADE** sobre el lead, así que `deletionBlockReason()` impide
  borrar una ficha que tenga uno: de todo lo que cuelga de un lead, el respaldo de la firma es lo
  único que no se puede volver a generar desde el sistema.
- El **Reporte de Setters** (`/admin/reporte-setters`, `SetterReportView.vue`, permiso
  `reports.setters`, `setterReportService.js`, `GET /api/setter-report?months=3|6|12`) contesta cómo
  le fue a cada setter: leads atribuidos, reuniones conseguidas, cierres y en qué etapa quedaron los
  demás. **No tiene tabla propia** —como Cobranzas y el Reporte de Leads—: guardar esas cifras
  obligaría a reescribirlas en cada movimiento de lead.
  **Un lead se le atribuye a `leads.setter_user_id` y, si no hay sello, a `assigned_user_id`**
  (`attributedSetterId()`). El sello se escribe una vez, al graduar, con quien tenía el lead
  entonces, y es lo que sobrevive a que la ficha pase al closer: mirando solo el responsable actual,
  cada venta cerrada se le atribuiría al closer. Es la misma pareja de columnas de la que cuelga la
  comisión de la setter, así que el reporte y lo que se le paga no pueden discrepar. Se resuelve en
  JavaScript y no con un COALESCE en SQL para que la regla exista una sola vez.
  **Los resultados se miden por cohorte y la actividad por fecha del hecho**, y son dos cosas
  distintas con dos nombres distintos en pantalla. "Leads de octubre" son los que ENTRARON en
  octubre, y su reunión y su cierre cuentan en octubre aunque hayan ocurrido después: es la única
  forma de que las tasas compartan denominador (contar reuniones del mes contra leads del mes da
  porcentajes mayores al 100%). El precio es que el trabajo hecho este mes sobre leads viejos no
  aparece, y por eso va aparte la **actividad registrada** (`lead_stage_changes` del período,
  agrupada por `actor_id`), que es lo único que contesta "¿qué trabajó esta persona este mes?".
  Asignar no deja rastro en la bitácora, así que "cuándo se le asignó" no existe como dato: la
  cohorte por `leads.created_at` es lo que sí se puede medir.
  Qué significa cada desenlace se pregunta donde ya está contestado: `loadWinningStatuses()` (con el
  proyecto abierto como respaldo, igual que en Campañas), `LOST_STATUSES`, `leadHasGraduated()` y
  `buildStatusLabeler()` — ninguna lista propia, porque las columnas de los dos tableros las crea el
  equipo. Por eso `LOST_STATUSES`/`isLostStatus()` pasaron a vivir en `salesFunnelStage.js`, el
  módulo del vocabulario de `leads.status`, y Campañas los importa de ahí en vez de tener su copia.
  **Una reunión cancelada en Google no es una reunión conseguida** (va a su propio contador), y el
  **cierre por reunión** se calcula con `wonWithMeeting / withMeeting` y no con `won / withMeeting`:
  hay ventas que se cierran sin reunión cargada y con el total de ganados arriba la tasa daba 200%
  (se vio al correr el reporte contra la base). Una tasa que supera el 100% no es un dato, es un
  aviso de que el numerador no pertenece al denominador. Los plazos son **medianas** y no promedios:
  un lead que se agendó seis meses después corre el promedio de todo el equipo.
  **La visibilidad es la del funnel, no una propia**: reusa `leadService.visibilityQueryFor()` +
  `applyLeadVisibility()`, así que quien ve solo lo suyo ve una sola fila —la de su propio
  desempeño— y `scope` viaja a la pantalla para que lo explique. De acá solo salen conteos, pero un
  conteo sobre los leads de otra persona también es información sobre esos leads. **No muestra
  importes**, por la misma razón que Proyectos y Entregables: lo que mide a un setter es cuántos
  leads trabajó y cuántos cerraron, no cuánto facturó cada venta. Los leads **sin responsable** se
  informan aparte y no se reparten entre las filas (repartidos inflarían a quien no los trabajó),
  pero sí cuentan en el total del equipo y en el desglose de etapas, que por eso cuadra con las
  tarjetas de arriba.
  La **barra de composición** (`ReportStackedBars.vue`) va al 100% y no a escala: lo que se compara
  es quién tiene la cartera trabada y quién la cierra, y a escala la fila del que más leads tiene
  tapa al resto — el tamaño va escrito al lado del nombre. Su orden es **Ganado · En proceso ·
  Perdido** a propósito: así el oliva y el rojo nunca se tocan (con deuteranopía son el mismo color,
  ΔE 1,5) y el peor par adyacente sube a ΔE 16,8. El trío del gráfico mensual (azul · magenta ·
  oliva) pasa los seis chequeos de la guía de visualización en los dos temas y en todos los pares.
  La aritmética del período (`reportPeriod.js`) y los formatos de cifra y de variación
  (`src/components/report/reportFormat.js`) se comparten con el Reporte General: con una copia por
  pantalla, el mismo mes se leería distinto según desde dónde se mire.
  Desde el 12/11/2026 mide además **la atención**, que es lo que la auditoría comercial del corte
  del 10/11/2026 encontró que el reporte no sabía contestar. Son cuatro cifras y no una:
  `noFirstResponse` (leads a los que NADIE contestó: 109 de 450 en ese corte), la **mediana**, el
  **P90** y la **mediana de la respuesta humana**. Van juntas porque una sola engaña —la mediana
  del equipo era de ~20 segundos, que es Avan acusando recibo, con 62 leads atendidos después de 15
  minutos y 51 después de una hora debajo—: una medida de centro no dice nada de la cola y la cola
  es lo que se arregla, y el P90 solo tampoco serviría, porque sin la mediana al lado no se
  distingue un equipo lento de uno rápido con unos pocos casos olvidados. El dato sale de
  `leads.first_response_at` / `_by` (`responseMinutes()`), que cubre el mensaje de WhatsApp y la
  primera nota de la ficha —el único registro que deja una llamada—: medido como el primer saliente
  de la conversación, el lead de formulario que nunca escribió por WhatsApp salía siempre vacío.
  Se publica la **distribución en tramos** (`RESPONSE_BUCKETS`) y **no el cumplimiento de un SLA**:
  el SLA no existe todavía —la auditoría propuso cinco minutos en horario comercial, que es una
  decisión del área con su definición de horario—, y un «cumple el 62%» contra una meta que nadie
  acordó es una cifra que no se puede discutir. Los tramos son excluyentes y su suma más
  `noFirstResponse` es siempre el total de leads, que es lo que sostiene la barra.
  Dos cifras más del mismo origen: la **cobertura de calificación** en sus tres estados (el vacío no
  es un «no» — separa al lead que nadie revisó del revisado y descartado, y mide si el setter hace
  el trabajo, que es distinto de su criterio) y la **cartera dormida** (`STALE_DAYS`, 7): leads
  todavía abiertos sin un solo movimiento en más de una semana. 7 y no 30 porque los 50 congelados
  del corte llevaban una mediana de 16,5 días, y con el umbral en un mes ninguno habría aparecido —
  que es exactamente cómo se llega a tener medio centenar de fichas que nadie mira. Dormido solo se
  puede estar estando abierto: un ganado o un perdido que nadie toca está terminado, no abandonado.
  Y `appointmentWithoutMeeting`, que es el lead en la etapa «cita agendada» **sin** una reunión con
  fecha y hora: se cuenta aparte de `withMeeting` porque es lo que explica que el funnel diga 43
  citas y la agenda tenga 36 — sin esa cifra, la resta parece un error del reporte. La etapa se
  pregunta con `isAppointmentStatus()` de `salesFunnelStage.js`, el módulo del vocabulario de
  `leads.status`, que es el mismo que usa Campañas: con una copia en cada reporte, el día que la
  etapa cambie de nombre una de las dos pantallas deja de contarlas sin que nada falle.
  La rampa de los tramos de respuesta es **secuencial de un solo tono** (`--viz-resp-1..4`, azul de
  claro a oscuro) más el rojo de «sin respuesta», y no cuatro colores distintos: son datos
  ordenados, una escala de claridad se lee en orden sin leyenda y es la única que sobrevive a
  cualquier daltonismo. «Sin respuesta» queda **fuera** de la rampa porque no es un tiempo más
  largo sino la ausencia de respuesta, y al final del azul se leería como «muy lento». Los cinco
  tonos están validados contra el **blanco** y no contra el fondo de la página —el valor va escrito
  en blanco dentro de cada segmento y los segmentos cubren la barra entera—: todos pasan 4.5:1 y
  los pares contiguos quedan en ΔE 10,6 a 13,1, también simulando deuteranopía. Por eso son los
  mismos en los dos temas.
  `percentile()` vive en `reportPeriod.js` y no en cada reporte: la pregunta («¿qué esconde la
  mediana?») es la misma acá y en Campañas, y con una copia por pantalla las dos medirían la cola
  distinto.
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
- **Mi perfil** (`/admin/perfil`, `ProfileView.vue`, entrada en el menú del avatar del navbar) es la
  cuenta vista por su propio dueño: su **contraseña** y su **foto**. Es la única pantalla de
  `/admin` **sin permiso** en el router, y a propósito: todo el mundo tiene una cuenta con una
  contraseña, así que un permiso para entrar al propio perfil habría que darle a todos — y el día
  que a alguien no se le dé, esa persona se queda sin poder cambiarla. Las rutas (`/api/profile*`)
  **no reciben id**: el usuario es el del token. Con el id en la ruta, cada una tendría que
  comprobar que es el propio, y la que se olvide deja a cualquiera cambiándole la contraseña a
  cualquiera. Lo que NO se edita desde ahí es el nombre, el correo y el rol: de los tres cuelgan
  cosas de otros módulos (el correo es la identidad del login, el rol decide los permisos, y el
  nombre se copia como texto legible en `leads.assigned_to`, en los avisos y en los documentos ya
  emitidos), así que se gestionan desde Perfiles, que es donde se ve a quién afectan.
  Cambiar la propia contraseña **pide la actual** aunque la sesión ya esté abierta — un panel que
  se queda abierto en una pantalla compartida permitiría que cualquiera que pase se quede con la
  cuenta—, y **restablecer la de otro** desde Perfiles (`PUT /api/users/:id/password`, bajo
  `roles.manage`) no la pide, porque quien restablece no la sabe: es la única forma de volver a
  entrar que tiene alguien que la olvidó, ya que el panel interno no manda correos de recuperación
  como el portal de clientes. Las dos puntas pasan por `#writePassword()` en `userService.js`, que
  es donde viven las dos reglas —el mínimo (`MIN_PASSWORD_LENGTH`, 8, el mismo del alta de la
  cuenta y el mismo que valida la pantalla) y que no sea la que ya tenía, porque una pantalla que
  acepta "la cambié" sin cambiarla deja a la persona convencida de que rotó una contraseña
  filtrada—. El token **no se invalida**: es stateless y dura 8 h, y lo que cambió es la
  contraseña, no la identidad. `password_changed_at` no gobierna nada —nada caduca—: existe para
  que la pantalla pueda decir "la cambiaste el 9 de noviembre", que es lo único que contesta si
  esa sigue siendo la que le dieron al crearle la cuenta.
  La **foto** es `users.avatar_filename`, y en la columna va **solo el nombre del archivo**: la
  carpeta base la decide `UPLOADS_DIR` y puede cambiar entre despliegues, así que una ruta guardada
  queda apuntando al disco de ayer. La URL se arma en cada lectura con `avatarUrlFor()`, un solo
  sitio para el `avatar_url` que viaja en el usuario de la sesión (el navbar lo dibuja en todas las
  pantallas), en el equipo de cada proyecto —cuyo template ya lo esperaba— y en la tabla de
  Perfiles. Donde no haya foto se siguen viendo las iniciales de `src/avatars.js`: el círculo es el
  mismo, cambia lo que lleva dentro.
  Dos decisiones del archivo. **Se sirve por una ruta sin sesión** (`GET /uploads/avatars/:filename`),
  la única del panel: un `<img>` no manda el header `Authorization`, y el camino de los
  comprobantes de Finanzas —`fetch` + blob— para una foto que aparece en cada pantalla sería una
  descarga por página sin caché. Lo que la protege es que el nombre son **16 bytes al azar**, así
  que no se puede pedir la foto de alguien sin que el panel la haya dado antes (con `3.jpg` la foto
  de cualquiera quedaría a un número de distancia), y por eso reemplazar una foto **borra la
  anterior**: el nombre viejo seguiría sirviendo el archivo viejo mientras exista en disco. Y **no
  se aceptan SVG** aunque sean imágenes, que es la única exclusión: un SVG puede traer `<script>`
  adentro y, servido desde nuestro propio dominio, correría con los permisos de la página — subir
  una foto de perfil alcanzaría para robarle la sesión a quien la mire.
- **La campana del panel también llega al teléfono** (`pushService.js`,
  `deviceTokenService.js`, tabla `device_tokens`, rutas `/api/devices*` y
  `/api/push/*`, y la app Flutter de `mobile/` — ver su README). La campana
  avisaba al equipo solo si alguien tenía una pestaña abierta: una reunión que
  Avan agenda a las 11 de la noche o un pago verificado se veían cuando alguien
  se acordaba de mirar.
  **Se cuelga de `notificationService.create()` y no de cada ruta**: es el punto
  único por el que nace toda notificación del panel —hoy ocho sitios: el bot
  (cuatro), los dos avisos de Finanzas, el de proyecto nuevo y el del portal del
  cliente— y es la misma razón por la que el aviso de proyecto nuevo vive en
  `projectService` y no en sus tres rutas de alta: puesto en cada llamador, el
  noveno que se agregue se olvida y nadie se entera de que no avisó. El envío
  **no espera ni lanza**: la fila ya quedó asentada, que es lo que la campana
  necesita, y un FCM lento o caído no puede demorar el cierre de una venta ni
  tumbar el webhook del bot.
  **No usa `firebase-admin`**: el SDK trae su propia cadena de dependencias y
  esto corre en hosting compartido; la llamada son treinta líneas de REST y el
  token OAuth lo firma `googleapis`, que ya es dependencia directa (la usa Google
  Calendar). El precio es que HTTP v1 **no tiene multicast**, así que un aviso a
  diez dispositivos son diez llamadas — irrelevante para un equipo chico, y si
  deja de serlo el cambio es dentro de ese archivo.
  **El token identifica al DISPOSITIVO y no a la persona**, y de ahí que el
  índice único de `device_tokens` sea `token` a secas y no (`user_id`, `token`):
  Firebase le da un token a cada instalación, así que si en ese celular entra
  otra persona el token tiene que **mudarse** a la cuenta nueva. Con el único
  sobre el par quedarían dos filas vivas con el mismo token y la notificación de
  un lead le llegaría a la pantalla de quien usó el teléfono antes. Por lo mismo
  el cierre de sesión **borra** la fila (no hay nada que diagnosticar y lo que
  importa es que no le siga llegando nada), mientras que un token que Firebase
  rechaza por caducado se **marca** (`revoked_at`), para que el envío no lo
  reintente y la pantalla pueda decir que esa instalación dejó de responder.
  La regla que más importa es `classifyFcmError()`: un **401/403 no da de baja
  ningún token**. Es la cuenta de servicio, el proyecto o el permiso —el problema
  es del servidor y los dispositivos están perfectos—, y tratarlo como "este
  token no sirve" dejaría a todo el equipo sin dispositivos por una variable de
  entorno mal pegada, con el agravante de que volver a registrarlos exige que
  cada persona abra su app. Solo `UNREGISTERED` e `INVALID_ARGUMENT` la dan.
  Las rutas van con `requireAuth` **y sin permiso propio**, igual que
  `/api/notifications`: lo que se empuja es exactamente lo que esa persona ya
  puede leer en la campana (`notifications` no tiene columna de usuario), así que
  un permiso aparte solo serviría para dejar a alguien con la campana y sin el
  teléfono. El push **no amplía** lo que alguien ve, lo mueve de pantalla.
  Sin credenciales (`FCM_*` en el `.env`) la integración queda **apagada** y no
  se intenta nada: el panel sigue igual. Y la app no depende de ellas —cae al
  **sondeo** de `/api/notifications` y lo dice en pantalla—, porque en **Windows
  y Linux Firebase Cloud Messaging no existe (no es que falte configurarlo: el
  SDK no los soporta)** y porque una app de notificaciones que muestra un error
  por una credencial faltante no sirve para nada hasta que alguien entre a la
  consola de Firebase. De ahí la columna `transport` (`fcm` | `polling`): los
  equipos que sondean se registran igual —así se sabe cuántas instalaciones hay—
  pero `activeFcmTokens()` los excluye, para no gastar una llamada a Firebase en
  una dirección que no existe.
  `POST /api/push/test` manda un aviso **solo a los dispositivos de quien lo
  pide** y **no deja fila en `notifications`**: es para comprobar la cadena
  completa (servidor → Firebase → aparato) sin llenarle la campana al equipo.
  Mismo patrón y mismas razones que los botones de correo de prueba de
  Entregables y de Proyectos. **Lo que todavía no está verificado**: este entorno
  no tiene un proyecto de Firebase, así que la forma del payload sale de la
  documentación de FCM HTTP v1 y no de una respuesta observada. El primer envío
  real hay que mirarlo con ese botón en la mano.
- **Los avisos que el equipo se escribe a mano** (`/admin/avisos`,
  `NoticesView.vue`, permiso `notices.send`, `noticeService.js`, rutas
  `/api/notices*`). Con la app móvil instalada el equipo tiene un canal al
  bolsillo de cada uno, y no había forma de usarlo para lo que la gente de
  verdad necesita decirse: las notificaciones nacían SOLO de eventos del
  negocio (ocho sitios: el bot, los dos avisos de Finanzas, el de proyecto
  nuevo, el del portal del cliente).
  **No tiene tabla propia**, como Cobranzas y el Reporte de Leads: un aviso
  manual es una fila de `notifications` con `created_by` escrito. Una tabla
  paralela obligaría a que la campana leyera de dos lados y a mantener
  sincronizado el "no leído" en los dos — y el día que se separen, nadie sabría
  cuál dice la verdad.
  Lo que sí cambió es que las notificaciones pasaron a tener **destinatario**:
  `notifications.user_id`, nullable, donde **NULL significa "para todos"**. Es
  nullable y no se rellena a propósito: las filas que ya estaban y TODAS las
  automáticas siguen naciendo en NULL, así que ni la campana ni los ocho sitios
  que las crean cambian de comportamiento, y la lectura es un solo
  `where('user_id', viewer).orWhereNull('user_id')` (`#visibleTo()`). Al revés
  —una fila por usuario para todo— habría que tocar los ocho llamadores y
  multiplicar cada aviso del bot por la cantidad de empleados.
  **Un aviso dirigido a tres personas son TRES filas**, una por destinatario,
  unidas por `batch_id`. Es lo que hace que `is_read` siga significando lo que
  significa: cada quien marca el suyo. Con una fila compartida, el primero que
  lo abre lo marca leído para los otros dos — que es, de hecho, lo que ya les
  pasa a los avisos globales, y no hay razón para arrastrar esa rareza a lo
  nuevo. `batch_id` es lo que vuelve a juntar esas filas en UN renglón del
  historial: sin él, un aviso a diez personas se lee como diez avisos distintos
  y no se puede decir "esto se mandó una vez, a diez".
  **Los roles se expanden a personas en el momento de mandar**, no en cada
  lectura: quien entre al rol la semana que viene vería un aviso que nunca
  recibió —el push ya salió sin él— y quien salga perdería uno que sí le llegó
  al teléfono. Es la misma razón por la que la comisión guarda su porcentaje en
  la fila. Una persona elegida a dedo Y además por su rol es UNA destinataria
  (`resolveRecipients()`, pura y con test): sin el desduplicado le llegarían dos
  avisos idénticos y dos pushes. La pantalla cuenta con la MISMA regla, porque
  con dos distintas prometería un número y el envío haría otro.
  **El enlace del aviso solo puede ser una ruta de este panel**
  (`isInternalPath()`): no alcanza con que empiece por `/` — `//evil.com`
  también empieza por `/` y el navegador lo resuelve como `https://evil.com`, y
  `/\evil.com` igual. De ese campo cuelga a dónde va quien toca un aviso que le
  llegó al teléfono con el nombre de la empresa arriba, o sea la forma exacta de
  un phishing interno. La primera versión de la comprobación era un
  `startsWith('/')` y dejaba pasar los dos; lo pilló el test. En la pantalla el
  destino es un desplegable cerrado y no un campo libre, por lo mismo que los
  nombres de evento de la CAPI de mensajería no son configurables: el conjunto
  válido es chico, y ofrecer un cuadro de texto solo da la oportunidad de
  escribir algo que va a ser rechazado.
  **Marcar leída comprueba que la notificación sea VISIBLE para quien la marca**
  y no solo que exista (`markRead(id, { userId })`, la ruta responde 404): sin
  eso, cualquiera con sesión podría marcar leído el aviso dirigido a otra
  persona probando ids. Es el mismo cuidado de `requireLeadVisible` — filtrar la
  lista y dejar la fila abierta por id es una cortina, no un permiso.
  El push sale a quien dice la fila (`sendForNotification` pasa
  `userIds: notification.user_id ? [...] : null`), y tiene que salir de la MISMA
  columna que decide quién lo ve en la campana: si el push fuera a todos y la
  campana solo al destinatario, el aviso dirigido le sonaría en el bolsillo a
  gente que después no lo encuentra en el panel.
  El permiso es propio y no "estar autenticado" como leer la campana: esto le
  suena en el teléfono a la gente, así que no conviene encendido por defecto
  para todos. La migración lo siembra a quien ya administra el panel
  (`roles.manage`), y el autor sale de la **sesión** y nunca de un campo del
  formulario — mandarlo desde la pantalla abriría la puerta a firmar un aviso
  con el nombre de otro.
  **Su pantalla tiene dos vistas sobre los MISMOS datos** (pestañas, con lo
  elegido recordado en `localStorage` entre `try`): «Enviados» contesta qué se
  mandó y «Quién recibe qué» contesta a quién le llega — la otra mitad del
  trabajo, que en la lista obliga a abrir aviso por aviso. Es el mismo recurso y
  las mismas razones que las dos pestañas de Entregables y las dos vistas del
  Setter Funnel: el cuadro **no pide otra ruta ni calcula otro estado**, se arma
  sobre el mismo historial y la misma lista de destinatarios, porque dos vistas
  con criterios propios es como se llega a que cada una diga un número distinto.
  Para eso el historial devuelve `recipient_list` —**quiénes** y si cada uno lo
  leyó, no solo cuántos—, que es también lo que permite dibujar las caras en la
  lista con un anillo verde o naranja según lo haya leído o no.
  En el cuadro, un aviso a todo el equipo es su propio estado (`all`, ○ hueco) y
  **nunca «leído» ni «sin leer»**: es UNA fila con `user_id` en NULL, así que su
  `is_read` es el de quien la abrió primero y afirmar con eso que a una persona
  le consta sería inventar un dato — la misma razón por la que `read_count` vale
  `null` ahí. Los tres estados se distinguen además por su **forma** (✓, ●, ○) y
  no solo por color, porque el verde y el naranja son el mismo color con
  deuteranopía, y sus tintes son los del sistema de píldoras del panel
  (`.pill-success` / `.pill-warning` / `.pill-neutral`, con su corrección para el
  tema oscuro) en vez de una paleta propia.
  Tres cosas que esta pantalla hacía mal hasta el 14/11/2026 y conviene no
  repetir: el icono del título era un `<svg>` **sin alto ni ancho** —el resto del
  panel pone un emoji en `.heading-icon`, que solo le da `display` y un
  desplazamiento—, así que el navegador lo estiraba hasta llenar la ventana y
  tapaba el panel entero; los campos usaban `.form-control`, una clase de
  Bootstrap que este proyecto **no tiene** (las suyas son `.form-input`,
  `.form-textarea` y `.form-select`), así que se veían con el estilo por defecto
  del navegador; y el encabezado no usaba el `h2.section-heading` +
  `p.section-subheading` del resto de `/admin`. El cálculo de a quién le llega
  cruzaba el rol **por su nombre** y ahora por `role_id`, que es el dato que de
  verdad los une.
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
  cambiar el 2% no reescribe lo ya devengado. Sigue sin entrar en `finance_journal`: el libro
  diario es contabilidad, y esto es lo que se le debe al equipo por vender y por cobrar.
  En el **Resumen Financiero sí resta**, desde el 16/10/2026: la comisión `pagada` cuenta como
  egreso (fechada en `paid_at`, el día en que salió, no en el que se devengó) y la `pendiente` va
  aparte en `totals.pendientes`, sin tocar el balance. **No se descuenta dos veces** porque acá las
  comisiones se pagan por fuera de la planilla, así que no hay una fila de `finance_salaries` que
  repita ese mismo egreso — si algún día se empiezan a anotar en Salarios, el único lugar donde hay
  que dejar de sumarlas es `getOverview()`, donde está dicho en un comentario.
  Desde el **31/10/2026 la fila guarda también el pago**: su **cuenta** (`banco`), el método
  (`metodo_pago`) y sus **comprobantes** (`sales_commission_receipts`, 1:N, calcada de
  `finance_salary_receipts` y con los archivos en la misma carpeta `uploads/finance-receipts/`). Se
  corrige desde el lápiz de cada fila (`PUT /api/commissions/:id`, multipart,
  `commissionService.update()`), y la píldora de estado sigue siendo el `PATCH .../estado` de un
  clic — va aparte por lo mismo que en el Libro Diario: reenviar el formulario entero para cambiar
  una palabra reescribe de paso campos que nadie tocó, y por eso `setEstado()` **no** toca la cuenta
  ni el método. Lo que la edición NO deja cambiar es de dónde viene la comisión —el lead, la cuota,
  el beneficiario y `base_amount`, que los escribió el cierre o el cobro—, y tampoco hay botón de
  alta: una comisión cargada a mano no tendría de qué colgar. El **`percent` se recalcula** desde el
  monto corregido y la base (`update()`): un 2% guardado al lado de un monto que ya no es su 2% es
  una fila que se contradice sola. Y de `banco` cuelga lo importante: el egreso resta en la tarjeta
  de **esa** cuenta del Resumen y no en el cajón "Sin cuenta" —las cuatro consultas de comisiones de
  `getOverview()` van agrupadas por banco, igual que las de salarios—, así que el saldo de la cuenta
  dejó de decir más de lo que hay. Las comisiones anteriores a esa fecha no tienen cuenta y el
  filtro de la pestaña las junta bajo "Sin cuenta", que es como se las encuentra para completarlas.
  `paid_at` se entrega como `"YYYY-MM-DD"` (`isoDay()`, el mismo cuidado que el resto de Finanzas):
  ahora carga un campo de fecha del formulario, así que un día corrido por el huso no sería una
  etiqueta mal escrita sino un dato que se guarda al editar.
- En la bandeja de WhatsApp, cada conversación muestra la **etapa del funnel** del lead
  (`funnel_stage`, resuelto en `funnelStageLabel.js`): quien contesta un mensaje no tenía forma de
  saber si del otro lado hay un contacto recién llegado o un cliente al que ya se le cotizó, y de
  eso depende cómo se le escribe. En la lista va en su **propio renglón**, bajo el nombre y el
  último mensaje, y no pegada al nombre: puesta ahí (primer intento, 16/10/2026) se quedaba con el
  ancho y el nombre desaparecía — filas enteras mostrando solo la etiqueta, y nombres reducidos a
  "R..". En esa columna el nombre es lo único que identifica al contacto, así que es lo último que
  se recorta: ceden primero el alias y después la propia píldora. La hora de la lista sigue la
  convención de cualquier bandeja (la hora si es de hoy, "Ayer", el día de la semana, y la fecha más
  atrás) en vez del "16/10, 10:21 a. m." que gastaba el ancho que le faltaba al nombre. Traducir un `leads.status` a algo
  legible necesita las dos tablas de columnas (`funnel_columns` y `setter_funnel_columns`) **y**
  saber a qué tablero pertenece el lead, que no se deduce del texto del status sino de
  `leadHasGraduated()` — por eso la traducción vive en un módulo y no copiada en cada pantalla.
  Gana la etiqueta del tablero del lead y solo después la del otro: una clave que existe en los dos
  (`cita_agendada`) puede llamarse distinto en cada uno, y mostrar la del otro es decirle a quien
  contesta que el lead está donde no está. Un status sin columna —un desenlace fijo que el equipo
  no configuró, o el `nuevo` de `createLead()`— igual se nombra (`ESTADOS_FIJOS`), que es justo el
  caso en el que saber la etapa más importa. La etapa se resuelve **una vez por página**, no una
  por conversación: la bandeja se refresca sola cada pocos segundos. Sin lead no hay etapa y no se
  dibuja nada: "sin etapa" repetido en media bandeja es ruido.
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
  25 contactos) y conviene no deshacerlas: (1) la apertura pide la **carrera y la universidad juntas**,
  en una sola pregunta — son el mismo dato, dónde estudia qué, y se contestan de corrido en una línea
  ("Sistemas, UNCP"), así que separarlas gastaba un turno en algo que ya venía en la misma respuesta
  (decisión del equipo comercial, 16/10/2026, que revierte la separación que se había hecho por el
  abandono del 01/10: 9 de 25 contactos no contestaron nada en esa primera pregunta — si el embudo
  vuelve a caer ahí, es lo primero a mirar). `nextDataQuestion()` es el único sitio donde vive ese
  orden, y el prompt (`describeMissingPriority` + la regla 1 de `ollamaService.js`) tiene que decir
  lo mismo; (2) la franja de silencio es **22:00–08:00** y lo acumulado sale
  escalonado (`NUDGE_BURST_LIMIT`), porque antes era 01:00–05:00 y tres contactos recibieron su
  recordatorio a las 05:06 en el mismo minuto; (3) un contacto que escribe con el **bot pausado**
  dispara un aviso al equipo (`_alertPausedInbound`, espaciado por `paused_alert_at`): antes solo
  quedaba en la bitácora interna y se perdía — así se quedó sin respuesta un lead que preguntó el
  precio dos veces; (4) el nombre que la persona **escribe** gana sobre el del perfil de WhatsApp en
  cualquier turno (`_adoptDeclaredName`), y las fichas se leen aunque no lleven dos puntos
  (`BARE_FORM_LABEL_RE`); (5) un "ok/sí/dale" **suelto** después de una propuesta es una aceptación
  (`isExplicitYes` + `answers.__awaitingYes`), no un mensaje al que responder repitiendo la pregunta
  anterior.
  De revisar las conversaciones del 06 al 13/10 salieron más reglas:
  **Las burbujas tardías no se contestan como respuestas.** Lo que el contacto escribe mientras el bot
  arma su respuesta (el `finalize` tarda 10–20 s por la evaluación con IA) se procesaba después como
  respuesta a una pregunta que todavía no había visto: "Culminé en diciembre" leído como elección de
  horario ("No te entendí bien 🤔") y preguntas dobles en la conversación libre. El buffer marca el
  lote como tardío si su última burbuja es anterior al último envío del bot
  (`wasWrittenBeforeLastReply`). En el agendamiento se ignora salvo que pregunte algo o sea
  inconfundiblemente el dato del paso, y en la confirmación nunca vale como sí
  (`lateBatchNeedsTurn`); en la conversación libre se guarda lo extraído pero solo se contesta si
  trajo un dato que faltaba o pregunta algo. Ese silencio es deliberado y no dispara la red de
  `_runTurnGuarded`.
  **Nunca se nombra un horario que ya pasó.** Quien se quedó a medio agendar y vuelve días después
  recibía "¿Confirmo *Vie, 9 oct*?" con la fecha vencida. `staleSchedulingSlot()` lo detecta antes de
  enrutar el paso (confirmación, teléfono/correo pendiente, o una lista con todos los horarios
  vencidos) y `bookSlot()`/`confirmSlot()` lo frenan si se elige uno vencido de una lista vieja; en
  los tres casos `_reofferBecauseSlotPassed()` dice que ese horario ya pasó y ofrece los vigentes.
  **Contar el avance no es despedirse.** "Ya tengo el plan aprobado" o "Ya tengo título" empiezan con
  "ya tengo", que `mayBeRefusal` manda al LLM, y el LLM los cerraba como "no interesado".
  `describesThesisProgress()` (leadSignals) los saca del camino del rechazo salvo que el mismo
  mensaje rechace en serio ("ya tengo quien me haga la tesis"). Si igual se cierra por error, un
  mensaje de fondo dentro de la semana reabre la conversación (`shouldReopenClosedConversation`; una
  cortesía como "gracias" no). "No hay problema", "sin problema" y los dedazos de "sí" ("Dii") son un
  sí, y una respuesta ambigua al "¿Confirmo…?" repregunta una vez por el mismo horario
  (`confirmReasked`) en vez de soltarlo y preguntar "¿qué día te viene mejor?".
- **Al contacto que nos corrige la carrera o la universidad se le hace caso en cualquier paso del
  agendamiento** (`profileCorrection.js` → `detectProfileCorrection()`, enganchado en
  `handleSchedulingTurn()` antes del clasificador de dudas). El bot le devuelve los dos datos
  escritos justo antes de pasar a los horarios *para* que pueda corregirnos (ver `offerScheduling`),
  pero la corrección caía en el paso de elección de horario, que solo sabe leer números y días: el
  15/10/2026 un lead escribió tres veces que su universidad no era esa, recibió dos "No te entendí
  bien 🤔" con la misma lista, se agotaron los intentos y lo transfirieron — un minuto después eligió
  "10:00 am" de la lista y, con el bot ya en pausa, nadie lo leyó. Corregir **no gasta** los intentos
  del paso (es el contacto arreglando un error nuestro, no una respuesta fallida) y el acuse sale
  pegado al paso en curso, así que no cuesta un turno. Si descartó lo nuestro sin alcanzar a decir lo
  correcto ("no es la pontificia", "es esta universidad") se le muestra lo anotado para que confirme
  o corrija de una vez, con tope de `MAX_PROFILE_CORRECTION_ASKS` para no preguntar en bucle. Se
  resuelve con reglas y no con el LLM porque de esto depende lo que queda escrito en la ficha —y
  después en la cotización y en el contrato—, y el veto más importante es el del día y la hora: los
  pasos del agendamiento son los dueños de esas frases.
- **"¿Tienen sede en Lima?" se contesta con un sí y con la dirección** (`officeLocation.js` →
  `officeQuestion()`, el texto en `whatsappBotCopy.officeLocations()`, enganchado en
  `runConversationTurn()` **antes** de `_handleTrustDoubt`). Es un dato y no un criterio: la
  dirección exacta no puede depender de lo que improvise el LLM —una calle inventada manda a
  alguien a tocar una puerta que no existe—, así que se detecta con reglas, igual que la corrección
  de carrera/universidad. Va antes de la duda de confianza porque "tienen oficina" coincide con
  `TRUST_DOUBT_RE`, y por ahí la pregunta se contestaba con el **domicilio legal de Huancayo**: al
  que preguntaba por Lima se le respondía que estamos en otra ciudad, teniendo la sede de Lima en el
  catálogo. Las sedes salen de `COMPANY.offices` —la misma fuente que imprime el pie de la
  cotización— y la de Lima llega hasta el **piso y el número de oficina** (`Jirón Washington 1420,
  2.º piso, oficina 10`): quien pregunta por la sede va a ir. Se contestan **todas** las que el
  mensaje nombre ("¿en Lima o en Huancayo?" pregunta por las dos) y **ninguna** que no esté en el
  catálogo: Arequipa sigue el camino normal en vez de recibir un "¡sí!" por una oficina que no
  existe. El Meet va al final y como alternativa, nunca en lugar de la dirección — contestar
  "trabajamos por videollamada" a quien pregunta dónde están es la evasiva que la regla dura del
  prompt ya prohíbe. Como la duda de confianza, el turno se gasta **entero** en responder (el
  horario se vuelve a pedir en el turno siguiente), pero a la tercera pregunta **no** se escala a
  una persona: se deja seguir el camino normal, porque el bloque de datos del LLM ya tiene las
  sedes (`OFFICES_FACT` en `whatsappBotPromptDefaults.js`, en la FAQ editable y en la red de
  seguridad de `buildKnowledgeBlock`) y eso cubre las vueltas que ninguna regla va a cubrir ("¿en
  qué ciudades están?"). Los verbos en **singular** ("queda", "está", "es") quedan fuera del
  detector a propósito: "mi universidad está en Lima" es una respuesta normal del perfilamiento, y
  contestarla con la dirección de la oficina es responderle algo que no preguntó.
- El **catálogo de universidades** (`backend/data/peruUniversities.js`) gana el match **más
  específico de todo el catálogo**, no el de la primera entrada que coincida, y los términos que
  varias comparten (`AMBIGUOUS_UNIVERSITY_TERMS`: "católica", "nacional") **no resuelven a ninguna**
  — devuelven confianza media, que es "quedarse con lo que escribió el contacto". Con el primero
  ganando, el alias genérico `catolica` de la PUCP tapaba el nombre propio de todas las demás
  católicas del país: "Universidad católica Sedes Sapientiae" se confirmaba como "Pontificia
  Universidad Católica del Perú" con confianza alta (caso real del 15/10/2026), y lo mismo le pasaba
  a la de Santa María, San Pablo, Santo Toribio y Trujillo. Un alias nuevo que ya sea palabra de otra
  entrada va con el nombre completo detrás (`catolica de santa maria`) o a la lista de ambiguos.
  `findUniversityMentions()` contesta otra pregunta —"¿de qué universidades habla este mensaje?"— y
  es la que usa la corrección: "No es la pontificia / Es la Sapientiae" nombra DOS, y quedarse con la
  primera es volver a guardar justo la que el contacto descartó.
- **El ritmo con el que contesta el bot es parte del producto.** `nextSendAt()` decide cuándo sale
  cada mensaje: la espera normal es el mínimo antispam configurado
  (`whatsapp_bot_settings.message_gap_seconds`) o lo que tardaría alguien en teclear ese texto
  (`typingTimeFor`), lo que sea más largo; y cuando ese gap ya venció —lo normal después de cada
  llamada al LLM, que tarda 10-20 s— queda el **piso**, que también escala con el largo del texto.
  El piso era una constante de 2,5 s y ahí se perdía todo: la respuesta más larga de la conversación
  salía tan rápido como un "Perfecto 👀", que es de las cosas que más delatan a un bot. La regla está
  afuera de la clase, pura y exportada, para poder probarla (`botPacing.test.js`).
  La burbuja de **"escribiendo..."** no se puede activar sola: WhatsApp exige referenciar un mensaje
  del contacto (es la misma llamada que lo marca como leído). Ese id vivía solo en memoria y solo se
  escribía al atender un entrante, así que la burbuja se saltaba justo en los mensajes que más
  parecen de robot —los que el bot empieza por su cuenta (recordatorios, disculpa por el turno
  perdido) y todos los de cualquier conversación después de un reinicio—. `_typingAnchorFor()` cae a
  la base a buscar el último entrante de ese contacto. De esa burbuja depende el tope de
  `MAX_TYPING_MS`: con ella a la vista una espera larga se lee como alguien redactando, sin ella se
  lee como que nadie contesta.
- El **conteo de seguidores de la página de Meta** se sondea periódicamente
  (`FOLLOWER_POLL_INTERVAL_MS` en `server.js`) porque Meta no lo notifica vía webhook.
- Los **webhooks de Meta/WhatsApp** validan la firma `X-Hub-Signature-256` contra `req.rawBody`
  (el body crudo se conserva explícitamente en el middleware `express.json` de `server.js` para
  esto).
- Errores no capturados en flujos de fondo (p. ej. un envío de WhatsApp fallido) no deben tumbar
  el servidor: `server.js` registra `unhandledRejection`/`uncaughtException` a nivel de proceso en
  vez de dejar que el proceso muera.
