#!/usr/bin/env node
// grokbot — Grok Bot 게이트웨이 브릿지 (gptaku 프로토타입)
//
// 데스크톱 앱(Grok Bot.app)이 저장한 게이트웨이 세션을 재사용해 봇 목록·생성·메시지·대화 조회를 한다.
// 비공식·비문서 내부 API다(Cursor 직원 2026-10-12: 공식 채팅 API 없음). 앱 업데이트로 깨질 수 있다.
// 참고 구현: ScriptedAlchemy/grok-bot-cli src/core/{app-session,gateway,headers,url-policy}.js (MIT)
//
// 자격증명 규칙: 토큰은 메모리에서만 쓰고 출력·저장하지 않는다. *.cursor.sh / *.cursor.com / *.cursorvm.com 외로는 보내지 않는다.

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";

const APP_DATA = join(homedir(), "Library/Application Support/Grok Bot");
const DESCRIPTOR = join(APP_DATA, "gateway-descriptor.json");
const TIMEOUT_MS = 30000;
const MAX_BYTES = 2 * 1024 * 1024;

class BridgeError extends Error {}

// ── 세션: 앱 저장소를 Chromium Safe Storage(macOS 키체인)로 복호화 ──
const SECRETS = join(APP_DATA, "sand-secrets.json");
let safeKey = null;

function decryptSafe(b64) {
  const buf = Buffer.from(b64, "base64");
  if (buf.subarray(0, 3).toString("latin1") !== "v10") throw new BridgeError("지원하지 않는 Safe Storage 형식.");
  if (!safeKey) {
    // 첫 실행 시 macOS가 "Grok Bot Safe Storage" 키체인 접근 허용 창을 띄운다.
    const password = execFileSync("/usr/bin/security", ["find-generic-password", "-w", "-s", "Grok Bot Safe Storage"], { encoding: "utf8" }).trimEnd();
    safeKey = crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  }
  const decipher = crypto.createDecipheriv("aes-128-cbc", safeKey, Buffer.alloc(16, 32));
  return Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()]).toString("utf8");
}

function loadSession() {
  if (process.platform !== "darwin") throw new BridgeError("macOS 전용 프로토타입이다.");
  // 앱이 descriptor를 지웠다 다시 쓰는 경우가 있다(실측). 없으면 빈 세션을 주고 첫 호출 전에 EnsureSandBox로 채운다.
  if (!existsSync(DESCRIPTOR)) {
    if (!existsSync(SECRETS)) throw new BridgeError("Grok Bot 앱 세션이 없다. 앱에 한 번 로그인하라.");
    return { url: null, token: null, headers: {} };
  }
  const wrapped = JSON.parse(readFileSync(DESCRIPTOR, "utf8"));
  let encrypted = wrapped.encrypted;
  // v2(gbot 기준)·v3(앱 0.70.2 실측) 모두 entries 맵 구조다.
  if (wrapped.version >= 2) {
    const entries = Object.values(wrapped.entries ?? {});
    if (entries.length !== 1) throw new BridgeError(`게이트웨이 항목이 ${entries.length}개라 고를 수 없다.`);
    encrypted = entries[0]?.encrypted;
  }
  if (typeof encrypted !== "string" || !encrypted) throw new BridgeError("descriptor에 암호문이 없다.");
  const d = JSON.parse(decryptSafe(encrypted));
  if (!d.baseUrl || !d.token) throw new BridgeError("복호화한 descriptor가 불완전하다.");
  return { url: assertGatewayUrl(String(d.baseUrl).replace(/\/$/, "")), token: String(d.token), headers: lowerKeys(d.headers) };
}

// ── 깨우기: VM이 잠들면(pod_hibernated) 게이트웨이가 417을 준다. 앱처럼 EnsureSandBox로 깨운다 ──
function accessToken() {
  const sec = JSON.parse(readFileSync(SECRETS, "utf8"));
  const accounts = JSON.parse(sec["cursor-accounts"]);
  const acct = accounts.accounts?.[accounts.active];
  if (!acct?.["cursor-access-token"]) throw new BridgeError("앱에 Cursor 접근 토큰이 없다.");
  return decryptSafe(acct["cursor-access-token"]);
}

function appVersion() {
  try { return execFileSync("/usr/bin/defaults", ["read", "/Applications/Grok Bot.app/Contents/Info.plist", "CFBundleShortVersionString"], { encoding: "utf8" }).trim(); } catch { return "0.70.2"; }
}

async function wake(session) {
  const res = await fetch("https://api2.cursor.sh/aiserver.v1.GrokBotService/EnsureSandBox", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(120000),
    headers: {
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${accessToken()}`,
      "x-cursor-client-type": "sand",
      "x-cursor-client-version": appVersion(),
      "x-sand-box-namespace": "prod",
    },
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new BridgeError(`EnsureSandBox 실패: ${res.status} ${redact(body.message || body.code || "")} — 앱을 열어 다시 로그인하라.`);
  const url = body.gatewayUrl || body.gateway_url;
  const token = body.gatewayToken || body.gateway_token;
  if (url && token) {
    session.url = assertGatewayUrl(String(url).replace(/\/$/, ""));
    session.token = String(token);
    const net = body.anyrunNetworkToken || body.anyrun_network_token || body.networkToken;
    session.headers = lowerKeys(body.gatewayHeaders || body.gateway_headers || (net ? { "x-anyrun-network-token": net } : {}));
  }
}

function lowerKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) if (v != null && v !== "") out[k.toLowerCase()] = String(v);
  return out;
}

function assertGatewayUrl(url) {
  const u = new URL(url);
  const h = u.hostname.toLowerCase();
  const ok = u.protocol === "https:" && (h === "cursor.sh" || h === "cursor.com" || /\.(cursor\.sh|cursor\.com|cursorvm\.com)$/.test(h));
  if (!ok) throw new BridgeError(`허용되지 않은 게이트웨이 호스트: ${h}`);
  return url;
}

function redact(s) {
  return String(s).replace(/(bearer\s+)[\w.\-~+/=]+/gi, "$1***").replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "***");
}

// ── 게이트웨이 호출 (잠든 VM이면 깨우고 최대 3분 재시도) ──
async function call(session, method, body = {}) {
  const deadline = Date.now() + 180000;
  let woke = false;
  for (;;) {
    const res = await fetch(`${session.url}/api/${method}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "content-type": "application/json", authorization: `Bearer ${session.token}`, ...session.headers },
      body: JSON.stringify(body),
    });
    const reason = res.headers.get("x-anyrun-failure-reason");
    if (res.status === 417 && /hibernat|starting|unavailable/.test(reason || "") && Date.now() < deadline) {
      if (!woke) { process.stderr.write(`grokbot: VM이 잠들어 있다(${reason}). 깨우는 중...\n`); await wake(session); woke = true; }
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_BYTES) throw new BridgeError(`${method} 응답이 너무 크다.`);
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) throw new BridgeError(`${method} 실패: ${res.status}${reason ? ` (${reason})` : ""} ${redact(data.message || data.error || data.raw || res.statusText).slice(0, 300)}`);
    return data;
  }
}

function asBot(a) {
  const memberIds = a.memberIds || a.memberAgentIds || [];
  return {
    id: a.id || a.agentId,
    name: a.name || "",
    title: a.title || "",
    description: a.description || "",
    isGroup: a.isGroup === true || (a.isGroup == null && memberIds.length > 0),
    memberIds,
  };
}

async function listRaw(s) {
  const d = await call(s, "listAgents");
  return Array.isArray(d) ? d : Array.isArray(d.agents) ? d.agents : [];
}

async function listBots(s) {
  return (await listRaw(s)).map(asBot).filter((b) => b.id);
}

async function resolve(s, ref) {
  const bots = await listBots(s);
  const needle = String(ref).trim().toLowerCase();
  const byId = bots.find((b) => b.id.toLowerCase() === needle);
  if (byId) return byId;
  const hits = bots.filter((b) => b.name.toLowerCase() === needle || b.title.toLowerCase() === needle);
  if (hits.length === 1) return hits[0];
  throw new BridgeError(hits.length ? `이름이 겹친다: ${ref}` : `봇이 없다: ${ref}`);
}

async function tail(s, bot, limit = 40) {
  const d = await call(s, "getAgentTranscriptTail", { id: bot.id, limit: Math.min(Math.max(limit, 1), 200) });
  return Array.isArray(d.entries) ? d.entries : [];
}

// 봇 실행 상태 (listAgents 레코드 + 비동기 작업·서브에이전트) — 2026-10-13 앱 0.70.2 실측 필드
async function botState(s, bot) {
  const rec = (await listRaw(s)).find((a) => a.id === bot.id) ?? {};
  const [asyncTasks, subagents] = await Promise.all([
    call(s, "getAsyncTasks", { id: bot.id }).catch(() => []),
    call(s, "getSubagents", { id: bot.id }).catch(() => []),
  ]);
  const busy = Boolean(rec.isRunningTurn || rec.isRunning || rec.isComposingMessage);
  return {
    busy,
    isRunningTurn: Boolean(rec.isRunningTurn),
    isRunning: Boolean(rec.isRunning),
    isComposingMessage: Boolean(rec.isComposingMessage),
    awaitingUserResponse: rec.awaitingUserResponse ?? null,
    asyncTasks: Array.isArray(asyncTasks) ? asyncTasks.length : 0,
    subagents: Array.isArray(subagents) ? subagents.length : 0,
    newestEntryId: rec.newestEntryId ?? null,
  };
}

// 사람 응답을 기다리는 카드(위젯·시크릿 요청). 응답·건너뜀·닫힘 표시가 없으면 대기 중이다.
function pendingCard(e) {
  if (e?.kind !== "send-message") return null;
  const m = e.message ?? {};
  if (m.type === "widget" && e.respondedValue == null && !e.widgetSkipped && !e.widgetDismissed) {
    return { type: "widget", prompt: m.widget?.prompt ?? "", options: (m.widget?.options ?? []).map((o) => o.label) };
  }
  if (m.type === "secret-request") return { type: "secret-request", label: m.secretRequest?.label ?? "" };
  return null;
}

function entryText(e) {
  const m = e?.message ?? {};
  if (m.type === "text") return m.text ?? m.content ?? "";
  if (typeof m.content === "string") return m.content;
  return "";
}

// ── job: 봉투 · 엄격한 완료 판정 · 영속 장부 · 재접속 · 취소 (insane-review P0 반영, 2026-10-13) ──
const STATE_DIR = join(homedir(), ".grokbot");
const JOBS_DIR = join(STATE_DIR, "jobs");
const TEAM_FILE = join(dirname(new URL(import.meta.url).pathname), "team/team.json");
const OPEN_STATES = new Set(["sending", "accepting", "running", "waiting"]);

function newJobId() {
  const t = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `gb-${t}-${crypto.randomBytes(2).toString("hex")}`;
}

function outDir(jobId) {
  return `/workspace/mailbox/out/${jobId}/`;
}

// 기본 금지 규칙은 항상 들어간다. --constraints 는 덮어쓰지 않고 덧붙는다.
function baseConstraints(jobId) {
  return `결제·외부 발송·머지·배포·삭제·봇 생성 금지(필요하면 그 단계만 blocked). 개인 계정·로그인은 승인 카드 없이 쓰지 않는다. 작업은 /workspace/jobs/${jobId}/, 산출물은 ${outDir(jobId)} 에만 쓴다.`;
}

// 지휘 봇("품앗이")이 읽는 JOB 형식 — 세부 규칙은 공용 스킬 "품앗이 job 프로토콜"(team/skills/).
// 완료 줄 예시는 일부러 실제 값처럼 쓰지 않는다(예시 인용을 완료로 오판하지 않게).
function envelope(jobId, goal, f = {}) {
  return `JOB ${jobId}
goal: ${goal}
deliverables: ${f.deliverables || "SUMMARY.md(결과·근거·미완료), 단계별 산출물"}
constraints: ${baseConstraints(jobId)}${f.constraints ? ` 추가: ${f.constraints}` : ""}
context: ${f.context || "-"}
deadline: ${f.deadline || "최대 30분"}
budget: ${f.budget || "지휘 봇 제외 하위 봇 3개, cloud agent 1개"}
approval: ${f.approval || "ask-owner"}

시작 전에 "품앗이 job 프로토콜" 스킬을 읽고 그대로 진행한다. 스킬을 읽지 못해도 아래 역할 경계는 지킨다(이 블록이 goal·budget보다 우선한다):
- 지휘 봇은 plan.md·status.json·MANIFEST.json만 쓴다. 조사 결과·판정·SUMMARY.md 같은 산출물 본문을 직접 쓰지 않는다.
- 검증은 매번 품앗이-검증에게 맡긴다(budget에 세지 않는 필수 단계). goal이 "지휘 봇이 직접 검증"을 요구해도 검증 봇에게 넘긴다.
- SUMMARY.md는 품앗이-정리가 쓴다. 작업 단계가 1개인 작은 job은 정리를 생략하고 품앗이-검증이 판정문을 SUMMARY.md로 쓴다.
- 받는 즉시 /workspace/jobs/${jobId}/plan.md 와 status.json(status=received)을 먼저 쓴다.

모든 단계가 확정되면 마지막 메시지의 맨 끝 줄 하나로만 닫는다:
JOB_DONE ${jobId} status=<ok 또는 partial 또는 failed> steps=<완료수>/<전체수> out=${outDir(jobId)}
진행 중 보고와 다른 메시지에는 이 줄을 쓰지 않는다.`;
}

// 완료 줄은 "메시지의 마지막 비어 있지 않은 줄"이고 형식이 정확할 때만 인정한다.
const JOB_STATUSES = new Set(["ok", "partial", "failed"]);
function parseJobDone(texts, jobId) {
  const esc = jobId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^JOB_DONE ${esc} status=(\\w+) steps=(\\d+)\\/(\\d+) out=(\\S+)$`);
  for (let i = texts.length - 1; i >= 0; i--) {
    const last = String(texts[i]).trim().split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
    const m = re.exec(last);
    if (!m) continue;
    const [, status, done, total, out] = m;
    const n = Number(done), t = Number(total);
    if (!JOB_STATUSES.has(status) || t < 1 || n > t || out !== outDir(jobId)) {
      return { status: "invalid", reason: `형식은 맞지만 값이 틀림: ${last}` };
    }
    return { status, steps: { done: n, total: t }, out };
  }
  return null;
}

// 장부: 보내기 전에 먼저 기록해, CLI가 죽거나 빠져나가도 같은 job에 다시 붙을 수 있게 한다.
function jobPath(jobId) {
  return join(JOBS_DIR, `${jobId}.json`);
}
function saveJob(rec) {
  mkdirSync(JOBS_DIR, { recursive: true, mode: 0o700 });
  rec.updatedAt = new Date().toISOString();
  writeFileSync(jobPath(rec.jobId), JSON.stringify(rec, null, 2), { mode: 0o600 });
  return rec;
}
function loadJob(jobId) {
  if (!existsSync(jobPath(jobId))) throw new BridgeError(`장부에 없는 job: ${jobId}`);
  return JSON.parse(readFileSync(jobPath(jobId), "utf8"));
}
function listJobs() {
  if (!existsSync(JOBS_DIR)) return [];
  return readdirSync(JOBS_DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(JOBS_DIR, f), "utf8")))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function teamBotNames() {
  try { return (JSON.parse(readFileSync(TEAM_FILE, "utf8")).bots ?? []).map((b) => b.name); } catch { return []; }
}

async function start(s, ref, goal, { fields = {}, force = false, queue = false, queueSec = 3600 } = {}) {
  const bot = await resolve(s, ref);
  // 같은 지휘 봇에는 한 번에 job 하나만(대화가 하나라 출력이 섞인다)
  // queue=true 면 거절하지 않고 앞 job이 닫힐 때까지 기다린다(품앗이가 같은 라운드에 Grok Bot task를 여럿 낼 때).
  const queueDeadline = Date.now() + queueSec * 1000;
  for (;;) {
    const busy = listJobs().find((j) => j.botId === bot.id && OPEN_STATES.has(j.state));
    if (!busy || force) break;
    if (!queue || Date.now() > queueDeadline) throw new BridgeError(`${bot.name}에 진행 중인 job이 있다: ${busy.jobId} (${busy.state}). grokbot watch|cancel ${busy.jobId}`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  const rec = saveJob({ jobId: newJobId(), bot: bot.name, botId: bot.id, clientNonce: crypto.randomUUID(), state: "sending", createdAt: new Date().toISOString(), goal, fields });
  try {
    await call(s, "sendPrompt", { agentId: bot.id, prompt: envelope(rec.jobId, goal, fields), clientNonce: rec.clientNonce });
  } catch (e) {
    // 응답을 못 받았다고 다시 보내지 않는다. 수락 여부는 watch가 clientNonce로 확인한다.
    rec.sendError = String(e.message || e);
  }
  rec.state = "accepting";
  return saveJob(rec);
}

// 장부의 job을 끝날 때까지(또는 timeout까지) 지켜본다. 여러 번 불러도 같은 결과로 이어진다.
async function watch(s, rec, { timeoutSec = 900, intervalSec = 5 } = {}) {
  const bot = { id: rec.botId, name: rec.bot };
  const deadline = Date.now() + timeoutSec * 1000;
  const sleep = () => new Promise((r) => setTimeout(r, intervalSec * 1000));

  // 1) 수락 확인 — rejected만 거절이다. 모르는 값은 기다린다.
  while (rec.state === "accepting" && Date.now() < deadline) {
    const st = await call(s, "promptAcceptanceStatus", { accountSlot: "host", agentId: bot.id, clientNonce: rec.clientNonce });
    const status = st.outcome === "found" ? st.record?.status : null;
    if (status === "accepted") { rec.echoEntryId = st.record.echoEntryId; rec.state = "running"; saveJob(rec); break; }
    if (status === "rejected") { rec.state = "failed"; rec.result = { reason: `봇이 거절: ${st.record.rejectionCode ?? ""}` }; return saveJob(rec); }
    if (status && status !== "pending") rec.acceptanceSeen = status;
    if (st.outcome === "not-found" && rec.sendError) { rec.state = "failed"; rec.result = { reason: `전송 실패: ${rec.sendError}` }; return saveJob(rec); }
    await sleep();
  }
  if (rec.state === "accepting") { rec.result = { reason: "수락 확인 시간 초과(다시 보내지 말고 watch로 재확인)" }; return saveJob(rec); }

  // 2) 진행 — 우리 메시지(echo) 이후의 봇 출력을 seq로 누적한다(지휘 봇은 하위 봇 답마다 새 턴으로 깨어난다).
  const seen = new Map((rec.entries ?? []).map((e) => [e.id, e]));
  while (Date.now() < deadline) {
    const all = await tail(s, bot, 200);
    rec.echoSeq ??= all.find((e) => e.id === rec.echoEntryId)?.seq ?? null;
    if (rec.echoSeq != null) {
      const oldest = all.length ? Math.min(...all.map((e) => e.seq)) : Infinity;
      // 지난 확인 이후 200개 넘게 쌓여 창 밖으로 밀렸으면 유실 가능성을 기록한다
      if (rec.lastSeq != null && oldest > rec.lastSeq + 1) rec.gap = true;
      for (const e of all) if (e.seq > rec.echoSeq && e.kind === "send-message") seen.set(e.id, { id: e.id, seq: e.seq, text: entryText(e), card: pendingCard(e) });
      rec.lastSeq = Math.max(rec.lastSeq ?? 0, ...all.map((e) => e.seq));
    }
    rec.entries = [...seen.values()].sort((a, b) => a.seq - b.seq);
    const texts = rec.entries.map((e) => e.text).filter(Boolean);
    const done = parseJobDone(texts, rec.jobId);
    const state = await botState(s, bot);

    if (done && done.status !== "invalid" && !state.busy) {
      rec.state = done.status === "ok" ? "remote_completed" : done.status;
      rec.result = { ...done, final: texts.at(-1) ?? "" };
      return saveJob(rec);
    }
    if (done?.status === "invalid") rec.invalidMarker = done.reason;

    // 대기 카드: 마지막 카드가 아직 열려 있으면 waiting으로 기록하되 job은 계속 돈다(빠져나오기만 한다).
    const card = [...rec.entries].reverse().find((e) => e.card)?.card ?? null;
    if ((card || state.awaitingUserResponse) && !state.busy) {
      rec.state = "waiting";
      rec.result = { waitingFor: card ?? state.awaitingUserResponse, final: texts.at(-1) ?? "" };
      return saveJob(rec);
    }
    if (rec.state === "waiting") rec.state = "running";
    saveJob(rec);
    await sleep();
  }
  rec.result = { reason: "watch 시간 초과 — job은 계속 돌고 있다(grokbot watch 로 재접속, cancel 로 중단)", final: rec.entries.at(-1)?.text ?? "" };
  return saveJob(rec);
}

// 취소: 지휘 봇과 팀 봇 전부에 중단을 보내고, 실제로 멈췄는지 확인한다.
async function cancel(s, rec) {
  const raw = await listRaw(s);
  const names = new Set([rec.bot, ...teamBotNames()]);
  const targets = raw.filter((a) => !a.isGroup && names.has(a.name));
  const results = [];
  for (const a of targets) {
    const bot = { id: a.id, name: a.name };
    const before = await botState(s, bot);
    if (!before.busy && !before.asyncTasks && !before.subagents) { results.push({ bot: a.name, sent: false, idle: true }); continue; }
    let sent = true;
    try { await call(s, "interruptAgentRun", { id: a.id }); } catch (e) { sent = false; results.push({ bot: a.name, sent, error: String(e.message || e) }); continue; }
    let idle = false;
    for (let i = 0; i < 6 && !idle; i++) { await new Promise((r) => setTimeout(r, 3000)); const st = await botState(s, bot); idle = !st.busy; }
    results.push({ bot: a.name, sent, idle });
  }
  // 하위 봇이 "중단됨"을 보고하면 지휘 봇이 다시 깨어나 이어 갈 수 있으니, 취소를 지휘 봇에 알린다.
  let notified = false;
  try {
    await call(s, "sendPrompt", { agentId: rec.botId, prompt: `JOB ${rec.jobId} 은 Claude Code가 취소했다. 이 job의 단계를 더 진행하거나 다시 위임하지 말고, 하위 봇이 보고해 와도 답하지 마라. JOB_DONE 줄도 쓰지 않는다.`, clientNonce: crypto.randomUUID() });
    notified = true;
  } catch {}
  rec.state = "cancelled";
  rec.result = { reason: "취소됨", final: rec.result?.final ?? "" };
  rec.cancel = { at: new Date().toISOString(), results, confirmed: results.every((r) => r.idle), conductorNotified: notified };
  return saveJob(rec);
}

const EXIT = { succeeded: 0, remote_completed: 0, fetch_invalid: 8, waiting: 3, running: 4, accepting: 4, partial: 5, failed: 6, cancelled: 7 };

// ── fetch: VM의 job 산출물을 맥으로 가져와 해시로 검증한다 (remote_completed → succeeded) ──
// 회수 채널은 오너가 따로 열어 둔 SSH(예: Tailscale). 대상은 ~/.grokbot/config.json 의 "ssh".
const FETCH_LIMITS = { maxKB: 50 * 1024, maxFiles: 300 };
const JOB_ID_RE = /^gb-\d{14}-[0-9a-f]{4}$/;

function bridgeConfig() {
  const f = join(STATE_DIR, "config.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
}

function sshRun(host, command, { input, maxBuffer = 64 * 1024 * 1024, encoding = "utf8" } = {}) {
  return execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=12", host, command], { input, maxBuffer, encoding, stdio: ["pipe", "pipe", "pipe"] });
}

// VM을 깨운 직후엔 sshd가 늦게 뜬다(실측). 깨우고 붙을 때까지 다시 시도한다.
async function sshReady(s, host) {
  const deadline = Date.now() + 150000;
  let last = "";
  while (Date.now() < deadline) {
    try { return sshRun(host, "echo ok").trim() === "ok"; } catch (e) { last = String(e.stderr || e.message).trim(); }
    await listRaw(s).catch(() => {}); // 게이트웨이 호출로 잠든 VM을 깨운다
    await new Promise((r) => setTimeout(r, 6000));
  }
  throw new BridgeError(`SSH 회수 채널에 붙지 못했다(${host}): ${last.slice(0, 200)}`);
}

function walk(dir, base = dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new BridgeError(`산출물에 심볼릭 링크가 있다: ${p.slice(base.length + 1)}`);
    if (st.isDirectory()) walk(p, base, acc);
    else acc.push(p.slice(base.length + 1));
  }
  return acc;
}

async function fetchJob(s, jobId, { dest } = {}) {
  if (!JOB_ID_RE.test(jobId)) throw new BridgeError(`job id 형식이 아니다: ${jobId}`);
  const host = bridgeConfig().ssh;
  if (!host) throw new BridgeError(`회수 채널이 없다. ~/.grokbot/config.json 에 {"ssh":"user@host"} 를 넣어라.`);
  const remote = outDir(jobId);
  await sshReady(s, host);

  // 1) 크기·개수·링크 검사 (jobId는 정규식으로 검증된 값만 명령에 들어간다)
  const probe = sshRun(host, `d=${remote}; [ -d "$d" ] || { echo missing; exit 0; }; echo "$(du -sk "$d" | cut -f1) $(find "$d" -type f | wc -l) $(find "$d" -type l | wc -l)"`).trim();
  if (probe === "missing") throw new BridgeError(`VM에 산출물 디렉터리가 없다: ${remote}`);
  const [kb, files, links] = probe.split(/\s+/).map(Number);
  if (links > 0) throw new BridgeError(`산출물에 심볼릭 링크 ${links}개 — 회수 거부`);
  if (kb > FETCH_LIMITS.maxKB || files > FETCH_LIMITS.maxFiles) throw new BridgeError(`산출물이 상한을 넘는다: ${kb}KB, ${files}개`);

  // 2) tar로 받아 임시 파일 → 시스템 tar(bsdtar는 절대경로·.. 를 기본 거부)로 풀기
  const target = dest || join(process.cwd(), ".grokbot", "out", jobId);
  mkdirSync(target, { recursive: true });
  const tarBuf = sshRun(host, `tar -C ${remote} -cf - .`, { encoding: "buffer" });
  const tmp = join(STATE_DIR, `fetch-${jobId}.tar`);
  writeFileSync(tmp, tarBuf, { mode: 0o600 });
  try { execFileSync("/usr/bin/tar", ["-xf", tmp, "-C", target], { stdio: "pipe" }); } finally { rmSync(tmp, { force: true }); }
  return { ...verifyLocal(target, jobId), kb, via: "ssh" };
}

// 받은 산출물 폴더를 MANIFEST·해시로 검증한다(SSH·대화 회수 공통).
function verifyLocal(target, jobId) {
  const remote = outDir(jobId);
  const local = walk(target).sort();
  // MANIFEST 대조 — 경로는 out 디렉터리 기준 상대경로로만 인정, 해시는 맥에서 다시 계산
  const problems = [];
  let manifest = [];
  try { manifest = JSON.parse(readFileSync(join(target, "MANIFEST.json"), "utf8")); } catch { problems.push("MANIFEST.json이 없거나 JSON이 아니다"); }
  // 봇이 배열 대신 {files:[...]} 로 쓰는 경우가 있다(2026-10-14 실측). 둘 다 읽고, 검증된 파일이 0개면 실패로 본다.
  const entries = Array.isArray(manifest) ? manifest : Array.isArray(manifest?.files) ? manifest.files : [];
  const checked = [];
  for (const m of entries) {
    if (m.kind && m.kind !== "file") { checked.push({ kind: m.kind, ref: m.url ?? m.path ?? null, bot: m.bot ?? null, verified: false, note: "파일 아님(PR·URL은 별도 확인)" }); continue; }
    const rel = safeRel(m.path, remote);
    if (!rel) { problems.push(`허용되지 않는 경로: ${m.path}`); continue; }
    const p = join(target, rel);
    if (!existsSync(p)) { problems.push(`MANIFEST에 있는데 없음: ${rel}`); continue; }
    const sha = crypto.createHash("sha256").update(readFileSync(p)).digest("hex");
    const ok = sha === m.sha256;
    if (!ok) problems.push(`해시 불일치: ${rel}`);
    checked.push({ path: rel, bot: m.bot ?? null, sha256ok: ok });
  }
  if (!local.includes("SUMMARY.md")) problems.push("SUMMARY.md가 없다");
  if (!checked.some((c) => c.sha256ok)) problems.push("MANIFEST로 해시를 검증한 파일이 하나도 없다");
  const listed = new Set(checked.map((c) => c.path));
  const extra = local.filter((f) => f !== "MANIFEST.json" && !listed.has(f));
  return { jobId, dest: target, files: local.length, checked, extra, problems, ok: problems.length === 0 };
}

function safeRel(path, remote) {
  const raw = String(path ?? "");
  const rel = raw.startsWith(remote) ? raw.slice(remote.length) : raw;
  if (!rel || rel.startsWith("/") || rel.split("/").some((x) => x === ".." || x === "")) return null;
  return rel;
}

// ── 대화 회수: SSH 채널이 없는 사용자용. 지휘 봇이 파일을 base64로 메시지에 실어 보내고, 맥에서 해시로 검증한다 ──
const CHAT_FETCH_MAX = 400 * 1024;
async function fetchViaChat(s, jobId, { dest, timeoutSec = 600, botRef = "품앗이" } = {}) {
  if (!JOB_ID_RE.test(jobId)) throw new BridgeError(`job id 형식이 아니다: ${jobId}`);
  const bot = await resolve(s, botRef);
  const out = outDir(jobId);
  const prompt = `JOB ${jobId} 회수 요청 (Claude Code). 새 작업이 아니다 — 위임하지 말고 너(지휘 봇)가 셸로 직접 한다.
${out} 아래의 MANIFEST.json 과, MANIFEST 에 kind=file 로 적힌 파일 전부를 아래 형식 그대로 메시지로 보낸다.
- 파일마다: 첫 줄 \`=== FILE <out 기준 상대경로> ===\`, 다음 줄부터 \`base64 -w 76 <파일>\` 출력 그대로, 끝 줄 \`=== END ===\`
- MANIFEST.json 도 같은 형식으로 맨 먼저 보낸다(상대경로 MANIFEST.json).
- 셸 출력을 손으로 다시 쓰지 말고 그대로 붙인다. 한 메시지가 길면 파일 경계에서 나눠 여러 메시지로 보낸다.
- 전체가 ${Math.round(CHAT_FETCH_MAX / 1024)}KB를 넘으면 MANIFEST.json 과 SUMMARY.md 만 보낸다.
- 모두 보냈으면 마지막 메시지의 맨 끝 줄에 정확히 \`FETCH_DONE ${jobId}\` 를 쓴다. 설명 문장은 쓰지 않는다.`;
  const clientNonce = crypto.randomUUID();
  await call(s, "sendPrompt", { agentId: bot.id, prompt, clientNonce });
  const deadline = Date.now() + timeoutSec * 1000;
  let echoSeq = null;
  const seen = new Map();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    if (echoSeq == null) {
      const st = await call(s, "promptAcceptanceStatus", { accountSlot: "host", agentId: bot.id, clientNonce });
      if (st.outcome !== "found" || st.record?.status !== "accepted") continue;
      const all = await tail(s, bot, 200);
      echoSeq = all.find((e) => e.id === st.record.echoEntryId)?.seq ?? null;
      if (echoSeq == null) continue;
    }
    for (const e of await tail(s, bot, 200)) if (e.seq > echoSeq && e.kind === "send-message") seen.set(e.id, e);
    const text = [...seen.values()].sort((a, b) => a.seq - b.seq).map(entryText).join("\n");
    if (!new RegExp(`(^|\\n)FETCH_DONE ${jobId}\\s*$`).test(text.trim())) continue;
    const target = dest || join(process.cwd(), ".grokbot", "out", jobId);
    mkdirSync(target, { recursive: true });
    const re = /^=== FILE (.+?) ===\n([\s\S]*?)\n=== END ===$/gm;
    let m, total = 0;
    const written = [];
    while ((m = re.exec(text.replace(/\r/g, "")))) {
      const rel = safeRel(m[1].trim(), out);
      if (!rel) throw new BridgeError(`허용되지 않는 경로: ${m[1]}`);
      const buf = Buffer.from(m[2].replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
      total += buf.length;
      if (total > CHAT_FETCH_MAX * 2) throw new BridgeError("대화 회수량이 상한을 넘는다");
      mkdirSync(dirname(join(target, rel)), { recursive: true });
      writeFileSync(join(target, rel), buf);
      written.push(rel);
    }
    if (!written.length) throw new BridgeError("대화 회수: 파일 블록을 하나도 찾지 못했다");
    return { ...verifyLocal(target, jobId), via: "chat", received: written };
  }
  throw new BridgeError(`대화 회수 시간 초과(${timeoutSec}초)`);
}

// ── doctor: 앱 업데이트로 비공식 API가 바뀌었는지 읽기 전용으로 점검한다 ──
const KNOWN = { appVersions: /^0\.(6[89]|7\d)\./, descriptorVersions: [1, 2, 3] };
async function doctor() {
  const rows = [];
  const add = (name, state, detail) => rows.push({ name, state, detail });
  const v = appVersion();
  add("앱 설치·버전", existsSync("/Applications/Grok Bot.app") ? (KNOWN.appVersions.test(v) ? "ok" : "warn") : "fail", `${v}${KNOWN.appVersions.test(v) ? "" : " (실측한 0.68~0.7x 밖 — RPC가 바뀌었을 수 있다)"}`);
  let s;
  try {
    const w = existsSync(DESCRIPTOR) ? JSON.parse(readFileSync(DESCRIPTOR, "utf8")) : null;
    add("세션 파일 형식", !w ? "warn" : KNOWN.descriptorVersions.includes(w.version ?? 1) ? "ok" : "fail", w ? `descriptor v${w.version ?? 1}` : "descriptor 없음(EnsureSandBox로 대체)");
    s = loadSession();
    if (!s.url) await wake(s);
    add("세션 복호화·게이트웨이", s.url ? "ok" : "fail", s.url ? new URL(s.url).hostname.replace(/^[^.]+/, "*") : "주소 없음");
  } catch (e) { add("세션 복호화·게이트웨이", "fail", redact(e.message)); return rows; }
  const probe = async (name, fn, check) => {
    try { const r = await fn(); const c = check(r); add(name, c === true ? "ok" : "fail", c === true ? "" : c); }
    catch (e) { add(name, "fail", redact(e.message).slice(0, 160)); }
  };
  let team = [];
  await probe("listAgents", async () => (team = await listRaw(s)), (r) => (Array.isArray(r) && r.every((a) => "id" in a && "name" in a) ? true : "응답 모양이 다르다"));
  const lead = team.find((a) => a.name === "품앗이");
  if (lead) {
    await probe("봇 상태 필드", async () => lead, (a) => (["isRunningTurn", "isRunning", "awaitingUserResponse"].every((k) => k in a) ? true : "isRunningTurn 등 필드가 없다 — 완료 판정이 깨진다"));
    await probe("promptAcceptanceStatus", () => call(s, "promptAcceptanceStatus", { accountSlot: "host", agentId: lead.id, clientNonce: "doctor-probe" }), (r) => (r?.outcome === "not-found" ? true : `예상 밖 응답: ${JSON.stringify(r).slice(0, 80)}`));
    await probe("getAgentTranscriptTail", () => call(s, "getAgentTranscriptTail", { id: lead.id, limit: 1 }), (r) => (Array.isArray(r?.entries) ? true : "entries 배열이 없다"));
    await probe("getAsyncTasks·getSubagents", async () => [await call(s, "getAsyncTasks", { id: lead.id }), await call(s, "getSubagents", { id: lead.id })], (r) => (r.every(Array.isArray) ? true : "배열이 아니다"));
  } else add("품앗이 팀", "warn", "지휘 봇 '품앗이'가 없다 — grokbot team apply --admin");
  try {
    const plan = await teamSync(s, TEAM_FILE, { apply: false });
    const diff = plan.actions.filter((a) => a.op !== "ok");
    add("팀 선언 일치", diff.length ? "warn" : "ok", diff.length ? diff.map((a) => `${a.name}:${a.op}`).join(", ") : "봇·그룹·스킬 변경 없음");
  } catch (e) { add("팀 선언 일치", "fail", redact(e.message).slice(0, 160)); }
  const host = bridgeConfig().ssh;
  if (!host) add("회수 채널", "warn", "SSH 없음 — 대화 회수(fetch --chat)로 받는다");
  else { try { await sshReady(s, host); add("회수 채널", "ok", "SSH"); } catch (e) { add("회수 채널", "fail", redact(e.message).slice(0, 160)); } }
  return rows;
}

// ── team: 선언형 팀 파일(team.json)을 계정에 반영. 이름 기준 생성·갱신만 하고 삭제는 하지 않는다 ──

function skillName(markdown) {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(markdown);
  const n = m && /^name:\s*(.+)$/m.exec(m[1]);
  return n ? n[1].trim() : null;
}

async function teamSync(s, file, { apply = false } = {}) {
  const team = JSON.parse(readFileSync(file, "utf8"));
  const base = dirname(resolvePath(file));
  const actions = [];
  let raw = await listRaw(s);
  const byName = (n) => raw.filter((a) => a.name === n);

  for (const b of team.bots ?? []) {
    const hits = byName(b.name).filter((a) => !a.isGroup);
    if (hits.length > 1) { actions.push({ kind: "bot", name: b.name, op: "skip", reason: "같은 이름이 여러 개" }); continue; }
    const cur = hits[0];
    if (!cur) {
      actions.push({ kind: "bot", name: b.name, op: "create" });
      if (apply) await call(s, "createAgent", { name: b.name, title: b.title || "", description: b.description || "", avatarShape: "", avatarColor: "", origin: "user" });
    } else if ((cur.title || "") !== (b.title || "") || (cur.description || "") !== (b.description || "")) {
      actions.push({ kind: "bot", name: b.name, op: "update" });
      if (apply) await call(s, "updateAgent", { id: cur.id, profile: { name: b.name, title: b.title || "", description: b.description || "" } });
    } else actions.push({ kind: "bot", name: b.name, op: "ok" });
  }

  if (apply) raw = await listRaw(s);
  for (const g of team.groups ?? []) {
    const memberIds = (g.members ?? []).map((n) => byName(n).find((a) => !a.isGroup)?.id).filter(Boolean);
    const missing = (g.members ?? []).length - memberIds.length;
    const cur = byName(g.name).find((a) => a.isGroup);
    if (apply && missing) { actions.push({ kind: "group", name: g.name, op: "skip", reason: `멤버 ${missing}개를 못 찾음` }); continue; }
    if (!cur) {
      actions.push({ kind: "group", name: g.name, op: "create", members: g.members });
      if (apply) await call(s, "createGroup", { name: g.name, description: g.description || "", memberAgentIds: memberIds });
    } else if ([...(cur.memberIds ?? cur.memberAgentIds ?? [])].sort().join() !== [...memberIds].sort().join()) {
      actions.push({ kind: "group", name: g.name, op: "set-members", members: g.members });
      if (apply) await call(s, "setGroupMembers", { id: cur.id, memberAgentIds: memberIds });
    } else actions.push({ kind: "group", name: g.name, op: "ok" });
  }

  const anyBot = raw.find((a) => !a.isGroup)?.id;
  if ((team.skills ?? []).length && anyBot) {
    const lib = await call(s, "getAgentWorkflows", { id: anyBot });
    const list = Array.isArray(lib) ? lib : lib.workflows ?? [];
    for (const rel of team.skills) {
      const md = readFileSync(join(base, rel), "utf8");
      const name = skillName(md) ?? rel;
      const cur = list.find((w) => w.name === name && w.source === "workflow");
      // 본문 전체 비교(앞부분만 보면 뒷부분 수정을 놓친다 — 2026-10-13 실측 회귀)
      const norm = (t) => String(t ?? "").replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "").replace(/\r/g, "").trim();
      if (cur && norm(cur.body) === norm(md)) { actions.push({ kind: "skill", name, op: "ok" }); continue; }
      actions.push({ kind: "skill", name, op: cur ? "replace" : "import" });
      if (!apply) continue;
      // 새 것을 먼저 넣고 성공하면 옛 것을 지운다. 넣기가 실패해도 동작 중인 프로토콜은 남는다.
      const d = await call(s, "importAgentWorkflowText", { id: anyBot, markdown: md });
      const imported = d.result?.imported?.[0];
      if (imported && cur && String(imported.id) !== String(cur.id)) {
        await call(s, "deleteAgentWorkflow", { id: anyBot, workflowId: cur.id });
      } else if (!imported && cur) {
        // 같은 이름이라 거절된 경우만 옛 것을 지우고 다시 넣는다
        await call(s, "deleteAgentWorkflow", { id: anyBot, workflowId: cur.id });
        const d2 = await call(s, "importAgentWorkflowText", { id: anyBot, markdown: md });
        if (!d2.result?.imported?.length) throw new BridgeError(`스킬 교체 실패(옛 것 삭제됨, 다시 apply 하라): ${name} (${d2.result?.skipped?.[0]?.reason ?? "rejected"})`);
      } else if (!imported) {
        throw new BridgeError(`스킬 가져오기 실패: ${name} (${d.result?.skipped?.[0]?.reason ?? "rejected"})`);
      }
    }
  }
  return { file, apply, actions };
}

// run·watch 가 원격 완료를 받으면 회수 채널이 있을 때 바로 가져와 검증한다(--no-fetch 로 끔).
async function finish(s, rec, opt = {}) {
  // partial·failed 도 부분 산출물은 가져온다. 성공으로 바꾸는 건 status=ok + 검증 통과일 때뿐이다.
  if (!["remote_completed", "partial", "failed"].includes(rec.state) || opt["no-fetch"]) return rec;
  const dest = typeof opt.dest === "string" ? opt.dest : undefined;
  try {
    rec.fetch = bridgeConfig().ssh ? await fetchJob(s, rec.jobId, { dest }) : await fetchViaChat(s, rec.jobId, { dest, botRef: rec.botId });
  } catch (e) {
    rec.fetch = { ok: false, problems: [String(e.message || e)] };
  }
  if (rec.state === "remote_completed") rec.state = rec.fetch.ok ? "succeeded" : "fetch_invalid";
  return saveJob(rec);
}

// ── CLI ──
function parse(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      opt[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true);
    } else pos.push(a);
  }
  return { pos, opt };
}

const HELP = `grokbot — Grok Bot 브릿지 (비공식 내부 API, macOS)

워커 명령 (품앗이가 쓰는 것)
  grokbot run "목표" [--bot 품앗이] [--timeout 900] [--text] [--dest 경로] [--queue [--queue-timeout 3600]] [--partial-ok]
        [--deliverables ..] [--constraints ..(기본 금지에 덧붙음)] [--context ..] [--deadline ..] [--budget ..] [--approval auto|ask-owner]
                     job을 장부에 기록하고 지휘 봇에 보낸 뒤 끝날 때까지 지켜본다.
  grokbot watch <jobId> [--timeout 900]   빠져나온 job에 다시 붙는다
  grokbot cancel <jobId>                  지휘 봇·팀 봇을 중단하고 멈췄는지 확인한다
  grokbot fetch <jobId> [--dest 경로] [--chat]   VM 산출물을 가져와 MANIFEST 해시 검증(기본 ./.grokbot/out/<id>/)
                     ~/.grokbot/config.json 의 ssh 가 있으면 SSH, 없거나 --chat 이면 지휘 봇이 대화로 보낸 base64 를 받는다
                     run·watch 는 원격 완료 후 자동으로 fetch 한다(--no-fetch 로 끔)
  grokbot doctor                          앱 버전·세션 형식·RPC 응답 모양·팀 선언·회수 채널 점검(읽기 전용)
  grokbot jobs                            장부의 job 목록
  grokbot bots [--json] | state <bot> | tail <bot> [--limit 40] [--dump f.json] | status

  종료 코드: 0 성공(회수·검증 통과. --partial-ok 면 partial 도 회수되면 0) · 8 회수·검증 실패 · 3 사람 응답 대기 · 4 진행 중(watch 시간 초과) · 5 partial · 6 failed · 7 취소

관리 명령 (--admin 필요)
  grokbot team plan|apply [team/team.json]   팀(봇·그룹·스킬) 선언 반영. 이름 기준 생성·갱신, 삭제 안 함
  grokbot create --name N [--title T] [--description D] | delete <bot> | send <bot> "지시"
  grokbot interrupt <bot> | raw <method> ['{json}']
`;

const ADMIN = new Set(["create", "delete", "send", "interrupt", "raw"]);

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parse(rest);
  const out = (v) => process.stdout.write((typeof v === "string" ? v : JSON.stringify(v, null, 2)) + "\n");

  if (!cmd || cmd === "help" || cmd === "--help") return out(HELP);
  if (cmd === "status") {
    const plist = "/Applications/Grok Bot.app/Contents/Info.plist";
    let version = null;
    try { version = execFileSync("/usr/bin/defaults", ["read", plist, "CFBundleShortVersionString"], { encoding: "utf8" }).trim(); } catch {}
    return out({ app: existsSync(plist), appVersion: version, session: existsSync(DESCRIPTOR) || existsSync(SECRETS) });
  }
  if (cmd === "jobs") {
    return out(listJobs().map((j) => ({ jobId: j.jobId, bot: j.bot, state: j.state, createdAt: j.createdAt, goal: String(j.goal).slice(0, 60) })));
  }
  if ((ADMIN.has(cmd) || (cmd === "team" && pos[0] === "apply")) && !opt.admin) {
    throw new BridgeError(`'${cmd}'는 관리 명령이다. 오너가 직접 실행할 때만 --admin 을 붙인다.`);
  }

  const s = loadSession();
  if (!s.url) await wake(s);
  if (!s.url) throw new BridgeError("게이트웨이 주소를 받지 못했다. Grok Bot 앱을 열어 다시 로그인하라.");
  const report = (rec) => {
    process.exitCode = EXIT[rec.state] ?? 4;
    // --partial-ok: partial 이어도 산출물을 받았으면 0 으로 끝내 품앗이 게이트가 내용을 판정하게 한다(footer 의 state 는 그대로).
    if (opt["partial-ok"] && rec.state === "partial" && rec.fetch?.ok) process.exitCode = 0;
    const view = { jobId: rec.jobId, bot: rec.bot, state: rec.state, result: rec.result ?? null, outputDir: outDir(rec.jobId), ...(rec.gap ? { warning: "대화 창 밖으로 밀린 출력이 있을 수 있음" } : {}), ...(rec.invalidMarker ? { invalidMarker: rec.invalidMarker } : {}), ...(rec.cancel ? { cancel: rec.cancel } : {}), ...(rec.fetch ? { fetch: { ok: rec.fetch.ok, dest: rec.fetch.dest, files: rec.fetch.files, problems: rec.fetch.problems } } : {}) };
    if (opt.text) {
      const body = rec.result?.final ?? rec.result?.reason ?? "";
      const foot = [`state=${rec.state}`, `job=${rec.jobId}`, rec.fetch?.dest ? `dest=${rec.fetch.dest}` : `remote=${outDir(rec.jobId)}`, ...(rec.fetch?.problems?.length ? [`problems=${rec.fetch.problems.join("; ")}`] : [])].join(" ");
      return out(`${body}\n\n[grokbot] ${foot}`);
    }
    return out(view);
  };

  switch (cmd) {
    case "bots": {
      const bots = await listBots(s);
      if (opt.json) return out(bots);
      if (!bots.length) return out("(봇 없음)");
      return out(bots.map((b) => `${b.isGroup ? "[그룹]" : "[봇]  "} ${b.name}${b.title ? ` — ${b.title}` : ""}  (${b.id})`).join("\n"));
    }
    case "run": {
      const goal = pos.join(" ") || (process.stdin.isTTY ? "" : readFileSync(0, "utf8"));
      if (!goal.trim()) throw new BridgeError("목표가 비었다.");
      const fields = Object.fromEntries(["deliverables", "constraints", "context", "deadline", "budget", "approval"].filter((k) => typeof opt[k] === "string").map((k) => [k, opt[k]]));
      const rec = await start(s, typeof opt.bot === "string" ? opt.bot : "품앗이", goal, { fields, force: Boolean(opt.force), queue: Boolean(opt.queue), queueSec: Number(opt["queue-timeout"]) || 3600 });
      if (!opt.json && !opt.text) process.stderr.write(`grokbot: job ${rec.jobId} 시작 (재접속: grokbot watch ${rec.jobId})\n`);
      return report(await finish(s, await watch(s, rec, { timeoutSec: Number(opt.timeout) || 900 }), opt));
    }
    case "watch": {
      const rec = loadJob(pos[0]);
      if (!OPEN_STATES.has(rec.state) && rec.state !== "remote_completed") return report(rec);
      const r = OPEN_STATES.has(rec.state) ? await watch(s, rec, { timeoutSec: Number(opt.timeout) || 900 }) : rec;
      return report(await finish(s, r, opt));
    }
    case "doctor": {
      const rows = await doctor();
      const mark = { ok: "ok  ", warn: "warn", fail: "FAIL" };
      out(rows.map((r) => `${mark[r.state]}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`).join("\n"));
      process.exitCode = rows.some((r) => r.state === "fail") ? 1 : 0;
      return;
    }
    case "fetch": {
      const dest = typeof opt.dest === "string" ? opt.dest : undefined;
      const r = opt.chat || !bridgeConfig().ssh ? await fetchViaChat(s, pos[0], { dest }) : await fetchJob(s, pos[0], { dest });
      if (existsSync(jobPath(pos[0]))) {
        const rec = loadJob(pos[0]);
        if (rec.state === "remote_completed" || rec.state === "fetch_invalid") rec.state = r.ok ? "succeeded" : "fetch_invalid";
        rec.fetch = r; saveJob(rec);
      }
      process.exitCode = r.ok ? 0 : 8;
      return out(r);
    }
    case "cancel": {
      return report(await cancel(s, loadJob(pos[0])));
    }
    case "state": {
      const bot = await resolve(s, pos[0]);
      return out({ bot: bot.name, ...(await botState(s, bot)) });
    }
    case "tail": {
      const entries = await tail(s, await resolve(s, pos[0]), Number(opt.limit) || 40);
      if (opt.dump) { writeFileSync(opt.dump, JSON.stringify(entries, null, 2)); return out({ dumped: opt.dump, count: entries.length }); }
      return out(entries);
    }
    case "team": {
      const sub = pos[0];
      if (sub !== "plan" && sub !== "apply") throw new BridgeError("grokbot team plan|apply [파일]");
      return out(await teamSync(s, pos[1] || TEAM_FILE, { apply: sub === "apply" }));
    }
    case "create": {
      if (!opt.name) throw new BridgeError("--name 이 필요하다.");
      const d = await call(s, "createAgent", { name: opt.name, title: opt.title || "", description: opt.description || "", avatarShape: "", avatarColor: "", origin: "user" });
      return out(asBot(d.agent || d));
    }
    case "delete": {
      const bot = await resolve(s, pos[0]);
      await call(s, "deleteAgent", { id: bot.id });
      return out({ deleted: bot });
    }
    case "send": {
      const bot = await resolve(s, pos[0]);
      const d = await call(s, "sendPrompt", { agentId: bot.id, prompt: pos.slice(1).join(" "), clientNonce: crypto.randomUUID() });
      return out({ bot: bot.name, messageId: d.messageId ?? null });
    }
    case "interrupt": {
      const bot = await resolve(s, pos[0]);
      await call(s, "interruptAgentRun", { id: bot.id });
      return out({ interrupted: bot.name });
    }
    case "raw": {
      return out(await call(s, pos[0], pos[1] ? JSON.parse(pos[1]) : {}));
    }
    default:
      throw new BridgeError(`모르는 명령: ${cmd}\n\n${HELP}`);
  }
}

main().catch((e) => {
  process.stderr.write(`grokbot: ${redact(e.message || e)}\n`);
  process.exit(1);
});
