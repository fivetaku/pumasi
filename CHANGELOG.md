# Changelog

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
