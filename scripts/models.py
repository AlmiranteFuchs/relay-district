"""Author the original low-poly models and shared diffuse textures.

Blender background mode: blender -b -t 2 --python scripts/models.py
One companion and weapon: blender -b -t 2 --python scripts/models.py -- --pair moth
Mission cast only: blender -b -t 2 --python scripts/models.py -- --cast
"""

import argparse
import math
import random
import sys
from pathlib import Path
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gameplay_meshes import ENEMY_MESHES, build_courier, build_enemy


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


def courier():
    clear()
    build_courier()
    export("courier")


palette = {
    "brick": ((.42, .183, .133), (.94, .54, .20)),
    "heron": ((.173, .216, .41), (.40, .58, .96)),
    "boar": ((.28, .11, .09), (.9, .343, .105)),
}
biotissue = material("Violet muscle", (.185, .063, .11), .62)
edge = material("Warm enamel", (.59, .49, .31), .68)
moth_shell = material("Kite Moth ivory chitin", (.77, .82, .64), .64)
moth_membrane = material("Kite Moth wing membrane", (.30, .45, .35), .72)
moth_tissue = material("Kite Moth flex tissue", (.27, .11, .16), .65)
moth_socket = material("Kite Moth lens socket", (.14, .22, .21), .72)
moth_lens = material("Kite Moth pulse organ", (.25, .74, .61), .42, luminous=True)


def carapace(name, position, scale, mat, parent, tilt=0):
    shell = oval(name, position, scale, mat, parent, 10, 6, tilt)
    for vertex in shell.data.vertices:
        x, _, z = vertex.co
        vertex.co.y *= .95 + .14 * x - .17 * x * x
        vertex.co.z = z * (1 if z > 0 else .52) - .13 * x * x
    shell.data.update()
    return shell


def kite_moth(size):
    body = root("creature")
    body.scale = (size,) * 3
    hull = root("organism", (.015, 0, .37), body)
    oval("flexible thorax", (-.074, 0, .105), (.365, .217, .173), moth_tissue, hull, 10, 6, -.15)
    carapace("raised thorax chitin", (-.112, 0, .187), (.369, .237, .195), moth_shell, hull, -.16)
    oval("pulse socket", (.278, 0, .133), (.152, .147, .134), moth_socket, hull)
    oval("pulse_core", (.338, 0, .133), (.103, .158, .109), moth_lens, hull, 12, 8)
    carapace("visor over pulse organ", (.337, 0, .237), (.147, .166, .063), moth_shell, hull, -.23)
    carapace("plated jaw", (.291, 0, .019), (.166, .126, .078), moth_membrane, hull, .16)

    for sign, suffix in ((-1, "near"), (1, "far")):
        side = root("plate_" + suffix, (-.07, sign * .23 * .62, .22), hull)
        underwing = carapace("tapered underwing", (-.116, sign * .187, -.046), (.306, .259, .069), moth_membrane, side, -.21)
        cap = carapace("folded dorsal chitin", (-.126, sign * .139, -.014), (.316, .217, .087), moth_shell, side, -.21)
        underwing.rotation_euler.z = cap.rotation_euler.z = -sign * .39
        outer_seam = carapace("inset wing seam", (-.105, sign * .252, -.025), (.213, .047, .038), moth_socket, side, -.1)
        outer_seam.rotation_euler.z = -sign * .39

        joint = (.084, sign * .235, -.011)
        knee = (.108, sign * .264, -.134)
        foot = (.235, sign * .228, -.19)
        rod("flexor", joint, knee, .043, .032, moth_tissue, hull, 7)
        oval("knee shell", knee, (.053, .046, .048), moth_membrane, hull, 8, 5)
        rod("folded tarsus", knee, foot, .039, .015, moth_shell, hull, 7)
        rod("tarsal tip", foot, (.268, sign * .22, -.17), .017, .007, moth_tissue, hull, 6)

        feeler_joint = (.246, sign * .128, .352)
        rod("feeler root", (.164, sign * .094, .268), feeler_joint, .024, .016, moth_tissue, hull, 6)
        rod("feelers " + suffix, feeler_joint, (.359, sign * .196, .383), .017, .008, moth_membrane, hull, 6)


def creature(family, size=1):
    clear()
    if family == "moth":
        kite_moth(size)
        export(family)
        return
    if family in ENEMY_MESHES:
        build_enemy(family, size)
        export(family)
        return
    color, glow = palette[family]
    shell = material(family + " chitin", color, .59)
    organ = material(family + " living core", glow, .42, paint=False, luminous=True)
    body = root("creature", (0, 0, 0))
    body.scale = (size,) * 3
    hull = root("organism", (.015, 0, .37), body)
    scale = {"brick": (.38, .31, .31), "heron": (.29, .19, .24), "boar": (.48, .31, .29)}[family]
    oval("living abdomen", (-.035, 0, .11), scale, biotissue, hull, 12, 8)
    oval("main shell", (-.10, 0, .19), tuple(v * 1.08 for v in scale), shell, hull, 12, 8, -.14)
    oval("pulse_core", (scale[0] - .012, 0, .133), (.103, .158, .109), organ, hull, 12, 8)
    oval("brow plate", (scale[0] - .01, 0, .238), (.152, .169, .067), edge, hull, 10, 5, -.23)
    for sign, suffix in ((-1, "near"), (1, "far")):
        side = root("plate_" + suffix, (-.07, sign * scale[1] * .62, .22), hull)
        extent = .51 if family == "heron" else .32
        oval("shell lobe " + suffix, (-.1, extent * sign * .5, .06), (.262, extent, .075), shell, side, 12, 7, -.34)
        oval("rib seam " + suffix, (-.065, extent * sign *.61, -.012), (.192, extent * .66, .031), edge, side)
        if family == "heron":
            rod("quill " + suffix, (-.15, extent * sign * .42, .03), (-.47, extent * sign, .22), .057, .008, edge, side)
        if family == "boar":
            rod("tusk " + suffix, (.25, sign * .16, -.015), (.57, sign * .18, .13), .065, .015, edge, hull)
        leg = root("leg_" + suffix, (-.04, sign * scale[1] * .8, -.05), hull)
        elbow = (.128, .135 * sign, -.108)
        rod("tendon " + suffix, (0, 0, 0), elbow, .074, .051, biotissue, leg)
        oval("ankle " + suffix, elbow, (.068, .058, .062), shell, leg)
        rod("shin " + suffix, elbow, (.015, .17 * sign, -.3), .054, .032, shell, leg)
        oval("toe " + suffix, (.06, .17 * sign, -.30), (.096, .057, .042), edge, leg)
    export(family)


def coil_staff():
    w = root("armed_organism")
    rod("tendon grip", (-.43, 0, 0), (.35, 0, 0), .045, .061, moth_tissue, w)
    oval("heel plate", (-.408, 0, 0), (.084, .054, .058), moth_membrane, w, 8, 5)
    for x in (-.29, -.22, -.15):
        oval("grip band", (x, 0, 0), (.022, .052, .052), moth_socket, w, 8, 5)
    rod("enamel shaft", (.098, 0, 0), (1.22, 0, .014), .053, .046, moth_shell, w)
    rod("shaft tendon", (.22, -.038, -.022), (1.14, -.047, -.013), .014, .023, moth_membrane, w, 6)
    oval("pulse socket", (1.18, 0, .022), (.197, .097, .100), moth_socket, w, 10, 6)
    oval("staff floating core", (1.28, 0, .045), (.188, .107, .090), moth_lens, w, 12, 8)
    for sign in (-1, 1):
        folded = carapace("folded kite plate", (1.14, sign * .086, -.024), (.29, .071, .086), moth_shell, w, -.17)
        folded.rotation_euler.z = sign * .15
        rod("membrane seam", (.95, sign * .078, -.013), (1.39, sign * .146, .036), .018, .024, moth_membrane, w, 6)
        rod("prong", (1.32, sign * .105, .026), (1.64, sign * .134, .079), .04, .014, moth_shell, w, 7)


def weapon(family):
    clear()
    if family == "moth":
        coil_staff()
        export(family + "-weapon")
        return
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


def generate():
    families = ("moth", "brick", "heron", "boar")
    parser = argparse.ArgumentParser(description="Generate Relay District GLB assets")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--pair", choices=families, help="Export only the creature and weapon GLBs for this family")
    selection.add_argument("--cast", action="store_true", help="Export only the courier and mission enemies")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if args.pair:
        creature(args.pair)
        weapon(args.pair)
        return
    courier()
    for name, size in (("skitter", 1.38), ("guard", 1.65), ("keeper", 2.37)):
        creature(name, size)
    if args.cast:
        return
    for name in families:
        creature(name)
        portrait(name)
        weapon(name)


if __name__ == "__main__":
    generate()
