# pumasi.sh 스크립트 가이드

## 커맨드 레퍼런스

```bash
# 시작
pumasi.sh start [--config path] "프로젝트 컨텍스트"
pumasi.sh start --json "컨텍스트"

# 상태 확인
pumasi.sh status [JOB_DIR]          # JSON
pumasi.sh status --text [JOB_DIR]   # 한 줄 요약
pumasi.sh status --checklist [JOB_DIR]

# 대기
pumasi.sh wait [JOB_DIR]

# 결과
pumasi.sh results [JOB_DIR]
pumasi.sh results --json [JOB_DIR]

# 관리
pumasi.sh stop [JOB_DIR]
pumasi.sh clean [JOB_DIR]
```

## 파일 구조

```
${CLAUDE_PLUGIN_ROOT}/
├── SKILL.md                    # 스킬 문서
├── pumasi.config.yaml          # 작업 목록 (매 실행 전 수정)
└── scripts/
    ├── pumasi.sh               # 진입점
    ├── pumasi-job.sh           # Node.js 래퍼
    ├── pumasi-job.js           # 오케스트레이터
    └── pumasi-job-worker.js    # Codex 워커 (detached)
```

## Codex CLI 필요

```bash
command -v codex  # 설치 확인
# 없으면: npm install -g @openai/codex
```
