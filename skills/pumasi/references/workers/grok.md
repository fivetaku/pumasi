# Grok CLI 워커 (`grok`)

xAI Grok Build CLI. 코드·대규모 분석용.

```yaml
pumasi:
  defaults:
    command: "grok --no-auto-update --no-alt-screen --sandbox workspace --always-approve -p"
```

- 비-TTY 파이프에서도 stdout이 정상 출력된다(2026-08-23 실측, grok 1.0.4).
- 샌드박스가 기본 off라 `--sandbox workspace`로 조인다(codex와 반대).
- 자동 업데이터가 백그라운드로 돌기 때문에 `--no-auto-update`를 넣는다. 빼면 워커 실행 중에 업데이트가 끼어든다.
- codex 전용 `--output-schema/-o`는 주입하지 않으므로 `report.json` 없이 `output.txt`로 통합한다. grok의 `--json-schema` 결과는 stdout JSON의 `.text`에 문자열로 중첩돼 파일로 떨어지지 않는다(언랩 미구현).
- 모델은 grok 기본값을 쓴다. 핀이 필요하면 CLI 도움말·설정에서 현재 이름을 확인해 명시한다. 폐기된 모델 이름이 남아 있으면 실패하므로 문서에 이름을 고정하지 않는다.
- 인증: `grok login`(구독 세션) 또는 `XAI_API_KEY`.
- PATH: `~/.grok/bin/grok`에 설치되고 셸 프로필로 PATH에 들어간다. 비대화형 셸에서 `command -v grok`이 실패하면 절대경로를 쓴다.
- 설치: `curl -fsSL https://x.ai/cli/install.sh -o /tmp/grok-install.sh`로 받아 내용을 확인한 뒤 실행한다.
