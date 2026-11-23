# 把已经对齐好锚点的精灵表（animations.json 格式：每张 columns×rows 帧、统一 anchorPx）裁掉空白、拼成游戏图集
# 用法：Blender -b --factory-startup -P pack_sheets.py -- <配置 json>
import bpy, sys, os, json
import numpy as np

cfg = json.load(open(sys.argv[sys.argv.index('--') + 1]))
root = cfg['root']; anim = json.load(open(os.path.join(root, 'animations.json')))

def load(path):
    im = bpy.data.images.load(path); w, h = im.size
    a = np.array(im.pixels[:], np.float32).reshape(h, w, 4)[::-1].copy(); bpy.data.images.remove(im); return a

def frames_of(key):
    m = anim[key]; a = load(os.path.join(root, m['sheet'])); fw, fh = m['frameWidth'], m['frameHeight']
    out = [a[r * fh:(r + 1) * fh, c * fw:(c + 1) * fw] for r in range(m['rows']) for c in range(m['columns'])]
    if m.get('facing') == 'left': out = [f[:, ::-1].copy() for f in out]   # 统一成朝右（游戏里红方再翻转）
    return out, m

for unit in cfg['units']:
    clips = []   # (名字, 帧列表, 是否循环, 总时长秒)
    for c in unit['clips']:
        fr, m = frames_of(c['src'])
        if 'pick' in c: fr = [fr[i] for i in c['pick']]; dur = None
        else: dur = sum(m['durationsMs']) / 1000
        ap = list(m['anchorPx'])
        if m.get('facing') == 'left': ap[0] = m['frameWidth'] - ap[0]
        clips.append((c['name'], fr, c.get('loop', m['repeat']), dur, ap))
    ax, ay = clips[0][4]
    # 所有帧的不透明区域取并集，统一裁剪（锚点保持不变）
    mask = np.zeros(clips[0][1][0].shape[:2], bool)
    for _, fr, _, _, _ in clips:
        for f in fr: mask |= f[..., 3] > 0.03
    ys, xs = np.where(mask); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    pad = 4; y0, x0 = max(0, y0 - pad), max(0, x0 - pad); y1, x1 = min(mask.shape[0], y1 + pad), min(mask.shape[1], x1 + pad)
    cw, ch = x1 - x0, y1 - y0
    # 人物/坐骑的实际高度（锚点以上），用于换算缩放系数
    # h_from：只用指定动作量身高（避免举起的武器把身高算大）；默认用所有帧
    if 'h_from' in unit:
        hm = np.zeros_like(mask)
        for name, fr, _, _, _ in clips:
            if name == unit['h_from']:
                for f in fr: hm |= f[..., 3] > 0.03
        body_h = ay - np.where(hm)[0].min()
    else: body_h = ay - ys.min()
    k = unit['screen_h'] / body_h
    rows, meta_clips = [], {}
    for name, fr, loop, dur, _ in clips:
        meta_clips[name] = {'row': len(rows), 'n': len(fr), 'loop': bool(loop)}
        if dur: meta_clips[name]['dur'] = dur
        rows.append([f[y0:y1, x0:x1] for f in fr])
    D = int(unit.get('down', 1))   # 整数倍缩小（面积平均），减小图集体积
    if 'release' in unit: meta_clips[unit['release']['clip']]['pt'] = [[float(unit['release']['x'] - x0) / D, float(unit['release']['y'] - y0) / D]] * meta_clips[unit['release']['clip']]['n']
    cw, ch = cw // D, ch // D
    def down(f):
        if D == 1: return f
        f = f[:ch * D, :cw * D]; pm = f.copy(); pm[..., :3] *= pm[..., 3:4]
        pm = pm.reshape(ch, D, cw, D, 4).mean((1, 3)); al = pm[..., 3:4]
        pm[..., :3] = np.where(al > 1e-4, pm[..., :3] / np.maximum(al, 1e-4), 0); return pm
    rows = [[down(f) for f in row] for row in rows]
    cols = max(len(r) for r in rows)
    atlas = np.zeros((len(rows) * ch, cols * cw, 4), np.float32)
    for r, row in enumerate(rows):
        for c, f in enumerate(row): atlas[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw] = f
    img = bpy.data.images.new('atlas', cols * cw, len(rows) * ch, alpha=True)
    img.pixels = atlas[::-1].ravel(); out = unit['out']; img.filepath_raw = out + '.png'; img.file_format = 'PNG'; img.save()
    meta = {'cell': [int(cw), int(ch)], 'foot_y': round(float(ay - y0) / D, 2), 'units': {unit['unit']: {'anchor_x': round(float(ax - x0) / D, 2), 'k': round(float(k) * D, 4), 'clips': meta_clips}}, 'size': [int(cols * cw), int(len(rows) * ch)]}
    json.dump(meta, open(out + '.json', 'w'))
    print('DONE', unit['unit'], 'cell', cw, ch, 'body_h', int(body_h), 'k', meta['units'][unit['unit']]['k'], 'size', meta['size'])
