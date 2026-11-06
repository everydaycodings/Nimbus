#!/usr/bin/env bash
# Builds the signed release APKs: one per phone architecture plus a universal one.
#   npm run release:android
# Signs with NIMBUS_KEYSTORE_FILE (+ _PASSWORD, NIMBUS_KEY_ALIAS, NIMBUS_KEY_PASSWORD) or ~/.nimbus/release.properties.
# With neither, makes a keystore once. Outputs: apps/mobile/dist/nimbus-<version>-<abi>.apk, copied to apps/web/android/.
set -euo pipefail
cd "$(dirname "$0")/.."

export JAVA_HOME="${JAVA_HOME:-$HOME/Android/jdk}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$JAVA_HOME/bin:$PATH"

PROPS="$HOME/.nimbus/release.properties"
if [ -z "${NIMBUS_KEYSTORE_FILE:-}" ] && [ ! -f "$PROPS" ]; then
  mkdir -p "$HOME/.nimbus"
  JKS="$HOME/.nimbus/nimbus-release.jks"
  [ -e "$JKS" ] && { echo "$JKS exists but $PROPS doesn't; refusing to overwrite a keystore." >&2; exit 1; }
  PASS="$(openssl rand -hex 16)"
  keytool -genkeypair -v -keystore "$JKS" -storetype PKCS12 -storepass "$PASS" -keypass "$PASS" \
    -alias nimbus -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Nimbus, O=Nimbus"
  (umask 077; printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=nimbus\nkeyPassword=%s\n' "$JKS" "$PASS" "$PASS" > "$PROPS")
  chmod 600 "$PROPS"
  cat >&2 <<WARN

############################################################################
#  BACK THIS UP NOW:  $JKS
#                     $PROPS
#  Every update must be signed with this exact key. If it is lost, nobody
#  can update the app: they would have to uninstall it and lose local data.
#  Keep a copy somewhere safe and private (never in git).
############################################################################

WARN
fi

VERSION="$(node -p "require('./app.json').expo.version")"

npm run viewers
CI=1 npx expo prebuild --platform android --no-install
(
  cd android
  ./gradlew assembleRelease --max-workers=3 -PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64
  ./gradlew --stop
)

OUT=android/app/build/outputs/apk/release
mkdir -p dist ../web/android
for abi in arm64-v8a armeabi-v7a x86_64 universal; do
  src="$OUT/app-$abi-release.apk"
  [ -f "$src" ] || { echo "Missing $src" >&2; exit 1; }
  cp "$src" "dist/nimbus-$VERSION-$abi.apk"
  cp "$src" "../web/android/nimbus-$VERSION-$abi.apk"
done
echo "Done: $(ls dist | grep "nimbus-$VERSION")"
