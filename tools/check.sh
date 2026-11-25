#!/usr/bin/env bash
# 배포 전 검토: bash tools/check.sh
# 1) JS 문법 오류  2) 비밀 값·회사 정보 의심 문자열  3) 버전과 릴리즈 노트가 맞는지
cd "$(dirname "$0")/.." || exit 1
fail=0

echo "[1] JS 문법 검사"
while IFS= read -r f; do
  node --check "$f" 2>/tmp/check_err || { echo "  ✗ $f"; sed 's/^/    /' /tmp/check_err; fail=1; }
done < <(git ls-files '*.js' '*.mjs' | grep -v '^public/vendor/')
[ $fail = 0 ] && echo "  OK"

echo "[2] 비밀 값 의심 문자열 (바뀐 파일만)"
# 외부에서 받은 라이브러리(public/vendor)는 검사하지 않는다
files=$( { git diff --name-only HEAD; git diff --name-only --cached; git ls-files --others --exclude-standard; } | sort -u | grep -v '^tools/check.sh$' | grep -v '^public/vendor/')
hits=""
for f in $files; do
  [ -f "$f" ] || continue
  h=$(grep -nEi 'webcal://|calendar\.google\.com/calendar/ical/.+/private|band\.us/band/[0-9]{5,}|band\.us/.*\.ics|(api[_-]?key|secret|token|password)["'"'"' ]*[:=]["'"'"' ]*[A-Za-z0-9_\-]{16,}' "$f" | grep -v 'firebase-config.js' | cut -c1-200 || true)
  [ -n "$h" ] && hits="$hits\n  $f: $h"
done
if [ -n "$hits" ]; then echo -e "  ⚠ 확인 필요:$hits"; fail=1; else echo "  OK"; fi

echo "[3] 버전 / 릴리즈 노트"
v=$(node -p "require('./package.json').version")
if grep -q "^## $v" RELEASE-NOTES.md; then echo "  OK ($v)"; else echo "  ✗ RELEASE-NOTES.md 에 '## $v' 항목이 없음"; fail=1; fi

[ $fail = 0 ] && echo "검토 통과" || { echo "검토 실패 — 고친 뒤 다시 실행"; exit 1; }
