#!/usr/bin/env python3
"""PNG/GIF/JPEG/WebP 바이트에서 C2PA 매니페스트의 softwareAgent{name, version}을 읽는다.

OpenAI 이미지 산출물(Codex 내장 툴·ChatGPT 웹·Images API)은 C2PA(caBX/JUMBF) 매니페스트를
싣는다. 2026-09-09 실측에서는 `{"name": "gpt-image", "version": "2.0"}`처럼 모델 버전이 찍혔지만,
2026-11-08 실측에서는 웹·Codex·라우터 산출물 모두 `{"name": "ChatGPT", "version": "gpt-image"}`로
버전 숫자가 사라졌다. 따라서 이 값은 "OpenAI 이미지 모델이 그렸다"까지만 말해 준다.

서명 검증은 하지 않는다(외부 라이브러리 없이 불가). 목적은 신뢰 체인이 아니라 메타데이터 판독.
CBOR 텍스트 문자열 헤더(0x60+len, 0x78 1바이트 길이)만 다루며, 그 외 인코딩이면 None을 돌려
호출자가 '(unverified)'로 처리하게 한다 — 추측으로 채우지 않는다.
"""
from __future__ import annotations

import json
import sys


def _cbor_tstr_after(seg: bytes, key: bytes) -> str | None:
    j = seg.find(key)
    if j < 0:
        return None
    j += len(key)
    if j >= len(seg):
        return None
    h = seg[j]
    if 0x60 <= h < 0x78:  # 정의 길이 텍스트 문자열(0~23바이트)
        n = h - 0x60
        return seg[j + 1:j + 1 + n].decode("utf-8", "replace")
    if h == 0x78 and j + 1 < len(seg):  # 1바이트 길이 접두
        n = seg[j + 1]
        return seg[j + 2:j + 2 + n].decode("utf-8", "replace")
    return None


def read_software_agent(data: bytes) -> dict:
    """반환: {"present": bool, "name": str|None, "version": str|None, "label": str}
    label 은 사람이 읽는 한 줄("ChatGPT gpt-image" 또는 "(unverified)")."""
    i = data.find(b"softwareAgent")
    if i < 0:
        return {"present": False, "name": None, "version": None, "label": "(unverified)"}
    seg = data[i:i + 512]
    name = _cbor_tstr_after(seg, b"dname")
    version = _cbor_tstr_after(seg, b"gversion")
    if not name and not version:
        return {"present": True, "name": None, "version": None, "label": "(unverified)"}
    label = " ".join(x for x in (name, version) if x)
    return {"present": True, "name": name, "version": version, "label": label}


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--json"]
    if not args:
        print("usage: c2pa_model.py <image> [--json]", file=sys.stderr)
        return 2
    try:
        data = open(args[0], "rb").read()
    except OSError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    info = read_software_agent(data)
    print(json.dumps(info, ensure_ascii=False) if "--json" in sys.argv else info["label"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
