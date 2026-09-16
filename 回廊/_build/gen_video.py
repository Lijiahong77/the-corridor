#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《回廊》图生视频生成器 —— 支持两家「不用预充值」的国内 API

用法：
  python gen_video.py --provider zhipu  --key-file _secrets/zhipu_key.txt --image "..../镜04_电梯.jpg" --prompt "..."
  python gen_video.py --provider bailian --key-file _secrets/dashscope_key.txt --image "..." --prompt "..."

设计要点：
  1. 首帧锁图：本地图片直接 base64 内联，不需要公网 URL、不需要对象存储
  2. 异步提交 + 自动轮询 + 成功即下载到本地（两家结果 URL 都只活 24 小时）
  3. 智谱的 base64 前缀兼容两种写法，一种失败自动换另一种重试
"""

import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request

# ---------------------------------------------------------------- 基础工具

def die(msg, code=1):
    print(f"[FAIL] {msg}", file=sys.stderr)
    sys.exit(code)


def http_json(url, payload=None, headers=None, method=None, timeout=90):
    """极简 HTTP JSON 客户端：只用标准库，不装任何依赖。返回 (status, dict)。"""
    data = None
    hdrs = dict(headers or {})
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=hdrs,
                                 method=method or ("POST" if data else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(body)
            except json.JSONDecodeError:
                return r.status, {"_raw": body}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, {"_raw": body}
    except Exception as e:
        return 0, {"_error": str(e)}


def read_key(path, env_name):
    """优先从文件读 Key；没有就走环境变量。避免 Key 出现在对话/命令行历史里。"""
    if path and os.path.isfile(path):
        with open(path, "r", encoding="utf-8-sig") as f:
            k = f.read().strip().strip('"').strip("'")
            if k:
                return k
    k = os.environ.get(env_name, "").strip()
    if k:
        return k
    die(f"没找到 API Key。请把 Key 写进文件：{path}\n"
        f"        （单行纯文本，只要 Key 本身，不要引号、不要变量名）")


def encode_image(path, mode):
    """把本地图片编码成 API 能吃的字符串。
    mode=raw     -> 纯 base64
    mode=datauri -> data:image/jpeg;base64,xxxx
    """
    if not os.path.isfile(path):
        die(f"图片不存在：{path}")
    size_mb = os.path.getsize(path) / 1024 / 1024
    if size_mb > 5:
        print(f"[WARN] 图片 {size_mb:.1f}MB，智谱要求 ≤5MB，可能会被拒")
    mime = mimetypes.guess_type(path)[0] or "image/jpeg"
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return (f"data:{mime};base64,{b64}" if mode == "datauri" else b64)


def download(url, out_path):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=180) as r, open(out_path, "wb") as f:
        f.write(r.read())
    return os.path.getsize(out_path)


# ---------------------------------------------------------------- 智谱 CogVideoX-Flash（免费）

ZHIPU_BASE = "https://open.bigmodel.cn/api/paas/v4"


def zhipu_submit(key, model, prompt, img_b64, size, duration, fps, with_audio,
                 watermark=True):
    url = f"{ZHIPU_BASE}/videos/generations"
    body = {
        "model": model,
        "prompt": prompt,
        "image_url": img_b64,
        "size": size,
        "duration": duration,
        "fps": fps,
        "with_audio": with_audio,
        "watermark": watermark,
    }
    return http_json(url, body, {"Authorization": f"Bearer {key}"})


def zhipu_poll(key, task_id):
    url = f"{ZHIPU_BASE}/async-result/{task_id}"
    return http_json(url, None, {"Authorization": f"Bearer {key}"})


def run_zhipu(args, key):
    prompt = args.prompt
    # 智谱的 base64 前缀两种写法历史上都出现过，先按 raw 试，报错就换 datauri 重试
    modes = ["raw", "datauri"] if args.b64mode == "auto" else [args.b64mode]
    last = None
    for mode in modes:
        img = encode_image(args.image, mode)
        print(f"[INFO] 智谱提交中（base64 模式={mode}，图 {len(img)//1024}KB）…")
        st, resp = zhipu_submit(key, args.model, prompt, img,
                                args.size, args.duration, args.fps, args.audio,
                                args.watermark)
        print(f"[INFO] HTTP {st} -> {json.dumps(resp, ensure_ascii=False)[:400]}")
        task_id = resp.get("id") or resp.get("request_id") or (resp.get("data") or {}).get("id")
        if st == 200 and task_id:
            return poll_and_fetch(args, task_id,
                                  lambda tid: zhipu_poll(key, tid),
                                  lambda r: (r.get("video_result") or [{}])[0].get("url"))
        last = (st, resp)
        if st != 200:
            print(f"[WARN] 该 base64 模式被拒，尝试下一种…")
    die(f"智谱提交失败：{last}")


# ---------------------------------------------------------------- 阿里云百炼 通义万相

BAILIAN_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"
BAILIAN_TASK = "https://dashscope.aliyuncs.com/api/v1/tasks"


def bailian_submit(key, model, prompt, img_url, resolution, duration):
    body = {
        "model": model,
        "input": {"prompt": prompt, "img_url": img_url},
        "parameters": {"resolution": resolution, "duration": duration,
                       "prompt_extend": True, "watermark": False},
    }
    return http_json(BAILIAN_URL, body,
                     {"Authorization": f"Bearer {key}", "X-DashScope-Async": "enable"})


def bailian_poll(key, task_id):
    return http_json(f"{BAILIAN_TASK}/{task_id}", None, {"Authorization": f"Bearer {key}"})


def run_bailian(args, key):
    img = encode_image(args.image, "datauri")
    print(f"[INFO] 百炼提交中（{args.model}，图 {len(img)//1024}KB）…")
    st, resp = bailian_submit(key, args.model, args.prompt, img, args.resolution, args.duration)
    print(f"[INFO] HTTP {st} -> {json.dumps(resp, ensure_ascii=False)[:400]}")
    task_id = (resp.get("output") or {}).get("task_id")
    if st != 200 or not task_id:
        die(f"百炼提交失败：{resp}")
    return poll_and_fetch(args, task_id,
                          lambda tid: bailian_poll(key, tid),
                          lambda r: (r.get("output") or {}).get("video_url"))


# ---------------------------------------------------------------- 通用轮询 + 落盘

def poll_and_fetch(args, task_id, poll_fn, extract_fn):
    print(f"[INFO] 任务已创建：{task_id}")
    print(f"[INFO] 轮询中（每 {args.interval}s 一次，最长 {args.timeout}s）…")
    t0 = time.time()
    while time.time() - t0 < args.timeout:
        time.sleep(args.interval)
        st, resp = poll_fn(task_id)
        status = str(resp.get("task_status") or (resp.get("output") or {}).get("task_status") or "")
        elapsed = int(time.time() - t0)
        print(f"  [{elapsed:>4}s] status={status or '?'}")
        if status.upper() in ("SUCCESS", "SUCCEEDED"):
            url = extract_fn(resp)
            if not url:
                die(f"任务成功但没找到视频 URL：{json.dumps(resp, ensure_ascii=False)[:500]}")
            os.makedirs(args.outdir, exist_ok=True)
            name = args.outname or (os.path.splitext(os.path.basename(args.image))[0] + f"_{args.model}.mp4")
            out = os.path.join(args.outdir, name)
            n = download(url, out)
            print(f"[OK] 已下载：{out}（{n/1024/1024:.1f}MB）")
            print(f"[OK] 源地址（24 小时后失效）：{url[:120]}…")
            return out
        if status.upper() in ("FAIL", "FAILED"):
            print(f"[FAIL] 生成失败：{json.dumps(resp, ensure_ascii=False)[:600]}")
            sys.exit(2)
    die(f"超时（{args.timeout}s）未出片，任务 {task_id} 仍在跑，可稍后用同一 id 查询")


# ---------------------------------------------------------------- 入口

def main():
    p = argparse.ArgumentParser(description="《回廊》图生视频生成器")
    p.add_argument("--provider", choices=["zhipu", "bailian"], required=True)
    p.add_argument("--key-file", default=None, help="存 API Key 的文本文件路径")
    p.add_argument("--image", required=True, help="首帧图（本地路径）")
    p.add_argument("--prompt", required=True, help="只写「动作 + 运镜」，不要重复描述画面")
    p.add_argument("--outdir", default=r"C:\Users\lijia\WorkBuddy\AI互动影游\回廊\画面")
    p.add_argument("--outname", default=None)
    p.add_argument("--interval", type=int, default=10, help="轮询间隔秒")
    p.add_argument("--timeout", type=int, default=900, help="总等待上限秒")
    # 智谱专属
    p.add_argument("--model", default=None)
    p.add_argument("--size", default="1920x1080")
    p.add_argument("--duration", type=int, default=5)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--audio", action="store_true", help="生成 AI 音效")
    p.add_argument("--no-watermark", dest="watermark", action="store_false",
                   help="尝试关闭「AI生成」水印（智谱需账号已签去水印免责声明，否则无效）")
    p.set_defaults(watermark=True)
    p.add_argument("--b64mode", choices=["auto", "raw", "datauri"], default="auto")
    # 百炼专属
    p.add_argument("--resolution", default="720P")
    args = p.parse_args()

    if args.provider == "zhipu":
        key = read_key(args.key_file or r"C:\Users\lijia\WorkBuddy\AI互动影游\_secrets\zhipu_key.txt",
                       "ZHIPU_API_KEY")
        args.model = args.model or "cogvideox-flash"
        print(f"[INFO] provider=智谱  模型={args.model}  免费档")
        run_zhipu(args, key)
    else:
        key = read_key(args.key_file or r"C:\Users\lijia\WorkBuddy\AI互动影游\_secrets\dashscope_key.txt",
                       "DASHSCOPE_API_KEY")
        args.model = args.model or "wan2.6-i2v-flash"
        print(f"[INFO] provider=阿里云百炼  模型={args.model}")
        run_bailian(args, key)


if __name__ == "__main__":
    main()
