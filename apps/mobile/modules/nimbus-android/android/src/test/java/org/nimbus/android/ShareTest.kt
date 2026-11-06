package org.nimbus.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareTest {
  @Test fun otherAppsContentGrantsAreAccepted() {
    assertTrue(Share.acceptable("content", "com.android.providers.media.documents"))
    assertTrue(Share.acceptable("content", "com.whatsapp.provider.media"))
  }

  @Test fun fileUrisAndOurOwnAuthoritiesAreRefused() {
    assertFalse(Share.acceptable("file", ""))
    assertFalse(Share.acceptable("file", null))
    assertFalse(Share.acceptable("content", "org.nimbus.drive.documents"))
    assertFalse(Share.acceptable("content", "org.nimbus.drive.debug.documents"))
    assertFalse(Share.acceptable("http", "example.com"))
    assertFalse(Share.acceptable(null, null))
  }
}
