# 奇幻军队渲染公共函数：组装角色（身体 + 服装 + 程序生成的武器）、按阵营改色、套用动作库动作
import bpy, os, math, colorsys
import numpy as np
from mathutils import Vector, Matrix, Euler

Q = os.path.expanduser('~/AI/btc-battle-assets/quaternius')
BODY_HUMAN = f'{Q}/base/Universal Base Characters[Standard]/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf'
BODY_ORC = f'{Q}/races/Characters - Fantasy Races Kit[Standard]/Exports/GLB (Godot-Unreal)/Orc_Male.glb'
OUTFIT_RANGER = f'{Q}/outfits/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits/Male_Ranger.gltf'
OUTFIT_PEASANT = f'{Q}/outfits/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits/Male_Peasant.gltf'
HAIR_DIR = f'{Q}/base/Universal Base Characters[Standard]/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)'
UAL1 = f'{Q}/ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb'
UAL2 = f'{Q}/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb'

def sc(): return bpy.context.scene

def imp(path):
    before = set(sc().objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in sc().objects if o not in before]

def arm_of(objs): return next(o for o in objs if o.type == 'ARMATURE')

def bind_to(objs, arm):
    """把服装/头发的网格改绑到角色骨架上（骨骼名相同），删除它们自带的骨架"""
    for o in list(objs):
        if o.type == 'MESH' and o.name.startswith('Icosphere'): bpy.data.objects.remove(o, do_unlink=True); objs.remove(o)
    own = [o for o in objs if o.type == 'ARMATURE']
    for o in objs:
        if o.type != 'MESH': continue
        mw = o.matrix_world.copy()
        o.parent = arm; o.matrix_world = mw
        for m in o.modifiers:
            if m.type == 'ARMATURE': m.object = arm
    for a in own: bpy.data.objects.remove(a, do_unlink=True)
    # 修复：权重落在本骨架不存在的骨骼上的顶点（会在动作中留在原地），改绑到胸口
    valid = {b.name for b in arm.data.bones}
    for o in objs:
        try:
            if o.type != 'MESH': continue
        except ReferenceError: continue
        gi = {g.index: g.name for g in o.vertex_groups}
        tgt = o.vertex_groups.get('spine_03') or o.vertex_groups.new(name='spine_03')
        bad = [v.index for v in o.data.vertices if sum(g.weight for g in v.groups if gi.get(g.group) in valid) < 1e-4]
        if bad: tgt.add(bad, 1.0, 'REPLACE'); print('fixed unweighted verts', o.name, len(bad))

# ---------- 改色：按色相选择性替换 ----------
def _recolor_pixels(px, rules):
    rgb = px[..., :3]
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn + 1e-6
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s = np.where(mx > 1e-6, d / (mx + 1e-6), 0); v = mx
    out_h, out_s, out_v = h.copy(), s.copy(), v.copy()
    for (h0, h1, smin, nh, sm, vm) in rules:
        m = (s >= smin) & (((h >= h0) & (h <= h1)) if h0 <= h1 else ((h >= h0) | (h <= h1)))
        out_h = np.where(m, nh, out_h); out_s = np.where(m, np.clip(s * sm, 0, 1), out_s); out_v = np.where(m, np.clip(v * vm, 0, 1), out_v)
    # HSV -> RGB
    hh = (out_h / 60) % 6; c = out_v * out_s; x = c * (1 - np.abs(hh % 2 - 1)); m0 = out_v - c
    z = np.zeros_like(c); i = hh.astype(int)
    rr = np.choose(i, [c, x, z, z, x, c]); gg = np.choose(i, [x, c, c, x, z, z]); bb = np.choose(i, [z, z, x, c, c, x])
    px[..., 0] = rr + m0; px[..., 1] = gg + m0; px[..., 2] = bb + m0
    return px

def recolor_materials(objs, rules, tag, extra=None):
    """对这些网格用到的所有底色贴图按规则改色（贴图复制一份，不影响其他角色）"""
    done = {}
    for o in objs:
        if o.type != 'MESH': continue
        for slot in o.material_slots:
            mat = slot.material
            if not mat or not mat.use_nodes: continue
            for n in mat.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image and ('Base' in n.image.name or 'Color' in n.image.name or 'BaseColor' in n.image.name):
                    key = n.image.name
                    if extra and not extra(key): continue
                    if key not in done:
                        src = n.image; w, h = src.size
                        px = np.array(src.pixels[:], np.float32).reshape(h, w, 4)
                        px = _recolor_pixels(px, rules)
                        im = bpy.data.images.new(f'{key}_{tag}', w, h, alpha=True)
                        im.pixels = px.ravel(); im.pack(); done[key] = im
                    n.image = done[key]

# ---------- 程序生成的武器 ----------
def _mat(name, color, metal=0.0, rough=0.5, emit=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1); p.inputs['Metallic'].default_value = metal; p.inputs['Roughness'].default_value = rough
    return m

def _box(name, size, loc, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o = bpy.context.object; o.name = name
    o.scale = size; bpy.ops.object.transform_apply(scale=True); o.data.materials.append(mat); return o

def _join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join(); o = bpy.context.object; o.name = name; return o

def make_sword(metal, trim, length=0.8):
    blade = _box('blade', (0.05, 0.012, length), (0, 0, length / 2 + 0.06), metal)
    guard = _box('guard', (0.22, 0.04, 0.035), (0, 0, 0.06), trim)
    grip = _box('grip', (0.03, 0.03, 0.14), (0, 0, -0.02), _mat('grip', (0.12, 0.08, 0.05)))
    return _join([blade, guard, grip], 'Sword')   # 握把在原点，剑身沿 +Z

def make_axe(metal, wood):
    shaft = _box('shaft', (0.035, 0.035, 0.85), (0, 0, 0.3), wood)
    head = _box('axehead', (0.26, 0.02, 0.2), (0.11, 0, 0.66), metal)
    return _join([shaft, head], 'Axe')

def make_shield(face, rim, r=0.3, shape='round'):
    if shape == 'kite':
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=r, depth=0.04); s = bpy.context.object
        s.scale = (0.75, 1.0, 1.0)
    else:
        bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=r, depth=0.04); s = bpy.context.object
    bpy.ops.object.transform_apply(scale=True); s.data.materials.append(face)
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.025); t = bpy.context.object
    if shape == 'kite': t.scale = (0.75, 1.0, 1.0); bpy.ops.object.transform_apply(scale=True)
    t.data.materials.append(rim)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.06, location=(0, 0, 0.03)); boss = bpy.context.object; boss.data.materials.append(rim)
    return _join([s, t, boss], 'Shield')   # 盾面朝 +Z

def make_bow(wood, string_col):
    curve = bpy.data.curves.new('bowc', 'CURVE'); curve.dimensions = '3D'; curve.bevel_depth = 0.018
    sp = curve.splines.new('BEZIER'); sp.bezier_points.add(2)
    pts = [(0, 0, -0.65), (0.22, 0, 0), (0, 0, 0.65)]
    for bp, p in zip(sp.bezier_points, pts): bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    bow = bpy.data.objects.new('BowLimb', curve); sc().collection.objects.link(bow); curve.materials.append(wood)
    bpy.context.view_layer.objects.active = bow; bow.select_set(True); bpy.ops.object.convert(target='MESH')
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.005, depth=1.3); st = bpy.context.object; st.data.materials.append(string_col)
    return _join([bow, st], 'Bow')

def make_spear(metal, wood, length=2.4):
    shaft = _box('shaft', (0.04, 0.04, length), (0, 0, length / 2 - 0.6), wood)
    tip = _box('tip', (0.07, 0.015, 0.25), (0, 0, length - 0.48), metal)
    return _join([shaft, tip], 'Spear')

def attach_to_bone(obj, arm, bone_name, loc=(0, 0, 0), rot=(0, 0, 0)):
    obj.parent = arm; obj.parent_type = 'BONE'; obj.parent_bone = bone_name
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.location = loc; obj.rotation_euler = Euler([math.radians(a) for a in rot])

# ---------- 动作：从动作库骨架逐帧复制（骨骼完全相同） ----------
class AnimSource:
    def __init__(self):
        objs = imp(UAL1) + imp(UAL2)
        self.arms = [o for o in objs if o.type == 'ARMATURE']
        for o in objs:
            if o.type == 'MESH': o.hide_render = True; o.hide_viewport = True
        self.src = self.arms[0]; self.src.animation_data_create()
    def pose(self, tgt, action_name, frame, hip_scale=1.0):
        act = bpy.data.actions[action_name]
        ad = self.src.animation_data; ad.action = act
        if hasattr(ad, 'action_slot') and ad.action_slot is None and len(getattr(act, 'slots', [])): ad.action_slot = act.slots[0]
        sc().frame_set(int(round(frame))); bpy.context.view_layer.update()
        sp = self.src.pose.bones
        for pb in tgt.pose.bones:
            s = sp.get(pb.name)
            if not s: continue
            mb = s.matrix_basis.copy()
            if pb.name not in ('root', 'pelvis'): mb.translation = Vector((0, 0, 0))
            else: mb.translation = mb.translation * hip_scale
            pb.matrix_basis = mb
        bpy.context.view_layer.update()
    @staticmethod
    def range(action_name):
        a = bpy.data.actions[action_name]; return a.frame_range[0], a.frame_range[1]

# ---------- 场景：灯光与相机 ----------
def setup_render(cw, ch, view_w, foot_px, team_rgb, cam_dist=10):
    s = sc()
    def light(n, energy, color, rot):
        d = bpy.data.lights.new(n, 'SUN'); d.energy = energy; d.color = color; d.angle = math.radians(6)
        o = bpy.data.objects.new(n, d); o.rotation_euler = [math.radians(a) for a in rot]; s.collection.objects.link(o)
    light('key', 4.5, (1.0, 0.95, 0.88), (40, 0, -50))       # 暖色主光（火把/夕阳）
    light('rim', 7.0, team_rgb, (65, 0, 125))                 # 阵营色轮廓光
    light('fill', 1.4, (0.65, 0.7, 0.9), (100, 0, -95))
    w = bpy.data.worlds.new('w'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs[1].default_value = 0.35; s.world = w
    s.render.engine = 'BLENDER_EEVEE'; s.render.film_transparent = True
    s.render.resolution_x = cw; s.render.resolution_y = ch; s.view_settings.view_transform = 'Standard'
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); s.collection.objects.link(cam); s.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = view_w
    ppm = cw / view_w; cam_z = (foot_px - ch / 2) / ppm
    cam.location = (-cam_dist, 0, cam_z); cam.rotation_euler = (math.radians(90), 0, math.radians(-90))
    return cam, ppm

def compose_atlas(rows, cw, ch, out_png):
    cols = max(len(r) for r in rows)
    atlas = np.zeros((len(rows) * ch, cols * cw, 4), np.float32)
    for r, paths in enumerate(rows):
        for c, p in enumerate(paths):
            im = bpy.data.images.load(p); a = np.array(im.pixels[:], np.float32).reshape(ch, cw, 4)
            y0 = (len(rows) - 1 - r) * ch; atlas[y0:y0 + ch, c * cw:(c + 1) * cw] = a; bpy.data.images.remove(im)
    img = bpy.data.images.new('atlas', cols * cw, len(rows) * ch, alpha=True)
    img.pixels = atlas.ravel(); img.filepath_raw = out_png; img.file_format = 'PNG'; img.save()
    return [cols * cw, len(rows) * ch]
