"""Build the original Relay District courier benchmark from its turnaround."""

import argparse
import math
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gameplay_meshes import joint, ring_mesh, shell


# The diffuse atlas uses broad painted edges and folds at 64 pixels per swatch.
PALETTE = {
    "teal": (.055, .34, .32),
    "teal shade": (.038, .175, .17),
    "canvas": (.74, .63, .38),
    "ink": (.025, .032, .060),
    "navy": (.055, .074, .125),
    "denim light": (.103, .136, .213),
    "skin": (.74, .42, .25),
    "skin shade": (.42, .19, .119),
    "hair": (.027, .043, .068),
    "hair light": (.065, .106, .153),
    "eye": (.81, .73, .58),
    "iris": (.05, .205, .181),
    "purple": (.202, .129, .244),
    "copper": (.86, .43, .088),
}

JACKET_ROWS = [
    (.123, .007, 0, .106, .135), (.157, .007, 0, .123, .160),
    (.223, .011, 0, .135, .172), (.326, .004, 0, .143, .189),
    (.403, -.005, 0, .123, .209), (.448, -.017, 0, .097, .169),
    (.483, -.005, 0, .081, .094),
]


def diffuse():
    size, tile = 256, 64
    image = bpy.data.images.new("Courier cloth, skin and ink · 256", width=size, height=size, alpha=False)
    pixels = [0.0] * (size * size * 4)
    for index, (name, color) in enumerate(PALETTE.items()):
        for y in range(tile):
            for x in range(tile):
                u, v = (x - 2) / 59, (y - 2) / 59
                u, v = min(1, max(u, 0)), min(1, max(v, 0))
                shade = .90 + .11 * v if name == "navy" else .80 + .31 * v
                if name in ("teal", "teal shade", "navy", "denim light", "purple"):
                    line = abs(u - .30 - .24 * v)
                    fold = max(0, 1 - line / .18) * math.sin(math.pi * v) ** 2
                    shade += .16 * fold
                    shade -= .125 * max(0, 1 - abs(u - .68 + .18 * v) / .08) * math.sin(math.pi * v)
                if name.startswith("hair"):
                    highlight = abs(v - .69 + .45 * (u - .41) ** 2)
                    shade += .20 * max(0, 1 - highlight / .16)
                if name in ("ink", "iris", "eye"):
                    shade = .94 + .11 * v
                at = ((index // 4 * tile + y) * size + index % 4 * tile + x) * 4
                pixels[at:at + 4] = [min(1, c * shade) for c in color] + [1]
    image.pixels.foreach_set(pixels)
    image.pack()
    mat = bpy.data.materials.new("Relay District courier diffuse")
    mat.use_nodes = True
    graph = mat.node_tree
    texture = graph.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Linear"
    shader = graph.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = .91
    shader.inputs["Specular IOR Level"].default_value = .16
    shader.inputs["Emission Strength"].default_value = .13
    graph.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    graph.links.new(texture.outputs["Color"], shader.inputs["Emission Color"])
    return mat


SWATCHES = {name: index for index, name in enumerate(PALETTE)}


def tint(model, color):
    column, row = SWATCHES[color] % 4, SWATCHES[color] // 4
    for point in model.data.uv_layers.active.data:
        u, v = point.uv
        point.uv = ((column * 64 + 2.5 + 59 * u) / 256, (row * 64 + 2.5 + 59 * v) / 256)
    return model


def cross_section(n, sides, shape):
    angle = n / sides * math.tau
    cosine, sine = math.cos(angle), math.sin(angle)
    return math.copysign(abs(cosine) ** shape, cosine), math.copysign(abs(sine) ** shape, sine)


def outline(name, rows, color, mat, parent, *, sides=10, shape=.82):
    vertices = []
    for z, x, y, depth, width in rows:
        for n in range(sides):
            a, b = cross_section(n, sides, shape)
            vertices.append((x + a * depth, y + b * width, z))
    return tint(ring_mesh(name, vertices, sides, len(rows), mat, parent), color)


def panel(name, points, color, mat, parent):
    uv = tuple(((n % 2) * .74 + .13, .14 + .72 * ((n // 2) / max(1, (len(points) - 1) // 2)))
               for n in range(len(points)))
    return tint(shell(name, points, [tuple(range(len(points)))], [uv], mat, parent), color)


def jacket_stripe(mat, parent):
    """A curved windbreaker yoke with one descending shoulder."""
    count = 12
    def cut(n, top):
        a, b = cross_section(n, count, .76)
        z = .386 + .014 * b if top else .341 + .012 * b
        for low, high in zip(JACKET_ROWS, JACKET_ROWS[1:]):
            if low[0] <= z <= high[0]:
                t = (z - low[0]) / (high[0] - low[0])
                x, y, depth, width = [v1 + (v2 - v1) * t for v1, v2 in zip(low[1:], high[1:])]
                return (x + a * (depth + .004), y + b * (width + .004), z)
        raise ValueError("The yoke must stay between the jacket edges")

    vertices = [cut(n, top) for top in (False, True) for n in range(count)]
    faces = [(n, (n + 1) % count, (n + 1) % count + count, n + count) for n in range(count)]
    uv = [((n / count, .2), ((n + 1) / count, .2), ((n + 1) / count, .82), (n / count, .82)) for n in range(count)]
    return tint(shell("Swept canvas yoke", vertices, faces, uv, mat, parent), "canvas")


def head_mesh(head, mat):
    outline("Neck", [(-.052, -.028, 0, .046, .052), (.087, -.006, 0, .057, .058)], "skin", mat, head)
    outline("Jaw, cheek and brow", [
        (.078, .033, 0, .067, .053), (.119, .025, 0, .099, .078),
        (.164, .022, 0, .117, .102), (.214, .014, 0, .118, .113),
        (.267, -.008, 0, .115, .108), (.310, -.025, 0, .096, .092),
        (.331, -.033, 0, .038, .048),
    ], "skin", mat, head, sides=12, shape=.83)
    panel("Angular nose plane", [(.127, -.025, .181), (.166, 0, .165), (.133, .019, .167), (.147, .002, .211)],
          "skin", mat, head)
    panel("Closed lip", [(.128, -.028, .139), (.130, .020, .138), (.132, .009, .134), (.128, -.021, .134)],
          "skin shade", mat, head)
    outline("Close navy hair mass", [
        (.173, -.077, .004, .061, .100), (.216, -.073, .005, .080, .116),
        (.272, -.028, .006, .130, .131), (.317, -.029, .012, .125, .124),
        (.352, -.047, .015, .094, .092), (.368, -.066, .012, .039, .057),
    ], "hair", mat, head, sides=12, shape=.75)
    panel("Broad crown stroke", [(-.097, -.105, .326), (-.111, -.058, .354), (-.057, -.025, .370),
          (.040, -.022, .351), (.064, -.069, .329), (-.051, -.107, .337)], "hair light", mat, head)
    for sign in (-1, 1):
        outline("Ear", [(.155, -.003, sign * .101, .015, .016), (.182, -.006, sign * .106, .027, .023),
                          (.210, -.016, sign * .104, .021, .015)], "skin", mat, head, sides=6)
        panel("Dark lash line", [(.126, sign * .033, .221), (.127, sign * .070, .236), (.083, sign * .112, .229),
              (.098, sign * .106, .206), (.125, sign * .072, .202), (.134, sign * .033, .207)], "ink", mat, head)
        panel("Almond eye", [(.131, sign * .037, .217), (.130, sign * .067, .226), (.097, sign * .105, .222),
              (.103, sign * .101, .210), (.130, sign * .066, .206), (.136, sign * .039, .210)], "eye", mat, head)
        panel("Teal iris", [(.133, sign * .067, .223), (.121, sign * .087, .224), (.123, sign * .088, .209),
              (.135, sign * .070, .208)], "iris", mat, head)
        panel("Brow", [(.129, sign * .044, .238), (.118, sign * .100, .245), (.113, sign * .102, .252),
              (.130, sign * .047, .246)], "ink", mat, head)
        panel("Temple lock", [(.050, sign * .121, .299), (.069, sign * .121, .240), (.007, sign * .131, .199),
              (-.042, sign * .108, .210), (-.065, sign * .100, .289)], "hair", mat, head)
    panel("Asymmetric forward fringe", [(.079, .072, .329), (.124, .073, .298), (.144, .047, .244),
          (.125, .023, .265), (.143, -.024, .249), (.119, -.056, .279), (.094, -.103, .268),
          (.063, -.111, .309)], "hair", mat, head)
    panel("Fringe light plane", [(.078, .076, .330), (.122, .072, .301), (.111, .026, .289),
          (.121, -.029, .278), (.079, -.060, .308)], "hair light", mat, head)


def limbs(root, torso, mat):
    for side, sign in (("near", -1), ("far", 1)):
        arm = joint("arm_" + side, (.0, sign * .196, .401), torso)
        elbow = joint("elbow_" + side, (.012, sign * .012, -.264), arm)
        hand = joint("hand", (.017, 0, -.259), elbow)
        outline("Short windbreaker sleeve", [(-.169, .009, 0, .067, .065), (-.129, .008, 0, .072, .075),
                (-.066, -.002, 0, .083, .086), (.003, -.007, -.013 * sign, .075, .069),
                (.047, -.018, -.027 * sign, .055, .049)], "teal", mat, arm, sides=8)
        outline("Turned sleeve cuff", [(-.175, .012, 0, .064, .064), (-.137, .009, 0, .072, .073)],
                "canvas" if sign < 0 else "teal shade", mat, arm, sides=8)
        outline("Upper arm", [(-.280, .015, sign * .011, .052, .044), (-.232, .013, sign * .008, .054, .049),
                (-.162, .006, 0, .064, .059), (-.120, .004, 0, .065, .061)], "skin", mat, arm, sides=8)
        outline("Tapered forearm", [(-.230, .013, 0, .036, .032), (-.168, .012, 0, .045, .037),
                (-.082, .005, 0, .061, .043), (-.017, .007, 0, .053, .041), (.023, .009, 0, .046, .040)],
                "skin", mat, elbow, sides=8)
        outline("Hand wrap", [(-.279, .016, 0, .032, .034), (-.231, .012, 0, .043, .041),
                (-.206, .010, 0, .041, .038)], "ink", mat, elbow, sides=8)
        outline("Woven wrist edge", [(-.225, .012, 0, .042, .040), (-.205, .010, 0, .041, .037)],
                "canvas", mat, elbow, sides=8)
        outline("Fist and open knuckles", [(-.073, .020, 0, .024, .028), (-.046, .012, 0, .040, .046),
                (-.009, .009, 0, .043, .043), (.025, .0, 0, .037, .037)], "ink", mat, hand, sides=8)
        panel("Exposed knuckles", [(0.046, -.025, -.054), (.049, .028, -.048), (.043, .021, -.066), (.038, -.021, -.071)],
              "skin", mat, hand)
        leg = joint("leg_" + side, (-.013, sign * .108, 1.105), root)
        knee = joint("knee_" + side, (.025, sign * .008, -.497), leg)
        outline("Tapered thigh", [(-.520, .024, sign * .006, .066, .061), (-.439, .030, sign * .005, .078, .071),
                (-.298, .012, sign * .001, .088, .082), (-.147, -.003, 0, .104, .094),
                (.040, -.003, 0, .109, .093)], "navy", mat, leg, sides=10)
        outline("Tapered shin", [(-.488, -.025, .0, .049, .046), (-.416, -.015, .0, .050, .050),
                (-.312, -.020, .0, .058, .056), (-.175, -.014, .0, .071, .067), (-.061, .002, .0, .073, .068),
                (.044, .005, 0, .067, .064)], "navy", mat, knee, sides=10)
        panel("Washed thigh plane", [(.067, sign * .083, -.055), (.106, sign * .031, -.093),
              (.076, sign * .033, -.358), (.035, sign * .080, -.406)], "denim light", mat, leg)
        panel("Trouser side seam", [(.010, sign * .095, -.056), (.027, sign * .096, -.058),
              (.045, sign * .074, -.415), (.033, sign * .071, -.413)], "canvas", mat, leg)
        if sign < 0:
            panel("Purple service patch", [(.018, -.073, -.160), (.086, -.027, -.176), (.069, -.027, -.264),
                  (.016, -.064, -.247)], "purple", mat, knee)
        outline("Skate shoe", [(-.580, .056, 0, .151, .067), (-.554, .054, 0, .151, .071),
                (-.521, .042, 0, .135, .071), (-.479, -.012, 0, .087, .064), (-.440, -.024, 0, .060, .050)],
                "teal shade", mat, knee, shape=.61)
        outline("Pale rubber toe and sole", [(-.606, .052, 0, .147, .061), (-.593, .058, 0, .159, .070),
                (-.568, .057, 0, .162, .073)], "canvas", mat, knee, shape=.60)


def build():
    mat = diffuse()
    root = joint("courier")
    torso = joint("torso", (0, 0, 1.075), root)
    outline("High waist and trousers seat", [(-.028, -.020, 0, .079, .153), (.012, -.016, 0, .105, .173),
            (.064, -.008, 0, .115, .163), (.139, .006, 0, .107, .132)], "navy", mat, torso, sides=12)
    outline("Cropped street jacket", JACKET_ROWS, "teal", mat, torso, sides=12, shape=.76)
    outline("Navy waistband", [(.108, .008, 0, .105, .132), (.152, .007, 0, .122, .160)], "ink", mat, torso, sides=12)
    jacket_stripe(mat, torso)
    outline("Folded standing collar", [(.462, .020, 0, .084, .098), (.504, .020, .003, .076, .080),
            (.528, .006, .008, .057, .071)], "ink", mat, torso, sides=10)
    panel("Diagonal jacket closure", [(.120, -.051, .163), (.132, -.039, .167), (.154, .021, .346),
          (.122, .028, .415), (.116, .011, .415), (.140, .003, .350)], "teal shade", mat, torso)
    panel("Transit work patch", [(.128, -.111, .245), (.146, -.074, .246), (.143, -.074, .280),
           (.128, -.113, .279)], "ink", mat, torso)
    panel("Transit patch orange mark", [(.135, -.108, .253), (.150, -.078, .253), (.148, -.078, .273),
           (.133, -.110, .273)], "copper", mat, torso)
    head_mesh(joint("head", (.015, 0, .511), torso), mat)
    limbs(root, torso, mat)


def join_rigid_parts():
    """Keep the editable shell pieces in the .blend and batch each pivot in the GLB."""
    parts_by_joint = {}
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            parts_by_joint.setdefault(obj.parent, []).append(obj)
    for pivot, pieces in parts_by_joint.items():
        bpy.ops.object.select_all(action="DESELECT")
        for part in pieces:
            part.select_set(True)
        bpy.context.view_layer.objects.active = pieces[0]
        if len(pieces) > 1:
            bpy.ops.object.join()
        pieces[0].name = pivot.name + " mesh"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--blend", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.blend:
        args.blend.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend.resolve()))
    join_rigid_parts()
    bpy.ops.export_scene.gltf(filepath=str(args.output.resolve()), export_format="GLB",
                             export_cameras=False, export_lights=False, export_texcoords=True)


if __name__ == "__main__":
    main()
