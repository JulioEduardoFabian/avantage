plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")

    // Firebase: lee `android/app/google-services.json` y es lo que vuelve
    // resoluble el proyecto de Firebase desde el lado nativo. Va en pareja con
    // la línea de `android/settings.gradle.kts` y las dos EXIGEN ese archivo:
    // sin él la compilación falla con "File google-services.json is missing".
    // No está en el repo a propósito (es la configuración del proyecto de
    // Firebase de cada entorno, ver el `.gitignore`), así que una clonada nueva
    // lo baja de la consola o comenta las dos líneas — ahí la app compila igual
    // y trabaja por sondeo. Ver el README de mobile/.
    id("com.google.gms.google-services")
}

android {
    namespace = "pe.avantage.avantage_avisos"
    compileSdk = flutter.compileSdkVersion
    // Fijado a mano y no `flutter.ndkVersion`: los plugins de Firebase piden
    // un NDK más nuevo que el que trae este Flutter, y el build falla con
    // "requires Android NDK 27.0.12077973". Las versiones del NDK son
    // retrocompatibles, así que se usa la más alta que pide alguno.
    ndkVersion = "27.0.12077973"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
        // `flutter_local_notifications` usa las APIs de fecha/hora de Java 8,
        // que en Android viejo no existen: sin esto el build falla con
        // "requires core library desugaring to be enabled".
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        applicationId = "pe.avantage.avantage_avisos"
        // 24 y no el mínimo de Flutter: es lo que pide firebase_messaging.
        minSdk = 24
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // TODO: firmar con la clave de la empresa antes de publicar.
            // Mientras tanto se firma con la de debug para que
            // `flutter run --release` funcione.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

flutter {
    source = "../.."
}
