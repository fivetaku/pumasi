# Cursor CLI 워커 (`cursor-agent`)

Cursor 구독 워커. 여러 계열 모델을 `--model`로 고를 수 있다.

```yaml
pumasi:
  defaults:
    command: "cursor-agent -p --force --output-format text"
    # 모델 핀 예: "cursor-agent -p --force --model <이름> --output-format text"
```

- 모델 이름은 `cursor-agent --list-models`로 그때그때 확인한다. Claude 계열 모델도 고를 수 있어 Claude 쿼터가 바닥났을 때 Cursor 구독으로 작업을 잇는 우회 경로가 된다.
- `-p`(print)와 `--output-format text`가 필요하다. 프롬프트는 마지막 positional 인자로 전달된다.
- `--force`(별칭 `--yolo`, `--trust`, `-f`)가 없으면 "Do you trust the contents of this directory?"에서 멈춘다. 신뢰 이력 없는 새 디렉터리에서는 파일이 하나도 생기지 않는다(2026-08-27 실측).
- codex 전용 `--output-schema/-o`는 주입하지 않으므로 `report.json` 없이 `output.txt`로 통합한다.
- 실측 E2E(2026-08-27): 워커 2개 동시 실행(모델 핀 1개 + 기본 1개) 모두 exit 0, 게이트 4/4 통과, 47~59초.
- 훅 충돌: 다른 도구가 `~/.cursor/hooks.json`에 preToolUse 훅을 심어 두고 참조 스크립트가 사라지면 "환경 훅 오류로 파일 생성 차단"으로 전부 실패한다. 이 에러가 나면 그 파일부터 확인한다.
- 인증: `cursor-agent status`(IDE 로그인 공유). 자동화·CI는 `CURSOR_API_KEY`.
- 설치: `curl https://cursor.com/install -fsS | bash` → `~/.local/bin/`. 같은 바이너리가 `agent`라는 이름으로도 링크되지만 grok CLI의 `~/.grok/bin/agent`와 이름이 겹치므로 config에는 `cursor-agent`(또는 절대경로)를 쓴다.
