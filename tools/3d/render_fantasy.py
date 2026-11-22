# 奇幻军队精灵图集：人族（蓝金）/ 兽族（红黑），步兵 + 弓兵 + 骑兵
# 用法：Blender -b --factory-startup -P render_fantasy.py -- <human|orc> <输出目录> [test]
import bpy, sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fantasy_common import *
from fantasy_common import _mat, _box, _join
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index('--') + 1:]
SIDE, OUT = argv[0], argv[1]
TEST = len(argv) > 2 and argv[2] == 'test'
HUMAN = SIDE == 'human'
CW, CH, VIEW_W, FOOT_PX = 200, 168, 3.8, 158
HORSE_FBX = f'{Q}/animals/FBX/Horse.fbx'
PARTS = f'{Q}/outfits/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Modular Parts'

bpy.ops.wm.read_factory_settings(use_empty=True)
S = bpy.context.scene
anim = AnimSource()
KEEP = set(anim.arms) | {c for a in anim.arms for c in a.children_recursive}
F_DIR = Vector((0, -1, 0)); UP = Vector((0, 0, 1)); TO_CAM = Vector((-1, 0, 0))   # 画面右 = 世界 -Y

def alive(o):
    try: o.name; return True
    except ReferenceError: return False

def clear_scene():
    for o in list(S.objects):
        if o not in KEEP: bpy.data.objects.remove(o, do_unlink=True)

# ---------- 材质 ----------
if HUMAN:
    M = dict(metal=_mat('steel', (0.78, 0.8, 0.85), metal=1.0, rough=0.28), trim=_mat('gold', (0.95, 0.68, 0.2), metal=1.0, rough=0.3),
             face=_mat('blue', (0.05, 0.16, 0.62), rough=0.45), wood=_mat('wood', (0.25, 0.15, 0.07)), string=_mat('str', (0.9, 0.9, 0.85)))
    CLOTH = [(65, 175, 0.12, 218, 1.4, 1.05), (5, 55, 0.18, 43, 1.15, 1.2)]   # 绿布→蓝；棕皮→金
    CLOTH_PEASANT = [(0, 360, 0.0, 220, 0.0, 1.0)]  # 先占位，下面单独处理
    TEAM_RIM = (0.55, 0.72, 1.0)
else:
    M = dict(metal=_mat('iron', (0.22, 0.22, 0.24), metal=1.0, rough=0.45), trim=_mat('blood', (0.6, 0.04, 0.02), rough=0.4),
             face=_mat('black', (0.035, 0.03, 0.03), metal=0.4, rough=0.45), wood=_mat('darkwood', (0.1, 0.05, 0.03)), string=_mat('str', (0.5, 0.45, 0.4)))
    CLOTH = [(65, 175, 0.12, 358, 1.7, 0.78), (5, 55, 0.18, 10, 0.25, 0.28)]   # 绿布→暗红；棕皮→黑
    TEAM_RIM = (1.0, 0.35, 0.22)

def recolor_peasant(meshes):
    # 农夫上衣（米色/棕色）：人族染成蓝色，兽族染成暗红
    if HUMAN: rules = [(0, 360, 0.0, 220, 0.0, 0.55)]
    else: rules = [(0, 360, 0.0, 357, 0.0, 0.4)]
    # 饱和度为 0 的像素无法通过“乘以饱和度”上色，这里用专门的强制规则：直接设定饱和度
    import numpy as np
    from fantasy_common import _recolor_pixels
    for o in meshes:
        for slot in o.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes: continue
            for n in mat.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image and 'Peasant' in n.image.name and 'Base' in n.image.name:
                    src = n.image; w, h = src.size
                    px = np.array(src.pixels[:], np.float32).reshape(h, w, 4)
                    lum = px[..., :3].mean(-1, keepdims=True)
                    col = np.array((0.07, 0.2, 0.78) if HUMAN else (0.55, 0.03, 0.02), np.float32)
                    px[..., :3] = np.clip(lum * col * 2.2, 0, 1)
                    im = bpy.data.images.new(src.name + '_dyed', w, h, alpha=True); im.pixels = px.ravel(); im.pack(); n.image = im

# ---------- 组装 ----------
def face_right(arm, ref_action, frame, bones=('foot_l', 'foot_r', 'ball_l', 'ball_r')):
    anim.pose(arm, ref_action, frame)
    P = lambda n: arm.matrix_world @ arm.pose.bones[n].head
    d = (P(bones[2]) + P(bones[3])) / 2 - (P(bones[0]) + P(bones[1])) / 2; d.z = 0
    yaw = math.atan2(d.y, d.x) - math.atan2(F_DIR.y, F_DIR.x)
    arm.rotation_euler.z -= yaw; bpy.context.view_layer.update()

def place(obj, arm, bone, world):
    obj.parent = arm; obj.parent_type = 'BONE'; obj.parent_bone = bone
    obj.matrix_parent_inverse = Matrix.Identity(4); bpy.context.view_layer.update()
    obj.matrix_world = world; bpy.context.view_layer.update()

def basis(z_dir, x_hint, pos):
    z = z_dir.normalized(); x = (x_hint - z * x_hint.dot(z)).normalized(); y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4(); m.translation = pos; return m

def helmet():
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.15, segments=20, ring_count=10); d = bpy.context.object
    bpy.ops.object.mode_set(mode='EDIT'); import bmesh
    bm = bmesh.from_edit_mesh(d.data); bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.02], context='VERTS'); bmesh.update_edit_mesh(d.data)
    bpy.ops.object.mode_set(mode='OBJECT'); d.data.materials.append(M['metal'])
    sol = d.modifiers.new('s', 'SOLIDIFY'); sol.thickness = 0.015
    bpy.ops.mesh.primitive_torus_add(major_radius=0.15, minor_radius=0.014, location=(0, 0, -0.01)); rim = bpy.context.object; rim.data.materials.append(M['trim'])
    parts = [d, rim]
    if HUMAN:
        parts.append(_box('nasal', (0.025, 0.02, 0.12), (0.15, 0, -0.06), M['metal']))
        parts.append(_box('crest', (0.22, 0.03, 0.06), (-0.02, 0, 0.16), M['trim']))
    else:
        for s in (-1, 1):
            bpy.ops.mesh.primitive_cone_add(radius1=0.04, radius2=0.0, depth=0.22, location=(0.02, s * 0.15, 0.08), rotation=(math.radians(-s * 55), 0, 0)); h = bpy.context.object; h.data.materials.append(M['trim']); parts.append(h)
    for p in parts:
        bpy.context.view_layer.objects.active = p
        for m in p.modifiers: bpy.ops.object.modifier_apply(modifier=m.name)
    return _join(parts, 'Helmet')   # 本地 +X 朝前，+Z 朝上

def build_soldier(kind):
    body = imp(BODY_HUMAN if HUMAN else BODY_ORC); arm = arm_of(body)
    if kind == 'inf':
        names = ['Male_Peasant_Body', 'Male_Ranger_Arms', 'Male_Ranger_Legs', 'Male_Ranger_Feet_Boots', 'Male_Ranger_Acc_Pauldron']
    else:
        names = ['Male_Ranger_Body', 'Male_Ranger_Arms', 'Male_Ranger_Legs', 'Male_Ranger_Feet_Boots', 'Male_Ranger_Head_Hood', 'Male_Ranger_Acc_Pauldron']
    parts = []
    for n in names:
        o = imp(f'{PARTS}/{n}.gltf'); bind_to(o, arm); parts += [x for x in o if alive(x)]
    meshes = [o for o in body + parts if alive(o) and o.type == 'MESH']
    recolor_materials(meshes, CLOTH, SIDE, extra=lambda k: 'Ranger' in k)
    recolor_peasant(meshes)
    if not HUMAN:  # 兽人皮肤压暗、去饱和，突出红黑
        recolor_materials(meshes, [(0, 360, 0.0, 95, 0.55, 0.62)], 'orcskin', extra=lambda k: 'Orc' in k)
    return arm

def arm_weapons(arm, kind):
    P = lambda n: arm.matrix_world @ arm.pose.bones[n].head
    if kind == 'inf':
        anim.pose(arm, 'Sword_Idle', 1)
        w = make_sword(M['metal'], M['trim']) if HUMAN else make_axe(M['metal'], M['wood'])
        place(w, arm, 'hand_r', basis(F_DIR * 0.55 + UP * 0.85, TO_CAM, P('hand_r')))
        sh = make_shield(M['face'], M['trim'], r=0.32, shape='kite' if HUMAN else 'round')
        mid = (P('lowerarm_l') + P('hand_l')) / 2
        place(sh, arm, 'lowerarm_l', basis(F_DIR * 0.45 + TO_CAM * 0.9, UP, mid + TO_CAM * 0.06))
    else:
        anim.pose(arm, 'Pistol_Aim_Neutral', 1)
        bow = make_bow(M['wood'], M['string'])
        # 弓：弓臂沿竖直方向，向前凸
        m = Matrix((F_DIR, UP.cross(F_DIR), UP)).transposed().to_4x4(); m.translation = P('hand_l')
        place(bow, arm, 'hand_l', m)
    hel = helmet() if kind == 'inf' else None
    if hel:
        anim.pose(arm, 'Walk_Loop', 1)
        hb = arm.pose.bones['Head']; hp = arm.matrix_world @ hb.head
        m = Matrix((F_DIR, UP.cross(F_DIR), UP)).transposed().to_4x4(); m.translation = hp + UP * 0.115 + F_DIR * 0.01
        place(hel, arm, 'Head', m)

def hact(name):
    return next(a for a in bpy.data.actions if a.name.split('|')[-1] == name.split('|')[-1] and 'Armature' in a.name)

def horse_pose(harm, action_name, frame):
    a = hact(action_name); ad = harm.animation_data or harm.animation_data_create(); ad.action = a
    if hasattr(ad, 'action_slot') and ad.action_slot is None and len(getattr(a, 'slots', [])): ad.action_slot = a.slots[0]
    S.frame_set(int(round(frame))); bpy.context.view_layer.update()

def build_cavalry():
    # 马
    before = set(S.objects); bpy.ops.import_scene.fbx(filepath=HORSE_FBX); hobjs = [o for o in S.objects if o not in before]
    harm = arm_of(hobjs); hmesh = next(o for o in hobjs if o.type == 'MESH')
    root = bpy.data.objects.new('HorseRoot', None); S.collection.objects.link(root); harm.parent = root
    horse_pose(harm, 'Walk', 1)
    def wdims():
        dg = bpy.context.evaluated_depsgraph_get(); me = hmesh.evaluated_get(dg).to_mesh()
        pts = [hmesh.matrix_world @ v.co for v in me.vertices]
        lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
        hmesh.evaluated_get(dg).to_mesh_clear(); return hi - lo, lo.z
    dims, zmin = wdims(); k = 2.5 / max(dims.x, dims.y)   # 马身长约 2.5 米
    root.scale = (k, k, k); bpy.context.view_layer.update()
    dims, zmin = wdims(); root.location.z -= zmin; bpy.context.view_layer.update()   # 马蹄落地
    print('horse dims', tuple(round(v, 2) for v in dims))
    for slot in hmesh.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes: continue
        p = mat.node_tree.nodes.get('Principled BSDF')
        if not p: continue
        p.inputs['Alpha'].default_value = 1.0
        if hasattr(mat, 'surface_render_method'): mat.surface_render_method = 'DITHERED'
        print('DBG horse mat', mat.name, tuple(round(v,2) for v in p.inputs['Base Color'].default_value), 'links', [l.from_node.type for l in p.inputs['Base Color'].links])
        c = p.inputs['Base Color'].default_value; lum = (c[0] + c[1] + c[2]) / 3
        if HUMAN: p.inputs['Base Color'].default_value = (0.75 * lum + 0.35, 0.75 * lum + 0.35, 0.75 * lum + 0.38, 1)  # 白马
        else: p.inputs['Base Color'].default_value = (0.25 * lum + 0.02, 0.22 * lum + 0.015, 0.22 * lum + 0.015, 1)  # 黑马
    # 马头朝向画面右侧
    hp = lambda n: harm.matrix_world @ harm.pose.bones[n].head
    d = hp('Head') - hp('Hips'); d.z = 0
    yaw = math.atan2(d.y, d.x) - math.atan2(F_DIR.y, F_DIR.x); root.rotation_euler.z -= yaw; bpy.context.view_layer.update()
    # 马衣（阵营色鞍布）
    back = hp('Back').lerp(hp('Shoulders'), 0.5); spine = (hp('Shoulders') - hp('Hips')).normalized()
    cloth = _box('caparison', (0.75, 0.62, 0.42), (0, 0, 0), M['face']); trim = _box('captrim', (0.78, 0.64, 0.05), (0, 0, -0.2), M['trim'])
    cap = _join([cloth, trim], 'Caparison')
    m = Matrix((spine, UP.cross(spine), UP)).transposed().to_4x4(); m.translation = back - UP * 0.05
    place(cap, harm, 'Back', m)
    # 骑手（坐姿）
    rider = build_soldier('inf'); face_right(rider, 'Walk_Loop', 1); arm_weapons(rider, 'inf')
    # 去掉步兵的盾（骑兵只拿长枪），剑换成长枪
    for o in list(rider.children):
        if o.name.startswith(('Sword', 'Axe', 'Shield')): bpy.data.objects.remove(o, do_unlink=True)
    anim.pose(rider, 'Sitting_Idle_Loop', 1)
    face_dir_fix = None
    # 让骑手臀部落在马背上
    pel = rider.matrix_world @ rider.pose.bones['pelvis'].head
    seat = hp('Back').lerp(hp('Shoulders'), 0.5) + UP * 0.06
    rider.location += (seat - pel); bpy.context.view_layer.update()
    spear = make_spear(M['metal'], M['wood'], length=2.6)
    P = lambda n: rider.matrix_world @ rider.pose.bones[n].head
    place(spear, rider, 'hand_r', basis(F_DIR * 0.95 + UP * 0.32, TO_CAM, P('hand_r')))
    # 骑手跟随马背起伏：父级设为马的 Back 骨骼
    mw = rider.matrix_world.copy(); rider.parent = harm; rider.parent_type = 'BONE'; rider.parent_bone = 'Back'
    rider.matrix_parent_inverse = Matrix.Identity(4); bpy.context.view_layer.update(); rider.matrix_world = mw; bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get(); me = hmesh.evaluated_get(dg).to_mesh(); pts = [hmesh.matrix_world @ v.co for v in me.vertices]
    print('DBG horse bbox', [round(min(p[i] for p in pts),2) for i in range(3)], [round(max(p[i] for p in pts),2) for i in range(3)], 'harm loc', tuple(round(v,2) for v in harm.location), 'scale', tuple(round(v,3) for v in harm.scale), 'rotz', round(math.degrees(harm.rotation_euler.z)))
    print('DBG cap', tuple(round(v,2) for v in cap.matrix_world.translation), 'rider pelvis', tuple(round(v,2) for v in (rider.matrix_world @ rider.pose.bones['pelvis'].head)), 'hmesh vis', hmesh.hide_render, hmesh.visible_get())
    return harm, rider

# ---------- 渲染 ----------
cam, ppm = setup_render(CW, CH, VIEW_W, FOOT_PX, TEAM_RIM)
if TEST: S.render.film_transparent = False; S.world.node_tree.nodes['Background'].inputs[0].default_value = (0.03, 0.035, 0.05, 1)
KEEP |= {o for o in S.objects if o.type in ('LIGHT', 'CAMERA')}
tmp = os.path.join(OUT, f'_tmp_{SIDE}'); os.makedirs(tmp, exist_ok=True)
meta = {'cell': [CW, CH], 'ppm': ppm, 'foot_y': FOOT_PX, 'units': {}}
rows = []
N = (lambda n: max(2, n // 3)) if TEST else (lambda n: n)

def frames_of(a, b, n, loop):
    return [a + (b - a) * i / (n if loop else n - 1) for i in range(n)]

def render_clip(key, unit, n, loop, poser, extra=None):
    paths, ex = [], []
    a, b = poser('range')
    for i, f in enumerate(frames_of(a, b, N(n), loop)):
        poser(f)
        p = os.path.join(tmp, f'{unit}_{key}_{i:02d}.png'); S.render.filepath = p; bpy.ops.render.render(write_still=True)
        paths.append(p); ex.append(extra() if extra else None)
    meta['units'][unit]['clips'][key] = {'row': len(rows), 'n': len(paths), 'loop': loop, 'pt': ex if extra else None}
    rows.append(paths)

def proj(p):
    v = world_to_camera_view(S, cam, p); return [round(v.x * CW, 1), round((1 - v.y) * CH, 1)]

# 步兵 / 弓兵
for unit in (() if os.environ.get('ONLY_CAV') else ('inf', 'arc')):
    clear_scene(); arm = build_soldier(unit); face_right(arm, 'Walk_Loop', 1); arm_weapons(arm, unit)
    anim.pose(arm, 'Walk_Loop', 1)
    meta['units'][unit] = {'anchor_x': proj(arm.matrix_world @ arm.pose.bones['pelvis'].head)[0], 'clips': {}}
    def P(act):
        def f(x):
            if x == 'range': return AnimSource.range(act)
            anim.pose(arm, act, x)
        return f
    hand = lambda: proj(arm.matrix_world @ arm.pose.bones['hand_l'].head)
    if unit == 'inf':
        clips = [('idle', 'Sword_Idle', 6, True), ('walk', 'Walk_Loop', 12, True), ('run', 'Sprint_Loop', 10, True), ('attack', 'Sword_Attack', 8, False), ('death', 'Death01', 12, False)]
    else:
        clips = [('idle', 'Pistol_Idle_Loop', 6, True), ('walk', 'Walk_Loop', 12, True), ('shoot', 'Pistol_Shoot', 6, False), ('death', 'Death01', 12, False)]
    for key, act, n, loop in clips:
        render_clip(key, unit, n, loop, P(act), hand if key == 'shoot' else None)

# 骑兵
clear_scene(); harm, rider = build_cavalry()
horse_pose(harm, 'Armature|Armature|Walk', 1)
meta['units']['cav'] = {'anchor_x': proj(harm.matrix_world @ harm.pose.bones['Back'].head)[0], 'clips': {}}
def HP(act):
    def f(x):
        if x == 'range': a = hact(act); return a.frame_range[0], a.frame_range[1]
        anim.pose(rider, 'Sitting_Idle_Loop', 1); horse_pose(harm, act, x)
    return f
for key, act, n, loop in [('walk', 'Armature|Armature|Walk', 12, True), ('run', 'Armature|Armature|Run', 10, True), ('death', 'Armature|Armature|Death', 12, False)]:
    render_clip(key, 'cav', n, loop, HP(act))

meta['size'] = compose_atlas(rows, CW, CH, os.path.join(OUT, f'army_{SIDE}{"_test" if TEST else ""}.png'))
with open(os.path.join(OUT, f'army_{SIDE}{"_test" if TEST else ""}.json'), 'w') as f: json.dump(meta, f)
print('DONE', meta['size'])
