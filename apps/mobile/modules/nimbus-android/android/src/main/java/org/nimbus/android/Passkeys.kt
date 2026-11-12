package org.nimbus.android

import android.app.Activity
import androidx.core.content.ContextCompat
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException

// Android's Credential Manager for passkeys. Both calls take the server's WebAuthn options as JSON and
// resolve with the WebAuthn response JSON, or null when the person closes the sheet.
object Passkeys {
  fun create(activity: Activity?, requestJson: String, promise: Promise) {
    val a = activity ?: return promise.reject(CodedException("Passkeys aren't available here."))
    CredentialManager.create(a).createCredentialAsync(
      a, CreatePublicKeyCredentialRequest(requestJson), null, ContextCompat.getMainExecutor(a),
      object : CredentialManagerCallback<androidx.credentials.CreateCredentialResponse, CreateCredentialException> {
        override fun onResult(result: androidx.credentials.CreateCredentialResponse) {
          val json = (result as? CreatePublicKeyCredentialResponse)?.registrationResponseJson
          if (json != null) promise.resolve(json) else promise.reject(CodedException("That didn't make a passkey."))
        }
        override fun onError(e: CreateCredentialException) {
          if (e is CreateCredentialCancellationException) promise.resolve(null)
          else promise.reject(CodedException(e.message ?: "Couldn't create the passkey."))
        }
      }
    )
  }

  fun get(activity: Activity?, requestJson: String, promise: Promise) {
    val a = activity ?: return promise.reject(CodedException("Passkeys aren't available here."))
    CredentialManager.create(a).getCredentialAsync(
      a, GetCredentialRequest(listOf(GetPublicKeyCredentialOption(requestJson))), null, ContextCompat.getMainExecutor(a),
      object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
        override fun onResult(result: GetCredentialResponse) {
          val json = (result.credential as? PublicKeyCredential)?.authenticationResponseJson
          if (json != null) promise.resolve(json) else promise.reject(CodedException("That wasn't a passkey."))
        }
        override fun onError(e: GetCredentialException) {
          when (e) {
            is GetCredentialCancellationException -> promise.resolve(null)
            is NoCredentialException -> promise.reject(CodedException("No passkey for this server on this phone."))
            else -> promise.reject(CodedException(e.message ?: "Couldn't use the passkey."))
          }
        }
      }
    )
  }
}
