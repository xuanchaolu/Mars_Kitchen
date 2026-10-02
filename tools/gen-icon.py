#!/usr/bin/env python3
"""从 logo.png 生成 PerPer 应用图标与界面 logo
- 抠除白底（从图像四边泛洪填充，保留 logo 内部白色细节）
- 边缘柔化，裁剪到内容，放大到画布 92%（比常规留白更大）
- 输出：build/AppIcon.iconset/*（iconutil 用）、build/icon-preview.png、renderer/assets/logo.png
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'logo.png')
ICONSET = os.path.join(ROOT, 'build', 'AppIcon.iconset')
CANVAS = 1024
SCALE = 0.92          # 内容占画布比例（放大一点）
WHITE_THRESH = 70     # 泛洪填充的白色容差
EDGE_SOFTEN = 0.7     # 边缘柔化半径


def remove_white_bg(im):
    """从四边泛洪填充白色背景 → 透明；保留 logo 内部的白色"""
    im = im.convert('RGBA')
    w, h = im.size
    rgb = im.convert('RGB')
    seeds = []
    step = max(16, min(w, h) // 32)
    for x in range(0, w, step):
        seeds.append((x, 0)); seeds.append((x, h - 1))
    for y in range(0, h, step):
        seeds.append((0, y)); seeds.append((w - 1, y))
    seeds += [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    marker = (255, 0, 255)
    for s in seeds:
        px = rgb.getpixel(s)
        if min(px) < 255 - WHITE_THRESH:   # 只在接近白色处下种，避免误填 logo 本体
            continue
        ImageDraw.floodfill(rgb, s, marker, thresh=WHITE_THRESH)

    arr_rgb = np.array(rgb)
    is_bg = (arr_rgb[:, :, 0] > 250) & (arr_rgb[:, :, 1] < 5) & (arr_rgb[:, :, 2] > 250)

    alpha = np.where(is_bg, 0, 255).astype(np.uint8)
    a_img = Image.fromarray(alpha, 'L')
    if EDGE_SOFTEN > 0:
        a_img = a_img.filter(ImageFilter.GaussianBlur(EDGE_SOFTEN))
        # 内部保持完全不透明
        core = np.where(is_bg, 0, 255).astype(np.uint8)
        core = np.array(Image.fromarray(core, 'L').filter(ImageFilter.MinFilter(3)))
        a_arr = np.array(a_img)
        a_arr[core > 200] = 255
        a_img = Image.fromarray(a_arr, 'L')

    out = im.copy()
    out.putalpha(a_img)
    return out


def trim(im):
    """裁剪到不透明内容的外接框"""
    bbox = im.getchannel('A').getbbox()
    return im.crop(bbox) if bbox else im


def compose(im, canvas=CANVAS, scale=SCALE):
    """等比放大后居中放到透明方形画布"""
    w, h = im.size
    target = int(canvas * scale)
    k = target / max(w, h)
    nw, nh = max(1, int(round(w * k))), max(1, int(round(h * k)))
    resized = im.resize((nw, nh), Image.LANCZOS)
    out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    out.paste(resized, ((canvas - nw) // 2, (canvas - nh) // 2), resized)
    return out


def main():
    if not os.path.exists(SRC):
        raise SystemExit('找不到 %s' % SRC)
    im = Image.open(SRC)
    print('源图: %s %s %s' % (SRC, im.size, im.mode))

    cut = remove_white_bg(im)
    arr = np.array(cut)
    print('抠图完成 → 透明像素占比 %.1f%%' % ((arr[:, :, 3] < 10).mean() * 100))

    trimmed = trim(cut)
    print('裁剪后内容尺寸:', trimmed.size)

    big = compose(trimmed)
    os.makedirs(ICONSET, exist_ok=True)

    sizes = {
        'icon_16x16.png': 16, 'icon_16x16@2x.png': 32,
        'icon_32x32.png': 32, 'icon_32x32@2x.png': 64,
        'icon_128x128.png': 128, 'icon_128x128@2x.png': 256,
        'icon_256x256.png': 256, 'icon_256x256@2x.png': 512,
        'icon_512x512.png': 512, 'icon_512x512@2x.png': 1024,
    }
    for name, px in sizes.items():
        big.resize((px, px), Image.LANCZOS).save(os.path.join(ICONSET, name))

    build_dir = os.path.join(ROOT, 'build')
    os.makedirs(build_dir, exist_ok=True)
    big.save(os.path.join(build_dir, 'icon-preview.png'))

    assets = os.path.join(ROOT, 'renderer', 'assets')
    os.makedirs(assets, exist_ok=True)
    big.resize((512, 512), Image.LANCZOS).save(os.path.join(assets, 'logo.png'))
    big.resize((128, 128), Image.LANCZOS).save(os.path.join(assets, 'logo-128.png'))

    print('已生成 iconset（%d 个尺寸）、icon-preview.png、renderer/assets/logo.png' % len(sizes))


if __name__ == '__main__':
    main()
