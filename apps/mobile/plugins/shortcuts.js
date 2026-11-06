// App shortcuts and direct share (Phase 9): points MainActivity at the shortcuts file in the
// nimbus-android module (res/xml/nimbus_shortcuts.xml), which hard-codes org.nimbus.drive.MainActivity.
const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins")

module.exports = (config) =>
  withAndroidManifest(config, (c) => {
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(c.modResults)
    main["meta-data"] = (main["meta-data"] ?? []).filter((m) => m.$["android:name"] !== "android.app.shortcuts")
    main["meta-data"].push({ $: { "android:name": "android.app.shortcuts", "android:resource": "@xml/nimbus_shortcuts" } })
    return c
  })
