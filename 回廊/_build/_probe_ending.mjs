/**
 * 《回廊》真结局「天台」视觉快速探针
 *
 * 用途：只走真结局那一屏，不跑完整剧情 —— 调 CSS（对比度/蒙版）时用。
 *   完整验证 _verify.mjs 要跑近 3 分钟，改一次样式等 3 分钟不现实；
 *   这个探针约 40 秒出图（要等 15 秒视频播完）。
 *
 * 真结局现在的机制（v1.0）：叙事型结局视频 —— 播一次、不循环、
 *   走完停在末帧（整座城市），结局卡再淡入压上去。所以探针必须
 *   分别捕捉「视频中途」和「末帧 + 结局卡」两个状态。
 *
 * 用法： CDP_PORT=9430 node _probe_ending.mjs
 * 产出： 画面\_frames\probe_end_{a,b,c,d}.png
 *         a = 视频中段（刚出门，还暗）
 *         b = 视频后段（视野已开阔）
 *         c = 末帧 + 结局卡刚浮现
 *         d = 结局卡完全显示
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.CDP_PORT || 9430);
const PROFILE = 'C:\\Users\\lijia\\AppData\\Local\\Temp\\abv-probe-' + PORT;
const TARGET = 'file:///C:/Users/lijia/WorkBuddy/AI互动影游/回廊/回廊_互动原型.html';
const SHOTDIR = 'C:\\Users\\lijia\\WorkBuddy\\AI互动影游\\回廊\\画面\\_frames';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(SHOTDIR, { recursive: true });
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-features=Translate',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required',
  'about:blank',
], { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  await sleep(400);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch (e) {}
}
if (!wsUrl) { console.log('FATAL: 无法连接 Edge 调试端口'); browser.kill(); process.exit(1); }

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
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${SHOTDIR}\\${name}.png`, Buffer.from(r.data, 'base64'));
  }
}

const cdp = await CDP.connect(wsUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

await cdp.send('Page.navigate', { url: encodeURI(TARGET) });
await sleep(3800);   /* 20MB data URI，给足解码时间 */

/* 点进入 → 直接跳到真结局 */
await cdp.eval(`document.querySelector('#start').click(); return 1;`);
await sleep(900);
await cdp.eval(`goto('end_true'); return 1;`);

/* 视频起播确认 */
await sleep(1500);
const meta = await cdp.eval(`const v=document.querySelector('#vid');
  return JSON.stringify({show:v.classList.contains('show'), muted:v.muted, paused:v.paused,
    loop:v.loop, t:+v.currentTime.toFixed(2), d:+(v.duration||0).toFixed(2),
    w:v.videoWidth, h:v.videoHeight, ready:v.readyState,
    skip:document.querySelector('#skipv').classList.contains('show')});`);
console.log('视频元信息:', meta);

await cdp.shot('probe_end_a');                       /* 视频中段：还暗 */
console.log('a 已截（t≈1.5s，刚出门）');

await sleep(6500);                                   /* t≈8s：视野开阔 */
await cdp.shot('probe_end_b');
console.log('b 已截（t≈8s，视野开阔）');

/* 等视频走完（15s）+ 结局卡淡入 */
let ended = false;
for (let i = 0; i < 60; i++) {
  await sleep(300);
  try {
    if (await cdp.eval(`return document.querySelector('#endcard').classList.contains('show');`)) { ended = true; break; }
  } catch (e) {}
}
console.log('结局卡出现:', ended);
const after = await cdp.eval(`const v=document.querySelector('#vid');
  return JSON.stringify({paused:v.paused, ended:v.ended, loop:v.loop,
    t:+v.currentTime.toFixed(2), d:+(v.duration||0).toFixed(2),
    show:v.classList.contains('show')});`);
console.log('视频状态(结局卡出现时):', after);

await cdp.shot('probe_end_c');                       /* 末帧 + 结局卡刚浮现 */
await sleep(2000);
await cdp.shot('probe_end_d');                       /* 结局卡完全显示 */
console.log('c / d 已截');

/* 顺带看一眼右上角按钮在暗底上的颜色 */
const btns = await cdp.eval(`const g=(s)=>{const e=document.querySelector(s);const c=getComputedStyle(e);
  return c.color+' | '+c.borderTopColor;};
  return JSON.stringify({rules:g('#rulesbtn'), sound:g('#soundbtn'), app:document.querySelector('#app').className});`);
console.log('右上角按钮配色:', btns);
console.log('JS 异常:', cdp.exceptions.length ? cdp.exceptions : '无');

browser.kill();
