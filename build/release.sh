#!/usr/bin/env bash
# 새 버전 배포: package.json 의 version 으로 Windows 설치 파일을 만들고 GitHub Release 에 올린다.
# 회사 PC 앱이 1시간마다 최신 Release 를 확인해서 자동 설치하고, 직원 PC는 회사 PC를 따라 업데이트된다.
# 필요: node, npm, makensis(NSIS 3), gh(로그인됨). wine 은 필요 없음.
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p "require('./package.json').version")
sed -i "s/^!define VERSION \".*\"/!define VERSION \"$VER\"/" build/installer.nsi
rm -rf dist
npx electron-builder --win dir --x64
node build/seticon.mjs dist/win-unpacked/SPACEBASE-Schedule.exe build-icon.ico "$VER"
MAKENSIS=${MAKENSIS:-makensis}
$MAKENSIS -V1 build/installer.nsi
gh release create "v$VER" "dist/SPACEBASE-Schedule-Setup-$VER.exe" --title "v$VER" --notes "${NOTES:-업데이트}"
echo "released v$VER"
