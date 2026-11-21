#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pitch Legends — universal Android APK build (no Gradle, no Android Studio).
#
# One APK for every Android version and device type we support:
#   * minSdk 21 (Android 5.0), targetSdk 34, no ABI splits (pure Java + WebView)
#   * phones, tablets, foldables, Chromebooks, Android TV, controllers, remotes
#
# The game is a single self-contained HTML page in assets/www (built by
# vite.android.config.js + inline-www.mjs). The activity is a full-screen WebView
# that loads file:///android_asset/www/index.html, so nothing is fetched over
# file:// — where module scripts and crossorigin stylesheets are CORS-blocked.
#
# Requirements (paths can be overridden with env vars):
#   AAPT2        aapt2 from build-tools / maven  (default /tmp/aapt2/aapt2)
#   ANDROID_JAR  platform android.jar, API 34    (default /tmp/android-all.jar)
#   R8_JAR       r8 jar                          (default /tmp/r8.jar)
#   BUILD_TOOLS  build-tools directory           (default /tmp/bt)
#   JDK          javac / keytool on PATH
#
# Usage: ./build-apk.sh [--debug|--release] [--fetch-tools]
#   --debug        (default) signed with a generated debug keystore (+v1 for
#                  Android 5/6, v2/v3 for 7+)
#   --release      needs KEYSTORE / KS_PASS / KS_ALIAS / KEY_PASS in the env
#   --fetch-tools  download the missing SDK tools into /tmp first
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

MODE=--debug
FETCH=0
for arg in "$@"; do
  case "$arg" in
    --debug|--release) MODE="$arg" ;;
    --fetch-tools) FETCH=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

AAPT2=${AAPT2:-/tmp/aapt2/aapt2}
ANDROID_JAR=${ANDROID_JAR:-/tmp/android-all.jar}
R8_JAR=${R8_JAR:-/tmp/r8.jar}
BUILD_TOOLS=${BUILD_TOOLS:-/tmp/bt}
OUT=../release

fetch_tools() {
  echo "==> fetching the Android toolchain into /tmp (aapt2, r8, platform 34, build-tools 34)"
  local dl=/tmp/pl-tools
  rm -rf "$dl"; mkdir -p "$dl"

  curl -sSL -o "$dl/aapt2.zip" \
    "https://dl.google.com/dl/android/maven2/com/android/tools/build/aapt2/8.6.1-11315950/aapt2-8.6.1-11315950-linux.jar"
  mkdir -p /tmp/aapt2 && (cd /tmp/aapt2 && unzip -o -q "$dl/aapt2.zip" && chmod +x aapt2)

  curl -sSL -o "$R8_JAR" "https://maven.google.com/com/android/tools/r8/8.9.35/r8-8.9.35.jar"

  curl -sSL -o "$dl/platform.zip" "https://dl.google.com/android/repository/platform-34-ext7_r03.zip"
  unzip -o -q "$dl/platform.zip" -d "$dl/platform"
  cp "$dl/platform/android-34/android.jar" "$ANDROID_JAR"

  curl -sSL -o "$dl/bt.zip" "https://dl.google.com/android/repository/build-tools_r34-linux.zip"
  unzip -o -q "$dl/bt.zip" -d "$dl"
  rm -rf "$BUILD_TOOLS" && mkdir -p "$BUILD_TOOLS" && cp -r "$dl"/android-14/* "$BUILD_TOOLS"/

  rm -rf "$dl"
  echo "==> toolchain ready"
}

need=0
for tool in "$AAPT2" "$ANDROID_JAR" "$R8_JAR" "$BUILD_TOOLS/zipalign" "$BUILD_TOOLS/apksigner"; do
  [ -e "$tool" ] || need=1
done
if [ "$need" = 1 ]; then
  if [ "$FETCH" = 1 ]; then
    fetch_tools
  else
    echo "missing Android SDK tools (aapt2 / android.jar / r8 / build-tools)." >&2
    echo "re-run with --fetch-tools, or point AAPT2/ANDROID_JAR/R8_JAR/BUILD_TOOLS at them." >&2
    exit 1
  fi
fi

echo "==> building the web bundle (ES2017 target for older WebViews)"
rm -rf build
# A file:// page has an opaque ("null") origin, where Chromium blocks module
# scripts and `crossorigin` stylesheets. So the APK gets its own IIFE build that
# inline-www.mjs folds into ONE index.html with no subresource requests.
(cd .. && npx vite build --config vite.android.config.js)
node inline-www.mjs ../build/www-iife build/www
rm -rf ../build/www-iife

echo "==> packaging resources"
mkdir -p build/gen build/classes build/dex
"$AAPT2" compile --dir res -o build/res.zip
"$AAPT2" link -I "$ANDROID_JAR" --manifest AndroidManifest.xml -o build/base.apk build/res.zip \
  --java build/gen --min-sdk-version 21 --target-sdk-version 34 \
  --version-code 14 --version-name 1.0.13

echo "==> compiling java + dexing (min-api 21)"
javac -encoding UTF-8 -source 11 -target 11 -classpath "$ANDROID_JAR" -d build/classes \
  $(find src build/gen -name '*.java')
java -cp "$R8_JAR" com.android.tools.r8.D8 --lib "$ANDROID_JAR" --min-api 21 \
  --output build/dex $(find build/classes -name '*.class')

echo "==> assembling the apk"
mkdir -p build/stage/unpacked
(cd build/stage/unpacked && unzip -o -q ../../base.apk && cp ../../dex/classes.dex . && \
  mkdir -p assets && cp -r ../../www assets/www)
python3 pack_apk.py
"$BUILD_TOOLS/zipalign" -f -p 4 build/unaligned.apk build/aligned.apk

echo "==> signing ($MODE)"
if [ "$MODE" = "--release" ]; then
  : "${KEYSTORE:?set KEYSTORE}"; : "${KS_PASS:?set KS_PASS}"
  : "${KS_ALIAS:?set KS_ALIAS}"; : "${KEY_PASS:?set KEY_PASS}"
  "$BUILD_TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" \
    --ks-key-alias "$KS_ALIAS" --key-pass "pass:$KEY_PASS" \
    --out build/signed.apk build/aligned.apk
  NAME="Pitch-Legends-1.0.13-universal.apk"
else
  KS="$HOME/.android/debug.keystore"
  if [ ! -f "$KS" ]; then
    mkdir -p "$(dirname "$KS")"
    keytool -genkeypair -keystore "$KS" -storepass android -keypass android \
      -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
      -dname "CN=Android Debug,O=Android,C=US"
  fi
  # v1 (JAR) is required for Android 5/6; v2/v3 are added automatically
  "$BUILD_TOOLS/apksigner" sign --ks "$KS" --ks-pass pass:android \
    --ks-key-alias androiddebugkey --key-pass pass:android \
    --min-sdk-version 21 \
    --out build/signed.apk build/aligned.apk
  NAME="Pitch-Legends-1.0.13-universal-debug.apk"
fi

"$BUILD_TOOLS/apksigner" verify build/signed.apk >/dev/null
"$BUILD_TOOLS/zipalign" -c -p 4 build/signed.apk >/dev/null
python3 verify_apk.py build/signed.apk

"$AAPT2" dump badging build/signed.apk | grep -E "^package:|^minSdkVersion|^targetSdkVersion|^native-code|^supports-screens|^supports-any-density" || true
mkdir -p "$OUT"
cp build/signed.apk "$OUT/$NAME"
echo "==> done: $OUT/$NAME"
