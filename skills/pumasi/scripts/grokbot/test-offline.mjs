// 오프라인 회귀 시험 — 네트워크·키체인을 쓰지 않는다. node test-offline.mjs
// insane-review(2026-10-13) 1-1에서 재현된 완료 오판 사례를 고정한다.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const src = readFileSync(new URL("./grokbot.mjs", import.meta.url), "utf8");
const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
const { parseJobDone, envelope } = new Function(
  slice("function outDir", "// 장부:") + "; return { parseJobDone, envelope };",
)();

const id = "gb-20261013000000-abcd";
const out = `/workspace/mailbox/out/${id}/`;
const cases = [
  ["정상 ok", [`결과 요약\n\nJOB_DONE ${id} status=ok steps=3/3 out=${out}`], "ok"],
  ["정상 partial", [`JOB_DONE ${id} status=partial steps=2/3 out=${out}`], "partial"],
  ["정상 failed", [`JOB_DONE ${id} status=failed steps=0/3 out=${out}`], "failed"],
  ["표식만", [`JOB_DONE ${id}`], null],
  ["지시문 예시 인용", [`규칙대로 하겠습니다: JOB_DONE ${id} status=ok|partial|failed steps=<완료>/<전체> out=${out}`], null],
  ["표식 뒤에 진행 중 문장", [`JOB_DONE ${id} status=ok steps=3/3 out=${out}\n아직 검증 중입니다`], null],
  ["엉뚱한 status", [`JOB_DONE ${id} status=banana steps=1/2 out=${out}`], "invalid"],
  ["steps 역전", [`JOB_DONE ${id} status=ok steps=9/2 out=${out}`], "invalid"],
  ["다른 out 경로", [`JOB_DONE ${id} status=ok steps=1/1 out=/tmp/not-this-job/`], "invalid"],
  ["다른 job id", [`JOB_DONE gb-20261013000000-ffff status=ok steps=1/1 out=/workspace/mailbox/out/gb-20261013000000-ffff/`], null],
  ["앞 메시지 완료, 뒤 메시지 진행", [`JOB_DONE ${id} status=ok steps=1/1 out=${out}`, "추가 보고"], "ok"],
];

let fail = 0;
for (const [name, texts, want] of cases) {
  const got = parseJobDone(texts, id)?.status ?? null;
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (기대 ${want}, 실제 ${got})`);
}

// 봉투: 기본 금지는 --constraints 가 있어도 남는다. 완료 줄 예시는 실제 값처럼 생기지 않는다.
const env = envelope(id, "목표", { constraints: "외부 사이트 로그인 금지" });
assert.match(env, /결제·외부 발송·머지·배포·삭제·봇 생성 금지/);
assert.match(env, /추가: 외부 사이트 로그인 금지/);
assert.equal(parseJobDone([env], id), null, "봉투 자체가 완료로 읽히면 안 된다");
console.log("PASS  봉투: 기본 금지 유지 · 예시 줄 비완료");

// 관리 명령은 --admin 없이 거절된다(네트워크 전에 막힌다).
for (const args of [["raw", "listAgents"], ["delete", "x"], ["team", "apply"], ["create", "--name", "x"]]) {
  let msg = "";
  try { execFileSync("node", [new URL("./grokbot.mjs", import.meta.url).pathname, ...args], { encoding: "utf8", stdio: "pipe" }); }
  catch (e) { msg = String(e.stderr); }
  assert.match(msg, /관리 명령/, `${args[0]} 가 --admin 없이 막혀야 한다`);
}
console.log("PASS  관리 명령 --admin 게이트 4종");

// 회수 검증: MANIFEST 두 형식(배열·{files}) 모두 해시를 대조하고, 검증된 파일이 0개면 실패여야 한다(2026-10-14 실측 구멍).
{
  const { mkdtempSync, writeFileSync: wf, mkdirSync: md } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join: pj } = await import("node:path");
  const { createHash } = await import("node:crypto");
  const vsrc = slice("function walk", "// ── 대화 회수");
  const verifyLocal = new Function("readdirSync", "lstatSync", "readFileSync", "existsSync", "join", "crypto", "BridgeError", "outDir",
    vsrc + "; return verifyLocal;")(
    (await import("node:fs")).readdirSync, (await import("node:fs")).lstatSync, (await import("node:fs")).readFileSync, (await import("node:fs")).existsSync,
    pj, await import("node:crypto"), Error, (j) => `/workspace/mailbox/out/${j}/`);
  const mk = (manifest, files) => { const d = mkdtempSync(pj(tmpdir(), "gbv-")); for (const [k, v] of Object.entries(files)) { md(pj(d, k, ".."), { recursive: true }); wf(pj(d, k), v); } wf(pj(d, "MANIFEST.json"), JSON.stringify(manifest)); return d; };
  const h = (t) => createHash("sha256").update(t).digest("hex");
  const files = { "SUMMARY.md": "요약", "src/a.mjs": "x" };
  const arr = [{ path: "SUMMARY.md", sha256: h("요약") }, { path: "src/a.mjs", sha256: h("x") }];
  assert.equal(verifyLocal(mk(arr, files), id).ok, true, "배열 MANIFEST 통과");
  assert.equal(verifyLocal(mk({ files: arr }, files), id).ok, true, "{files} MANIFEST 통과");
  assert.equal(verifyLocal(mk({ files: [{ path: "src/a.mjs", sha256: "0" }] }, files), id).ok, false, "해시 불일치 실패");
  assert.equal(verifyLocal(mk({ job: id }, files), id).ok, false, "검증 대상 0개면 실패");
  assert.equal(verifyLocal(mk([{ path: "../x", sha256: "0" }], files), id).ok, false, "경로 탈출 거부");
  console.log("PASS  회수 검증: MANIFEST 두 형식·해시 불일치·0개·경로 탈출");
}

if (fail) { console.log(`\n${fail}건 실패`); process.exit(1); }
console.log("\n전부 통과");
