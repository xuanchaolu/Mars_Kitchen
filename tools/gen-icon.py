#!/usr/bin/env python3
"""生成 火星小厨房（火星小厨房）应用图标与界面 logo

用法:
    python3 tools/gen-icon.py [源图]        # 默认优先用 火星小厨房AI.png（透明底），
                                            # 其次 logo.png / logo.PNG / logo.jpg

做什么（两种源图自动分流）:
A. 不透明源（JPG / 带底色的 PNG）——原有管线:
   - 估出图片四边的底色（不限于纯白，也支持米白/灰白等有色底）
   - 从四边做连通域泛洪：只抠掉与画布边缘相连的底色，保留 logo 内部的浅色细节
   - 边缘做「颜色反混合」（unmatting）：按像素实际颜色反推 alpha 并还原前景色，
     消除抗锯齿像素残留的底色描边/白边（在深色底上也不会发亮）
B. 透明底源（RGBA/LA，自带 alpha）——新增管线:
   - 不做底色估计、不做反混合，直接沿用源图 alpha（透明底已经是最终形态）
   - 清理 alpha 噪点（极小透明/极小不透明块），裁剪到不透明区域的 bbox
C. 两种源共用:
   - 等比放入 1024 画布（内容占 92%）；RGBA 缩放交给 Pillow（≥10 已是 alpha 感知的重采样）
   - 输出: build/AppIcon.iconset/*、build/AppIcon.icns（调用方 iconutil）、
           build/icon-preview.png、build/icon-preview-checker.png、
           renderer/assets/logo.png、renderer/assets/logo-128.png

依赖: numpy, Pillow（scipy 可选，用于连通域与距离变换加速）
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANVAS = 1024
SCALE = 0.92          # 内容占画布比例
BG_BAND = 8           # 取四边多少像素带宽来估计底色
BG_THRESH = 16.0      # 与底色的距离小于该值视为「底色像素」
CORE_RADIUS = 3       # 距离底色 >= 该像素数的区域视为确定前景（不做柔化）
MIN_BLOB = 24         # 小于该面积的独立前景块视为噪点丢弃
ALPHA_LO = 8          # alpha 低于该值视为全透明
ALPHA_HI = 247        # alpha 高于该值视为完全不透明


def pick_source(argv):
    if len(argv) > 1 and argv[1].strip():
        p = os.path.abspath(os.path.expanduser(argv[1]))
        if not os.path.exists(p):
            raise SystemExit('找不到源图: %s' % p)
        return p
    for name in ('火星小厨房AI.png', 'logo.png', 'logo.PNG', 'logo.jpg', 'logo.jpeg'):
        p = os.path.join(ROOT, name)
        if os.path.exists(p):
            return p
    raise SystemExit('在 %s 下找不到 火星小厨房AI.png / logo.png / logo.jpg' % ROOT)


def source_has_alpha(path):
    """源图是否自带可用的透明通道（透明像素占比 > 1%）"""
    im = Image.open(path)
    if im.mode not in ('RGBA', 'LA', 'PA') and 'transparency' not in im.info:
        return False
    a = np.asarray(im.convert('RGBA')).astype(np.uint8)[:, :, 3]
    return float((a < ALPHA_LO).mean()) > 0.01



def estimate_bg(arr):
    """用四边像素带的中位数估计底色"""
    band = BG_BAND
    ring = np.concatenate([
        arr[:band].reshape(-1, 3), arr[-band:].reshape(-1, 3),
        arr[:, :band].reshape(-1, 3), arr[:, -band:].reshape(-1, 3),
    ])
    return np.median(ring, axis=0)


def distance_to_bg(arr, bg):
    return np.sqrt(((arr - bg) ** 2).sum(axis=2))


def connected_bg(near):
    """与画布四边相连的底色区域（保留 logo 内部同色细节）"""
    try:
        from scipy import ndimage
        lab, n = ndimage.label(near)
        if n == 0:
            return np.zeros_like(near)
        border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        border = border[border != 0]
        return np.isin(lab, border)
    except ImportError:
        # 纯 PIL 兜底：在标记图上从四边泛洪
        h, w = near.shape
        img = Image.fromarray(np.where(near, 0, 255).astype(np.uint8), 'L')
        for x in range(0, w, 4):
            for seed in ((x, 0), (x, h - 1)):
                if img.getpixel(seed) == 0:
                    ImageDraw.floodfill(img, seed, 128, thresh=0)
        for y in range(0, h, 4):
            for seed in ((0, y), (w - 1, y)):
                if img.getpixel(seed) == 0:
                    ImageDraw.floodfill(img, seed, 128, thresh=0)
        return np.array(img) == 128


def despeckle(mask):
    """丢弃面积过小的独立前景块（JPEG 噪点）"""
    try:
        from scipy import ndimage
        lab, n = ndimage.label(mask)
        if n <= 1:
            return mask
        sizes = np.bincount(lab.ravel())
        keep = sizes >= MIN_BLOB
        keep[0] = False
        return keep[lab]
    except ImportError:
        return mask


def unmix_edges(arr, bg, bgmask):
    """反混合边缘：返回 (rgb, alpha)

    对靠近底色的前景像素，用「观测色 = a*前景色 + (1-a)*底色」反解 alpha，
    并把前景色还原出来，避免把底色描边留在图像里。
    """
    h, w, _ = arr.shape
    d = distance_to_bg(arr, bg)
    fg = ~bgmask

    # 距离底色足够远 = 确定前景（颜色保持原样）
    dist_fg = None
    try:
        from scipy import ndimage
        dist_fg = ndimage.distance_transform_edt(fg)
        core = fg & (dist_fg >= CORE_RADIUS)
        if core.any():
            _, inds = ndimage.distance_transform_edt(~core, return_indices=True)
            nearest = arr[inds[0], inds[1]]
        else:
            core = fg
            nearest = arr
    except ImportError:
        from PIL import ImageFilter
        core = np.array(Image.fromarray((fg * 255).astype(np.uint8), 'L')
                        .filter(ImageFilter.MinFilter(2 * CORE_RADIUS + 1))) > 127
        nearest = np.zeros_like(arr)
        known = core.copy()
        nearest[known] = arr[known]
        for _ in range(CORE_RADIUS + 2):        # 迭代把前景色播撒到边缘带
            for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1)):
                rolled_c = np.roll(known, shift, axis=axis)
                rolled_v = np.roll(nearest, shift, axis=axis)
                if axis == 0:
                    if shift == 1:
                        rolled_c[0] = False
                    else:
                        rolled_c[-1] = False
                else:
                    if shift == 1:
                        rolled_c[:, 0] = False
                    else:
                        rolled_c[:, -1] = False
                take = rolled_c & ~known
                known |= take
                nearest[take] = rolled_v[take]

    v = arr - bg
    u = nearest - bg
    den = (u * u).sum(axis=2)
    proj = (v * u).sum(axis=2) / np.where(den < 1e-6, 1.0, den)
    alpha_proj = np.clip(proj, 0.0, 1.0)

    if dist_fg is None:                     # scipy 缺失时的几何渐变兜底
        try:
            from scipy import ndimage
            dist_fg = ndimage.distance_transform_edt(fg)
        except ImportError:
            outside = ~fg
            dist_fg = np.zeros_like(alpha_proj)
            step = 0
            cur = fg.copy()
            while cur.any() and step < 64:
                step += 1
                nxt = cur & ~outside
                dist_fg[nxt] = step
                outside |= cur
                grown = cur.copy()
                for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1)):
                    r = np.roll(cur, shift, axis=axis)
                    if axis == 0:
                        if shift == 1:
                            r[0] = False
                        else:
                            r[-1] = False
                    else:
                        if shift == 1:
                            r[:, 0] = False
                        else:
                            r[:, -1] = False
                    grown |= r
                cur = grown & fg
    alpha_geom = np.clip(dist_fg / CORE_RADIUS, 0.0, 1.0)

    # 前景色本身接近底色时投影法不可靠，退回几何渐变
    alpha = np.where(den < 900.0, alpha_geom, alpha_proj)
    alpha = np.where(bgmask, 0.0, np.where(core, 1.0, alpha))

    safe = np.maximum(alpha, 1e-3)[..., None]
    unmixed = np.clip(bg + v / safe, 0, 255)
    rgb = np.where(core[..., None], arr, unmixed)

    # 边缘带内 alpha 轻度平滑，压掉 JPEG 噪点造成的锯齿
    try:
        from scipy import ndimage
        blur = ndimage.gaussian_filter(alpha, 0.6)
        alpha = np.where(core, 1.0, np.where(bgmask, 0.0, np.maximum(alpha, np.minimum(blur, alpha + 0.25))))
    except ImportError:
        pass
    return rgb, alpha, d


def cutout(src):
    arr = np.asarray(Image.open(src).convert('RGB')).astype(np.float64)
    bg = estimate_bg(arr)
    d = distance_to_bg(arr, bg)
    bgmask = connected_bg(d < BG_THRESH)
    rgb, alpha, d = unmix_edges(arr, bg, bgmask)

    opaque = despeckle(alpha > 0.35)
    alpha = np.where(opaque | (alpha > 0.35), alpha, 0.0)

    print('底色估计: rgb(%d,%d,%d)' % tuple(int(x) for x in bg))
    print('抠除底色: 完全透明 %.1f%%，半透明边缘 %.2f%%'
          % (100 * (alpha < 0.02).mean(), 100 * ((alpha >= 0.02) & (alpha < 0.98)).mean()))

    out = np.dstack([np.clip(rgb, 0, 255).astype(np.uint8),
                     np.clip(alpha * 255.0, 0, 255).astype(np.uint8)])
    return Image.fromarray(out, 'RGBA')


def trim(im, pad=2):
    bbox = im.getchannel('A').point(lambda p: 255 if p > 12 else 0).getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    return im.crop((max(0, l - pad), max(0, t - pad),
                    min(im.width, r + pad), min(im.height, b + pad)))


def from_transparent(src):
    """透明底源：直接沿用自带 alpha（透明底已经是最终形态，不做抠底/反混合）"""
    a = np.asarray(Image.open(src).convert('RGBA')).astype(np.float64)
    alpha = a[:, :, 3] / 255.0
    alpha = np.where(alpha < ALPHA_LO / 255.0, 0.0, alpha)      # 抹掉近全透明的噪点
    opaque = despeckle(alpha > 0.35)                            # 丢掉极小的独立不透明块
    alpha = np.where(opaque | (alpha > 0.35), alpha, 0.0)
    print('透明底源：直接沿用 alpha（不估底色、不反混合）')
    print('  完全透明 %.1f%%，半透明边缘 %.2f%%'
          % (100 * (alpha < 0.02).mean(), 100 * ((alpha >= 0.02) & (alpha < 0.98)).mean()))
    out = np.dstack([np.clip(a[:, :, :3], 0, 255).astype(np.uint8),
                     np.clip(alpha * 255.0, 0, 255).astype(np.uint8)])
    return Image.fromarray(out, 'RGBA')


def premultiplied_resize(im, size):
    """等比缩放到指定尺寸

    说明：这里刻意**不做**手工预乘。Pillow ≥ 10 的 RGBA 重采样本身就是 alpha 感知的，
    实测（Pillow 12）朴素 resize 与「先合成到底色再缩放」的参考图平均差仅 0.02/255，
    而手工「预乘 → clip 成 uint8 → 反预乘」会把 LANCZOS 的负振铃削成 0，
    在半透明边缘产生纯黑像素（黑边），小尺寸下误差反而放大到 5/255。
    函数名保留，便于与旧实现对照。
    """
    return im.convert('RGBA').resize(tuple(size), Image.LANCZOS)


def compose(im, canvas=CANVAS, scale=SCALE):
    w, h = im.size
    target = int(canvas * scale)
    k = target / max(w, h)
    nw, nh = max(1, int(round(w * k))), max(1, int(round(h * k)))
    resized = premultiplied_resize(im, (nw, nh))
    out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    out.paste(resized, ((canvas - nw) // 2, (canvas - nh) // 2), resized)
    return out


def check_alpha_icon(big):
    """透明底图标自检：四角必须透明、内容占比合理、内容居中、边缘不出现纯黑像素（黑边）"""
    a = np.asarray(big).astype(np.float64)
    al = a[:, :, 3] / 255.0
    h, w = al.shape
    corners = [float(al[0, 0]), float(al[0, -1]), float(al[-1, 0]), float(al[-1, -1])]
    bbox = Image.fromarray((al * 255).astype(np.uint8), 'L').point(lambda p: 255 if p > 12 else 0).getbbox()
    cov = float((al > 0.5).mean())
    cx, cy = (bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0
    print('自检: 四角 alpha=%s（应全为 0）' % [round(c, 3) for c in corners])
    print('自检: 内容占画布 %.1f%%，内容中心偏移 (%.1f, %.1f) 像素（应接近 0）'
          % (100 * cov, cx - w / 2.0, cy - h / 2.0))
    assert all(c < 0.01 for c in corners), '画布四角不透明：可能残留了底色背景'
    assert 0.15 < cov < 0.95, '内容占比异常: %.1f%%' % (100 * cov)
    assert abs(cx - w / 2.0) <= 6 and abs(cy - h / 2.0) <= 6, '内容没有居中'
    edge_rgb = a[:, :, :3][(al > 0.05) & (al < 0.95)]
    black = int((edge_rgb.sum(axis=1) < 12).sum())
    print('自检: 半透明边缘中的纯黑像素 %d 个（应为 0，>0 说明有黑边）' % black)
    assert black == 0, '边缘出现纯黑像素，可能存在黑边'


def checker_preview(big, path):
    """四宫格预览：原图 / 白底 / 深底 / 棋盘底，用于检查残留底色与白边"""
    n = big.width
    tile = n // 2
    sheet = Image.new('RGBA', (n, n), (255, 255, 255, 255))
    kit = Image.new('RGBA', (tile, tile), (255, 255, 255, 255))
    step = max(8, tile // 16)
    dr = ImageDraw.Draw(kit)
    for y in range(0, tile, step):
        for x in range(0, tile, step):
            if (x // step + y // step) % 2:
                dr.rectangle([x, y, x + step - 1, y + step - 1], fill=(190, 190, 190, 255))
    small = big.resize((tile, tile), Image.LANCZOS)
    sheet.paste(Image.new('RGBA', (tile, tile), (255, 255, 255, 255)), (0, 0))
    sheet.paste(small, (0, 0), small)                                  # 左上：白底
    sheet.paste(Image.new('RGBA', (tile, tile), (25, 25, 28, 255)), (tile, 0))
    sheet.paste(small, (tile, 0), small)                               # 右上：深底
    sheet.paste(kit, (0, tile))
    sheet.paste(small, (0, tile), small)                               # 左下：棋盘
    sheet.paste(Image.new('RGBA', (tile, tile), (0, 0, 0, 0)), (tile, tile))
    sheet.paste(small, (tile, tile), small)                            # 右下：透明
    sheet.convert('RGB').resize((n, n), Image.LANCZOS).save(path)


def main():
    src = pick_source(sys.argv)
    im = Image.open(src)
    print('源图: %s  %s  %s' % (src, im.size, im.format))

    alpha_source = source_has_alpha(src)
    if alpha_source:
        cut = from_transparent(src)
    else:
        cut = cutout(src)
    trimmed = trim(cut)
    print('裁剪后内容尺寸: %s' % (trimmed.size,))

    big = compose(trimmed)
    build_dir = os.path.join(ROOT, 'build')
    os.makedirs(build_dir, exist_ok=True)

    iconset = os.path.join(build_dir, 'AppIcon.iconset')
    os.makedirs(iconset, exist_ok=True)
    sizes = {
        'icon_16x16.png': 16, 'icon_16x16@2x.png': 32,
        'icon_32x32.png': 32, 'icon_32x32@2x.png': 64,
        'icon_128x128.png': 128, 'icon_128x128@2x.png': 256,
        'icon_256x256.png': 256, 'icon_256x256@2x.png': 512,
        'icon_512x512.png': 512, 'icon_512x512@2x.png': 1024,
    }
    for name, px in sizes.items():
        premultiplied_resize(big, (px, px)).save(os.path.join(iconset, name))

    big.save(os.path.join(build_dir, 'icon-preview.png'))
    checker_preview(big, os.path.join(build_dir, 'icon-preview-checker.png'))

    assets = os.path.join(ROOT, 'renderer', 'assets')
    os.makedirs(assets, exist_ok=True)
    premultiplied_resize(big, (512, 512)).save(os.path.join(assets, 'logo.png'))
    premultiplied_resize(big, (128, 128)).save(os.path.join(assets, 'logo-128.png'))

    if alpha_source:
        # 透明底源：检查四角透明 / 内容占比 / 居中，并确认边缘没有残留底色
        check_alpha_icon(big)
    else:
        # 抠底管线：内容边缘 8 像素内不应残留接近底色的不透明像素（白边/底色描边）
        a = np.array(big).astype(np.float64)
        rgb, al = a[:, :, :3], a[:, :, 3] / 255.0
        edge = (al > 0.6)
        try:
            from scipy import ndimage
            inner = ndimage.binary_erosion(al > 0.05, iterations=8)
            near_bg = (~inner) & edge
            bg0 = estimate_bg(rgb)
            resid = int(((distance_to_bg(rgb, bg0) < 12) & near_bg).sum())
            print('自检: 边缘不透明像素中出现底色像素 %d 个（越接近 0 越好）' % resid)
        except ImportError:
            pass

    print('已生成: build/AppIcon.iconset（%d 尺寸）、build/icon-preview.png、'
          'build/icon-preview-checker.png、renderer/assets/logo.png、logo-128.png' % len(sizes))


if __name__ == '__main__':
    main()
