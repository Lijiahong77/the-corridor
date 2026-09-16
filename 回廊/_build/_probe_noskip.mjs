/**
 * 《回廊》真结局「视频不可跳过」验证探针
 *
 * 要证明的三件事：
 *   1) 视频播放期间，三个跳过入口全部失效 —— 点击画面 / 点"点击跳过" / 键盘
 *      （断言：时间轴继续自然走，没有跳到结尾，结局卡没出现）
 *   2) 藏起来的「重新走一遍」按钮点不动 —— 它父层 pointer-events:none
 *      挡不住它自己的 pointer-events:auto，所以必须靠 disabled 锁住
 *      （断言：点它之后页面没有 reload，全局探针标记还在）
 *   3) 视频自然播完后，结局卡浮现 + 「重新走一遍」才解锁
 *
 * 用法： node _probe_noskip.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.CDP_PORT || 9433);
const PROFILE = 'C:\\Users\\lijia\\AppData\\Local\\Temp\\abv-noskip-' + PORT;
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

const fail = [];
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  → ' + extra : ''}`);
  if (!ok) fail.push(label);
};

const cdp = await CDP.connect(wsUrl);
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

await cdp.send('Page.navigate', { url: encodeURI(TARGET) });
await sleep(3800);

/* 立一个"页面没被 reload"的哨兵：reload 后它会消失 */
await cdp.eval(`window.__sentinel = 'alive'; return 1;`);

await cdp.eval(`document.querySelector('#start').click(); return 1;`);
await sleep(900);
await cdp.eval(`goto('end_true'); return 1;`);
await sleep(1500);

console.log('\n[1] 播放中：跳过入口是否全锁住');
const mid0 = await cdp.eval(`const v=document.querySelector('#vid');
  return JSON.stringify({t:+v.currentTime.toFixed(2), d:+(v.duration||0).toFixed(2),
    lock:vidLock, done:!!vidDone, paused:v.paused,
    skip:document.querySelector('#skipv').classList.contains('show'),
    restartDisabled:document.querySelector('#end-restart').disabled,
    ending:document.querySelector('#endcard').classList.contains('show')});`);
console.log('  起播 1.5s 状态:', mid0);
const m0 = JSON.parse(mid0);
check(m0.lock === true, 'vidLock 已锁', 'vidLock=' + m0.lock);
check(m0.skip === false, '不显示"点击跳过"提示');
check(m0.restartDisabled === true, '「重新走一遍」已禁用');
check(m0.d > 14 && m0.t > 0.8, '视频正常起播', `t=${m0.t}s / 全长 ${m0.d}s`);
await cdp.shot('probe_noskip_a_playing');

/* 三个入口全打一遍：点"跳过"提示、点画面、键盘。
   用 CDP Input 发真实鼠标/键盘事件（不是 dispatchEvent 造的合成事件）——
   合成事件会绕过 disabled 的元素级拦截，测出来是假的。 */
console.log('\n[2] 播放中：三种跳过手段各打三次（真实输入事件）');
const rects = JSON.parse(await cdp.eval(`
  const r=(s)=>{const b=document.querySelector(s).getBoundingClientRect();
    return {x:b.x+b.width/2, y:b.y+b.height/2, w:b.width, h:b.height};};
  return JSON.stringify({skip:r('#skipv'), stage:r('#stage'), restart:r('#end-restart')});`));
console.log('  隐藏按钮位置:', JSON.stringify(rects.restart));

async function realClick(x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function realKey(key, code, vk) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}

for (let i = 0; i < 3; i++) {
  await realClick(rects.stage.x, rects.stage.y);                 /* 点画面 */
  await realClick(rects.restart.x, rects.restart.y);             /* 点那个看不见的重来按钮 */
  await realKey(' ', 'Space', 32);
  await realKey('Enter', 'Enter', 13);
  await realKey('Escape', 'Escape', 27);
}
await sleep(2000);

const mid1 = await cdp.eval(`const v=document.querySelector('#vid');
  return JSON.stringify({t:+v.currentTime.toFixed(2), lock:vidLock, paused:v.paused,
    sentinel:window.__sentinel||null,
    restartDisabled:document.querySelector('#end-restart').disabled,
    ending:document.querySelector('#endcard').classList.contains('show')});`);
console.log('  连打之后状态:', mid1);
const m1 = JSON.parse(mid1);
check(m1.sentinel === 'alive', '页面没有被 reload（隐藏按钮点不动）');
check(m1.ending === false, '结局卡仍未出现');
check(m1.paused === false, '视频没有被 pause');
check(m1.t > m0.t + 1.2 && m1.t < 10, '时间轴自然前进、没被拉到结尾', `${m0.t}s → ${m1.t}s`);
await cdp.shot('probe_noskip_b_after_attacks');

console.log('\n[3] 等它自然播完');
let shown = false;
for (let i = 0; i < 70; i++) {
  await sleep(300);
  try {
    if (await cdp.eval(`return document.querySelector('#endcard').classList.contains('show');`)) { shown = true; break; }
  } catch (e) {}
}
await sleep(1600);   /* 结局卡 1.4s 淡入 */
const fin = await cdp.eval(`const v=document.querySelector('#vid');
  const rb=document.querySelector('#end-restart');
  return JSON.stringify({ending:document.querySelector('#endcard').classList.contains('show'),
    t:+v.currentTime.toFixed(2), paused:v.paused,
    restartDisabled:rb.disabled,
    bodyLen:document.querySelector('#end-body').textContent.length,
    label:document.querySelector('#end-label').textContent});`);
console.log('  播完状态:', fin);
const f = JSON.parse(fin);
check(f.ending, '结局卡已出现');
check(f.restartDisabled === false, '「重新走一遍」已解锁');
check(f.bodyLen > 100, '结局文字段落已铺出', f.label + ' / ' + f.bodyLen + ' 字');
check(f.t >= 14.5, '视频确实跑到了末尾', `t=${f.t}s`);
await cdp.shot('probe_noskip_c_ended');

console.log('\n[4] 解锁后按钮才真的能重来');
await cdp.eval(`window.__sentinel = 'still-alive'; document.querySelector('#end-restart').click(); return 1;`);
await sleep(3000);
const after = await cdp.eval(`return JSON.stringify({sentinel:window.__sentinel||null,
  title:!!document.querySelector('#title'), ending:document.querySelector('#endcard').classList.contains('show')});`);
console.log('  点击重来之后:', after);
const a = JSON.parse(after);
check(a.sentinel === null, '点击后页面已 reload（重来生效）');

console.log('\nJS 异常:', cdp.exceptions.length ? cdp.exceptions : '无');
console.log(fail.length ? `\n结果: ${fail.length} 项未通过 → ` + fail.join(' / ') : '\n结果: 全部通过');
browser.kill();
process.exit(fail.length ? 1 : 0);
