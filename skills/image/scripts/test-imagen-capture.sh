#!/usr/bin/env bash
# Regression test for imagen.sh / imagen-full.sh image capture.
#
# Contract under test (dual-path capture):
#   [primary, codex-cli 0.147+] codex exec SAVES the image to
#     $CODEX_HOME/generated_images/<thread_id>/exec-*.png and emits NO base64 on
#     stdout; the wrapper must locate it via thread.started.thread_id and copy it.
#   [legacy fallback] older codex returns base64 in an `image_generation_call`
#     event; the wrapper must decode and write the target PNG itself.
#   Either way it must FAIL loudly (non-zero, no SUCCESS/MANIFEST line) when no
#   image is produced anywhere.
#
# Mocks `codex` on PATH (+ CODEX_HOME sandbox) so it never touches the network
# or the real ~/.codex.
# Usage: bash test-imagen-capture.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGEN="${SCRIPT_DIR}/imagen.sh"
IMAGEN_FULL="${SCRIPT_DIR}/imagen-full.sh"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"   # scripts -> image -> skills -> <root>

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
      diskonly)
        # codex-cli 0.147+ 실측 재현: base64 없이 generated_images/<thread_id>/exec-*.png 저장
        TID="01a00000-0000-7000-8000-00000000test"
        printf '%s\n' "{\"type\":\"thread.started\",\"thread_id\":\"$TID\"}"
        printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Generated exactly one image."}}'
        DEST="${CODEX_HOME:-$HOME/.codex}/generated_images/$TID"
        mkdir -p "$DEST"
        printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC' \
          | base64 -d > "${DEST}/exec-fake-1234.png" ;;
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

# CODEX_HOME을 샌드박스로 고정 — 회수 0차(generated_images 스캔)가 실제 ~/.codex를 건드리지 않게.
run_imagen() {
  PATH="${BIN}:$PATH" CODEX_HOME="${SANDBOX}/codexhome" \
    bash "$IMAGEN" "$PROMPT_FILE" "$TARGET" "16:9" > "${SANDBOX}/out.log" 2>&1
  echo $?
}
run_imagen_full() {
  PATH="${BIN}:$PATH" CODEX_HOME="${SANDBOX}/codexhome" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
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

echo "== Test 8: imagen.sh captures disk-saved image via thread_id (codex 0.147+ path) =="
make_sandbox
export FAKE_CODEX_MODE=diskonly
rc=$(run_imagen); unset FAKE_CODEX_MODE
if [ "$rc" = "0" ] && [ -f "$TARGET" ]; then
  is_png "$TARGET" && ok "target is a valid PNG (copied from generated_images)" || bad "target is not a PNG"
  grep -q "generated_images" "${SANDBOX}/out.log" && ok "source is generated_images path" || bad "did not use generated_images path"
else
  bad "expected rc=0 + target, got rc=$rc"; sed 's/^/      /' "${SANDBOX}/out.log"
fi
rm -rf "$SANDBOX"

echo "== Test 9: imagen-full.sh captures disk-saved image via thread_id =="
make_sandbox
export FAKE_CODEX_MODE=diskonly
rc=$(run_imagen_full); unset FAKE_CODEX_MODE
if [ "$rc" = "0" ] && [ -f "$TARGET" ]; then
  is_png "$TARGET" && ok "target is a valid PNG (copied from generated_images)" || bad "target is not a PNG"
else
  bad "expected rc=0 + target, got rc=$rc"; sed 's/^/      /' "${SANDBOX}/out.log"
fi
rm -rf "$SANDBOX"

echo "== Test 10: --ref attaches reference and still succeeds; missing ref fails fast =="
make_sandbox
export FAKE_CODEX_MODE=generate
REF_OK="${SANDBOX}/ref.png"
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC' | base64 -d > "$REF_OK"
PATH="${BIN}:$PATH" CODEX_HOME="${SANDBOX}/codexhome" \
  bash "$IMAGEN" "$PROMPT_FILE" "$TARGET" "16:9" --ref "$REF_OK" > "${SANDBOX}/out.log" 2>&1
[ $? = 0 ] && grep -q "레퍼런스 이미지 1장 첨부" "${SANDBOX}/out.log" \
  && ok "--ref accepted and announced" || bad "--ref path broken"
PATH="${BIN}:$PATH" CODEX_HOME="${SANDBOX}/codexhome" \
  bash "$IMAGEN" "$PROMPT_FILE" "$TARGET" "16:9" --ref "/nonexistent-ref.png" > "${SANDBOX}/out2.log" 2>&1
[ $? != 0 ] && ok "missing ref fails fast (exit != 0)" || bad "missing ref silently accepted"
unset FAKE_CODEX_MODE
rm -rf "$SANDBOX"

make_grok_mock() {
  cat > "${BIN}/grok" <<'FAKE'
#!/usr/bin/env bash
if [ "${1:-}" = "models" ]; then
  echo "You are logged in"
  exit 0
fi
CWD=""; PROMPT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --cwd) shift; CWD="${1:-}" ;;
    -p) shift; PROMPT="${1:-}" ;;
  esac
  shift
done
[ -n "${FAKE_GROK_PROMPT_LOG:-}" ] && printf '%s' "$PROMPT" > "$FAKE_GROK_PROMPT_LOG"
if printf '%s' "$PROMPT" | grep -q "image_edit"; then
  N=2
elif printf '%s' "$PROMPT" | grep -q "image_gen exactly once with aspect_ratio=16:9"; then
  N=1
else
  echo "unexpected prompt: $PROMPT" >&2
  exit 9
fi
ENCODED=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$CWD")
DEST="$HOME/.grok/sessions/$ENCODED/mock-sid/images"
mkdir -p "$DEST"
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC' \
  | base64 -d > "$DEST/$N.jpg"
printf '%s\n' "$DEST/$N.jpg"
FAKE
  chmod +x "${BIN}/grok"
  cat > "${BIN}/codex" <<'FAKE'
#!/usr/bin/env bash
[ -n "${FAKE_CODEX_CALLED:-}" ] && : > "$FAKE_CODEX_CALLED"
exit 99
FAKE
  chmod +x "${BIN}/codex"
}

echo "== Test 11: --backend grok image_gen succeeds without calling codex =="
make_sandbox
make_grok_mock
FAKE_CODEX_CALLED="${SANDBOX}/codex-called"
FAKE_GROK_PROMPT_LOG="${SANDBOX}/grok-prompt.txt"
HOME="${SANDBOX}/home" PATH="${BIN}:$PATH" GROK_BIN="${BIN}/grok" \
  FAKE_CODEX_CALLED="$FAKE_CODEX_CALLED" FAKE_GROK_PROMPT_LOG="$FAKE_GROK_PROMPT_LOG" \
  bash "$IMAGEN" "$PROMPT_FILE" "$TARGET" "16:9" --backend grok > "${SANDBOX}/out.log" 2>&1
rc=$?
[ "$rc" = "0" ] && ok "grok image_gen exits 0" || bad "grok image_gen rc=$rc"
grep -q "SUCCESS" "${SANDBOX}/out.log" && ok "SUCCESS reported" || bad "no SUCCESS line"
# 확장자 정합 계약: grok 산출물이 .jpg면 타깃 확장자도 .jpg로 조정되고 path: 로 보고된다
SAVED=$(awk '/^  path:/{print $2}' "${SANDBOX}/out.log" | head -n1)
case "$SAVED" in *.jpg) ok "target extension adjusted to .jpg" ;; *) bad "extension not adjusted (path: $SAVED)" ;; esac
is_png "$SAVED" && ok "saved file has the mock image bytes" || bad "saved file missing/corrupt: $SAVED"
grep -q "grok image_gen" "${SANDBOX}/out.log" && ok "source reports grok image_gen" || bad "wrong source"
[ ! -e "$FAKE_CODEX_CALLED" ] && ok "codex was not called" || bad "codex was called"
python3 -c 'import shutil,sys;shutil.rmtree(sys.argv[1])' "$SANDBOX"

echo "== Test 12: --backend grok --ref uses image_edit =="
make_sandbox
make_grok_mock
REF_OK="${SANDBOX}/ref.png"
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC' | base64 -d > "$REF_OK"
FAKE_CODEX_CALLED="${SANDBOX}/codex-called"
FAKE_GROK_PROMPT_LOG="${SANDBOX}/grok-prompt.txt"
HOME="${SANDBOX}/home" PATH="${BIN}:$PATH" GROK_BIN="${BIN}/grok" \
  FAKE_CODEX_CALLED="$FAKE_CODEX_CALLED" FAKE_GROK_PROMPT_LOG="$FAKE_GROK_PROMPT_LOG" \
  bash "$IMAGEN" "$PROMPT_FILE" "$TARGET" "16:9" --backend grok --ref "$REF_OK" \
  > "${SANDBOX}/out.log" 2>&1
rc=$?
[ "$rc" = "0" ] && ok "grok image_edit exits 0" || bad "grok image_edit rc=$rc"
grep -q "grok image_edit" "${SANDBOX}/out.log" && ok "source reports grok image_edit" || bad "wrong source"
grep -q "image_edit exactly once" "$FAKE_GROK_PROMPT_LOG" && ok "prompt requested image_edit" || bad "image_edit instruction missing"
[ ! -e "$FAKE_CODEX_CALLED" ] && ok "codex was not called" || bad "codex was called"
python3 -c 'import shutil,sys;shutil.rmtree(sys.argv[1])' "$SANDBOX"

echo ""
echo "RESULT: PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
