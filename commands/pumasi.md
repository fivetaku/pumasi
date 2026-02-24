---
name: pumasi
description: "Codex CLI를 병렬 외주 개발자로 활용하여 대규모 코딩 작업을 병렬 처리"
argument-hint: "[작업 설명]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - AskUserQuestion
  - Glob
  - Grep
---

# /pumasi Command

Claude가 PM/감독 역할을 맡고, Codex CLI 인스턴스를 병렬 외주 개발자로 활용하여 대규모 코딩 작업을 수행한다.

## Parse Arguments

Inspect `$ARGUMENTS` to determine the action:

| Argument Pattern | Action | Skill |
|-----------------|--------|-------|
| `[작업 설명]` | 품앗이 모드로 작업 시작 | pumasi-exec |
| (no argument) | 인터랙티브 메뉴 표시 | See below |

## No Argument Provided

When no argument is provided, present the following interactive menu using `AskUserQuestion`:

```json
{
  "questions": [
    {
      "question": "품앗이 모드로 무엇을 만들까요?",
      "header": "품앗이 (Pumasi)",
      "options": [
        {"label": "새 프로젝트", "description": "새로운 앱/서비스를 품앗이 모드로 구현"},
        {"label": "기능 추가", "description": "기존 프로젝트에 여러 기능을 병렬로 추가"},
        {"label": "리팩토링", "description": "여러 모듈을 동시에 리팩토링"}
      ],
      "multiSelect": false
    }
  ]
}
```

After user selection, ask for detailed description, then invoke pumasi-exec skill.

## Execute

Once the action is determined, follow the pumasi-exec skill's execution flow.

Skill content is located at:
- `${CLAUDE_PLUGIN_ROOT}/skills/pumasi-exec/SKILL.md` — Codex 병렬 실행 워크플로우
