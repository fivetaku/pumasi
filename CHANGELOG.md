# Changelog

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
