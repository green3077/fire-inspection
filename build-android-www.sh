#!/bin/bash
# 루트의 웹 소스 파일들을 www/로 동기화하고 android/의 실제 빌드 자산까지 반영한다.
# 웹 배포용 루트 index.html은 건드리지 않는다 (GitHub Pages는 이 스크립트가 필요 없음).
set -e
cd "$(dirname "$0")"

cp index.html style.css app.js db.js auth.js firebase-config.js version.js \
   import.js client-import.js bldreg.js ai-fill.js hwpx-export.js drive.js ui.js www/
mkdir -p www/templates
cp templates/completion-report-template.hwpx www/templates/

npx cap copy android

echo "www/ synced for Android build, and copied into android/app/src/main/assets/public via 'cap copy' (Gradle bundles that directory, NOT the top-level www/ - skipping this step ships a stale APK with no error or warning)."
