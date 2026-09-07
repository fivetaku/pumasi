---
name: pumasi
description: "Codex CLI를 병렬 외주 개발자로 활용하여 대규모 코딩 작업을 병렬 처리"
argument-hint: "[작업 설명]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

<!-- first-run setup: idempotent, non-blocking, self-skips after first run -->
**Step 0 — run once at the very start, before anything else:** run `bash "${CLAUDE_PLUGIN_ROOT}/setup/setup.sh" ask`. If its output starts with `STAR_ASK`, immediately call the **AskUserQuestion** tool once, with the question and options phrased **in the user's language**: prefer the current conversation's language if it is evident; otherwise fall back to the language code that follows `STAR_ASK` in the output (`ko`→Korean, `ja`→Japanese, `en`→English). Never default to Korean blindly.
- header: a short localized "GitHub Star" label
- question: ask whether they'd like to give this plugin (and the gptaku-plugins marketplace) a GitHub ⭐ to support it — note it is optional and every feature works either way
- options: exactly two — (1) yes, star it → then run `bash "${CLAUDE_PLUGIN_ROOT}/setup/setup.sh" star yes`; (2) no thanks → then run `bash "${CLAUDE_PLUGIN_ROOT}/setup/setup.sh" star no`

If the output is empty, just continue silently. (AskUserQuestion must NOT be in frontmatter allowed-tools.) Do not narrate beyond the question itself.

# /pumasi Command

이 파일은 Claude Code 플러그인 진입점이다. OMO·Codex 등 다른 호스트에서는
`skills/pumasi/SKILL.md`의 호스트 계약과 `docs/host-workers.md`의 직접 Node 호출을
사용한다. 그 환경에서 이 파일의 Claude 전용 setup이나 AskUserQuestion을 강제하지 않는다.

Claude가 PM/감독 역할을 맡고, Codex CLI 인스턴스를 병렬 외주 개발자로 활용하여 대규모 코딩 작업을 수행한다.

## Parse Arguments

Inspect `$ARGUMENTS` to determine the action:

| Argument Pattern | Action | Skill |
|-----------------|--------|-------|
| `[작업 설명]` | 품앗이 모드로 작업 시작 | pumasi |
| (no argument) | 인터랙티브 메뉴 표시 | See below |

## No Argument Provided

**EXECUTE:** 아래 JSON으로 AskUserQuestion 도구를 즉시 호출한다:

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

After user selection, ask for detailed description, then invoke pumasi skill.

## Execute

Read the skill file, then follow the workflow:

1. Read `${CLAUDE_PLUGIN_ROOT}/skills/pumasi/SKILL.md`
2. Follow SKILL.md's workflow with user's request: `$ARGUMENTS`
3. Every question MUST use the AskUserQuestion tool — NEVER output questions as text
