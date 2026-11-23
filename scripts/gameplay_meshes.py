"""Low-resolution diffuse textures and sculpted, jointed mission actors."""

import math
import random

import bmesh
import bpy
from mathutils import Vector


def joint(name, position=(0, 0, 0), parent=None):
    node = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(node)
    node.parent = parent
    node.location = position
    return node


def paint(name, color, finish="cloth", light=0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = .76 if finish == "cloth" else .59
    if light:
        shader.inputs["Emission Color"].default_value = (*color, 1)
        shader.inputs["Emission Strength"].default_value = light
    pixels = []
    rng = random.Random(name)
    for y in range(64):
        v = y / 63
        for x in range(64):
            u = x / 63
            grain = rng.uniform(-.017, .017)
            if finish == "cloth":
                fold = .14 * math.cos(math.tau * (3 * u + .34 * v))
                shade = .89 + .16 * v + math.sin(math.pi * v) * fold
            elif finish == "hair":
                strand = math.sin(math.tau * (5 * u - .6 * v))
                shade = .65 + .3 * v + .15 * max(strand, 0)
            else:
                shade = .68 + .37 * v + .16 * math.sin(math.pi * v)
                if finish == "shell":
                    shade -= .13 * max(0, math.cos(math.tau * (2 * u + v))) ** 7
                if y in (2, 3, 57) and finish == "shell":
                    shade += .15
            pixels.extend([max(0, min(1, channel * (shade + grain))) for channel in color] + [1.])
    image = bpy.data.images.new(name + " diffuse", width=64, height=64, alpha=False)
    image.pixels.foreach_set(pixels)
    image.pack()
    map_node = nodes.new("ShaderNodeTexImage")
    map_node.image = image
    map_node.interpolation = "Linear"
    material.node_tree.links.new(map_node.outputs["Color"], shader.inputs["Base Color"])
    return material


def shell(name, vertices, faces, uv, material, parent):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    layer = data.uv_layers.new(name="Diffuse")
    for polygon, points in zip(data.polygons, uv):
        polygon.use_smooth = True
        for index, point in zip(polygon.loop_indices, points):
            layer.data[index].uv = point
    editable = bmesh.new()
    editable.from_mesh(data)
    bmesh.ops.recalc_face_normals(editable, faces=list(editable.faces))
    editable.to_mesh(data)
    editable.free()
    data.materials.append(material)
    model = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(model)
    model.parent = parent
    return model


def sectioned(name, sections, material, parent, *, sides=10, shape=.78, axis="up"):
    """Each ring specifies distance, cross-section center and two radii."""
    vertices = []
    for along, a, b, radius_a, radius_b in sections:
        for n in range(sides):
            angle = n / sides * math.tau
            c, s = math.cos(angle), math.sin(angle)
            across_a = a + radius_a * math.copysign(abs(c) ** shape, c)
            across_b = b + radius_b * math.copysign(abs(s) ** shape, s)
            vertices.append((along, across_b, across_a) if axis == "forward" else (across_a, across_b, along))
    return ring_mesh(name, vertices, sides, len(sections), material, parent)


def ring_mesh(name, vertices, sides, rings, material, parent):
    faces, uv = [], []
    for row in range(rings - 1):
        for n in range(sides):
            a, b = row * sides + n, row * sides + (n + 1) % sides
            faces.append((a, b, b + sides, a + sides))
            lo, hi = row / (rings - 1), (row + 1) / (rings - 1)
            u, end_u = n / sides, (n + 1) / sides
            uv.append(((u, lo), (end_u, lo), (end_u, hi), (u, hi)))
    for row in (0, rings - 1):
        faces.append(tuple(row * sides + n for n in range(sides)))
        uv.append(tuple((.5 + .45 * math.cos(n / sides * math.tau),
                         .5 + .45 * math.sin(n / sides * math.tau)) for n in range(sides)))
    return shell(name, vertices, faces, uv, material, parent)


def bend(name, points, material, parent, sides=7):
    vertices = []
    coordinates = [Vector(row[:3]) for row in points]
    for index, (center, row) in enumerate(zip(coordinates, points)):
        before, after = coordinates[max(0, index - 1)], coordinates[min(index + 1, len(points) - 1)]
        direction = (after - before).normalized()
        across = Vector((0, 1, 0)).cross(direction)
        if across.length_squared < .00001:
            across = Vector((1, 0, 0)).cross(direction)
        across.normalize()
        other = direction.cross(across)
        for n in range(sides):
            theta = n / sides * math.tau
            point = center + across * (math.cos(theta) * row[3]) + other * (math.sin(theta) * row[4])
            vertices.append(tuple(point))
    return ring_mesh(name, vertices, sides, len(points), material, parent)


def patch(name, points, material, parent):
    """Flat shapes such as fabric tabs sit slightly above the garment surface."""
    uv = tuple((.12 + .76 * (n % 2), .15 + .7 * (n // 2) / max(1, (len(points) - 1) // 2))
               for n in range(len(points)))
    model = shell(name, points, [tuple(range(len(points)))], [uv], material, parent)
    return model


def build_courier():
    oat = paint("Twill jacket", (.65, .50, .28))
    ink = paint("Blue-grey cargo", (.085, .151, .188))
    blue = paint("Washed slate webbing", (.18, .29, .32))
    amber = paint("Signal orange binding", (.63, .157, .053))
    bone = paint("Canvas and sole", (.73, .67, .50))
    boot = paint("Black-blue trainer", (.068, .106, .125), "rubber")
    skin = paint("Face diffuse", (.66, .385, .226), "skin")
    shade = paint("Ear and lip paint", (.32, .157, .12), "skin")
    hair = paint("Blue-black asymmetrical crop", (.049, .06, .075), "hair")
    root = joint("courier")
    torso = joint("torso", (0, 0, .99), root)
    sectioned("Canvas jacket with waist and shoulders", [
        (.017, 0, 0, .113, .157), (.062, .013, 0, .158, .203),
        (.155, .019, 0, .174, .204), (.286, .016, 0, .167, .229),
        (.376, -.003, 0, .151, .248), (.435, -.018, 0, .114, .189),
        (.475, .013, 0, .095, .098),
    ], oat, torso, sides=14)
    sectioned("Ribbed waistband", [(.018, .009, 0, .139, .192), (.071, .01, 0, .161, .207)], blue, torso, sides=14)
    sectioned("Raised folded collar", [(.423, .027, 0, .105, .109), (.478, .049, 0, .094, .104),
                                      (.52, .036, 0, .084, .087)], blue, torso, sides=12)
    bend("Offset zipper binding", [(.149, -.048, .078, .008, .015), (.189, -.049, .17, .014, .011),
                                  (.19, -.055, .317, .013, .01), (.115, -.059, .454, .01, .008)], amber, torso, 5)
    bend("Messenger harness", [(.128, .13, .448, .033, .012), (.192, .076, .352, .031, .014),
                              (.184, -.087, .165, .027, .013), (.136, -.186, .085, .023, .013)], blue, torso, 5)
    sectioned("Canvas ticket pouch", [(.065, -.055, -.196, .101, .04), (.12, -.06, -.205, .105, .055),
                                     (.189, -.068, -.2, .095, .051), (.205, -.071, -.194, .073, .034)], amber, torso)

    head = joint("head", (.055, 0, .47), torso)
    sectioned("Neck and contoured face", [(-.023, -.014, 0, .059, .064), (.066, -.002, 0, .058, .06),
        (.113, .052, 0, .085, .071), (.15, .041, 0, .108, .091), (.198, .032, 0, .116, .103),
        (.247, .029, 0, .113, .099), (.287, .009, 0, .101, .095), (.33, -.008, 0, .068, .07),
    ], skin, head, sides=14, shape=.85)
    sectioned("Nose bridge", [(.17, .134, 0, .013, .018), (.189, .149, 0, .023, .023),
                              (.223, .139, 0, .013, .016)], skin, head, sides=7)
    sectioned("Swept fitted hair cap", [(.214, -.059, 0, .066, .102), (.25, -.033, 0, .114, .11),
        (.298, -.019, 0, .139, .117), (.35, -.031, -.007, .115, .092),
        (.389, -.061, -.018, .061, .057), (.394, -.095, -.024, .022, .032),
    ], hair, head, sides=14, shape=.91)
    for a, b, c in [(-.078, .115, .22), (-.031, .151, .236), (.031, .128, .25)]:
        bend("Cut fringe", [(.039, a, .336, .037, .038), (b - .016, a - .015, .287, .039, .02),
                            (b, a - .03, c, .006, .005)], hair, head, 7)
    for suffix, sign in (("near", -1), ("far", 1)):
        sectioned("Ear", [(.154, .014, sign * .085, .024, .014), (.188, .009, sign * .096, .033, .026),
                          (.222, .005, sign * .094, .019, .014)], shade, head, sides=7)
        bend("Upper eye line", [(.097, sign * .084, .225, .003, .003), (.132, sign * .067, .221, .006, .005),
                               (.142, sign * .045, .22, .003, .002)], hair, head, 5)
        bend("Mouth line", [(.128, sign * .05, .153, .0025, .003), (.147, sign * .018, .151, .003, .003)], shade, head, 5)

        arm = joint("arm_" + suffix, (.023, sign * .231, .38), torso)
        elbow = joint("elbow_" + suffix, (.019, 0, -.277), arm)
        hand = joint("hand", (.018, 0, -.266), elbow)
        sectioned("Tailored upper sleeve", [(-.293, .018, 0, .067, .063), (-.252, .025, 0, .081, .069),
            (-.195, .017, .007 * sign, .073, .077), (-.12, .005, 0, .089, .098),
            (-.047, -.013, 0, .098, .099), (.026, -.024, -.015 * sign, .069, .068),
        ], oat, arm)
        sectioned("Upper arm contrast panel", [(-.162, .015, 0, .083, .09), (-.12, .008, 0, .092, .1)], amber, arm)
        sectioned("Forearm canvas", [(-.221, .015, 0, .058, .056), (-.187, .009, 0, .065, .061),
            (-.142, .013, 0, .059, .066), (-.091, .01, 0, .076, .072), (.016, 0, 0, .078, .073),
        ], oat, elbow)
        sectioned("Knit wrist cuff", [(-.23, .014, 0, .055, .056), (-.196, .014, 0, .067, .065)], blue, elbow)
        sectioned("Glove palm and fingers", [(-.071, .026, 0, .022, .028), (-.055, .016, 0, .034, .046),
            (-.01, 0, 0, .041, .046), (.027, -.003, 0, .033, .038), (.05, -.004, 0, .024, .028),
        ], boot, hand)
        bend("Exposed thumb", [(.018, -.02 * sign, .024, .024, .023), (.048, -.032 * sign, -.009, .018, .022),
                               (.035, -.041 * sign, -.034, .01, .01)], skin, hand, 6)

        leg = joint("leg_" + suffix, (-.021, sign * .131, 1.02), root)
        knee = joint("knee_" + suffix, (.023, 0, -.419), leg)
        sectioned("Pleated cargo upper", [(-.448, .029, 0, .103, .095), (-.382, .027, 0, .106, .106),
            (-.3, .014, .016 * sign, .09, .103), (-.185, .009, .008 * sign, .119, .117),
            (-.083, .006, 0, .13, .121), (.025, -.01, 0, .132, .117),
        ], ink, leg, sides=12)
        sectioned("Stitched cargo patch pocket", [(-.305, -.005, sign * .104, .067, .033),
            (-.263, -.025, sign * .104, .092, .048), (-.152, -.019, sign * .111, .099, .049),
            (-.124, -.018, sign * .112, .096, .041),
        ], blue, leg)
        patch("Folded pocket closure", [(-.118, sign * .141, -.137), (.079, sign * .141, -.137),
                                        (.066, sign * .161, -.167), (-.095, sign * .16, -.177)], ink, leg)
        sectioned("Tapered creased cargo leg", [(-.427, -.022, 0, .067, .069), (-.384, -.018, 0, .084, .082),
            (-.29, -.024, 0, .074, .08), (-.193, -.019, 0, .083, .084), (-.071, .014, 0, .095, .093),
            (.032, .004, 0, .104, .097),
        ], ink, knee, sides=12)
        sectioned("Trainer heel and toe", [(-.511, .055, 0, .162, .085), (-.465, .045, 0, .172, .089),
            (-.424, .011, 0, .119, .083), (-.382, -.019, 0, .083, .068),
        ], boot, knee, sides=12, shape=.55)
        sectioned("Framed off-white sole", [(-.556, .05, 0, .158, .084), (-.515, .056, 0, .18, .096),
            (-.493, .052, 0, .176, .09),
        ], bone, knee, sides=12, shape=.52)
        bend("Trainer quarter stripe", [(-.09, sign * .073, -.461, .012, .006),
            (.007, sign * .094, -.464, .016, .009), (.049, sign * .087, -.435, .009, .008)], amber, knee, 5)


def signal_crawler(body):
    chitin = paint("Crawler olive ceramic", (.33, .39, .205), "shell")
    pale = paint("Crawler lime dorsal laminate", (.55, .58, .291), "shell")
    joint_paint = paint("Crawler flex underbody", (.144, .118, .099), "shell")
    lens = paint("Crawler amber aperture", (.8, .38, .086), "lens", .53)
    sectioned("Long segmented sensor abdomen", [(-.59, .02, 0, .028, .056), (-.46, .02, 0, .15, .17),
        (-.23, .032, 0, .225, .235), (.025, .021, 0, .187, .215), (.22, -.014, 0, .128, .155),
        (.39, -.021, 0, .072, .11), (.491, -.016, 0, .043, .077),
    ], joint_paint, body, axis="forward", sides=12)
    sectioned("Beaked ceramic abdomen", [(-.62, .058, 0, .021, .063), (-.48, .103, 0, .108, .177),
        (-.24, .143, 0, .172, .252), (-.02, .113, 0, .168, .238), (.165, .065, 0, .095, .176),
        (.21, .012, 0, .054, .128),
    ], chitin, body, axis="forward", sides=12)
    sectioned("Forward optical mask", [(.117, -.035, 0, .104, .145), (.239, -.04, 0, .118, .151),
        (.368, -.053, 0, .079, .125), (.478, -.052, 0, .046, .073),
    ], pale, body, axis="forward", sides=10)
    for suffix, sign in (("near", -1), ("far", 1)):
        plate = joint("plate_" + suffix, (-.17, sign * .15, .09), body)
        bend("Shell edge rib", [(-.36, sign * .018, -.009, .018, .018), (-.22, sign * .092, .037, .04, .037),
            (.017, sign * .125, .05, .053, .047), (.185, sign * .09, -.006, .024, .028)], pale, plate)
        bend("Optical slit", [(.332, sign * .107, -.025, .017, .025), (.385, sign * .101, -.068, .028, .016),
                              (.443, sign * .078, -.076, .014, .013)], lens, body, 6)
        leg = joint("leg_" + suffix, (-.03, sign * .16, -.063), body)
        for offset, toe in ((-.21, -.45), (.019, .04), (.15, .34)):
            bend("Splayed sensor leg", [(offset, 0, 0, .049, .038), (offset - .105, sign * .16, -.049, .042, .035),
                (toe - .065, sign * .244, -.195, .029, .025), (toe, sign * .244, -.29, .016, .024),
                (toe + .093, sign * .243, -.286, .012, .012)], chitin, leg, 7)
        claw = joint("claw_" + suffix, (.358, sign * .095, -.09), body)
        bend("Split sampler mandible", [(0, 0, 0, .044, .027), (.14, sign * .048, -.022, .031, .028),
            (.246, sign * .017, -.029, .018, .021), (.27, -sign * .05, .005, .006, .007)], pale, claw)


def gateback(body):
    carapace = paint("Gateback rust-red shield", (.39, .12, .092), "shell")
    rim = paint("Gateback worn ivory edging", (.67, .55, .354), "shell")
    frame = paint("Gateback hydraulic braid", (.115, .115, .139), "shell")
    lens = paint("Gateback red visor", (.83, .213, .121), "lens", .48)
    sectioned("Compact upright cable trunk", [(-.25, -.04, 0, .14, .164), (-.16, -.065, 0, .234, .249),
        (.065, -.088, 0, .265, .282), (.31, -.09, 0, .24, .298), (.519, -.052, 0, .175, .207),
        (.63, -.011, 0, .106, .129),
    ], frame, body, sides=12)
    sectioned("Narrow face casing", [(.052, .234, 0, .097, .089), (.154, .237, 0, .143, .146),
        (.282, .252, 0, .126, .133), (.356, .227, 0, .095, .099),
    ], carapace, body)
    bend("Thin red sensor band", [(.316, -.122, .235, .02, .021), (.376, -.061, .216, .023, .023),
        (.388, .063, .22, .025, .022), (.314, .124, .24, .017, .018)], lens, body)
    for suffix, sign in (("near", -1), ("far", 1)):
        plate = joint("plate_" + suffix, (.065, sign * .22, .21), body)
        sectioned("Folding curb shield", [(-.28, .22, sign * .02, .048, .05), (-.159, .21, sign * .055, .108, .114),
            (.053, .116, sign * .084, .168, .155), (.279, .031, sign * .059, .205, .147),
            (.419, -.05, sign * .015, .147, .096), (.48, -.084, 0, .078, .028),
        ], carapace, plate, shape=.58)
        bend("Shield rim piping", [(.239, sign * .05, -.26, .021, .024), (.301, sign * .095, -.127, .029, .028),
            (.267, sign * .12, .094, .03, .027), (.157, sign * .138, .301, .028, .026),
            (.042, sign * .057, .445, .017, .017)], rim, plate)
        claw = joint("claw_" + suffix, (.052, sign * .205, .095), body)
        bend("Arm linkage under shield", [(0, 0, 0, .098, .076), (.128, sign * .091, -.176, .118, .089),
            (.318, sign * .079, -.247, .111, .09), (.45, sign * .022, -.225, .066, .054)], frame, claw)
        leg = joint("leg_" + suffix, (-.064, sign * .177, -.11), body)
        bend("Offset load-bearing knee", [(0, 0, 0, .118, .118), (.116, sign * .039, -.093, .112, .089),
            (.042, sign * .062, -.194, .088, .079), (.12, sign * .069, -.232, .066, .09),
            (.262, sign * .064, -.252, .036, .079)], frame, leg)


def switchkeeper(body):
    casing = paint("Switchkeeper porcelain shell", (.62, .61, .45), "shell")
    spine = paint("Switchkeeper slate treads", (.155, .225, .247), "shell")
    braid = paint("Switchkeeper exposed violet fibre", (.238, .094, .145), "shell")
    visor = paint("Switchkeeper oxide red glass", (.72, .12, .056), "lens", .61)
    bronze = paint("Switchkeeper old brass", (.43, .291, .132), "shell")
    sectioned("Raked torso and cutaway spine", [(-.26, -.102, 0, .092, .116), (-.15, -.13, 0, .135, .176),
        (.078, -.124, 0, .134, .175), (.314, -.139, 0, .174, .257), (.444, -.129, 0, .16, .24),
        (.55, -.082, 0, .119, .133),
    ], braid, body, sides=12)
    sectioned("Transit mask with stepped chin", [(.095, .072, 0, .084, .066), (.204, .113, 0, .119, .109),
        (.28, .137, 0, .141, .14), (.392, .131, 0, .124, .135), (.458, .067, 0, .107, .105),
        (.496, -.011, 0, .074, .065),
    ], casing, body, sides=12, shape=.64)
    for z, width in ((.325, .095), (.282, .073), (.24, .034)):
        bend("Mechanical red aperture", [(.237, -width, z, .013, .019), (.275, 0, z - .01, .018, .018),
            (.24, width, z, .011, .014)], visor, body, 7)
    bend("Broken aerial", [(-.103, -.084, .425, .043, .032), (-.173, -.102, .559, .027, .024),
        (-.144, -.088, .68, .012, .01), (-.091, -.056, .745, .005, .006)], bronze, body)
    for suffix, sign in (("near", -1), ("far", 1)):
        plate = joint("plate_" + suffix, (-.108, sign * .23, .347), body)
        crest = .33 if suffix == "near" else .42
        sectioned("Split porcelain shoulder plate", [(-.181, .023, sign * .026, .078, .061),
            (-.063, -.014, sign * .074, .144, .122), (.114, -.063, sign * .121, .19, .131),
            (.235, -.123, sign * .146, .121, .095), (crest, -.13, sign * .212, .032, .026),
        ], casing, plate, shape=.6, sides=11)
        bend("Inset shoulder notch", [(.096, sign * .183, -.023, .021, .017), (.1, sign * .209, .067, .034, .021),
                                      (.022, sign * .233, .166, .029, .019)], bronze, plate, 6)
        claw = joint("claw_" + suffix, (-.1, sign * .245, .292), body)
        bend("Forward offset switch arm", [(0, 0, 0, .089, .082), (.09, sign * .106, -.161, .07, .079),
            (.222, sign * .132, -.338, .078, .089), (.389, sign * .121, -.433, .092, .079),
            (.462, sign * .095, -.456, .07, .06)], spine, claw)
        for offset in (-.044, .044):
            bend("Forged curved pincer", [(.413, sign * .092 + offset, -.433, .057, .038),
                (.577, sign * .09 + offset * 1.42, -.471, .061, .033), (.692, sign * .065 + offset, -.407, .039, .026),
                (.748, sign * .053 + offset * .85, -.318, .006, .011)], casing, claw, 7)
        bend("Hydraulic return cable", [(-.072, sign * .128, .15, .027, .031), (-.322, sign * .25, .029, .031, .031),
            (-.251, sign * .302, -.117, .028, .028), (-.058, sign * .148, -.187, .023, .023)], bronze, body, 6)
        leg = joint("leg_" + suffix, (-.135, sign * .135, -.118), body)
        bend("Open hock and planted talon", [(0, 0, 0, .082, .102), (.1, sign * .042, -.079, .074, .072),
            (-.068, sign * .078, -.173, .045, .055), (-.034, sign * .118, -.245, .053, .078),
            (.163, sign * .115, -.241, .029, .079), (.252, sign * .114, -.24, .017, .04)], spine, leg)


def cable_runner(body):
    slate = paint("Runner petrol ceramic", (.24, .38, .43), "shell")
    insulator = paint("Runner yellowed insulator", (.69, .54, .25), "shell")
    flesh = paint("Runner braided flex tissue", (.15, .105, .13), "shell")
    frame = paint("Runner worn graphite", (.12, .158, .18), "shell")
    aperture = paint("Runner red charge aperture", (.79, .195, .11), "lens", .49)

    sectioned("Raked ceramic carapace", [(-.78, .186, 0, .035, .053), (-.62, .224, 0, .122, .133),
        (-.4, .246, 0, .226, .196), (-.158, .197, 0, .203, .233), (.064, .111, 0, .144, .169),
        (.198, .065, 0, .084, .099)], slate, body, axis="forward", sides=12)
    sectioned("Underslung braided thorax", [(-.64, .113, 0, .047, .068), (-.478, .057, 0, .143, .155),
        (-.224, .046, 0, .191, .214), (.008, .012, 0, .139, .143), (.205, .008, 0, .104, .104),
        (.335, -.007, 0, .069, .075)], flesh, body, axis="forward", sides=10)
    sectioned("Wedge over charge aperture", [(.148, .081, 0, .063, .1), (.238, .048, 0, .126, .142),
        (.371, .057, 0, .121, .147), (.49, .036, 0, .076, .117), (.57, .028, 0, .04, .061)],
        frame, body, axis="forward", sides=10, shape=.62)
    bend("Recessed wraparound charge slit", [(.345, -.145, .041, .011, .024), (.474, -.122, .021, .014, .024),
        (.566, -.059, .014, .019, .021), (.58, 0, .015, .017, .021), (.566, .059, .014, .018, .021),
        (.474, .122, .021, .014, .024), (.345, .145, .041, .01, .024)], aperture, body, 6)

    for suffix, sign in (("near", -1), ("far", 1)):
        # The axes of these pivots stay aligned with the organism for the glTF poses.
        mantle = joint("plate_" + suffix, (-.047, sign * .158, .179), body)
        sectioned("Tapered shoulder shutter", [(-.536, .097, sign * .026, .028, .028),
            (-.394, .16, sign * .067, .097, .079), (-.194, .145, sign * .124, .094, .106),
            (.012, .085, sign * .126, .091, .102), (.185, .002, sign * .084, .062, .075),
            (.284, -.055, sign * .047, .014, .026)], insulator, mantle, axis="forward", sides=8)
        bend("Inset ceramic trim", [(-.415, sign * .117, .128, .018, .023),
            (-.209, sign * .206, .092, .026, .028), (-.004, sign * .21, .042, .027, .028),
            (.143, sign * .154, -.018, .016, .023)], slate, mantle, 7)
        bend("Exposed return cable", [(-.554, sign * .11, .051, .028, .028),
            (-.681, sign * .199, .187, .04, .038), (-.647, sign * .203, .377, .035, .035),
            (-.486, sign * .159, .518, .028, .03), (-.309, sign * .127, .454, .026, .023)], flesh, body, 7)

        claw = joint("claw_" + suffix, (.428, sign * .103, .042), body)
        bend("Jaw tendon collar", [(-.06, 0, 0, .057, .048), (.074, sign * .045, -.019, .074, .053),
            (.188, sign * .105, -.039, .05, .042)], flesh, claw, 7)
        lift = .055 if sign < 0 else -.017
        bend("Split cable hook", [(.048, sign * .057, -.008, .075, .053),
            (.208, sign * .13, -.046, .068, .064), (.394, sign * .15, -.042 + lift, .045, .07),
            (.565, sign * .098, -.008 + lift, .036, .05), (.646, sign * .019, .06 + lift, .013, .018),
            (.636, -sign * .025, .102 + lift, .006, .007)], insulator, claw, 8)

        leg = joint("leg_" + suffix, (-.245, sign * .152, -.112), body)
        bend("Raised spring thigh", [(0, 0, 0, .11, .091), (.111, sign * .073, -.065, .114, .078),
            (.218, sign * .125, -.169, .087, .061), (.248, sign * .138, -.244, .057, .055)], slate, leg, 8)
        bend("Open carbon hock", [(.228, sign * .138, -.217, .058, .064),
            (.164, sign * .164, -.309, .055, .05), (-.059, sign * .182, -.423, .044, .043),
            (-.228, sign * .178, -.526, .049, .046), (-.177, sign * .213, -.64, .04, .037),
            (-.093, sign * .218, -.763, .041, .046)], frame, leg, 8)
        bend("Planted spring foot", [(-.108, sign * .218, -.737, .045, .048),
            (-.057, sign * .222, -.783, .064, .049), (.064, sign * .217, -.8, .049, .029),
            (.185, sign * .184, -.798, .01, .016)], insulator, leg, 8)
        bend("Rear heel spur", [(-.145, sign * .229, -.689, .035, .03),
            (-.225, sign * .23, -.708, .03, .021), (-.282, sign * .214, -.754, .006, .008)], slate, leg, 6)


ENEMY_MESHES = {"skitter": signal_crawler, "guard": gateback, "keeper": switchkeeper, "runner": cable_runner}


def build_enemy(family, size):
    model = joint("creature")
    model.scale = (size,) * 3
    center = (-.04, 0, .94) if family == "runner" else (.015, 0, .37)
    body = joint("organism", center, model)
    ENEMY_MESHES[family](body)
