import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Scene } from "@babylonjs/core";
import { HEARING_COMPLETE, HEARING_ROLL, HEARING_WITNESSES, type Marker } from "../../shared/src/scene.ts";
import type { WorldView } from "./view.ts";

interface WitnessStand {
  title: string;
  bit: number;
  screen: DynamicTexture;
  lamp: StandardMaterial;
  last?: string;
}

export class HearingScenery {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly previousSky;
  private readonly materials: StandardMaterial[] = [];
  private readonly stands: WitnessStand[] = [];
  private readonly board: DynamicTexture;
  private readonly rollPanel: DynamicTexture;
  private readonly rollLamp: StandardMaterial;
  private readonly rollHinge: TransformNode;
  private lastBoard = "";
  private lastRoll = "";
  private lastTime?: number;

  constructor(scene: Scene, root: TransformNode) {
    this.scene = scene;
    this.root = root;
    this.previousSky = scene.clearColor.clone();
    scene.clearColor.set(.62, .69, .70, 1);
    const limestone = this.material("South Wall civic limestone", "#b7ac93");
    const iron = this.material("Terrace painted iron", "#657676");
    const clay = this.material("Glazed municipal terracotta", "#9c6957");
    const ash = this.material("Stained ash lectern", "#837c66");
    const paper = this.material("Public records folio paper", "#d6c69c");
    this.terrace(limestone, iron, clay);
    for (const marker of HEARING_WITNESSES) this.stands.push(this.witness(marker, limestone, iron, clay, ash, paper));
    const roll = this.paint("Public Roll nameplate texture", 128, 64, true);
    this.rollPanel = roll.texture;
    this.rollLamp = this.material("Public Roll aperture", "#a48662");
    this.rollHinge = this.makeRoll(HEARING_ROLL, limestone, iron, clay, ash, paper, roll.material);
    const board = this.paint("South Wall Hearing agenda", 512, 96, true);
    this.board = board.texture;
    this.box("Civic agenda frame", 11.45, 1.17, .147, -2.45, 3.83, 5.32, iron);
    this.face("Civic agenda lettering", 11.24, 1.003, -2.45, 3.83, 5.231, board.material);
    for (const x of [-7.42, 2.52]) this.box("Civic agenda support", .118, 3.89, .15, x, 1.944, 5.41, iron);
  }

  private material(name: string, tint: string) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(tint);
    material.specularColor.set(.105, .10, .085);
    this.materials.push(material);
    return material;
  }

  private paint(name: string, width: number, height: number, lit = false) {
    const material = this.material(name, "#ffffff");
    const texture = new DynamicTexture(name, { width, height }, this.scene, true);
    if (lit) {
      material.disableLighting = true;
      material.emissiveTexture = texture;
    } else material.diffuseTexture = texture;
    return { material, texture, ctx: texture.getContext() };
  }

  private box(name: string, width: number, height: number, depth: number, x: number, y: number, z: number,
    material: StandardMaterial, parent = this.root) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    mesh.parent = parent; mesh.position.set(x, y, z); mesh.material = material;
    return mesh;
  }

  private face(name: string, width: number, height: number, x: number, y: number, z: number, material: StandardMaterial) {
    const mesh = MeshBuilder.CreatePlane(name, { width, height }, this.scene);
    mesh.parent = this.root; mesh.position.set(x, y, z); mesh.material = material;
    return mesh;
  }

  private terrace(limestone: StandardMaterial, iron: StandardMaterial, clay: StandardMaterial) {
    const skyline = this.paint("Civic morning waterline", 512, 128, true);
    const morning = skyline.ctx.createLinearGradient(0, 0, 0, 128);
    morning.addColorStop(0, "#a3b8c0"); morning.addColorStop(.67, "#dad0af"); morning.addColorStop(1, "#c4b8a1");
    skyline.ctx.fillStyle = morning; skyline.ctx.fillRect(0, 0, 512, 128);
    for (const [base, tint] of [[87, "#a6aaa0"], [103, "#889b96"]] as const) {
      skyline.ctx.fillStyle = tint; skyline.ctx.fillRect(0, base, 512, 128 - base);
      for (let x = 0; x < 510; x += 42) {
        const height = 7 + (x * 13) % 26;
        skyline.ctx.fillRect(x + (base % 5) * 3, base - height, 12 + (x * 17 % 20), height + 1);
      }
    }
    skyline.ctx.fillStyle = "#a17f69";
    for (const x of [160, 198, 308, 347]) skyline.ctx.fillRect(x, 70, 4, 46);
    skyline.ctx.fillRect(151, 87, 209, 3);
    skyline.ctx.fillStyle = "#788f94"; skyline.ctx.fillRect(0, 112, 512, 16);
    skyline.ctx.fillStyle = "#bdd0c657";
    for (let x = 4; x < 505; x += 54) skyline.ctx.fillRect(x, 114 + x % 9, 30, 1);
    skyline.texture.update();
    this.face("Morning civic roofs beyond the wall", 79, 16, 0, 4.07, 21.9, skyline.material);
    const water = this.paint("Baked flood basin reflections", 256, 128, true);
    const current = water.ctx.createLinearGradient(0, 0, 0, 128);
    current.addColorStop(0, "#88aaa9"); current.addColorStop(1, "#a2bbb0");
    water.ctx.fillStyle = current; water.ctx.fillRect(0, 0, 256, 128);
    for (let wave = 0; wave < 35; wave++) {
      water.ctx.fillStyle = wave % 3 ? "#c1cabe76" : "#718f936c";
      water.ctx.fillRect((wave * 73) % 256, (wave * 47) % 128, 9 + (wave * 23) % 36, 1);
    }
    water.texture.update();
    const basin = MeshBuilder.CreateGround("Municipal water below civic terrace", { width: 68, height: 26 }, this.scene);
    basin.parent = this.root; basin.position.set(0, -1.94, 10.95); basin.material = water.material;

    const { material, texture, ctx } = this.paint("Baked morning stone paving", 512, 256);
    ctx.fillStyle = "#737469"; ctx.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
      const x = col * 64, y = row * 64;
      const stone = ctx.createLinearGradient(x, y, x + 30, y + 64);
      stone.addColorStop(0, (row + col) % 2 ? "#a3a28e" : "#aba896"); stone.addColorStop(1, "#878b83");
      ctx.fillStyle = stone; ctx.fillRect(x + 1, y + 1, 62, 62);
      ctx.fillStyle = "#d8c8a87c"; ctx.fillRect(x + 3, y + 2, 57, 1);
    }
    ctx.fillStyle = "#a08b78"; ctx.fillRect(0, 32, 512, 3); ctx.fillRect(0, 37, 512, 1);
    texture.update();
    const floor = MeshBuilder.CreateGround("Civic terrace contact floor", { width: 34, height: 15.4 }, this.scene);
    floor.parent = this.root; floor.position.z = -1.7; floor.material = material;
    this.box("Terrace outer limestone lip", 33.93, .19, .25, 0, -.103, 5.98, limestone);
    this.box("Low stone terrace parapet", 26.2, .371, .37, 0, .174, 5.85, limestone);
    this.box("Parapet top cap", 26.3, .09, .47, 0, .41, 5.85, clay);
    for (let x = -12; x <= 12; x += 3) {
      this.box("Cast terrace baluster", .17, .72, .20, x, .326, 5.83, iron);
      this.box("Limestone baluster foot", .235, .16, .255, x, .073, 5.83, limestone);
    }
    this.box("Painted balustrade rail", 25.3, .065, .11, 0, .66, 5.83, iron);
    this.box("Rear bench plank", 3.27, .12, .54, -4.04, .358, 5.28, clay);
    for (const x of [-5.30, -2.80]) this.box("Grey bench leg", .21, .31, .39, x, .164, 5.24, iron);

    const fabric = this.paint("Striped hearing canopy cloth", 128, 64);
    fabric.ctx.fillStyle = "#b48169"; fabric.ctx.fillRect(0, 0, 128, 64);
    for (let x = 1; x < 128; x += 16) {
      fabric.ctx.fillStyle = x % 3 ? "#d1ae87" : "#c5a080";
      fabric.ctx.fillRect(x, 0, 6, 64);
    }
    fabric.ctx.fillStyle = "#664f4b65"; fabric.ctx.fillRect(0, 57, 128, 7);
    fabric.texture.update();
    const awning = MeshBuilder.CreateRibbon("High civic cloth awning", {
      pathArray: [[4.21, 3.28], [4.53, 3.34], [5.19, 3.63], [6.46, 3.84]]
        .map(([z, y]) => [new Vector3(4.04, y, z), new Vector3(12.56, y, z)]),
      sideOrientation: Mesh.DOUBLESIDE,
    }, this.scene);
    awning.parent = this.root; awning.material = fabric.material;
    this.box("Awning terracotta hem", 8.52, .129, .072, 8.30, 3.224, 4.212, clay);
    for (const x of [4.27, 12.39]) this.box("Canvas canopy post", .143, 3.62, .157, x, 1.81, 5.13, iron);

    const leaf = this.material("Low-poly terrace foliage", "#859269");
    const leafShade = this.material("Shadow terrace foliage", "#697b62");
    for (const x of [-11.02, .40, 11.62]) {
      const planter = MeshBuilder.CreateCylinder("Faceted clay planter", { height: .51, diameterTop: .91, diameterBottom: .71, tessellation: 9 }, this.scene);
      planter.parent = this.root; planter.position.set(x, .251, 5.20); planter.material = clay;
      this.box("Planter trunk", .112, 1.13, .109, x, .87, 5.2, iron).rotation.z = .07;
      for (const [dx, y, size] of [[-.30, 1.35, .66], [.21, 1.41, .72], [.05, 1.74, .61]]) {
        const crown = MeshBuilder.CreateSphere("Faceted linden foliage", { diameter: size, segments: 5 }, this.scene);
        crown.convertToFlatShadedMesh(); crown.parent = this.root; crown.position.set(x + dx, y, 5.21);
        crown.scaling.y = 1.24; crown.material = dx < 0 ? leafShade : leaf;
      }
    }
  }

  private witness(marker: Marker & { readerBit: number }, limestone: StandardMaterial, iron: StandardMaterial, clay: StandardMaterial,
    ash: StandardMaterial, paper: StandardMaterial): WitnessStand {
    const { id, x, z, title, readerBit } = marker;
    this.box(id + " terrace shoe", 1.42, .126, .77, x, .065, z + .10, iron);
    this.box(id + " lectern body", 1.08, .48, .52, x, .35, z + .16, limestone);
    this.box(id + " ash reading shelf", 1.36, .105, .66, x, .607, z + .14, ash).rotation.x = -.12;
    if (readerBit === 1) {
      this.box("Witness microphone brass stalk", .056, .25, .068, x - .19, .787, z + .25, clay).rotation.z = .26;
      const microphone = MeshBuilder.CreateSphere("Witness microphone capsule", { diameter: .102, segments: 6 }, this.scene);
      microphone.parent = this.root; microphone.position.set(x - .226, .912, z + .247); microphone.material = iron;
      microphone.scaling.set(1, .72, 1.43);
    } else {
      this.box(id + " mounted exhibit paper", .59, .031, .33, x, .675, z + .167, paper).rotation.y = .14;
      for (const dx of [-.15, .11]) this.box(id + " handwritten sample", .13, .005, .12, x + dx, .696, z + .149, ash).rotation.y = .14;
    }
    const lamp = this.material(id + " witness lamp", "#a78e68");
    this.box(id + " witness lamp bracket", .91, .065, .057, x, .305, z - .16, lamp);
    const screen = this.paint(id + " witness placard", 128, 64, true);
    this.face(id + " witness name", 1.57, .406, x, .485, z - .33, screen.material).rotation.x = .52;
    this.ring(id, x, z, lamp);
    return { title: title.toUpperCase(), bit: readerBit, screen: screen.texture, lamp };
  }

  private makeRoll(marker: Marker, limestone: StandardMaterial, iron: StandardMaterial, clay: StandardMaterial, ash: StandardMaterial,
    paper: StandardMaterial, screen: StandardMaterial) {
    const { id, x, z } = marker;
    this.box("Public Roll stone plinth", 1.74, .55, .79, x, .29, z + .14, limestone);
    this.box("Public Roll reading ledge", 2.02, .117, .94, x, .605, z + .17, ash);
    this.box("Public Roll rear board", .66, .046, .64, x + .278, .692, z + .17, clay);
    this.box("Public Roll first leaf", .57, .031, .57, x + .276, .73, z + .17, paper);
    for (const dz of [-.01, .062, .139, .214, .286]) {
      this.box("Ink on entered public record", .31, .005, .024, x + .274, .749, z + dz, iron);
    }
    const hinge = new TransformNode("Public Roll opening cover", this.scene);
    hinge.parent = this.root; hinge.position.set(x, .768, z + .17);
    this.box("Roll cloth-bound front cover", .63, .061, .62, .278, .014, 0, clay, hinge);
    this.box("Public Roll front gold stamp", .28, .011, .16, .281, .048, -.04, limestone, hinge);
    this.box("Public Roll inside cover leaf", .57, .012, .55, .275, -.021, 0, paper, hinge);
    this.box("Public Roll status beam", .91, .066, .058, x, .323, z - .193, this.rollLamp);
    this.face("Public Roll access placard", 1.64, .42, x, .48, z - .448, screen).rotation.x = .52;
    this.ring(id, x, z, this.rollLamp);
    return hinge;
  }

  private ring(id: string, x: number, z: number, material: StandardMaterial) {
    const ring = MeshBuilder.CreateTorus(id + " locator", { diameter: 1.77, thickness: .052, tessellation: 18 }, this.scene);
    ring.parent = this.root; ring.position.set(x, .031, z); ring.material = material;
  }

  private show(texture: DynamicTexture, lamp: StandardMaterial, title: string, state: string, ready: boolean, entered: boolean) {
    const ctx = texture.getContext();
    const ink = entered ? "#d5eab6" : ready ? "#f3dda5" : "#b8b3a4";
    ctx.fillStyle = entered ? "#3e5544" : ready ? "#594d3d" : "#4e5047"; ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.strokeRect(4, 4, 120, 56);
    ctx.fillStyle = ink; ctx.font = "bold 18px Tahoma"; ctx.fillText(title, 10, 25, 108);
    ctx.font = "bold 21px Tahoma"; ctx.fillText(state, 10, 49, 108);
    texture.update();
    lamp.diffuseColor.copyFrom(Color3.FromHexString(entered ? "#a0c677" : ready ? "#cdad6a" : "#878677"));
    lamp.diffuseColor.scaleToRef(entered ? .53 : ready ? .39 : .14, lamp.emissiveColor);
  }

  update(world: WorldView, time: number) {
    const ready = world.stage >= 1 && world.status !== "lobby";
    const mask = world.readerMask & HEARING_COMPLETE;
    let heard = 0;
    for (const stand of this.stands) {
      const entered = Boolean(mask & stand.bit);
      if (entered) heard++;
      const state = entered ? "HEARD" : ready ? "LISTEN" : "HOLD";
      if (state === stand.last) continue;
      stand.last = state;
      this.show(stand.screen, stand.lamp, stand.title, state, ready, entered);
    }
    const opened = world.stage === 2 && mask === HEARING_COMPLETE;
    const filed = world.status === "complete";
    const step = Math.max(0, Math.min(.07, time - (this.lastTime ?? time)));
    const goal = opened || filed ? Math.PI : 0;
    this.rollHinge.rotation.z += (goal - this.rollHinge.rotation.z) * (1 - Math.exp(-step * 10));
    this.lastTime = time;
    const roll = filed ? "FILED" : opened ? "OPEN" : "HOLD";
    if (roll !== this.lastRoll) {
      this.lastRoll = roll;
      this.show(this.rollPanel, this.rollLamp, "PUBLIC ROLL", roll, opened, filed);
    }

    const message = filed ? "PUBLIC ROLL / NAMES ENTERED" : opened ? "PUBLIC ROLL / OPEN FOR INSPECTION"
      : ready ? `WITNESSES / ${heard} OF ${this.stands.length} HEARD` : "PUBLIC RECORDS / ASSEMBLING";
    if (message === this.lastBoard) return;
    this.lastBoard = message;
    const ctx = this.board.getContext();
    ctx.fillStyle = "#485c5b"; ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = "#c0b58e"; ctx.strokeRect(4, 4, 504, 88);
    ctx.fillStyle = "#ede1b9"; ctx.font = "bold 27px Tahoma"; ctx.fillText("SOUTH WALL HEARING", 18, 39, 302);
    ctx.fillStyle = "#dbbc90"; ctx.font = "bold 16px Tahoma"; ctx.fillText("CIVIC TERRACE / 2007", 344, 37, 151);
    ctx.fillStyle = "#344b4e"; ctx.fillRect(12, 52, 488, 33);
    ctx.fillStyle = filed ? "#d5eab6" : "#f0dea8"; ctx.font = "bold 20px Tahoma";
    ctx.fillText(message, 21, 75, 466);
    this.board.update();
  }

  dispose() {
    this.scene.clearColor.copyFrom(this.previousSky);
    for (const material of this.materials) material.dispose(false, true);
  }
}
