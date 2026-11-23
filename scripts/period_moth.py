"""Build the benchmark Kite Moth and its matching coil staff."""

import argparse
import math
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gameplay_meshes import bend, joint, paint, sectioned, shell


def materials():
    return {
        "chitin": paint("Ivory chitin", (.62, .56, .35), "shell"),
        "ridge": paint("Pale dorsal chitin", (.72, .66, .44), "shell"),
        "underwing": paint("Sage underside", (.27, .34, .205), "shell"),
        "tissue": paint("Plum flexor tissue", (.20, .111, .22), "skin"),
        "ring": paint("Violet cartilage", (.275, .179, .31), "shell"),
        "socket": paint("Dark orbital membrane", (.055, .048, .102), "skin"),
        "iris": eye_diffuse(),
    }


def eye_diffuse():
    """Paint the pupil on the lens to keep it seated through every viewing angle."""
    size = 64
    image = bpy.data.images.new("Neri lens diffuse", width=size, height=size, alpha=False)
    pixels = []
    for j in range(size):
        for i in range(size):
            x, y = (2 * i + 1) / size - 1, (2 * j + 1) / size - 1
            pupil = math.hypot((x + .20 * y) / .36, (y + .06) / .70)
            rim = math.hypot(x * .89, y)
            fleck = math.hypot((x + .44) / .16, (y - .40) / .16)
            if fleck < 1:
                color = (.71, .88, .70)
            elif pupil < 1:
                color = (.026, .082, .112)
            elif rim > .87:
                color = (.077, .29, .245)
            else:
                shade = .79 + .16 * y + max(0, 1 - pupil) * .13
                color = tuple(c * shade for c in (.28, .71, .52))
            pixels.extend([*color, 1.0])
    image.pixels.foreach_set(pixels)
    image.pack()
    mat = bpy.data.materials.new("Living sea-glass eye")
    mat.use_nodes = True
    tree = mat.node_tree
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    shader = tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = .68
    shader.inputs["Emission Strength"].default_value = .28
    tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    tree.links.new(texture.outputs["Color"], shader.inputs["Emission Color"])
    return mat


def plate(name, perimeter, crest, mat, parent):
    """Beveled shell with a single raised ridge and an organic underside."""
    count = len(perimeter)
    center = tuple(sum(point[axis] for point in perimeter) / count for axis in range(3))
    inset = [(center[0] + .72 * (x - center[0]), center[1] + .72 * (y - center[1]), z + .042)
             for x, y, z in perimeter]
    vertices = perimeter + inset + [crest, (center[0], center[1], center[2] - .046)]
    faces, uvs = [], []
    for n in range(count):
        after = (n + 1) % count
        u1, u2 = n / count, (n + 1) / count
        faces.extend([(n, after, after + count, n + count),
                      (n + count, after + count, 2 * count), (after, n, 2 * count + 1)])
        uvs.extend([((u1, .21), (u2, .21), (u2, .69), (u1, .69)),
                    ((u1, .69), (u2, .69), (.5, .95)), ((u2, .19), (u1, .19), (.5, .04))])
    return shell(name, vertices, faces, uvs, mat, parent)


def sensing_face(parent, mts, x, z, length=1):
    eye = joint("pulse_core", (x, 0, z), parent)
    sectioned("Rear cartilage around the eye", [
        (-.155 * length, 0, 0, .100, .166), (-.105 * length, 0, 0, .103, .173),
        (-.075 * length, 0, 0, .084, .155),
    ], mts["socket"], eye, sides=10, axis="forward")
    lens = sectioned("Faceted sea-glass lens", [
        (-.073 * length, 0, 0, .084, .155), (.006 * length, 0, 0, .103, .183),
        (.103 * length, 0, 0, .095, .150), (.166 * length, 0, 0, .065, .089),
        (.191 * length, 0, 0, .033, .043),
    ], mts["iris"], eye, sides=12, shape=.89, axis="forward")
    uvs = lens.data.uv_layers.active.data
    for loop in lens.data.loops:
        _, across, height = lens.data.vertices[loop.vertex_index].co
        uvs[loop.index].uv = (.5 + across / .396, .5 + height / .234)


def moth(mts):
    creature = joint("creature")
    thorax = joint("organism", (.015, 0, .34), creature)
    sectioned("Tapered segmented thorax", [
        (-.53, .087, 0, .043, .067), (-.36, .099, 0, .100, .145),
        (-.175, .101, 0, .154, .198), (.012, .105, 0, .166, .213),
        (.201, .116, 0, .132, .183), (.305, .118, 0, .078, .128),
    ], mts["tissue"], thorax, sides=10, axis="forward")
    for x, z, y in [(-.294, .081, .142), (-.168, .097, .183), (-.049, .104, .207)]:
        sectioned("Overlapping flexor rib", [
            (x - .037, z, 0, y * .68, y),
            (x + .024, z + .011, 0, y * .78, y * 1.03),
        ], mts["ring"], thorax, sides=8, shape=.80, axis="forward")
    sensing_face(thorax, mts, .279, .133)
    plate("Overhanging brow", [(.12, -.16, .213), (.23, -.187, .212), (.407, -.113, .214),
          (.464, .0, .188), (.401, .115, .216), (.23, .182, .214), (.113, .121, .233)],
          (.245, .007, .322), mts["ridge"], thorax)
    for side, sign in (("near", -1), ("far", 1)):
        wing = joint("plate_" + side, (-.071, sign * .134, .213), thorax)
        points = [(x, sign * y, z) for x, y, z in [
            (.17, .016, .008), (.077, .220, -.009), (-.15, .454, -.007),
            (-.584, .405, .081), (-.428, .236, .049), (-.112, .059, -.007)]]
        plate("Carved dorsal wing " + side, points, (-.145, sign * .222, .132), mts["chitin"], wing)
        plate("Thin trailing membrane " + side, [(x, sign * y, z) for x, y, z in [
            (.027, .04, -.054), (-.102, .277, -.084), (-.482, .340, -.111),
            (-.564, .184, -.081), (-.193, .077, -.044)]],
            (-.216, sign * .172, -.035), mts["underwing"], wing)
        bend("Folded feeler", [(.169, sign * .116, .242, .029, .024), (.249, sign * .205, .340, .021, .016),
                                (.414, sign * .246, .360, .009, .009)], mts["underwing"], thorax, 6)
        bend("Folded tarsus", [(.034, sign * .122, -.012, .051, .035), (.104, sign * .211, -.167, .036, .028),
                                (.238, sign * .219, -.180, .027, .018), (.257, sign * .203, -.150, .012, .011)],
             mts["tissue"], thorax, 6)


def staff(mts):
    root = joint("armed_organism")
    bend("Tendon shaft and hand grip", [(-.435, 0, 0, .036, .035), (-.31, 0, 0, .052, .047),
             (.23, 0, 0, .048, .048), (.58, 0, .015, .057, .051), (1.20, 0, .018, .067, .057)],
         mts["tissue"], root, 8)
    sectioned("Rounded heel cap", [(-.493, .0, 0, .021, .029), (-.446, .0, 0, .046, .048),
            (-.341, .0, 0, .049, .050)], mts["chitin"], root, sides=8, axis="forward")
    for x in (-.308, -.227, -.145):
        sectioned("Laced grip rib", [(x - .018, 0, 0, .048, .051), (x + .018, 0, 0, .048, .051)],
                  mts["ring"], root, sides=8, axis="forward")
    plate("Back-mounted hinge", [(.22, -.032, .006), (.26, .043, .011), (.83, .056, .011), (1.13, .057, .018),
           (1.11, -.066, .034), (.57, -.068, .031)], (.62, .0, .089), mts["underwing"], root)
    sensing_face(root, mts, 1.257, .025, 1.22)
    for sign in (-1, 1):
        plate("Folded moth wing", [(x, sign * y, z) for x, y, z in [
            (.904, .025, .011), (.988, .145, -.026), (1.26, .273, -.025),
            (1.642, .155, .026), (1.435, .092, .015), (1.135, .053, .019)]],
              (1.239, sign * .173, .065), mts["chitin"], root)
        bend("Same dorsal seam", [(.96, sign * .08, .051, .018, .012),
                    (1.24, sign * .188, .064, .015, .009), (1.56, sign * .151, .046, .007, .007)],
             mts["underwing"], root, sides=6)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, build in (("moth", moth), ("moth-weapon", staff)):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        build(materials())
        bpy.ops.wm.save_as_mainfile(filepath=str((args.output_dir / (name + ".blend")).resolve()))
        bpy.ops.export_scene.gltf(filepath=str((args.output_dir / (name + ".glb")).resolve()),
                                 export_format="GLB", export_cameras=False, export_lights=False)


if __name__ == "__main__":
    main()
