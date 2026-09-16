# -*- coding: utf-8 -*-
"""
生成《回廊》BGM 选曲试听页：把 4 首候选曲 + 波形图内联成单文件 HTML。
输出：回廊/回廊_BGM选曲试听.html
"""
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # 回廊/
AUD = ROOT / "音频"
OUT = ROOT / "回廊_BGM选曲试听.html"

# 客观指标（ffprobe / ffmpeg astats 实测得出）
TRACKS = [
    {
        "no": "01",
        "file": "01_HorrorGameIntro.mp3",
        "wave": "dark_01_HorrorGameIntro.png",
        "title": "Horror Game Intro",
        "dur": "45.4 秒",
        "level": "-17.6 dB",
        "pulse": "0.91",
        "pulse_lv": 3,
        "verdict": "嗓门最大、起伏明显，像一段“开场预告”。单独听很有劲，但音量包络跳得比较大，铺成整篇背景会抢戏。",
        "tag": "",
        "tagcls": "",
    },
    {
        "no": "02",
        "file": "02_ShatteredMind.mp3",
        "wave": "dark_02_ShatteredMind.png",
        "title": "Shattered Mind",
        "dur": "36.9 秒",
        "level": "-23.2 dB",
        "pulse": "0.84",
        "pulse_lv": 2,
        "verdict": "最安静、也最短。氛围偏“耳鸣式的压抑”，但 37 秒太短，循环三遍后接缝会开始被耳朵抓住。",
        "tag": "",
        "tagcls": "",
    },
    {
        "no": "03",
        "file": "03_WelcomeToTheMansion.mp3",
        "wave": "dark_03_WelcomeToTheMansion.png",
        "title": "Welcome to the Mansion",
        "dur": "71.5 秒",
        "level": "-22.4 dB",
        "pulse": "0.62",
        "pulse_lv": 1,
        "verdict": "波动指数最低 = 最“平”的一首。没有鼓点，靠低频嗡鸣和零星高频音色推着走，最长且首尾干净 —— 最适合当整篇铺底的循环。",
        "tag": "当前已嵌入",
        "tagcls": "on",
    },
    {
        "no": "04",
        "file": "04_CityOfTheDisturbed.mp3",
        "wave": "dark_04_CityOfTheDisturbed.png",
        "title": "City of the Disturbed",
        "dur": "87.9 秒",
        "level": "-27.5 dB",
        "pulse": "1.16",
        "pulse_lv": 4,
        "verdict": "最长，但波动指数最高 —— 听得出来有节奏脉冲。这种曲子单放好听，一旦 loop，节拍点会一遍遍敲在同一个位置，最容易露馅。",
        "tag": "",
        "tagcls": "",
    },
]


def b64(p: Path) -> str:
    return base64.b64encode(p.read_bytes()).decode("ascii")


# ── 成品 BGM（03 三次淡接拼接版）────────────────────────────────
FEATURED = {
    "no": "00",
    "file": "回廊_BGM.mp3",
    "wave": "dark_00_回廊_BGM.png",
    "title": "回廊_BGM · 成品（当前整篇在用）",
    "dur": "3 分 31 秒",
    "level": "-22.4 dB",
    "pulse": "0.62",
    "pulse_lv": 1,
    "verdict": "把 03 号原曲用 1.5 秒淡接拼了三遍。重点听<b>接缝</b>：约 1:11 和 2:23 两处，如果听不出明显的“重启感”，说明这个拼接量够用了；听得出，我就再拼一遍到四段或换更长垫底。",
    "tag": "正在使用",
    "tagcls": "on",
}

# ── 真结局专属结尾曲（李自备素材）──────────────────────────────
ENDING = {
    "no": "E1",
    "file": "回廊_结尾曲.mp3",
    "wave": "dark_05_回廊_结尾曲.png",
    "title": "回廊_结尾曲 · 真结局「天台」专用",
    "dur": "1 分 09 秒",
    "level": "-20.6 dB",
    "pulse": "2.32",
    "pulse_lv": 4,
    "verdict": "只在真结局响一次、不循环。它<b>比四首候选都响、起伏大得多</b>（波动 2.32，候选里最高的 04 才 1.16）—— 因为这是叙事性收尾曲，有起承转合，本来就不是拿来铺底的。<br>重点听两件事：① 它跟上面 00 的衔接顺不顺（00 淡出，1.8 秒后它淡入，中间留了空拍）；② 它进来时会不会<b>突然响一截</b>。嫌吵我就把它的音量从 0.62 调到 0.45 左右。",
    "tag": "真结局",
    "tagcls": "on",
}


def build_card(t: dict) -> str:
    mp3 = "data:audio/mpeg;base64," + b64(AUD / t["file"])
    png = "data:image/png;base64," + b64(AUD / t["wave"])
    bars = "".join(
        '<i class="%s"></i>' % ("hl" if i <= t["pulse_lv"] else "")
        for i in range(1, 5)
    )
    tag = (
        '<span class="pill %s">%s</span>' % (t["tagcls"], t["tag"]) if t["tag"] else ""
    )
    return f"""
    <article class="card" data-track="{t['no']}">
      <header>
        <span class="no">{t['no']}</span>
        <h2>{t['title']}</h2>
        {tag}
      </header>
      <dl class="meta">
        <div><dt>时长</dt><dd>{t['dur']}</dd></div>
        <div><dt>平均电平</dt><dd>{t['level']}</dd></div>
        <div><dt>波动指数</dt><dd>{t['pulse']} <em class="bars" title="1=最平稳 4=节奏感最强">{bars}</em></dd></div>
      </dl>
      <img class="wave" src="{png}" alt="{t['title']} 波形图">
      <p class="verdict">{t['verdict']}</p>
      <div class="player">
        <button class="play" type="button" aria-label="播放 {t['title']}">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path class="ico-play" d="M8 5v14l11-7z"/>
            <path class="ico-pause" d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/>
          </svg>
        </button>
        <div class="bar"><div class="fill"></div></div>
        <span class="time">0:00</span>
      </div>
      <audio preload="metadata" src="{mp3}"></audio>
    </article>"""


TRACK_HTML = "\n".join(build_card(t) for t in TRACKS)
FEATURED_HTML = build_card(FEATURED)
ENDING_HTML = build_card(ENDING)

HTML = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>回廊 · BGM 选曲试听</title>
<style>
  :root {{
    --bg: #0b0f12;
    --panel: #131a1f;
    --panel2: #182128;
    --line: #26333c;
    --ink: #d7e2e6;
    --dim: #7d919b;
    --accent: #7fb0c0;
    --accent2: #c8a17a;
  }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; padding: 0; }}
  body {{
    background:
      radial-gradient(1200px 600px at 50% -200px, #16232b 0%, transparent 70%),
      var(--bg);
    color: var(--ink);
    font-family: "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", system-ui, sans-serif;
    line-height: 1.7;
    padding: 40px 22px 70px;
    -webkit-font-smoothing: antialiased;
  }}
  .wrap {{ max-width: 1080px; margin: 0 auto; }}
  .head {{ border-bottom: 1px solid var(--line); padding-bottom: 22px; margin-bottom: 26px; }}
  .kicker {{
    font-size: 12px; letter-spacing: .28em; text-transform: uppercase;
    color: var(--accent); margin: 0 0 10px;
  }}
  h1 {{ font-size: 27px; font-weight: 600; margin: 0 0 12px; letter-spacing: .02em; }}
  .head p {{ margin: 0; color: var(--dim); font-size: 14.5px; max-width: 62ch; }}
  .head b {{ color: var(--ink); font-weight: 600; }}

  .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }}
  @media (max-width: 820px) {{ .grid {{ grid-template-columns: 1fr; }} }}

  .sec {{
    font-size: 12px; letter-spacing: .2em; color: var(--dim);
    margin: 0 0 12px; padding-left: 11px; position: relative;
  }}
  .sec::before {{
    content: ""; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
    width: 3px; height: 13px; border-radius: 2px; background: var(--accent);
  }}
  .featgrid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: stretch; }}
  @media (max-width: 980px) {{ .featgrid {{ grid-template-columns: 1fr; }} }}

  .featured-wrap {{ margin-bottom: 30px; }}
  .featured-wrap .sec::before {{ background: var(--accent2); }}
  .featured-wrap .card {{
    border-color: #3d4f57;
    background: linear-gradient(180deg, #1d272e, #151d23);
  }}
  .featured-wrap .card:hover {{ border-color: #4c626c; }}
  .featured-wrap .no {{ color: var(--accent2); border-color: #4a3b2c; background: #1a1510; }}
  .featured-wrap h2 {{ font-size: 18px; }}
  .featured-wrap .verdict {{ color: #a8bcc4; }}
  .featured-wrap .verdict b {{ color: var(--accent2); font-weight: 600; }}

  .card {{
    background: linear-gradient(180deg, var(--panel2), var(--panel));
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 20px 20px 16px;
    transition: border-color .25s, transform .25s;
  }}
  .card:hover {{ border-color: #35474f; }}
  .card.playing {{ border-color: var(--accent); box-shadow: 0 0 0 1px rgba(127,176,192,.22), 0 12px 34px -18px rgba(127,176,192,.5); }}

  .card header {{ display: flex; align-items: center; gap: 11px; flex-wrap: wrap; }}
  .no {{
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    font-size: 13px; color: var(--accent);
    border: 1px solid #2b3d47; border-radius: 6px;
    padding: 1px 7px; background: #101820;
  }}
  .card h2 {{ font-size: 17px; font-weight: 600; margin: 0; flex: 1 1 auto; }}
  .pill {{
    font-size: 11.5px; letter-spacing: .04em;
    border-radius: 999px; padding: 2px 10px;
    border: 1px solid #2b3d47; color: var(--dim);
  }}
  .pill.on {{ color: #0e1519; background: var(--accent); border-color: var(--accent); font-weight: 600; }}

  .meta {{ display: flex; gap: 22px; margin: 13px 0 12px; flex-wrap: wrap; }}
  .meta > div {{ margin: 0; }}
  .meta dt {{ font-size: 11.5px; color: var(--dim); letter-spacing: .06em; }}
  .meta dd {{ margin: 1px 0 0; font-size: 14px; font-family: ui-monospace, Consolas, monospace; }}
  .bars {{ display: inline-flex; gap: 2px; margin-left: 6px; vertical-align: 1px; }}
  .bars i {{ width: 3px; background: #2c3b44; border-radius: 1px; display: block; }}
  .bars i:nth-child(1) {{ height: 6px; }}
  .bars i:nth-child(2) {{ height: 9px; }}
  .bars i:nth-child(3) {{ height: 12px; }}
  .bars i:nth-child(4) {{ height: 15px; }}
  .bars i.hl {{ background: var(--accent2); }}

  .wave {{
    width: 100%; height: 84px; object-fit: contain;
    background: #0c1216; border: 1px solid var(--line); border-radius: 7px;
    padding: 6px 8px; opacity: .82;
    transition: opacity .25s;
  }}
  .card.playing .wave {{ opacity: 1; }}

  .verdict {{ font-size: 13.5px; color: #9fb2ba; margin: 12px 0 14px; }}

  .player {{ display: flex; align-items: center; gap: 12px; }}
  .play {{
    width: 38px; height: 38px; flex: 0 0 38px;
    border-radius: 50%; cursor: pointer;
    border: 1px solid #33474f; background: #1a252c; color: var(--accent);
    display: grid; place-items: center; padding: 0;
    transition: background .2s, border-color .2s, transform .15s;
  }}
  .play:hover {{ background: #223139; border-color: var(--accent); }}
  .play:active {{ transform: scale(.94); }}
  .play svg {{ fill: currentColor; }}
  .play .ico-pause {{ display: none; }}
  .card.playing .play .ico-play {{ display: none; }}
  .card.playing .play .ico-pause {{ display: block; }}

  .bar {{
    flex: 1 1 auto; height: 5px; border-radius: 3px;
    background: #202c33; cursor: pointer; position: relative; overflow: hidden;
  }}
  .fill {{ width: 0%; height: 100%; background: linear-gradient(90deg, #4d7d8d, var(--accent)); border-radius: 3px; }}
  .time {{
    font-family: ui-monospace, Consolas, monospace;
    font-size: 12.5px; color: var(--dim); flex: 0 0 auto; min-width: 82px; text-align: right;
  }}

  footer {{
    margin-top: 34px; padding-top: 20px; border-top: 1px solid var(--line);
    color: var(--dim); font-size: 13px;
  }}
  footer code {{
    font-family: ui-monospace, Consolas, monospace;
    background: #101820; border: 1px solid var(--line);
    border-radius: 5px; padding: 1px 6px; color: var(--accent);
  }}
  footer p {{ margin: 0 0 8px; }}
</style>
</head>
<body>
<div class="wrap">

  <div class="head">
    <p class="kicker">Corridor · BGM Audition</p>
    <h1>《回廊》背景音乐 · 选曲试听</h1>
    <p>
      先听上面两张 —— <b>00</b> 是整篇铺底（循环播放），<b>E1</b> 是真结局专属（只响一次）。那才是现在真正在放的东西。
      再往下是四首候选原曲，都来自 <b>soundimage.org</b>（作者 Eric Matyas，<b>CC BY 4.0</b>，可商用、需署名 —— 署名已写在标题页底部）。
      点卡片里的圆钮试听，一次只会响一首。听完告诉我编号，我换素材重建。
    </p>
  </div>

  <p class="sec">现在在用的两条音轨 · 00 铺底 / E1 结尾</p>
  <div class="featured-wrap">
    <div class="featgrid">
{FEATURED_HTML}
{ENDING_HTML}
    </div>
  </div>

  <p class="sec">候选原曲 · 挑一首整篇铺底</p>
  <div class="grid">
{TRACK_HTML}
  </div>

  <footer>
    <p><b>“波动指数”是什么</b>：把整首曲子的音量包络切成上千段，算相邻段落的平均起伏。数字越小 = 越平、越像环境音，越经得起循环；数字越大 = 节奏脉冲越明显，loop 时越容易被听出接缝。</p>
    <p>整篇编排：<code>03</code> 的三次淡接拼接版（3:31）铺底循环 → 走到真结局「天台」时它 3.5 秒淡出，空 1.8 秒后 <code>E1</code> 结尾曲以 2.6 秒淡入接管 → 循环结局「循环」不切，铺底乐继续。</p>
  </footer>

</div>

<script>
(function () {{
  var cards = Array.prototype.slice.call(document.querySelectorAll(".card"));

  function fmt(s) {{
    if (!isFinite(s)) return "0:00";
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ":" + (r < 10 ? "0" : "") + r;
  }}

  function label(cur, dur) {{
    return fmt(cur) + " / " + (isFinite(dur) && dur > 0 ? fmt(dur) : "--:--");
  }}

  function stopAll(except) {{
    cards.forEach(function (c) {{
      if (c === except) return;
      var a = c.querySelector("audio");
      a.pause();
      c.classList.remove("playing");
    }});
  }}

  cards.forEach(function (card) {{
    var audio = card.querySelector("audio");
    var btn   = card.querySelector(".play");
    var bar   = card.querySelector(".bar");
    var fill  = card.querySelector(".fill");
    var time  = card.querySelector(".time");

    btn.addEventListener("click", function () {{
      if (audio.paused) {{ stopAll(card); audio.play().catch(function () {{}}); }}
      else {{ audio.pause(); }}
    }});

    audio.addEventListener("play",  function () {{ card.classList.add("playing"); }});
    audio.addEventListener("pause", function () {{ card.classList.remove("playing"); }});
    audio.addEventListener("ended", function () {{ card.classList.remove("playing"); fill.style.width = "0%"; time.textContent = label(0, audio.duration); }});

    /* 元数据同步：不能只靠 loadedmetadata 事件 ——
       <audio> 在 body 里用 src 属性声明，data URI 没有网络延迟，
       事件可能在末尾这段脚本挂上监听之前就已经触发过了（实测只有最后一条能收到）。
       所以额外主动补读一次，并兼容 durationchange。 */
    function syncMeta(){{
      if (audio.readyState >= 1 || (isFinite(audio.duration) && audio.duration > 0)) {{
        time.textContent = label(audio.currentTime || 0, audio.duration);
      }}
    }}
    time.textContent = label(0, NaN);
    audio.addEventListener("loadedmetadata", syncMeta);
    audio.addEventListener("durationchange", syncMeta);
    syncMeta();
    audio.addEventListener("canplay", syncMeta);
    audio.addEventListener("timeupdate", function () {{
      if (audio.duration) fill.style.width = (audio.currentTime / audio.duration * 100) + "%";
      time.textContent = label(audio.currentTime, audio.duration);
    }});

    bar.addEventListener("click", function (e) {{
      var r = bar.getBoundingClientRect();
      if (audio.duration) audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
    }});
  }});
}})();
</script>
</body>
</html>
"""

OUT.write_text(HTML, encoding="utf-8")
print("OK ->", OUT, round(OUT.stat().st_size / 1048576, 2), "MB")
