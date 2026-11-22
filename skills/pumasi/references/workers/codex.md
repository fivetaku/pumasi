# Codex 워커 (`codex`)

Claude Code 호스트의 기본 워커다.

```yaml
pumasi:
  defaults:
    command: "codex exec --dangerously-bypass-approvals-and-sandbox"
```

- 설치 확인: `command -v codex` (없으면 `npm install -g @openai/codex`). 인증은 `codex login`.
- codex일 때만 워커가 `--output-schema`/`-o`를 붙여 `report.json`(구조화 보고)을 받는다.
- 모델은 codex 기본값을 쓴다. 바꾸려면 `codex exec --model <이름>`으로 명시하고, 쓸 수 있는 이름은 codex 설정(`~/.codex/config.toml`)이나 CLI 도움말로 확인한다. 문서에 모델 이름을 고정해 두지 않는다.
- instruction 작성 요령: `../codex-guide.md`.
