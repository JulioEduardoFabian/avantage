# Avisos Avantage — app multiplataforma de notificaciones

App Flutter que recibe en el dispositivo las **mismas notificaciones que la
campana del panel** (`notifications`): reuniones que agenda Avan, pagos
verificados, proyectos nuevos, comprobantes del cliente, entregables liberados,
los avisos del bot de WhatsApp y los que el equipo se escribe a mano desde
`/admin/avisos`.

No es un CRM en el celular: entra con la misma cuenta del panel, muestra la
lista de avisos, marca leído y, cuando un aviso trae enlace, **abre esa pantalla
del panel en el navegador**. Lo que agrega es la parte que el panel no puede
dar: el aviso en el teléfono cuando pasa, sin tener una pestaña abierta.

```
Panel (backend/)                                   App (mobile/)
─────────────────────────────────────────────────  ──────────────────────────
notificationService.create()   ← punto único
        │
        ├─ fila en `notifications`  ───────────→   GET /api/notifications
        └─ pushService.sendForNotification()
                 │ FCM HTTP v1
                 └──────────────────────────────→  push → aviso del sistema
```

## Lo primero: arranca sin Firebase

La app **funciona sin configurar nada de Firebase**. Sin credenciales, y en
Windows y Linux siempre, trabaja por **sondeo**: pregunta al panel cada 45 s
mientras está abierta y dibuja el aviso con el notificador del sistema. Con
Firebase configurado pasa a **push de verdad**, que llega con la app cerrada.

Cuál de los dos está activo, y por qué, lo dice la pantalla **Estado de los
avisos** (el icono de nube arriba a la derecha). Eso es a propósito: «no me
llega nada» tiene cinco causas —el permiso del sistema, las credenciales de la
app, las del servidor, la plataforma sin FCM, o que no pasó nada— que se
arreglan en cinco lugares distintos y que sin esa pantalla se ven todas igual:
una lista vacía.

## Correrla

```bash
cd mobile
flutter pub get

# Con el backend en la misma máquina y el emulador de Android:
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000

# Con un teléfono de verdad en la red local (la IP de la máquina, no localhost):
flutter run --dart-define=API_BASE_URL=http://192.168.1.50:3000

# Contra el panel en producción:
flutter run --dart-define=API_BASE_URL=https://panel.tudominio.com
```

`10.0.2.2` es cómo el emulador de Android ve el `localhost` de la máquina que lo
hospeda; con `localhost` a secas la app busca el servidor **dentro** del
emulador y falla con un «connection refused» que parece un problema del backend.

Otras variables (todas opcionales):

| `--dart-define` | Para qué |
|---|---|
| `API_BASE_URL` | El panel al que se conecta. Por defecto `http://10.0.2.2:3000`. |
| `POLL_SECONDS` | Cada cuánto sondea. Por defecto 45. |
| `FIREBASE_VAPID_KEY` | Solo la **web** la necesita (ver abajo). |

## Encender el push de verdad (Firebase)

Son dos mitades y las dos tienen que estar: **el servidor** (quién empuja) y
**la app** (quién recibe). Si falta una, el estado lo dice.

### 1. El proyecto de Firebase

1. [console.firebase.google.com](https://console.firebase.google.com) → crear o
   abrir el proyecto.
2. Agregar las apps que se vayan a usar (Android / iOS / Web) con el id
   `pe.avantage.avantage_avisos`.

### 2. El servidor

Configuración del proyecto → **Cuentas de servicio** → «Generar nueva clave
privada». Eso descarga un JSON; sus tres campos van al `.env` del backend:

```bash
FCM_PROJECT_ID=...
FCM_CLIENT_EMAIL=...
FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

(o `FCM_SERVICE_ACCOUNT_JSON` con el JSON entero, o `FCM_SERVICE_ACCOUNT_FILE`
con la ruta — ver `.env.example`.) **Eso sí es un secreto**: no va al repo.

Y la migración, que crea la tabla de dispositivos:

```bash
npm run migrate
```

### 3. La app

Los identificadores de las apps (Configuración del proyecto → «Tus apps») son
**públicos** —viajan dentro del binario de cualquier app de Firebase— y se
pasan al compilar:

```bash
flutter run \
  --dart-define=API_BASE_URL=https://panel.tudominio.com \
  --dart-define=FIREBASE_PROJECT_ID=avantage-crm \
  --dart-define=FIREBASE_API_KEY=AIza... \
  --dart-define=FIREBASE_SENDER_ID=1234567890 \
  --dart-define=FIREBASE_APP_ID_ANDROID=1:1234567890:android:abc \
  --dart-define=FIREBASE_APP_ID_IOS=1:1234567890:ios:abc \
  --dart-define=FIREBASE_APP_ID_WEB=1:1234567890:web:abc
```

Para **Android** hace falta además `google-services.json` (Configuración del
proyecto → tu app Android → «Descargar google-services.json») en
`android/app/`. Ese archivo **no está en el repo** —es la configuración del
proyecto de Firebase de cada entorno, ver el `.gitignore`— y el plugin de Google
Services, que sí está activo en `android/settings.gradle.kts` y
`android/app/build.gradle.kts`, **exige que exista**: sin él la compilación falla
con «File google-services.json is missing». En una clonada nueva, entonces: o se
baja de la consola, o se comentan esas dos líneas y la app compila igual y
trabaja por sondeo.

Para **web**, además, la clave VAPID (Cloud Messaging → «Certificados push
web») en `--dart-define=FIREBASE_VAPID_KEY=...`: sin ella `getToken()` falla en
el navegador y esa plataforma se queda sin push aunque todo lo demás esté bien.

### 4. Comprobarlo

En la app: **Estado de los avisos → «Enviarme una notificación de prueba»**. Va
solo a los dispositivos de esa cuenta y **no deja nada en la campana del
panel**: comprueba la cadena completa (servidor → Firebase → este aparato) sin
esperar a que alguien agende una reunión. Si falla, el mensaje dice en qué
mitad.

> `flutterfire configure` también sirve: genera `lib/firebase_options.dart` con
> los mismos valores y esta app es compatible con ese archivo (la misma clase,
> el mismo `currentPlatform`), así que puede sobrescribir el nuestro sin tocar
> nada más.

## Las plataformas, una por una

| Plataforma | Push | Compilada y verificada |
|---|---|---|
| Android | Sí (FCM) | ✅ probada en un Redmi Note 13 Pro: login, registro del dispositivo, aviso publicado por el sistema (ver «Probar en un teléfono de verdad») |
| Web | Sí (FCM + service worker) | ✅ `flutter build web --release` |
| iOS | Sí (FCM, pide certificado APNs en Firebase) | ❌ necesita macOS |
| macOS | Sí (FCM) | ❌ necesita macOS |
| Windows | **No**: sondeo | ⚠️ pide «Modo de desarrollador» de Windows |
| Linux | **No**: sondeo | ❌ no se compiló desde Windows |

Windows y Linux **no tienen FCM** —no es que falte configurarlo, el SDK de
Firebase no los soporta— así que ahí los avisos llegan por sondeo y solo
mientras la app esté abierta. La app lo dice en pantalla en vez de quedarse
muda. Para compilar en Windows: `start ms-settings:developers` → activar «Modo
de desarrollador» (Flutter necesita enlaces simbólicos para los plugins).

`minSdk` es **24** (lo pide `firebase_messaging`) y el NDK está fijado en
`27.0.12077973` (lo piden los plugins de Firebase, y las versiones del NDK son
retrocompatibles).

## Cómo está armado

```
lib/
  app_config.dart          URL del panel y constantes, todo por --dart-define
  firebase_options.dart    credenciales de Firebase (compatible con flutterfire)
  models/                  AppNotification, Session
  data/
    api_client.dart        el Bearer y el 401, en un solo sitio
    repositories.dart      auth · notificaciones · dispositivos
  push/
    push_gateway.dart      elige FCM o sondeo, y lo mantiene
    local_notifier.dart    quien DIBUJA el aviso en el sistema operativo
    device_identity.dart   qué aparato es este
  state/app_state.dart     sesión + lista + estado del push
  ui/                      login · lista · estado de los avisos
```

Tres decisiones que conviene no deshacer:

- **El `LocalNotifier` hace falta incluso teniendo FCM.** Con la app en primer
  plano Android **no dibuja nada**: el bloque `notification` del push solo lo
  pinta el sistema cuando la app está en segundo plano o cerrada. Sin esto, el
  aviso no existe para quien está mirando la pantalla.
- **El canal de Android se crea a mano al arrancar.** En Android el sonido y la
  importancia de un canal quedan congelados la primera vez y no se pueden
  cambiar sin desinstalar la app; si lo crea Android solo (porque el
  `channel_id` del push todavía no existía) queda con importancia por defecto y
  **nunca más suena**. El id tiene que ser el mismo en tres lugares:
  `AppConfig.androidChannelId`, el `meta-data` del `AndroidManifest.xml` y
  `ANDROID_CHANNEL_ID` de `backend/services/pushService.js`.
- **El id del aviso del sistema es el id de la notificación del panel**, no un
  contador: así el mismo aviso llegado por push y encontrado después por el
  sondeo **se reemplaza** en vez de apilarse. Sin eso, una conexión que se
  recupera deja la barra con diez copias de lo mismo.

Y dos del sondeo:

- La marca de agua es el **id más alto visto**, guardado en el dispositivo, y no
  «no leída»: un aviso que alguien ya leyó desde el panel web sigue sin leer
  para esta app, y el teléfono empezaría a avisar de cosas viejas cada vez que
  se abre.
- La **primera** vuelta de una instalación toma nota y **no avisa**: si no, al
  entrar por primera vez salen treinta avisos de golpe de cosas de la semana
  pasada.

## Qué le pide al backend

Todas con `requireAuth` y sin permiso propio, igual que `/api/notifications`:
lo que se empuja es exactamente lo que esa persona ya puede leer en la campana.

| Ruta | Para qué |
|---|---|
| `POST /api/auth/login`, `GET /api/auth/me` | entrar y revalidar la sesión |
| `GET /api/notifications`, `.../unread-count` | la lista y el badge |
| `POST /api/notifications/:id/read`, `.../read-all` | marcar leído |
| `GET /api/push/status` | si el servidor tiene credenciales de Firebase |
| `POST /api/devices`, `.../unregister`, `.../ping` | registrar este aparato |
| `GET /api/devices` | los dispositivos de la propia cuenta |
| `POST /api/push/test` | el envío de prueba |

## Probar en un teléfono de verdad

Lo de abajo salió de hacerlo el 13/11/2026 contra un Redmi Note 13 Pro
(`2312DRA50G`) y una red de oficina. Los tres obstáculos que aparecieron no
tienen nada que ver con la app y cada uno se ve como si la app estuviera rota.

### El router de la oficina puede no dejar pasar nada

Síntoma: `ClientException with SocketException: No route to host (errno 113)`
al hacer login, con el teléfono y la PC **en la misma Wi-Fi y en el mismo
rango** (`192.168.18.x` los dos).

Eso es **aislamiento de clientes** (AP isolation) en el router: bloquea el
tráfico entre dispositivos de la misma red. No es el firewall de Windows —ese
daría «connection refused»— ni el puerto. Por Wi-Fi local no se puede, y
cambiarlo es configuración del router.

La salida sin tocar la red es el **cable**: `adb reverse` hace que el
`localhost` del teléfono sea la PC.

```bash
adb reverse tcp:3000 tcp:3000
# comprobar DESDE el teléfono:
adb shell "curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:3000/api/notifications"
# tiene que decir HTTP 401 (pide token = llegó al backend)
```

Y el APK se compila apuntando a `localhost`, que ya está en la lista de
`network_security_config.xml`:

```bash
flutter build apk --release --dart-define=API_BASE_URL=http://localhost:3000
```

El túnel vive mientras el cable esté conectado; al desenchufarlo hay que
rearmarlo. **El push NO lo necesita**: viaja de los servidores de Google al
teléfono por su propio internet. El cable solo es para que la app hable con
nuestro backend (login, lista, marcar leído).

### MIUI / HyperOS dice «Success» y no instala nada

Síntoma: `adb install` responde `Success` y el paquete **no aparece** en
`adb shell pm list packages`.

Es la protección «Instalar vía USB» de MIUI. En vez de pelearla, se copia el
APK al teléfono y se instala tocándolo:

```bash
# desde PowerShell (Git Bash convierte /sdcard en una ruta de Windows)
adb push "C:\ruta\al\app-release.apk" /sdcard/Download/AvisosAvantage.apk
```

Después, en el teléfono: Archivos → Descargas → tocar el APK. MIUI pone una
pantalla de permiso de fuente desconocida y un análisis de seguridad con cuenta
atrás; las dos se aceptan.

### MIUI mata la app en segundo plano

Si el push no llega con la app cerrada, es el primer sospechoso. En el teléfono:
Ajustes → Apps → Avisos Avantage → **Ahorro de batería: «Sin restricciones»**, y
**Autoarranque** activado. Es el ajuste del que depende que FCM pueda despertar
la app, y MIUI lo pone restrictivo por defecto.

### Comprobar sin mirar el teléfono

El sistema operativo dice la verdad sobre lo que se publicó:

```bash
# ¿se publicó el aviso #13 en la barra?
adb shell dumpsys notification --noredact | grep "id=13 tag=null"

# título y cuerpo de lo que se mostró
adb shell dumpsys notification --noredact | grep -A40 "id=13 tag=null" | grep "android.title\|android.text"

# ¿el canal quedó con la importancia correcta? (mImportance=4 es alta)
adb shell dumpsys notification --noredact | grep "mId='avantage_avisos'"
```

**Ojo con un falso positivo**: `grep pe.avantage.avantage_avisos` a secas
también coincide con la sección de *ajustes* de canales, que está ahí aunque no
haya ningún aviso publicado. Hay que buscar el `NotificationRecord` con su
`id=`, que es el id de la notificación del panel.

### Disparar un aviso de prueba

```bash
node backend/scripts/avisoDePrueba.js "Reunión agendada" "Rafael Gonzales · hoy 4:30 p.m."
```

Pasa por `notificationService.create()`, o sea el mismo camino que el bot y
Finanzas, y de paso imprime si el servidor tiene credenciales y cuántos
dispositivos hay registrados — las dos preguntas que uno se hace cuando no
llega nada.

## Lo que todavía no está verificado

- **iOS y macOS no se compilaron**: hace falta macOS. iOS pide además subir el
  certificado APNs al proyecto de Firebase; sin eso el push no llega aunque el
  token se registre.
- **El push real no se probó de punta a punta**: este entorno no tiene un
  proyecto de Firebase. La forma del payload sale de la documentación de FCM
  HTTP v1, y las reglas que sí se pueden comprobar sin credenciales están en
  `backend/services/__tests__/pushService.test.js` (16 pruebas: el formato del
  mensaje, la lectura de las credenciales y —la que más importa— que un 401/403
  del servidor **no** dé de baja los tokens de todo el equipo). El primer envío
  de verdad hay que mirarlo con el botón de prueba en la mano.
- **El token de sesión se guarda en `shared_preferences`**, que no está
  cifrado. Es un JWT de 8 h, no una contraseña, y así las seis plataformas
  funcionan igual; `flutter_secure_storage` es el paso siguiente si hace falta
  (en Linux arrastra `libsecret`).

## Pruebas

```bash
flutter analyze   # sin avisos
flutter test      # 12 pruebas de los modelos y del formato de las fechas
```
