#!/usr/bin/env bash
# 로컬에서 Windows 설치 파일만 만들 때 사용 (배포는 GitHub Actions 가 main 푸시 때 자동으로 한다).
# 필요: node, npm, makensis(NSIS 3). wine 은 필요 없음.
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p "require('./package.json').version")
rm -rf dist
npx electron-builder --win dir --x64 --publish never
node build/seticon.mjs dist/win-unpacked/SPACEBASE-Schedule.exe build-icon.ico "$VER"
${MAKENSIS:-makensis} -V1 "-DVERSION=$VER" build/installer.nsi
echo "built dist/SPACEBASE-Schedule-Setup-$VER.exe"
