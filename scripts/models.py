"""Author the original low-poly models and shared diffuse textures.

Blender background mode: blender -b -t 2 --python scripts/models.py
"""

import math
import random
from pathlib import Path
import bpy
from mathutils import Vector


OUT = Path(__file__).resolve().parents[1] / "packages/web/public/models"
OUT.mkdir(parents=True, exist_ok=True)


def material(name, color, roughness=.78, paint=True, luminous=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    surface = nodes.get("Principled BSDF")
    surface.inputs["Base Color"].default_value = (*color, 1)
    surface.inputs["Roughness"].default_value = roughness
    if luminous:
        surface.inputs["Emission Color"].default_value = (*color, 1)
        surface.inputs["Emission Strength"].default_value = .48
    if paint:
        texture = bpy.data.images.new(name + " paint", width=32, height=32, alpha=False)
        rng = random.Random(name)
        rgba = []
        for y in range(32):
            for x in range(32):
                grain = 0.89 + y * .0055 + .038 * math.sin(x * .65 + y * .43) + rng.uniform(-.036, .03)
                rgba.extend([min(1., channel * grain) for channel in color] + [1.])
        texture.pixels.foreach_set(rgba)
        texture.pack()
        node = nodes.new("ShaderNodeTexImage")
        node.image = texture
        mat.node_tree.links.new(node.outputs["Color"], surface.inputs["Base Color"])
    return mat


def part(obj, name, mat, parent, smooth=True):
    obj.name = name
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    for face in obj.data.polygons:
        face.use_smooth = smooth
    return obj


def root(name, position=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = position
    return obj


def oval(name, position, scale, mat, parent, segs=10, rings=6, tilt=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, location=position)
    obj = part(bpy.context.object, name, mat, parent)
    obj.scale = scale
    obj.rotation_euler[1] = tilt
    return obj


def rod(name, start, end, radius_start, radius_end, mat, parent, sides=8):
    a, b = Vector(start), Vector(end)
    direction = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=radius_start, radius2=radius_end,
                                   depth=direction.length, location=(a + b) / 2)
    obj = part(bpy.context.object, name, mat, parent)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return obj


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def export(name):
    bpy.ops.export_scene.gltf(filepath=str(OUT / (name + ".glb")), export_format="GLB",
                             export_cameras=False, export_lights=False, export_texcoords=True)


jacket = material("Rust nylon", (.35, .13, .052))
cream = material("Cream seams", (.64, .52, .34))
denim = material("Midnight cargo", (.038, .057, .086))
skin = material("Skin diffuse", (.57, .31, .18))
hair = material("Hair diffuse", (.065, .034, .028))
rubber = material("Charcoal tread", (.095, .094, .098))


def courier():
    clear()
    core = root("courier")
    chest = root("torso", (0, 0, .99), core)
    oval("track jacket", (.019, 0, .245), (.181, .261, .291), jacket, chest, 12, 8)
    oval("waistband", (.016, 0, .048), (.158, .218, .103), denim, chest)
    rod("zipper", (.19, 0, .12), (.17, 0, .46), .011, .011, cream, chest, 5)
    oval("collar", (.027, 0, .477), (.107, .105, .055), cream, chest)
    head = root("head", (.055, 0, .47), chest)
    rod("neck", (0, 0, -.014), (.005, 0, .11), .068, .068, skin, head)
    oval("head mesh", (.036, 0, .226), (.119, .097, .143), skin, head, 12, 8)
    oval("hair crown", (.008, 0, .286), (.137, .108, .108), hair, head, 12, 6, -.12)
    oval("swept fringe", (.098, -.035, .275), (.08, .079, .058), hair, head, 9, 6, .38)
    oval("nose", (.143, 0, .208), (.023, .028, .025), skin, head, 8, 5)
    for suffix, sign in (("near", -1), ("far", 1)):
        oval("eye " + suffix, (.119, sign * .059, .238), (.016, .012, .008), hair, head, 8, 5)
        arm = root("arm_" + suffix, (.023, sign * .231, .38), chest)
        oval("jacket shoulder", (0, 0, -.06), (.105, .093, .119), jacket, arm)
        rod("upper sleeve", (.007, 0, -.025), (.02, 0, -.29), .092, .068, jacket, arm)
        rod("sleeve piping", (.013, sign * .086, -.054), (.025, sign * .064, -.257), .012, .012, cream, arm, 5)
        elbow = root("elbow_" + suffix, (.019, 0, -.277), arm)
        rod("forearm sleeve", (0, 0, 0), (.012, 0, -.208), .071, .053, jacket, elbow)
        oval("cuff", (.011, 0, -.205), (.065, .062, .036), cream, elbow)
        oval("hand", (.018, 0, -.266), (.065, .046, .082), skin, elbow)
        leg = root("leg_" + suffix, (-.021, sign * .131, 1.02), core)
        rod("trouser thigh", (0, 0, 0), (.024, 0, -.425), .131, .094, denim, leg)
        oval("cargo pocket", (-.009, sign * .09, -.17), (.09, .051, .104), denim, leg)
        knee = root("knee_" + suffix, (.023, 0, -.419), leg)
        rod("trouser shin", (0, 0, 0), (-.025, 0, -.414), .088, .064, denim, knee)
        oval("trainer sole", (.055, 0, -.508), (.175, .094, .043), cream, knee, 10, 5)
        oval("trainer upper", (.039, 0, -.48), (.163, .087, .067), rubber, knee, 10, 5)
    export("courier")


palette = {
    "moth": ((.126, .35, .29), (.29, .77, .61)),
    "brick": ((.42, .183, .133), (.94, .54, .20)),
    "heron": ((.173, .216, .41), (.40, .58, .96)),
    "boar": ((.28, .11, .09), (.9, .343, .105)),
    "skitter": ((.26, .24, .09), (.81, .49, .13)),
    "guard": ((.29, .12, .141), (.88, .36, .32)),
    "keeper": ((.172, .217, .27), (.74, .295, .16)),
}
biotissue = material("Violet muscle", (.185, .063, .11), .62)
edge = material("Warm enamel", (.59, .49, .31), .68)


def creature(family, size=1):
    clear()
    color, glow = palette[family]
    shell = material(family + " chitin", color, .59)
    organ = material(family + " living core", glow, .42, paint=False, luminous=True)
    body = root("creature", (0, 0, 0))
    body.scale = (size,) * 3
    hull = root("organism", (.015, 0, .37), body)
    scale = {"moth": (.35, .23, .23), "brick": (.38, .31, .31), "heron": (.29, .19, .24),
             "boar": (.48, .31, .29), "skitter": (.42, .29, .25),
             "guard": (.42, .35, .38), "keeper": (.36, .42, .53)}[family]
    oval("living abdomen", (-.035, 0, .11), scale, biotissue, hull, 12, 8)
    oval("main shell", (-.10, 0, .19), tuple(v * 1.08 for v in scale), shell, hull, 12, 8, -.14)
    lens = oval("pulse_core", (scale[0] - .012, 0, .133), (.103, .158, .109), organ, hull, 12, 8)
    oval("brow plate", (scale[0] - .01, 0, .238), (.152, .169, .067), edge, hull, 10, 5, -.23)
    for sign, suffix in ((-1, "near"), (1, "far")):
        side = root("plate_" + suffix, (-.07, sign * scale[1] * .62, .22), hull)
        extent = .51 if family in ("moth", "heron") else .32
        oval("shell lobe " + suffix, (-.1, extent * sign * .5, .06), (.262, extent, .075), shell, side, 12, 7, -.34)
        oval("rib seam " + suffix, (-.065, extent * sign *.61, -.012), (.192, extent * .66, .031), edge, side)
        if family == "heron":
            rod("quill " + suffix, (-.15, extent * sign * .42, .03), (-.47, extent * sign, .22), .057, .008, edge, side)
        if family == "boar":
            rod("tusk " + suffix, (.25, sign * .16, -.015), (.57, sign * .18, .13), .065, .015, edge, hull)
        if family != "moth":
            leg = root("leg_" + suffix, (-.04, sign * scale[1] * .8, -.05), hull)
            elbow = (.128, .135 * sign, -.108)
            rod("tendon " + suffix, (0, 0, 0), elbow, .074, .051, biotissue, leg)
            oval("ankle " + suffix, elbow, (.068, .058, .062), shell, leg)
            rod("shin " + suffix, elbow, (.015, .17 * sign, -.3), .054, .032, shell, leg)
            oval("toe " + suffix, (.06, .17 * sign, -.30), (.096, .057, .042), edge, leg)
        else:
            rod("feelers " + suffix, (.18, .09 * sign, .252), (.31, .16 * sign, .387), .025, .007, biotissue, hull, 6)
    if family == "keeper":
        for sign in (-1, 1):
            rod("long keeper tendril", (0, sign * .27, .34), (.2, sign * .65, .045), .10, .041, shell, hull)
            oval("tendril gland", (.21, sign * .64, .02), (.107, .074, .098), organ, hull)
    export(family)


def weapon(family):
    clear()
    color, glow = palette[family]
    shell = material(family + " weapon shell", color, .46)
    organ = material(family + " weapon organ", glow, .35, paint=False, luminous=True)
    w = root("armed_organism")
    if family == "brick":
        for y in (-.23, .23):
            oval("gauntlet palm", (.105, y, 0), (.278, .136, .132), shell, w, 12, 7)
            oval("knuckle core", (.305, y, .053), (.114, .099, .062), organ, w)
            for i in range(3):
                oval("folded shell", (.19, y + (i - 1) * .065, .093), (.12, .037, .047), edge, w)
    else:
        rod("tendon grip", (-.43, 0, 0), (.59, 0, 0), .048, .035, biotissue, w)
        rod("enamel shaft", (.22, 0, 0), (1.17, 0, 0), .048, .027, edge, w)
        if family == "boar":
            oval("hammer heart", (1.0, 0, .035), (.23, .33, .238), shell, w, 12, 8)
            oval("hammer gland", (1.05, -.258, .055), (.109, .092, .122), organ, w)
            for sign in (-1, 1):
                oval("interlocked end", (1.02, sign * .24, .07), (.16, .119, .18), edge, w)
        elif family == "heron":
            oval("blade root", (.49, 0, .014), (.20, .113, .088), shell, w)
            rod("glass cutting plane", (.72, 0, .005), (1.85, 0, .05), .11, .005, organ, w, 4)
            rod("spine", (.59, 0, .046), (1.7, 0, .11), .048, .006, edge, w, 5)
        else:
            oval("staff floating core", (1.24, 0, .014), (.185, .082, .085), organ, w)
            for sign in (-1, 1):
                oval("folded kite plate", (1.17, sign * .116, 0), (.287, .057, .102), shell, w)
                rod("prong", (1.29, sign * .106, .014), (1.65, sign * .151, .05), .045, .006, edge, w)
    export(family + "-weapon")


def portrait(family):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 10
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 280
    scene.render.resolution_y = 220
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.world.use_nodes = True
    scene.world.node_tree.nodes.get("Background").inputs["Strength"].default_value = .64
    bpy.ops.object.camera_add(location=(2.0, -3.18, 1.71))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((-.01, 0, .47)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 1.62
    scene.camera = camera
    for position, color, power in [((1.7, -2.6, 2.6), (1., .87, .73), 125),
                                   ((-1.3, 1.0, 2.3), (.53, .82, 1.), 115)]:
        bpy.ops.object.light_add(type="AREA", location=position)
        light = bpy.context.object
        light.data.energy = power
        light.data.color = color
        light.data.shape = "DISK"
        light.data.size = 2.0
        light.rotation_euler = (Vector((0, 0, .5)) - light.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(OUT / (family + "-portrait.png"))
    bpy.ops.render.render(write_still=True)


courier()
for name in ("moth", "brick", "heron", "boar"):
    creature(name)
    portrait(name)
    weapon(name)
for name, size in (("skitter", 1.38), ("guard", 1.65), ("keeper", 2.37)):
    creature(name, size)
