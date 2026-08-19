#!/bin/bash
# 루트의 웹 소스 파일들을 www/로 동기화하고 android/의 실제 빌드 자산까지 반영한다.
# 웹 배포용 루트 index.html은 건드리지 않는다 (GitHub Pages는 이 스크립트가 필요 없음).
set -e
cd "$(dirname "$0")"

# 버전 표시(version.js)를 이 스크립트 실행 시점의 실제 시각으로 자동 생성한다 - 예전엔 배포할
# 때마다 사람이 직접 시간 문자열을 손으로 적어넣었는데, 실제 시계를 안 보고 눈대중으로 적다 보니
# 시간이 안 맞거나 거꾸로 가는 등 이상하게 나오는 문제가 있었다. 이 Git Bash 환경은 TZ 시간대
# 데이터베이스가 없어 TZ=Asia/Seoul을 지정하면 오히려 UTC로 잘못 계산되므로(9시간 차이 발생),
# TZ를 지정하지 않은 기본 date(이 PC의 로컬 시간대=한국시간)를 그대로 쓴다.
cat > version.js <<VERSIONEOF
// 배포할 때마다 이 값을 갱신한다 - 홈 화면의 버전 표시가 최신 배포와 실제로 일치하는지
// 사용자가 눈으로 바로 확인할 수 있게 하기 위함(예전에 "배포했는데 안 보인다"가 실은
// 브라우저 캐시 문제였던 적이 있었음). build-android-www.sh가 실행 시점의 시각(이 PC 로컬시간=
// 한국시간)으로 자동 생성한다 - 손으로 직접 시간을 적지 않는다.
const APP_VERSION = "$(date '+%Y-%m-%d %H:%M')";
VERSIONEOF

cp index.html style.css app.js db.js auth.js firebase-config.js version.js \
   import.js client-import.js bldreg.js ai-fill.js hwpx-export.js drive.js ui.js www/
mkdir -p www/templates
cp templates/completion-report-template.hwpx www/templates/

npx cap copy android

echo "www/ synced for Android build, and copied into android/app/src/main/assets/public via 'cap copy' (Gradle bundles that directory, NOT the top-level www/ - skipping this step ships a stale APK with no error or warning)."
