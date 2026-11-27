# -*- coding: utf-8 -*-
"""场景素材自动分割：棋盘格背景转透明 → 按版面语义命名输出 PNG。

用法：python scripts/split_scene.py [源图路径]
源图默认 assets/source/scene.jpg。
版面：第 1 行 = 骷髅 + 5 张地面；第 2 行 = 5 个障碍物；第 3 行 = 冰面/毒池。
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'source', 'scene.jpg')
CLIPBOARD = r'C:\Users\lfy10\.workbuddy\clipboard-images\clipboard-2026-11-27T01-59-07-173Z-eb125903.jpg'
PAD = 3


def bands(values, threshold, merge_gap=6):
    """一维投影非背景带，间隔小于 merge_gap 的相邻带合并。"""
    on = values > threshold
    raw = []
    start = None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        if not v and start is not None:
            raw.append([start, i - 1])
            start = None
    if start is not None:
        raw.append([start, len(on) - 1])
    merged = []
    for b in raw:
        if merged and b[0] - merged[-1][1] <= merge_gap:
            merged[-1][1] = b[1]
        else:
            merged.append(b)
    return merged


def crop_boxes(img):
    a = np.array(img.convert('RGB')).astype(int)
    mx, mn = a.max(2), a.min(2)
    art = ~((mx - mn < 12) & (a.mean(2) > 195))
    rows = bands(art.sum(1), 80)
    if len(rows) != 3:
        raise SystemExit('检出 %d 行，预期 3 行' % len(rows))
    result = []
    counts = [6, 5, 2]
    for (y0, y1), n in zip(rows, counts):
        cols = bands(art[y0:y1 + 1].sum(0), 15)
        if len(cols) != n:
            raise SystemExit('行 %d-%d 检出 %d 块，预期 %d 块' % (y0, y1, len(cols), n))
        result.append([(x0, y0, x1, y1) for x0, x1 in cols])
    return result


def pad_box(box, img):
    x0, y0, x1, y1 = box
    return (max(0, x0 - PAD), max(0, y0 - PAD),
            min(img.width - 1, x1 + PAD), min(img.height - 1, y1 + PAD))


def checker_alpha(crop, flood=True):
    """棋盘格背景转 alpha；flood=True 只去掉与边缘连通的背景。"""
    a = np.array(crop.convert('RGB')).astype(int)
    h, w = a.shape[:2]
    bg = ((a.max(2) - a.min(2) < 12) & (a.mean(2) > 195))
    remove = np.zeros_like(bg)
    if flood:
        q = deque()
        for x in range(w):
            for y in (0, h - 1):
                if bg[y, x] and not remove[y, x]:
                    remove[y, x] = True
                    q.append((x, y))
        for y in range(h):
            for x in (0, w - 1):
                if bg[y, x] and not remove[y, x]:
                    remove[y, x] = True
                    q.append((x, y))
        while q:
            cx, cy = q.popleft()
            for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                if 0 <= nx < w and 0 <= ny < h and bg[ny, nx] and not remove[ny, nx]:
                    remove[ny, nx] = True
                    q.append((nx, ny))
    else:
        remove = bg
    alpha = np.where(remove, 0, 255).astype('uint8')
    # 柔化 1 像素锯齿
    alpha = np.array(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.7)))
    out = crop.convert('RGBA')
    out.putalpha(Image.fromarray(alpha))
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def soft_zone(crop):
    """区域贴图：源图把透明棋盘格烘进了半透明水彩里，先去棋盘格再模糊消除残留纹路。"""
    a = np.array(crop.convert('RGB')).astype(int)
    bg = (a.max(2) - a.min(2) < 12) & (a.mean(2) > 195)
    mask = Image.fromarray(np.where(bg, 0, 255).astype('uint8')).filter(ImageFilter.GaussianBlur(3))
    rgb = crop.filter(ImageFilter.GaussianBlur(3.2))
    out = rgb.convert('RGBA')
    out.putalpha(mask.point(lambda v: int(v * 0.9)))
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SRC
    if not os.path.exists(src):
        if not os.path.exists(CLIPBOARD):
            raise SystemExit('找不到源图: ' + src)
        os.makedirs(os.path.dirname(SRC), exist_ok=True)
        Image.open(CLIPBOARD).convert('RGB').save(SRC, quality=95)
        print('已复制源图到', SRC)
    img = Image.open(src).convert('RGB')
    rows = crop_boxes(img)

    jobs = []
    jobs.append((rows[0][0], 'characters/skeleton', True, True))
    for box, name in zip(rows[0][1:], ['forest', 'swamp', 'bone', 'ice', 'lava']):
        jobs.append((box, 'tiles/' + name, False, False))
    for box, name in zip(rows[1], ['root', 'stone', 'bone', 'ice', 'lava']):
        jobs.append((box, 'obstacles/' + name, True, True))
    for box, name in zip(rows[2], ['ice', 'poison']):
        jobs.append((box, 'zones/' + name, True, False))

    for box, name, transparent, flood in jobs:
        crop = img.crop(pad_box(box, img))
        if name.startswith('zones/'):
            piece = soft_zone(crop)
        elif transparent:
            piece = checker_alpha(crop, flood=flood)
        else:
            piece = crop
        folder, file_name = name.split('/')
        path = os.path.join(ROOT, 'assets', folder, file_name + '.png')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        piece.save(path, optimize=True)
        print('%-22s %4dx%-4d %s' % (name, piece.width, piece.height, path))


if __name__ == '__main__':
    main()
