# Avantage Group — Evaluador de Tesis + CRM Interno

Plataforma full-stack (Node.js/Express + Vue 3 + MySQL) que evalúa la viabilidad de temas de
tesis en Perú (Ollama Cloud + embeddings), captura leads en un funnel de ventas Kanban, genera
proyectos con tareas/línea de tiempo, y gestiona acceso interno por roles y permisos.

## Stack

- **Backend**: Node.js (ESM) + Express, MySQL vía [Knex](https://knexjs.org/), JWT para auth.
- **Frontend**: Vue 3 + Vue Router, compilado con Vite y servido como estático por el mismo
  servidor Express en producción.
- **Correo**: Nodemailer (SMTP real o Ethereal como fallback de pruebas).
- **IA**: Ollama Cloud API (embeddings + LLM), con fallback local si la API no está disponible.

## 1. Configuración local

```bash
npm install
cp .env.example .env     # completa tus credenciales (ver abajo)
```

Variables requeridas en `.env` — referencia completa en `.env.example`:

| Variable | Uso |
|---|---|
| `PORT` | Puerto del servidor Express (por defecto 3000). |
| `OLLAMA_HOST`, `OLLAMA_API_KEY`, `OLLAMA_EMBED_MODEL`, `OLLAMA_CHAT_MODEL` | Ollama Cloud API. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Conexión MySQL. |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Firma de sesión del login interno. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Envío de correos (opcional; sin esto usa Ethereal de prueba). |

Crea la base de datos y aplica el esquema:

```bash
mysql -u root -e "CREATE DATABASE IF NOT EXISTS minirag_leads CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
npm run migrate
npm run seed      # crea roles/permisos base + usuario admin (ver db/README.md)
```

Arranca en desarrollo (backend con recarga automática):

```bash
npm run dev        # http://localhost:3000 (API + sirve dist/ si existe)
npx vite           # servidor de desarrollo del frontend en http://localhost:5173 (proxy a :3000)
```

Detalle completo de migraciones y seeds en [`backend/db/README.md`](backend/db/README.md).

## 2. Subir el proyecto a Git

```bash
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin <URL_DE_TU_REPOSITORIO>
git push -u origin main
```

`.env`, `node_modules/`, `dist/` y los archivos subidos en `uploads/` están excluidos vía
`.gitignore` — nunca subas tu `.env` real (contiene la API key de Ollama, credenciales de
MySQL, el secreto JWT y la contraseña SMTP).

## 3. Desplegar en Hostinger (hosting compartido)

Hostinger permite hospedar aplicaciones Node.js en sus planes compartidos (Premium/Business en
adelante) desde **hPanel → Avanzado → Node.js**. Pasos:

1. **Base de datos MySQL**: en hPanel → Bases de datos → MySQL, crea una base de datos y un
   usuario. Anota host (normalmente `localhost`), nombre, usuario y contraseña.

2. **Sube el código**: dos opciones:
   - **Git** (recomendado): en hPanel → Avanzado → Git, conecta tu repositorio y la rama `main`
     apuntando al directorio de la app (p. ej. `domains/tu-dominio.com/public_html` o una carpeta
     dedicada si usarás un subdominio).
   - **Manual**: sube el código vía el Administrador de Archivos o FTP (excluyendo
     `node_modules/`).

3. **Crea la app Node.js**: en hPanel → Avanzado → Node.js → *Crear aplicación*:
   - **Versión de Node**: 18 o superior.
   - **Raíz de la aplicación**: la carpeta donde subiste el código.
   - **URL de la aplicación**: tu dominio o subdominio.
   - **Archivo de inicio (startup file)**: `boot.cjs` (no `server.js` — ver nota abajo).

4. **Variables de entorno**: en el panel de la app Node.js, agrega cada variable de la tabla de
   la sección 1 (usa las credenciales de MySQL del paso 1; `DB_HOST` suele ser `localhost` en
   hosting compartido).

5. **Instala dependencias y compila el frontend**: usa la Terminal integrada de hPanel (o SSH si
   tu plan lo incluye) dentro de la raíz de la app:
   ```bash
   npm install
   npm run build     # genera dist/, que server.js sirve automáticamente
   npm run migrate
   npm run seed       # solo la primera vez
   ```
   El botón "Ejecutar NPM Install" del panel de Node.js equivale a `npm install`; el resto de
   comandos corren desde la Terminal.

6. **Reinicia la aplicación** desde hPanel para que tome las variables de entorno y el build
   nuevo.

7. **Cambia la contraseña del usuario admin sembrado** (`admin@tesisperu.local` / `admin123`)
   apenas inicies sesión — ver [`backend/db/README.md`](backend/db/README.md).

### Notas de producción

- El servidor sirve la API (`/api/*`) y el frontend compilado (`dist/`) en el mismo puerto —
  no necesitas configurar un dominio ni proxy aparte para el frontend.
- Los archivos adjuntos de la línea de tiempo de proyectos se guardan en `uploads/` en disco;
  asegúrate de que esa carpeta persista entre despliegues (no la borres al re-subir código).
  Si usas el despliegue automático por Git de Hostinger, ver la nota siguiente —
  probablemente ya te está pasando esto.
- Cada despliegue nuevo de código requiere repetir `npm install` y `npm run build` (y
  `npm run migrate` si hay migraciones nuevas) antes de reiniciar la app.
- **Por qué `nodemailer` está fijado en `^9` y no en la última**: nodemailer 10 exige Node >= 20
  en su campo `engines`. El Node del hosting compartido no siempre es esa versión, así que la
  rama 9 es lo más alto que se puede subir sin arriesgar el arranque en producción.
  Antes de saltar a 10, confirma la versión de Node en hPanel → Avanzado → Node.js.

  **Ojo: desde el 29/09/2026 la rama 9 ya NO está al día.** Aparecieron tres avisos nuevos de
  `addressparser` y `9.1.1` es la última 9.x publicada — no hay backport, el arreglo existe solo
  en la rama 10. De los tres, **uno no aplica** (CVE-2026-90776, el O(n²) de direcciones unidas
  por comentarios, se explota *vía `mailparser`*: este proyecto no lo tiene en el árbol y nunca
  parsea correo entrante, solo envía). Los otros dos **sí** son alcanzables, porque las direcciones
  que llegan a `sendMail()` son datos del lead y el evaluador público no pide sesión:
  GHSA-v53p-9fqp-m79j (retroceso cuadrático en el *fallback* de texto libre → una dirección
  preparada frena el bucle de eventos) y GHSA-g57g-f23g-4646 (un *local-part* entre comillas
  puede producir un destinatario de sobre mal formado, o sea correo mal entregado). La API que usa
  `emailService.js` —`createTransport`, `sendMail`, `createTestAccount`, `getTestMessageUrl`,
  adjuntos por `path`/`content` con `cid`— **no cambió en la 10**: probado con la 10.1.1, compone
  los mismos correos. Lo único que frena el salto es el `engines`, así que en cuanto el hosting
  esté en Node 20+ el cambio es de una línea.
- **Por qué `esbuild` se queda en 0.25.x pese al aviso de seguridad**: el escáner de dependencias
  marca `esbuild@0.25.12` (GHSA-gv7w-rqvm-qjhr, "actualiza a 0.28.1"). Ese aviso **está retirado
  por GitHub** —dice textualmente que el paquete afectado se identificó mal— y describe un fallo
  del módulo **Deno** de esbuild (`lib/deno/mod.ts`), que descarga su binario sin verificar el
  hash. Este proyecto no usa Deno: esbuild entra como dependencia de desarrollo de Vite y se
  instala por la ruta de npm, que **sí** comprueba el SHA-256 de cada binario
  (`binaryIntegrityCheck` en `lib/npm/node-install.ts`) — es justo la función que el aviso señala
  como ausente en Deno. Tampoco viaja al cliente: solo compila `dist/`.

  Y no se puede subir aunque se quisiera. Se probaron las dos vías:

  1. `overrides` de `esbuild@^0.28.1` manteniendo Vite 6 → **el build falla** con 181 errores
     ("Transforming destructuring to the configured target environment is not supported yet"):
     esbuild 0.28 ya no reescribe ciertas sintaxis al target que Vite 6 pide por defecto.
  2. Subir Vite, que es quien fija el rango. Esto **cambió**: cuando se escribió esta nota ningún
     Vite 6 ni 7 pasaba de `^0.25.0`, pero **Vite 7.3.6+ ya pide `^0.27.0 || ^0.28.0`** y resuelve
     esbuild 0.28.2, y **Vite 8** directamente dejó de usar esbuild (pasó a rolldown/oxc). Las dos
     salidas exigen **Node ^20.19 || >=22.12**, y el build corre en el hosting, que hoy tiene
     **Node 18** — así que el bloqueo sigue siendo el mismo, pero ahora es *solo* la versión de
     Node y no la falta de un Vite que lo soporte. Se probó Vite 7.3.7 +
     `@vitejs/plugin-vue@^6` localmente y el build sale igual: mismos 1904 módulos, el CSS
     **byte a byte idéntico** y el JS 2 kB más chico. Un detalle a no olvidar en ese salto: Vite 7
     cambió el `build.target` por defecto a `baseline-widely-available` (Chrome 107+, Safari 16+),
     así que hay que fijarlo a mano a la lista de Vite 6
     (`['es2020','edge88','firefox78','chrome87','safari14']`) para no dejar afuera navegadores
     que hoy entran al panel.

  Mientras tanto el aviso se puede descartar en GitHub como "no aplica" (advisory retirado).

- **Por qué hay un `overrides` de `uuid` en `package.json`**: `uuid` entra solo como dependencia
  de `exceljs` (exportación de campañas a Excel), y `exceljs@4.4.0` —la última publicada— lo pide
  como `^8.3.0`, versión con una vulnerabilidad de límites de buffer. La corrección automática que
  propone `npm audit fix` es **degradar `exceljs` a la 3.4.0**, un salto de versión mayor hacia
  atrás que rompería la exportación. El `overrides` fuerza `uuid@^11.1.1` manteniendo `exceljs`
  en su última versión; funciona porque uuid 11 sigue publicando su build CommonJS, que es como
  `exceljs` lo carga (`require('uuid')`). Si algún día `exceljs` actualiza su propia dependencia,
  este `overrides` se puede quitar.
- **Por qué `boot.cjs` y no `server.js` como archivo de inicio**: el hosting de Node.js de
  Hostinger arranca la app con Phusion Passenger, que usa `require()` (CommonJS) para cargar el
  archivo de inicio. Nuestro backend usa módulos ES (`import`/`export`, ver
  `backend/package.json`), que Node no permite cargar con `require()`. `boot.cjs` es un archivo
  CommonJS mínimo que hace `import('./backend/server.js')` — la forma soportada de cargar ESM
  desde CommonJS — y así arranca la app real. Si además ves un error `ERR_REQUIRE_ESM` mencionando
  un archivo interno de Hostinger (p. ej. `preload-timestamp.js`), es porque su plataforma copia tu
  `package.json` a su propia configuración interna; por eso el `package.json` de la raíz ya **no**
  declara `"type": "module"` (solo `backend/package.json` lo hace).
- **Persistencia de uploads entre despliegues**: con Git de Hostinger apuntando directo a la
  raíz de la app, cada deploy deja esa carpeta tal cual está en el repo — y como `uploads/`
  nunca se versiona (`.gitignore`), su contenido (comprobantes de Finanzas, adjuntos de
  proyectos, medios de WhatsApp) se pierde en cada redeploy. La solución es guardar esos
  archivos en una carpeta **fuera** de la raíz que gestiona el despliegue por Git, apuntando
  ahí con la variable `UPLOADS_DIR` (ver `.env.example` y `backend/middleware/upload.js`).
  Pasos:
  1. Por SSH o la Terminal/Administrador de archivos de hPanel, crea una carpeta un nivel
     **arriba** de la raíz de tu app Git (p. ej. si Git apunta a
     `domains/tu-dominio.com/public_html`, crea
     `domains/tu-dominio.com/uploads-persistentes`, como hermana de `public_html`, no dentro).
  2. Si ya tenías archivos en `public_html/uploads/` que sobrevivieron, cópialos ahí antes de
     seguir (`cp -r public_html/uploads/* domains/tu-dominio.com/uploads-persistentes/`).
  3. En hPanel → Avanzado → Node.js → tu app → Variables de entorno, agrega `UPLOADS_DIR` con
     la ruta absoluta completa de esa carpeta (pídesela a hPanel o con `pwd` por SSH parado en
     ella).
  4. Reinicia la app Node.js.
  5. Verifica: sube un comprobante nuevo desde el panel y confirma por SSH/Administrador de
     archivos que aparece en la carpeta nueva; luego dispara un deploy (push a `main`) y
     confirma que ese archivo sigue estando y ya no aparece el ⚠️ de "comprobante perdido".
## 4. Conectar TikTok Ads al módulo de Campañas

El módulo de Campañas habla con dos plataformas: **Meta Ads** (botón *Sincronizar con Meta*) y
**TikTok Ads** (botón *Sincronizar con TikTok*). Las dos importan la misma jerarquía —campaña →
conjunto/grupo de anuncios → anuncio— y las mismas métricas, y se distinguen en el panel por la
insignia de origen de cada campaña.

A diferencia de Meta, TikTok **no** manda un `referral.source_id` al chat de WhatsApp, así que sus
anuncios no se mapean en `campaign_ads`: el embudo del CRM (conversaciones → citas → ganados) sigue
siendo cosa de Meta, y de TikTok se trae el rendimiento publicitario (gasto, resultados, alcance,
impresiones, clics, CTR/CPC, video e interacciones).

> La conexión es un **OAuth de dos pasos**: primero el anunciante autoriza la app y TikTok devuelve
> un `auth_code` de un solo uso; después ese código se canjea por un **access token que no caduca**
> mientras nadie revoque la autorización. Por eso el token se guarda a mano en el `.env` y no en la
> base de datos.

### Paso 1 — Crear la app en TikTok for Business

1. Entra a <https://business-api.tiktok.com/portal> con la cuenta que administra el TikTok Ads
   Manager (o crea una cuenta de desarrollador si es la primera vez).
2. **My Apps → Create an App**. Completa nombre, descripción, categoría y la URL de tu sitio.
3. En **Advertiser redirect URL** pon una URL **HTTPS** de tu dominio, por ejemplo
   `https://tu-dominio.com/admin/campanas`. TikTok **no acepta `http://localhost`**, así que en
   local se usa igualmente la URL de producción y el `auth_code` se copia a mano de la barra de
   direcciones (paso 3).
4. En **Scope of permission** marca como mínimo:
   - `Ads Management` (leer campañas, grupos de anuncios y anuncios)
   - `Reporting` / `Ad Account Management` (leer los informes y los datos de la cuenta)
   - `Creative Management` (opcional: sólo para las miniaturas de los creativos)
5. Envía la app a revisión (**Submit**). Mientras está en *Pending* puedes seguir: una app sin
   aprobar ya funciona con las cuentas publicitarias de tu propio Business Center.
6. Copia el **App ID** y el **Secret** de *Basic Information*.

### Paso 2 — Poner las credenciales en el `.env`

```bash
TIKTOK_APP_ID=7412...           # Basic Information > App ID
TIKTOK_APP_SECRET=3f9c...       # Basic Information > Secret
TIKTOK_REDIRECT_URI=https://tu-dominio.com/admin/campanas
TIKTOK_ACCESS_TOKEN=            # se completa en el paso 4
TIKTOK_ADVERTISER_ID=           # opcional, ver paso 5
```

Reinicia el backend (`npm run dev`, o la app de Node en hPanel) para que lea las variables nuevas.

### Paso 3 — Autorizar la cuenta publicitaria

1. Pide la URL del portal de autorización al propio backend (necesitas estar logueado en el panel,
   con el permiso `leads.view`):

   ```bash
   curl -H "Authorization: Bearer <tu-JWT>" https://tu-dominio.com/api/campaigns/tiktok/auth-url
   # {"url":"https://business-api.tiktok.com/portal/auth?app_id=...&state=minirag&redirect_uri=..."}
   ```

   *(El JWT es el que guarda el panel en el navegador tras el login; se ve en DevTools →
   Application → Local Storage.)*

2. Abre esa URL en el navegador, inicia sesión con la cuenta que administra el Ads Manager y
   **marca la cuenta publicitaria** que quieres conectar. Confirma.
3. TikTok redirige a tu `redirect_uri` con el código en la barra de direcciones:

   ```
   https://tu-dominio.com/admin/campanas?auth_code=abc123...&code=abc123...&state=minirag
   ```

   Copia el valor de **`auth_code`**. Es de **un solo uso** y caduca en minutos: si te pasas de
   tiempo, repite este paso.

### Paso 4 — Canjear el código por el access token

```bash
curl -X POST https://tu-dominio.com/api/campaigns/tiktok/exchange-code \
  -H "Authorization: Bearer <tu-JWT>" \
  -H "Content-Type: application/json" \
  -d '{"authCode":"abc123..."}'
# {"accessToken":"a1b2c3...","advertiserIds":["6912345678901234567"],"scope":[...]}
```

Copia el `accessToken` a `TIKTOK_ACCESS_TOKEN` en el `.env` y reinicia el backend. El token **no
caduca**: sólo deja de servir si el anunciante revoca la app o se regenera el secret.

### Paso 5 — (Opcional) Fijar la cuenta publicitaria

Si el token autorizó **una sola** cuenta, déjalo así: el backend la descubre solo. Si autorizó
varias, el panel avisa (*«detectadas N cuentas, usando la primera»*) y conviene fijar cuál:

```bash
TIKTOK_ADVERTISER_ID=6912345678901234567   # del paso 4, o del Ads Manager (parámetro aadvid= de la URL)
```

### Paso 6 — Comprobar y sincronizar

1. Abre **Panel → Campañas**. Arriba debe aparecer el banner verde
   *🟢 Conectado a TikTok Ads · <nombre de la cuenta>*.
2. Elige el rango (Hoy / 7 / 30 / 90 días / Todo) y pulsa **↻ Sincronizar con TikTok**.
3. Al terminar verás el resumen: campañas, grupos, anuncios y cuántos trajeron métricas. Las
   campañas importadas aparecen con la insignia roja **TikTok Ads** y su miniatura del creativo.

La sincronización es manual y **idempotente**: se puede repetir cuantas veces haga falta, reescribe
las métricas de la ventana pedida y no duplica campañas (se reconocen por `external_id = tt:<id>`).

### Si algo falla

| Lo que dice el panel | Qué revisar |
| --- | --- |
| *No hay ningún token de TikTok configurado* | Falta `TIKTOK_ACCESS_TOKEN` en el `.env`, o el backend no se reinició tras editarlo. |
| *El token de TikTok dejó de ser válido* | Se revocó la autorización o se regeneró el secret: repite los pasos 3 y 4. |
| *El token no tiene acceso a ninguna cuenta publicitaria* | En el paso 3 no se marcó ninguna cuenta. Reautoriza marcándola, o define `TIKTOK_ADVERTISER_ID`. |
| *Falta configuración de TikTok* | Faltan `TIKTOK_APP_ID` / `TIKTOK_APP_SECRET` (hacen falta para descubrir la cuenta y para canjear el código). |
| Sincroniza pero todo sale en 0 | Normal si la campaña no tuvo entrega en la ventana elegida; prueba con *Todo*. TikTok tarda hasta unas horas en consolidar los datos del día en curso. |
| *Métricas completas rechazadas…* en el log | Aviso, no error: la cuenta no soporta alguna métrica avanzada y se reintentó con el juego mínimo (gasto, impresiones, clics, CTR, CPC, CPM). |

### Cómo se guarda

Las dos integraciones escriben en las **mismas columnas** de `campaigns` (`meta_insights`,
`meta_adsets_insights`, `meta_ads_insights`): las métricas ya normalizadas tienen idéntica forma en
Meta y en TikTok, así que el informe de rendimiento, la exportación a Excel y la vista funcionan
igual sin duplicar nada. Lo que distingue el origen es `campaigns.source` (`meta` | `tiktok` |
`manual`), y los `external_id` de TikTok van prefijados con `tt:` para que no puedan colisionar con
los de Meta. No hace falta ninguna migración para usar el módulo.
