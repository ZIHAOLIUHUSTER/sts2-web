#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_dir"
sdk_dir="${ANDROID_HOME:-/workspace/.android-sdk}"
tools_dir="$sdk_dir/build-tools/35.0.0"
android_jar="$sdk_dir/platforms/android-35/android.jar"
export PATH="/workspace/.onboarding/tools/node_modules/.bin:$PATH"
for tool in aapt d8 zipalign apksigner; do
  test -x "$tools_dir/$tool" || { echo "Missing Android SDK tool: $tools_dir/$tool" >&2; exit 1; }
done
test -f "$android_jar"
if [[ "${SKIP_WEB_BUILD:-0}" != 1 ]]; then pnpm build; fi
test -f packages/app/dist/index.html
mkdir -p android/build/classes android/build/dex android/build/assets
rm -rf android/build/assets/web
cp -a packages/app/dist android/build/assets/web
find android/build/classes android/build/dex -type f -delete
java -m jdk.compiler/com.sun.tools.javac.Main -source 8 -target 8 -bootclasspath "$android_jar" -d android/build/classes android/src/com/sts2web/game/MainActivity.java
mapfile -t class_files < <(find android/build/classes -name '*.class')
"$tools_dir/d8" --lib "$android_jar" --min-api 26 --output android/build/dex "${class_files[@]}"
"$tools_dir/aapt" package -f -M android/AndroidManifest.xml -I "$android_jar" -A android/build/assets -0 '' -F android/build/unsigned.apk
(cd android/build/dex && zip -q ../unsigned.apk classes.dex)
"$tools_dir/zipalign" -f 4 android/build/unsigned.apk android/build/aligned.apk
# Retain this local debug key so subsequent builds can update this APK without clearing saves.
if [[ ! -f android/build/debug.keystore ]]; then
  keytool -genkeypair -noprompt -keystore android/build/debug.keystore -storepass android -keypass android \
    -alias androiddebugkey -dname 'CN=Android Debug,O=Android,C=US' -keyalg RSA -keysize 2048 -validity 10000
fi
"$tools_dir/apksigner" sign --ks android/build/debug.keystore --ks-pass pass:android --out android/build/sts2-web-debug.apk android/build/aligned.apk
"$tools_dir/apksigner" verify --verbose android/build/sts2-web-debug.apk
echo "APK: $repo_dir/android/build/sts2-web-debug.apk"
