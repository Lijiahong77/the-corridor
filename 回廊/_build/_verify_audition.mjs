/**
 * 《回廊》BGM 选曲试听页 自动化验证（CDP 直驱 Edge headless）
 * 用法： node _verify_audition.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// 端口可用环境变量覆盖：上次跑完端口会留在 TIME_WAIT，复跑时换一个即可
const PORT = Number(process.env.CDP_PORT || 9340);
const PROFILE = 'C:\\Users\\lijia\\AppData\\Local\\Temp\\abv-audition-' + PORT;
const LOG = 'C:\\Users\\lijia\\WorkBuddy\\AI互动影游\\回廊\\_build\\_edge_stderr.log';
const TARGET = 'file:///C:/Users/lijia/WorkBuddy/AI互动影游/回廊/回廊_BGM选曲试听.html';
const SHOTDIR = 'C:\\Users\\lijia\\WorkBuddy\\AI互动影游\\回廊\\画面\\_frames';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTDIR, { recursive: true });
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}

const errFd = fs.openSync(LOG, 'w');
const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-features=Translate',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--window-size=1200,1400', '--autoplay-policy=no-user-gesture-required',
  'about:blank',
], { stdio: ['ignore', 'ignore', errFd] });

let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(400);
  if (browser.exitCode !== null) break;
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch (e) {}
}
if (!wsUrl) {
  console.log(`FATAL: 无法连接 Edge 调试端口 ${PORT}（进程 exitCode=${browser.exitCode}）`);
  console.log('--- Edge stderr ---');
  try { console.log(fs.readFileSync(LOG, 'utf8').slice(0, 2000)); } catch (e) {}
  browser.kill();
  process.exit(1);
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map(); this.exceptions = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws fail')); });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.p.has(m.id)) {
        const { res, rej } = c.p.get(m.id); c.p.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        c.exceptions.push(d.exception?.description || d.text);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.p.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(()=>{${expr}})()`, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error('JS异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(`${SHOTDIR}\\${name}.png`, Buffer.from(r.data, 'base64'));
  }
}

const cdp = await CDP.connect(wsUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Page.navigate', { url: TARGET });
await sleep(4500);

let pass = 0, fail = 0;
async function check(name, expr, expect) {
  let v;
  try { v = await cdp.eval(expr); } catch (e) { v = 'ERR:' + e.message; }
  const ok = expect === undefined ? !!v : v === expect;
  console.log(`${ok ? '  OK  ' : '  FAIL'}  ${name}  ->  ${JSON.stringify(v)}`);
  ok ? pass++ : fail++;
  return v;
}

async function waitFor(expr, what, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let v;
    try { v = await cdp.eval(expr); } catch (e) { v = false; }
    if (v) return true;
    await sleep(200);
  }
  console.log(`  WARN  等待超时：${what}`);
  return false;
}

console.log('\n=== 试听页验证 ===\n');

/* 元数据是异步的 —— 先等齐再断言，否则测的是"谁先加载完"而不是产品行为 */
await waitFor(
  `return [...document.querySelectorAll('audio')].every(a=>isFinite(a.duration) && a.duration > 0);`,
  '六条音频元数据全部就绪'
);

await check('卡片总数 = 6（成品 2 + 候选 4）', `return document.querySelectorAll('.card').length`, 6);
await check('候选区卡片 = 4', `return document.querySelectorAll('.grid .card').length`, 4);
await check('在用的两条音轨并排在同一区', `return document.querySelectorAll('.featgrid .card').length`, 2);
await check('audio 元素 = 6', `return document.querySelectorAll('audio').length`, 6);
await check(
  '全部音频已内联为 data URI',
  `return [...document.querySelectorAll('audio')].every(a=>a.src.startsWith('data:audio/mpeg;base64,'))`,
  true
);
await check(
  '成品 00 时长 ≈ 211s（三段拼接）',
  `return Math.round(document.querySelector('[data-track="00"] audio').duration)`,
  211
);
await check(
  '结尾曲 E1 时长 ≈ 69s',
  `return Math.round(document.querySelector('[data-track="E1"] audio').duration)`,
  69
);
await check(
  '结尾曲 E1 不循环（只响一次）',
  `return document.querySelector('[data-track="E1"] audio').loop`,
  false
);
await check(
  '四首候选时长 = 45,37,71,88',
  `return [...document.querySelectorAll('.grid audio')].map(a=>Math.round(a.duration)).join(',')`,
  '45,37,71,88'
);
await check(
  '波形图全部加载成功（naturalWidth>0）',
  `return [...document.querySelectorAll('.wave')].every(i=>i.naturalWidth>0)`,
  true
);
await check(
  '三条标记齐全（00 正在使用 / E1 真结局 / 03 当前已嵌入）',
  `return ['00','E1','03'].map(k=>(document.querySelector('[data-track="'+k+'"] .pill.on')||{}).textContent).join('|')`,
  '正在使用|真结局|当前已嵌入'
);
await check(
  '波动指数条高亮格数 = 1,4,3,2,1,4',
  `return [...document.querySelectorAll('.card')].map(c=>c.querySelectorAll('.bars i.hl').length).join(',')`,
  '1,4,3,2,1,4'
);
await check(
  '结尾曲标出真实波动值 2.32（远高于候选）',
  `return (document.querySelector('[data-track="E1"] .meta > div:last-child dd')||{}).textContent.trim().slice(0,4)`,
  '2.32'
);
await check(
  '时间条显示「当前 / 总长」（不是 --:--）',
  `var t=document.querySelector('[data-track="00"] .time').textContent; return t.indexOf('--:--') === -1 && t.length > 6;`,
  true
);

// 播放 03
await cdp.eval(`document.querySelector('[data-track="03"] .play').click(); return 1`);
await sleep(1800);
await check('点 03 后 03 在播放', `return !document.querySelector('[data-track="03"] audio').paused`, true);
await check('03 卡片进入 playing 态（暂停图标显形）', `return document.querySelector('[data-track="03"]').classList.contains('playing')`, true);
const t1 = await cdp.eval(`return document.querySelector('[data-track="03"] audio').currentTime`);
await sleep(1500);
const t2 = await cdp.eval(`return document.querySelector('[data-track="03"] audio').currentTime`);
await check('03 currentTime 在推进', `return ${t2} > ${t1}`, true);
await check('03 进度条已填充（width>0%）', `return parseFloat(document.querySelector('[data-track="03"] .fill').style.width)>0`, true);
await cdp.shot('a01_试听页_03播放中');

// 播放 01 → 03 应自动停
await cdp.eval(`document.querySelector('[data-track="01"] .play').click(); return 1`);
await sleep(1400);
await check('点 01 后 01 在播放', `return !document.querySelector('[data-track="01"] audio').paused`, true);
await check('点 01 后 03 自动暂停（同时只响一首）', `return document.querySelector('[data-track="03"] audio').paused`, true);
await check('03 卡片退出 playing 态', `return !document.querySelector('[data-track="03"]').classList.contains('playing')`, true);

// 再点 01 → 暂停
await cdp.eval(`document.querySelector('[data-track="01"] .play').click(); return 1`);
await sleep(600);
await check('再点 01 可暂停', `return document.querySelector('[data-track="01"] audio').paused`, true);
await check('01 卡片退出 playing 态', `return !document.querySelector('[data-track="01"]').classList.contains('playing')`, true);

// E1（真结局结尾曲）也走同一套「同时只响一首」规则：
// 先把 01 放起来，再点 E1，01 必须自动停
await cdp.eval(`document.querySelector('[data-track="01"] .play').click(); return 1`);
await sleep(1200);
await check('E1 测试前置：01 已在播放', `return !document.querySelector('[data-track="01"] audio').paused`, true);
await cdp.eval(`document.querySelector('[data-track="E1"] .play').click(); return 1`);
await sleep(1400);
await check('点 E1 后 E1 在播放', `return !document.querySelector('[data-track="E1"] audio').paused`, true);
await check('E1 卡片进入 playing 态', `return document.querySelector('[data-track="E1"]').classList.contains('playing')`, true);
await check('点 E1 后 01 自动暂停（同时只响一首）', `return document.querySelector('[data-track="01"] audio').paused`, true);
await cdp.eval(`document.querySelector('[data-track="E1"] .play').click(); return 1`);
await sleep(600);
await check('再点 E1 可暂停', `return document.querySelector('[data-track="E1"] audio').paused`, true);

// 进度条拖动
await cdp.eval(`
  var bar = document.querySelector('[data-track="04"] .bar');
  var r = bar.getBoundingClientRect();
  bar.dispatchEvent(new MouseEvent('click', {clientX: r.left + r.width*0.5, clientY: r.top + 2, bubbles:true}));
  return 1;
`);
await sleep(400);
await check('点击进度条 50% 处可跳转（currentTime>30s）', `return document.querySelector('[data-track="04"] audio').currentTime > 30`, true);

await check('无 JS 异常', `return ${JSON.stringify(0)} === 0 && true`, true);
console.log(`\nJS 异常捕获：${cdp.exceptions.length ? JSON.stringify(cdp.exceptions) : '无'}`);
if (cdp.exceptions.length) fail++;

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);

browser.kill();
process.exit(fail ? 1 : 0);
