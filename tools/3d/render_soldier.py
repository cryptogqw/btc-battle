# 把写实士兵模型 + 借来的 Mixamo 动作渲染成侧视精灵图集（透明背景）
# 用法：Blender -b --factory-startup -P render_soldier.py -- <模型名> <阵营 blue|red> <输出目录>
import bpy, os, sys, math, re, json
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index('--') + 1:]
NAME, SIDE, OUT = argv[0], argv[1], argv[2]
M = os.path.expanduser('~/AI/btc-battle-assets/models')
CW, CH = 176, 144          # 单帧尺寸（像素）
VIEW_W = 3.0               # 单帧覆盖的世界宽度（米）
FOOT_PX = 132              # 脚底在单帧中的像素高度（从上往下）
# 动作：(名字, 来源动作, 采样帧数, 是否循环)
CLIPS = [
    ('idle', 'idle simple', 8, True),
    ('walk', 'simple walk', 12, True),
    ('run', 'run', 10, True),
    ('shoot', 'simple shoot', 4, True),
    ('crouch', 'crouch shoot', 6, True),
    ('death', 'simple death', 14, False),
]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

def imp(f):
    before = set(sc.objects); bpy.ops.import_scene.gltf(filepath=f'{M}/{f}.glb'); return [o for o in sc.objects if o not in before]

tgt_objs = imp(NAME)
src_objs = imp('army24')
tgt = next(o for o in tgt_objs if o.type == 'ARMATURE'); src = next(o for o in src_objs if o.type == 'ARMATURE')
for o in src_objs:
    if o.type == 'MESH': o.hide_render = True
for o in tgt_objs:
    if o.type == 'MESH' and o.name.startswith('Icosphere'): o.hide_render = True

base = lambda n: re.sub(r'_\d+$', '', n.split(':')[-1]) if 'mixamorig' in n else None
smap = {base(b.name): b for b in src.pose.bones if base(b.name)}
pairs = [(t, smap[base(t.name)]) for t in tgt.pose.bones if base(t.name) in smap]
bone = lambda arm, key: next(b for b in arm.pose.bones if base(b.name) == key)
hip_ratio = bone(tgt, 'Hips').bone.head_local.length / max(1e-6, bone(src, 'Hips').bone.head_local.length)

# 原模型里单独做动画的配件（步枪、弹匣包、夜视仪等）：步枪沿双手连线摆放，其余挂到胸口/头部
from mathutils import Matrix
sc.frame_set(1); bpy.context.view_layer.update()
props = [o for o in tgt_objs if o.type == 'EMPTY' and o.animation_data and o.animation_data.action]
vcount = lambda e: sum(len(c.data.vertices) for c in e.children_recursive if c.type == 'MESH')
rifle = max(props, key=vcount, default=None)
rifle_meshes = [c for c in (rifle.children_recursive if rifle else []) if c.type == 'MESH']
print('rifle =', rifle.name if rifle else None)
W = lambda pb: tgt.matrix_world @ pb.matrix
RH, LH, HEAD, CHEST = bone(tgt, 'RightHand'), bone(tgt, 'LeftHand'), bone(tgt, 'Head'), bone(tgt, 'Spine2')
attach = []
for e in props:
    if e is rifle: continue
    wp = e.matrix_world.translation
    pb = HEAD if ((tgt.matrix_world @ HEAD.head) - wp).length < 0.22 else CHEST
    attach.append((e, pb, W(pb).inverted() @ e.matrix_world)); print('attach', e.name, '->', pb.name)
def grip_basis():
    a = tgt.matrix_world @ RH.head; b = tgt.matrix_world @ LH.head
    d = (b - a); d = d.normalized() if d.length > 1e-4 else Vector((0, -1, 0))
    up = Vector((0, 0, 1)); up = (up - d * up.dot(d)); up = up.normalized() if up.length > 1e-4 else Vector((1, 0, 0))
    side = d.cross(up)
    m = Matrix((d, side, up)).transposed().to_4x4(); m.translation = a; return m
rifle_rel = grip_basis().inverted() @ rifle.matrix_world if rifle else None
for e in props: e.animation_data.action = None
tgt.animation_data.action = None
STATE = {'stick': None}  # 倒地时：步枪固定在右手上

# 灯光：冷色月光主光 + 阵营色轮廓光（从身后打来）+ 暖色火光补光
TEAM = {'blue': (0.45, 0.65, 1.0), 'red': (1.0, 0.42, 0.32)}[SIDE]
def light(n, energy, color, rot):
    d = bpy.data.lights.new(n, 'SUN'); d.energy = energy; d.color = color; d.angle = math.radians(8)
    o = bpy.data.objects.new(n, d); o.rotation_euler = [math.radians(a) for a in rot]; sc.collection.objects.link(o)
light('key', 4.0, (0.82, 0.86, 1.0), (45, 0, -55))
light('rim', 9.0, TEAM, (65, 0, 125))
light('fire', 2.2, (1.0, 0.6, 0.3), (80, 0, 40))
light('fill', 1.0, (0.6, 0.65, 0.8), (100, 0, -90))
w = bpy.data.worlds.new('w'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs[1].default_value = 0.25; sc.world = w
sc.render.engine = 'BLENDER_EEVEE'; sc.render.film_transparent = True
sc.render.resolution_x = CW; sc.render.resolution_y = CH
sc.view_settings.view_transform = 'Standard'
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = VIEW_W
ppm = CW / VIEW_W
cam_z = (FOOT_PX - CH / 2) / ppm   # 让 z=0（脚底）落在 FOOT_PX 处
cam.location = (-8, 0, cam_z); cam.rotation_euler = (math.radians(90), 0, math.radians(-90))

def pose_at(action, f):
    src.animation_data.action = action; sc.frame_set(int(round(f)))
    for t, s in pairs:
        mb = s.matrix_basis.copy()
        mb.translation = mb.translation * hip_ratio if base(t.name) == 'Hips' else Vector((0, 0, 0))
        t.matrix_basis = mb
    bpy.context.view_layer.update()
    for e, pb, off in attach: e.matrix_world = W(pb) @ off
    if rifle:
        rifle.matrix_world = (W(RH) @ STATE['stick']) if STATE['stick'] is not None else (grip_basis() @ rifle_rel)
    bpy.context.view_layer.update()

def muzzle_px():
    pts = []
    for m in rifle_meshes:
        for c in m.bound_box: pts.append(m.matrix_world @ Vector(c))
    if not pts: return None
    best = max(pts, key=lambda p: world_to_camera_view(sc, cam, p).x)
    v = world_to_camera_view(sc, cam, best)
    return [round(v.x * CW, 1), round((1 - v.y) * CH, 1)]

src.animation_data_create()
tmp = os.path.join(OUT, f'_tmp_{NAME}'); os.makedirs(tmp, exist_ok=True)
meta = {'cell': [CW, CH], 'foot': [None, FOOT_PX], 'ppm': ppm, 'clips': {}}
rows = []
for key, act_name, n, loop in CLIPS:
    act = bpy.data.actions[act_name]; a, b = act.frame_range
    span = (b - a) if not loop else (b - a)  # 循环动作不重复最后一帧
    frames = [a + span * i / (n if loop else n - 1) for i in range(n)]
    paths, muz = [], []
    STATE['stick'] = None
    if key == 'death' and rifle:
        pose_at(act, frames[0]); STATE['stick'] = W(RH).inverted() @ rifle.matrix_world
    for i, f in enumerate(frames):
        pose_at(act, f)
        if i == 0 and key == 'idle':  # 记录角色中心 x，用作锚点
            hip = tgt.matrix_world @ bone(tgt, 'Hips').head
            meta['foot'][0] = round(world_to_camera_view(sc, cam, Vector((hip.x, hip.y, 0))).x * CW, 1)
        p = os.path.join(tmp, f'{key}_{i:02d}.png'); sc.render.filepath = p; bpy.ops.render.render(write_still=True)
        paths.append(p); muz.append(muzzle_px() if key in ('shoot', 'crouch', 'idle', 'walk', 'run') else None)
    meta['clips'][key] = {'row': len(rows), 'n': n, 'loop': loop, 'muzzle': muz}
    rows.append(paths)

cols = max(len(r) for r in rows)
atlas = np.zeros((len(rows) * CH, cols * CW, 4), np.float32)
for r, paths in enumerate(rows):
    for c, p in enumerate(paths):
        im = bpy.data.images.load(p); a = np.array(im.pixels[:], np.float32).reshape(CH, CW, 4)
        y0 = (len(rows) - 1 - r) * CH; atlas[y0:y0 + CH, c * CW:(c + 1) * CW] = a
        bpy.data.images.remove(im)
img = bpy.data.images.new('atlas', cols * CW, len(rows) * CH, alpha=True)
img.pixels = atlas.ravel(); img.filepath_raw = os.path.join(OUT, f'soldier_{SIDE}.png'); img.file_format = 'PNG'; img.save()
meta['size'] = [cols * CW, len(rows) * CH]
with open(os.path.join(OUT, f'soldier_{SIDE}.json'), 'w') as f: json.dump(meta, f)
print('DONE', meta['size'], json.dumps({k: v['n'] for k, v in meta['clips'].items()}))
