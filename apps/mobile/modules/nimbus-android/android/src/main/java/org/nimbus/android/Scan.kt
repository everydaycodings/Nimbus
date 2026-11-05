package org.nimbus.android

import android.app.Activity
import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import expo.modules.kotlin.Promise

// Google's document scanner: runs on the phone, but comes through Play services, so it's only
// offered where they're installed.
object Scan {
  const val REQUEST = 4102
  private var waiting: Promise? = null

  fun available(context: Context) =
    GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

  fun start(activity: Activity, promise: Promise) {
    val options = GmsDocumentScannerOptions.Builder()
      .setGalleryImportAllowed(true)
      .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_PDF)
      .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
      .build()
    GmsDocumentScanning.getClient(options).getStartScanIntent(activity)
      .addOnSuccessListener { sender ->
        waiting?.resolve(null)
        waiting = promise
        activity.startIntentSenderForResult(sender, REQUEST, null, 0, 0, 0)
      }
      .addOnFailureListener { promise.reject("ERR_SCAN", "The scanner couldn't start. Try again.", it) }
  }

  // Null: the person backed out.
  fun result(resultCode: Int, data: android.content.Intent?) {
    val promise = waiting ?: return
    waiting = null
    val pdf = if (resultCode == Activity.RESULT_OK) GmsDocumentScanningResult.fromActivityResultIntent(data)?.pdf?.uri else null
    promise.resolve(pdf?.toString())
  }
}
