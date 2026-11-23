# 网格精灵表（绿幕/品红/透明底，每张 cols×rows 帧）→ 抠图、去溢色、按脚底或身体重心对齐 → 游戏图集
# 用法：Blender -b --factory-startup -P pack_grid.py -- <配置 json>
import bpy, sys, os, json
import numpy as np
cfg = json.load(open(sys.argv[sys.argv.index('--') + 1]))
def load(p):
    im = bpy.data.images.load(p); w, h = im.size
    a = np.array(im.pixels[:], np.float32).reshape(h, w, 4)[::-1].copy(); bpy.data.images.remove(im); return a
def key_bg(a):
    rgb = a[..., :3]
    if (a[..., 3] < 0.1).mean() > 0.2: return a
    corners = np.concatenate([rgb[:8, :8].reshape(-1, 3), rgb[-8:, -8:].reshape(-1, 3), rgb[:8, -8:].reshape(-1, 3)]); bg = np.median(corners, 0)
    d = np.sqrt(((rgb - bg) ** 2).sum(-1)); alpha = np.clip((d - 0.18) / 0.25, 0, 1)
    out = a.copy(); out[..., 3] = alpha; r, g, b = out[..., 0], out[..., 1], out[..., 2]
    if bg[1] > 0.6 and bg[0] < 0.4 and bg[2] < 0.4:   # 绿幕：绿色明显高于红、蓝的像素去溢色（火焰的黄、橙红大于绿，不受影响）
        spill = np.clip(g - np.maximum(r, b) - 0.02, 0, 1); out[..., 1] = g - spill
        out[..., 3] = np.clip(alpha - spill * 1.6 * (alpha < 0.98), 0, 1)
    elif bg[0] > 0.7 and bg[2] > 0.7 and bg[1] < 0.35:
        spill = np.clip(np.minimum(r, b) - g - 0.04, 0, 1); out[..., 0] = r - spill; out[..., 2] = b - spill
        out[..., 3] = np.clip(alpha - spill * 1.5 * (alpha < 0.98), 0, 1)
    return out
def keep_largest(a, step=4):
    m = a[..., 3] > 0.35; h, w = m.shape; gh, gw = (h + step - 1) // step, (w + step - 1) // step
    pad = np.zeros((gh * step, gw * step), bool); pad[:h, :w] = m; g = pad.reshape(gh, step, gw, step).any((1, 3))
    lab = np.zeros(g.shape, np.int32); best, best_n, cur = 0, 0, 0
    for y0, x0 in zip(*np.where(g)):
        if lab[y0, x0]: continue
        cur += 1; st = [(y0, x0)]; lab[y0, x0] = cur; n = 0
        while st:
            y, x = st.pop(); n += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < gh and 0 <= xx < gw and g[yy, xx] and not lab[yy, xx]: lab[yy, xx] = cur; st.append((yy, xx))
        if n > best_n: best, best_n = cur, n
    keep = np.kron(lab == best, np.ones((step, step), bool))[:h, :w]
    out = a.copy(); out[..., 3] *= keep; return out
def resize(a, s):
    h, w = a.shape[:2]; k = max(1, int(1 / s / 1.5))
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    if k >= 2: hh, ww = (h // k) * k, (w // k) * k; pm = pm[:hh, :ww].reshape(hh // k, k, ww // k, k, 4).mean((1, 3)); s *= k; h, w = pm.shape[:2]
    nh, nw = max(1, round(h * s)), max(1, round(w * s))
    yi = (np.arange(nh) + 0.5) / s - 0.5; xi = (np.arange(nw) + 0.5) / s - 0.5
    y0 = np.clip(np.floor(yi).astype(int), 0, h - 1); x0 = np.clip(np.floor(xi).astype(int), 0, w - 1); y1 = np.clip(y0 + 1, 0, h - 1); x1 = np.clip(x0 + 1, 0, w - 1)
    fy = np.clip(yi - np.floor(yi), 0, 1)[:, None, None]; fx = np.clip(xi - np.floor(xi), 0, 1)[None, :, None]
    o = pm[y0][:, x0] * (1 - fy) * (1 - fx) + pm[y0][:, x1] * (1 - fy) * fx + pm[y1][:, x0] * fy * (1 - fx) + pm[y1][:, x1] * fy * fx
    al = o[..., 3:4]; o[..., :3] = np.where(al > 1e-4, o[..., :3] / np.maximum(al, 1e-4), 0); return o
def anchor_of(f, mode):
    m = f[..., 3] > 0.35; h = m.shape[0]
    if mode == 'body':   # 身体重心：红色鳞片像素（翅膀是橙色，不计入），扇翅时身体不会上下乱跳
        r, g, b = f[..., 0], f[..., 1], f[..., 2]; red = m & (r > 0.45) & (g < 0.25) & (b < 0.25)
        ys, xs = np.where(red if red.sum() > 50 else m); return xs.mean(), ys.mean()
    ys, xs = np.where(m[int(h * 0.45):]); return (xs.mean() if len(xs) else f.shape[1] / 2), h
src = cfg['src_dir']; S = cfg['scale']; frames = []   # (clip, 帧, 锚点, 出手点)
for clip in cfg['clips']:
    a = key_bg(load(os.path.join(src, clip['file']))); H, W = a.shape[:2]; gc, gr = clip['grid']
    for i in clip.get('cells', range(gc * gr)):
        r, c = divmod(i, gc); cell = a[int(r * H / gr):int((r + 1) * H / gr), int(c * W / gc):int((c + 1) * W / gc)]
        rel = clip.get('release', {}).get(str(i))
        if cfg.get('facing') == 'left': cell = cell[:, ::-1].copy(); rel = rel and [cell.shape[1] - 1 - rel[0], rel[1]]
        cell = keep_largest(cell); m = cell[..., 3] > 0.35; ys, xs = np.where(m)
        y0, x0 = ys.min(), xs.min(); f = resize(cell[y0:ys.max() + 1, x0:xs.max() + 1], S)
        ax, ay = anchor_of(f, cfg['align'])
        frames.append((clip, i, f, ax, ay, rel and ((rel[0] - x0) * S - ax, (rel[1] - y0) * S - ay)))
# 统一画布：所有帧按锚点叠放后的并集
L = min(-ax for _, _, f, ax, ay, _ in frames); T = min(-ay for _, _, f, ax, ay, _ in frames)
R = max(f.shape[1] - ax for _, _, f, ax, ay, _ in frames); B = max(f.shape[0] - ay for _, _, f, ax, ay, _ in frames)
AX, AY = int(np.ceil(-L)) + 2, int(np.ceil(-T)) + 2; CW, CH = int(np.ceil(R)) + AX + 2, int(np.ceil(B)) + AY + 2
rows, meta_clips = [], {}
for clip in cfg['clips']:
    row, pts = [], []
    for (cl, i, f, ax, ay, rel) in frames:
        if cl is not clip: continue
        can = np.zeros((CH, CW, 4), np.float32); ox, oy = int(round(AX - ax)), int(round(AY - ay))
        can[oy:oy + f.shape[0], ox:ox + f.shape[1]] = f; row.append(can)
        if rel: pts.append([round(AX + rel[0], 1), round(AY + rel[1], 1)])
    meta_clips[clip['name']] = {'row': len(rows), 'n': len(row), 'loop': clip.get('loop', False), 'dur': clip['dur']}
    if 'release_frame' in clip: meta_clips[clip['name']]['rf'] = clip['release_frame']
    if pts: meta_clips[clip['name']]['pt'] = pts[0]
    rows.append(row)
f0 = frames[0][2]; k = cfg['screen_h'] / f0.shape[0] if 'screen_h' in cfg else cfg['screen_w'] / f0.shape[1]
cols = max(len(r) for r in rows); atlas = np.zeros((len(rows) * CH, cols * CW, 4), np.float32)
for r, row in enumerate(rows):
    for c, f in enumerate(row): atlas[r * CH:(r + 1) * CH, c * CW:(c + 1) * CW] = f
img = bpy.data.images.new('atlas', cols * CW, len(rows) * CH, alpha=True); img.pixels = atlas[::-1].ravel()
out = cfg['out']; img.filepath_raw = out + '.png'; img.file_format = 'PNG'; img.save()
meta = {'cell': [CW, CH], 'foot_y': AY, 'units': {cfg['unit']: {'anchor_x': AX, 'k': round(k, 4), 'clips': meta_clips}}, 'size': [cols * CW, len(rows) * CH]}
json.dump(meta, open(out + '.json', 'w')); print('DONE', json.dumps(meta))
