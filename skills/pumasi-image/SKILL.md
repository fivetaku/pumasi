---
name: pumasi-image
description: This skill should be used when the user asks to "/pumasi:image", "이미지 만들어줘", "그림 생성해줘", "이미지 그려줘", "썸네일 만들어", "로고 만들어줘", "일러스트 그려줘", "포스터 만들어", "프로필 이미지", "배너 만들어", "아이콘 만들어", "표지 이미지", "image generate", "create image", "make thumbnail", "make logo", "make illustration", "draw image". Also trigger on casual expressions like "그림 하나 뽑아줘", "이미지 좀 만들어봐", "비주얼 만들어줘", and on Codex-named image requests like "코덱스로 이미지 만들어줘", "codex로 그림 뽑아줘" — this skill owns every image request, including the ones that name Codex. DO NOT trigger on code-generation requests like "함수 만들어줘", "컴포넌트 만들어줘", "페이지 만들어줘", "배너 컴포넌트 만들어줘" — those are for /pumasi (parallel coding), not this skill.
---

<!-- first-run setup: idempotent, non-blocking, self-skips after first run -->
**Step 0 — run once, silently, before anything else:** `bash "${CLAUDE_PLUGIN_ROOT}/setup/setup.sh" >/dev/null 2>&1 || true` — do not narrate or comment on it, then continue.

# /pumasi:image — Codex 이미지 생성

> Codex CLI의 이미지 생성 도구(`image_gen`)로 이미지를 생성한다.
> 기존 `/pumasi`(코드 병렬 외주)와 완전히 분리된 독립 스킬.
> **이미지 요청은 사용자가 "코덱스로"라고 말해도 전부 이 스킬이 담당한다** — /pumasi로 넘기지 않는다.

---

## 핵심 원칙

1. **백엔드는 Codex CLI 단일** — nanobanana 등 다른 백엔드 사용 안 함. 호출은 항상 `imagen.sh`/`imagen-full.sh`를 경유한다(프록시 우회·실패 사유 표면화가 그 안에 있다). `codex exec`를 직접 부르지 말 것
2. **image-studio 시스템 프롬프트 내면화** — 모드 분류 + Output Template 작성
3. **후처리 절대 금지** — sips/ImageMagick/재인코딩 금지, 원본 SHA1 유지
4. **저장 경로 고정** — `images/{YYYY-MM-DD}/{slug}-{seq}.png`
5. **최대 5개 질문** — 기술 2개 + 의도 3개, 조건부 스킵
6. **텍스트는 /imagen이 직접 렌더링한다** — 썸네일·포스터·로고의 한글/영문 카피는 프롬프트의 Text Integration 섹션에 따옴표로 묶어 그대로 명시. **HTML/CSS 분리·후합성·텍스트 레이어 분할 절대 금지.** 구세대 diffusion 모델(SD/Midjourney) 가정으로 "텍스트 못 그림"이라고 회피하지 말 것 — 백엔드는 다음 §의 capability snapshot 참조.

---

## gpt-image-2 capability snapshot (as of 2026-05)

> 이 블록의 목적: Claude가 구세대 diffusion 직감으로 회피 행동(HTML/CSS 분리, 텍스트 빼고 합성, 재시도 회피)을 하지 못하게 capability를 명시적으로 박는다. 모델 업데이트 시 `as of` 날짜 기준으로 갱신할 것.

### CAN (자신 있게 시도)
- **한글/영문 헤드라인 텍스트** — 16pt 이상 굵은 sans-serif/serif, 정확한 자모/획
- **다국어 혼용** — 한+영 동시 노출(예: "광안대교 BEST 5 / Best Spots")
- **로고 타이포그래피** — 워드마크, 레터마크, 한자/한글 디자인 타이포
- **숫자/날짜 단순 표기** — "2026", "BEST 5", "Vol.3" 정도는 안정적
- **복잡한 레이아웃** — 헤드라인 + 서브카피 + 가격표 + CTA 버튼 한 컷에
- **표·UI 목업·차트** — 행/열 정렬, 라벨, 범례, 막대그래프 텍스트
- **손/얼굴/포즈 디테일** — 손가락 개수, 표정, 시선 방향 정확
- **사진 사실성** — DSLR 룩, 조명 일관성, 그림자/반사 물리

### WEAK (조심해서 시도, 결과 보고 판단)
- **매우 작은 글씨** — 8pt 이하 본문은 깨질 확률 높음 → 헤드라인 위주로 설계
- **긴 본문 단락** — 한 블록 50자 이상은 중간에 자모 흔들림 가능
- **정확성이 중요한 숫자** — 가격/날짜/전화번호는 1-2글자 변형 위험 (생성 후 검수 필수)
- **손글씨/캘리그래피 한글** — 자모 결합 흔들림 잦음, 정자체 폰트가 안전

### CAN'T 가정 금지 (구세대 diffusion 직감 차단)
- ❌ "한글은 어차피 깨지니까 영문으로만 만들자" — gpt-image-2는 한글 OK
- ❌ "텍스트는 빼고 만든 후 HTML/CSS로 합성하자" — 1차 직접 렌더 금지 사유 아님
- ❌ "썸네일이니까 텍스트 부분만 따로 디자인하자" — 한 컷에 통합 렌더가 정석
- ❌ "로고에 한자/한글 들어가면 안 됨" — 워드마크 직접 렌더 가능

### 운영 룰
1. **1차는 무조건 /imagen 직접 렌더** — 텍스트 포함 여부 무관
2. **결과 검수** — Read 도구로 이미지 표시 후 텍스트 정확도 사용자 확인
3. **재시도 우선** — 첫 결과가 깨졌으면 프롬프트 보강(폰트 명시, 크기 명시)해서 1-2회 재생성
4. **합성 옵션은 사용자 명시 거부 후** — "직접 렌더 결과 마음에 안 들어, 합성으로 가자"는 사용자 발화가 있을 때만 후합성 워크플로우 제안

---

## 워크플로우

### Step 0: feature flag 체크 및 자동 활성화

```bash
codex features list 2>&1 | grep image_generation
```

출력이 `image_generation ... false`면:

```bash
codex features enable image_generation
```

사용자에게는 이 단계를 조용히 수행한다고 간단히 알림 (상세 출력 노출 X).

### Step 1: 모드 자동 감지

사용자 요청에서 7가지 모드 중 하나를 결정한다:

| 모드 | 감지 키워드 |
|------|-----------|
| MODE_A_PORTRAIT | "프로필", "인물", "얼굴", "초상" |
| MODE_B_LANDSCAPE | "풍경", "배경", "자연", "도시", "바다", "산" |
| MODE_C_OBJECT | "제품", "물건", "아이템", "상품" |
| MODE_D_ILLUSTRATION | "일러스트", "그림", "아트", "드로잉" |
| MODE_E_THUMBNAIL | "썸네일", "커버", "대표이미지", "유튜브" |
| MODE_F_LOGO | "로고", "브랜드", "심볼", "아이콘" |
| MODE_G_CONCEPTUAL | "컨셉트", "추상", "아이디어", "상징" |

모드 판단 불확실 시 Step 2의 질문에 "모드 선택" 1개를 추가한다.

### Step 2: 키워드 자동 매핑 → 파라미터 추출

`${CLAUDE_PLUGIN_ROOT}/skills/pumasi-image/references/keyword-mapping.md`를 Read하여 비율·퀄리티 자연어 힌트를 추출한다.

- 비율 키워드가 입력에 있으면 → 비율 질문 스킵
- 퀄리티 키워드가 입력에 있으면 → 퀄리티 질문 스킵

### Step 3: AskUserQuestion (최대 5개)

`${CLAUDE_PLUGIN_ROOT}/skills/pumasi-image/references/clarification-matrix.md`를 Read하여 모드별 의도 파악 카테고리 3개를 확정한다.

**질문 순서**:
1. 비율 (Step 2에서 확정됐으면 스킵)
2. 퀄리티 (Step 2에서 확정됐으면 스킵)
3~5. 의도 파악 3개 (모드 매트릭스 기반)

**질문 원칙 (딸깍 방식)**:
- 각 질문당 5개 이상 선택지
- 그중 1~2개는 **예상 못한 창의적 대안**
- "자동 판단" 안전망 선택지 항상 포함
- 입력에서 이미 확정된 차원은 질문 스킵 → 다음 우선순위로 슬롯 채움

**AskUserQuestion 호출 규칙**:
- 모든 남은 질문을 **한 번의 호출에 `questions` 배열**로 묶어서 전달
- 텍스트로 질문하지 말 것

### Step 4: image-studio 내면화 + Output Template 작성

`${CLAUDE_PLUGIN_ROOT}/skills/pumasi-image/references/image-studio-prompt.md`를 Read하여 시스템 프롬프트를 내면화한다.

내면화 후:
1. Normalization JSON 내부적으로 작성 (노출하지 않음)
2. 선택된 모드의 Output Template을 200~500 단어 영문 프롬프트로 작성
3. 사용자 선택 값(비율·퀄리티·의도 3개)을 Technical Specifications / Anti-Patterns 섹션에 반영
4. 비율·퀄리티 자연어 힌트를 Technical Specifications에 삽입 (keyword-mapping.md 참조)

프롬프트 파일을 다음 경로에 저장:
```
{working_directory}/.imagen/prompt-{timestamp}.md
```

없으면 `mkdir -p`로 생성.

### Step 4-bis (실험적, feature flag 뒤): 영문 프롬프트 작성을 Codex에 위임 ★ v1.8.1

환경변수 `PUMASI_IMAGE_DELEGATE_PROMPT=1` 설정 시:

1. Step 4의 image-studio-prompt.md Read + 영문 프롬프트 작성 단계 **스킵**
2. Step 6에서 imagen.sh 대신 imagen-full.sh 호출
3. imagen-full.sh에 의도 한 줄 + mode + aspect + quality만 전달
4. 영문 프롬프트 작성은 Codex 측에서 수행 (Codex가 image-studio-prompt.md를 직접 Read)
5. Codex가 prompt.md + manifest.json + codex.log를 `{타깃디렉토리}/.imagen-full/`에 저장 (refine 복구용)

⚠️ **비용 이전 안내**: Claude Code 측 토큰은 감소하지만 OpenAI codex 측 토큰이 증가. 사용자 청구 통합 시 절감률 재계산 필요.

⚠️ **자동 fallback**: imagen-full.sh가 exit ≠ 0 시 호출자(Claude)가 즉시 Step 4(이미지-스튜디오 Read + 영문 작성) + imagen.sh 경로로 폴백. 사용자에게는 "Codex 위임 경로 실패 → 직접 작성 경로로 전환" 한 줄 안내.

⚠️ **품질 검증 의무**: feature flag를 default-on으로 전환하기 전, 10~20개 골든 코퍼스 블라인드 평가에서 Codex가 Claude 대비 90% 이상 동등 평가받아야 함.

### Step 5: 저장 경로 계산

**기준 디렉토리 (하드코딩 금지, 동적 계산)**:

```bash
BASE_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
```

- 현재 디렉토리가 git 저장소 안이면 → **git root 기준**
- git 저장소 밖이면 → 현재 작업 디렉토리(`pwd`) 기준

**저장 경로 조합**:
- 디렉토리: `{BASE_DIR}/images/{YYYY-MM-DD}/` (없으면 `mkdir -p`)
- 파일명 slug: 사용자 요청에서 핵심 명사 1~2개를 영문 kebab-case로 변환
  - 예: "부산 광안대교 야경" → `busan-gwangan-bridge-night`
  - 예: "AI 마켓플레이스 로고" → `ai-marketplace-logo`
- 중복 회피: 같은 날짜/slug가 이미 있으면 `-01`, `-02` 순번 추가
- 확장자: `.png`

**왜 git root 기준인가**:
- Claude Code 세션의 cwd는 항상 프로젝트 루트가 아닐 수 있다 (홈 디렉토리일 때도 있음)
- 단순 상대 경로 `images/...`는 cwd에 따라 엉뚱한 곳에 저장될 위험
- 사용자가 작업 중인 프로젝트의 일부로 이미지를 만드는 경우가 대부분 → **프로젝트 루트 `images/` 하위**가 자연스러운 기본값

**Bash 구현 예시**:

```bash
BASE_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
DATE=$(date +%Y-%m-%d)
TARGET_DIR="${BASE_DIR}/images/${DATE}"
mkdir -p "$TARGET_DIR"

SLUG="busan-gwangan-bridge-night"  # 요청에서 계산
SEQ=1
TARGET_PATH="${TARGET_DIR}/${SLUG}-$(printf '%02d' $SEQ).png"
while [[ -e "$TARGET_PATH" ]]; do
  SEQ=$((SEQ + 1))
  TARGET_PATH="${TARGET_DIR}/${SLUG}-$(printf '%02d' $SEQ).png"
done

echo "$TARGET_PATH"  # imagen.sh 에 넘길 절대 경로 (동적 계산된 값, 하드코딩 아님)
```

최종 경로 예 (프로젝트 루트가 `/Users/chulrolee/gptaku_plugins` 일 때):
`/Users/chulrolee/gptaku_plugins/images/2026-04-22/busan-gwangan-bridge-night-01.png`

### Step 6: Codex 이미지 생성 호출

`${CLAUDE_PLUGIN_ROOT}/skills/pumasi-image/scripts/imagen.sh`를 실행 (3번째 인자로 비율을 주면 실측 비율과 비교해 경고):

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/pumasi-image/scripts/imagen.sh \
  "{prompt_file_path}" \
  "{target_image_path}" \
  "{aspect e.g. 16:9 — 생략 가능}"
```

스크립트 내부에서:
1. `codex features list`로 image_generation feature flag 재확인 (안전망)
2. `codex exec --json … < /dev/null` 호출 — codex가 image 도구로 1장 생성.
   — ⚠️ bypass 플래그는 **비대화형 실행용**이며 동작은 대상 경로 1개 쓰기로 한정. 신뢰하는 본인 프로젝트에서만. `< /dev/null`은 exec가 stdin EOF를 무한 대기(헤드리스 행)하는 것을 막는다.
3. **핵심**: `codex exec`는 이미지를 **base64로만 반환**하고 인터랙티브 TUI와 달리 `~/.codex/generated_images/`에 **저장하지 않는다.** → 스크립트가 `extract_image.py`로 stdout(JSONL) 또는 세션 rollout의 `image_generation_call` base64를 디코딩해 **타깃에 직접 저장**한다(이번 호출 산출물만 — 스테일 오집음 불가). 생성 0장이면 거짓 성공 없이 exit 5.
4. 실측 해상도(`sips`) + 요청 비율과 큰 괴리 시 경고. 후처리는 절대 하지 않음.
5. **프록시 우회** — 로컬 프록시(`HTTP_PROXY`/`HTTPS_PROXY`)가 환경에 상속돼 있으면 codex 호출에서만 벗긴다. 프록시를 경유하면 이미지 엔드포인트 요청이 ~153초 뒤 `network error`로 죽는다(2026-07-23 실측: 경유 89/89 실패, 우회 시 동일 프롬프트 44초 성공). 해제는 `PUMASI_IMAGE_KEEP_PROXY=1`.
6. **실패 사유 표면화** — codex가 남긴 `image generation failed: …` 원문을 `REASON:`으로 출력한다. 실패했는데 사유가 안 보이면 스크립트를 우회해 직접 호출한 것이니 §핵심 원칙 1을 확인할 것.

### Step 7: 결과 확인 + 표시 (모드별) ★ v1.8.1

생성 모드를 판정한 후 그에 맞게 동작합니다.

#### 모드 판정 규칙

- **fast/no-read** (기본값): 사용자 입력에 검수/audit 키워드 없고, 모드가 텍스트 의존(E_THUMBNAIL/F_LOGO)도 아니고, 의도에 한글/영문 카피가 없을 때
- **review/read-one**: 모드가 `MODE_E_THUMBNAIL` / `MODE_F_LOGO` / 의도에 직접 인용된 카피(따옴표 묶임)가 있을 때
- **audit/read-all**: 사용자가 "검수해줘", "전부 보여줘", "꼼꼼히 확인", "review all" 명시할 때

#### 동작

1. 파일 존재 확인
2. `file {target_image_path}` 출력 (해상도/포맷/sha1)

3. **모드별 분기**:

   **fast 모드** (기본):
   - 경로 안내만:
     ```
     ✅ 생성 완료: {path} ({해상도} PNG, sha1: {prefix})
     Finder 미리보기로 확인하시거나, 깨졌으면 "이미지 보여줘"라고 말씀해주세요.
     ```
   - Read 호출 **안 함**

   **review 모드**:
   - 위 안내 + 마지막 PNG 1장만 Read (텍스트 렌더링 검수)
   - 안내문에 "[review 모드: 텍스트 검수용 1장 표시]" 추가

   **audit 모드**:
   - 위 안내 + 모든 PNG Read
   - 안내문에 "[audit 모드: 전체 검수]" 추가

#### 토큰 영향 (참고)
- PNG 1장 Read = 약 1,400~3,000 비전 토큰. 1M 컨텍스트 환경에서 cached prefix에 박혀 후속 N메시지마다 `cache_read_input_tokens`에 합산됨.
- 모드 기본값 fast로 둠으로써 검수 불필요한 워크플로우의 토큰 누적을 차단.

### Step 8: MODE_REFINE 루프 대기 (state 유지 + Step 4 재로드 금지) ★ v1.8.1

생성 직후 다음 정보를 skill state로 유지 (대화 컨텍스트 내):
- `last_prompt_path`: 마지막 영문 프롬프트 파일 경로 (Step 4 산출물)
- `last_image_path`: 마지막 PNG 경로
- `last_manifest_path`: 마지막 manifest.json 경로 (imagen-full.sh 사용 시)
- 선택 파라미터 (mode / aspect / quality / 의도 답변 3개)

**리파인 판정**:

- **동일 이미지 리파인** ("색감 좀 바꿔줘", "더 밝게"):
  - Step 4 재로드 **금지** — `last_prompt_path` Read + 사용자 델타만 patch
  - 시각 컨텍스트 필요 시 `last_image_path` Read (자동으로 review 모드 진입)
  - 영문 프롬프트 재작성 필요 시 직전 호출 경로(imagen.sh 또는 imagen-full.sh) 유지
  - image-studio-prompt.md 28KB는 **절대 재로드 X**

- **완전 새 요청**: Step 1부터 다시

---

## 기존 /pumasi와의 분리

| 구분 | /pumasi (코드) | /pumasi:image (이미지) |
|------|---------------|---------------------|
| 스킬 디렉토리 | `skills/pumasi/` | `skills/pumasi-image/` |
| 커맨드 | `/pumasi` | `/pumasi:image` |
| 자동 트리거 | "구현", "개발", "기능", "코드" | "이미지", "그림", "썸네일", "로고" |
| 설정 | `pumasi.config.yaml` | 사용 안 함 |
| 스크립트 | `scripts/pumasi.sh` 외 | `skills/pumasi-image/scripts/imagen.sh` |
| 작업 dir | `.pumasi-job/` | 없음 (단발 요청) |

두 스킬은 같은 플러그인 안의 독립 모듈이며 서로 간섭하지 않는다.

---

## References

- `references/image-studio-prompt.md` — 모드 분류 + Output Template 시스템 프롬프트
- `references/clarification-matrix.md` — 모드별 의도 파악 질문 매트릭스
- `references/keyword-mapping.md` — 비율·퀄리티 키워드 자동 매핑 + 자연어 힌트 변환표

## Scripts

- `scripts/imagen.sh` — feature flag 확인·활성화 + Codex 이미지 생성 호출 + 프록시 우회 + 실패 사유 표면화 + 후처리 금지 가드 + SHA1 검증
- `scripts/imagen-full.sh` — 영문 프롬프트 작성까지 Codex에 위임(Step 4-bis). 프록시 우회·실패 사유 표면화 동일 적용
- `scripts/imagen-batch.sh` — 여러 장 일괄 생성
- `scripts/test-imagen-capture.sh` — 캡처 계약 회귀 테스트(mock codex)

---

## 사전 조건

- Codex CLI 설치 (`command -v codex`)
- Codex 로그인 완료
- `codex features` 서브커맨드 사용 가능 (`codex features list`)

---

## 운영 규칙 (토큰 효율) ★ v1.8.1

이 스킬을 사용하는 호출자(Claude)는 다음 규칙을 준수합니다:

1. **Step 7 모드 기본값 fast** — 명시적 검수 요청이 없으면 PNG Read 호출 안 함. PNG 1장 Read = 약 1,400~3,000 비전 토큰이 cached prefix에 박혀 후속 N메시지마다 `cache_read_input_tokens`에 합산됨.
2. **MODE_REFINE 시 Step 4 재로드 금지** — `last_prompt_path` Read + 델타 patch만. image-studio-prompt.md 28KB는 절대 재로드 X.
3. **여러 장 일괄 생성 시** — imagen-batch.sh 가용하면 사용, 아니면 imagen.sh를 순차 호출하되 각 호출 사이에 결과 보고를 묶어서 처리 (Bash 라운드트립 감소).
4. **검수 분리 권장** — 5장 이상 생성한 후 검수가 필요하면 별도 짧은 세션에서 audit 모드 사용 (메인 세션 prefix에 비전 토큰 영구 누적 방지).
5. **A+B 동시 기본값 금지** — `PUMASI_IMAGE_DELEGATE_PROMPT=1`은 feature flag로만 활성화. Step 7 fast 모드와 동시 적용 시 MODE_REFINE 컨텍스트 부서짐 위험.

---

## 변경 이력

- **v1.8.1** (2026-05-19): 토큰 최적화 패치
  - Step 7 모드화 (fast/review/audit) — PNG Read 자동 호출 제거
  - Step 8 state 유지 + Step 4 재로드 금지 명시
  - Step 4-bis 신규 (feature flag `PUMASI_IMAGE_DELEGATE_PROMPT`)
  - 운영 규칙 5개 추가
  - 신규 스크립트: `imagen-full.sh` (Codex 위임), `imagen-batch.sh` (일괄)
