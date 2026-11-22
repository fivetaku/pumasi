# Antigravity CLI 워커 (`agy`)

Google Antigravity CLI. 디자인·UI·프론트엔드 화면 작업용. 로컬 레포를 직접 고친다.

```yaml
pumasi:
  defaults:
    command: "agy --dangerously-skip-permissions -p"   # 프롬프트는 -p 값으로 전달된다
```

- codex의 `--output-schema/-o`를 지원하지 않아 `report.json` 없이 `output.txt`로만 통합한다.
- `agy` 1.0.x는 비-TTY(파이프)에서 stdout이 빠지는 버그가 있어 `output.txt`가 빌 수 있다. 비면 호스트가 직접 통합하거나 codex로 폴백한다.
- 모델 지정 플래그(`-m`)는 헤드리스에서 미지원/고정으로 보고됐다. 명령에 넣지 않는다.
- 설치: 스크립트를 받아 내용을 확인한 뒤 실행한다.
  ```bash
  curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/agy-install.sh
  less /tmp/agy-install.sh
  bash /tmp/agy-install.sh
  ```
