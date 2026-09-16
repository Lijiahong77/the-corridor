"""把《回廊》的图片与视频内嵌成自包含单页原型。

用法： python build.py
产出： 回廊\回廊_互动原型.html   （双击即玩，不依赖网络与外部素材）
"""
import base64, pathlib, sys

root = pathlib.Path(r"C:\Users\lijia\WorkBuddy\AI互动影游\回廊")
tpl_path = root / "_build" / "template.html"
imgdir = root / "画面"

MIME = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "webp": "image/webp", "mp4": "video/mp4", "webm": "video/webm",
    "mp3": "audio/mpeg",
}

tpl = tpl_path.read_text(encoding="utf-8")


def data_uri(name: str, sub: str = "画面") -> str:
    p = root / sub / name
    if not p.exists():
        print("MISSING:", p); sys.exit(1)
    b = p.read_bytes()
    ext = p.suffix.lower().lstrip(".")
    mime = MIME.get(ext)
    if not mime:
        print("UNKNOWN MIME for:", p); sys.exit(1)
    print(f"  - {name:44s} {len(b)/1024:8.1f} KB  -> {mime}")
    return f"data:{mime};base64," + base64.b64encode(b).decode("ascii")


print("[素材]")
repl = {
    "__IMG_CHAR__": data_uri("主角定妆.jpg"),
    "__IMG_M1__":   data_uri("镜01_醒来_回廊.jpg"),
    "__IMG_M2__":   data_uri("镜02_敲门.jpg"),
    "__IMG_M3__":   data_uri("镜03_书房照片.jpg"),
    "__IMG_M4__":   data_uri("镜04_电梯.jpg"),
    # d1 死亡专图：原文案「门外的走廊是空的」，不能复用 m2（门外有双脚逼近）
    "__IMG_M5__":   data_uri("镜05_猫眼空走廊.jpg"),
    # 视频：只有"变化即剧情信息"的镜头才做
    #   v1 = 镜01 醒来（开场，推镜版）
    #   v2 = 镜02 敲门（n1 进入画面：门外那双脚逼近）
    #   v4 = 镜04 电梯（循环结局过场）
    "__VID_M1__":   data_uri("镜01_醒来_推镜版.mp4"),
    "__VID_M2__":   data_uri("镜02_敲门_逼近.mp4"),
    "__VID_M4__":   data_uri("镜04_电梯_cogvideox-flash.mp4"),
    # 真结局「天台」视频（李自备素材，2026-09-16 接入）：
    #   1280x720 / 24fps / 15s / 自带空音轨（#vid 是 muted，不播）
    #   内容是「从昏暗楼道走出去、视野逐渐开阔」→ 播一次、停末帧、结局卡压上去
    "__VID_ZJ__":   data_uri("镜06_真结局_天台.mp4"),
    #   v6 = 镜06 真结局 天台（李自备。1280x720 / 24fps / 15s，播一次、停在末帧）
    # __VID_M5__ 已弃用：常驻循环版天台视频被李自备的 v6 取代
    # 背景音乐（真实素材，CC BY 4.0）：音频/回廊_BGM.mp3
    #   曲目 Eric Matyas - "Welcome to the Mansion"，三遍 acrossfade 拼成 3.5 分钟
    "__BGM__":      data_uri("回廊_BGM.mp3", "音频"),
    # 真结局「天台」专属结尾曲（李自备素材）：音频/回廊_结尾曲.mp3，只响一次不循环
    "__ENDMUSIC__": data_uri("回廊_结尾曲.mp3", "音频"),
}

for k, v in repl.items():
    if k not in tpl:
        print("PLACEHOLDER NOT FOUND:", k); sys.exit(1)
    tpl = tpl.replace(k, v)

out = root / "回廊_互动原型.html"
out.write_text(tpl, encoding="utf-8")
print("\n[产出]", out)
print("大小: %.2f MB" % (len(tpl.encode("utf-8")) / 1024 / 1024))
