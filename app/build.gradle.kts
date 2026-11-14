plugins {
    id("com.android.application")
}

android {
    namespace = "pl.michalbeer.szachy"
    compileSdk = 35

    defaultConfig {
        applicationId = "pl.michalbeer.szachy"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    signingConfigs {
        create("release") {
            // Klucz w repozytorium: aplikacja hobbystyczna, stały podpis pozwala instalować aktualizacje.
            storeFile = file("kosci.keystore")
            storePassword = "kosci123"
            keyAlias = "kosci"
            keyPassword = "kosci123"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.android.gms:play-services-nearby:19.3.0")
}
