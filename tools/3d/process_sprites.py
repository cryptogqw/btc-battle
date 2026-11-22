# 把 ChatGPT 画的精灵图（整张多帧、白底/品红底/透明底）处理成游戏图集：
# 抠背景 → 按网格切帧 → 裁边 → 统一缩放 → 按脚底与下半身中心对齐 → 拼图集 + 元数据
# 用法：Blender -b --factory-startup -P process_sprites.py -- <配置 json>
import bpy, sys, os, json
import numpy as np

cfg = json.load(open(sys.argv[sys.argv.index('--') + 1]))
SRC = cfg['src_dir']; OUT = cfg['out']; CW, CH = cfg['cell']; FOOT = cfg['foot_y']; TARGET_H = cfg['target_h']

def load(path):
    im = bpy.data.images.load(path); w, h = im.size
    a = np.array(im.pixels[:], np.float32).reshape(h, w, 4)[::-1].copy(); bpy.data.images.remove(im); return a  # 行从上到下

def key_bg(a):
    rgb = a[..., :3]
    if a[..., 3].min() < 0.5 and (a[..., 3] < 0.1).mean() > 0.2: return a  # 已有透明背景
    corners = np.concatenate([rgb[:8, :8].reshape(-1, 3), rgb[-8:, -8:].reshape(-1, 3), rgb[:8, -8:].reshape(-1, 3)])
    bg = np.median(corners, 0)
    d = np.sqrt(((rgb - bg) ** 2).sum(-1))
    alpha = np.clip((d - 0.16) / 0.22, 0, 1)
    out = a.copy(); out[..., 3] = alpha
    if bg[0] > 0.7 and bg[2] > 0.7 and bg[1] < 0.35:  # 品红底：去溢色（红、蓝都明显高于绿的像素才处理，蓝/金/肤色不受影响）
        r, g, b = out[..., 0], out[..., 1], out[..., 2]
        spill = np.clip(np.minimum(r, b) - g - 0.04, 0, 1)
        out[..., 0] = r - spill; out[..., 2] = b - spill
        out[..., 3] = np.clip(alpha - spill * 1.5 * (alpha < 0.98), 0, 1)
    return out

def keep_largest(a, step=4):
    # 只保留最大的连通块（按 1/4 分辨率做 BFS），去掉相邻帧漏进来的碎片
    m = a[..., 3] > 0.35; h, w = m.shape; gh, gw = (h + step - 1) // step, (w + step - 1) // step
    pad = np.zeros((gh * step, gw * step), bool); pad[:h, :w] = m
    g = pad.reshape(gh, step, gw, step).any((1, 3))
    lab = np.zeros(g.shape, np.int32); best, best_n, cur = 0, 0, 0
    for y0, x0 in zip(*np.where(g)):
        if lab[y0, x0]: continue
        cur += 1; stack = [(y0, x0)]; lab[y0, x0] = cur; n = 0
        while stack:
            y, x = stack.pop(); n += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < gh and 0 <= xx < gw and g[yy, xx] and not lab[yy, xx]: lab[yy, xx] = cur; stack.append((yy, xx))
        if n > best_n: best, best_n = cur, n
    keep = np.kron(lab == best, np.ones((step, step), bool))[:h, :w]
    out = a.copy(); out[..., 3] *= keep; return out

def crop(a):
    a = keep_largest(a)
    m = a[..., 3] > 0.35
    ys, xs = np.where(m)
    if not len(ys): return None
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

def lower_center(f):
    m = f[..., 3] > 0.35; h = m.shape[0]
    band = m[int(h * 0.45):]
    ys, xs = np.where(band)
    return xs.mean() if len(xs) else f.shape[1] / 2

def resize(a, s):
    h, w = a.shape[:2]; nh, nw = max(1, int(round(h * s))), max(1, int(round(w * s)))
    # 先预乘 alpha 再双线性缩放，避免边缘发黑/发亮
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    yi = (np.arange(nh) + 0.5) / s - 0.5; xi = (np.arange(nw) + 0.5) / s - 0.5
    y0 = np.clip(np.floor(yi).astype(int), 0, h - 1); x0 = np.clip(np.floor(xi).astype(int), 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1); x1 = np.clip(x0 + 1, 0, w - 1)
    fy = np.clip(yi - np.floor(yi), 0, 1)[:, None, None]; fx = np.clip(xi - np.floor(xi), 0, 1)[None, :, None]
    if s < 0.6:  # 大幅缩小时先做盒式预滤波，减少锯齿
        k = int(1 / s / 1.5)
        if k >= 2:
            hh, ww = (h // k) * k, (w // k) * k
            pm = pm[:hh, :ww].reshape(hh // k, k, ww // k, k, 4).mean((1, 3)); return resize_pm(pm, s * k)
    out = (pm[y0][:, x0] * (1 - fy) * (1 - fx) + pm[y0][:, x1] * (1 - fy) * fx + pm[y1][:, x0] * fy * (1 - fx) + pm[y1][:, x1] * fy * fx)
    return unpremul(out)

def resize_pm(pm, s):
    a = unpremul(pm.copy()); return resize(a, s)

def unpremul(pm):
    al = pm[..., 3:4]; out = pm.copy(); out[..., :3] = np.where(al > 1e-4, pm[..., :3] / np.maximum(al, 1e-4), 0); return out

clips_meta = {}; rows = []
for clip in cfg['clips']:
    frames = []
    for spec in clip['frames']:   # {"file":..., "grid":[cols,rows], "cells":[i,...]} 或 {"file":..., "whole":true}
        a = key_bg(load(os.path.join(SRC, spec['file'])))
        H, W = a.shape[:2]
        if spec.get('whole'): frames.append((crop(a), spec)); continue
        gc, gr = spec['grid']
        for i in spec.get('cells', range(gc * gr)):
            r, c = divmod(i, gc)
            cell = a[int(r * H / gr):int((r + 1) * H / gr), int(c * W / gc):int((c + 1) * W / gc)]
            f = crop(cell)
            if f is not None: frames.append((f, spec))
    # 统一缩放：以本组第一帧为准，按配置的参考高度缩放（同一组内比例一致）
    ref = clip.get('ref_h') or frames[0][0].shape[0]
    s = TARGET_H * clip.get('h_ratio', 1.0) / ref
    row = []
    for f, spec in frames:
        f2 = resize(f, s)
        cx = lower_center(f2)
        canvas = np.zeros((CH, CW, 4), np.float32)
        ox = int(round(cfg['anchor_x'] - cx)); oy = FOOT - f2.shape[0]
        ys0, xs0 = max(0, oy), max(0, ox); ys1, xs1 = min(CH, oy + f2.shape[0]), min(CW, ox + f2.shape[1])
        canvas[ys0:ys1, xs0:xs1] = f2[ys0 - oy:ys1 - oy, xs0 - ox:xs1 - ox]
        row.append(canvas)
    clips_meta[clip['name']] = {'row': len(rows), 'n': len(row), 'loop': clip.get('loop', True)}
    rows.append(row)
    print('clip', clip['name'], len(row), 'scale', round(s, 3))

cols = max(len(r) for r in rows)
atlas = np.zeros((len(rows) * CH, cols * CW, 4), np.float32)
for r, row in enumerate(rows):
    for c, f in enumerate(row): atlas[r * CH:(r + 1) * CH, c * CW:(c + 1) * CW] = f
img = bpy.data.images.new('atlas', cols * CW, len(rows) * CH, alpha=True)
img.pixels = atlas[::-1].ravel(); img.filepath_raw = OUT + '.png'; img.file_format = 'PNG'; img.save()
meta = {'cell': [CW, CH], 'foot_y': FOOT, 'units': {cfg['unit']: {'anchor_x': cfg['anchor_x'], 'k': cfg['k'], 'clips': clips_meta}}, 'size': [cols * CW, len(rows) * CH]}
json.dump(meta, open(OUT + '.json', 'w'))
print('DONE', meta['size'])
