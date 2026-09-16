"""程序化环顾视频工厂 —— 把一张静态天台图变成「人站在天台上左右环顾」的循环视频。

为什么不用图生视频模型的运镜？
  实测（智谱 cogvideox-flash，2026-09-16）：
    · 写「镜头缓慢水平转动」→ 几乎不动（帧间差 0.683，读作静止）
    · 写「明确向右摇摄」→ 动了但有 1.5 秒周期的来回振荡，像抽搐不像转头，
      而且位移幅度无法控制（前后两次同提示词结果差很多）
    · 无景深/无视差，看起来是「画面在漂」而不是「人在转头」
  所以环顾这种**需要精确、平滑、可循环**的运动，改用「超宽图 + 程序化平移」：
    · TapNow 出图固定 2560x1440，裁 1920x1080 窗口后左右各有 320px 余量（25%）
    · 平移用余弦驱动 → 两端自然减速，像人转头时到头会缓一下
    · 余弦在 t=0 与 t=D 取值相同 → 首尾像素级闭合，循环天然无缝

用法：
  python make_pan_video.py --image <源图.jpg> --out <输出.mp4> [--duration 22]
                           [--yaw 1.0] [--sway 5] [--fps 30] [--crf 21]

  --yaw    左右摆幅系数，1.0 = 用满整幅余量（320px）；0.6 = 只摆 60%，更克制
  --sway   y 轴手持浮动像素（默认 5，模拟呼吸/重心微动）
"""
import argparse
import subprocess
import sys
import time
from pathlib import Path

FFMPEG = r"C:\Users\lijia\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe"
FFPROBE = r"C:\Users\lijia\AppData\Local\Microsoft\WinGet\Links\ffprobe.exe"

OUT_W, OUT_H = 1920, 1080


def probe_size(path: Path):
    r = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, encoding="utf-8")
    w, h = r.stdout.strip().split(",")
    return int(w), int(h)


def build(image: Path, out: Path, duration: float, yaw: float, sway: float,
          fps: int, crf: int) -> bool:
    sw, sh = probe_size(image)
    margin_x = (sw - OUT_W) / 2.0
    margin_y = (sh - OUT_H) / 2.0

    if margin_x <= 0 or margin_y <= 0:
        print(f"[FATAL] 源图 {sw}x{sh} 比目标 {OUT_W}x{OUT_H} 小，没有平移余量")
        return False

    amp_x = margin_x * yaw
    cx = margin_x                      # x 的摆动中心
    cy = margin_y                      # y 的摆动中心
    # 余弦：t=0 时取最小值(-amp)，t=duration 时回到同一值 → 首尾闭合
    # 用 cos(2*pi*t/D) 而非 sin，保证 t=0 与 t=D 完全同相位
    vx = "%g+%g*cos(2*PI*t/%.4f)" % (cx, amp_x, duration)
    # y 轴用不同频率的微抖，避免与 x 同相（同相会像「斜着平移」而不像手持）
    vy = "%.1f+%.1f*sin(2*PI*t/%.3f)" % (cy, sway / 2.0, duration / 3.7)
    vf = "crop=%d:%d:x='%s':y='%s',format=yuv420p" % (OUT_W, OUT_H, vx, vy)

    cmd = [FFMPEG, "-y", "-v", "error",
           "-loop", "1", "-framerate", str(fps), "-i", str(image),
           "-t", "%.3f" % duration,
           "-vf", vf, "-an",
           "-c:v", "libx264", "-crf", str(crf), "-preset", "medium",
           "-pix_fmt", "yuv420p", "-r", str(fps), "-movflags", "+faststart",
           str(out)]

    print("[INFO] 源图 %dx%d  平移余量 x=±%.0fpx (%.0f%%)  y=±%.0fpx"
          % (sw, sh, margin_x, margin_x / sw * 100, margin_y))
    print("[INFO] 摆幅 = %.0f%%  时长 %.1fs  %dfps" % (yaw * 100, duration, fps))
    t0 = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        print("[FAIL]", r.stderr[:800])
        return False
    print("[OK] %.1fs 完成 → %s（%.2f MB）"
          % (time.time() - t0, out.name, out.stat().st_size / 1048576))
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True, help="源图（建议 2560x1440）")
    ap.add_argument("--out", required=True, help="输出 mp4")
    ap.add_argument("--duration", type=float, default=22.0, help="一个完整往return 的秒数")
    ap.add_argument("--yaw", type=float, default=1.0, help="摆幅系数 0~1")
    ap.add_argument("--sway", type=float, default=5.0, help="y 轴手持浮动像素")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--crf", type=int, default=21)
    a = ap.parse_args()

    image, out = Path(a.image), Path(a.out)
    if not image.exists():
        print("[FATAL] 源图不存在:", image)
        sys.exit(1)
    out.parent.mkdir(parents=True, exist_ok=True)
    if not build(image, out, a.duration, a.yaw, a.sway, a.fps, a.crf):
        sys.exit(1)


if __name__ == "__main__":
    main()
