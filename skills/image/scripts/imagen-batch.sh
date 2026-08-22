#!/usr/bin/env bash
# /pumasi:image — 일괄 생성 (partial success + per-item retry manifest)
# Usage: imagen-batch.sh <batch_json>
#
# batch_json 예시:
# [
#   {"intent":"BPTC 4회차 표지","mode":"E","aspect":"16:9","quality":"high","target":"/Users/.../1.png"},
#   {"intent":"노트북 vs 도서관","mode":"D","aspect":"16:9","quality":"high","target":"/Users/.../2.png"}
# ]

set -euo pipefail

BATCH_JSON="${1:-}"
[[ -f "$BATCH_JSON" ]] || { echo "Usage: $0 <batch_json>" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq required" >&2; exit 3; }

COUNT=$(jq 'length' "$BATCH_JSON")
[[ "$COUNT" -gt 0 ]] || { echo "ERROR: batch is empty" >&2; exit 4; }

# 결과 manifest 위치 — 첫 target의 디렉토리 기준
FIRST_TARGET=$(jq -r '.[0].target' "$BATCH_JSON")
WORK_DIR="$(dirname "$FIRST_TARGET")/.imagen-batch"
mkdir -p "$WORK_DIR"
TS=$(date +%Y%m%d-%H%M%S)
RESULTS="${WORK_DIR}/results-${TS}.jsonl"
: > "$RESULTS"

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
IMAGEN_FULL="${PLUGIN_ROOT}/skills/image/scripts/imagen-full.sh"
[[ -x "$IMAGEN_FULL" ]] || chmod +x "$IMAGEN_FULL" 2>/dev/null || true

SUCCESS=0; FAILED=0

# 항목별 순차 실행 (partial success — 1장 실패가 다음 장 막지 않음)
for i in $(seq 0 $((COUNT - 1))); do
  ENTRY=$(jq -c ".[$i]" "$BATCH_JSON")
  INTENT=$(echo "$ENTRY" | jq -r '.intent')
  MODE=$(echo "$ENTRY" | jq -r '.mode')
  ASPECT=$(echo "$ENTRY" | jq -r '.aspect')
  QUALITY=$(echo "$ENTRY" | jq -r '.quality')
  TARGET=$(echo "$ENTRY" | jq -r '.target')
  # 선택: ref = 스타일 앵커 이미지 경로. 앵커 우선 배치(1장 승인 후 나머지가 앵커 참조)용.
  REFIMG=$(echo "$ENTRY" | jq -r '.ref // empty')

  if bash "$IMAGEN_FULL" "$INTENT" "$MODE" "$ASPECT" "$QUALITY" "$TARGET" "$REFIMG" > /dev/null 2>&1; then
    SUCCESS=$((SUCCESS + 1))
    jq -nc --arg t "$TARGET" --argjson i "$i" \
      '{index:$i,status:"ok",target:$t}' >> "$RESULTS"
  else
    FAILED=$((FAILED + 1))
    RETRY="bash $IMAGEN_FULL '$INTENT' '$MODE' '$ASPECT' '$QUALITY' '$TARGET' '$REFIMG'"
    jq -nc --arg t "$TARGET" --argjson i "$i" --arg r "$RETRY" \
      '{index:$i,status:"fail",target:$t,retry:$r}' >> "$RESULTS"
  fi
done

# 결과 요약 (Claude 측 토큰 절감 — 결과 N줄만 보고)
echo "BATCH_DONE: total=${COUNT} success=${SUCCESS} failed=${FAILED} results=${RESULTS}"
