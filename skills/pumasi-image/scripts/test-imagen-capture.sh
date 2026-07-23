#!/usr/bin/env bash
# Regression test for imagen.sh / imagen-full.sh image capture.
#
# Contract under test:
#   codex exec generates the image but returns it as base64 in an
#   `image_generation_call` event (it does NOT write a PNG to disk). The wrapper
#   must decode that base64 and write the target PNG itself, and must FAIL loudly
#   (non-zero, no SUCCESS/MANIFEST line) when no image event is produced.
#
# Mocks `codex` on PATH so it never touches the network or real ~/.codex.
# Usage: bash test-imagen-capture.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGEN="${SCRIPT_DIR}/imagen.sh"
IMAGEN_FULL="${SCRIPT_DIR}/imagen-full.sh"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"   # scripts -> pumasi-image -> skills -> <root>

PASS=0; FAIL=0
ok()  { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

make_sandbox() {
  SANDBOX=$(mktemp -d -t imagen-test.XXXXXX)
  BIN="${SANDBOX}/bin"; mkdir -p "$BIN"
  # Mock codex: --version, features list/enable, and exec that emits a JSONL
  # image_generation_call carrying a 1x1 base64 PNG to stdout (generate mode),
  # or a non-image message (noop mode).
  cat > "${BIN}/codex" <<'FAKE'
#!/usr/bin/env bash
case "$1" in
  --version) echo "codex-fake 0.0.0"; exit 0 ;;
  features)
    case "${2:-}" in list) echo "image_generation true" ;; enable) : ;; esac
    exit 0 ;;
  exec)
    # 프록시 상속 여부를 기록 — 래퍼가 codex 호출에서만 프록시를 벗기는지 검증용
    [ -n "${FAKE_CODEX_PROXY_LOG:-}" ] && \
      printf 'HTTPS_PROXY=[%s]\n' "${HTTPS_PROXY:-}" > "$FAKE_CODEX_PROXY_LOG"
    case "${FAKE_CODEX_MODE:-generate}" in
      noop)
        printf '%s\n' '{"type":"agent_message","text":"no image produced"}' ;;
      neterror)
        # 실제 장애 재현: 도구 호출은 실패하지만 codex 자체는 exit 0 으로 끝난다
        printf '%s\n' '{"type":"agent_message","text":"tool failed"}'
        echo 'ERROR codex_core::tools::router: error=image generation failed: network error: error sending request for url (https://chatgpt.com/backend-api/codex/images/generations)' >&2 ;;
      *)
        printf '%s\n' '{"type":"image_generation_call","status":"completed","result":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"}' ;;
    esac
    exit 0 ;;
  *) exit 0 ;;
esac
FAKE
  chmod +x "${BIN}/codex"
  PROMPT_FILE="${SANDBOX}/prompt.md"
  printf 'a serene wide landscape, hero banner' > "$PROMPT_FILE"
  TARGET="${SANDBOX}/out/result.png"
}

is_png() { file "$1" 2>/dev/null | grep -q "PNG image data"; }

run_imagen() {
  PATH="${BIN}:$PATH" bash "$IMAGEN" "$PROMPT_FILE" "$TARGET" "16:9" > "${SANDBOX}/out.log" 2>&1
  echo $?
}
run_imagen_full() {
  PATH="${BIN}:$PATH" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
    bash "$IMAGEN_FULL" "hero banner: bold wide scene" "A" "16:9" "high" "$TARGET" \
    > "${SANDBOX}/out.log" 2>&1
  echo $?
}

echo "== Test 1: imagen.sh decodes base64 image event -> writes PNG =="
make_sandbox
export FAKE_CODEX_MODE=generate
rc=$(run_imagen); unset FAKE_CODEX_MODE
if [ "$rc" = "0" ] && [ -f "$TARGET" ]; then
  is_png "$TARGET" && ok "target is a valid PNG" || bad "target is not a PNG"
  grep -q "SUCCESS" "${SANDBOX}/out.log" && ok "SUCCESS reported" || bad "no SUCCESS line"
else
  bad "expected rc=0 + target, got rc=$rc"; sed 's/^/      /' "${SANDBOX}/out.log"
fi
rm -rf "$SANDBOX"

echo "== Test 2: imagen.sh NO image event -> must FAIL (no false SUCCESS) =="
make_sandbox
export FAKE_CODEX_MODE=noop
rc=$(run_imagen); unset FAKE_CODEX_MODE
[ "$rc" != "0" ] && ok "non-zero exit (rc=$rc)" || bad "rc=0 despite no image (FALSE SUCCESS)"
[ -f "$TARGET" ] && bad "target created from nothing" || ok "target not created"
grep -q "SUCCESS" "${SANDBOX}/out.log" && bad "printed SUCCESS with no image" || ok "no SUCCESS line"
rm -rf "$SANDBOX"

echo "== Test 3: imagen-full.sh decodes base64 image event -> writes PNG =="
make_sandbox
export FAKE_CODEX_MODE=generate
rc=$(run_imagen_full); unset FAKE_CODEX_MODE
if [ "$rc" = "0" ] && [ -f "$TARGET" ]; then
  is_png "$TARGET" && ok "target is a valid PNG" || bad "target is not a PNG"
  grep -q "MANIFEST=" "${SANDBOX}/out.log" && ok "emitted MANIFEST= report" || bad "no MANIFEST= line"
else
  bad "expected rc=0 + target, got rc=$rc"; sed 's/^/      /' "${SANDBOX}/out.log"
fi
rm -rf "$SANDBOX"

echo "== Test 4: imagen-full.sh NO image event -> must FAIL =="
make_sandbox
export FAKE_CODEX_MODE=noop
rc=$(run_imagen_full); unset FAKE_CODEX_MODE
[ "$rc" != "0" ] && ok "non-zero exit (rc=$rc)" || bad "rc=0 despite no image (FALSE SUCCESS)"
[ -f "$TARGET" ] && bad "target created from nothing" || ok "target not created"
grep -q "MANIFEST=" "${SANDBOX}/out.log" && bad "printed MANIFEST= with no image" || ok "no MANIFEST= line"
rm -rf "$SANDBOX"

echo "== Test 5: rc-safety under set -e + extractor rejects sub-PNG junk =="
# measure_dims/aspect_warn must never return nonzero on normal paths (else
# DIMS=$(...) / && aspect_warn abort the script after a successful save).
TMPF=$(mktemp)
{ echo 'set -euo pipefail'
  sed -n '/^measure_dims() {/,/^}/p' "$IMAGEN"
  sed -n '/^aspect_warn() {/,/^}/p' "$IMAGEN"
  echo 'D=$(measure_dims /nonexistent-xyz); X="1920 1080"; [ -n "$X" ] && aspect_warn $X "16:9"'
} > "$TMPF"
bash "$TMPF" 2>/dev/null && ok "measure_dims/aspect_warn rc-safe under set -e" || bad "rc-safety regressed (set -e abort)"
rm -f "$TMPF"
SB=$(mktemp); printf '%s\n' '{"type":"image_generation_call","result":"iVBORw0KGgpqdW5r"}' > "$SB"; SO=$(mktemp -u).png
python3 "${SCRIPT_DIR}/extract_image.py" "$SB" "$SO" >/dev/null 2>&1 && bad "extractor accepted fake PNG" || ok "extractor rejects sub-PNG junk"
rm -f "$SB" "$SO" 2>/dev/null

echo "== Test 6: tool failure surfaces codex's REASON (not just 'no base64') =="
# 이 계약이 없어서 2026-07-23 프록시 장애가 40회+ 오진됐다. 실패 사유는 반드시 보여야 한다.
make_sandbox
export FAKE_CODEX_MODE=neterror
rc=$(run_imagen); unset FAKE_CODEX_MODE
[ "$rc" != "0" ] && ok "non-zero exit (rc=$rc)" || bad "rc=0 despite tool failure"
grep -q "REASON:\|ERROR: image generation failed" "${SANDBOX}/out.log" \
  && ok "surfaced codex failure reason" || bad "swallowed the reason (only generic 'no image')"
grep -q "network error" "${SANDBOX}/out.log" \
  && ok "kept the underlying network error text" || bad "lost the network error text"
rm -rf "$SANDBOX"

echo "== Test 7: codex is called with local proxy stripped (opt-out honored) =="
make_sandbox
PROXY_LOG="${SANDBOX}/proxy.txt"
FAKE_CODEX_PROXY_LOG="$PROXY_LOG" HTTPS_PROXY="http://127.0.0.1:3456" HTTP_PROXY="http://127.0.0.1:3456" \
  PATH="${BIN}:$PATH" bash "$IMAGEN" "$PROMPT_FILE" "$TARGET" "16:9" > "${SANDBOX}/out.log" 2>&1
grep -q 'HTTPS_PROXY=\[\]' "$PROXY_LOG" 2>/dev/null \
  && ok "proxy stripped for the codex call" || bad "proxy leaked into codex ($(cat "$PROXY_LOG" 2>/dev/null))"
rm -f "$PROXY_LOG"
FAKE_CODEX_PROXY_LOG="$PROXY_LOG" HTTPS_PROXY="http://127.0.0.1:3456" PUMASI_IMAGE_KEEP_PROXY=1 \
  PATH="${BIN}:$PATH" bash "$IMAGEN" "$PROMPT_FILE" "$TARGET" "16:9" > "${SANDBOX}/out2.log" 2>&1
grep -q 'HTTPS_PROXY=\[http://127.0.0.1:3456\]' "$PROXY_LOG" 2>/dev/null \
  && ok "PUMASI_IMAGE_KEEP_PROXY=1 keeps the proxy" || bad "opt-out ignored ($(cat "$PROXY_LOG" 2>/dev/null))"
rm -rf "$SANDBOX"

echo ""
echo "RESULT: PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
