# 背景切分：天空 / 人族城堡 / 中间山谷 / 兽族要塞 / 地面，白天黑夜各一套；去掉画死的太阳和月亮，月亮单独抠出
# 用法：Blender -b --factory-startup -P bg_build.py -- <bg 目录> <输出前缀>
import bpy, sys, os, json
import numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]; root, out = argv[0], argv[1]
def load(p):
    im = bpy.data.images.load(p); w, h = im.size
    a = np.array(im.pixels[:], np.float32).reshape(h, w, 4)[::-1].copy(); bpy.data.images.remove(im); return a
def save(a, p):
    h, w = a.shape[:2]; im = bpy.data.images.new('o', w, h, alpha=True); im.pixels = np.ascontiguousarray(a[::-1]).ravel(); im.filepath_raw = p; im.file_format = 'PNG'; im.save(); bpy.data.images.remove(im)
def shift(m, dy, dx):
    h, w = m.shape[:2]; p = np.pad(m, ((1, 1), (1, 1)) + ((0, 0),) * (m.ndim - 2), mode='edge'); return p[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
def blur(x, r):
    for _ in range(r): x = (x + shift(x, 1, 0) + shift(x, -1, 0) + shift(x, 0, 1) + shift(x, 0, -1)) / 5
    return x
def geo(seed, allow, n=4000):
    for it in range(n):
        nx = (seed | shift(seed, 1, 0) | shift(seed, -1, 0) | shift(seed, 0, 1) | shift(seed, 0, -1)) & allow
        if (nx == seed).all(): break
        seed = nx
    return seed
def sky_mask(a, YLIM):
    b = blur(a[..., :3], 1); g = np.zeros(a.shape[:2], np.float32)
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)): g = np.maximum(g, np.abs(b - shift(b, dy, dx)).sum(-1))
    smooth = g < 0.045; smooth[YLIM:] = False
    seed = np.zeros_like(smooth); seed[3] = smooth[3]
    return geo(seed, smooth)
def pushpull(img, known):
    # 金字塔推拉补洞：未知像素用周围已知像素平滑填充
    levels = [(img * known[..., None], known.astype(np.float32))]
    while max(levels[-1][1].shape) > 1:
        c, w = levels[-1]; h2, w2 = (c.shape[0] + 1) // 2, (c.shape[1] + 1) // 2
        cp = np.zeros((h2 * 2, w2 * 2, c.shape[2]), np.float32); wp = np.zeros((h2 * 2, w2 * 2), np.float32)
        cp[:c.shape[0], :c.shape[1]] = c; wp[:w.shape[0], :w.shape[1]] = w
        levels.append((cp.reshape(h2, 2, w2, 2, -1).sum((1, 3)), wp.reshape(h2, 2, w2, 2).sum((1, 3))))
    c, w = levels[-1]; cur = c / np.maximum(w, 1e-6)[..., None]
    for c, w in reversed(levels[:-1]):
        up = np.repeat(np.repeat(cur, 2, 0), 2, 1)[:c.shape[0], :c.shape[1]]; up = blur(up, 1)
        own = c / np.maximum(w, 1e-6)[..., None]; k = np.clip(w, 0, 1)[..., None]
        cur = own * k + up * (1 - k)
    return cur

D = load(os.path.join(root, 'day.webp')); N = load(os.path.join(root, 'night.webp'))
W = min(D.shape[1], N.shape[1]); D, N = D[:, :W], N[:, :W]; H = D.shape[0]
YH = 436; YLIM = 452          # 地平线（地面开始的行）/ 景物层底边
sd, sn = sky_mask(D, YLIM), sky_mask(N, YLIM)
# 景物 = 两张图里都不是天空、并且与地面连通（白天的云和夜里的云位置不同，取交集就把云剔掉了）
both = ~(sd | sn); both[:120, :88] = False; both[YLIM - 20:] = True   # 左上角那朵云不算景物
sc = np.zeros_like(both); sc[-1] = True; sc = geo(sc, both)
# 填小洞（景物内部被误判成天空的小块）：不与顶边相连的非景物区域并入景物
hole = ~sc; top = np.zeros_like(hole); top[:4] = hole[:4]; reach = geo(top, hole); sc |= ~reach
alpha = blur(sc.astype(np.float32), 1)
ys = np.where(sc[:YH].any(1))[0]; scen_top = int(ys.min()); print('scenery top', scen_top, 'sky frac', 1 - sc[:YH].mean())
alpha[YH:YLIM] *= np.linspace(1, 0, YLIM - YH)[:, None] ** 0.7   # 底边渐隐，和地面衔接
alpha[YLIM:] = 0

# 月亮：夜图左上角的亮圆
reg = N[:160, 120:340, :3].mean(-1); my, mx = np.where(reg > 0.72); cy, cx = my.mean(), mx.mean() + 120; r = np.sqrt(len(my) / np.pi)
print('moon', round(cx), round(cy), 'r', round(r, 1))
R = int(r + 3); moon = N[int(cy) - R:int(cy) + R, int(cx) - R:int(cx) + R].copy()
yy, xx = np.mgrid[-R:R, -R:R] + 0.5; moon[..., 3] = np.clip(r + 0.5 - np.sqrt(yy ** 2 + xx ** 2), 0, 1)
# 白天太阳在左上角
lum = D[:200, :260, :3].mean(-1); sy, sx = np.unravel_index(np.argmax(blur(lum, 4)), lum.shape); print('sun', sx, sy)

meta = {'iw': W, 'ih': H, 'yh': YH, 'ylim': YLIM, 'top': scen_top, 'pieces': {}}
yy, xx = np.mgrid[:H, :W]
for name, A, skym in (('day', D, sd), ('night', N, sn)):
    # 天空：景物区域、太阳/月亮用推拉补洞
    known = ~(blur(sc.astype(np.float32), 3) > 0.01)   # 景物外扩几像素，避免旗帜等边缘的残影留在天空里
    if name == 'day': known &= (xx - sx) ** 2 + (yy - sy) ** 2 > 230 ** 2
    else: known &= (xx - cx) ** 2 + (yy - cy) ** 2 > (r * 2.2) ** 2
    known[YLIM:] = False
    sky = pushpull(A[:YLIM, :, :3], known[:YLIM])
    sky = sky[:YLIM:2, ::2]; sky = np.concatenate([sky, np.ones(sky.shape[:2] + (1,), np.float32)], -1)
    L = A.copy(); L[..., 3] = alpha
    # 景物层边缘去天空色：半透明边缘的颜色换成内部颜色（避免白天的蓝边出现在夜里）
    inner = pushpull(A[..., :3], sc & (blur(sc.astype(np.float32), 2) > 0.99))
    edge = (alpha > 0) & (alpha < 1); L[edge, :3] = inner[edge]
    pieces = {'castle': (0, 720, 0, 60), 'mid': (560, 1010, 70, 70), 'fort': (860, W, 60, 0)}
    atlas_w = sum(x1 - x0 for x0, x1, _, _ in pieces.values()); gh = H - (YH - 16)
    AW = max(atlas_w, W + sky.shape[1]); AH = YLIM + max(gh, sky.shape[0] + 2 * R + 4)
    at = np.zeros((AH, AW, 4), np.float32); ox = 0; fr = {}
    for pn, (x0, x1, fl, frr) in pieces.items():
        p = L[:YLIM, x0:x1].copy(); w = x1 - x0
        f = np.ones(w, np.float32)
        if fl: f[:fl] = np.linspace(0, 1, fl)
        if frr: f[-frr:] = np.minimum(f[-frr:], np.linspace(1, 0, frr))
        p[..., 3] *= f[None, :]
        at[:YLIM, ox:ox + w] = p; fr[pn] = {'x': ox, 'y': 0, 'w': w, 'h': YLIM, 'sx': x0}; ox += w
    g0 = YH - 16; G = A[g0:].copy(); G[..., 3] = 1
    at[YLIM:YLIM + G.shape[0], :W] = G; fr['ground'] = {'x': 0, 'y': YLIM, 'w': W, 'h': G.shape[0], 'sy': g0}
    at[YLIM:YLIM + sky.shape[0], W:W + sky.shape[1]] = sky; fr['sky'] = {'x': W, 'y': YLIM, 'w': sky.shape[1], 'h': sky.shape[0], 'scale': 2}
    if name == 'night':
        my0 = YLIM + sky.shape[0] + 2; at[my0:my0 + 2 * R, W:W + 2 * R] = moon; fr['moon'] = {'x': W, 'y': my0, 'w': 2 * R, 'h': 2 * R, 'r': round(float(r), 2)}
    used_h = max(YLIM + G.shape[0], (fr.get('moon', fr['sky'])['y'] + fr.get('moon', fr['sky'])['h']))
    at = at[:used_h]
    meta['pieces'][name] = fr; meta['size_' + name] = [AW, used_h]
    save(at, f'{out}_{name}.png')
json.dump(meta, open(out + '.json', 'w'))
# 预览：景物掩码
pv = D[..., :3] * alpha[..., None] + np.array([1, 0, 1]) * (1 - alpha[..., None]) * 0.8
save(np.concatenate([pv[::2, ::2], np.ones((H // 2 + H % 2, (W + 1) // 2, 1), np.float32)], -1), os.path.join(root, 'scen_preview.png'))
print('DONE', meta)
