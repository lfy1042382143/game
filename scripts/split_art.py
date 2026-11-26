# -*- coding: utf-8 -*-
"""角色素材自动分割：连通域检测 → 白底转透明 → 按语义命名输出 PNG。

用法：python scripts/split_art.py [源图路径]
源图默认 assets/source/characters.jpg（首次运行时会从剪贴板图复制一份）。
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'source', 'characters.jpg')
OUT = os.path.join(ROOT, 'assets', 'characters')
CLIPBOARD = r'C:\Users\lfy10\.workbuddy\clipboard-images\clipboard-2026-11-26T02-35-22-113Z-eb1af547.jpg'

# 按版面位置固定命名；连通域检测结果按 y//200 分组再按 x 排序，顺序见下。
NAMES = ['player', 'melee', 'brute', 'flyer',
         'mage', 'elite', 'boss', 'ranged',
         'mimic', 'companion', 'crystal']
PAD = 6           # 裁切留白
BG_TH = 250       # 背景阈值：只认接近纯白的像素（白袍/白胡子是米白，不会被误判）


def adjacent_white_bbox(mask):
    """找出所有面积 > 2000 的连通域，按 (y//200, x) 排序后返回 bbox。"""
    h, w = mask.shape
    seen = np.zeros_like(mask, bool)
    blobs = []
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or seen[y, x]:
                continue
            q = deque([(x, y)])
            seen[y, x] = True
            x0 = x1 = x
            y0 = y1 = y
            n = 0
            while q:
                cx, cy = q.popleft()
                n += 1
                x0, x1 = min(x0, cx), max(x1, cx)
                y0, y1 = min(y0, cy), max(y1, cy)
                for nx, ny in ((cx+1, cy), (cx-1, cy), (cx, cy+1), (cx, cy-1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((nx, ny))
            if n > 2000:
                blobs.append((x0, y0, x1, y1))
    blobs.sort(key=lambda b: (b[1] // 200, b[0]))
    return blobs


def transparent_crop(img, box):
    """把一个角色裁出来并去白底：从四边 flood fill 背景，边缘浅色像素降 alpha。"""
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0 - PAD), max(0, y0 - PAD)
    x1, y1 = min(img.width - 1, x1 + PAD), min(img.height - 1, y1 + PAD)
    crop = img.crop((x0, y0, x1 + 1, y1 + 1))
    a = np.array(crop.convert('RGB'))
    h, w = a.shape[:2]

    white = a.min(axis=2) > BG_TH
    bg = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if white[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if white[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((x, y))
    while q:
        cx, cy = q.popleft()
        for nx, ny in ((cx+1, cy), (cx-1, cy), (cx, cy+1), (cx, cy-1)):
            if 0 <= nx < w and 0 <= ny < h and white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                q.append((nx, ny))

    alpha = np.where(bg, 0, 255).astype(np.uint8)

    # 背景外扩 2px 的边缘带：浅色像素按接近白色的程度降 alpha，消除白边；
    # 角色内部（白袍、白胡子）不与边缘连通，不受影响。
    bg_img = Image.fromarray((bg * 255).astype('uint8'))
    dilated = np.array(bg_img.filter(ImageFilter.MaxFilter(5))) > 0
    band = dilated & ~bg
    mn = a.min(axis=2).astype(float)
    factor = np.clip((255 - mn) / 55.0, 0, 1)
    alpha[band] = np.round(alpha[band] * factor[band])

    # 轻微柔化边缘
    alpha_img = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.6))
    out = crop.convert('RGBA')
    out.putalpha(alpha_img)
    bbox = out.getbbox()
    return out.crop(bbox) if bbox else out


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else SRC
    if not os.path.exists(src):
        if os.path.exists(CLIPBOARD):
            os.makedirs(os.path.dirname(SRC), exist_ok=True)
            Image.open(CLIPBOARD).convert('RGB').save(SRC, quality=95)
            print('已复制源图到', SRC)
        else:
            raise SystemExit('找不到源图: ' + src)
    img = Image.open(src).convert('RGB')
    mask = img.convert("L").point(lambda v: 255 if v < 250 else 0)
    blobs = adjacent_white_bbox(np.array(mask) > 0)
    if len(blobs) != len(NAMES):
        raise SystemExit('检出 %d 块，预期 %d 块，请检查版面' % (len(blobs), len(NAMES)))
    os.makedirs(OUT, exist_ok=True)
    for box, name in zip(blobs, NAMES):
        piece = transparent_crop(img, box)
        path = os.path.join(OUT, name + '.png')
        piece.save(path, optimize=True)
        print('%-12s %s %4dx%-4d' % (name, str(box), piece.width, piece.height))


if __name__ == '__main__':
    main()
