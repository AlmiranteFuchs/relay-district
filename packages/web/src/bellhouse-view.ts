import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Scene } from "@babylonjs/core";
import { BELLHOUSE_CALLS, BELLHOUSE_CALLS_COMPLETE, routeMarkers, type Marker } from "../../shared/src/scene.ts";
import type { WorldView } from "./view.ts";

interface Bell {
  bit: number;
  body: TransformNode;
  clapper: TransformNode;
  lever: TransformNode;
  badge: DynamicTexture;
  lamp: StandardMaterial;
  name: string;
  display: string;
  struck?: number;
}

export class BellhouseScenery {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly materials: StandardMaterial[] = [];
  private readonly bells: Bell[] = [];
  private readonly board: DynamicTexture;
  private readonly deskLamp: StandardMaterial;
  private readonly deskBadge: DynamicTexture;
  private readonly boardMessage = { text: "", desk: "" };
  private lastMask?: number;

  constructor(scene: Scene, root: TransformNode) {
    this.scene = scene;
    this.root = root;
    const sand = this.material("Bellhouse sanded brick", "#a08a72");
    const iron = this.material("Bellhouse brown iron", "#524d42");
    const brass = this.material("Oxidized bell bronze", "#b99652");
    const gold = this.material("Bell lip wear", "#c9b175");
    const green = this.material("Bellhouse green enamel", "#788771");
    this.hall(sand, iron, green, gold);
    for (const [i, marker] of BELLHOUSE_CALLS.entries()) {
      const bell = this.hangBell([-8.1, 0, 8.1][i], [1.04, 1.17, .9][i], brass, gold, iron);
      const call = this.callStation(marker, green, iron, gold);
      this.bells.push({ ...bell, ...call, bit: marker.readerBit, name: marker.title.replace(/ Call$/, "").toUpperCase(), display: "" });
    }

    const board = this.paint("Bellhouse municipal register board", 512, 96, true);
    this.board = board.texture;
    this.box("Bellhouse fascia frame", 11.91, 1.24, .22, 0, 4.65, 4.67, iron);
    this.face("Bellhouse fascia lettering", 11.72, 1.10, 0, 4.65, 4.547, board.material);
    this.deskLamp = this.material("Roster access lamp", "#7c7562");
    const desk = this.paint("Roster access display", 128, 64, true);
    this.deskBadge = desk.texture;
    for (const mark of routeMarkers("bellhouse", 3)) this.rosterDesk(mark, green, iron, gold, desk.material);
  }

  private material(name: string, tint: string) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(tint);
    material.specularColor.set(.13, .115, .08);
    material.specularPower = 33;
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

  private hall(sand: StandardMaterial, iron: StandardMaterial, green: StandardMaterial, gold: StandardMaterial) {
    const wall = this.paint("Painted ochre brick joints", 512, 128);
    wall.ctx.fillStyle = "#796c55"; wall.ctx.fillRect(0, 0, 512, 128);
    for (let row = 0; row < 8; row++) for (let col = -1; col < 13; col++) {
      const x = col * 42 + (row % 2) * 21, y = row * 16;
      const clay = wall.ctx.createLinearGradient(x, y, x + 6, y + 16);
      clay.addColorStop(0, (row + col) % 3 ? "#ab8d75" : "#bb9779"); clay.addColorStop(1, "#91735f");
      wall.ctx.fillStyle = clay; wall.ctx.fillRect(x + 1, y + 1, 40, 14);
      wall.ctx.fillStyle = "#c6a38369"; wall.ctx.fillRect(x + 3, y + 2, 35, 1);
    }
    wall.texture.update();
    this.box("Bellhouse brick backing", 29.9, 6.4, .36, 0, 3.11, 6.21, sand);
    this.face("Glazed municipal brick surface", 29.5, 6.24, 0, 3.11, 6.021, wall.material);
    const arch = this.paint("Soot on gold arched wireglass", 128, 256);
    const ctx = arch.ctx;
    ctx.fillStyle = "#997861"; ctx.fillRect(0, 0, 128, 256);
    const arc = (radius: number) => {
      ctx.beginPath(); ctx.moveTo(64 - radius, 247); ctx.lineTo(64 - radius, 80);
      ctx.arc(64, 80, radius, Math.PI, 0); ctx.lineTo(64 + radius, 247); ctx.closePath();
    };
    arc(55); ctx.fillStyle = "#b3a187"; ctx.fill();
    arc(49); ctx.fillStyle = "#675d4b"; ctx.fill();
    const glass = ctx.createLinearGradient(0, 21, 42, 242);
    glass.addColorStop(0, "#e7c98e"); glass.addColorStop(.48, "#b1ad78"); glass.addColorStop(1, "#7e927c");
    arc(43); ctx.fillStyle = glass; ctx.fill();
    ctx.fillStyle = "#797d64"; ctx.fillRect(61, 37, 5, 210);
    for (const y of [75, 128, 185]) ctx.fillRect(21, y, 86, 4);
    ctx.fillStyle = "#efdda369"; ctx.fillRect(28, 89, 8, 89); ctx.fillRect(72, 125, 16, 104);
    arch.texture.update();
    for (const x of [-8.1, 0, 8.1]) {
      this.face("Arched wireglass bay", 5.52, 5.32, x, 2.79, 5.97, arch.material);
      this.box("Wireglass sill", 5.25, .17, .33, x, .253, 5.81, sand);
    }
    for (const x of [-12.43, -4.05, 4.05, 12.43]) {
      this.box("Brick arch support", .33, 6.08, .46, x, 3.01, 5.83, sand);
      this.box("Enameled capital", .57, .21, .56, x, 4.61, 5.76, green);
    }
    this.box("Bell timber beam", 25.93, .31, .37, 0, 4.06, 5.53, iron);
    this.box("Bell beam painted line", 25.93, .052, .071, 0, 3.975, 5.296, gold);
    this.box("Skirting base", 28, .17, .27, 0, .15, 5.74, iron);

    const { material, texture, ctx: floor } = this.paint("Painted Bellhouse paving", 512, 256);
    floor.fillStyle = "#61594b"; floor.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
      const x = col * 64, y = row * 64;
      const glaze = floor.createLinearGradient(x, y, x + 20, y + 64);
      glaze.addColorStop(0, (row + col) % 2 ? "#918573" : "#8e8271"); glaze.addColorStop(1, "#766f61");
      floor.fillStyle = glaze; floor.fillRect(x + 1, y + 1, 62, 62);
      floor.fillStyle = "#ccb68f4f"; floor.fillRect(x + 2, y + 2, 60, 1);
    }
    floor.fillStyle = "#918777"; floor.fillRect(0, 105, 512, 3); floor.fillRect(0, 119, 512, 2);
    texture.update();
    const ground = MeshBuilder.CreateGround("Bellhouse contact floor", { width: 34, height: 20 }, this.scene);
    ground.parent = this.root; ground.position.z = -3.1; ground.material = material;
  }

  private hangBell(x: number, scale: number, brass: StandardMaterial, gold: StandardMaterial, iron: StandardMaterial) {
    const body = new TransformNode("Hanging bell yoke", this.scene);
    body.parent = this.root; body.position.set(x, 4.04, 5.19); body.scaling.setAll(scale);
    this.box("Forged bell yoke", 1.33, .19, .34, 0, -.067, 0, iron, body);
    this.box("Bell pendant stem", .19, .33, .24, 0, -.235, 0, iron, body);
    const outline = [[.16, -.27], [.34, -.37], [.43, -.48], [.44, -.70], [.49, -.98], [.63, -1.21], [.86, -1.43], [.86, -1.52],
      [.72, -1.52], [.69, -1.42], [.54, -1.25], [.43, -1.02], [.38, -.76], [.37, -.50], [.16, -.32]];
    const shell = MeshBuilder.CreateLathe("Cast bell with flared skirt", {
      shape: outline.map(([radius, y]) => new Vector3(radius, y, 0)), tessellation: 18, sideOrientation: Mesh.DOUBLESIDE,
    }, this.scene);
    shell.parent = body; shell.material = brass;
    const lip = MeshBuilder.CreateTorus("Worn bell mouth rim", { diameter: 1.69, thickness: .053, tessellation: 18 }, this.scene);
    lip.parent = body; lip.position.y = -1.47; lip.material = gold;
    const clapper = new TransformNode("Bell hanging clapper", this.scene);
    clapper.parent = body; clapper.position.y = -.50;
    this.box("Bell clapper iron rod", .066, .91, .063, 0, -.54, 0, iron, clapper);
    const knob = MeshBuilder.CreateSphere("Hammer clapper bead", { diameter: .235, segments: 8 }, this.scene);
    knob.parent = clapper; knob.position.y = -1.04; knob.material = iron;
    return { body, clapper };
  }

  private callStation(marker: Marker, green: StandardMaterial, iron: StandardMaterial, gold: StandardMaterial) {
    const { id, x, z } = marker;
    this.box(id + " iron foot", 1.32, .13, .74, x, .072, z + .125, iron);
    this.box(id + " enamel pull casing", 1.08, .46, .51, x, .346, z + .19, green);
    const lever = new TransformNode(id + " handle carrier", this.scene);
    lever.parent = this.root; lever.position.set(x, .67, z + .11);
    this.box(id + " brass rod", .084, .27, .075, 0, 0, 0, gold, lever);
    this.box(id + " softwood handle", .39, .090, .095, 0, .12, 0, iron, lever);
    const lamp = this.material(id + " linked glass", "#86785e");
    const screen = this.paint(id + " nameplate screen", 128, 64, true);
    this.face(id + " engraved nameplate", 1.49, .42, x, .583, z - .11, screen.material).rotation.x = .54;
    this.box(id + " latch light", .78, .073, .067, x, .295, z - .077, lamp);
    this.ring(id, x, z, lamp);
    return { badge: screen.texture, lever, lamp };
  }

  private rosterDesk(marker: Marker, green: StandardMaterial, iron: StandardMaterial, gold: StandardMaterial, screen: StandardMaterial) {
    const { x, z, id } = marker;
    this.box("Roster desk iron shoe", 1.52, .11, .65, x, .061, z + .06, iron);
    for (const dx of [-.59, .59]) this.box("Roster desk legs", .18, .51, .43, x + dx, .31, z + .105, green);
    this.box("Roster desk wooden top", 1.69, .145, .68, x, .578, z + .075, iron).rotation.x = -.12;
    this.box("Open municipal name roster", .70, .05, .36, x - .16, .662, z + .109, gold).rotation.y = .14;
    for (const dx of [-.32, -.005]) this.box("Names on ledger leaf", .19, .006, .13, x + dx, .694, z + .09, iron).rotation.y = .14;
    this.box("Roster desk latch light", .86, .067, .055, x, .414, z - .275, this.deskLamp);
    this.box("Roster card mount", .91, .069, .13, x, .515, z - .353, iron);
    this.face("Roster desk access card", 1.37, .39, x, .512, z - .424, screen).rotation.x = .54;
    this.ring(id, x, z, this.deskLamp);
  }

  private ring(id: string, x: number, z: number, material: StandardMaterial) {
    const ring = MeshBuilder.CreateTorus(id + " locator", { diameter: 1.77, thickness: .055, tessellation: 18 }, this.scene);
    ring.parent = this.root; ring.position.set(x, .032, z); ring.material = material;
  }

  private placard(texture: DynamicTexture, name: string, text: string, color: string, linked: boolean) {
    const ctx = texture.getContext();
    ctx.fillStyle = linked ? "#3b5541" : "#4e4639"; ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(4, 4, 120, 56);
    ctx.fillStyle = color; ctx.font = "bold 19px Tahoma"; ctx.fillText(name, 12, 27, 106);
    ctx.font = "bold 16px Tahoma"; ctx.fillText(text, 12, 48, 106);
    texture.update();
  }

  update(world: WorldView, time: number) {
    const mask = world.readerMask & BELLHOUSE_CALLS_COMPLETE;
    const newlyCalled = this.lastMask === undefined ? 0 : mask & ~this.lastMask;
    const ready = world.stage === 1 || world.stage === 2;
    for (const bell of this.bells) {
      if (newlyCalled & bell.bit) bell.struck = time;
      if (!(mask & bell.bit)) bell.struck = undefined;
      const ringing = bell.struck === undefined ? 2 : Math.max(0, time - bell.struck);
      const amplitude = ringing < 1.45 ? Math.exp(-ringing * 2.5) * .28 : 0;
      bell.body.rotation.z = Math.sin(ringing * 12.8) * amplitude;
      bell.clapper.rotation.z = -.68 * Math.sin(ringing * 15.3) * amplitude;
      bell.lever.position.y = .67 - .17 * Math.max(0, 1 - ringing * 1.85);
      const linked = Boolean(mask & bell.bit);
      const display = linked ? "CALLED" : ready ? "PULL" : "HOLD";
      if (display === bell.display) continue;
      bell.display = display;
      this.placard(bell.badge, bell.name, display, linked ? "#d5efaa" : ready ? "#efd39a" : "#bdb39e", linked);
      bell.lamp.diffuseColor.copyFrom(Color3.FromHexString(linked ? "#9cbe66" : ready ? "#c49958" : "#7a7668"));
      bell.lamp.emissiveColor.copyFrom(bell.lamp.diffuseColor).scaleInPlace(linked ? .56 : ready ? .42 : .12);
    }
    this.lastMask = mask;

    const desk = world.status === "complete" ? "FILED" : world.stage === 3 ? "OPEN" : "HOLD";
    if (desk !== this.boardMessage.desk) {
      this.boardMessage.desk = desk;
      const open = desk !== "HOLD";
      this.placard(this.deskBadge, "ROSTER", desk, open ? "#d5efaa" : "#bdb39e", open);
      this.deskLamp.diffuseColor.copyFrom(Color3.FromHexString(open ? "#9cbe66" : "#7a7668"));
      this.deskLamp.emissiveColor.copyFrom(this.deskLamp.diffuseColor).scaleInPlace(open ? .56 : .12);
    }
    const calls = this.bells.filter(bell => mask & bell.bit).length;
    const message = world.stage === 3 ? "ROSTER DESK / " + desk : world.stage === 0 ? "SIGNAL GALLERY / ON HOLD"
      : `NAME CALLS  ${calls} OF ${this.bells.length}` + (world.stage === 2 && world.status === "combat" ? " / CLEAR THE GUARD" : "");
    if (message === this.boardMessage.text) return;
    this.boardMessage.text = message;
    const ctx = this.board.getContext();
    ctx.fillStyle = "#4c463a"; ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = "#bcaa83"; ctx.strokeRect(4, 4, 504, 88);
    ctx.fillStyle = "#e5dbac"; ctx.font = "bold 29px Tahoma"; ctx.fillText("BELLHOUSE", 18, 41, 207);
    ctx.fillStyle = "#d4b787"; ctx.font = "bold 16px Tahoma"; ctx.fillText("SOUTH WALL / PUBLIC SIGNALS", 232, 39, 257);
    ctx.fillStyle = "#373e38"; ctx.fillRect(12, 52, 488, 33);
    ctx.fillStyle = desk !== "HOLD" || calls === this.bells.length ? "#d5efaa" : "#e9d2a1";
    ctx.font = "bold 21px Tahoma"; ctx.fillText(message, 21, 76, 450);
    this.board.update();
  }

  dispose() {
    for (const material of this.materials) material.dispose(false, true);
  }
}
