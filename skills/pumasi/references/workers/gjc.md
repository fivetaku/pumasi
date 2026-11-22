# gajae-code 워커 (`gjc`)

멀티모델 코딩 CLI (`Yeachan-Heo/gajae-code`).

```yaml
pumasi:
  defaults:
    command: "gjc --print"   # 프롬프트가 --print 뒤 positional(MESSAGE)로 전달된다
```

- 모델은 gjc 기본값을 쓴다. 핀이 필요하면 `gjc --print --model <이름>`으로 명시하고, 이름은 gjc 설정·도움말로 확인한다.
- codex 전용 `--output-schema/-o`는 주입하지 않으므로 `report.json` 없이 `output.txt`로 통합한다.
- 비-TTY 파이프에서도 stdout이 정상 출력된다(2026-06-19 실측).
- 설치: https://github.com/Yeachan-Heo/gajae-code
