pluginManagement {
    val flutterSdkPath = run {
        val properties = java.util.Properties()
        file("local.properties").inputStream().use { properties.load(it) }
        val flutterSdkPath = properties.getProperty("flutter.sdk")
        require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
        flutterSdkPath
    }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
    // La otra mitad de la configuración de Firebase (la otra está en
    // `app/build.gradle.kts`). Las dos van juntas, y las dos EXIGEN que exista
    // `android/app/google-services.json`: sin él la compilación falla con
    // "File google-services.json is missing". Ese archivo no está en el repo a
    // propósito —es la configuración del proyecto de Firebase de cada entorno,
    // ver el `.gitignore`— así que una clonada nueva lo baja de la consola (ver
    // el README de mobile/) o comenta estas dos líneas, y ahí la app compila
    // igual y trabaja por sondeo.
    id("com.google.gms.google-services") version "4.4.2" apply false
}

include(":app")
