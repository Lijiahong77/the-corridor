/**
 * 《回廊》原型自动化验证（CDP 直驱 Edge headless）
 * 用法： node _verify.mjs
 * 验证目标：
 *   1) 页面能加载、无 JS 异常
 *   2) 三个节点能正常走通
 *   3) 「进电梯」会触发镜04 过场视频、且真的在播放（currentTime 递增）
 *   4) 视频播完能进入循环结局卡
 *   5) 视频阶段点击画面能"跳过"，快速进结局
 */
import { spawn } from 'node:child_process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = Number(process.env.CDP_PORT || 9333);
const PROFILE = 'C:\\Users\\lijia\\AppData\\Local\\Temp\\abv-profile-' + PORT;
const TARGET = 'file:///C:/Users/lijia/WorkBuddy/AI互动影游/回廊/回廊_互动原型.html';
const SHOTDIR = 'C:\\Users\\lijia\\WorkBuddy\\AI互动影游\\回廊\\画面\\_frames';

import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(SHOTDIR, { recursive: true });
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-features=Translate',
  /* 注意：不要加 --mute-audio —— 否则 AnalyserNode 读不到信号，无法验证声音是否真的产生 */
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

const results = [];
async function check(name, expr, expect) {
  let v;
  try { v = await cdp.eval(expr); } catch (e) { v = 'ERR:' + e.message; }
  const ok = expect ? expect(v) : !!v;
  results.push({ name, ok, v });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ->  ${JSON.stringify(v)}`);
}

async function loadPage() {
  await cdp.send('Page.navigate', { url: encodeURI(TARGET) });
  await sleep(3000);
}

/** 轮询等待某个条件成立（打字机速度有限，不能用固定 sleep 猜） */
async function waitFor(expr, label = '', timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await cdp.eval(expr)) return Date.now() - t0; } catch (e) {}
    await sleep(150);
  }
  throw new Error('等待超时: ' + (label || expr));
}

// 注意：上一条选择的按钮会以 .disabled 残留在 DOM 里，
// 所以要等「未被禁用的选项」出现，才算真正进了新节点。
const HAS_CHOICE = `return document.querySelectorAll('.choice:not(.disabled)').length > 0;`;
const NO_CHOICE  = `return document.querySelectorAll('.choice:not(.disabled)').length === 0;`;

async function walkToElevator(verifyIntro = false) {
  await cdp.eval(`document.querySelector('#start').click(); return 1;`);
  // 开场镜头（v1）：点「进入」后第一眼看到的就是它
  await waitFor(`return document.querySelector('#vid').classList.contains('show');`, '开场视频出现');
  if (verifyIntro) {
    await sleep(900);
    await check('开场：视频层已显示', `return document.querySelector('#vid').classList.contains('show');`);
    await check('开场：视频真的在播(currentTime>0)', `return +document.querySelector('#vid').currentTime.toFixed(2);`, (v) => v > 0);
    await check('开场：跳过提示已出现', `return document.querySelector('#skipv').classList.contains('show');`);
    await cdp.shot('v00_开场视频中');
  } else {
    // 后续轮次不需要再看一遍开场，直接跳过（顺带省时间）
    await cdp.eval(`if(vidDone!==null) document.querySelector('#stage').click(); return 1;`);
    await sleep(250);
  }
  await waitFor(HAS_CHOICE, '开场选项出现');
  if (verifyIntro) {
    await check('开场：播完保留末帧（未跳回静态图）',
      `return document.querySelector('#vid').classList.contains('show') && document.querySelector('#vid').ended === true;`);
    await check('开场旁白已出现', `return document.querySelector('#text').textContent.length;`, (v) => v > 10);
    await cdp.shot('v00b_开场_旁白与选项');
  }

  // ---- n1：门前镜头（v2）----
  await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`); // 站起来往前走 → n1
  await waitFor(`return document.querySelector('#vid').classList.contains('show');`, 'n1 门前镜头出现');
  if (verifyIntro) {
    await sleep(900);
    await check('n1：门前镜头真的在播(currentTime>0)', `return +document.querySelector('#vid').currentTime.toFixed(2);`, (v) => v > 0);
    await check('n1：跳过提示已出现', `return document.querySelector('#skipv').classList.contains('show');`);
    await cdp.shot('v07_n1_门外逼近');
  } else {
    await cdp.eval(`if(vidDone!==null) document.querySelector('#stage').click(); return 1;`);
    await sleep(250);
  }
  await waitFor(HAS_CHOICE, '节点1选项出现');
  if (verifyIntro) {
    await check('n1：播完保留末帧（未跳回静态图）',
      `return document.querySelector('#vid').classList.contains('show') && document.querySelector('#vid').ended === true;`);
  }
  await check('节点1 旁白是「回廊」', `return document.querySelector('#speaker').textContent;`, (v) => v === '回廊');

  await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`); // 闭眼数到十 → n2
  await waitFor(HAS_CHOICE, '节点2选项出现');
  await check('节点2 旁白是「书房」', `return document.querySelector('#speaker').textContent;`, (v) => v === '书房');
  await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`); // 不碰照片 → n3
  await waitFor(HAS_CHOICE, '节点3选项出现');
}

console.log('\n===== 第 1 轮：完整播放（不跳过）=====');
await loadPage();
await check('标题页存在且未隐藏', `return !document.querySelector('#title').classList.contains('hide');`);
await check('视频元素已预载到源', `return (document.querySelector('#vid').getAttribute('src')||'').slice(0,20);`,
  (v) => String(v).startsWith('data:video/mp4'));
await cdp.shot('v01_标题页');

await walkToElevator(true);
await check('节点3 旁白是「尽头」', `return document.querySelector('#speaker').textContent;`, (v) => v === '尽头');
await cdp.shot('v02_节点3_尽头');

// 选「进电梯」→ 应触发过场视频
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[1].click(); return 1;`);
await sleep(800);
await check('视频层已显示', `return document.querySelector('#vid').classList.contains('show');`);
await check('正处于视频阶段(vidDone 非空)', `return vidDone !== null;`);
await check('视频真的在播(currentTime>0)', `return +document.querySelector('#vid').currentTime.toFixed(2);`, (v) => v > 0);
await check('视频未暂停', `return document.querySelector('#vid').paused === false;`);
await check('跳过提示已出现', `return document.querySelector('#skipv').classList.contains('show');`);
await check('此时选项面板还没出现', `return document.querySelector('#panel').classList.contains('show') === false;`);
await cdp.shot('v03_过场视频中');

await sleep(6200);
await check('视频已播完(ended)', `return document.querySelector('#vid').ended === true;`);
await check('视频阶段已结束', `return vidDone === null;`);
await sleep(1600);
await check('结局卡已显示', `return document.querySelector('#endcard').classList.contains('show');`);
await check('结局标题是「回 廊」', `return document.querySelector('#end-title').textContent;`, (v) => v === '回 廊');
await check('标题页已彻底移除', `return document.querySelector('#title').style.display;`, (v) => v === 'none');
await cdp.shot('v04_循环结局卡');

console.log('\n===== 第 2 轮：视频阶段点击跳过 =====');
await loadPage();
await walkToElevator();
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[1].click(); return 1;`);
await sleep(900);
await check('跳过前仍在视频阶段', `return vidDone !== null;`);
const t0 = Date.now();
await cdp.eval(`document.querySelector('#stage').click(); return 1;`);
await sleep(1500);
await check('点击后立刻离开视频阶段', `return vidDone === null;`);
await check('点击后视频层收起', `return document.querySelector('#vid').classList.contains('show') === false;`);
await sleep(1600);
await check('跳过路径也能到结局卡', `return document.querySelector('#endcard').classList.contains('show');`);
console.log(`  跳过到结局耗时约 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await cdp.shot('v05_跳过后结局');

console.log('\n===== 第 3 轮：死亡回溯路径 =====');
await loadPage();
await cdp.eval(`document.querySelector('#start').click(); return 1;`);
await waitFor(`return document.querySelector('#vid').classList.contains('show');`, '开场视频出现');
await cdp.eval(`document.querySelector('#stage').click(); return 1;`); // 跳过开场镜头
await waitFor(HAS_CHOICE, '开场选项出现');
await check('开场镜头可点击跳过', `return vidDone === null;`);
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`);
await waitFor(`return document.querySelector('#vid').classList.contains('show');`, 'n1 门前镜头出现');
await cdp.eval(`if(vidDone!==null) document.querySelector('#stage').click(); return 1;`); // 跳过 n1 门前镜头
await waitFor(HAS_CHOICE, '节点1选项出现');
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[1].click(); return 1;`); // 看猫眼 → d1 死亡
// 打字机把「违反守则」打在最后，之后还要一个 tick 才生成回溯按钮 —— 两件事都等到
await waitFor(`return document.querySelector('#text').textContent.includes('违反')
  && document.querySelectorAll('.choice:not(.disabled)').length === 1;`, '死亡节点就绪');
await check('死亡节点出现回溯按钮', `return document.querySelectorAll('.choice:not(.disabled)').length;`, (v) => v === 1);
await check('死亡文案带违反守则标记', `return document.querySelector('#text').textContent.includes('违反');`, (v) => v === true);
// d1 原文案写「门外的走廊是空的」，必须用 m5（猫眼空走廊），不能复用 m2（门外有双脚）
await check('d1 底图已换成「猫眼空走廊」专图', `return document.querySelector('#bg').getAttribute('src') === IMG.m5;`);
await check('d1 不再复用 m2 敲门图', `return document.querySelector('#bg').getAttribute('src') !== IMG.m2;`);
await cdp.shot('v06_死亡回溯');
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`);
await waitFor(`return document.querySelectorAll('.choice:not(.disabled)').length === 2;`, '回溯后选项恢复');
await check('回溯后回到节点1', `return document.querySelector('#speaker').textContent;`, (v) => v === '回廊');

console.log('\n===== 第 4 轮：真实 BGM + 音效 =====');
await loadPage();
await check('标题页：音频引擎尚未启动', `return SND.ready;`, (v) => v === false);
await check('标题页：BGM 元素存在且未播放', `return document.querySelector('#bgm').paused;`, (v) => v === true);
await check('标题页：结尾曲元素存在且未播放', `return document.querySelector('#endmusic').paused;`, (v) => v === true);
await check('标题页：结尾曲设为不循环', `return document.querySelector('#endmusic').loop;`, (v) => v === false);
await check('标题页：静音开关已可见', `return !!document.querySelector('#soundbtn');`, (v) => v === true);
await check('标题页：已标注音乐出处（CC BY 署名）',
  `return document.querySelector('.credit').textContent.indexOf('Eric Matyas') >= 0;`, (v) => v === true);
await cdp.shot('v08a_标题页_署名');

await cdp.eval(`document.querySelector('#start').click(); return 1;`);
await sleep(1600);
await check('AudioContext 已创建且 running', `return SND.probe().state;`, (v) => v === 'running');
await check('音效总线已淡入（master>0.1）', `return SND.probe().master;`, (v) => v > 0.1);
await check('BGM 已开始播放（paused=false）', `return SND.probe().bgm.paused;`, (v) => v === false);
await check('BGM 进度在推进（currentTime>0）', `return SND.probe().bgm.currentTime;`, (v) => v > 0);
await check('BGM 已设为循环播放', `return SND.probe().bgm.loop;`, (v) => v === true);
await waitFor(`return SND.probe().bgm.duration !== null;`, 'BGM 时长元数据');
await check('BGM 时长约 3.5 分钟', `return SND.probe().bgm.duration;`, (v) => v > 200 && v < 225);
await sleep(3000);
await check('BGM 音量已淡入（volume>0.1）', `return SND.probe().bgm.volume;`, (v) => v > 0.1);
await check('BGM 进度持续推进（>4s）', `return SND.probe().bgm.currentTime;`, (v) => v > 4);
await check('开场阶段结尾曲保持静止（不该被牵动）', `return SND.probe().endmusic.paused;`, (v) => v === true);
await cdp.shot('v08b_开场_音乐已起');

/* n1：敲门 + 灯灭（音效，与 BGM 并存） */
await cdp.eval(`if(vidDone!==null) document.querySelector('#stage').click(); return 1;`);
await waitFor(HAS_CHOICE, '开场选项出现');
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`);
await waitFor(`return SND.probe() && SND.probe().sfx.knock >= 3;`, '敲门音效');
await check('n1 敲门音效已响 3 下', `return SND.probe().sfx.knock;`, (v) => v >= 3);
await check('n1 灯灭音效已触发', `return SND.probe().sfx.lampOff;`, (v) => v >= 1);
await check('n1 音效确实产生了波形（rms>0）', `return SND.probe().rms;`, (v) => v > 0);
await check('n1 BGM 未被音效打断', `return SND.probe().bgm.paused;`, (v) => v === false);
await cdp.shot('v09a_n1_敲门音效');

/* n2：灯亮 */
await cdp.eval(`if(vidDone!==null) document.querySelector('#stage').click(); return 1;`);
await waitFor(HAS_CHOICE, '节点1选项出现');
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`);
await waitFor(`return SND.probe() && SND.probe().sfx.lampOn >= 1;`, '灯亮音效');
await check('n2 灯亮音效已触发', `return SND.probe().sfx.lampOn;`, (v) => v >= 1);

/* n3：电梯 */
await waitFor(HAS_CHOICE, '节点2选项出现');
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`);
await waitFor(`return SND.probe() && SND.probe().sfx.elevator >= 1;`, '电梯音效');
await check('n3 电梯滑轨音效已触发', `return SND.probe().sfx.elevator;`, (v) => v >= 1);

/* 循环结局：音乐不关（循环还没结束） */
await waitFor(HAS_CHOICE, '节点3选项出现');
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[1].click(); return 1;`);
await waitFor(`return document.querySelector('#endcard').classList.contains('show');`, '循环结局卡');
await check('循环结局：BGM 继续播放', `return SND.probe().bgm.paused;`, (v) => v === false);
await check('循环结局：结尾曲不参与（仍在静止）', `return SND.probe().endmusic.paused;`, (v) => v === true);

/* 静音开关 */
await cdp.eval(`document.querySelector('#soundbtn').click(); return 1;`);
await sleep(1600);
await check('静音后音效总线归零', `return SND.probe().master;`, (v) => v < 0.05);
await check('静音后 BGM 音量归零', `return SND.probe().bgm.volume;`, (v) => v < 0.05);
await check('静音按钮进入 off 态', `return document.querySelector('#soundbtn').classList.contains('off');`, (v) => v === true);
await cdp.shot('v09b_静音状态');
await cdp.eval(`document.querySelector('#soundbtn').click(); return 1;`);
await sleep(1600);
await check('取消静音后音效总线恢复', `return SND.probe().master;`, (v) => v > 0.1);
await check('取消静音后 BGM 恢复', `return SND.probe().bgm.volume;`, (v) => v > 0.1);
await check('取消静音后 BGM 仍在播', `return SND.probe().bgm.paused;`, (v) => v === false);

console.log('\n===== 第 5 轮：真结局音乐交棒 / 死亡音效 =====');
await loadPage();
await cdp.eval(`document.querySelector('#start').click(); return 1;`);
await waitFor(`return SND.ready === true;`, '音频引擎已启动');
await cdp.eval(`if(vidDone!==null) document.querySelector('#stage').click(); return 1;`);
await waitFor(HAS_CHOICE, '开场选项');
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`);
await waitFor(HAS_CHOICE, '节点1');
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`);
await waitFor(HAS_CHOICE, '节点2');
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`);
await waitFor(HAS_CHOICE, '节点3');
await check('走到尽头时 BGM 仍在播', `return SND.probe().bgm.paused;`, (v) => v === false);
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`); /* 走楼梯 → 天台 */
/* --- 天台：叙事型结局视频（endvid）---
   它是「从昏暗楼道走出去、视野逐渐开阔」的单向过程：播一次、不循环、
   走完停在末帧（整座城市），结局卡再压上去。所以分三个阶段验：
     A 播一次阶段  B 播完停在末帧  C 交棒时机（音乐在视频开始就换） */
await sleep(1800);   /* 等视频起播 */
await check('天台视频已显示（#vid.show）', `return document.querySelector('#vid').classList.contains('show');`, (v) => v === true);
await check('天台视频正在播放（paused=false）', `return document.querySelector('#vid').paused;`, (v) => v === false);
await check('天台视频不循环（loop=false —— 单向叙事，不是背景循环）', `return document.querySelector('#vid').loop;`, (v) => v === false);
await check('天台视频时长约 15 秒（李自备素材）', `return document.querySelector('#vid').duration;`, (v) => v > 13 && v < 17);
await check('天台视频已解码就绪（readyState>=2）', `return document.querySelector('#vid').readyState;`, (v) => v >= 2);
await check('天台视频分辨率 1280x720', `const v=document.querySelector('#vid'); return v.videoWidth+'x'+v.videoHeight;`, '1280x720');
await check('天台视频是静音的（自带音轨不播，不跟结尾曲打架）', `return document.querySelector('#vid').muted;`, (v) => v === true);
await check('天台视频阶段给「点击跳过」提示（走完要看 15 秒，允许跳过）', `return document.querySelector('#skipv').classList.contains('show');`, (v) => v === true);
await check('天台视频播放时结局卡还没出现（先走完，再浮现文字）', `return document.querySelector('#endcard').classList.contains('show');`, (v) => v === false);
await check('天台视频阶段画面在推进（currentTime 有变化）',
  `return (async()=>{ const v=document.querySelector('#vid'); const a=v.currentTime; await new Promise(r=>setTimeout(r,1200)); const b=v.currentTime; return Math.abs(b-a) > 0.05; })()`,
  (v) => v === true);

/* 交棒时机：现在在「视频开始」那一刻就换（走出铁门 = 换世界），不再等 15 秒。
   此刻已过约 3 秒 → 铺底乐应已淡出停播，结尾曲应已进场。 */
await check('交棒时机：铺底乐已停播（不再等视频走完才换）', `return SND.probe().bgm.paused;`, (v) => v === true);
await check('交棒时机：结尾曲已在视频期间进场', `return SND.probe().endmusic.paused;`, (v) => v === false);

/* --- B 播完：停在末帧，视频不撤 --- */
await waitFor(`return document.querySelector('#vid').ended === true;`, '天台视频播完', 25000);
await check('播完后视频停在末帧（paused 且 ended）',
  `const v=document.querySelector('#vid'); return v.paused && v.ended;`, (v) => v === true);
await check('播完后视频仍未隐藏（末帧就是结局画面，不撤）', `return document.querySelector('#vid').classList.contains('show');`, (v) => v === true);
await check('播完后「点击跳过」提示已收起', `return document.querySelector('#skipv').classList.contains('show');`, (v) => v === false);

await waitFor(`return document.querySelector('#endcard').classList.contains('show');`, '天台结局卡', 8000);
await check('天台结局卡已显示', `return document.querySelector('#endcard').classList.contains('show');`, (v) => v === true);
await check('天台结局：底是暗色（#app 带 endlight —— 深夜城市）', `return document.querySelector('#app').className.includes('endlight');`, (v) => v === true);
await check('天台结局：天光底图已让位（#bg 不显示）', `return document.querySelector('#bg').classList.contains('show');`, (v) => v === false);

/* --- C 音乐落位 --- */
await sleep(3000);
await check('天台结局：BGM 音量为 0', `return SND.probe().bgm.volume;`, (v) => v < 0.02);
await check('天台结局：结尾曲进度在推进（>0）', `return SND.probe().endmusic.currentTime;`, (v) => v > 0);
await check('天台结局：结尾曲已淡入到目标音量（>0.3）', `return SND.probe().endmusic.volume;`, (v) => v > 0.3);
await check('天台结局：结尾曲不循环', `return SND.probe().endmusic.loop;`, (v) => v === false);
await check('天台结局：结尾曲时长约 69 秒', `return SND.probe().endmusic.duration;`, (v) => v > 60 && v < 80);
await cdp.shot('v13_天台_结局视频_结局卡');

/* 静音开关要同时管住结尾曲 */
await cdp.eval(`document.querySelector('#soundbtn').click(); return 1;`);
await sleep(1200);
await check('天台静音：结尾曲音量归零', `return SND.probe().endmusic.volume;`, (v) => v < 0.05);
await check('天台静音：结尾曲仍在播（只是没声）', `return SND.probe().endmusic.paused;`, (v) => v === false);
await cdp.eval(`document.querySelector('#soundbtn').click(); return 1;`);
await sleep(1600);
await check('天台取消静音：结尾曲音量恢复', `return SND.probe().endmusic.volume;`, (v) => v > 0.1);

/* 死亡路径：音效响，但音乐不停 */
await loadPage();
await cdp.eval(`document.querySelector('#start').click(); return 1;`);
await waitFor(`return SND.ready === true;`, '音频引擎已启动');
await cdp.eval(`if(vidDone!==null) document.querySelector('#stage').click(); return 1;`);
await waitFor(HAS_CHOICE, '开场选项');
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[0].click(); return 1;`);
await waitFor(HAS_CHOICE, '节点1');
await cdp.eval(`document.querySelectorAll('.choice:not(.disabled)')[1].click(); return 1;`); /* 看猫眼 → 死亡 */
await waitFor(`return SND.probe() && SND.probe().sfx.death >= 1;`, '死亡音效');
await check('死亡音效已触发', `return SND.probe().sfx.death;`, (v) => v >= 1);
await check('死亡时 BGM 仍在播（音乐不停）', `return SND.probe().bgm.paused;`, (v) => v === false);
await cdp.shot('v11_死亡_音效');


console.log('\n===== 页面 JS 异常 =====');
if (cdp.exceptions.length === 0) console.log('PASS  无 JS 异常');
else cdp.exceptions.forEach((e) => console.log('FAIL  异常: ' + e));

const bad = results.filter((r) => !r.ok);
console.log(`\n===== 合计 ${results.length} 项，失败 ${bad.length} 项 =====`);
if (bad.length) bad.forEach((b) => console.log('  ✗ ' + b.name));

try { cdp.ws.close(); } catch (e) {}
browser.kill();
await sleep(600);
process.exit(bad.length ? 1 : 0);
