plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.freedomfi.sms"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.freedomfi.sms"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // The web app (index.html + parser) lives one folder above /android.
    // It is copied into the APK at build time so the app and the website never drift apart.
    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/web"))
}

val syncWeb by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile) { include("index.html", "mobile-money-parser.js") }
    into(layout.buildDirectory.dir("generated/web"))
}
tasks.configureEach {
    if (name.startsWith("merge") && name.endsWith("Assets")) dependsOn(syncWeb)
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
}
