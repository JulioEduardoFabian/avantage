# Compila el APK de Android con las credenciales de Firebase y la URL del panel.
#
# Existe porque los `--dart-define` son siete y los identificadores de Firebase
# ya están escritos en `android/app/google-services.json`: tipearlos a mano cada
# vez es la forma de equivocarse en uno y pasar media hora buscando por qué el
# push "no llega" cuando lo que pasa es que el app id no es el de esta app.
#
# Uso:
#   .\build-apk.ps1                                    # localhost (cable, adb reverse)
#   .\build-apk.ps1 -ApiBaseUrl https://panel.tudominio.com
#   .\build-apk.ps1 -ApiBaseUrl http://192.168.18.15:3000 -Output "$HOME\Desktop\Avisos.apk"
#
# Ojo con HTTP: `android/app/src/main/res/xml/network_security_config.xml` solo
# permite tráfico sin cifrar a la lista de direcciones locales que tiene adentro.
# Una URL `http://` que no esté ahí falla con "CLEARTEXT communication not
# permitted". Con `https://` no hay nada que configurar.

param(
    [string]$ApiBaseUrl = "http://localhost:3000",
    [string]$Output = "",
    [switch]$Debug
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$googleServices = "android/app/google-services.json"
$defines = @("--dart-define=API_BASE_URL=$ApiBaseUrl")

if (Test-Path $googleServices) {
    $g = Get-Content $googleServices -Raw | ConvertFrom-Json
    $client = $g.client[0]
    $defines += "--dart-define=FIREBASE_PROJECT_ID=$($g.project_info.project_id)"
    $defines += "--dart-define=FIREBASE_SENDER_ID=$($g.project_info.project_number)"
    $defines += "--dart-define=FIREBASE_APP_ID_ANDROID=$($client.client_info.mobilesdk_app_id)"
    $defines += "--dart-define=FIREBASE_API_KEY=$($client.api_key[0].current_key)"
    if ($g.project_info.storage_bucket) {
        $defines += "--dart-define=FIREBASE_STORAGE_BUCKET=$($g.project_info.storage_bucket)"
    }
    # Sin caracteres no-ASCII en lo que se imprime: la consola de Windows usa
    # la codificacion ANSI del sistema y los muestra como mojibake.
    Write-Output "Firebase: proyecto $($g.project_info.project_id) / app $($client.client_info.android_client_info.package_name)"
} else {
    # No es un error: la app arranca sin Firebase y trabaja por sondeo. Pero se
    # dice, porque un APK sin push que se creía con push es un rato perdido.
    Write-Warning "No hay $googleServices. El APK va a quedar SIN push (solo sondeo mientras la app este abierta)."
    Write-Warning "Para activarlo: bajar google-services.json de la consola de Firebase a android/app/."
}

$mode = if ($Debug) { "--debug" } else { "--release" }
Write-Output "Panel: $ApiBaseUrl"
Write-Output "Compilando $mode ..."

& flutter build apk $mode @defines
if ($LASTEXITCODE -ne 0) { throw "La compilacion fallo con codigo $LASTEXITCODE" }

$apk = "build/app/outputs/flutter-apk/app-release.apk"
if ($Debug) { $apk = "build/app/outputs/flutter-apk/app-debug.apk" }

if ($Output) {
    Copy-Item $apk $Output -Force
    Write-Output "APK: $Output"
} else {
    Write-Output "APK: $(Resolve-Path $apk)"
}

Write-Output ""
Write-Output "Para instalarlo en un telefono con el cable conectado:"
Write-Output "  adb push `"$(if ($Output) { $Output } else { (Resolve-Path $apk).Path })`" /sdcard/Download/AvisosAvantage.apk"
Write-Output "  (y despues instalarlo tocandolo desde Archivos > Descargas: MIUI bloquea 'adb install')"
