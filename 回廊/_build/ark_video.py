#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""火山方舟 Seedance 视频生成（支持图生视频 / 首帧锁定）

用法示例（注意：路径用正斜杠更省事）：
    python ark_video.py --prompt "镜头缓慢向前推近..." \
        --first-frame "https://example.com/a.jpg" \
        --out "C:/Users/lijia/WorkBuddy/AI互动影游/回廊/画面/镜04_电梯_demo.mp4"

API Key 读取顺序：环境变量 ARK_API_KEY → 项目内 _secrets/ark_key.txt（单行）
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PROJECT = r"C:\Users\lijia\WorkBuddy\AI互动影游"
KEY_FILE = os.path.join(PROJECT, "_secrets", "ark_key.txt")
TASKS = "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"


def load_key():
    key = os.environ.get("ARK_API_KEY", "").strip()
    if key:
        return key
    if os.path.isfile(KEY_FILE):
        with open(KEY_FILE, encoding="utf-8") as f:
            key = f.read().strip()
        if key:
            return key
    sys.exit("找不到 API Key。请把 Key 存进 " + KEY_FILE + "（单行），或设置环境变量 ARK_API_KEY。")


def request_json(method, url, key, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + key)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        sys.exit("接口返回 HTTP %s：%s" % (e.code, body))


def download(url, path):
    folder = os.path.dirname(os.path.abspath(path))
    if folder:
        os.makedirs(folder, exist_ok=True)
    with urllib.request.urlopen(url, timeout=600) as resp, open(path, "wb") as out:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="doubao-seedance-2-0-260128")
    p.add_argument("--prompt", required=True, help="只写动作和运镜，不要重复描述画面")
    p.add_argument("--first-frame", default=None, help="首帧图的公网 URL（图生视频用）")
    p.add_argument("--ratio", default="16:9", choices=["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"])
    p.add_argument("--resolution", default="720p", choices=["480p", "720p", "1080p"])
    p.add_argument("--duration", type=int, default=5, help="2.0 系列取值 4-15")
    p.add_argument("--audio", default="off", choices=["on", "off"], help="是否带同步音频")
    p.add_argument("--timeout", type=int, default=1800, help="轮询上限（秒）")
    p.add_argument("--out", required=True, help="成品 mp4 的保存路径")
    args = p.parse_args()

    key = load_key()

    content = [{"type": "text", "text": args.prompt}]
    if args.first_frame:
        content.append({
            "type": "image_url",
            "image_url": {"url": args.first_frame},
            "role": "first_frame",
        })

    payload = {
        "model": args.model,
        "content": content,
        "ratio": args.ratio,
        "resolution": args.resolution,
        "duration": args.duration,
        "watermark": False,
        "generate_audio": args.audio == "on",
    }

    created = request_json("POST", TASKS, key, payload)
    task_id = created.get("id")
    if not task_id:
        sys.exit("提交未返回任务 ID：" + json.dumps(created, ensure_ascii=False))
    print("任务已提交：" + task_id)

    deadline = time.time() + args.timeout
    while time.time() < deadline:
        time.sleep(10)
        info = request_json("GET", TASKS + "/" + task_id, key)
        status = info.get("status")
        print("  状态：" + str(status))
        if status == "succeeded":
            url = (info.get("content") or {}).get("video_url")
            if not url:
                sys.exit("任务成功但没返回 video_url：" + json.dumps(info, ensure_ascii=False))
            download(url, args.out)
            print("已下载：" + args.out)
            print("提示：方舟侧视频 URL 只活 24 小时，本地这份才是长期留存。")
            return
        if status in ("failed", "cancelled", "expired"):
            sys.exit("任务终止：" + json.dumps(info, ensure_ascii=False))

    sys.exit("轮询超时（%s 秒），任务可能仍在跑，可稍后用同一 ID 复查。" % args.timeout)


if __name__ == "__main__":
    main()
