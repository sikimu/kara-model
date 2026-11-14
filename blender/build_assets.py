# assets/character.glb、assets/room.glb、assets/npc.glb を作る。
# 使い方: blender -b -P blender/build_assets.py
#
# 位置は three.js の座標（x: 右、y: 上、z: 手前）で書き、T() で Blender の座標に直す。
# キャラクターは +z（手前）を向く。部品は名前で three.js 側から動かす。

import math
import os

import bmesh
import bpy

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')


def T(x, y, z):
    """three.js の位置 → Blender の位置"""
    return (x, -z, y)


def S(w, h, d):
    """three.js の大きさ（幅、高さ、奥行き）→ Blender の大きさ"""
    return (w, d, h)


def RZ(deg):
    """three.js の z 軸まわりの回転 → Blender の回転"""
    return (0, -math.radians(deg), 0)


def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)


_mats = {}


def mat(name, rgb, rough=0.7, metal=0.0, glow=0.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nodes = m.node_tree.nodes
    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        nodes.clear()
        out = nodes.new('ShaderNodeOutputMaterial')
        bsdf = nodes.new('ShaderNodeBsdfPrincipled')
        m.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    lin = [c ** 2.2 for c in rgb]  # 見た目の色（sRGB）→ リニア
    bsdf.inputs['Base Color'].default_value = (*lin, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if glow > 0 and 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = (*lin, 1.0)
        bsdf.inputs['Emission Strength'].default_value = glow
    _mats[name] = m
    return m


def _finish(name, bm, material, loc, parent, smooth):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth(p)
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.parent = parent
    return ob


def sphere(name, r, material, loc, scale=(1, 1, 1), parent=None, rot=(0, 0, 0), seg=48):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    ob = _finish(name, bm, material, loc, parent, lambda p: True)
    ob.rotation_euler = rot
    return ob


def box(name, size, material, loc, parent=None, bevel=0.03, rot=(0, 0, 0), segments=5):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    ob = _finish(name, bm, material, loc, parent, lambda p: False)
    ob.rotation_euler = rot
    if bevel > 0:
        mod = ob.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.harden_normals = True
        normal = ob.modifiers.new('weighted_normals', 'WEIGHTED_NORMAL')
        normal.keep_sharp = True
    return ob


def cone(name, r1, r2, depth, material, loc, parent=None, rot=(0, 0, 0), caps=True, segments=64):
    """Blender の Z 軸（three.js の上方向）に沿った円すい台。r1 が下、r2 が上"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segments,
                          radius1=r1, radius2=r2, depth=depth)
    ob = _finish(name, bm, material, loc, parent, lambda p: len(p.vertices) == 4)
    ob.rotation_euler = rot
    return ob


def empty(name, loc, parent=None, scale=(1, 1, 1)):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.scale = scale
    ob.parent = parent
    return ob


def export(filename):
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, filename),
        export_format='GLB',
        export_apply=True,
        export_yup=True,
    )


def rnd(i, salt=0.0):
    """乱数の代わりの、毎回同じになるばらつき（0〜1）"""
    return (math.sin(i * 12.9898 + salt * 78.233) * 43758.5453) % 1.0


# ---------------------------------------------------------------- キャラクター
# 部品の名前（three.js 側で動かす）:
#   character > body > head > eyeL / eyeR / sprout
#                    > armL / armR
#             > footL / footR

def polish_surfaces():
    """対象アセットだけの法線仕上げ。共有プリミティブと原点は変更しない。"""
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        bevel = next((m for m in ob.modifiers if m.type == 'BEVEL'), None)
        if bevel:
            # 面取りをフラットシェードすると分割ごとの帯が見えてしまう。
            for face in ob.data.polygons:
                face.use_smooth = True
            if not any(m.type == 'WEIGHTED_NORMAL' for m in ob.modifiers):
                normal = ob.modifiers.new('surface_normals', 'WEIGHTED_NORMAL')
                normal.keep_sharp = True
        elif ob.name in {'plant_pot', 'fountain_base', 'fountain_bowl',
                         'npc_hat_brim', 'plaza_circle', 'plaza_circle_in'}:
            bevel = ob.modifiers.new('rounded_rim', 'BEVEL')
            bevel.width = min(.018, min(ob.dimensions) * .22)
            bevel.segments = 3
            bevel.limit_method = 'ANGLE'
            for face in ob.data.polygons:
                face.use_smooth = True
            normal = ob.modifiers.new('surface_normals', 'WEIGHTED_NORMAL')
            normal.keep_sharp = True


def build_character():
    """主人公。タイトル絵（assets/journey-home.png）の丸みと表情に合わせる"""
    reset()
    skin = mat('skin', (0.995, 0.94, 0.84), rough=0.72)
    dark = mat('eye_dark', (0.34, 0.22, 0.16), rough=0.45)
    white = mat('eye_white', (1.0, 0.98, 0.92), rough=0.5, glow=0.15)
    pink = mat('pink', (0.98, 0.70, 0.61), rough=0.95)
    ear_in = mat('ear_in', (0.97, 0.77, 0.68), rough=0.95)
    mouth = mat('mouth', (0.40, 0.27, 0.19), rough=0.9)
    scarf = mat('scarf', (0.49, 0.63, 0.79), rough=0.86)
    stem = mat('stem', (0.5, 0.7, 0.3), rough=0.6)
    leaf = mat('leaf_new', (0.56, 0.76, 0.33), rough=0.55)

    root = empty('character', (0, 0, 0))
    # 足（体と同じ色の、短くて丸い足）
    for side, x in (('L', -0.125), ('R', 0.125)):
        foot = empty('foot' + side, T(x, 0.11, 0.0), root)
        sphere('foot_mesh' + side, 0.125, skin, (0, 0, 0), scale=(1.05, 1.22, 0.95), parent=foot)

    # 体（下ぶくれの洋なし形）
    body = empty('body', T(0, 0.4, 0), root)
    torso = sphere('torso', 0.30, skin, T(0, -0.02, 0), scale=(1.0, 0.95, 1.02), parent=body, seg=48)
    # 二つの球の段差をなくし、下側が少しふくらむ一続きの体にする。
    for vertex in torso.data.vertices:
        fullness = 1 - 0.13 * vertex.co.z / 0.306
        vertex.co.x *= fullness
        vertex.co.y *= fullness
    sphere('tail', 0.09, skin, T(0, -0.13, -0.28), parent=body)
    # マフラー（首に巻いて、前に垂らす）
    sphere('scarf_ring', 0.32, scarf, T(0, 0.18, 0), scale=(1.08, 1.0, 0.32), parent=body)
    sphere('scarf_fold', 0.31, scarf, T(0, 0.15, 0.025), scale=(1.08, 1.0, 0.17), parent=body)
    sphere('scarf_knot', 0.08, scarf, T(0.22, 0.14, 0.22), scale=(1.1, 0.8, 0.9), parent=body)
    box('scarf_tail', S(0.17, 0.29, 0.065), scarf, T(0.26, -0.02, 0.25), parent=body, bevel=0.032,
        rot=RZ(16))
    box('scarf_tail_back', S(0.15, 0.21, 0.06), scarf, T(0.31, 0.01, 0.16), parent=body, bevel=0.028,
        rot=RZ(35))
    # 腕（肩を中心に回して上げ下げする。短くて先が丸い）
    for side, x in (('L', -1), ('R', 1)):
        arm = empty('arm' + side, T(x * 0.28, 0.08, 0.025), body)
        sphere('arm_mesh' + side, 0.104, skin, T(x * 0.03, -0.10, 0), scale=(0.96, 0.96, 1.42),
               parent=arm, rot=RZ(x * 12))

    # 頭（横に広く、少しつぶれた玉）
    head = empty('head', T(0, 0.50, 0), body)
    head_mesh = sphere('head_mesh', 0.44, mat('face_skin', (1, 1, 1), rough=0.95),
                       (0, 0, 0), scale=(1.20, 0.94, 0.98), parent=head, seg=96)
    # 頬は球を貼らず、頂点色で肌にぼかす。横顔でも突起にならない。
    colors = head_mesh.data.color_attributes.new(name='face_tint', type='FLOAT_COLOR', domain='POINT')
    for vertex, color in zip(head_mesh.data.vertices, colors.data):
        x, depth, height = vertex.co
        blush = math.exp(-((abs(x) - 0.335) / 0.085) ** 2 - ((height + 0.15) / 0.055) ** 2)
        blush *= max(0, min(1, (-depth - 0.12) / 0.1))
        base, rosy = (0.995, 0.94, 0.84), (0.98, 0.70, 0.61)
        color.color = (*((a * (1 - blush) + b * blush) ** 2.2 for a, b in zip(base, rosy)), 1)
    face_mat = head_mesh.data.materials[0]
    vertex_color = face_mat.node_tree.nodes.new('ShaderNodeVertexColor')
    vertex_color.layer_name = 'face_tint'
    bsdf = next(n for n in face_mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    face_mat.node_tree.links.new(vertex_color.outputs['Color'], bsdf.inputs['Base Color'])
    for side, x in (('L', -1), ('R', 1)):
        sphere('ear' + side, 0.17, skin, T(x * 0.375, 0.30, -0.025), scale=(1, 0.6, 1), parent=head)
        sphere('ear_in' + side, 0.106, ear_in, T(x * 0.375, 0.30, 0.065), scale=(1, 0.28, 1), parent=head)
        # タイトル絵の、茶色い大きな目とひとつの柔らかい光。
        eye = empty('eye' + side, T(x * 0.202, -0.022, 0.379), head)
        sphere('eye_iris' + side, 0.111, dark, (0, 0, 0), scale=(0.88, 0.32, 1.08), parent=eye)
        sphere('eye_light' + side, 0.031, white, T(-0.023, 0.045, 0.034), scale=(1, 0.38, 1), parent=eye, seg=20)
    # 鼻先の突起は作らず、頬に沿った小さな w 字の笑顔にする。
    for side, x in (('L', -1), ('R', 1)):
        curve = bpy.data.curves.new('smile' + side, 'CURVE')
        curve.dimensions = '3D'
        curve.bevel_depth = 0.007
        curve.bevel_resolution = 3
        spline = curve.splines.new('POLY')
        spline.points.add(16)
        for i, point in enumerate(spline.points):
            k = i / 16
            point.co = (*T(x * k * 0.056, -0.13 - math.sin(k * math.pi) * 0.024, 0.397), 1)
        ob = bpy.data.objects.new('mouth' + side, curve)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = head
        curve.materials.append(mouth)
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.convert(target='MESH')
        ob.select_set(False)
    # 頭のてっぺんの芽（双葉）。育つと大きくなる
    sprout = empty('sprout', T(0, 0.42, 0), head)
    cone('sprout_stem', 0.02, 0.016, 0.17, stem, T(0, 0.085, 0), parent=sprout)
    for side, x in (('L', -1), ('R', 1)):
        sphere('sprout_leaf' + side, 0.115, leaf, T(x * 0.13, 0.2, 0), scale=(1.4, 0.55, 0.7),
               parent=sprout, rot=RZ(x * 20))
    polish_surfaces()
    export('character.glb')


# ---------------------------------------------------------------- 家と広場
def flower(i, x, z):
    colors = [(0.98, 0.55, 0.6), (1.0, 0.85, 0.4), (0.75, 0.6, 0.95), (1.0, 1.0, 1.0)]
    h = 0.22 + rnd(i) * 0.14
    cone(f'flower_stem{i}', 0.012, 0.012, h, mat('stem', (0.5, 0.74, 0.42)), T(x, h / 2, z))
    petal = mat(f'petal{i % 4}', colors[i % 4], rough=0.6)
    for k in range(5):
        a = k / 5 * math.tau
        sphere(f'flower_p{i}_{k}', 0.045, petal, T(x + math.cos(a) * 0.05, h, z + math.sin(a) * 0.05),
               scale=(1, 1, 0.5), seg=12)
    sphere(f'flower_c{i}', 0.035, mat('flower_center', (1.0, 0.8, 0.3)), T(x, h + 0.015, z), seg=12)


def tree(name, x, z, scale=1.0):
    wood_dark = mat('wood_dark', (0.6, 0.44, 0.3))
    leaf = mat('leaf', (0.42, 0.68, 0.4), rough=0.9)
    leaf_light = mat('leaf_light', (0.56, 0.78, 0.45), rough=0.9)
    t = empty(name, T(x, 0, z), scale=(scale, scale, scale))
    cone(name + '_trunk', 0.2, 0.13, 1.5, wood_dark, T(0, 0.75, 0), parent=t)
    sphere(name + '_top0', 0.95, leaf, T(0, 2.1, 0), parent=t)
    sphere(name + '_top1', 0.65, leaf_light, T(0.55, 1.75, 0.3), parent=t)
    sphere(name + '_top2', 0.6, leaf_light, T(-0.5, 1.8, 0.2), parent=t)
    sphere(name + '_top3', 0.5, leaf, T(0.1, 2.75, -0.1), parent=t)
    return t


def shop(name, x, z, color, sign):
    """まちの ひろば に建つ小さなお店"""
    wall = mat(name + '_wall', color, rough=0.9)
    roof = mat(name + '_roof', sign, rough=0.8)
    trim = mat('trim', (0.98, 0.97, 0.94), rough=0.8)
    wood_dark = mat('wood_dark', (0.6, 0.44, 0.3))
    s = empty(name, T(x, 0, z))
    box(name + '_body', S(2.3, 1.9, 1.6), wall, T(0, 0.95, 0), parent=s, bevel=0.04)
    box(name + '_roof', S(2.6, 0.28, 1.95), roof, T(0, 2.02, 0), parent=s, bevel=0.06)
    box(name + '_roof2', S(2.0, 0.22, 1.4), roof, T(0, 2.25, 0), parent=s, bevel=0.06)
    box(name + '_awning', S(2.4, 0.08, 0.7), roof, T(0, 1.42, 1.05), parent=s, bevel=0.02,
        rot=(math.radians(-14), 0, 0))
    box(name + '_door', S(0.55, 1.05, 0.06), wood_dark, T(-0.6, 0.53, 0.81), parent=s, bevel=0.02)
    sphere(name + '_knob', 0.04, mat('knob', (0.95, 0.8, 0.3), metal=0.5, rough=0.3),
           T(-0.42, 0.52, 0.85), parent=s, seg=12)
    box(name + '_win_frame', S(0.95, 0.75, 0.06), trim, T(0.5, 0.85, 0.81), parent=s, bevel=0.02)
    box(name + '_win', S(0.8, 0.6, 0.07), mat('glass', (0.7, 0.88, 0.98), rough=0.15, glow=0.4),
        T(0.5, 0.85, 0.82), parent=s, bevel=0)
    box(name + '_counter', S(1.0, 0.07, 0.25), wood_dark, T(0.5, 0.45, 0.92), parent=s, bevel=0.02)
    box(name + '_sign', S(1.1, 0.34, 0.06), trim, T(0, 1.72, 0.82), parent=s, bevel=0.03)
    # 縞の日よけと店先の商品。文字を使わずパン屋と花屋を見分けられる。
    for i in range(6):
        box(name + f'_stripe{i}', S(0.19, 0.025, 0.69), trim,
            T(-1.0 + i * 0.4, 1.47, 1.05), parent=s, bevel=0.005,
            rot=(math.radians(-14), 0, 0))
    box(name + '_display', S(1.15, 0.48, 0.55), wood_dark, T(0.5, 0.24, 1.38), parent=s)
    if name == 'shop_a':
        bread = mat('bread', (0.94, 0.68, 0.32))
        for i in range(3):
            sphere(name + f'_bread{i}', 0.16, bread, T(0.14 + i * 0.34, 0.58, 1.38),
                   scale=(0.85, 1.4, 0.6), parent=s, seg=16)
        sphere(name + '_bread_sign', 0.22, bread, T(0, 1.73, 0.87), scale=(1.7, 0.3, 0.48), parent=s)
    else:
        for i in range(3):
            pot = mat('town_pot', (0.75, 0.43, 0.3))
            cone(name + f'_pot{i}', 0.1, 0.14, 0.2, pot, T(0.16 + i * 0.34, 0.57, 1.38), parent=s)
            for j in range(3):
                sphere(name + f'_bloom{i}_{j}', 0.09, mat('town_bloom' + str(i),
                       [(0.98, 0.65, 0.65), (0.99, 0.85, 0.38), (0.72, 0.65, 0.91)][i]),
                       T(0.16 + i * 0.34 + (j - 1) * 0.08, 0.76 + (j % 2) * 0.08, 1.38), parent=s, seg=12)
        for i in range(5):
            a = i * math.tau / 5
            sphere(name + f'_petal_sign{i}', 0.09, roof,
                   T(math.cos(a) * 0.12, 1.73 + math.sin(a) * 0.12, 0.87), scale=(1, 0.3, 1), parent=s, seg=12)
    return s


def build_room():
    reset()
    wood = mat('wood', (0.86, 0.72, 0.54), rough=0.48)
    wood_dark = mat('wood_dark', (0.6, 0.44, 0.3))
    plank = mat('plank_line', (0.74, 0.6, 0.44))
    wall = mat('wall', (0.86, 0.92, 0.9), rough=0.9)
    trim = mat('trim', (0.98, 0.97, 0.94), rough=0.8)
    rug = mat('rug', (0.98, 0.88, 0.72), rough=0.95)
    rug_edge = mat('rug_edge', (0.9, 0.6, 0.48), rough=0.95)
    board = mat('board', (0.18, 0.29, 0.24), rough=0.9)
    white = mat('white', (0.97, 0.97, 0.95), rough=0.8)
    blue = mat('blue', (0.6, 0.76, 0.9), rough=0.9)
    wicker = mat('wicker', (0.8, 0.62, 0.38), rough=0.9)
    books = [mat(f'book{i}', c) for i, c in enumerate([
        (0.9, 0.5, 0.42), (0.95, 0.78, 0.4), (0.55, 0.75, 0.6),
        (0.5, 0.68, 0.88), (0.75, 0.6, 0.85), (0.95, 0.65, 0.75)])]

    W, D, H = 8.6, 6.4, 4.2  # 歩ける中央の床を広げる。家具の大きさは維持。

    # ---- 家 ----
    box('floor', S(W, 0.2, D), wood, T(0, -0.1, 0), bevel=0)
    for i in range(1, 8):
        box(f'plank{i}', S(W, 0.006, 0.025), plank, T(0, 0.003, -D / 2 + i * 0.8), bevel=0)
    cone('rug_edge', 1.5, 1.5, 0.02, rug_edge, T(0, 0.012, 0.5))
    cone('rug', 1.32, 1.32, 0.035, rug, T(0, 0.02, 0.5))
    box('wall_back', S(W, H, 0.2), wall, T(0, H / 2, -D / 2 - 0.1), bevel=0)
    # 左の壁は手前を空けて、外の広場への出入り口にする
    box('wall_left', S(0.2, H, 5.2), wall, T(-W / 2 - 0.1, H / 2, -0.7), bevel=0)
    box('wall_right', S(0.2, H, D + 0.2), wall, T(W / 2 + 0.1, H / 2, -0.1), bevel=0)
    box('base_back', S(W, 0.14, 0.05), trim, T(0, 0.07, -D / 2 + 0.025), bevel=0.01)
    box('base_right', S(0.05, 0.14, D), trim, T(W / 2 - 0.025, 0.07, 0), bevel=0.01)
    box('base_left', S(0.05, 0.14, 5.1), trim, T(-W / 2 + 0.025, 0.07, -0.65), bevel=0.01)
    box('door_post', S(0.24, H, 0.24), trim, T(-W / 2 - 0.1, H / 2, 1.9), bevel=0.02)
    # ドア（外へ聞きに行く出入り口）。ちょうつがいの位置に置き、three.js 側で回して開ける
    DH = 2.5
    door = empty('door', T(-W / 2 - 0.1, 0, 2.02))
    door_wood = mat('door_wood', (0.78, 0.56, 0.38))
    box('door_panel', S(0.1, DH, 1.14), door_wood, T(0, DH / 2, 0.59), parent=door, bevel=0.02)
    box('door_window', S(0.13, 0.55, 0.55), mat('door_glass', (0.7, 0.88, 0.98), rough=0.15, glow=0.4),
        T(0, 1.8, 0.59), parent=door, bevel=0.02)
    sphere('door_knob', 0.075, mat('door_knob', (0.96, 0.82, 0.42), rough=0.3, metal=0.5),
           T(0.09, 1.1, 1.0), parent=door, seg=16)
    box('door_top', S(0.2, H - DH, 1.3), wall, T(-W / 2 - 0.1, DH + (H - DH) / 2, 2.55), bevel=0)
    # 家の下の草地（家だけを映すときの土台）
    box('yard', S(W + 2.6, 0.3, D + 1.8), mat('grass', (0.66, 0.83, 0.52), rough=0.95), T(0, -0.36, 0.1), bevel=0.1)

    # 棚（かざり。おぼえたことのしるし）
    shelf = empty('shelf', T(0, 0, -2.85))
    sw, sh, sd = 2.6, 1.45, 0.5
    box('shelf_back', S(sw, sh, 0.06), wood_dark, T(0, sh / 2, -sd / 2 + 0.03), parent=shelf, bevel=0.01)
    for i, x in enumerate((-sw / 2 + 0.04, sw / 2 - 0.04)):
        box(f'shelf_side{i}', S(0.08, sh, sd), wood_dark, T(x, sh / 2, 0), parent=shelf, bevel=0.01)
    levels = [0.04, 0.5, 0.96, sh - 0.04]
    for i, y in enumerate(levels):
        box(f'shelf_plank{i}', S(sw - .16, 0.075, sd - .12), wood_dark, T(0, y, 0), parent=shelf, bevel=0.01)
    n = 0
    for row, y in enumerate(levels[:-1]):
        x = -sw / 2 + 0.2
        while x < sw / 2 - 0.25:
            w = 0.14 + 0.07 * ((n * 7) % 3)
            hgt = 0.3 + 0.03 * ((n * 5) % 4)
            box(f'book{n}', S(w, hgt, 0.32), books[(n * 5 + row) % len(books)],
                T(x + w / 2, y + 0.04 + hgt / 2, 0.02), parent=shelf, bevel=0.012)
            x += w + 0.03
            n += 1

    # 黒板（育ち具合を書く）。面の大きさは board_face の scale で渡す
    bw, bh = 5.0, 2.3
    box('board', S(bw + 0.16, bh + 0.16, 0.08), wood_dark, T(0, 2.85, -D / 2 + 0.04), bevel=0.02)
    box('board_slate', S(bw, bh, 0.04), board, T(0, 2.85, -D / 2 + 0.08), bevel=0)
    box('board_tray', S(bw * 0.6, 0.05, 0.12), wood_dark, T(0, 2.85 - bh / 2 - 0.1, -D / 2 + 0.12), bevel=0.01)
    empty('board_face', T(0, 2.85, -D / 2 + 0.11), scale=S(bw, bh, 1))

    # かご（短期記憶）
    basket = empty('basket', T(-3.55, 0, -0.5))
    kw, kh, kd = 0.95, 0.5, 0.8
    box('basket_bottom', S(kw, 0.06, kd), wicker, T(0, 0.03, 0), parent=basket, bevel=0.01)
    box('basket_f', S(kw, kh, 0.06), wicker, T(0, kh / 2, kd / 2), parent=basket, bevel=0.02)
    box('basket_b', S(kw, kh, 0.06), wicker, T(0, kh / 2, -kd / 2), parent=basket, bevel=0.02)
    box('basket_l', S(0.06, kh, kd), wicker, T(-kw / 2, kh / 2, 0), parent=basket, bevel=0.02)
    box('basket_r', S(0.06, kh, kd), wicker, T(kw / 2, kh / 2, 0), parent=basket, bevel=0.02)
    box('basket_band', S(kw + 0.02, 0.07, kd + 0.02), wood_dark, T(0, kh - 0.06, 0), parent=basket, bevel=0.02)
    weave_light = mat('weave_light', (.90, .74, .48))
    for row in range(5):
        y = .08 + row * .075
        for side in (-1, 1):
            box(f'basket_weave_h{row}_{side}', S(kw + .025, .028, .025), weave_light, T(0, y, side * (kd / 2 + .035)), parent=basket, bevel=.009)
            box(f'basket_weave_side{row}_{side}', S(.025, .028, kd), weave_light, T(side * (kw / 2 + .035), y, 0), parent=basket, bevel=.009)
    for col in range(9):
        for side in (-1, 1):
            box(f'basket_weave_v{col}_{side}', S(.023, kh - .06, .022), wood_dark, T(-kw / 2 + .065 + col * .1, kh / 2, side * (kd / 2 + .04)), parent=basket, bevel=.008)

    # ベッド
    bed = empty('bed', T(3.25, 0, 1.9))
    box('bed_base', S(1.3, 0.3, 2.1), wood_dark, T(0, 0.15, 0), parent=bed)
    box('bed_head', S(1.3, 0.85, 0.1), wood_dark, T(0, 0.42, -1.05), parent=bed)
    box('bed_foot', S(1.3, 0.5, 0.1), wood_dark, T(0, 0.25, 1.05), parent=bed)
    box('bed_mattress', S(1.2, 0.2, 2.0), white, T(0, 0.4, 0), parent=bed, bevel=0.05)
    box('bed_pillow', S(0.8, 0.14, 0.42), white, T(0, 0.55, -0.7), parent=bed, bevel=0.06)
    box('bed_blanket', S(1.24, 0.1, 1.15), blue, T(0, 0.5, 0.4), parent=bed, bevel=0.04)
    box('bed_blanket_fold', S(1.24, 0.12, 0.2), white, T(0, 0.51, -0.2), parent=bed, bevel=0.04)
    stitch = mat('blanket_stitch', (.80, .88, .94))
    for i in range(8):
        for side in (-1, 1):
            box(f'blanket_stitch{i}_{side}', S(.035, .012, .065), stitch, T(side * .54, .558, -.08 + i * .13), parent=bed, bevel=.006)

    # 観葉植物、窓、ランプ、絵（かざり）
    plant = empty('plant', T(W / 2 - 0.55, 0, -2.6))
    cone('plant_pot', 0.2, 0.28, 0.4, mat('pot', (0.85, 0.5, 0.38)), T(0, 0.2, 0), parent=plant)
    green = mat('plant_green', (0.4, 0.68, 0.42), rough=0.8)
    for i, (x, y, z, r) in enumerate(((0, 0.75, 0, 0.34), (-0.18, 0.55, 0.1, 0.24), (0.2, 0.58, -0.05, 0.24))):
        sphere(f'plant_leaf{i}', r, green, T(x, y, z), parent=plant)
    window = empty('window', T(W / 2 - 0.02, 2.2, 0.2))
    box('window_frame', S(0.08, 1.6, 2.0), trim, (0, 0, 0), parent=window, bevel=0.02)
    box('window_glass', S(0.1, 1.4, 1.8), mat('glass', (0.7, 0.88, 0.98), rough=0.15, glow=0.4), (0, 0, 0),
        parent=window, bevel=0)
    box('window_bar_v', S(0.12, 1.4, 0.06), trim, (0, 0, 0), parent=window, bevel=0)
    box('window_bar_h', S(0.12, 0.06, 1.8), trim, (0, 0, 0), parent=window, bevel=0)
    lamp = empty('lamp', T(-2.35, 0, -2.7))
    cone('lamp_base', 0.2, 0.16, 0.06, wood_dark, T(0, 0.03, 0), parent=lamp)
    cone('lamp_pole', 0.025, 0.025, 1.6, wood_dark, T(0, 0.85, 0), parent=lamp)
    cone('lamp_shade', 0.32, 0.17, 0.36, mat('lamp_shade', (1.0, 0.9, 0.65), rough=0.6, glow=1.2),
         T(0, 1.75, 0), parent=lamp, caps=False)
    empty('lamp_light', T(-2.35, 1.6, -2.7))
    box('picture_frame', S(0.05, 0.8, 1.0), wood_dark, T(-W / 2 + 0.03, 2.3, -1.4), bevel=0.015)
    box('picture', S(0.06, 0.64, 0.84), mat('picture', (0.98, 0.83, 0.6), rough=0.9),
        T(-W / 2 + 0.035, 2.3, -1.4), bevel=0)
    sphere('picture_sun', 0.13, mat('picture_sun', (0.95, 0.5, 0.35)), T(-W / 2 + 0.06, 2.4, -1.25),
           scale=(0.15, 1, 1))

    # 観察ノートの机。部屋から直接開く小物。
    desk = empty('journal_desk', T(-3.15, 0, 1.45))
    box('desk_top', S(1.15, .1, .8), wood, T(0, .65, 0), parent=desk, bevel=.035)
    for i, (x, z) in enumerate(((-.46, -.29), (.46, -.29), (-.46, .29), (.46, .29))):
        box(f'desk_leg{i}', S(.09, .6, .09), wood_dark, T(x, .3, z), parent=desk)
    journal = empty('journal', T(0, .73, .04), parent=desk)
    box('journal_cover', S(.77, .045, .54), books[2], T(0, 0, 0), parent=journal, bevel=.018)
    for i, x in enumerate((-.18, .18)):
        box(f'journal_page{i}', S(.35, .035, .48), white, T(x, .035, 0), parent=journal, bevel=.008)
    box('journal_ribbon', S(.035, .012, .59), books[0], T(.12, .06, .035), parent=journal, bevel=.003)
    for side in (-1, 1):
        box(f'desk_brace{side}', S(.075, .07, .64), wood_dark, T(side * .46, .22, 0), parent=desk, bevel=.018)
    for i in range(4):
        box(f'journal_page_edge{i}', S(.72, .003, .49), trim, T(0, .015 + .007 * i, 0), parent=journal, bevel=.001)
    for side in (-1, 1):
        for j in range(3):
            box(f'journal_rule{side}_{j}', S(.22, .003, .006), books[2], T(side * .18, .055, -.13 + j * .10), parent=journal, bevel=0)
    chipbox = empty('chip_box', T(.8, 1.48, -2.55))
    box('chip_box_base', S(.68, .25, .48), wood, T(0, .125, 0), parent=chipbox, bevel=.025)
    box('chip_box_lid', S(.72, .065, .52), wood_dark, T(0, .28, 0), parent=chipbox, bevel=.018)
    box('chip_box_clasp', S(.11, .12, .025), books[1], T(0, .23, .255), parent=chipbox, bevel=.01)
    box('chip_box_emblem', S(.21, .025, .21), books[2], T(0, .325, 0), parent=chipbox, bevel=.02)
    for side in (-1, 1):
        box(f'chip_box_strap{side}', S(.045, .26, .49), wood_dark, T(side * .25, .15, 0), parent=chipbox, bevel=.012)

    # 壁の上端に光を拾う見切り。家具や通り道の位置は維持。
    box('wall_cap_back', S(W - .1, .10, .30), trim, T(0, H, -D / 2 - .1), bevel=.035)
    for side in (-1, 1):
        box(f'wall_cap_side{side}', S(.30, .10, D + .2),
            trim, T(side * (W / 2 + .1), H, -.1), bevel=.035)
    house_names = {o.name for o in bpy.data.objects}

    # ---- 外の広場（盗み聞きの場所）。家の左どなり ----
    grass = mat('grass', (0.66, 0.83, 0.52), rough=0.95)
    grass_dark = mat('grass_dark', (0.58, 0.78, 0.47), rough=0.95)
    leaf = mat('leaf', (0.42, 0.68, 0.4), rough=0.9)
    leaf_light = mat('leaf_light', (0.56, 0.78, 0.45), rough=0.9)
    stone = mat('stone', (0.87, 0.85, 0.79), rough=0.9)
    rock = mat('rock', (0.68, 0.68, 0.66), rough=0.9)
    PW = 6.6  # 広場の幅
    px = -W / 2 - 0.2 - PW / 2  # 広場の中心の x
    box('plaza', S(PW, 0.2, D), grass, T(px, -0.1, 0), bevel=0)
    for i in range(9):  # 草の色むら
        sphere(f'grass_patch{i}', 0.45 + rnd(i) * 0.35, grass_dark,
               T(px - 2.6 + rnd(i, 1) * 5.2, 0.0, -2.4 + rnd(i, 2) * 4.8), scale=(1, 1, 0.02), seg=16)
    cone('plaza_circle', 1.7, 1.7, 0.03, stone, T(px - 0.6, 0.015, -0.1))
    cone('plaza_circle_in', 1.2, 1.2, 0.034, mat('stone_in', (0.92, 0.9, 0.85), rough=0.9), T(px - 0.6, 0.016, -0.1))
    for i, (x, z) in enumerate(((-3.35, 2.6), (-3.95, 2.45), (-4.5, 2.2))):
        cone(f'step{i}', 0.24, 0.24, 0.03, stone, T(x, 0.015, z))
    # 茂み（隠れる場所）
    bush = empty('bush', T(-5.0, 0, 1.25))
    for i, (x, y, z, r) in enumerate(((0, 0.38, 0, 0.5), (-0.42, 0.3, 0.12, 0.38),
                                      (0.4, 0.28, -0.1, 0.36), (0.05, 0.62, -0.05, 0.3))):
        sphere(f'bush{i}', r, leaf if i % 2 == 0 else leaf_light, T(x, y, z), parent=bush)
    # 木、ベンチ、柵、街灯、花、石
    tree('tree', px - 2.3, -2.2)
    tree('tree_small', px + 2.6, -2.5, scale=0.7)
    bench = empty('bench', T(px + 0.6, 0, -2.5))
    box('bench_seat', S(1.6, 0.08, 0.45), wood, T(0, 0.45, 0), parent=bench, bevel=0.02)
    box('bench_back', S(1.6, 0.4, 0.07), wood, T(0, 0.85, -0.2), parent=bench, bevel=0.02)
    for i, x in enumerate((-0.65, 0.65)):
        box(f'bench_leg{i}', S(0.08, 0.45, 0.4), wood_dark, T(x, 0.225, 0), parent=bench, bevel=0.01)
    # 絵の広場と揃えた小さな噴水。会話の輪と歩く道は空ける。
    fountain = empty('fountain', T(px + 1.9, 0, -1.15))
    fountain_stone = mat('fountain_stone', (0.85, 0.82, 0.7), rough=0.85)
    water = mat('fountain_water', (0.57, 0.81, 0.85), rough=0.2)
    cone('fountain_base', 0.61, 0.57, 0.18, fountain_stone, T(0, 0.09, 0), parent=fountain)
    cone('fountain_basin', 0.53, 0.55, 0.19, fountain_stone, T(0, 0.24, 0), parent=fountain)
    cone('fountain_pool', 0.48, 0.48, 0.025, water, T(0, 0.342, 0), parent=fountain)
    cone('fountain_column', 0.14, 0.1, 0.55, fountain_stone, T(0, 0.55, 0), parent=fountain)
    cone('fountain_upper', 0.19, 0.31, 0.13, fountain_stone, T(0, 0.86, 0), parent=fountain)
    cone('fountain_upper_water', 0.26, 0.26, 0.02, water, T(0, 0.93, 0), parent=fountain)
    sphere('fountain_drop', 0.08, water, T(0, 1.02, 0), scale=(0.7, 0.7, 1.7), parent=fountain)
    for i in range(6):
        a = i * math.tau / 6
        sphere(f'fountain_stream{i}', 0.04, water, T(math.cos(a) * 0.27, 0.64, math.sin(a) * 0.27),
               scale=(0.7, 0.7, 7.0), parent=fountain, seg=12)
    x = px - PW / 2 + 0.2
    i = 0
    while x < px + PW / 2:
        box(f'fence_post{i}', S(0.1, 0.75, 0.1), trim, T(x, 0.375, -D / 2 + 0.12), bevel=0.02)
        x += 0.75
        i += 1
    for i, y in enumerate((0.3, 0.58)):
        box(f'fence_rail{i}', S(PW - 0.3, 0.07, 0.05), trim, T(px, y, -D / 2 + 0.12), bevel=0.01)
    post = empty('street_lamp', T(px - 0.9, 0, -2.6))
    cone('street_lamp_pole', 0.05, 0.04, 2.2, mat('iron', (0.3, 0.33, 0.38), rough=0.5), T(0, 1.1, 0), parent=post)
    sphere('street_lamp_glow', 0.17, mat('street_glow', (1.0, 0.93, 0.7), rough=0.4, glow=1.5),
           T(0, 2.3, 0), parent=post)
    spots = [(px - 2.6, 2.6), (px - 1.9, 2.2), (px + 1.2, 2.7), (px + 2.4, 0.6), (px - 2.8, -0.6),
             (px + 2.5, -1.4), (px - 0.4, 2.5), (px + 0.3, -1.9), (px - 1.6, -2.4), (px + 1.8, 2.1),
             (px - 2.2, 0.9), (px + 2.8, 2.6)]
    for i, (fx, fz) in enumerate(spots):
        flower(i, fx, fz)
    for i, (rx, rz, r) in enumerate(((px + 2.7, 1.5, 0.22), (px - 2.9, -1.5, 0.3), (px + 1.4, -2.6, 0.18))):
        sphere(f'rock{i}', r, rock, T(rx, r * 0.45, rz), scale=(1.2, 1, 0.7), seg=16)
    # 遠くの丘と雲
    hill = mat('hill', (0.6, 0.8, 0.55), rough=1.0)
    sphere('hill0', 5.0, hill, T(px - 2.5, -2.6, -8.5), scale=(1.5, 1, 1))
    sphere('hill1', 4.0, mat('hill_far', (0.68, 0.85, 0.66), rough=1.0), T(px + 4.5, -1.9, -10), scale=(1.8, 1, 1))
    cloud = mat('cloud', (1.0, 1.0, 1.0), rough=1.0, glow=0.25)
    for c, (cx, cy, cz) in enumerate(((px - 3, 4.3, -9), (px + 3.5, 5.2, -11), (3.5, 5.6, -10))):
        for i, (x, r) in enumerate(((0, 0.8), (-0.8, 0.55), (0.85, 0.6), (0.3, 0.6))):
            sphere(f'cloud{c}_{i}', r, cloud, T(cx + x, cy + (0.25 if i == 3 else 0), cz),
                   scale=(1.2, 1, 0.75), seg=16)

    plaza_names = {o.name for o in bpy.data.objects} - house_names

    # ---- まちの建物（お出かけの場面のときだけ、家の代わりに見せる） ----
    box('town_ground', S(W + 0.6, 0.2, D), mat('town_ground', (0.9, 0.86, 0.76), rough=0.95),
        T(0.1, -0.1, 0), bevel=0)
    for i in range(1, 7):
        box(f'town_line{i}', S(W + 0.6, 0.006, 0.03), stone, T(0.1, 0.003, -D / 2 + i * 0.95), bevel=0)
    shop('shop_a', -1.2, -2.0, (0.99, 0.9, 0.78), (0.9, 0.5, 0.42))
    shop('shop_b', 1.6, -2.0, (0.84, 0.92, 0.98), (0.4, 0.62, 0.86))
    # 店の前をつなぐお祭りのガーランド。
    cord = mat('town_cord', (0.54, 0.45, 0.34))
    for x in (-2.7, 2.9):
        box('garland_post' + str(x), S(0.065, 2.8, 0.065), wood_dark, T(x, 1.4, -0.65))
    for i in range(14):
        x = -2.5 + i * 0.4
        y = 2.75 - 0.35 * (1 - ((x - 0.1) / 2.8) ** 2)
        box(f'garland_cord{i}', S(0.42, 0.025, 0.025), cord, T(x, y, -0.65), bevel=0)
        box(f'garland_flag{i}', S(0.23, 0.28, 0.025),
            mat('flag' + str(i % 3), [(0.93, 0.58, 0.46), (0.98, 0.82, 0.42), (0.48, 0.72, 0.73)][i % 3]),
            T(x, y - 0.16, -0.65), bevel=0.015)
    tree('tree_town', 2.2, 1.4, scale=0.75)
    for i, (fx, fz) in enumerate(((-2.3, 0.4), (-0.2, 2.4), (0.9, -0.6), (2.6, -0.4))):
        flower(20 + i, fx, fz)
    town_names = {o.name for o in bpy.data.objects} - house_names - plaza_names

    # 場面ごとにまとめる（three.js 側で表示を切り替える）
    for root_name, names in (('house_root', house_names), ('plaza_root', plaza_names), ('town_root', town_names)):
        group = empty(root_name, (0, 0, 0))
        for n in names:
            o = bpy.data.objects[n]
            if o.parent is None:
                o.parent = group

    # ---- 立ち位置などの目印 ----
    empty('at_home', T(0, 0, 0.5))
    empty('at_basket', T(-2.7, 0, -0.5))
    empty('at_bed', T(2.25, 0, 1.9))
    empty('bed_top', T(3.25, 1.0, 2.6))
    empty('basket_top', T(-3.55, 0.7, -0.5))
    empty('ear', T(-3.55, 3.3, -0.5))
    empty('at_door_in', T(-3.6, 0, 2.65))
    empty('at_door_out', T(-5.1, 0, 2.6))
    empty('at_hide', T(-4.35, 0, 1.7))
    empty('plaza_center', T(px - 0.6, 0, -0.1))
    polish_surfaces()
    export('room.glb')


# ---------------------------------------------------------------- 広場で話す人
def build_npc():
    reset()
    skin = mat('npc_skin', (0.98, 0.86, 0.74), rough=0.6)
    cloth = mat('npc_cloth', (0.9, 0.9, 0.9), rough=0.7)  # 色は three.js 側で人ごとに変える
    dark = mat('eye_dark', (0.13, 0.12, 0.2), rough=0.15)
    shoe = mat('npc_shoe', (0.35, 0.3, 0.3), rough=0.6)
    pink = mat('pink', (0.99, 0.7, 0.72), rough=0.6)
    root = empty('npc', (0, 0, 0))
    for side, x in (('L', -0.14), ('R', 0.14)):
        sphere('npc_foot' + side, 0.11, shoe, T(x, 0.06, 0.04), scale=(1, 1.4, 0.55), parent=root)
        sphere('npc_arm' + side, 0.085, cloth, T(x * 2.6, 0.62, 0), scale=(0.8, 0.8, 1.9), parent=root)
        sphere('npc_hand' + side, 0.07, skin, T(x * 2.7, 0.44, 0.02), parent=root)
    sphere('npc_body', 0.34, cloth, T(0, 0.55, 0), scale=(1, 0.88, 1.45), parent=root, seg=56)
    piping = mat('npc_piping', (.77, .79, .76), rough=.85)
    for j in range(3):
        sphere(f'npc_button{j}', .022, piping, T(0, .78 - j * .13, .283), parent=root, seg=16)
    sphere('npc_collar', .18, cloth, T(0, .99, 0), scale=(1.12, 1, .3), parent=root, seg=32)
    head = empty('npc_head', T(0, 1.24, 0), root)
    sphere('npc_head_mesh', 0.3, skin, (0, 0, 0), parent=head, seg=64)
    sphere('npc_hat', 0.31, cloth, T(0, 0.09, -0.02), scale=(1.03, 1.03, 0.78), parent=head)
    cone('npc_hat_brim', 0.36, 0.36, 0.03, cloth, T(0, 0.1, 0.03), parent=head)
    for side, x in (('L', -0.11), ('R', 0.11)):
        sphere('npc_eye' + side, 0.04, dark, T(x, -0.04, 0.27), scale=(1, 0.5, 1.3), parent=head)
        sphere('npc_cheek' + side, 0.045, pink, T(x * 1.8, -0.1, 0.23), scale=(1, 0.4, 0.6), parent=head)
    polish_surfaces()
    export('npc.glb')


def build_workshop():
    reset()
    oak = mat('work_oak', (.72, .49, .30), rough=.48)
    edge = mat('work_edge', (.40, .26, .17))
    brass = mat('work_brass', (.93, .73, .37), metal=.45, rough=.35)
    felt = mat('work_felt', (.25, .39, .32), rough=.94)
    cream = mat('work_cream', (.96, .89, .69))
    box('worktable', S(7, .28, 3.7), oak, T(0, -.2, 0), bevel=.14)
    box('workmat', S(6.5, .035, 3.2), felt, T(0, -.04, 0), bevel=.08)
    for side in (-1, 1):
        box(f'work_rim{side}', S(.07, .09, 3.45), edge, T(side * 3.37, -.02, 0), bevel=.025)
    colors = [(.55, .74, .77), (.66, .60, .78), (.57, .73, .48), (.90, .68, .38), (.80, .49, .42)]
    for i, name in enumerate(('tokenizer', 'context', 'predictor', 'sampler', 'learner')):
        x = (i - 2) * 1.2
        box(f'socket_{name}', S(1.05, .12, 1.5), edge, T(x, .015, 0), bevel=.07)
        box(f'socket_inner_{name}', S(.9, .025, 1.22), felt, T(x, .085, 0), bevel=.04)
        for side in (-1, 1):
            sphere(f'socket_screw_{name}{side}', .045, brass, T(x + side * .41, .10, .62), scale=S(1, .3, 1))
        chip = empty(f'chip_{name}', T(x, .18, 0))
        color = mat(f'chip_color_{name}', colors[i], rough=.45)
        box(f'{name}_body', S(.82, .15, 1.05), color, T(0, 0, 0), parent=chip, bevel=.07)
        box(f'{name}_badge', S(.61, .025, .68), cream, T(0, .09, -.02), parent=chip, bevel=.04)
        for j in range(4):
            for side in (-1, 1):
                box(f'{name}_pin{j}_{side}', S(.13, .045, .07), brass, T(side * .45, -.015, -.32 + j * .21), parent=chip, bevel=.012)
        # 切り口、道筋、棚、サイコロ、芽を金属の象眼で表す。
        if i == 0:
            for j in range(3):
                box(f'cut_mark{j}', S(.07, .035, .4), brass, T((j - 1) * .17, .12, 0), parent=chip, bevel=.015)
        elif i == 1:
            for j in range(3):
                sphere(f'path_mark{j}', .075, brass, T((j - 1) * .17, .13, (j - 1) * .15), scale=S(1, .3, 1), parent=chip)
        elif i == 2:
            for j in range(3):
                box(f'shelf_mark{j}', S(.44, .035, .06), brass, T(0, .12, (j - 1) * .16), parent=chip, bevel=.012)
        elif i == 3:
            for x2, z2 in ((-.13, -.13), (.13, -.13), (0, 0), (-.13, .13), (.13, .13)):
                sphere(f'die_mark{x2}_{z2}', .045, brass, T(x2, .13, z2), scale=S(1, .35, 1), parent=chip)
        else:
            box('sprout_stem', S(.035, .025, .4), brass, T(0, .12, .05), parent=chip)
            for side in (-1, 1):
                sphere(f'sprout_leaf{side}', .13, brass, T(side * .11, .13, -.07), scale=S(1, .2, .6), parent=chip)
    polish_surfaces()
    export('workshop.glb')


def build_sleep_mobile():
    reset()
    gold = mat('dream_gold', (.98, .82, .43), rough=.35, glow=.15)
    pearl = mat('dream_pearl', (.87, .94, .96), rough=.25)
    # 本物の立体の三日月。文字の Zzz の代わりにベッドの上で揺れる。
    outline = []
    inner_radius = math.hypot(.03, math.sin(math.radians(60)) * .3)
    inner_start = math.acos(-.03 / inner_radius)
    for j in range(33):
        a = math.radians(60 + 240 * j / 32)
        outline.append((math.cos(a) * .3, math.sin(a) * .3))
    for j in range(33):
        a = inner_start + (2 * math.pi - 2 * inner_start) * j / 32
        outline.append((.18 + math.cos(a) * inner_radius, math.sin(a) * inner_radius))
    mesh = bpy.data.meshes.new('dream_moon')
    mesh.from_pydata([T(x, y, 0) for x, y in outline], [], [(j, j + 1, j + 34, j + 33) for j in range(32)])
    moon = bpy.data.objects.new('dream_moon', mesh)
    bpy.context.collection.objects.link(moon)
    mesh.materials.append(gold)
    solid = moon.modifiers.new('thickness', 'SOLIDIFY'); solid.thickness = .07
    bevel = moon.modifiers.new('soft_edge', 'BEVEL'); bevel.width = .02; bevel.segments = 3
    for i, (x, y) in enumerate(((-.4, .25), (.42, .12), (.26, -.3))):
        sphere(f'dream_pearl{i}', .055 + .01 * i, pearl, T(x, y, 0))
    polish_surfaces()
    export('sleep-mobile.glb')


def build_courier_bag():
    reset()
    leather = mat('courier_leather', (.60, .34, .17), rough=.52)
    edge = mat('courier_edge', (.83, .63, .33))
    brass = mat('courier_buckle', (.94, .78, .35), metal=.65, rough=.3)
    box('satchel', S(.49, .34, .19), leather, T(0, .48, .43), bevel=.065)
    box('satchel_flap', S(.47, .15, .045), edge, T(0, .58, .54), bevel=.035)
    box('satchel_clasp', S(.065, .09, .025), brass, T(0, .51, .57), bevel=.012)
    box('satchel_strap', S(.065, .39, .035), leather, T(0, .64, .40), rot=RZ(-32), bevel=.015)
    for i in range(9):
        sphere(f'satchel_stitch{i}', .009, edge, T(-.19 + i * .0475, .35, .532), seg=8)
    polish_surfaces()
    export('courier-bag.glb')


# 頭の中の部屋の並び。src/ui/neural-view.js の ROOMS と同じ値にする。
MIND_ROOMS = [
    # 名前, 中心 x, 中心 z, 壁の腰板の色, 机の奥行き
    ('heard', -11, 9, (.93, .74, .50), 1.6),
    ('context', 0, 9, (.62, .78, .72), 2.0),
    ('work0', -11, 0, (.95, .78, .45), 1.8),
    ('work1', 0, 0, (.55, .74, .86), 1.8),
    ('work2', 11, 0, (.72, .82, .52), 1.8),
    ('work3', 11, -9, (.93, .66, .55), 1.8),
    ('work4', 0, -9, (.76, .68, .88), 1.8),
    ('work5', -11, -9, (.50, .78, .74), 1.8),
    ('candidates', -22, -9, (.90, .72, .78), 1.6),
    ('roulette', -22, 0, (.70, .64, .86), 3.4),
    ('output', -22, 9, (.96, .80, .55), 2.6),
]


def build_mind_space():
    reset()
    # 部品が多いので、面取りと円の分割を粗くしてファイルを軽くする
    _box, _cone = globals()['box'], globals()['cone']

    def box(*a, **k):
        k.setdefault('segments', 2)
        return _box(*a, **k)

    def cone(*a, **k):
        k.setdefault('segments', 24)
        return _cone(*a, **k)
    oak = mat('mind_oak', (.80, .64, .43))
    oak_dark = mat('mind_oak_dark', (.55, .41, .28))
    plank_a = mat('mind_plank_a', (.86, .73, .54))
    plank_b = mat('mind_plank_b', (.81, .67, .48))
    plaster = mat('mind_plaster', (.97, .93, .84))
    trim = mat('mind_trim', (.99, .97, .92))
    edge = mat('mind_edge', (.48, .59, .53))
    paper = mat('mind_paper', (.93, .90, .78))
    glass = mat('mind_glass', (.72, .88, .95), rough=.2, glow=.35)
    bulb = mat('mind_bulb', (1.0, .90, .62), glow=2.2)
    brass = mat('mind_brass', (.80, .62, .28), rough=.35, metal=.6)
    leaf = mat('mind_leaf', (.45, .66, .38))
    pot = mat('mind_pot', (.78, .47, .36))
    path = mat('mind_path', (.86, .80, .66))
    stone = mat('mind_stone', (.93, .89, .78))
    lens_glass = mat('mind_lens_glass', (.80, .93, .98), rough=.1, glow=.25)
    red = mat('mind_red', (.80, .40, .32))
    jars = [mat('mind_jar' + str(j), c) for j, c in enumerate(((.90, .70, .45), (.55, .75, .80), (.80, .60, .70), (.65, .78, .55)))]

    def table(name, x, z, w, d):
        group = empty(name, T(x, 0, z))
        box(name + '_top', S(w, .12, d), oak, T(0, .66, 0), parent=group, bevel=.055)
        box(name + '_apron', S(w - .3, .12, d - .3), oak_dark, T(0, .55, 0), parent=group, bevel=.02)
        for j, (xx, zz) in enumerate(((-w/2+.2, -d/2+.2), (w/2-.2, -d/2+.2), (-w/2+.2, d/2-.2), (w/2-.2, d/2-.2))):
            box(name + '_leg' + str(j), S(.16, .52, .16), oak_dark, T(xx, .26, zz), parent=group, bevel=.035)
        return group

    def plant(name, x, y, z, s=1.0):
        cone(name + '_pot', .20 * s, .27 * s, .36 * s, pot, T(x, y + .18 * s, z))
        for j in range(5):
            a = j * 1.2566
            sphere(f'{name}_leaf{j}', .20 * s, leaf, T(x + math.cos(a) * .13 * s, y + (.55 + rnd(j, x) * .25) * s, z + math.sin(a) * .13 * s), scale=(.8, 1.25, .8), seg=16)

    def room(i, name, cx, cz, color, depth):
        wall = mat('mind_wall_' + name, color)
        rug = mat('mind_rug_' + name, tuple(min(1, c * .80 + .16) for c in color))
        # 床: 板張り、敷物
        box(name + '_base', S(9.3, .10, 6.3), oak_dark, T(cx, -.06, cz), bevel=.04)
        for j in range(9):
            box(f'{name}_plank{j}', S(.98, .05, 6.0), plank_a if j % 2 else plank_b, T(cx - 4 + j, .0, cz), bevel=.012)
        box(name + '_rug', S(7.4, .03, 3.9), rug, T(cx + .3, .035, cz + .2), bevel=.02)
        box(name + '_rug_in', S(7.0, .032, 3.5), trim, T(cx + .3, .037, cz + .2), bevel=.02)
        box(name + '_rug_in2', S(6.8, .034, 3.3), rug, T(cx + .3, .039, cz + .2), bevel=.02)
        # 奥の壁と左右の壁: しっくい + 色つきの腰板 + 見切り
        for tag, size, loc in (
            ('back', (9.3, 2.6, .18), (cx, 1.3, cz - 3.06)),
            ('left', (.18, 2.6, 6.3), (cx - 4.56, 1.3, cz)),
            ('right', (.18, 2.6, 6.3), (cx + 4.56, 1.3, cz)),
        ):
            box(f'{name}_{tag}', S(*size), plaster, T(*loc), bevel=.03)
        box(name + '_wains_back', S(9.0, .95, .06), wall, T(cx, .52, cz - 2.95), bevel=.02)
        box(name + '_wains_left', S(.06, .95, 6.0), wall, T(cx - 4.45, .52, cz), bevel=.02)
        box(name + '_wains_right', S(.06, .95, 6.0), wall, T(cx + 4.45, .52, cz), bevel=.02)
        box(name + '_rail_back', S(9.0, .07, .09), trim, T(cx, 1.02, cz - 2.94), bevel=.02)
        box(name + '_rail_left', S(.09, .07, 6.0), trim, T(cx - 4.44, 1.02, cz), bevel=.02)
        box(name + '_rail_right', S(.09, .07, 6.0), trim, T(cx + 4.44, 1.02, cz), bevel=.02)
        box(name + '_cap_back', S(9.5, .10, .30), wall, T(cx, 2.63, cz - 3.06), bevel=.03)
        box(name + '_cap_left', S(.30, .10, 6.4), wall, T(cx - 4.56, 2.63, cz), bevel=.03)
        box(name + '_cap_right', S(.30, .10, 6.4), wall, T(cx + 4.56, 2.63, cz), bevel=.03)
        # 手前は中が見えるよう低い壁だけにして、左に入口を付ける
        box(name + '_front', S(7.5, .34, .18), wall, T(cx + .9, .17, cz + 3.06), bevel=.04)
        for j, xx in enumerate((cx - 4.42, cx - 2.98)):
            box(f'{name}_doorpost{j}', S(.16, 2.3, .22), oak_dark, T(xx, 1.15, cz + 3.06), bevel=.03)
        box(name + '_lintel', S(1.75, .18, .26), oak_dark, T(cx - 3.7, 2.36, cz + 3.06), bevel=.04)
        box(name + '_mat', S(1.1, .03, .6), rug, T(cx - 3.7, .0, cz + 3.6), bevel=.02)
        # 窓
        wx = cx + 2.6
        box(name + '_win_frame', S(1.9, 1.3, .10), trim, T(wx, 1.80, cz - 2.94), bevel=.03)
        box(name + '_win_glass', S(1.66, 1.06, .11), glass, T(wx, 1.80, cz - 2.93), bevel=.0)
        box(name + '_win_bar_v', S(.07, 1.1, .13), trim, T(wx, 1.80, cz - 2.92), bevel=.01)
        box(name + '_win_bar_h', S(1.7, .07, .13), trim, T(wx, 1.80, cz - 2.92), bevel=.01)
        box(name + '_win_sill', S(2.1, .07, .30), trim, T(wx, 1.13, cz - 2.86), bevel=.02)
        plant(name + '_sillplant', wx + .65, 1.16, cz - 2.82, .42)
        # 壁の棚と小物
        sx = cx - 1.6
        for k, yy in enumerate((1.45, 2.05)):
            box(f'{name}_shelf{k}', S(3.2, .07, .36), oak, T(sx, yy, cz - 2.80), bevel=.02)
            for j in range(6):
                r = rnd(j + k * 7, i + 1)
                h = .20 + r * .26
                xx = sx - 1.35 + j * .54
                if (j + k + i) % 3 == 0:
                    cone(f'{name}_jar{k}_{j}', .11, .13, h, jars[(j + i) % 4], T(xx, yy + .035 + h / 2, cz - 2.80))
                else:
                    box(f'{name}_book{k}_{j}', S(.30 + r * .12, h, .24), paper if (j + i) % 2 else wall, T(xx, yy + .035 + h / 2, cz - 2.80), bevel=.02)
        # 明かり
        box(name + '_lamp_arm', S(.06, .06, .5), brass, T(cx + .55, 2.25, cz - 2.72), bevel=.01)
        cone(name + '_lamp_shade', .26, .10, .22, wall, T(cx + .55, 2.15, cz - 2.48))
        sphere(name + '_lamp_bulb', .10, bulb, T(cx + .55, 2.05, cz - 2.48), seg=16)
        plant(name + '_plant', cx + 4.0, 0, cz - 2.5, 1.0)
        # 作業机
        big = depth >= 3
        table(name + '_table', cx + .3, cz + (.5 if big else .7), 4.4 if big else 6.4, depth)
        # 奥の壁の上の看板の板（文字は three.js 側で出す）
        box(name + '_sign', S(3.7, .90, .12), oak_dark, T(cx, 3.05, cz - 3.06), bevel=.05)
        box(name + '_sign_face', S(3.5, .72, .13), paper, T(cx, 3.05, cz - 3.05), bevel=.03)
        # 入口のドア。ちょうつがいを原点にして three.js 側で開け閉めする
        door = empty(name + '_door', T(cx - 4.33, 0, cz + 3.06))
        box(name + '_door_leaf', S(1.26, 2.05, .08), wall, T(.64, 1.06, 0), parent=door, bevel=.03)
        box(name + '_door_panel0', S(.9, .7, .10), trim, T(.64, 1.52, 0), parent=door, bevel=.02)
        box(name + '_door_panel1', S(.9, .7, .10), trim, T(.64, .58, 0), parent=door, bevel=.02)
        sphere(name + '_door_knob0', .06, brass, T(1.12, 1.05, .08), parent=door, seg=12)
        sphere(name + '_door_knob1', .06, brass, T(1.12, 1.05, -.08), parent=door, seg=12)

    for i, spec in enumerate(MIND_ROOMS):
        room(i, *spec)

    # 部屋ごとの道具
    r = {name: (cx, cz) for name, cx, cz, _c, _d in MIND_ROOMS}
    # 文字の引き出し（埋め込みの表）
    cx, cz = r['work0']
    box('mind_drawers', S(2.6, 1.3, .5), oak, T(cx - 3.0, .66, cz - 2.68), bevel=.04)
    for a in range(5):
        for b in range(3):
            box(f'mind_drawer{a}_{b}', S(.44, .34, .05), plank_a, T(cx - 4.0 + a * .5, .26 + b * .4, cz - 2.41), bevel=.02)
            sphere(f'mind_drawer_knob{a}_{b}', .035, brass, T(cx - 4.0 + a * .5, .26 + b * .4, cz - 2.37), seg=12)
    # 点をつける部屋の表彰台
    cx, cz = r['work5']
    for j, h in enumerate((.5, .8, .35)):
        box(f'mind_podium{j}', S(.7, h, .6), (paper, brass, paper)[j], T(cx - 3.6 + j * .7, h / 2, cz - 2.55), bevel=.03)
    # ルーレットの台
    cx, cz = r['roulette']
    cone('mind_roulette_rim', 1.52, 1.52, .12, edge, T(cx + .3, .79, cz + .5), segments=64)
    cone('mind_roulette_hub', .14, .12, .17, paper, T(cx + .3, .95, cz + .5))

    # three.js から動かす道具。部屋の外に作り、名前で取り出す
    lens = empty('mind_lens', T(0, -5, 0))
    cone('mind_lens_ring', .30, .30, .06, brass, T(0, 0, 0), parent=lens, caps=False)
    cone('mind_lens_ring_in', .25, .25, .06, brass, T(0, 0, 0), parent=lens, caps=False)
    cone('mind_lens_glass', .26, .26, .02, lens_glass, T(0, 0, 0), parent=lens)
    box('mind_lens_handle', S(.08, .06, .42), oak_dark, T(0, 0, -.50), parent=lens, bevel=.02)
    gate = empty('mind_gate', T(0, -5, 3))
    for j, xx in enumerate((-.19, .19)):
        box(f'mind_gate_post{j}', S(.07, .62, .30), red, T(xx, .31, 0), parent=gate, bevel=.02)
    box('mind_gate_top', S(.50, .12, .34), red, T(0, .66, 0), parent=gate, bevel=.03)
    box('mind_gate_roller', S(.32, .08, .26), brass, T(0, .56, 0), parent=gate, bevel=.03)
    box('mind_gate_base', S(.56, .04, .40), oak_dark, T(0, .02, 0), parent=gate, bevel=.01)
    stick = empty('mind_stick', T(0, -5, 9))
    box('mind_stick_rod', S(.035, .035, 1), oak_dark, T(0, 0, .5), parent=stick, bevel=.0)
    sphere('mind_stick_tip', .05, brass, T(0, 0, 1), parent=stick, seg=12)
    scoop = empty('mind_scoop', T(0, -5, 6))
    cone('mind_scoop_cup', .13, .19, .16, brass, T(0, 0, 0), parent=scoop)
    box('mind_scoop_handle', S(.05, .04, .36), oak_dark, T(0, .06, -.34), parent=scoop, bevel=.01)

    # 部屋はすべて 1 つの大きな建物の中にある。部屋どうしは廊下でつなぐ
    hall = mat('mind_hall', (.90, .86, .76))
    runner = mat('mind_rug_hall', (.78, .47, .40))
    runner_edge = mat('mind_rug_hall_edge', (.95, .86, .66))
    panel = mat('mind_wall_hall', (.66, .52, .38))
    X0, X1, Z0, Z1 = -28.8, 17.8, -12.5, 15.2
    box('mind_hall_floor', S(X1 - X0, .12, Z1 - Z0), hall, T((X0 + X1) / 2, -.11, (Z0 + Z1) / 2), bevel=.03)
    for j, zz in enumerate((13.6, 4.5, -4.5)):
        box(f'mind_runner_h{j}_edge', S(44.6, .018, 1.5), runner_edge, T(-5.5, -.025, zz), bevel=.004)
        box(f'mind_runner_h{j}', S(44.4, .010, 1.2), runner, T(-5.5, -.008, zz), bevel=.003)
    for j, xx in enumerate((-27.5, -16.5, -5.5, 5.5, 16.5)):
        # 交差部分には横向きの絨毯だけを置く。同じ面を重ねない。
        for segment, (near, far) in enumerate(((-3.74, 3.74), (5.26, 12.84))):
            box(f'mind_runner_v{j}_{segment}_edge', S(1.2, .018, far - near), runner_edge, T(xx, -.025, (near + far) / 2), bevel=.004)
            box(f'mind_runner_v{j}_{segment}', S(.95, .010, far - near - .04), runner, T(xx, -.008, (near + far) / 2), bevel=.003)
    # 外壁: 奥と左右は高く、手前は中が見えるよう低くして正面玄関を付ける
    for tag, size, loc in (
        ('back', (X1 - X0 + .5, 3.4, .25), ((X0 + X1) / 2, 1.7, Z0 - .12)),
        ('left', (.25, 3.4, Z1 - Z0 + .5), (X0 - .12, 1.7, (Z0 + Z1) / 2)),
        ('right', (.25, 3.4, Z1 - Z0 + .5), (X1 + .12, 1.7, (Z0 + Z1) / 2)),
    ):
        box('mind_outer_' + tag, S(*size), plaster, T(*loc), bevel=.04)
    box('mind_outer_panel_left', S(.07, 1.1, Z1 - Z0), panel, T(X0 + .04, .55, (Z0 + Z1) / 2), bevel=.02)
    box('mind_outer_panel_right', S(.07, 1.1, Z1 - Z0), panel, T(X1 - .04, .55, (Z0 + Z1) / 2), bevel=.02)
    box('mind_outer_cap_back', S(X1 - X0 + .9, .14, .5), oak_dark, T((X0 + X1) / 2, 3.45, Z0 - .12), bevel=.04)
    box('mind_outer_cap_left', S(.5, .14, Z1 - Z0 + .9), oak_dark, T(X0 - .12, 3.45, (Z0 + Z1) / 2), bevel=.04)
    box('mind_outer_cap_right', S(.5, .14, Z1 - Z0 + .9), oak_dark, T(X1 + .12, 3.45, (Z0 + Z1) / 2), bevel=.04)
    for side, xx in (('l', X0 + .02), ('r', X1 - .02)):
        for j, zz in enumerate((-8.5, -0.5, 9.0)):
            box(f'mind_outer_win_{side}{j}_frame', S(.10, 1.5, 2.3), trim, T(xx, 2.1, zz), bevel=.03)
            box(f'mind_outer_win_{side}{j}_glass', S(.12, 1.26, 2.06), glass, T(xx, 2.1, zz), bevel=.0)
            box(f'mind_outer_win_{side}{j}_bar', S(.14, 1.3, .07), trim, T(xx, 2.1, zz), bevel=.01)
    # 手前の低い壁と正面玄関（空いている広間の前）
    box('mind_outer_front_a', S(11 - 1.2 - X0, .5, .25), plaster, T((X0 + 11 - 1.2) / 2, .25, Z1 + .12), bevel=.05)
    box('mind_outer_front_b', S(X1 - 11 - 1.2, .5, .25), plaster, T((X1 + 11 + 1.2) / 2, .25, Z1 + .12), bevel=.05)
    for j, xx in enumerate((11 - 1.2, 11 + 1.2)):
        box(f'mind_entrance_post{j}', S(.26, 2.9, .34), oak_dark, T(xx, 1.45, Z1 + .12), bevel=.04)
    box('mind_entrance_top', S(3.1, .3, .42), oak_dark, T(11, 3.0, Z1 + .12), bevel=.05)
    box('mind_entrance_mat', S(2.0, .03, .7), runner, T(11, -.025, Z1 - .35), bevel=.01)
    for j, xx in enumerate((X0 - .12, X1 + .12)):
        box(f'mind_outer_corner{j}', S(.4, 3.5, .4), oak_dark, T(xx, 1.75, Z1 + .12), bevel=.04)
    # 廊下の鉢植えと、角の明かり
    for j, (xx, zz) in enumerate(((-27.9, 14.4), (17.0, 14.4), (-16.5, -11.6), (5.5, -11.6), (17.0, -11.6), (-27.9, -11.6), (-5.5, -11.6), (16.9, 4.5))):
        plant(f'mind_hall_plant{j}', xx, -.05, zz, 1.25)
    for j, (xx, zz) in enumerate(((-16.5, 14.6), (-5.5, 14.6), (5.5, 14.6))):
        cone(f'mind_hall_lamp{j}_base', .22, .16, .08, oak_dark, T(xx, 0, zz))
        cone(f'mind_hall_lamp{j}_pole', .04, .04, 1.7, brass, T(xx, .85, zz))
        cone(f'mind_hall_lamp{j}_shade', .34, .16, .34, runner_edge, T(xx, 1.8, zz))
        sphere(f'mind_hall_lamp{j}_bulb', .11, bulb, T(xx, 1.66, zz), seg=12)
    # 広間: 練習の記録を貼る掲示板と長いす
    box('mind_lobby_rug', S(7.6, .03, 4.6), runner, T(11, -.045, 9.3), bevel=.02)
    box('mind_lobby_rug_in', S(7.1, .012, 4.1), runner_edge, T(11, -.018, 9.3), bevel=.004)
    box('mind_lobby_rug_in2', S(6.8, .010, 3.8), runner, T(11, 0, 9.3), bevel=.003)
    box('mind_board', S(5.4, 3.0, .12), oak_dark, T(11, 2.3, 7.6), bevel=.05)
    box('mind_board_face', S(5.1, 2.7, .13), paper, T(11, 2.3, 7.61), bevel=.03)
    for j, xx in enumerate((8.7, 13.3)):
        box(f'mind_board_post{j}', S(.16, 2.4, .16), oak_dark, T(xx, 1.2, 7.55), bevel=.03)
    box('mind_board_roof', S(5.9, .14, .6), red, T(11, 3.92, 7.6), bevel=.05)
    box('mind_bench_seat', S(2.4, .10, .55), oak, T(11, .45, 10.2), bevel=.04)
    for j, xx in enumerate((10.0, 12.0)):
        box(f'mind_bench_leg{j}', S(.12, .42, .45), oak_dark, T(xx, .21, 10.2), bevel=.02)
    trunk = mat('mind_trunk', (.50, .36, .25))
    crown = mat('mind_crown', (.50, .70, .42))
    crown2 = mat('mind_crown2', (.60, .77, .46))
    for j, (x, z, s) in enumerate(((21.0, 10.0, 1.3), (21.5, 1.0, 1.0), (20.8, -8.5, 1.2), (-32.0, 12.0, 1.1), (-31.6, 1.0, 1.3), (-32.2, -9.5, 1.0), (4.0, -15.6, 1.1), (-17.0, -15.8, 1.3), (-7.0, 18.6, 1.0), (15.5, 18.2, .9), (-22.0, 18.8, 1.2))):
        cone(f'mind_tree{j}_trunk', .16 * s, .11 * s, 1.1 * s, trunk, T(x, .55 * s, z))
        sphere(f'mind_tree{j}_a', .78 * s, crown, T(x, 1.55 * s, z), scale=(1, .9, 1), seg=24)
        sphere(f'mind_tree{j}_b', .52 * s, crown2, T(x + .38 * s, 2.0 * s, z + .2 * s), seg=20)
        sphere(f'mind_tree{j}_c', .46 * s, crown2, T(x - .42 * s, 1.85 * s, z - .1 * s), seg=20)
    export('mind-space.glb')


import sys
if '--mind-only' not in sys.argv:
    build_courier_bag()
    build_workshop()
    build_sleep_mobile()
    build_character()
    build_room()
    build_npc()
if '--skip-mind' not in sys.argv:
    build_mind_space()
print('done')
