// Release signing and per-ABI APKs, applied to android/app/build.gradle at every prebuild.
// Keystore: env NIMBUS_KEYSTORE_FILE / NIMBUS_KEYSTORE_PASSWORD / NIMBUS_KEY_ALIAS / NIMBUS_KEY_PASSWORD,
// else ~/.nimbus/release.properties (storeFile, storePassword, keyAlias, keyPassword). With neither, the
// release build keeps the debug key so it still builds.
const { withAppBuildGradle } = require("expo/config-plugins")

const MARK = "// nimbus-release-signing"

// Before `android {`: where the keystore comes from, and the versionCode for each split.
const HEAD = `${MARK}
def nimbusProps = new Properties()
def nimbusPropsFile = new File(System.getProperty("user.home"), ".nimbus/release.properties")
if (nimbusPropsFile.exists()) nimbusPropsFile.withInputStream { nimbusProps.load(it) }
def nimbusSecret = { String env, String key -> System.getenv(env) ?: nimbusProps.getProperty(key) }
def nimbusStore = nimbusSecret("NIMBUS_KEYSTORE_FILE", "storeFile")

// versionCode * 10 + the ABI's number; the universal APK is versionCode * 10.
def nimbusAbiCodes = ["armeabi-v7a": 1, "arm64-v8a": 2, "x86_64": 3]
androidComponents {
    onVariants(selector().all()) { variant ->
        variant.outputs.each { output ->
            def abi = output.filters.find { it.filterType.name() == "ABI" }?.identifier
            output.versionCode.set((output.versionCode.orNull ?: 1) * 10 + (nimbusAbiCodes[abi] ?: 0))
        }
    }
}

`

const SIGNING = `signingConfigs {
        if (nimbusStore) {
            release {
                storeFile new File(nimbusStore)
                storePassword nimbusSecret("NIMBUS_KEYSTORE_PASSWORD", "storePassword")
                keyAlias nimbusSecret("NIMBUS_KEY_ALIAS", "keyAlias")
                keyPassword nimbusSecret("NIMBUS_KEY_PASSWORD", "keyPassword")
            }
        }`

// One APK per ABI plus a universal one, only for release builds so debug builds stay as they were.
const SPLITS = `splits {
        abi {
            enable gradle.startParameter.taskNames.any { it.toLowerCase().contains("release") }
            reset()
            include "arm64-v8a", "armeabi-v7a", "x86_64"
            universalApk true
        }
    }
    packagingOptions {`

function swap(text, from, to) {
  if (!text.includes(from)) throw new Error(`release-signing: expected "${from}" in android/app/build.gradle`)
  return text.replace(from, to)
}

function patch(g) {
  if (g.includes(MARK)) return g
  g = swap(g, "android {\n    ndkVersion", `${HEAD}android {\n    ndkVersion`)
  g = swap(g, "signingConfigs {", SIGNING)
  g = swap(
    g,
    "signingConfig signingConfigs.debug\n            def enableShrinkResources",
    "signingConfig nimbusStore ? signingConfigs.release : signingConfigs.debug\n            def enableShrinkResources"
  )
  return swap(g, "    packagingOptions {", `    ${SPLITS}`)
}

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    c.modResults.contents = patch(c.modResults.contents)
    return c
  })
module.exports.patch = patch
