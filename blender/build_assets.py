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


def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)


_mats = {}


def mat(name, rgb, rough=0.7, metal=0.0):
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


def sphere(name, r, material, loc, scale=(1, 1, 1), parent=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    return _finish(name, bm, material, loc, parent, lambda p: True)


def box(name, size, material, loc, parent=None, bevel=0.03):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    ob = _finish(name, bm, material, loc, parent, lambda p: False)
    if bevel > 0:
        mod = ob.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    return ob


def cone(name, r1, r2, depth, material, loc, parent=None, rot=(0, 0, 0), caps=True):
    """Blender の Z 軸に沿った円すい台。r1 が下、r2 が上"""
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


# ---------------------------------------------------------------- キャラクター
def build_character():
    reset()
    skin = mat('skin', (0.97, 0.96, 0.92), rough=0.55)
    dark = mat('dark', (0.16, 0.15, 0.2), rough=0.3)
    pink = mat('pink', (0.98, 0.72, 0.72), rough=0.6)
    foot = mat('foot', (0.72, 0.8, 0.9), rough=0.6)
    sprout = mat('sprout', (0.55, 0.78, 0.92), rough=0.5)

    root = empty('character', (0, 0, 0))
    # 体（頭と一体の大きな玉）。中心が y=0.62
    body = empty('body', T(0, 0.62, 0), root)
    sphere('body_mesh', 0.5, skin, (0, 0, 0), scale=(1.0, 0.95, 1.06), parent=body)
    for side, x in (('L', -0.17), ('R', 0.17)):
        sphere('eye' + side, 0.062, dark, T(x, 0.1, 0.43), scale=(1, 0.5, 1.45), parent=body)
        sphere('cheek' + side, 0.07, pink, T(x * 1.75, -0.03, 0.4), scale=(1, 0.35, 0.7), parent=body)
        sphere('arm' + side, 0.1, skin, T(x * 3.05, -0.08, 0.02), scale=(0.8, 1, 1.15), parent=body)
    sphere('mouth', 0.032, dark, T(0, -0.06, 0.485), scale=(1.2, 0.5, 0.8), parent=body)
    # 頭のてっぺんの芽（何も育っていないしるし）
    top = empty('sprout', T(0, 0.5, 0), body)
    cone('sprout_stem', 0.018, 0.018, 0.16, sprout, T(0, 0.07, 0), parent=top)
    sphere('sprout_tip', 0.055, sprout, T(0, 0.19, 0), parent=top)
    for side, x in (('L', -0.2), ('R', 0.2)):
        sphere('foot' + side, 0.13, foot, T(x, 0.075, 0.05), scale=(1, 1.35, 0.6), parent=root)
    export('character.glb')


# ---------------------------------------------------------------- 部屋
def dice(parent):
    white = mat('dice_white', (0.98, 0.98, 0.96), rough=0.35)
    pip = mat('dice_pip', (0.85, 0.25, 0.2), rough=0.4)
    s = 0.3
    box('dice_body', (s, s, s), white, (0, 0, 0), parent=parent, bevel=0.04)
    a = 0.08
    faces = {
        1: [(0, 0)],
        2: [(-a, -a), (a, a)],
        3: [(-a, -a), (0, 0), (a, a)],
        4: [(-a, -a), (a, a), (-a, a), (a, -a)],
        5: [(-a, -a), (a, a), (-a, a), (a, -a), (0, 0)],
        6: [(-a, -a), (a, a), (-a, a), (a, -a), (-a, 0), (a, 0)],
    }
    h = s / 2
    place = {
        1: lambda u, v: (u, v, h), 6: lambda u, v: (u, v, -h),
        2: lambda u, v: (h, u, v), 5: lambda u, v: (-h, u, v),
        3: lambda u, v: (u, h, v), 4: lambda u, v: (u, -h, v),
    }
    for n, pts in faces.items():
        for i, (u, v) in enumerate(pts):
            sphere(f'pip{n}_{i}', 0.03, pip, place[n](u, v), scale=(1, 1, 1), parent=parent)


def build_room():
    reset()
    wood = mat('wood', (0.86, 0.72, 0.54))
    wood_dark = mat('wood_dark', (0.6, 0.44, 0.3))
    wall = mat('wall', (0.83, 0.9, 0.9), rough=0.9)
    rug = mat('rug', (0.97, 0.87, 0.7), rough=0.95)
    board = mat('board', (0.18, 0.29, 0.24), rough=0.9)
    white = mat('white', (0.97, 0.97, 0.95), rough=0.8)
    blue = mat('blue', (0.6, 0.76, 0.9), rough=0.9)
    brass = mat('brass', (0.92, 0.72, 0.3), rough=0.35, metal=0.6)
    wicker = mat('wicker', (0.8, 0.62, 0.38), rough=0.9)
    books = [mat(f'book{i}', c) for i, c in enumerate([
        (0.9, 0.5, 0.42), (0.95, 0.78, 0.4), (0.55, 0.75, 0.6),
        (0.5, 0.68, 0.88), (0.75, 0.6, 0.85), (0.95, 0.65, 0.75)])]

    W, D, H = 5.6, 6.4, 4.2  # 部屋の幅、奥行き、壁の高さ

    box('floor', S(W, 0.2, D), wood, T(0, -0.1, 0), bevel=0)
    cone('rug', 1.35, 1.35, 0.03, rug, T(0, 0.015, 0.5))
    box('wall_back', S(W, H, 0.2), wall, T(0, H / 2, -D / 2 - 0.1), bevel=0)
    # 左の壁は手前を空けて、外の広場への出入り口にする
    box('wall_left', S(0.2, H, 5.2), wall, T(-W / 2 - 0.1, H / 2, -0.7), bevel=0)
    box('wall_right', S(0.2, H, D + 0.2), wall, T(W / 2 + 0.1, H / 2, -0.1), bevel=0)

    # 棚（集計表）。奥の壁の中央
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

    # 黒板（今引いている行を出す）。面の大きさは board_face の scale で渡す
    bw, bh = 5.0, 2.3
    box('board', S(bw + 0.16, bh + 0.16, 0.08), wood_dark, T(0, 2.85, -D / 2 + 0.04), bevel=0.02)
    box('board_slate', S(bw, bh, 0.04), board, T(0, 2.85, -D / 2 + 0.08), bevel=0)
    empty('board_face', T(0, 2.85, -D / 2 + 0.11), scale=S(bw, bh, 1))

    # サイコロ台
    table = empty('table', T(-1.7, 0, 1.7))
    cone('table_top', 0.55, 0.55, 0.08, wood, T(0, 0.6, 0), parent=table)
    cone('table_leg', 0.2, 0.08, 0.56, wood_dark, T(0, 0.28, 0), parent=table)
    d = empty('dice', T(-1.7, 0.79, 1.7))
    dice(d)

    # かご（短期記憶）
    basket = empty('basket', T(-2.05, 0, -0.5))
    kw, kh, kd = 0.95, 0.5, 0.8
    box('basket_bottom', S(kw, 0.06, kd), wicker, T(0, 0.03, 0), parent=basket, bevel=0.01)
    box('basket_f', S(kw, kh, 0.06), wicker, T(0, kh / 2, kd / 2), parent=basket, bevel=0.02)
    box('basket_b', S(kw, kh, 0.06), wicker, T(0, kh / 2, -kd / 2), parent=basket, bevel=0.02)
    box('basket_l', S(0.06, kh, kd), wicker, T(-kw / 2, kh / 2, 0), parent=basket, bevel=0.02)
    box('basket_r', S(0.06, kh, kd), wicker, T(kw / 2, kh / 2, 0), parent=basket, bevel=0.02)

    # ラッパ（口）。右の壁から部屋に向かって開く
    horn = empty('horn', T(W / 2 - 0.45, 1.45, -0.5))
    cone('horn_bell', 0.5, 0.07, 0.7, brass, (0, 0, 0), parent=horn,
         rot=(0, math.radians(90), 0), caps=False)
    cone('horn_pipe', 0.07, 0.07, 0.3, brass, T(0.4, 0, 0), parent=horn,
         rot=(0, math.radians(90), 0))

    # ベッド
    bed = empty('bed', T(1.75, 0, 1.9))
    box('bed_base', S(1.3, 0.3, 2.1), wood_dark, T(0, 0.15, 0), parent=bed)
    box('bed_head', S(1.3, 0.8, 0.1), wood_dark, T(0, 0.4, -1.05), parent=bed)
    box('bed_mattress', S(1.2, 0.2, 2.0), white, T(0, 0.4, 0), parent=bed, bevel=0.05)
    box('bed_pillow', S(0.8, 0.14, 0.42), white, T(0, 0.55, -0.7), parent=bed, bevel=0.06)
    box('bed_blanket', S(1.24, 0.1, 1.15), blue, T(0, 0.5, 0.4), parent=bed, bevel=0.04)

    # 立ち位置などの目印
    empty('at_home', T(0, 0, 0.5))
    empty('at_shelf', T(0, 0, -1.9))
    empty('at_table', T(-0.85, 0, 1.6))
    empty('at_basket', T(-1.2, 0, -0.5))
    empty('at_horn', T(1.55, 0, -0.5))
    empty('at_bed', T(0.75, 0, 1.9))
    empty('bed_top', T(1.75, 1.02, 2.55))
    empty('basket_top', T(-2.05, 0.7, -0.5))
    empty('horn_mouth', T(W / 2 - 0.85, 1.45, -0.5))
    empty('ear', T(-2.05, 3.3, -0.5))

    # ---- 外の広場（盗み聞きの場所）。家の左どなり ----
    grass = mat('grass', (0.66, 0.83, 0.52), rough=0.95)
    leaf = mat('leaf', (0.42, 0.68, 0.4), rough=0.9)
    leaf_light = mat('leaf_light', (0.56, 0.78, 0.45), rough=0.9)
    stone = mat('stone', (0.86, 0.84, 0.78), rough=0.9)
    PW = 6.6  # 広場の幅
    px = -W / 2 - 0.2 - PW / 2  # 広場の中心の x
    box('plaza', S(PW, 0.2, D), grass, T(px, -0.1, 0), bevel=0)
    cone('plaza_circle', 1.7, 1.7, 0.03, stone, T(px - 0.6, 0.015, -0.1))
    for i, (x, z) in enumerate(((-3.35, 2.6), (-3.95, 2.45), (-4.5, 2.2))):
        cone(f'step{i}', 0.24, 0.24, 0.03, stone, T(x, 0.015, z))
    # 茂み（隠れる場所）
    bush = empty('bush', T(-5.0, 0, 1.25))
    for i, (x, y, z, r) in enumerate(((0, 0.38, 0, 0.5), (-0.42, 0.3, 0.12, 0.38),
                                      (0.4, 0.28, -0.1, 0.36), (0.05, 0.62, -0.05, 0.3))):
        sphere(f'bush{i}', r, leaf if i % 2 == 0 else leaf_light, T(x, y, z), parent=bush)
    # 木とベンチ
    tree = empty('tree', T(px - 2.3, 0, -2.2))
    cone('tree_trunk', 0.2, 0.14, 1.5, wood_dark, T(0, 0.75, 0), parent=tree)
    sphere('tree_top0', 0.95, leaf, T(0, 2.1, 0), parent=tree)
    sphere('tree_top1', 0.65, leaf_light, T(0.55, 1.75, 0.3), parent=tree)
    sphere('tree_top2', 0.6, leaf_light, T(-0.5, 1.8, 0.2), parent=tree)
    bench = empty('bench', T(px + 0.9, 0, -2.6))
    box('bench_seat', S(1.6, 0.08, 0.45), wood, T(0, 0.45, 0), parent=bench, bevel=0.02)
    box('bench_back', S(1.6, 0.4, 0.07), wood, T(0, 0.85, -0.2), parent=bench, bevel=0.02)
    for i, x in enumerate((-0.65, 0.65)):
        box(f'bench_leg{i}', S(0.08, 0.45, 0.4), wood_dark, T(x, 0.225, 0), parent=bench, bevel=0.01)

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
    dark = mat('dark', (0.16, 0.15, 0.2), rough=0.3)
    root = empty('npc', (0, 0, 0))
    sphere('npc_body', 0.36, cloth, T(0, 0.5, 0), scale=(1, 0.9, 1.4), parent=root)
    head = empty('npc_head', T(0, 1.22, 0), root)
    sphere('npc_head_mesh', 0.3, skin, (0, 0, 0), parent=head)
    sphere('npc_hat', 0.31, cloth, T(0, 0.08, -0.02), scale=(1.02, 1.02, 0.8), parent=head)
    for side, x in (('L', -0.11), ('R', 0.11)):
        sphere('npc_eye' + side, 0.04, dark, T(x, -0.03, 0.27), scale=(1, 0.5, 1.3), parent=head)
    export('npc.glb')


build_character()
build_room()
build_npc()
print('done')
