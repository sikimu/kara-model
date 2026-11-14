"""Offline visual QA of exported GLBs; run Blender with -- --skip-mind."""
import bpy
import os
import sys
from mathutils import Vector
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, 'assets', name + '.glb'))
    return [o for o in bpy.data.objects if o not in before]

def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.world = bpy.data.worlds.new('soft_sky')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.65, .76, .9, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = .35
    scene.view_settings.view_transform = 'AgX'
    return scene

def light(loc, power, size, color, target):
    d = bpy.data.lights.new('softbox', 'AREA')
    d.energy, d.shape, d.size, d.color = power, 'DISK', size, color
    o = bpy.data.objects.new('softbox', d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - o.location).to_track_quat('-Z', 'Y').to_euler()

def render(tag, target, location, scale):
    scene = bpy.context.scene
    d = bpy.data.cameras.new('camera')
    o = bpy.data.objects.new('camera', d)
    scene.collection.objects.link(o)
    o.location = location
    o.rotation_euler = (Vector(target) - o.location).to_track_quat('-Z', 'Y').to_euler()
    d.type, d.ortho_scale = 'ORTHO', scale
    scene.camera = o
    light((target[0]-3, target[1]-4, 9), 1400, 5, (1, .86, .69), target)
    light((target[0]+4, target[1]+1, 6), 850, 4, (.72, .84, 1), target)
    scene.render.filepath = os.path.join(ROOT, 'tools', 'out', 'codex-' + tag + '.png')
    bpy.ops.render.render(write_still=True)

if '--house-only' not in sys.argv:
    setup()
    load('character')
    npc = load('npc')
    for o in npc:
        if o.parent is None: o.location.x += 1.35
    load('courier-bag')
    render('characters', (.65, 0, .85), (2.7, -7, 2.6), 3.3)
    

if True:
    setup()
    load('room')
    for name in ('plaza_root', 'town_root'):
        o = bpy.data.objects.get(name)
        for child in [o] + list(o.children_recursive): child.hide_render = True
    load('character')
    render('house', (0, 0, 1.5), (10, -18, 12), 13)
    

if '--house-only' not in sys.argv:
    setup()
    load('room')
    o = bpy.data.objects.get('house_root')
    for child in [o] + list(o.children_recursive): child.hide_render = True
    npc = load('npc')
    for o in npc:
        if o.parent is None: o.location.x -= 8
    render('plaza', (-4.5, 0, 1.1), (4, -19, 12), 16)
    

if '--house-only' not in sys.argv:
    setup()
    load('workshop')
    moon = load('sleep-mobile')
    for o in moon:
        if o.parent is None: o.location += Vector((0, 0, 1.2))
    render('props', (0, 0, .25), (5, -8, 9), 8)
    
