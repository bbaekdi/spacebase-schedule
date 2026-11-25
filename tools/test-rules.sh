#!/usr/bin/env bash
# Firebase 규칙 시험: 연습용 Firebase(에뮬레이터)에서 "누가 무엇을 읽고 쓸 수 있는지" 확인한다. 실제 데이터는 건드리지 않음.
# 필요: Java, Node. 처음 한 번 도구를 임시 폴더에 설치한다.
set -e
cd "$(dirname "$0")/.."
T="${SB_TEST_DIR:-${TMPDIR:-/tmp}/sb-rules-test}"
if [ ! -x "$T/node_modules/.bin/firebase" ]; then
  mkdir -p "$T" && (cd "$T" && npm init -y >/dev/null && npm i --silent firebase-tools@13 firebase@10.14.1 @firebase/rules-unit-testing@3)
fi
cp firebase/rules.test.mjs "$T/rules.test.mjs"
cd firebase
"$T/node_modules/.bin/firebase" emulators:exec --only database --project demo-sb "node $T/rules.test.mjs $PWD/database.rules.json" 2>&1 | grep -E "✗|시험 |Script exited|Error"
