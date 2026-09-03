# Changelog

## 1.16.1 (2026-09-04)

- README(en/ko)에 `/pumasi:image` 이미지 생성 스킬 섹션 추가 — plugin.json이 광고하는 기능 절반이 README에 없었음(Codex gpt-image-2 / Grok image_gen 백엔드, 비율·텍스트 렌더 특성)
- Requirements의 워커 목록 보강: Codex(기본) 외 Grok·Cursor CLI(cursor-agent)·Antigravity(agy)·gajae-code(gjc) 대체/혼합 워커 4종 — SKILL.md엔 있었으나 README는 Grok만 언급
- (kkirikkiri E2E 감사 확정 발견 반영)


## 1.16.0 — 2026-08-27

- **Cursor CLI(`cursor-agent`)를 외주 워커로 추가.** Cursor Ultra 구독을 품앗이 워커로 활용한다 — command 문자열 방식이라 코드 변경 없이 설정만으로 동작.
  ```yaml
  command: "cursor-agent -p --force --output-format text"
  ```
  - **모델 선택이 최대 강점**: `--model`로 `composer-2.5`, `gpt-5.3-codex-*`, **`claude-opus-5-thinking-high`/`claude-fable-5-thinking-high`** 지정 가능 — Claude Max 쿼터 소진 시 Cursor 구독으로 Opus/Fable 작업을 잇는 우회 경로.
  - `--force` 필수 — 없으면 "Do you trust the contents of this directory?"에서 비대화형 즉사(파일 생성 0건). CLI 안내대로 `--trust`/`--yolo`/`-f` 중 아무거나면 된다. codex 전용 `--output-schema` 미주입 → output.txt 기반 통합(graceful).
  - **실측 E2E(2026-08-27, 2026.08.25 빌드)**: 워커 2개 동시 실행(`--model composer-2.5` + 기본) 둘 다 exit 0, 게이트 4/4 통과, 47~59초, `output.txt` 정상 회수, `report.json` 미생성(설계대로).
  - 회귀 테스트에 `cursor-agent` 케이스 추가 — 이름에 `codex`가 없어도 전용 플래그가 새지 않는지, `--force`/`--model`이 보존되는지, 프롬프트가 마지막 positional로 가는지 고정. **18/18 통과**.
  - 설치 안내 교정: `curl https://cursor.com/install -fsS | bash`. 동일 바이너리가 `agent`로도 심링크되지만 grok CLI(`~/.grok/bin/agent`)와 이름이 충돌하므로 config에는 `cursor-agent`를 쓴다.
  - ⚠️ 훅 충돌: Orca 등이 남긴 `~/.cursor/hooks.json` preToolUse 잔재가 있으면 "환경 훅 오류" 로 전 작업 실패 — 트러블슈팅 명시.
  - 워커 선택 AskUserQuestion(Phase 0.5) 선택지와 "외주 워커 교체" 절에 반영. `pumasi.config.yaml`에 `cursor`/`cursor-opus` 예시 command 주석 추가.

## 1.15.0 — 2026-08-26

- **워커/백엔드 선택 AskUserQuestion 추가.** v1.13.0(grok 워커)·v1.14.0(`--backend grok`)으로 실행 경로는 이미 있었지만 SKILL 플로우에 질문 단계가 없어 항상 codex 기본값으로 직행하던 문제를 수정.
  - `/pumasi`(코드): Phase 0.5 신설 — 기획 승인과 **같은 AskUserQuestion 콜**에 워커 문항(Codex 권장 / Grok / 혼합 / agy·gjc) 포함. 사용자가 요청에서 워커를 지명했으면 스킵. 선택 직후 `command -v` 설치 확인(grok은 `~/.grok/bin/grok` 폴백), 미설치면 codex 폴백.
  - `/pumasi:image`: Step 3 질문 배치 0순위에 백엔드 문항(Codex gpt-image-2 권장 / Grok image_gen — SuperGrok 0원, 비율 9:16·16:9·1:1 한정) 추가. Grok 선택 시 비율 선택지 3종 제한 + 퀄리티 질문 스킵. Step 6에 `--backend` 인자 문서화.
- **grok 백엔드 확장자 오표기 수정.** grok 산출물(JPEG)을 `.png` 이름 그대로 복사하던 것을, 소스 확장자와 다르면 타깃 확장자를 자동 조정하고 최종 경로를 `path:`로 보고하도록 수정. 회귀 테스트 갱신(32/32 통과).

## 1.13.0 — 2026-08-23

- **Grok CLI(`grok`)를 외주 워커로 추가.** `defaults.command` 또는 task별 `command`에 지정하면 바로 쓸 수 있다 — 품앗이는 command 문자열 방식이라 코드 변경 없이 설정만으로 동작한다.
  ```yaml
  command: "grok --no-auto-update --no-alt-screen --sandbox workspace --always-approve -p"
  ```
  - **샌드박스가 기본 off**라(codex와 반대) `--sandbox workspace`로 조인다. 자동 업데이터가 실행 중 끼어들지 않도록 `--no-auto-update` 필수.
  - codex 전용 `--output-schema/-o`는 주입되지 않으므로 `report.json` 없이 `output.txt` 기반 통합(graceful). grok 자체는 `--json-schema`를 지원하지만 결과가 stdout JSON의 `.text`에 문자열로 중첩돼 파일로 떨어지지 않는다(언랩 미구현).
  - 실측(2026-08-23, grok 1.0.4): **워커 3개 동시 실행 전부 exit 0, 게이트 9/9 통과, 레이트 리밋 에러 0건, output.txt 정상**(agy의 stdout 누락 버그 없음). 소요 24~53초.
  - ⚠️ PATH 주의: `~/.grok/bin/grok`에 설치되고 셸 프로필로만 PATH에 오른다. 비대화형 셸에서 못 찾으면 절대경로로 지정한다. 또한 npm 서드파티 `@vibe-kit/grok-cli`가 같은 `grok` 이름을 쓰므로 어느 쪽이 잡히는지 확인이 필요하다.
- **문서 경계 명시**: 같은 과제를 여러 워커에게 시키는 **토너먼트는 품앗이의 기능이 아니다.** 품앗이의 본질은 *분할*이고 토너먼트는 *중복*이라 "단일 파일 작업 = 병렬 이점 없음" 규칙과 충돌한다. 경쟁·채점·승자 채택은 끼리끼리(kkirikkiri) Workflow 경로 소관. 설계 근거: `docs/design/worker-tournament/01_PRD.md`

- **회귀 테스트 추가** — `tests/test-worker-command.sh` (13 assertions). codex 전용 `--output-schema`/`-o`가 grok·agy·gjc에 누출되지 않는지를 고정한다(누출되면 워커가 알 수 없는 플래그로 즉사). 변이 테스트로 검출력 확인(`isCodex` 게이트 제거 → 4건 실패 검출).
## 1.11.6 — 2026-07-23

- **이미지 진입구 중복 제거.** 슬래시 메뉴에 `/pumasi:image`(커맨드)와 `/pumasi:pumasi-image`(스킬)가 같이 떴다. 커맨드는 "SKILL.md 읽고 그대로 해라"는 3줄 디스패처였을 뿐 실행 로직은 전부 스킬에 있었다.
  - `commands/image.md` 삭제.
  - 스킬 디렉토리 `skills/pumasi-image/` → `skills/image/`, frontmatter `name: pumasi-image` → `name: image`. 그 결과 **호출 문자열 `/pumasi:image`는 그대로 유지**되고 진입구만 하나로 줄었다.
  - 사용자 입장 변화 없음 — `/pumasi:image`도, 자연어 트리거도 전과 동일하게 동작한다.

## 1.11.5 — 2026-07-23

- **[P0] 이미지 생성이 로컬 프록시 뒤에서 100% 실패하던 문제 수정.** 환경에 `HTTP_PROXY`/`HTTPS_PROXY`가 상속돼 있으면 codex(reqwest)가 그걸 따라가고, 이미지 엔드포인트 요청이 **~153초 뒤 `network error`로 죽는다**. Claude Code를 로컬 프록시와 함께 띄우면 자식 프로세스인 codex가 자동으로 물려받기 때문에 사용자는 원인을 알 수 없었다. `imagen.sh`/`imagen-full.sh`가 **codex 호출에서만** 프록시를 벗긴다(셸 환경은 그대로). 해제는 `PUMASI_IMAGE_KEEP_PROXY=1`.
  - 실측(2026-07-23): 프록시 경유 89/89 실패(전부 153.3초에 끊김), 동일 프롬프트를 우회하면 44.6초 만에 1672×941 PNG 성공.
- **[P0] 실패 사유 표면화.** codex는 `image generation failed: network error: …`를 로그에 남기는데 래퍼가 그걸 버리고 `NO image (base64 못 찾음)`만 출력했다. 네트워크 실패와 정책 거부가 구분되지 않아 위 장애가 40회+ 오진됐다. 이제 codex 원문을 `REASON:`으로 출력하고, network error면 프록시 힌트를 덧붙인다.
- **트리거 경계 정리.** "코덱스로 이미지 만들어줘" 같은 발화가 `pumasi`(병렬 코딩)와 `pumasi-image` 양쪽에 걸리던 문제 — `pumasi` 스킬에 이미지 요청 negative 가드를 추가하고, `pumasi-image`에 `/pumasi:image`와 Codex 지칭 이미지 표현을 명시해 소유권을 한쪽으로 고정했다.
- **문서 현행화.** codex 0.145 기준 이미지 도구 이름은 `image_gen`이며 `/imagen` 슬래시는 `codex exec`에서 무효 문자열이다. 커맨드/스킬 설명의 `/imagen` 표기를 실제 동작에 맞게 교체.
- 회귀 테스트 2건 추가(실패 사유 표면화, 프록시 우회 + opt-out) — 17/17 통과.

## 1.11.4 — 2026-06-29

- **omc 잔재 제거**: pumasi-image의 프롬프트 저장 경로 `{working_directory}/.omc/imagen/` → `.imagen/`로 변경(omc 툴 의존이 아니라 디렉토리 이름만 omc 유래였음). `.gitignore`도 정리.
- **버전 하드코딩 폴백 수정**: `imagen-full.sh`·`imagen-batch.sh`가 `CLAUDE_PLUGIN_ROOT` 미설정 시 죽은 경로(`.../pumasi/1.11.0`)로 폴백하던 것을 스크립트 위치 기반(버전 무관)으로 교체.

## 1.11.3 — 2026-06-29

- **Gemini CLI 잔여 언급 제거**: provider는 이미 codex / antigravity(`agy`)로 단일화돼 있고, SKILL.md에 남아 있던 "Gemini CLI 후계" 설명 한 줄을 제거했다. 기능 변화 없음(문서 정리).

## 1.11.1 — 2026-06-22

GPT-5.5 Pro 리뷰(insane-review)가 v1.11.0에서 찾아낸 결함 수정:
- **[P0] set -e 조기 종료:** `measure_dims()`가 sips 실패 시, `aspect_warn()`가 비율 일치 시 비0을 반환해 `DIMS=$(...)` / `&& aspect_warn` 호출부가 **이미지 저장 성공 직후 스크립트를 중단**시켰다(sips 없는 비-macOS, 또는 비율이 우연히 맞는 경우). 두 함수에 `return 0` 가드 추가.
- **`extract_image.py` 검증 강화:** base64 `validate=True` + 완전한 8바이트 PNG 시그니처 + IEND 청크 + 최소 크기 확인 → 깨진/가짜(예: 12바이트) PNG를 성공 처리하던 문제 차단. 여러 이벤트 시 **마지막 유효 이미지(최종 프레임)** 선택(기존: 최대 길이).
- 회귀 테스트에 rc-safety + 가짜 PNG 거부 케이스 추가(12/12).

## 1.11.0 — 2026-06-22

- **`/pumasi:image` 생성 경로 근본 수정.** `codex exec`는 이미지를 생성해 **base64로만 반환**하고, 인터랙티브 TUI와 달리 `~/.codex/generated_images/`에 파일로 저장하지 않는다. 기존 래퍼는 그 폴더에 새 파일이 생기길 기다리다, 모델이 "원본을 타깃에 복사하라"는 지시를 지키려 **기존 스테일 파일을 복사** → *다른 프롬프트인데 같은 이미지* + sha1 가드 거짓 성공이라는 버그를 냈다.
- **수정:** `imagen.sh` / `imagen-full.sh`가 `codex exec --json`(+ `< /dev/null`로 stdin 행 방지)으로 받아 `extract_image.py`로 stdout(또는 세션 rollout)의 `image_generation_call` base64를 디코딩해 타깃에 **직접 저장**. 생성 0장이면 거짓 성공 없이 `exit 5`. 실제 codex로 1536×1024 PNG 생성 검증 완료.
- **anti-icon 가드:** 비-로고 단일 심볼 컨셉을 앱아이콘/글래스 배지로 만들지 않도록 `image-studio-prompt.md`에 Format/Medium Guard 추가.
- **비율 경고:** `sips`로 실측해 요청 비율과 15%↑ 어긋나면 경고(gpt-image는 비율 미보장, 후처리 금지라 보정 안 함).
- **`imagen-cleanup.sh`** 추가 — `generated_images/` 누적 정리(기본 dry-run, `--apply` 시 trash).
- 회귀 테스트 `test-imagen-capture.sh`(10/10) + `extract_image.py` 추가. 스테일 `PLUGIN_ROOT` 기본값 `1.8.0` → `1.11.0`.

## 1.10.3 — 2026-06-21

- The GitHub-star prompt is shown in the user's current language; on a fresh session with no language signal yet, it falls back to the language detected from your recent Claude sessions (else English).
- GitHub star is now **opt-in** — on first run the command asks once via AskUserQuestion (`네, ⭐ 눌러주기` / `아니요`) instead of auto-starring. The star logic moved into `setup.sh` and records the choice (`~/.gptaku-setup/<plugin>.star.json`) so it never re-asks. `setup.sh` no longer stars anything automatically.

## [1.10.2] - 2026-06-19

### Added — 외주 워커로 gajae-code(`gjc`) 정식 문서화

command 문자열 방식이라 코드 변경 없이 `defaults.command` / task별 `command`만 바꾸면 gjc로 외주 가능. SKILL.md "외주 워커 교체" 섹션에 agy와 나란히 gjc를 1급 옵션으로 추가.

- `command: "gjc --print"` — 프롬프트가 `--print` 뒤 positional(MESSAGE)로 자동 전달 (워커의 "마지막 positional" 패턴과 호환)
- codex 전용 `--output-schema/-o`는 gjc에 미주입 → `report.json` 없이 `output.txt` 기반 통합 (graceful, agy와 동일)
- 실측(2026-06-19): `gjc --print` 비-TTY 파이프에서 stdout 정상 캡처 (agy stdout 누락 버그 없음)
- task별 혼합 외주(codex/gjc/agy) 안내 추가

## [1.9.1] - 2026-06-05

### Added
- `references/anti-patterns.md` "Red Flags — 자가체크표" — PM(Claude)이 개발자 역할(코드 대필)을 침범하기 직전의 충동 5개를 Excuse→Reality 표로 차단. "letter만 지키고 spirit 어기지 마라" 문구 포함.

### Why
obra/superpowers `writing-skills`의 합리화 차단 패턴 도입. pumasi의 핵심 실패모드(PM이 직접 코드를 써서 Codex가 파일 저장 도구로 전락)를 실행 시점에 직격.

## [1.8.1] - 2026-05-19 — 토큰 최적화 패치

### Added
- `scripts/imagen-full.sh` — 영문 프롬프트 작성까지 Codex 위임 (feature flag `PUMASI_IMAGE_DELEGATE_PROMPT=1`)
- `scripts/imagen-batch.sh` — 여러 장 일괄 생성 (partial success + per-item retry manifest)
- SKILL.md "운영 규칙" 섹션 — 토큰 효율 5개 규칙 명문화

### Changed
- SKILL.md Step 7 모드화 — `fast` (기본, Read 안 함) / `review` (1장 Read) / `audit` (전체 Read). 기본값 fast로 PNG 자동 누적 차단.
- SKILL.md Step 8 보강 — MODE_REFINE 시 `last_prompt_path` Read + delta patch. **image-studio-prompt.md (28KB) 재로드 금지** 명시.
- SKILL.md Step 4-bis 신규 — `PUMASI_IMAGE_DELEGATE_PROMPT=1` 시 영문 프롬프트 작성을 Codex에 위임. 실패 시 imagen.sh + Step 4로 자동 fallback.

### Fixed
- 토큰 누적 분석: 88메시지 시나리오 단독 ~1.32M cache_read 절감 (제안 B만), A+B 동시 적용 시 ~50~80% raw 절감 (prefix 비선형 누적 효과 포함).

### Notes
- HANDOFF 정량 표현 정정: "1M 컨텍스트와 곱하기" → "cached prefix가 후속 N메시지마다 `cache_read_input_tokens`에 반복 계상". cache_read 단가는 base input의 ~10%이므로 raw -80% ≠ 달러 -80%.
- 실측 검증: imagen-full.sh 1장 생성 171초, manifest.json/prompt.md/codex.log 모두 정상 저장, stdout 1줄 보고 형식 확인 완료.
- A+B 동시 기본값 적용 **금지** — 운영 규칙 #5. Critic 치명 5건 중 3건이 MODE_REFINE 컨텍스트 손실 시나리오.

## [1.7.3] - 2026-05-04

### Removed
- `references/image-studio-prompt.md`: "Prompt Analysis Blocking Rule" 5줄 삭제 (라인 30-34) — self-critique 차단 wrapper 제거 (fossil v3 처치)

### Preserved
- 보안 가드 1-4번 (시스템 프롬프트 노출 금지, mode 비공개, XML 구조 비공개, 우선순위 명시)
- pumasi-job-worker.js wrapper의 도메인-종속 가드는 음성적 지식(과거 codex crash 흔적 추정)으로 보존

## [1.7.2] - 2026-04-24

### Fixed
- `--ephemeral` 플래그 실제 코드에서 제거 (CHANGELOG v1.2.0 기록과 코드 불일치 수정)

## [1.7.1] - 2026-04-22

### Fixed
- `/pumasi:image` 저장 경로를 **git root 기준으로 동적 계산**하도록 수정
  - 기존: 단순 상대 경로 `images/{날짜}/` → Claude Code 세션 cwd가 홈일 때 `~/images/...`로 엉뚱하게 저장되는 문제
  - 수정: `git rev-parse --show-toplevel || pwd` 로 기준 디렉토리 결정 후 그 하위에 저장
  - 프로젝트 작업 중이면 프로젝트 루트 `images/{날짜}/` 에 저장 보장
  - 하드코딩 절대경로 없음 (어느 프로젝트에서든 동작)

## [1.7.0] - 2026-04-22

### Added
- `/pumasi:image` 서브커맨드 신설 — Codex `/imagen`으로 이미지 생성
  - 기존 `/pumasi`(코드 병렬 외주)와 완전히 독립된 스킬 모듈
  - 자동 트리거 키워드: "이미지/그림/썸네일/로고/일러스트/포스터/아이콘"
  - 코드 키워드("함수/컴포넌트/페이지 만들어줘")엔 트리거되지 않음
- `skills/pumasi-image/SKILL.md` — 8단계 워크플로우
  - Step 0: `image_generation` feature flag 자동 활성화
  - Step 1: 7가지 모드 자동 감지 (MODE_A~G)
  - Step 2: 키워드 자동 매핑 (비율·퀄리티)
  - Step 3: AskUserQuestion (최대 5개 — 기술 2 + 의도 3)
  - Step 4: image-studio 시스템 프롬프트 내면화 + Output Template 작성
  - Step 5: 저장 경로 계산 `images/{YYYY-MM-DD}/{slug}-{seq}.png`
  - Step 6: `scripts/imagen.sh` 호출 + 후처리 금지 가드
  - Step 7: Read로 결과 표시
  - Step 8: MODE_REFINE 멀티턴 루프
- `references/image-studio-prompt.md` — 모드 분류 + 모드별 Output Template
- `references/clarification-matrix.md` — 모드별 의도 파악 질문 매트릭스
  - 모드당 3개 슬롯 (스타일/분위기/색감/구도/용도/텍스트공간/사용맥락/배경 등)
  - 각 카테고리 5개 이상 선택지 + 1~2개 창의적 대안 + "자동 추천" 안전망
- `references/keyword-mapping.md` — 비율·퀄리티 키워드 자동 매핑 + 자연어 힌트 변환표
- `scripts/imagen.sh` — Codex 호출 래퍼
  - feature flag 자동 활성화
  - 후처리 금지 가드 자동 주입
  - SHA1 해시 일치 검증 (원본 ↔ 저장본)

### Notes
- 백엔드는 **Codex `/imagen` 단일**. nanobanana(Gemini API) 의존성 없음.
- Codex CLI의 기술 파라미터 제어 한계로 인해 Size/Quality는 **자연어 힌트**로만 전달됨 (정확한 해상도 보장 X).
- 9:16 세로, 4:1 배너는 Codex 지원 여부 불확실 (실험적).
- 투명 배경은 현재 스코프 밖 (Codex CLI에서 alpha 채널 지원 불가 확인됨).

## [1.6.0] - 2026-03-18

### Changed
- SKILL.md Progressive Disclosure 리팩토링: 705줄 → 281줄 (60% 감소)
  - 레퍼런스 콘텐츠를 `references/` 디렉토리로 분리 (6개 파일)
  - anti-patterns.md, role-separation.md, codex-guide.md, instruction-templates.md, tech-stack.md, examples.md
  - SKILL.md에 참조 포인터 유지, 필요 시 Read로 로드하는 구조
  - 핵심 실행 흐름(트리거, 워크플로우, Phase 0~6)은 SKILL.md에 유지

## [1.3.1] - 2026-03-02

### Fixed
- Command file Execute 섹션: "located at" 정보 제공 → 명시적 Read 지시로 변경
  - SKILL.md를 반드시 Read하도록 번호 리스트 추가
  - AskUserQuestion 도구 호출 필수 규칙 명시

## [1.3.0] - 2026-02-28

### Added
- Phase 5.5: `/simplify` 코드 정리 단계 (게이트 PASS 후, 통합 전)
  - 병렬 에이전트가 코드 품질/컨벤션을 자동 점검
  - Claude PM 토큰을 거의 사용하지 않으면서 Codex 코드 품질 보완
  - `/simplify` 후 게이트 재실행으로 기능 보존 확인
- `/batch`와의 관계 가이드 섹션
  - 품앗이(Greenfield) vs /batch(Brownfield) 포지셔닝 명확화
  - 작업 유형별 도구 선택 가이드

## [1.2.0] - 2026-02-28

### Changed
- SKILL.md 전면 개정: "복붙형 instruction" 안티패턴 근절
  - Claude는 시그니처 + 요구사항만 작성, 함수 body 작성 금지
  - Codex가 실제 구현자로 동작하도록 역할 분리 명확화
- pumasi.config.yaml 예시를 시그니처 패턴으로 전면 교체
  - 이전: 전체 코드 블록 포함된 테스트용 config
  - 이후: auth-token, auth-password, user-model 시그니처 예시
- 게이트 설계 원칙 변경: ls/grep 중심 → tsc/build/test 중심

### Added
- 안티패턴 경고 섹션 (SKILL.md 최상단)
- Claude vs Codex 역할 분리 표 (제공 vs 금지 명확화)
- 게이트 셸 호환성 가이드: `test -f` → `[ -f ]` POSIX 브래킷 문법
- Phase 5에 Step 0 "의존성 확인" 단계 추가 (npm install 후 게이트 실행)
- 작업 규모별 분기 가이드 (1-2개: Claude 직접, 5+: 품앗이 권장)
- instruction 자기 점검 체크리스트 (코드 블록/복붙 패턴 감지)
- 좋은 instruction vs 나쁜 instruction 비교 예시

### Removed
- "import 문과 초기화 코드까지 직접 작성해서 제공" 가이드 삭제
- better-sqlite3 "좋은 instruction" 예시 (전체 코드 제공 패턴) 삭제
- 기본 Codex 명령어의 `--ephemeral` 플래그 제거

## [1.1.0] - 2026-02-27

### Added
- 워커 프롬프트에 코드 스타일 규칙 추가 (정확성 최우선 + 관용적 패턴)
- config `style` 필드로 프로젝트별 커스텀 코드 스타일 주입 지원
- 라운드 기반 실행 (round 1 완료 후 round 2 자동 시작)
- 게이트(gates) 실행 및 자동 검증
- 재위임(redelegate) + 자동수정(autofix) 워크플로우
- `--output-schema` 구조화 JSON 출력 지원
- 빈 프롬프트 감지 및 에러 처리 (DOE E06e)
- `package.json` 추가 (yaml 의존성 관리)

### Changed
- 기본 Codex 명령어에 `--ephemeral` 플래그 추가
- `reference_files` 경로 해석: SKILL_DIR → workingDir 기준으로 변경
- 에러 메시지 구체화 (워커 필수 인자 안내)

### Fixed
- `startedAt` 타이밍 데이터 누락 수정 (에러/종료 핸들러)

## [1.0.0] - 2026-02-26

### Added
- 최초 릴리스 (CCPS v2.0 준수)
- Claude PM + Codex 병렬 워커 아키텍처
- N개 Codex 인스턴스 병렬 실행
- 태스크별 instruction 자동 구성
- 워커 프로세스 관리 (start/status/wait/results/stop/clean)
- `pumasi.config.yaml` 기반 태스크 설정
- 컨텍스트 파일 참조 (`reference_files`)
