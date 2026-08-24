#!/usr/bin/env bash
# /pumasi:image — Codex /imagen 호출 래퍼
# Usage: imagen.sh <prompt_file> <target_image_path>

set -euo pipefail

PROMPT_FILE="${1:-}"
TARGET_PATH="${2:-}"
EXPECTED_ASPECT="${3:-}"   # 선택: "16:9" 처럼 주면 실제 비율과 비교해 경고

if [[ -z "$PROMPT_FILE" || -z "$TARGET_PATH" ]]; then
  echo "Usage: $0 <prompt_file> <target_image_path> [expected_aspect e.g. 16:9] [--ref <image> ...] [--backend <codex|grok>]" >&2
  exit 2
fi

# 선택: 레퍼런스 이미지(스타일 앵커). codex 에 --image=<path> 로 파일당 하나씩 전달한다.
# 주의: `-i FILE...` 형태는 가변 인자라 뒤따르는 프롬프트를 경로로 삼켜버린다(실측). 반드시 --image=<path>.
REF_ARGS=()
BACKEND="codex"
GROK_REF=""
_i=4
while [[ $_i -le $# ]]; do
  _a="${!_i}"
  if [[ "$_a" == "--ref" ]]; then
    _i=$((_i+1)); _r="${!_i:-}"
    if [[ -z "$_r" || ! -f "$_r" ]]; then
      echo "ERROR: --ref requires an existing file (got: ${_r:-<none>})" >&2; exit 2
    fi
    REF_ARGS+=( "--image=$_r" )
    [[ -z "$GROK_REF" ]] && GROK_REF="$_r"
  elif [[ "$_a" == "--backend" ]]; then
    _i=$((_i+1)); BACKEND="${!_i:-}"
    if [[ "$BACKEND" != "codex" && "$BACKEND" != "grok" ]]; then
      echo "ERROR: --backend must be codex or grok (got: ${BACKEND:-<none>})" >&2; exit 2
    fi
  fi
  _i=$((_i+1))
done
[[ ${#REF_ARGS[@]} -gt 0 ]] && echo "[imagen.sh] 레퍼런스 이미지 ${#REF_ARGS[@]}장 첨부"

# 실제 픽셀 측정 + 요청 비율과 큰 괴리 시 경고 (gpt-image-2는 비율 미보장, 후처리 금지로 보정 불가)
measure_dims() { # echo "W H" (측정 실패 시 빈 출력)
  local f="$1" w="" h=""
  if command -v sips >/dev/null 2>&1; then
    w=$(sips -g pixelWidth  "$f" 2>/dev/null | awk '/pixelWidth/{print $2}')
    h=$(sips -g pixelHeight "$f" 2>/dev/null | awk '/pixelHeight/{print $2}')
  fi
  [[ -n "$w" && -n "$h" ]] && echo "$w $h"
  return 0   # set -e 가드: 측정 실패해도 비0 반환 금지 (DIMS=$(...) 중단 방지)
}
aspect_warn() { # args: W H "ew:eh"
  local w="$1" h="$2" exp="$3" ew eh got expr diff tol
  [[ -z "$exp" || -z "$w" || -z "$h" ]] && return 0
  ew="${exp%%:*}"; eh="${exp##*:}"
  [[ "$ew" =~ ^[0-9]+$ && "$eh" =~ ^[0-9]+$ && "$eh" -ne 0 && "$h" -ne 0 ]] || return 0
  got=$(( w * 1000 / h )); expr=$(( ew * 1000 / eh ))
  diff=$(( got > expr ? got - expr : expr - got )); tol=$(( expr * 15 / 100 ))
  if (( diff > tol )); then
    echo "WARN: aspect mismatch — 요청 ${exp}, 실제 ${w}x${h}. gpt-image-2는 비율을 보장하지 않음(후처리 금지로 보정 불가). 필요하면 비율 힌트를 강화해 재생성하세요." >&2
  fi
  return 0   # set -e 가드: 비율 일치(경고 없음) 시에도 0 반환
}

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "ERROR: prompt file not found: $PROMPT_FILE" >&2
  exit 2
fi

if [[ "$BACKEND" == "grok" ]]; then
  GROK_BIN="${GROK_BIN:-grok}"
  if ! command -v "$GROK_BIN" >/dev/null 2>&1; then
    echo "ERROR: grok CLI not installed" >&2
    exit 3
  fi
  GROK_MODELS=$("$GROK_BIN" models 2>&1 || true)
  if printf '%s\n' "$GROK_MODELS" | grep -qi "not authenticated"; then
    echo "ERROR: grok not logged in — run: grok login" >&2
    exit 3
  fi

  TARGET_DIR=$(dirname "$TARGET_PATH")
  mkdir -p "$TARGET_DIR"
  PROMPT_BODY=$(cat "$PROMPT_FILE")
  GROK_ASPECT="$EXPECTED_ASPECT"
  case "$GROK_ASPECT" in
    9:16|16:9|1:1) ;;
    *)
      echo "WARN: unsupported Grok aspect '${GROK_ASPECT:-<none>}' — using 1:1" >&2
      GROK_ASPECT="1:1" ;;
  esac

  WORK=$(mktemp -d -t imagen-grok.XXXXXX)
  GROK_STDOUT=$(mktemp -t imagen-grok-out.XXXXXX)
  LOG_FILE=$(mktemp -t imagen-grok-log.XXXXXX)
  MARKER=$(mktemp -t imagen-grok-marker.XXXXXX)
  GROK_PROMPT_BODY=${PROMPT_BODY//\\/\\\\}
  GROK_PROMPT_BODY=${GROK_PROMPT_BODY//\"/\\\"}
  if [[ -n "$GROK_REF" ]]; then
    REF_BASENAME=$(basename "$GROK_REF")
    cp "$GROK_REF" "$WORK/$REF_BASENAME"
    GROK_INSTRUCTION="Call image_edit exactly once using ./$REF_BASENAME as the source image. Edit instruction (use verbatim): \"$GROK_PROMPT_BODY\". Keep everything not mentioned unchanged. Do not ask questions. Do not read other files. After the tool call finishes, reply with ONLY the absolute saved file path."
    GROK_MODE="image_edit"
  else
    GROK_INSTRUCTION="Call image_gen exactly once with aspect_ratio=$GROK_ASPECT. Prompt (use verbatim): \"$GROK_PROMPT_BODY\". Do not ask questions. Do not read other files. After the tool call finishes, reply with ONLY the absolute saved file path."
    GROK_MODE="image_gen"
  fi

  echo "[imagen.sh] calling grok $GROK_MODE — target: $TARGET_PATH"
  if ! "$GROK_BIN" --no-auto-update --no-alt-screen --sandbox workspace --always-approve \
      --cwd "$WORK" -p "$GROK_INSTRUCTION" < /dev/null > "$GROK_STDOUT" 2> "$LOG_FILE"; then
    echo "[imagen.sh] grok exited non-zero; checking for a generated image" >&2
  fi

  GROK_SOURCE=$(python3 -c 'import re,sys; s=open(sys.argv[1]).read(); m=re.findall(r"(/.+?/images/[0-9]+\.(?:jpg|png))(?=\s|$)",s,re.I); print(m[-1] if m else "")' "$GROK_STDOUT")
  if [[ -z "$GROK_SOURCE" || ! -s "$GROK_SOURCE" ]]; then
    ENCODED_WORK=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$WORK")
    GROK_SESSION_ROOT="$HOME/.grok/sessions/$ENCODED_WORK"
    GROK_SOURCE=$({ find "$GROK_SESSION_ROOT" -type f -path '*/images/*' \
      \( -name '*.jpg' -o -name '*.png' \) -newer "$MARKER" 2>/dev/null || true; } | while read -r f; do
        printf '%s\t%s\n' "$(stat -f '%m' "$f" 2>/dev/null || echo 0)" "$f"
      done | sort -rn | head -n1 | cut -f2-)
  fi
  if [[ -z "$GROK_SOURCE" || ! -s "$GROK_SOURCE" ]]; then
    echo "ERROR: grok produced NO image (stdout/session scan found no new images/* output)" >&2
    tail -50 "$LOG_FILE" >&2
    exit 5
  fi

  cp "$GROK_SOURCE" "$TARGET_PATH"
  SOURCE_DESC="grok $GROK_MODE ($GROK_SOURCE)"
  rm -rf "$WORK"
  rm -f "$MARKER" "$GROK_STDOUT" 2>/dev/null || true

  if [[ ! -s "$TARGET_PATH" ]]; then
    echo "ERROR: target file not created or empty: $TARGET_PATH" >&2
    exit 5
  fi

  SIZE=$(wc -c < "$TARGET_PATH" | tr -d ' ')
  FILE_INFO=$(file "$TARGET_PATH")
  SHA1=$(shasum "$TARGET_PATH" | awk '{print $1}')
  DIMS=$(measure_dims "$TARGET_PATH")
  DIM_STR="${DIMS// /x}"; [[ -z "$DIM_STR" ]] && DIM_STR="(unmeasured)"

  cat <<EOF
[imagen.sh] SUCCESS
  path:    $TARGET_PATH
  source:  $SOURCE_DESC
  size:    $SIZE bytes
  dims:    $DIM_STR
  info:    $FILE_INFO
  sha1:    $SHA1
  log:     $LOG_FILE
EOF
  exit 0
fi

# codex 설치 확인
if ! command -v codex >/dev/null 2>&1; then
  echo "ERROR: codex CLI not found. Install: npm install -g @openai/codex" >&2
  exit 3
fi

# codex 호출 전용 프록시 우회.
# 로컬 프록시(예: teamclaude 127.0.0.1:3456)가 환경에 상속되면 codex(reqwest)가 그걸 따라가고,
# 이미지 엔드포인트 요청이 ~153초 뒤 "network error"로 죽는다.
# 2026-07-23 실측: 프록시 경유 89/89 실패, 같은 프롬프트를 우회하면 44초 만에 성공.
# 셸 환경은 건드리지 않고 codex 트래픽만 벗긴다. PUMASI_IMAGE_KEEP_PROXY=1 로 해제.
codex_run() {
  if [[ "${PUMASI_IMAGE_KEEP_PROXY:-0}" == "1" ]]; then
    codex "$@"
  else
    env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
        -u ALL_PROXY -u all_proxy codex "$@"
  fi
}
if [[ -n "${HTTP_PROXY:-}${HTTPS_PROXY:-}${http_proxy:-}${https_proxy:-}" \
      && "${PUMASI_IMAGE_KEEP_PROXY:-0}" != "1" ]]; then
  echo "[imagen.sh] 로컬 프록시 감지 — codex 호출에서만 우회합니다 (해제: PUMASI_IMAGE_KEEP_PROXY=1)."
fi

# codex가 남긴 실패 사유를 stderr 로그 / JSONL 양쪽에서 첫 줄만 뽑는다.
# 이게 없으면 네트워크 실패든 정책 거부든 전부 "base64 못 찾음"으로만 보인다.
codex_error() {
  local reason
  reason=$({ grep -hoE 'image generation failed: [^"\]+' "$@" 2>/dev/null || true; } | head -n1)
  [[ -z "$reason" ]] && reason=$({ grep -hoE 'error=[^"\]{1,200}' "$@" 2>/dev/null || true; } | head -n1)
  printf '%s' "$reason"
  return 0
}

# 1) feature flag 확인 + 자동 활성화
FLAG_STATE=$(codex_run features list 2>&1 | awk '/^image_generation/ {print $NF}' | head -n1)
if [[ "$FLAG_STATE" != "true" ]]; then
  echo "[imagen.sh] enabling image_generation feature flag..."
  codex_run features enable image_generation >/dev/null 2>&1
fi

# 2) 저장 디렉토리 준비
TARGET_DIR=$(dirname "$TARGET_PATH")
mkdir -p "$TARGET_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTRACT="${SCRIPT_DIR}/extract_image.py"

# 3) 프롬프트 본문 + image 도구 즉시 호출 지시
#    핵심: codex exec(headless)는 image_generation 도구로 이미지를 생성해서
#    base64(result)로 돌려주지만, TUI와 달리 generated_images/에 파일로 저장하지 않는다.
#    그래서 --json 으로 받아 base64를 우리가 직접 디코딩해 저장한다.
#    "/imagen" 슬래시는 exec에서 inert 텍스트이고, 설치된 codex 스킬을 읽다 도구 호출을
#    놓칠 수 있으므로, 파일/스킬 읽지 말고 도구를 즉시 부르라고 명시한다.
PROMPT_BODY=$(cat "$PROMPT_FILE")

CODEX_PROMPT="Use your image generation tool to generate EXACTLY ONE image now. Call the tool immediately on this turn. Do NOT read any files, skills, references, or AGENTS.md. Do NOT run shell commands. Do NOT copy or save files yourself — just call the image generation tool. Generate the image from this prompt, verbatim:

${PROMPT_BODY}"

# 4) codex exec --json 호출 — 이벤트(JSONL)를 stdout으로 받는다.
JSON_OUT=$(mktemp -t imagen-json.XXXXXX)
LOG_FILE=$(mktemp -t imagen-log.XXXXXX)
echo "[imagen.sh] calling codex exec --json — target: $TARGET_PATH"
echo "[imagen.sh] json: $JSON_OUT  log: $LOG_FILE"

# 이번 호출 이후 생성된 파일만 인정하기 위한 시간 기준점(스테일 오집음 방지)
GEN_DIR="${CODEX_HOME:-$HOME/.codex}/generated_images"
MARKER=$(mktemp -t imagen-marker.XXXXXX)

if ! codex_run exec --json \
    --skip-git-repo-check \
    --dangerously-bypass-approvals-and-sandbox \
    ${REF_ARGS[@]+"${REF_ARGS[@]}"} \
    "$CODEX_PROMPT" < /dev/null > "$JSON_OUT" 2> "$LOG_FILE"; then
  echo "ERROR: codex exec failed. See log: $LOG_FILE" >&2
  REASON=$(codex_error "$LOG_FILE" "$JSON_OUT")
  [[ -n "$REASON" ]] && echo "REASON: $REASON" >&2
  tail -50 "$LOG_FILE" >&2
  exit 4
fi

# 5) 생성 이미지 회수 → TARGET 저장. (우선순위 순)
#    0차: generated_images/<thread_id>/exec-*.{png,jpg,webp}
#         codex 0.147+ 는 exec 에서도 여기 저장하고 stdout JSONL 에 base64 를 싣지 않는다
#         (실측 2026-08-22, codex-cli 0.147.0). stdout 의 thread.started.thread_id 가
#         디렉토리명과 1:1 (실측 동일 날짜) — 이 세션 산출물만 집으므로 동시 실행과 경합하지 않는다.
#    0.5차: thread_id 를 못 읽었을 때만 마커(시각 기준) 폴백 — 이번 호출 이후 파일만 인정.
#    1차: stdout(JSONL) base64 디코딩 (구버전 codex 호환).
#    2차: 세션 rollout 파일 base64 (구버전 폴백).
pick_newest() { # args: 검색 루트
  find "$1" -type f \( -name 'exec-*.png' -o -name 'exec-*.jpg' -o -name 'exec-*.webp' \) \
       -newer "$MARKER" 2>/dev/null | while read -r f; do
    printf '%s\t%s\n' "$(stat -f '%m' "$f" 2>/dev/null || echo 0)" "$f"
  done | sort -rn | head -n1 | cut -f2-
}
NEWEST=""
THREAD_ID=$(grep -hoE '"thread_id"[[:space:]]*:[[:space:]]*"[0-9a-f-]{36}"' "$JSON_OUT" 2>/dev/null \
            | head -n1 | grep -oE '[0-9a-f-]{36}' || true)
if [[ -n "$THREAD_ID" && -d "$GEN_DIR/$THREAD_ID" ]]; then
  NEWEST=$(pick_newest "$GEN_DIR/$THREAD_ID")
elif [[ -z "$THREAD_ID" && -d "$GEN_DIR" ]]; then
  NEWEST=$(pick_newest "$GEN_DIR")
fi
if [[ -n "$NEWEST" && -s "$NEWEST" ]]; then
  cp "$NEWEST" "$TARGET_PATH"
  SOURCE_DESC="codex generated_images ($NEWEST)"
elif python3 "$EXTRACT" "$JSON_OUT" "$TARGET_PATH" >/dev/null 2>&1; then
  SOURCE_DESC="codex exec --json (stdout)"
else
  SID=$(grep -hoE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$LOG_FILE" "$JSON_OUT" 2>/dev/null | head -n1 || true)
  ROLL=""
  [[ -n "$SID" ]] && ROLL=$(find "$HOME/.codex/sessions" -name "rollout-*${SID}.jsonl" 2>/dev/null | head -n1)
  if [[ -n "$ROLL" ]] && python3 "$EXTRACT" "$ROLL" "$TARGET_PATH" >/dev/null 2>&1; then
    SOURCE_DESC="session rollout ($ROLL)"
  else
    REASON=$(codex_error "$LOG_FILE" "$JSON_OUT")
    if [[ -n "$REASON" ]]; then
      echo "ERROR: $REASON" >&2
      case "$REASON" in
        *"network error"*)
          echo "       HINT: 이미지 엔드포인트가 네트워크 경로에서 끊겼습니다. 로컬 프록시(HTTP_PROXY/HTTPS_PROXY) 경유가" >&2
          echo "             이 증상의 확인된 원인입니다. PUMASI_IMAGE_KEEP_PROXY=1을 쓰고 있다면 해제하세요." >&2 ;;
      esac
    else
      echo "ERROR: codex exec produced NO image (generated_images/stdout/rollout 어디에서도 산출물 없음)" >&2
    fi
    echo "       (생성 실패를 성공으로 보고하지 않기 위해 중단)" >&2
    echo "--- codex log tail ---" >&2
    tail -50 "$LOG_FILE" >&2
    exit 5
  fi
fi

rm -f "$MARKER" 2>/dev/null || true

if [[ ! -s "$TARGET_PATH" ]]; then
  echo "ERROR: target file not created or empty: $TARGET_PATH" >&2
  exit 5
fi

# 6) 파일 정보 출력 (실측 해상도 포함 — 감사 가능)
SIZE=$(wc -c < "$TARGET_PATH" | tr -d ' ')
FILE_INFO=$(file "$TARGET_PATH")
SHA1=$(shasum "$TARGET_PATH" | awk '{print $1}')
DIMS=$(measure_dims "$TARGET_PATH")
DIM_STR="${DIMS// /x}"; [[ -z "$DIM_STR" ]] && DIM_STR="(unmeasured)"
if [[ -n "$DIMS" ]]; then
  aspect_warn ${DIMS} "$EXPECTED_ASPECT"
fi

cat <<EOF
[imagen.sh] SUCCESS
  path:    $TARGET_PATH
  source:  $SOURCE_DESC
  size:    $SIZE bytes
  dims:    $DIM_STR
  info:    $FILE_INFO
  sha1:    $SHA1
  log:     $LOG_FILE
EOF
