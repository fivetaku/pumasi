#!/bin/bash
#
# test-worker-command.sh — pumasi-job-worker.js 의 command 문자열 → 실제 실행 계약 회귀 테스트
#
# 실제 CLI를 호출하지 않는다. argv를 기록하는 가짜 바이너리를 PATH 앞에 두고,
# 워커가 config의 command 문자열을 어떻게 해석해 실행하는지 고정한다.
#
# 특히 지키려는 계약: **codex 전용 플래그(--output-schema/-o)를 다른 CLI에 주입하지 않는다.**
# 이게 깨지면 grok/agy/gjc 워커가 "알 수 없는 플래그"로 즉사한다.
#
# Usage: bash tests/test-worker-command.sh
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER="$PLUGIN_DIR/skills/pumasi/scripts/pumasi-job-worker.js"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  \033[0;31m✗\033[0m %s\n     %s\n' "$1" "$2"; }

FAKEBIN="$TMP/bin"; mkdir -p "$FAKEBIN"
for name in codex grok agy gjc cursor-agent; do
  cat > "$FAKEBIN/$name" <<EOF
#!/bin/bash
: > "\$FAKE_ARGV_FILE"
for a in "\$@"; do printf '%s\n' "\$a" >> "\$FAKE_ARGV_FILE"; done
echo "fake-$name-ok"
exit 0
EOF
  chmod +x "$FAKEBIN/$name"
done

# $1=label, $2=command 문자열 → argv 파일 경로
# 워커는 job.json + jobDir/prompt.txt 로부터 프롬프트를 조립하므로 그 구조를 그대로 만든다.
run_cmd() {
  local label="$1" command="$2"
  local jobdir="$TMP/job-$label"
  mkdir -p "$jobdir/members/$label"
  printf '%s' 'PROMPT_BODY' > "$jobdir/prompt.txt"
  cat > "$jobdir/job.json" <<EOJ
{"cwd": "$TMP", "currentRound": 1, "tasks": []}
EOJ
  local argvfile="$TMP/argv-$label.txt"; : > "$argvfile"
  FAKE_ARGV_FILE="$argvfile" PATH="$FAKEBIN:$PATH" \
    node "$WORKER" --job-dir "$jobdir" --member "$label" --safe-member "$label" \
      --command "$command" --cwd "$TMP" --timeout 30 >/dev/null 2>&1
  printf '%s' "$argvfile"
}

has_arg() { grep -Fxq -- "$2" "$1"; }
last_arg() { tail -1 "$1"; }

echo
echo "pumasi-job-worker.js command 계약"
echo "────────────────────────────────────────"

echo "[codex — 구조화 보고서 플래그가 붙어야 함]"
F=$(run_cmd codex "codex exec --dangerously-bypass-approvals-and-sandbox")
if [ ! -s "$F" ]; then
  bad "codex 실행" "argv 기록 없음 — 워커 인자 규약이 바뀌었을 수 있다"
else
  has_arg "$F" "exec" && ok "exec 서브커맨드 전달" || bad "exec 전달" "없음"
  has_arg "$F" "--output-schema" \
    && ok "codex에는 --output-schema 주입" \
    || bad "--output-schema 주입" "없음 — report.json이 안 생긴다"
  case "$(last_arg "$F")" in *PROMPT_BODY*) true;; *) false;; esac \
    && ok "프롬프트가 마지막 positional" || bad "프롬프트 위치" "got: $(last_arg "$F")"
fi

echo "[grok — codex 전용 플래그가 절대 붙으면 안 됨]"
F=$(run_cmd grok "grok --no-auto-update --no-alt-screen --sandbox workspace --always-approve -p")
if [ ! -s "$F" ]; then
  bad "grok 실행" "argv 기록 없음"
else
  ! has_arg "$F" "--output-schema" \
    && ok "grok에 --output-schema 미주입 (알 수 없는 플래그로 즉사 방지)" \
    || bad "codex 전용 플래그 누출" "grok에 --output-schema가 붙었다"
  ! has_arg "$F" "-o" \
    && ok "grok에 -o 미주입" || bad "codex 전용 -o 누출" "grok에 -o가 붙었다"
  has_arg "$F" "--sandbox" && has_arg "$F" "workspace" \
    && ok "--sandbox workspace 보존 (grok은 샌드박스 기본 off)" \
    || bad "--sandbox workspace" "config의 플래그가 유실됐다"
  has_arg "$F" "--no-auto-update" \
    && ok "--no-auto-update 보존" || bad "--no-auto-update" "유실"
  case "$(last_arg "$F")" in *PROMPT_BODY*) true;; *) false;; esac \
    && ok "프롬프트가 -p 값으로 전달" || bad "프롬프트 위치" "got: $(last_arg "$F")"
fi

echo "[agy / gjc — 기존 프로바이더 회귀]"
F=$(run_cmd agy "agy --dangerously-skip-permissions -p")
if [ -s "$F" ]; then
  ! has_arg "$F" "--output-schema" && ok "agy에 --output-schema 미주입" \
    || bad "agy 플래그 누출" "--output-schema가 붙었다"
  case "$(last_arg "$F")" in *PROMPT_BODY*) true;; *) false;; esac && ok "agy 프롬프트 위치" \
    || bad "agy 프롬프트 위치" "got: $(last_arg "$F")"
else bad "agy 실행" "argv 기록 없음"; fi

F=$(run_cmd gjc "gjc --print")
if [ -s "$F" ]; then
  ! has_arg "$F" "--output-schema" && ok "gjc에 --output-schema 미주입" \
    || bad "gjc 플래그 누출" "--output-schema가 붙었다"
  case "$(last_arg "$F")" in *PROMPT_BODY*) true;; *) false;; esac && ok "gjc 프롬프트 위치" \
    || bad "gjc 프롬프트 위치" "got: $(last_arg "$F")"
else bad "gjc 실행" "argv 기록 없음"; fi

echo "[cursor — 이름에 'codex'가 없는데도 전용 플래그가 새면 안 됨]"
F=$(run_cmd cursor-agent "cursor-agent -p --force --model composer-2.5 --output-format text")
if [ -s "$F" ]; then
  ! has_arg "$F" "--output-schema" \
    && ok "cursor-agent에 --output-schema 미주입" \
    || bad "codex 전용 플래그 누출" "cursor-agent에 --output-schema가 붙었다"
  ! has_arg "$F" "-o" && ok "cursor-agent에 -o 미주입" \
    || bad "codex 전용 -o 누출" "cursor-agent에 -o가 붙었다"
  has_arg "$F" "--force" && ok "--force 보존 (없으면 디렉터리 신뢰 프롬프트에서 즉사)" \
    || bad "--force 유실" "신뢰 프롬프트에서 비대화형 정지한다"
  has_arg "$F" "composer-2.5" && ok "--model 값 보존" || bad "--model 유실" "모델 핀이 사라졌다"
  case "$(last_arg "$F")" in *PROMPT_BODY*) true;; *) false;; esac \
    && ok "cursor 프롬프트가 마지막 positional" \
    || bad "cursor 프롬프트 위치" "got: $(last_arg "$F")"
else bad "cursor-agent 실행" "argv 기록 없음"; fi

echo "[config YAML 파싱 — grok command가 문법적으로 유효한가]"
for cfg in "$PLUGIN_DIR/pumasi.config.yaml"; do
  if node -e "
    const fs=require('fs');
    const s=fs.readFileSync('$cfg','utf8');
    // 주석의 grok 예시가 워커의 splitCommand로 파싱 가능한지만 본다
    const m=s.match(/#\s*grok\s*:\s*\"([^\"]+)\"/);
    if(!m){process.stderr.write('grok 예시 주석 없음');process.exit(1)}
    const toks=m[1].split(/\s+/).filter(Boolean);
    if(toks[0]!=='grok'){process.stderr.write('첫 토큰이 grok이 아님: '+toks[0]);process.exit(1)}
    if(toks[toks.length-1]!=='-p'){process.stderr.write('마지막 토큰이 -p가 아님: '+toks[toks.length-1]);process.exit(1)}
  " 2>/dev/null; then
    ok "config 주석의 grok 예시가 유효 (grok … -p 로 끝남)"
  else
    bad "config grok 예시" "$(basename "$cfg") — 프롬프트가 마지막 positional로 안 간다"
  fi
done

echo "────────────────────────────────────────"
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
