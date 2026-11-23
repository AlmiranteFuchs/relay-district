import { Color3, DynamicTexture, MeshBuilder, StandardMaterial, TransformNode, type Mesh, type Scene } from "@babylonjs/core";
import { TICK_RATE } from "../../shared/src/content.ts";
import { LIFT_LEG_TICKS, LIFT_PHASE, routeMarkers, type Marker } from "../../shared/src/scene.ts";
import type { WorldView } from "./view.ts";

const statusPaint = {
  idle: { field: "#494332", ink: "#f2db9e", lamp: "#bd9b55" },
  moving: { field: "#274956", ink: "#daf6f0", lamp: "#77bdc7" },
  jammed: { field: "#663b33", ink: "#ffe0af", lamp: "#ec8a53" },
  docked: { field: "#345343", ink: "#e2efbb", lamp: "#a3c775" },
};

export class LiftScenery {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly shaft: TransformNode;
  private readonly winch: TransformNode;
  private readonly weights: TransformNode;
  private readonly materials: StandardMaterial[] = [];
  private readonly signal: StandardMaterial;
  private readonly board: DynamicTexture;
  private brakeWheel?: TransformNode;
  private brakeDisplay?: DynamicTexture;
  private brakeLocator?: Mesh;
  private logLocator?: Mesh;
  private lastMessage = "";
  private depth?: number;

  constructor(scene: Scene, root: TransformNode, markers: Marker[]) {
    this.scene = scene;
    this.root = root;
    const plated = this.material("Lift steel framing", "#566b70");
    const oiled = this.material("Lift oiled steel", "#364549");
    const enamel = this.material("Floodgate machinery enamel", "#557577");
    const cast = this.material("Counterweight ochre enamel", "#a78550");
    const cable = this.material("Braided drive cable", "#747773");
    this.signal = this.material("Lift signal glass", statusPaint.idle.lamp);
    this.shaft = new TransformNode("Lift shaft and fixed landings", scene);
    this.shaft.parent = root;
    this.weights = new TransformNode("Moving lift counterweights", scene);
    this.weights.parent = root;
    this.winch = new TransformNode("Lift winch drive", scene);
    this.winch.parent = root;
    this.winch.position.set(0, 2.54, 4.82);

    this.paintShaft(oiled, cable);
    this.paintDeck(plated, cast);
    this.buildHoist(enamel, oiled, cast, cable);
    const board = this.paint("Floodgate mechanical schedule", 512, 96, true);
    this.board = board.texture;
    this.box("Hoist board housing", 10.73, 1.36, .19, 0, 4.16, 4.68, oiled);
    this.face("Floodgate title and lift phase", 10.54, 1.22, 0, 4.16, 4.577, board.material);
    this.station(routeMarkers("lift", 1)[0], enamel, oiled, cast);
    const log = markers.find(({ id }) => id === "lift-log");
    if (log) this.station(log, enamel, oiled, cast);
  }

  private material(name: string, tint: string) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(tint);
    material.specularColor.set(.1, .13, .12);
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

  private face(name: string, width: number, height: number, x: number, y: number, z: number,
    material: StandardMaterial, parent = this.root) {
    const mesh = MeshBuilder.CreatePlane(name, { width, height }, this.scene);
    mesh.parent = parent; mesh.position.set(x, y, z); mesh.material = material;
    return mesh;
  }

  private paintShaft(dark: StandardMaterial, scaleMark: StandardMaterial) {
    const { material, texture, ctx } = this.paint("Painted caisson wall", 512, 512);
    const wash = ctx.createLinearGradient(0, 0, 0, 512);
    wash.addColorStop(0, "#8b9290"); wash.addColorStop(.26, "#82918c");
    wash.addColorStop(.48, "#697971"); wash.addColorStop(1, "#465e62");
    ctx.fillStyle = wash; ctx.fillRect(0, 0, 512, 512);
    for (let y = 22; y < 512; y += 43) {
      ctx.fillStyle = "#30464a60"; ctx.fillRect(0, y, 512, 2);
      ctx.fillStyle = "#a1ad965c"; ctx.fillRect(0, y + 3, 512, 1);
      for (let x = y % 2 ? 9 : 56; x < 512; x += 76) {
        ctx.fillStyle = "#344d5150"; ctx.fillRect(x, y + 2, 1, 40);
        ctx.fillStyle = "#263e454a"; ctx.fillRect(x + 5, y + 6, 4, 4);
      }
    }
    for (const x of [38, 77, 135, 195, 262, 415, 453]) {
      ctx.fillStyle = "#59756c58"; ctx.fillRect(x, 47 + x % 86, 5 + x % 8, 337);
    }
    for (const y of [148, 293, 440]) {
      ctx.fillStyle = "#524c3d60"; ctx.fillRect(0, y, 512, 4);
      ctx.fillStyle = "#baa5736a"; ctx.fillRect(0, y + 3, 512, 1);
    }
    texture.update();
    this.face("Moving shaft wall skin", 35, 19, 0, -4.4, 6.0, material, this.shaft);
    for (const y of [-8.9, -5.45, -2, 1.45, 4.9]) {
      this.box("Channel landing lip", 29, .19, .43, 0, y, 5.74, scaleMark, this.shaft);
      this.box("Dark undercut", 29, .21, .25, 0, y - .20, 5.87, dark, this.shaft);
    }
    const gate = this.paint("Spillgate louvres and waterline", 128, 256);
    gate.ctx.fillStyle = "#465c61"; gate.ctx.fillRect(0, 0, 128, 256);
    gate.ctx.fillStyle = "#39545c"; gate.ctx.fillRect(8, 6, 112, 243);
    for (let y = 10; y < 250; y += 14) {
      gate.ctx.fillStyle = "#243a45"; gate.ctx.fillRect(15, y, 98, 7);
      gate.ctx.fillStyle = "#849386"; gate.ctx.fillRect(16, y + 7, 96, 2);
    }
    gate.ctx.fillStyle = "#a3ab83"; gate.ctx.fillRect(51, 21, 26, 9);
    gate.texture.update();
    for (const x of [-8, 8]) {
      this.box("Spillgate well border", 4.7, 7.85, .23, x, -3.64, 5.87, dark, this.shaft);
      this.face("Spillgate steel skin", 4.44, 7.61, x, -3.64, 5.739, gate.material, this.shaft);
    }
  }

  private paintDeck(steel: StandardMaterial, ochre: StandardMaterial) {
    const { material, texture, ctx } = this.paint("Lift treadplate tile diffuse", 512, 256);
    ctx.fillStyle = "#3f5058"; ctx.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
      const x = col * 64, y = row * 64;
      const strip = ctx.createLinearGradient(x, y, x + 22, y + 64);
      strip.addColorStop(0, (row + col) % 2 ? "#819095" : "#83938e");
      strip.addColorStop(1, "#566a71");
      ctx.fillStyle = strip; ctx.fillRect(x + 1, y + 1, 62, 62);
      ctx.fillStyle = "#b6bbb065"; ctx.fillRect(x + 2, y + 2, 60, 1);
      ctx.fillStyle = "#34485046";
      for (const u of [4, 58]) for (const v of [4, 58]) ctx.fillRect(x + u, y + v, 2, 2);
    }
    ctx.fillStyle = "#ab956a"; ctx.fillRect(0, 13, 512, 2); ctx.fillRect(0, 240, 512, 2);
    for (let x = 0; x < 512; x += 17) {
      ctx.fillRect(x, 8, 12, 3); ctx.fillRect(x, 246, 12, 3);
    }
    texture.update();
    const floor = MeshBuilder.CreateGround("Lift deck at combat height", { width: 34, height: 11.1 }, this.scene);
    floor.parent = this.root; floor.material = material;
    this.box("Fixed deck apron", 34, .19, .20, 0, -.087, -5.54, steel);
    this.box("Outer deck ochre strip", 34, .052, .22, 0, -.014, -5.54, ochre);
    this.box("Rear cage guard cap", 25.8, .10, .13, 0, .63, 5.06, ochre);
    for (let x = -12.5; x < 13; x += .89) this.box("Rear cage bar", .059, .63, .06, x, .307, 5.06, steel);
  }

  private buildHoist(enamel: StandardMaterial, dark: StandardMaterial, ochre: StandardMaterial, cable: StandardMaterial) {
    this.box("Overhead lift beam", 25.24, .38, .69, 0, 4.85, 5.16, enamel);
    this.box("Hoist bolt line", 25.4, .084, .09, 0, 4.88, 4.772, ochre);
    this.box("Winch side casing", 3.72, 2.18, .49, 0, 2.53, 5.27, dark);
    this.box("Drive support foot", 3.93, .20, .59, 0, 1.48, 5.26, enamel);
    for (const x of [-8.3, 8.3]) {
      for (const dx of [-.73, .73]) this.box("Counterweight guide rail", .135, 12.8, .19, x + dx, .2, 5.35, dark);
      this.box("Lift counterweight block", 1.26, 1.7, .65, x, -.98, 5.12, ochre, this.weights);
      this.box("Lift weight inset", 1.29, .69, .11, x, -.94, 4.77, dark, this.weights);
      this.box("Lift weight guide cable", .062, 8.75, .062, x, 3.31, 5.12, cable, this.weights);
      for (const dx of [-.34, .34]) {
        const brace = this.box("Lift counterweight chevron", .12, .55, .035, x + dx, -.96, 4.707, ochre, this.weights);
        brace.rotation.z = dx < 0 ? -.56 : .56;
      }
    }
    for (const x of [-12.26, 12.26]) {
      this.box("Compression cage upright", .28, 4.85, .46, x, 2.4, 5.09, enamel);
      this.box("Cage foot casting", .63, .19, .54, x, .11, 5.04, dark);
    }
    const rim = MeshBuilder.CreateTorus("Exposed lift sheave", { diameter: 1.69, thickness: .16, tessellation: 16 }, this.scene);
    rim.parent = this.winch; rim.rotation.x = Math.PI / 2; rim.material = ochre;
    for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3]) {
      this.box("Lift sheave spoke", 1.43, .14, .13, 0, 0, 0, enamel, this.winch).rotation.z = angle;
    }
    const hub = MeshBuilder.CreateCylinder("Lift sheave hub", { diameter: .44, height: .28, tessellation: 10 }, this.scene);
    hub.parent = this.winch; hub.rotation.x = Math.PI / 2; hub.position.z = -.036; hub.material = dark;
  }

  private station(marker: Marker, enamel: StandardMaterial, dark: StandardMaterial, ochre: StandardMaterial) {
    const { id, x, z } = marker;
    this.box(id + " plinth", 1.13, .21, .75, x, .105, z + .08, dark);
    this.box(id + " drive casing", .97, .46, .51, x, .39, z + .19, enamel);
    this.box(id + " indicator", .76, .072, .057, x, .362, z - .092, this.signal);
    const locator = MeshBuilder.CreateTorus(id + " locator", { diameter: 1.75, thickness: .054, tessellation: 18 }, this.scene);
    locator.parent = this.root; locator.position.set(x, .032, z); locator.material = this.signal;
    if (id === "lift-log") {
      this.logLocator = locator;
      const paper = this.material("Oil-stained landing log", "#c6bd8c");
      this.box("Lift Log folding ledger", .56, .036, .31, x, .637, z + .15, paper).rotation.y = -.16;
      for (const dx of [-.123, .123]) for (const dz of [.09, .15, .21]) {
        this.box("Lift log pencilled entry", .16, .005, .015, x + dx, .657, z + dz, dark);
      }
      return;
    }
    this.brakeLocator = locator;
    this.brakeWheel = new TransformNode("Manual lift brake wheel", this.scene);
    this.brakeWheel.parent = this.root; this.brakeWheel.position.set(x, .89, z + .19);
    const rim = MeshBuilder.CreateTorus("Manual brake rim", { diameter: .68, thickness: .09, tessellation: 14 }, this.scene);
    rim.parent = this.brakeWheel; rim.rotation.x = Math.PI / 2; rim.material = ochre;
    for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3]) {
      this.box("Manual brake spoke", .61, .058, .064, 0, 0, 0, ochre, this.brakeWheel).rotation.z = angle;
    }
    this.box("Brake axle nut", .155, .144, .117, 0, 0, -.033, dark, this.brakeWheel);
    const display = this.paint("Brake command window", 128, 64, true);
    this.brakeDisplay = display.texture;
    this.face("Brake command placard", 1.23, .31, x, .51, z - .106, display.material).rotation.x = .48;
  }

  update(world: WorldView, time: number) {
    const phase = world.readerMask;
    const remainingTicks = Math.max(0, world.readerUntil - world.frame);
    const progress = Math.max(0, 1 - remainingTicks / LIFT_LEG_TICKS);
    const seconds = Math.ceil(remainingTicks / TICK_RATE);
    const lowering = phase === LIFT_PHASE.lowering || phase === LIFT_PHASE.resuming;
    const jammed = phase === LIFT_PHASE.jammed;
    const docked = phase === LIFT_PHASE.docked;
    const ready = world.stage === 1 && world.status === "signal";
    const stopped = world.status === "failed";
    if (!stopped || this.depth === undefined) {
      this.depth = docked ? 1 : phase === LIFT_PHASE.resuming ? (1 + progress) / 2
        : jammed ? .5 : phase === LIFT_PHASE.lowering ? progress / 2 : 0;
    }
    const depth = this.depth;
    this.shaft.position.y = depth * 7.4;
    this.weights.position.y = depth * 5.26;
    this.winch.rotation.z = depth * Math.PI * -3.6;
    if (this.brakeWheel) this.brakeWheel.rotation.z = depth * Math.PI * -.62;
    this.brakeLocator?.setEnabled(ready || jammed && world.status === "combat");
    this.logLocator?.setEnabled(world.status === "signal");

    const status = stopped ? "idle" : docked ? "docked" : jammed ? "jammed" : lowering ? "moving" : "idle";
    const message = stopped ? "STOPPED / RETRY FROM MISSION" : docked ? "LOWER LANDING / DOCKED" : jammed ? "JAMMED / RESET BRAKE WHEEL"
      : lowering ? `${phase === LIFT_PHASE.resuming ? "RESUMING" : "LOWERING"}  ${seconds}s`
        : ready ? "UPPER LANDING / RELEASE BRAKE" : "UPPER LANDING / STANDBY";
    const theme = statusPaint[status];
    if (message !== this.lastMessage) {
      this.lastMessage = message;
      this.signal.diffuseColor.copyFrom(Color3.FromHexString(theme.lamp));
      const ctx = this.board.getContext();
      ctx.fillStyle = "#293d44"; ctx.fillRect(0, 0, 512, 96);
      ctx.strokeStyle = "#aeb5a3"; ctx.strokeRect(4, 4, 504, 88);
      ctx.fillStyle = "#d9d5ac"; ctx.font = "bold 28px Tahoma"; ctx.fillText("FLOODGATE LIFT", 18, 39, 259);
      ctx.fillStyle = "#b69d69"; ctx.font = "bold 16px Tahoma"; ctx.fillText("SOUTH WALL / HOIST 04", 296, 38, 192);
      ctx.fillStyle = theme.field; ctx.fillRect(12, 52, 488, 33);
      ctx.fillStyle = theme.ink; ctx.font = "bold 21px Tahoma"; ctx.fillText(message, 21, 76, 460);
      this.board.update();
      if (this.brakeDisplay) {
        const brake = this.brakeDisplay.getContext();
        brake.fillStyle = theme.field; brake.fillRect(0, 0, 128, 64);
        brake.strokeStyle = theme.ink; brake.lineWidth = 2; brake.strokeRect(3, 3, 122, 58);
        brake.fillStyle = theme.ink; brake.font = "bold 29px Tahoma";
        brake.fillText(stopped ? "STOP" : jammed ? "RESET" : ready ? "START" : docked ? "LOCKED" : "WAIT", 12, 41, 104);
        this.brakeDisplay.update();
      }
    }
    this.signal.diffuseColor.scaleToRef(jammed && !stopped ? .65 + .20 * Math.sin(time * 8) : .42, this.signal.emissiveColor);
  }

  dispose() {
    for (const material of this.materials) material.dispose(false, true);
  }
}
