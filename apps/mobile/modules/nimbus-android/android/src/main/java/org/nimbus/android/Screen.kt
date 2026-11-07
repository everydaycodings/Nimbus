package org.nimbus.android

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.media.AudioManager
import android.provider.Settings
import android.view.OrientationEventListener
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kotlin.math.roundToInt

// What the video player asks of the screen: rotation, system bars, brightness and volume.
object Screen {
  private var watcher: OrientationEventListener? = null

  // "auto" follows the phone (the app's default), "lock" keeps whatever it is now.
  // With `release`, a forced landscape or portrait is handed back to the phone once it's held
  // that way, so turning it again undoes it.
  fun orient(a: Activity, mode: String, release: Boolean) = a.runOnUiThread {
    watcher?.disable()
    watcher = null
    a.requestedOrientation = when (mode) {
      "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
      "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
      "lock" -> ActivityInfo.SCREEN_ORIENTATION_LOCKED
      else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
    if (!release || (mode != "landscape" && mode != "portrait")) return@runOnUiThread
    // With auto-rotate off, handing it back would snap straight to portrait: it stays until the button undoes it.
    if (Settings.System.getInt(a.contentResolver, Settings.System.ACCELEROMETER_ROTATION, 0) != 1) return@runOnUiThread
    watcher = object : OrientationEventListener(a) {
      override fun onOrientationChanged(deg: Int) {
        if (deg == ORIENTATION_UNKNOWN) return
        val upright = deg <= 15 || deg >= 345 || deg in 165..195
        val sideways = deg in 75..105 || deg in 255..285
        if ((mode == "portrait" && upright) || (mode == "landscape" && sideways)) {
          disable()
          watcher = null
          a.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
      }
    }.also { if (it.canDetectOrientation()) it.enable() }
  }

  // Hides the status and navigation bars; a swipe from the edge shows them for a moment.
  fun immersive(a: Activity, on: Boolean) = a.runOnUiThread {
    val bars = WindowCompat.getInsetsController(a.window, a.window.decorView)
    if (on) {
      bars.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      bars.hide(WindowInsetsCompat.Type.systemBars())
    } else bars.show(WindowInsetsCompat.Type.systemBars())
  }

  // 0..1. This window only: the system setting is left alone. -1 hands it back to the system.
  fun brightness(a: Activity): Double {
    val own = a.window.attributes.screenBrightness
    if (own >= 0) return own.toDouble()
    return Settings.System.getInt(a.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128) / 255.0
  }

  fun setBrightness(a: Activity, v: Double) = a.runOnUiThread {
    val attrs = a.window.attributes
    attrs.screenBrightness = if (v < 0) -1f else v.toFloat().coerceIn(0.01f, 1f)
    a.window.attributes = attrs
  }

  // 0..1 of the media volume, without the system's volume panel.
  fun volume(c: Context): Double {
    val am = c.getSystemService(AudioManager::class.java)
    return am.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
  }

  fun setVolume(c: Context, v: Double) {
    val am = c.getSystemService(AudioManager::class.java)
    val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    am.setStreamVolume(AudioManager.STREAM_MUSIC, (v.coerceIn(0.0, 1.0) * max).roundToInt(), 0)
  }
}
