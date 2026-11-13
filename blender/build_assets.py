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


def sphere(name, r, material, loc, scale=(1, 1, 1), parent=None, rot=(0, 0, 0), seg=32):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    ob = _finish(name, bm, material, loc, parent, lambda p: True)
    ob.rotation_euler = rot
    return ob


def box(name, size, material, loc, parent=None, bevel=0.03, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    ob = _finish(name, bm, material, loc, parent, lambda p: False)
    ob.rotation_euler = rot
    if bevel > 0:
        mod = ob.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    return ob


def cone(name, r1, r2, depth, material, loc, parent=None, rot=(0, 0, 0), caps=True):
    """Blender の Z 軸（three.js の上方向）に沿った円すい台。r1 が下、r2 が上"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=32,
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
def build_character():
    """主人公。形はデザイン画（docs/art/character-sheet.png）に合わせる"""
    reset()
    skin = mat('skin', (0.995, 0.965, 0.9), rough=0.55)
    dark = mat('eye_dark', (0.2, 0.13, 0.11), rough=0.12)
    white = mat('eye_white', (1.0, 1.0, 1.0), rough=0.2, glow=0.3)
    pink = mat('pink', (0.99, 0.72, 0.74), rough=0.7)
    ear_in = mat('ear_in', (0.99, 0.78, 0.8), rough=0.7)
    mouth = mat('mouth', (0.36, 0.22, 0.2), rough=0.5)
    scarf = mat('scarf', (0.42, 0.62, 0.87), rough=0.85)
    stem = mat('stem', (0.5, 0.7, 0.3), rough=0.6)
    leaf = mat('leaf_new', (0.56, 0.76, 0.33), rough=0.55)

    root = empty('character', (0, 0, 0))
    # 足（体と同じ色の、短くて丸い足）
    for side, x in (('L', -0.125), ('R', 0.125)):
        foot = empty('foot' + side, T(x, 0.11, 0.0), root)
        sphere('foot_mesh' + side, 0.118, skin, (0, 0, 0), scale=(1.0, 1.12, 0.95), parent=foot)

    # 体（下ぶくれの洋なし形）
    body = empty('body', T(0, 0.4, 0), root)
    sphere('torso', 0.25, skin, T(0, 0.02, 0), scale=(1.0, 0.9, 1.1), parent=body)
    sphere('hips', 0.285, skin, T(0, -0.1, 0), scale=(1.02, 0.9, 0.8), parent=body)
    sphere('tail', 0.09, skin, T(0, -0.13, -0.28), parent=body)
    # マフラー（首に巻いて、前に垂らす）
    sphere('scarf_ring', 0.3, scarf, T(0, 0.15, 0), scale=(1.06, 1.0, 0.3), parent=body)
    sphere('scarf_knot', 0.085, scarf, T(0.17, 0.12, 0.24), scale=(1.1, 0.8, 0.9), parent=body)
    box('scarf_tail', S(0.14, 0.3, 0.05), scarf, T(0.19, -0.04, 0.27), parent=body, bevel=0.022,
        rot=RZ(-8))
    # 腕（肩を中心に回して上げ下げする。短くて先が丸い）
    for side, x in (('L', -1), ('R', 1)):
        arm = empty('arm' + side, T(x * 0.26, 0.07, 0), body)
        sphere('arm_mesh' + side, 0.088, skin, T(x * 0.03, -0.12, 0), scale=(0.92, 0.92, 1.75),
               parent=arm, rot=RZ(x * 12))

    # 頭（横に広く、少しつぶれた玉）
    head = empty('head', T(0, 0.46, 0), body)
    sphere('head_mesh', 0.44, skin, (0, 0, 0), scale=(1.09, 0.95, 0.87), parent=head, seg=48)
    for side, x in (('L', -1), ('R', 1)):
        sphere('ear' + side, 0.155, skin, T(x * 0.34, 0.27, -0.02), scale=(1, 0.55, 1), parent=head)
        sphere('ear_in' + side, 0.095, ear_in, T(x * 0.34, 0.265, 0.045), scale=(1, 0.35, 1), parent=head)
        # 目（大きな黒い目に、白い光が 2 つ）
        eye = empty('eye' + side, T(x * 0.185, -0.02, 0.372), head)
        sphere('eye_iris' + side, 0.088, dark, (0, 0, 0), scale=(0.84, 0.4, 1.1), parent=eye)
        sphere('eye_light' + side, 0.028, white, T(0.022, 0.042, 0.034), scale=(1, 0.5, 1), parent=eye, seg=16)
        sphere('eye_light2' + side, 0.013, white, T(-0.026, -0.036, 0.034), scale=(1, 0.5, 1), parent=eye, seg=12)
        sphere('cheek' + side, 0.075, pink, T(x * 0.3, -0.125, 0.288), scale=(1.15, 0.25, 0.62), parent=head)
    # 口もと（小さなふくらみと、ω の形の口）
    sphere('muzzle', 0.09, skin, T(0, -0.115, 0.385), scale=(1.25, 0.6, 0.8), parent=head)
    for side, x in (('L', -1), ('R', 1)):
        sphere('mouth' + side, 0.02, mouth, T(x * 0.021, -0.122, 0.438), scale=(1.2, 0.45, 0.75),
               parent=head, seg=12)
    # 頭のてっぺんの芽（双葉）。育つと大きくなる
    sprout = empty('sprout', T(0, 0.37, 0), head)
    cone('sprout_stem', 0.02, 0.016, 0.17, stem, T(0, 0.085, 0), parent=sprout)
    for side, x in (('L', -1), ('R', 1)):
        sphere('sprout_leaf' + side, 0.1, leaf, T(x * 0.125, 0.2, 0), scale=(1.45, 0.75, 0.3),
               parent=sprout, rot=RZ(x * 20))
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
    wood = mat('wood', (0.86, 0.72, 0.54))
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

    W, D, H = 5.6, 6.4, 4.2  # 家の幅、奥行き、壁の高さ

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
        box(f'shelf_plank{i}', S(sw, 0.08, sd), wood_dark, T(0, y, 0), parent=shelf, bevel=0.01)
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
    basket = empty('basket', T(-2.05, 0, -0.5))
    kw, kh, kd = 0.95, 0.5, 0.8
    box('basket_bottom', S(kw, 0.06, kd), wicker, T(0, 0.03, 0), parent=basket, bevel=0.01)
    box('basket_f', S(kw, kh, 0.06), wicker, T(0, kh / 2, kd / 2), parent=basket, bevel=0.02)
    box('basket_b', S(kw, kh, 0.06), wicker, T(0, kh / 2, -kd / 2), parent=basket, bevel=0.02)
    box('basket_l', S(0.06, kh, kd), wicker, T(-kw / 2, kh / 2, 0), parent=basket, bevel=0.02)
    box('basket_r', S(0.06, kh, kd), wicker, T(kw / 2, kh / 2, 0), parent=basket, bevel=0.02)
    box('basket_band', S(kw + 0.02, 0.07, kd + 0.02), wood_dark, T(0, kh - 0.06, 0), parent=basket, bevel=0.02)

    # ベッド
    bed = empty('bed', T(1.75, 0, 1.9))
    box('bed_base', S(1.3, 0.3, 2.1), wood_dark, T(0, 0.15, 0), parent=bed)
    box('bed_head', S(1.3, 0.85, 0.1), wood_dark, T(0, 0.42, -1.05), parent=bed)
    box('bed_foot', S(1.3, 0.5, 0.1), wood_dark, T(0, 0.25, 1.05), parent=bed)
    box('bed_mattress', S(1.2, 0.2, 2.0), white, T(0, 0.4, 0), parent=bed, bevel=0.05)
    box('bed_pillow', S(0.8, 0.14, 0.42), white, T(0, 0.55, -0.7), parent=bed, bevel=0.06)
    box('bed_blanket', S(1.24, 0.1, 1.15), blue, T(0, 0.5, 0.4), parent=bed, bevel=0.04)
    box('bed_blanket_fold', S(1.24, 0.12, 0.2), white, T(0, 0.51, -0.2), parent=bed, bevel=0.04)

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
    empty('at_basket', T(-1.2, 0, -0.5))
    empty('at_bed', T(0.75, 0, 1.9))
    empty('bed_top', T(1.75, 1.0, 2.6))
    empty('basket_top', T(-2.05, 0.7, -0.5))
    empty('ear', T(-2.05, 3.3, -0.5))
    empty('at_door_in', T(-2.1, 0, 2.65))
    empty('at_door_out', T(-3.6, 0, 2.6))
    empty('at_hide', T(-4.35, 0, 1.7))
    empty('plaza_center', T(px - 0.6, 0, -0.1))
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
    sphere('npc_body', 0.34, cloth, T(0, 0.55, 0), scale=(1, 0.88, 1.45), parent=root)
    head = empty('npc_head', T(0, 1.24, 0), root)
    sphere('npc_head_mesh', 0.3, skin, (0, 0, 0), parent=head)
    sphere('npc_hat', 0.31, cloth, T(0, 0.09, -0.02), scale=(1.03, 1.03, 0.78), parent=head)
    cone('npc_hat_brim', 0.36, 0.36, 0.03, cloth, T(0, 0.1, 0.03), parent=head)
    for side, x in (('L', -0.11), ('R', 0.11)):
        sphere('npc_eye' + side, 0.04, dark, T(x, -0.04, 0.27), scale=(1, 0.5, 1.3), parent=head)
        sphere('npc_cheek' + side, 0.045, pink, T(x * 1.8, -0.1, 0.23), scale=(1, 0.4, 0.6), parent=head)
    export('npc.glb')


build_character()
build_room()
build_npc()
print('done')
