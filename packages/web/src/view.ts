import {
  Color3, Color4, DirectionalLight, DynamicTexture, Engine, FreeCamera, HemisphericLight,
  Matrix, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3, VertexData,
} from "@babylonjs/core";
import { FORMS, TICK_RATE, type Family } from "../../shared/src/content.ts";
import { ENEMY_WINDUP_TICKS, RUNNER_HIT_RADIUS, RUNNER_LUNGE_TICKS, type CombatEvent } from "../../shared/src/combat.ts";
import { FLOOD_INDEX_BANKS, FLOOD_SCAN_TICKS, TERMINAL_READERS_COMPLETE, type IndexScan, type Marker, type RosterCase } from "../../shared/src/scene.ts";
import { MothAnimation } from "./moth-animation.ts";
import { instantiateActorModel, loadModelAsset, type ActorModel, type ModelAsset } from "./model-assets.ts";
import { MODEL_SLOTS, type ModelSlot } from "./model-replacements.ts";
import { ArchiveScenery } from "./archive-view.ts";
import { ExchangeScenery } from "./exchange-view.ts";
import { DepartureScenery } from "./departure-view.ts";
import { ViaductScenery } from "./viaduct-view.ts";
import { LiftScenery } from "./lift-view.ts";
import { PumpScenery } from "./pump-view.ts";
import { BellhouseScenery } from "./bellhouse-view.ts";
import { AnnexScenery } from "./annex-view.ts";
import { FloodIndexScenery } from "./flood-index-view.ts";

export interface ViewActor {
  x: number; y: number; z: number; facing: number; name: string; companion: string; family: Family;
  kind: string; hp: number; maxHp: number; energy: number; armed: boolean; connected: boolean;
  phase: string; age: number; duration: number; combo: number; step: number; ack: number; moving: boolean; rank: number;
  rescued: boolean; rescueTarget: string; rescueTicks: number; signalTag: boolean; bayFourTicket: boolean; relayPennant: boolean; bellhouseSeal: boolean;
}
export interface WorldView {
  kind: string; mission: string; status: string; code: string; leader: string; stage: number; wave: number;
  frame: number; practice: boolean; readerMask: number; readerUntil: number; actors: Map<string, ViewActor>;
  rosterCase?: RosterCase;
  indexScans?: ReadonlyMap<string, IndexScan>;
}

interface Visual {
  model: ActorModel;
  creature?: ActorModel;
  weapon?: ActorModel;
  mothAnimation?: MothAnimation;
  signalTag?: TransformNode;
  bayFourTicket?: TransformNode;
  relayPennant?: TransformNode;
  bellhouseSeal?: TransformNode;
  at: Vector3;
  shadow: Mesh;
  family: Family;
  reaction: number;
  held: number;
  label: HTMLDivElement;
  labelText: Text;
  bar?: HTMLElement;
}
interface Effect {
  mesh?: Mesh; label?: HTMLDivElement; position: Vector3; time: number; lasts: number;
  material?: StandardMaterial; fadeAt?: number; warningSource?: string;
}

function makeLabel(parent: HTMLElement, className = "") {
  const label = document.createElement("div");
  label.className = "world-label " + className;
  parent.append(label);
  return label;
}

const deg = (value: number) => (Math.PI * value) / 180;
const mix = (a: number, b: number, n: number) => a + (b - a) * n;

export class GameView {
  engine: Engine;
  scene: Scene;
  private camera: FreeCamera;
  private models = new Map<ModelSlot, ModelAsset>();
  private visuals = new Map<string, Visual>();
  private scenery?: TransformNode;
  private missionScenery?: ArchiveScenery | ExchangeScenery | DepartureScenery | ViaductScenery | LiftScenery | PumpScenery
    | BellhouseScenery | AnnexScenery | FloodIndexScenery;
  private place = "";
  private labels = new Map<string, HTMLDivElement>();
  private effects: Effect[] = [];
  private palette = new Map<string, StandardMaterial>();
  private clock = 0;
  private star?: DynamicTexture;
  private canvas: HTMLCanvasElement;
  private layer: HTMLElement;
  constructor(canvas: HTMLCanvasElement, layer: HTMLElement) {
    this.canvas = canvas;
    this.layer = layer;
    this.engine = new Engine(canvas, true, { limitDeviceRatio: 1.5, preserveDrawingBuffer: true }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.119, 0.16, 0.2, 1);
    this.scene.ambientColor = new Color3(.34, .39, .42);
    this.camera = new FreeCamera("Battle camera", new Vector3(.4, 10.8, -17.6), this.scene);
    this.camera.setTarget(new Vector3(0, .75, -.25));
    this.camera.fov = 0.60;
    this.camera.minZ = 0.2;
    const ambient = new HemisphericLight("Plaza skylight", new Vector3(.12, 1, -.4), this.scene);
    ambient.intensity = 1.04;
    ambient.diffuse = Color3.FromHexString("#dbe9df");
    ambient.groundColor = Color3.FromHexString("#7c889d");
    const wash = new DirectionalLight("Service strip", new Vector3(-.22, -1, -.32), this.scene);
    wash.intensity = .24;
    wash.diffuse = Color3.FromHexString("#ffe6be");
    const resize = () => {
      this.engine.resize();
      const ratio = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      this.camera.fov = ratio < 1.45 ? .75 : .60;
    };
    window.addEventListener("resize", resize);
    resize();
  }

  async load() {
    await Promise.all(MODEL_SLOTS.map(async (slot) => {
      this.models.set(slot, await loadModelAsset(this.scene, slot));
    }));
  }

  private material(name: string, color: string, shine = false) {
    const found = this.palette.get(name);
    if (found) return found;
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseColor = Color3.FromHexString(color);
    mat.specularColor = shine ? new Color3(.28, .32, .31) : new Color3(.03, .035, .04);
    mat.specularPower = 48;
    this.palette.set(name, mat);
    return mat;
  }

  private mesh(name: string, dimensions: [number, number, number], position: [number, number, number], mat: StandardMaterial, parent: TransformNode) {
    const [width, height, depth] = dimensions;
    const box = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    box.position.set(...position);
    box.material = mat;
    box.parent = parent;
    return box;
  }

  private sign(title: string, detail: string, x: number, y: number, z: number, root: TransformNode, gold = false) {
    const mat = this.material("Sign " + title + detail, "#ffffff");
    if (!mat.diffuseTexture) {
      const tex = new DynamicTexture("Painted lettering " + title, { width: 256, height: 64 }, this.scene, true);
      const ctx = tex.getContext();
      ctx.fillStyle = gold ? "#5b4939" : "#314d62"; ctx.fillRect(0, 0, 256, 64);
      ctx.strokeStyle = gold ? "#cbb487" : "#8eadb1"; ctx.lineWidth = 2; ctx.strokeRect(4, 4, 248, 56);
      ctx.fillStyle = gold ? "#f3d7a6" : "#e4eee0"; ctx.font = "bold 23px Tahoma";
      ctx.fillText(title, 13, 30, 230);
      ctx.font = "12px Tahoma"; ctx.fillStyle = "#b9d4d0";
      ctx.fillText(detail, 14, 48, 226);
      tex.update();
      mat.diffuseTexture = tex;
      mat.emissiveColor = new Color3(.17, .19, .2);
      mat.backFaceCulling = false;
    }
    const plane = MeshBuilder.CreatePlane(title, { width: 3.6, height: .90 }, this.scene);
    plane.parent = root; plane.position.set(x, y, z); plane.material = mat;
  }

  private nightPlatform(root: TransformNode) {
    const enamel = this.material("Carriage enamel", "#ffffff");
    if (!enamel.diffuseTexture) {
      const paint = new DynamicTexture("Weathered carriage enamel", { width: 256, height: 64 }, this.scene, false, 1);
      const ctx = paint.getContext();
      const wash = ctx.createLinearGradient(0, 4, 0, 64);
      wash.addColorStop(0, "#a8a990"); wash.addColorStop(.3, "#bdbca0"); wash.addColorStop(1, "#797f70");
      ctx.fillStyle = wash; ctx.fillRect(0, 0, 256, 64);
      for (let x = 4; x < 256; x += 16) {
        ctx.fillStyle = "#39423830"; ctx.fillRect(x, 0, 1, 64);
        ctx.fillStyle = "#463d2a32"; ctx.fillRect(x + 3, 7, 2, 9 + x % 23);
        ctx.fillStyle = "#e5ddae67"; ctx.fillRect(x + 1, 2, 1, 5);
      }
      paint.update();
      enamel.diffuseTexture = paint;
    }
    const blue = this.material("Carriage blue", "#395771");
    const silver = this.material("Window beading", "#777f7d", true);
    const glass = this.material("Unlit carriage glass", "#243740", true);
    const skirt = this.material("Carriage underframe", "#2c373f");
    const lamps = this.material("Tail lamps", "#b56b4b");
    const stencilPaint = this.material("Platform stencil paint", "#b9a575");
    lamps.emissiveColor = Color3.FromHexString("#b55c36").scale(.8);
    this.mesh("Carriage underframe", [18.9, .38, 1.03], [.25, .49, 5.35], skirt, root);
    this.mesh("Carriage body", [18.9, 2.4, 1.03], [.25, 1.89, 5.35], enamel, root);
    this.mesh("Enamel belt line", [18.93, .25, 1.05], [.25, 1.38, 5.35], blue, root);
    const roof = MeshBuilder.CreateCylinder("Rolled carriage roof", { diameter: 1.07, height: 18.9, tessellation: 10 }, this.scene);
    roof.parent = root; roof.position.set(.25, 3.05, 5.35); roof.rotation.z = Math.PI / 2;
    roof.scaling.x = .47; roof.material = blue;
    for (const x of [-8.2, -6.55, -3.85, -2.2, -.55, 2.15, 3.8, 6.5, 8.15]) {
      this.mesh("Window seal", [1.34, .86, .06], [x, 2.3, 4.818], silver, root);
      this.mesh("Smoked window", [1.24, .75, .05], [x, 2.3, 4.785], glass, root);
      this.mesh("Window reflection", [1.12, .036, .014], [x, 2.55, 4.75], blue, root);
    }
    for (const x of [-5.2, .8, 5.15]) {
      this.mesh("Door pocket", [1.12, 2.01, .09], [x, 1.74, 4.794], skirt, root);
      for (const dx of [-.25, .25]) {
        this.mesh("Sliding door", [.47, 1.96, .075], [x + dx, 1.74, 4.747], enamel, root);
        this.mesh("Door light", [.23, .51, .035], [x + dx, 2.28, 4.694], glass, root);
      }
    }
    for (const x of [-8.86, 9.35]) this.mesh("Tail lamp", [.19, .13, .06], [x, 1.13, 4.785], lamps, root);
    this.sign("PLATFORM 07", "NIGHT SERVICE / CONDUCTOR ACCESS", -7.95, 3.58, 4.87, root);
    this.sign("RETURN REGISTER", "END OF PLATFORM / AUTHORIZED ACCESS", 8.1, 3.58, 4.87, root, true);
    for (let x = -10; x <= 10; x += .55) {
      const stencil = this.mesh("Platform edge stencil", [.29, .016, .14], [x, .018, 4.24], stencilPaint, root);
      stencil.rotation.y = -.38;
    }
  }

  private returnJunction(root: TransformNode) {
    const casing = this.material("Turnout casing", "#4a5a68");
    const timber = this.material("Dark sleepers", "#4d443a");
    const steel = this.material("Drawn rail", "#83999b", true);
    const lens = this.material("Turnout lamp", "#d4a25d");
    lens.emissiveColor = Color3.FromHexString("#b47937").scale(.65);
    for (let x = -9; x <= 9; x += .85) {
      this.mesh("Track sleeper", [.24, .08, .67], [x, .05, 4.98], timber, root);
    }
    for (const z of [4.75, 5.13]) {
      this.mesh("Running rail", [18.7, .07, .058], [0, .125, z], steel, root);
    }
    for (const z of [4.8, 4.97]) {
      const blade = this.mesh("Switch rail", [5.85, .065, .047], [2.12, .121, z], steel, root);
      blade.rotation.y = -.056;
    }
    this.mesh("Signal mast", [.19, 2.25, .23], [3.6, 1.14, 4.82], casing, root);
    this.mesh("Signal head", [.67, .72, .27], [3.6, 2.38, 4.82], casing, root);
    const lamp = MeshBuilder.CreateSphere("Signal lens", { diameter: .36, segments: 10 }, this.scene);
    lamp.parent = root; lamp.material = lens; lamp.scaling.z = .31; lamp.position.set(3.6, 2.42, 4.656);
    this.sign("RETURN JUNCTION", "SWITCHING GALLERY / LINE 07", -7.95, 3.02, 4.97, root);
    this.sign("SIGNAL 12", "RETURN ROUTE / MANUAL TURNOUT", 7.92, 1.62, 5.06, root, true);
  }

  private stationWall() {
    const material = this.material("Painted station wall", "#ffffff");
    if (material.diffuseTexture) return material;
    const texture = new DynamicTexture("Sealed concrete and enamel rails", { width: 256, height: 128 }, this.scene, true);
    const ctx = texture.getContext();
    const base = ctx.createLinearGradient(0, 0, 0, 128);
    base.addColorStop(0, "#596d80"); base.addColorStop(.22, "#96a6b4");
    base.addColorStop(.67, "#8294a1"); base.addColorStop(1, "#4c6779");
    ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 128);
    for (let bay = 0; bay < 8; bay++) {
      const x = bay * 32;
      ctx.fillStyle = "#b9c9cc21"; ctx.fillRect(x + 1, 0, 12 + bay * 2, 128);
      ctx.fillStyle = "#33495545"; ctx.fillRect(x, 0, 1, 128);
      ctx.fillStyle = "#bed2d341"; ctx.fillRect(x + 1, 27, 30, 1);
      ctx.fillStyle = "#2f4a5b36"; ctx.fillRect(x + 1, 100, 30, 1);
      for (const anchor of [x + 4, x + 27]) {
        ctx.fillStyle = "#49606a72"; ctx.fillRect(anchor, 95, 2, 2);
        ctx.fillStyle = "#d0dbd56b"; ctx.fillRect(anchor, 95, 2, 1);
      }
    }
    texture.update();
    material.diffuseTexture = texture;
    return material;
  }

  private stationGlass(cool: boolean) {
    const material = this.material(cool ? "Frosted teal glazing" : "Frosted amber glazing", "#ffffff", true);
    if (material.diffuseTexture) return material;
    const texture = new DynamicTexture("Painted safety glass", { width: 128, height: 64 }, this.scene, true);
    const ctx = texture.getContext();
    const glass = ctx.createLinearGradient(0, 0, 0, 64);
    glass.addColorStop(0, cool ? "#436b79" : "#9b623b");
    glass.addColorStop(.32, cool ? "#8bb9b8" : "#dca574");
    glass.addColorStop(.77, cool ? "#6fa7ab" : "#bd8351");
    glass.addColorStop(1, cool ? "#325966" : "#784a35");
    ctx.fillStyle = glass; ctx.fillRect(0, 0, 128, 64);
    const reflection = ctx.createLinearGradient(0, 0, 128, 0);
    reflection.addColorStop(0, "#fff2cc00"); reflection.addColorStop(.46, "#fff2cc29"); reflection.addColorStop(1, "#fff2cc00");
    ctx.fillStyle = reflection; ctx.fillRect(0, 12, 128, 34);
    for (const y of [7, 56]) { ctx.fillStyle = "#ffeed44a"; ctx.fillRect(0, y, 128, 1); }
    texture.update();
    material.diffuseTexture = texture;
    material.emissiveColor = cool ? new Color3(.042, .116, .12) : new Color3(.13, .077, .031);
    return material;
  }

  private setPlace(world: WorldView, markers: Marker[]) {
    const id = world.kind + world.mission + world.stage + (world.status === "lobby" ? "lobby" : "");
    if (this.place === id) return;
    this.place = id;
    const keepScenery = world.mission === "bellhouse" && this.missionScenery instanceof BellhouseScenery
      || world.mission === "annex" && this.missionScenery instanceof AnnexScenery
      || world.mission === "flood" && this.missionScenery instanceof FloodIndexScenery;
    if (!keepScenery) {
      this.scenery?.dispose();
      this.missionScenery?.dispose();
      this.missionScenery = undefined;
    }
    for (const label of this.labels.values()) label.remove();
    this.labels.clear();
    for (const marker of markers) {
      const label = makeLabel(this.layer, "point");
      label.textContent = marker.title;
      this.labels.set(marker.id, label);
    }
    if (keepScenery) return;
    const root = this.scenery = new TransformNode("District architecture", this.scene);
    if (world.mission === "flood") {
      this.missionScenery = new FloodIndexScenery(this.scene, root);
      return;
    }
    if (world.mission === "annex") {
      this.missionScenery = new AnnexScenery(this.scene, root);
      return;
    }
    if (world.mission === "bellhouse") {
      this.missionScenery = new BellhouseScenery(this.scene, root);
      return;
    }
    if (world.mission === "pump") {
      this.missionScenery = new PumpScenery(this.scene, root, markers);
      return;
    }
    if (world.mission === "lift") {
      this.missionScenery = new LiftScenery(this.scene, root, markers);
      return;
    }
    if (world.mission === "viaduct") {
      this.missionScenery = new ViaductScenery(this.scene, root, markers);
      return;
    }
    if (world.mission === "departure" || world.mission === "bayrelay") {
      this.missionScenery = new DepartureScenery(this.scene, root, markers, world.mission === "bayrelay");
      return;
    }
    if (world.mission === "archive" || world.mission === "exchange") {
      this.missionScenery = world.mission === "archive" ? new ArchiveScenery(this.scene, root, world.stage, markers)
        : new ExchangeScenery(this.scene, root, world.stage, markers);
      return;
    }
    const plaza = world.kind === "plaza";
    const night = world.mission === "night";
    const junction = world.mission === "return";
    const terminal = world.mission === "terminal" || world.mission === "watch";
    const relay = junction || terminal || world.stage === 1 || world.mission === "transformer";
    const panel = this.stationWall();
    const inset = this.material("inset", "#46586b");
    const beam = this.material("painted blue", "#4b647d");
    const darker = this.material("steel trim", "#364756");
    const counter = this.material("old ivory", "#b0a08a");
    const chrome = this.material("brushed hand rails", "#a0a6a0", true);
    const amber = this.material("amber windows", "#b67e4a");
    amber.emissiveColor = Color3.FromHexString("#865028").scale(.58);
    const cyan = this.material("cold display", "#72b7b3", true);
    cyan.emissiveColor = Color3.FromHexString("#4b928e").scale(.55);
    const tube = this.material("fixture tube", "#c4d6bc");
    tube.emissiveColor = Color3.FromHexString("#b2d7cc").scale(.75);
    const ground = this.material("tile " + (plaza ? "plaza" : night ? "night" : relay ? "relay" : "service"), "#ffffff");
    if (!ground.diffuseTexture) {
      const tex = new DynamicTexture("Hand-painted floor", { width: 512, height: 256 }, this.scene, true);
      const ctx = tex.getContext();
      const base = plaza ? [86, 120, 130] : night ? [109, 111, 102] : relay ? [71, 84, 104] : [88, 104, 122];
      ctx.fillStyle = "#354551"; ctx.fillRect(0, 0, 512, 256);
      for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
        const x = col * 64, y = row * 64;
        const v = (row * 17 + col * 13) % 13 - 6;
        const gradient = ctx.createLinearGradient(x, y, x + 64, y + 64);
        gradient.addColorStop(0, "rgb(" + base.map((n) => n + v + 7).join(",") + ")");
        gradient.addColorStop(1, "rgb(" + base.map((n) => n + v - 5).join(",") + ")");
        ctx.fillStyle = gradient; ctx.fillRect(x + 1, y + 1, 62, 62);
        ctx.fillStyle = "#dadccb36"; ctx.fillRect(x + 2, y + 2, 59, 1);
        ctx.fillStyle = "#29334656";
        for (const u of [5, 58]) for (const w of [5, 58]) ctx.fillRect(x + u, y + w, 2, 2);
        if ((row + col) % 5 === 1) {
          ctx.strokeStyle = plaza ? "#9ebcb880" : "#96a8b078"; ctx.lineWidth = 2;
          ctx.strokeRect(x + 13, y + 13, 38, 38);
          ctx.strokeRect(x + 24, y + 24, 16, 16);
        }
      }
      tex.update();
      ground.diffuseTexture = tex;
    }
    const floor = MeshBuilder.CreateGround("Tiled lane", { width: 36, height: 20 }, this.scene);
    floor.material = ground; floor.parent = root; floor.position.z = -3.7;
    this.mesh("Back wall", [26, 4.9, .4], [0, 2.45, 5.65], panel, root);
    this.mesh("Dark skirting", [26, .65, .23], [0, .34, 5.35], darker, root);
    this.mesh("Ceiling recess", [26, .46, .65], [0, 4.61, 5.38], inset, root);
    for (const x of [-10.8, -5.4, 0, 5.4, 10.8]) {
      this.mesh("Structural pier", [.39, 4.8, .67], [x, 2.4, 5.22], beam, root);
      this.mesh("Pier enamel band", [.42, .18, .69], [x, 1.18, 5.22], counter, root);
    }
    for (const x of [-8, -2.65, 2.65, 8.05]) {
      this.mesh("Window recess", [4.53, 2.18, .14], [x, 2.65, 5.34], darker, root);
      this.mesh("Colored safety glass", [4.29, 1.93, .15], [x, 2.65, 5.22], night ? inset : this.stationGlass(!plaza && relay), root);
      for (const dx of [-.76, .76]) this.mesh("Window divider", [.09, 1.93, .13], [x + dx, 2.65, 5.09], inset, root);
      this.mesh("Overhead light", [2.05, .117, .24], [x, 3.99, 5.09], tube, root);
      this.mesh("Safety rail", [3.82, .057, .067], [x, .89, 4.74], chrome, root);
      for (const dx of [-1.83, 0, 1.83]) this.mesh("Rail post", [.059, .91, .071], [x + dx, .45, 4.74], chrome, root);
    }
    if (night) this.nightPlatform(root);
    else if (junction) this.returnJunction(root);
    else if (terminal) {
      this.sign("EAST TERMINAL", world.mission === "watch" ? "NIGHT SERVICE WATCH" : "OUTBOUND AND RETURN READERS", -7.95, 3.02, 4.97, root);
      this.sign("TERMINAL CONTROL", world.mission === "watch" ? "PATROL AREA / LINE 07" : "MANIFEST ACCESS / LINE 07", 7.92, 1.62, 5.06, root, true);
    } else {
      this.sign(plaza ? "REPAIR PLAZA" : relay ? "LINE 07" : "SERVICE ENTRY",
        plaza ? "BOND REGISTRY / DISTRICT DISPATCH" : relay ? "SIGNAL AUTHORITY / PLATFORM SEALED" : "AUTHORIZED COURIERS / AUTUMN 2007",
        -7.95, 3.02, 4.97, root, relay);
      this.sign(plaza ? "DISTRICT TRANSIT" : "OUT OF SERVICE", plaza ? "SERVICE MAP / UPDATED 09.2007" : "CROSSING SUSPENDED / 17.10.1999",
        7.92, 1.62, 5.06, root, !plaza);
    }
    this.mesh("Circuit across the wall", [10, .05, .12], [2.5, 4.02, 4.93], chrome, root);
    const screenDark = this.material("CRT surround", "#304355");
    for (const x of night || junction ? [] : [-10.6, 2.1]) {
      this.mesh("Service equipment", [1.38, 1.35, .56], [x, .68, 4.97], darker, root);
      this.mesh("Service screen", [.93, .45, .07], [x, 1.04, 4.66], screenDark, root);
      this.mesh("Sparse readout", [.56, .04, .082], [x, 1.08, 4.61], cyan, root);
      this.mesh("Sparse readout", [.32, .025, .082], [x - .12, .97, 4.61], tube, root);
    }
    for (const marker of markers) {
      const terminalStatus = terminal ? this.material(marker.id + " station status", "#b67e4a") : undefined;
      const gate = marker.id === "advance" || marker.id === "signal";
      const base = gate ? [1.18, 2.17, .30] as const : marker.id === "plaque" ? [.53, .9, .42] as const
        : marker.id === "room" ? [.98, .57, .68] as const : terminal ? [1.34, .08, .78] as const : [1.36, .81, .62] as const;
      this.mesh(marker.id + " pedestal", [...base], [marker.x, base[1] / 2, marker.z], gate || terminal ? inset : counter, root);
      if (marker.id === "room") {
        const lounge = MeshBuilder.CreateSphere("Companion cushion", { diameter: 1.1, segments: 8 }, this.scene);
        lounge.scaling.set(1.02, .3, .73); lounge.position.set(marker.x, .59, marker.z);
        lounge.material = cyan; lounge.parent = root;
      } else {
        const display = terminalStatus ?? (marker.id === "plaque" || marker.id === "register" ? amber : cyan);
        this.mesh(marker.id + " glass", gate ? [1.06, .18, .33] : [base[0] * .78, .065, terminal ? .12 : .51],
          [marker.x, gate ? 1.65 : base[1] + .02, marker.z], display, root);
        if (terminal) {
          for (const side of [-1, 1]) {
            this.mesh(marker.id + " edge", [1.15, .024, .057], [marker.x, .082, marker.z + side * .32], chrome, root);
          }
        }
      }
      const ring = MeshBuilder.CreateTorus("Interaction locator", { diameter: 1.65, thickness: .035, tessellation: 24 }, this.scene);
      ring.parent = root; ring.material = terminalStatus ?? cyan; ring.position.set(marker.x, .031, marker.z);
    }
    const boundary = this.material("Lane edge", "#b3a687");
    this.mesh("Approach stripe", [25, .014, .07], [0, .011, -5.3], boundary, root);
    this.mesh("Safety stripe", [25, .012, .04], [0, .012, -5.52], boundary, root);
  }

  private instantiate(slot: ModelSlot) {
    return instantiateActorModel(this.scene, slot, this.models.get(slot)!);
  }

  private visual(actor: ViewActor) {
    const isPlayer = actor.kind === "player";
    const source = isPlayer ? "courier" : actor.kind === "skitter" || actor.kind === "keeper" || actor.kind === "runner" ? actor.kind : "guard";
    const body = this.instantiate(source);
    if (actor.kind === "dummy") body.node.scaling.setAll(1.18);
    const shadow = MeshBuilder.CreateDisc("Ground contact", { radius: isPlayer ? .43 : .58, tessellation: 13 }, this.scene);
    shadow.rotation.x = Math.PI / 2;
    shadow.position.y = .025;
    shadow.scaling.y = .68;
    const mat = this.material("Contact shadow", "#22303e");
    mat.alpha = .51; mat.disableLighting = true;
    shadow.material = mat;
    const label = makeLabel(this.layer);
    const labelText = document.createTextNode(actor.name);
    label.append(labelText);
    let bar: HTMLElement | undefined;
    if (!isPlayer) {
      const track = document.createElement("span");
      track.className = "enemy-fill";
      bar = document.createElement("i");
      track.append(bar); label.append(track);
    }
    const visual: Visual = { model: body, shadow, family: actor.family, at: new Vector3(actor.x, actor.y, actor.z), reaction: 0, held: 0, label, labelText, bar };
    if (isPlayer) this.setFamily(visual, actor.family);
    return visual;
  }

  private setFamily(visual: Visual, family: Family) {
    visual.creature?.dispose();
    visual.weapon?.dispose();
    visual.signalTag = undefined;
    visual.bayFourTicket = undefined;
    visual.relayPennant = undefined;
    visual.bellhouseSeal = undefined;
    if (visual.mothAnimation) {
      for (const name of ["torso", "head", "arm_near", "arm_far", "elbow_near", "elbow_far"]) {
        const joint = visual.model.parts.get(name);
        if (joint) joint.rotation.y = 0;
      }
    }
    visual.family = family;
    visual.creature = this.instantiate(family);
    visual.weapon = this.instantiate(`${family}-weapon`);
    visual.weapon.node.parent = visual.model.weaponSocket ?? visual.model.node;
    visual.mothAnimation = family === "moth" ? new MothAnimation(visual.model, visual.creature, visual.weapon) : undefined;
  }

  private makeSignalTag(parent: TransformNode) {
    const tag = new TransformNode("Signal Tag keepsake", this.scene);
    tag.parent = parent;
    tag.position.set(-.22, -.11, -.39);
    tag.rotation.z = -.24;
    const brass = this.material("Signal Tag brass", "#c39758", true);
    const ring = MeshBuilder.CreateTorus("Signal Tag loop", { diameter: .11, thickness: .022, tessellation: 10 }, this.scene);
    ring.rotation.x = Math.PI / 2;
    ring.material = brass;
    ring.parent = tag;
    const badge = MeshBuilder.CreateCylinder("Signal Tag enamel", { height: .044, diameter: .26, tessellation: 6 }, this.scene);
    badge.rotation.x = Math.PI / 2;
    badge.position.y = -.135;
    const enamel = this.material("Signal Tag blue enamel", "#4b9b9e", true);
    enamel.emissiveColor.set(.05, .18, .19);
    badge.material = enamel;
    badge.parent = tag;
    this.mesh("Signal Tag contact", [.14, .027, .02], [0, -.12, -.028], brass, tag);
    this.mesh("Signal Tag contact", [.085, .027, .02], [0, -.169, -.028], brass, tag);
    return tag;
  }

  private makeBayFourTicket(parent: TransformNode) {
    const ticket = new TransformNode("Bay 4 punched ticket keepsake", this.scene);
    ticket.parent = parent;
    ticket.position.set(-.12, -.11, -.46);
    ticket.rotation.set(.22, 0, -.28);
    const card = this.material("Bay 4 pale card", "#e7d8ad");
    card.emissiveColor.set(.13, .1, .046);
    const ink = this.material("Bay 4 transfer print", "#638982");
    const outline = [[-.17, .13], [.167, .13], [.193, .10], [.193, -.109], [.157, -.14],
      [-.164, -.14], [-.192, -.11], [-.192, .102]];
    const punched = [.095, .051];
    const positions: number[] = [];
    const indices: number[] = [];
    for (const [x, y] of outline) {
      const dx = x - punched[0], dy = y - punched[1];
      const cut = .046 / Math.hypot(dx, dy);
      for (const z of [-.014, .014]) positions.push(x, y, z, punched[0] + dx * cut, punched[1] + dy * cut, z);
    }
    for (let point = 0; point < outline.length; point++) {
      const a = point * 4, b = ((point + 1) % outline.length) * 4;
      indices.push(a, a + 1, b, b, a + 1, b + 1, a + 2, b + 2, a + 3, b + 2, b + 3, a + 3,
        a, b, a + 2, b, b + 2, a + 2, a + 1, a + 3, b + 1, b + 1, a + 3, b + 3);
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData();
    data.positions = positions; data.indices = indices; data.normals = normals;
    const cardMesh = new Mesh("Clipped fare ticket with punched hole", this.scene);
    data.applyToMesh(cardMesh);
    cardMesh.parent = ticket; cardMesh.material = card;
    for (const z of [-.016, .016]) {
      this.mesh("Bay 4 printed stripe", [.31, .043, .004], [0, -.084, z], ink, ticket);
      this.mesh("Bay 4 printed fare code", [.092, .021, .004], [-.088, .052, z], ink, ticket);
    }
    return ticket;
  }

  private makeRelayPennant(parent: TransformNode) {
    const pennant = new TransformNode("Bay Four Relay Pennant keepsake", this.scene);
    pennant.parent = parent;
    pennant.position.set(-.18, -.01, -.485);
    pennant.rotation.set(.16, 0, -.19);
    const orange = this.material("Pennant signal orange canvas", "#d98446");
    orange.backFaceCulling = false;
    orange.emissiveColor.set(.20, .065, .018);
    const blue = this.material("Pennant cobalt print", "#3153a4");
    blue.backFaceCulling = false;
    blue.emissiveColor.set(.063, .078, .23);
    const patch = (name: string, positions: number[], indices: number[], material: StandardMaterial) => {
      const normals: number[] = [];
      VertexData.ComputeNormals(positions, indices, normals);
      const data = new VertexData();
      data.positions = positions; data.indices = indices; data.normals = normals;
      const mesh = new Mesh(name, this.scene);
      data.applyToMesh(mesh);
      mesh.parent = pennant; mesh.material = material;
    };
    patch("Folded pennant cloth", [-.22, .146, 0, -.22, -.135, 0, -.023, .092, -.031, -.023, -.082, -.031, .30, .015, .034],
      [0, 1, 2, 1, 3, 2, 2, 3, 4], orange);
    patch("Cobalt double pennant bars", [-.19, .137, -.013, -.136, .122, -.021, -.136, -.113, -.021, -.19, -.128, -.013,
      -.092, .111, -.028, -.057, .10, -.033, -.057, -.092, -.033, -.092, -.101, -.028], [0, 3, 1, 1, 3, 2, 4, 7, 5, 5, 7, 6], blue);
    this.mesh("Pennant hoist seam", [.031, .288, .022], [-.226, .006, -.007], blue, pennant);
    const braid = this.material("Pennant signal braid", "#8b6b48");
    this.mesh("Pennant tie", [.035, .218, .025], [-.226, .233, .01], braid, pennant).rotation.z = .06;
    this.mesh("Pennant clasp", [.071, .068, .049], [-.23, .347, .03], orange, pennant);
    return pennant;
  }

  private makeBellhouseSeal(parent: TransformNode) {
    const seal = new TransformNode("Bellhouse three-stamp keepsake", this.scene);
    seal.parent = parent;
    seal.position.set(-.18, .24, -.44);
    seal.rotation.z = -.23;
    const brass = this.material("Bellhouse burnished brass", "#d8b46e", true);
    const lacquer = this.material("Bellhouse plum lacquer", "#904c68", true);
    const disc = (name: string, diameter: number, thickness: number, x: number, y: number, z: number, tint: StandardMaterial) => {
      const mesh = MeshBuilder.CreateCylinder(name, { diameter, height: thickness, tessellation: 8 }, this.scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, y, z);
      mesh.parent = seal; mesh.material = tint;
    };
    const eye = MeshBuilder.CreateTorus("Seal brass cord loop", { diameter: .122, thickness: .026, tessellation: 10 }, this.scene);
    eye.rotation.x = Math.PI / 2;
    eye.parent = seal; eye.material = brass;
    const cord = MeshBuilder.CreateTube("Bellhouse seal braided cord", {
      path: [new Vector3(0, .046, .007), new Vector3(-.026, .128, .089), new Vector3(-.053, .228, .17)],
      radius: .019, tessellation: 5,
    }, this.scene);
    cord.parent = seal; cord.material = lacquer;
    disc("Bellhouse seal stamped edge", .35, .055, 0, -.187, 0, brass);
    disc("Bellhouse seal lacquer face", .29, .017, 0, -.187, -.034, lacquer);
    for (const [x, y] of [[-.088, -.16], [0, -.225], [.088, -.16]]) {
      disc("Bellhouse partner's stamp", .062, .014, x, y, -.048, brass);
    }
    return seal;
  }

  private project(label: HTMLDivElement, position: Vector3) {
    const result = Vector3.Project(position, Matrix.IdentityReadOnly, this.scene.getTransformMatrix(),
      this.camera.viewport.toGlobal(this.canvas.clientWidth, this.canvas.clientHeight));
    label.style.left = result.x + "px"; label.style.top = result.y + "px";
    label.style.visibility = result.z > 0 && result.z < 1 ? "visible" : "hidden";
  }

  private showLungeLane(source: string, x: number, z: number, endX: number, endZ: number) {
    const direction = Math.atan2(endZ - z, endX - x);
    const positions: number[] = [];
    const indices: number[] = [];
    for (const [cx, cz, angle] of [[x, z, direction + Math.PI / 2], [endX, endZ, direction - Math.PI / 2]]) {
      for (let segment = 0; segment <= 8; segment++) {
        const a = angle + Math.PI * segment / 8;
        for (const radius of [RUNNER_HIT_RADIUS, RUNNER_HIT_RADIUS - .074]) {
          positions.push(cx + Math.cos(a) * radius, .044, cz + Math.sin(a) * radius);
        }
      }
    }
    const vertices = positions.length / 3;
    for (let outer = 0; outer < vertices; outer += 2) {
      const next = (outer + 2) % vertices;
      indices.push(outer, outer + 1, next, outer + 1, next + 1, next);
    }
    const lane = new Mesh("Locked runner lane", this.scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.applyToMesh(lane);
    const material = new StandardMaterial("Runner warning enamel", this.scene);
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.emissiveColor.set(1, .55, .21);
    material.alpha = .87;
    lane.material = material;
    this.effects.push({ mesh: lane, material, position: Vector3.Zero(), time: 0,
      lasts: ENEMY_WINDUP_TICKS.runner / TICK_RATE, fadeAt: .85, warningSource: source });
  }

  react(event: CombatEvent) {
    if (event.type === "interrupt") {
      for (const effect of this.effects) {
        if (effect.warningSource === event.source) effect.time = effect.lasts;
      }
      return;
    }
    if (event.type === "observe" || event.type === "arm" || event.type === "revive") {
      const visual = this.visuals.get(event.source);
      if (visual) visual.reaction = 1;
      if (event.type === "revive") {
        const label = makeLabel(this.layer, "revived");
        label.textContent = "Rescued";
        this.effects.push({ label, position: new Vector3(event.x, 1.12, event.z), time: 0, lasts: 1.1 });
      }
      return;
    }
    if (event.type === "hit") {
      for (const id of [event.source, event.target]) {
        const target = id && this.visuals.get(id);
        if (target) target.held = event.heavy ? .06 : .04;
      }
      if (!this.star) {
        const tex = this.star = new DynamicTexture("Strike star", 64, this.scene, false);
        tex.hasAlpha = true;
        const ctx = tex.getContext();
        ctx.clearRect(0, 0, 64, 64);
        ctx.fillStyle = "#fff3cc";
        ctx.beginPath();
        for (let n = 0; n < 16; n++) {
          const angle = n * Math.PI / 8, radius = n % 2 ? 8 : n % 4 ? 23 : 30;
          const x = 32 + Math.cos(angle) * radius, y = 32 + Math.sin(angle) * radius;
          if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill(); tex.update();
      }
      const mat = new StandardMaterial("Contact flash", this.scene);
      mat.diffuseTexture = this.star; mat.opacityTexture = this.star;
      mat.emissiveColor = new Color3(1, .9, .71); mat.disableLighting = true; mat.backFaceCulling = false;
      const flash = MeshBuilder.CreatePlane("Contact flash", { size: event.heavy ? 1.17 : .88 }, this.scene);
      flash.billboardMode = Mesh.BILLBOARDMODE_ALL;
      flash.position.set(event.x, .72, event.z - .12); flash.material = mat;
      this.effects.push({ mesh: flash, material: mat, position: flash.position.clone(), time: 0, lasts: .135 });
      const number = makeLabel(this.layer, "damage"); number.textContent = String(event.damage ?? 0);
      this.effects.push({ label: number, position: new Vector3(event.x, 1.42, event.z), time: 0, lasts: .52 });
      return;
    }
    if (event.lunge) {
      if (event.type === "windup") this.showLungeLane(event.source, event.x, event.z, event.lunge.x, event.lunge.z);
      return;
    }
    if (event.type !== "swing" && event.type !== "windup") return;
    const actor = this.visuals.get(event.source);
    if (!actor) return;
    const windup = event.type === "windup";
    const radius = event.heavy ? 2.45 : 1.78;
    const faces = [[], []] as Vector3[][];
    const facing = Math.abs(actor.model.node.rotation.y) < 1 ? 1 : -1;
    for (let i = 0; i <= 18; i++) {
      const arc = (i / 18 - .53) * (windup ? 2.35 : 2.85);
      const inner = radius - Math.sin(i / 18 * Math.PI) * (windup ? .14 : .46);
      for (const [j, r] of [radius, inner].entries()) {
        faces[j].push(new Vector3(event.x + Math.cos(arc) * r * facing, windup ? .041 : .88 + Math.sin(arc) * .28, event.z + Math.sin(arc) * r * .69));
      }
    }
    const ribbon = MeshBuilder.CreateRibbon(event.type, { pathArray: faces, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    const mat = new StandardMaterial("Signal effect", this.scene);
    mat.emissiveColor = windup ? new Color3(1, .51, .24) : new Color3(.83, .96, .9);
    mat.disableLighting = true; mat.alpha = windup ? .76 : .42;
    ribbon.material = mat;
    this.effects.push({ mesh: ribbon, material: mat, position: Vector3.Zero(), time: 0, lasts: windup ? .61 : .18,
      warningSource: windup ? event.source : undefined });
  }

  private poseRunner(parts: Map<string, TransformNode>, actor: ViewActor) {
    const draw = actor.phase === "windup" ? Math.max(0, 1 - actor.age / ENEMY_WINDUP_TICKS.runner) : 0;
    const coil = draw * draw * (3 - 2 * draw);
    const run = actor.phase === "active" ? Math.min(1, actor.age / 4) * Math.min(1, (RUNNER_LUNGE_TICKS + 1 - actor.age) / 2) : 0;
    const recovery = actor.phase === "recover" ? Math.min(1, actor.age / 40) : 0;
    const gait = actor.moving ? Math.sin(this.clock * 13.5) : 0;
    const limbBeat = Math.sin(this.clock * 5) * .028;
    const torso = parts.get("organism");
    if (torso) {
      const pose = torso.metadata ??= {};
      pose.restHeight ??= torso.position.y;
      torso.position.y = pose.restHeight - coil * .11 + run * .055 - recovery * .10 + Math.abs(gait) * .075;
      torso.rotation.z = .29 * coil - .43 * run - .20 * recovery + gait * .075;
    }
    for (const [suffix, side] of [["near", 1], ["far", -1]] as const) {
      parts.get("leg_" + suffix)?.rotation.set(0, 0, side * gait * .57 - .30 * coil + side * (.10 * coil + .68 * run) + .23 * recovery);
      parts.get("plate_" + suffix)?.rotation.set(side * (limbBeat - .93 * coil + .29 * run), 0, -.12 * coil + .26 * recovery);
      parts.get("claw_" + suffix)?.rotation.set(0, side * (.12 + .46 * coil - .36 * run + .095 * recovery), -.11 * coil + .22 * run);
    }
  }

  private pose(visual: Visual, actor: ViewActor, dt: number, rescueTarget?: ViewActor) {
    if (visual.held > 0) { visual.held -= dt; if (visual.held > 0) return; }
    const body = visual.model.node;
    const t = this.clock;
    body.rotation.y = actor.facing < 0 ? Math.PI : 0;
    visual.model.animation?.pose(actor, dt);
    if (visual.mothAnimation) {
      visual.mothAnimation.pose(actor, t, dt, visual.reaction, rescueTarget);
      visual.reaction = Math.max(0, visual.reaction - dt * .9);
      return;
    }
    const isPlayer = actor.kind === "player";
    const parts = visual.model.parts;
    const move = ["attack", "air", "skill", "mastery"].includes(actor.phase);
    const progress = Math.max(0, Math.min(1, actor.age / Math.max(1, actor.duration)));
    const family = FORMS[actor.family];
    const wind = move && isPlayer ? actor.phase === "skill" ? family.skill.startup
      : actor.phase === "mastery" ? family.mastery.startup : actor.phase === "air" ? family.air.startup : family.chain[actor.step].startup : 0;
    const active = actor.age >= wind;
    const hitPose = move ? active ? 1 - Math.pow(progress, 1.6) * .44 : -.38 * (actor.age / Math.max(1, wind)) : 0;
    const walk = actor.moving ? Math.sin(t * (isPlayer ? 12 : 8)) : 0;
    if (!visual.model.animation) {
      body.rotation.z = actor.phase === "down" ? -.97 : actor.phase === "hurt" ? -.14 : actor.phase === "dodge" ? .33 : hitPose * .17;
      body.position.y = visual.at.y + (actor.moving ? Math.abs(Math.sin(t * 12)) * .054 : 0);
    }
    const set = (part: string, x: number, z: number) => {
      const node = parts.get(part);
      if (node) { node.rotation.x = x; node.rotation.z = z; }
    };
    if (isPlayer) {
      const styles = { moth: 1.18, brick: .85, heron: 1.42, boar: 1.72 };
      const accent = move ? hitPose * styles[actor.family] : 0;
      const side = actor.step === 1 ? -1 : 1;
      set("torso", move ? side * accent * .19 : .018 * Math.sin(t * 3), accent * .13);
      set("head", 0, actor.phase === "arm" || rescueTarget ? .24 : -.04);
      set("arm_near", move ? -side * accent * .25 : walk * .36, move ? accent + .42 : rescueTarget ? .96 : actor.armed ? .49 : -.17);
      set("arm_far", move ? side * accent * .29 : -walk * .36, move ? .53 + accent * .65 : rescueTarget ? .61 : actor.armed ? .34 : .12);
      set("elbow_near", 0, move ? .73 + accent * .15 : .29);
      set("elbow_far", 0, move ? .67 : .34);
      set("leg_near", 0, walk * .46 + (actor.y > .18 ? .36 : move ? .19 : .04));
      set("leg_far", 0, -walk * .46 - (move ? .32 : .05));
      set("knee_near", 0, -.1 - Math.max(0, walk) * .45 - (actor.y > .18 ? .49 : 0));
      set("knee_far", 0, -.1 + Math.min(0, walk) * .45);
      const creature = visual.creature!;
      const weapon = visual.weapon!;
      const fold = actor.phase === "arm" ? progress : actor.phase === "recall" ? 1 - progress : actor.armed ? 1 : 0;
      const follow = new Vector3(visual.at.x - actor.facing * 1.0, visual.at.y + .29 + Math.sin(t * 4.7) * .085, visual.at.z -.62);
      const point = new Vector3(visual.at.x + actor.facing * .45, visual.at.y + 1.17, visual.at.z -.11);
      creature.node.setEnabled(fold < .87 && actor.hp > 0);
      creature.node.position.copyFrom(Vector3.Lerp(follow, point, fold));
      if (rescueTarget) {
        const approach = Math.min(1, actor.rescueTicks / 18);
        const shelter = new Vector3(rescueTarget.x, rescueTarget.y + .44 + Math.sin(t * 13) * .07, rescueTarget.z - .34);
        creature.node.position.copyFrom(Vector3.Lerp(follow, shelter, approach));
      }
      creature.node.scaling.setAll(mix(.9, .22, fold));
      creature.node.rotation.y = body.rotation.y;
      creature.node.rotation.z = .14 * Math.sin(t * 3.8) - fold * .45 + visual.reaction * .24;
      visual.reaction = Math.max(0, visual.reaction - dt * .9);
      for (const [part, side] of [["plate_near", -1], ["plate_far", 1]] as const) {
        const node = creature.parts.get(part);
        if (node) node.rotation.x = side * (Math.sin(t * 8) * .32 + fold * 1.47);
      }
      const organ = creature.parts.get("pulse_core");
      if (organ) {
        const beat = (t * .64) % 1;
        const pulse = Math.max(0, 1 - Math.abs(beat - .15) * 17) + Math.max(0, .75 - Math.abs(beat - .31) * 14);
        const datum = organ.metadata ??= {};
        datum.baseScale ??= organ.scaling.clone();
        const rescuePulse = rescueTarget ? .33 + .19 * Math.sin(t * 15) : 0;
        organ.scaling.copyFrom(datum.baseScale).scaleInPlace(1 + .24 * pulse + .12 * visual.reaction + rescuePulse);
      }
      weapon.node.setEnabled(fold > .21 && actor.hp > 0);
      weapon.node.scaling.setAll(Math.max(.1, fold));
      if (!visual.model.weaponSocket) {
        weapon.node.position.set(.39 + Math.max(0, hitPose) * .32, 1.12 + (actor.phase === "skill" && actor.family === "moth" ? .36 : 0), -.21);
        weapon.node.rotation.set(actor.phase === "mastery" ? progress * 1.75 : 0, move ? side * (progress - .39) * 1.7 : -.35,
          move ? accent * side * .54 - .24 : Math.sin(t * 3) * .055 + .22);
      }
    } else if (actor.kind === "runner") {
      this.poseRunner(parts, actor);
    } else {
      const crawler = actor.kind === "skitter";
      const keeper = actor.kind === "keeper";
      const windup = ENEMY_WINDUP_TICKS[keeper ? "keeper" : crawler ? "skitter" : "guard"];
      const draw = actor.phase === "windup" ? Math.min(1, 1 - actor.age / windup) ** .76 : 0;
      const release = actor.phase === "active" ? Math.min(actor.age / 3, 1) : 0;
      const settling = actor.phase === "recover" ? Math.min(actor.age / 40, 1) : 0;
      const recoil = actor.phase === "hurt" ? Math.min(actor.age / 11, 1) : 0;
      const sway = Math.sin(t * (crawler ? 8 : 4));
      set("organism", 0, sway * .046 + draw * (crawler ? .34 : .28) - release * .36 - settling * .21 + recoil * .25);
      for (const [suffix, side] of [["near", -1], ["far", 1]] as const) {
        const leg = walk * side;
        set("leg_" + suffix, leg * .12, leg * (crawler ? .21 : .32) - draw * side * .1);
        const wing = (crawler ? .31 : keeper ? .48 : -.52) * draw;
        set("plate_" + suffix, side * (sway * .035 + wing + release * .21), draw * .14 - release * .28);
        const claw = parts.get("claw_" + suffix);
        if (claw) {
          const angle = crawler ? -.32 : keeper ? .98 : .52;
          claw.rotation.set(side * draw * .13, side * (draw * .45 - release * .28),
            draw * angle - release * .33 - settling * .16 + sway * .06);
        }
      }
    }
  }

  render(world: WorldView | undefined, markers: Marker[], self: string | undefined) {
    const dt = Math.min(.07, this.engine.getDeltaTime() / 1000);
    this.clock += dt;
    if (world) {
      const local = self && world.actors.get(self);
      const focus = local ? Math.max(-2.45, Math.min(2.45, local.x * .38)) : 0;
      this.camera.position.x += (focus + .4 - this.camera.position.x) * (1 - Math.exp(-dt * 4));
      this.camera.setTarget(new Vector3(this.camera.position.x - .4, .7, -.29));
      this.setPlace(world, markers);
      if (!(this.missionScenery instanceof AnnexScenery)) this.missionScenery?.update(world, this.clock);
      const junctionLamp = world.mission === "return" ? this.palette.get("Turnout lamp") : undefined;
      if (junctionLamp) {
        const routeClear = world.wave === 1 && (world.status === "signal" || world.status === "complete");
        if (routeClear) {
          junctionLamp.diffuseColor.set(.48, .83, .67);
          junctionLamp.emissiveColor.set(.16, .59, .41);
        } else {
          junctionLamp.diffuseColor.set(.83, .64, .36);
          junctionLamp.emissiveColor.set(.46, .31, .14);
        }
      }
      if (world.mission === "terminal") {
        for (const { id, readerBit } of markers) {
          const station = this.palette.get(id + " station status");
          if (!station) continue;
          const active = readerBit ? !!(world.readerMask & readerBit)
            : world.readerMask === TERMINAL_READERS_COMPLETE && (world.status === "signal" || world.status === "complete");
          if (active) {
            station.diffuseColor.set(.48, .83, .67);
            station.emissiveColor.set(.16, .59, .41);
          } else {
            station.diffuseColor.set(.83, .64, .36);
            station.emissiveColor.set(.46, .31, .14);
          }
        }
      }
      for (const [id, visual] of this.visuals) if (!world.actors.has(id)) {
        visual.weapon?.dispose(); visual.model.dispose(); visual.creature?.dispose(); visual.shadow.dispose(); visual.label.remove();
        this.visuals.delete(id);
      }
      for (const [id, actor] of world.actors) {
        let visual = this.visuals.get(id);
        if (!visual) { visual = this.visual(actor); this.visuals.set(id, visual); }
        if (actor.kind === "player" && visual.family !== actor.family) this.setFamily(visual, actor.family);
        if (actor.signalTag && visual.creature && !visual.signalTag) visual.signalTag = this.makeSignalTag(visual.creature.node);
        visual.signalTag?.setEnabled(actor.signalTag);
        if (actor.bayFourTicket && visual.creature && !visual.bayFourTicket) visual.bayFourTicket = this.makeBayFourTicket(visual.creature.node);
        if (visual.bayFourTicket) {
          visual.bayFourTicket.setEnabled(actor.bayFourTicket);
          visual.bayFourTicket.position.z = actor.facing < 0 ? .46 : -.46;
          visual.bayFourTicket.rotation.y = actor.facing < 0 ? Math.PI : 0;
        }
        if (actor.relayPennant && visual.creature && !visual.relayPennant) visual.relayPennant = this.makeRelayPennant(visual.creature.node);
        if (visual.relayPennant) {
          visual.relayPennant.setEnabled(actor.relayPennant);
          visual.relayPennant.position.z = actor.facing < 0 ? .485 : -.485;
          visual.relayPennant.rotation.y = actor.facing < 0 ? Math.PI : 0;
        }
        if (actor.bellhouseSeal && visual.creature && !visual.bellhouseSeal) visual.bellhouseSeal = this.makeBellhouseSeal(visual.creature.node);
        if (visual.bellhouseSeal) {
          visual.bellhouseSeal.setEnabled(actor.bellhouseSeal);
          visual.bellhouseSeal.position.z = actor.facing < 0 ? .44 : -.44;
          visual.bellhouseSeal.rotation.y = actor.facing < 0 ? Math.PI : 0;
        }
        const target = new Vector3(actor.x, actor.y, actor.z);
        const factor = Vector3.DistanceSquared(target, visual.at) > 14 ? 1 : 1 - Math.exp(-dt * (id === self ? 34 : 13));
        Vector3.LerpToRef(visual.at, target, factor, visual.at);
        visual.model.node.position.copyFrom(visual.at);
        visual.shadow.position.x = visual.at.x; visual.shadow.position.z = visual.at.z;
        visual.shadow.isVisible = actor.hp > 0;
        this.pose(visual, actor, dt, world.actors.get(actor.rescueTarget));
        if (visual.creature && world.indexScans?.size) {
          const bank = FLOOD_INDEX_BANKS.find((point) => world.indexScans?.get(point.id)?.courier === id);
          const scan = bank && world.indexScans.get(bank.id);
          if (bank && scan) {
            const reach = Math.max(0, Math.min(1, (FLOOD_SCAN_TICKS - scan.until + world.frame) / 18));
            const creature = visual.creature.node;
            const target = new Vector3(bank.x - .38, .68 + Math.sin(this.clock * 9) * .045, bank.z - .33);
            Vector3.LerpToRef(creature.position, target, reach, creature.position);
          }
        }
        const downed = world.kind === "mission" && actor.kind === "player" && !actor.hp;
        visual.label.hidden = (id === self && world.kind === "mission") || (!actor.hp && !downed);
        visual.label.classList.toggle("downed", downed);
        if (!visual.label.hidden) {
          const status = !actor.connected ? " • reconnecting" : downed ? " • downed" : "";
          visual.labelText.data = actor.name + status;
          if (visual.bar) visual.bar.style.width = Math.max(0, actor.hp / actor.maxHp * 100) + "%";
          const labelHeight = downed ? .88 : actor.kind === "player" || actor.kind === "keeper" ? 2.06 : actor.kind === "runner" ? 1.79 : 1.34;
          this.project(visual.label, new Vector3(visual.at.x, visual.at.y + labelHeight, visual.at.z));
        }
      }
      if (this.missionScenery instanceof AnnexScenery) {
        const carrier = world.rosterCase?.carrier;
        this.missionScenery.update(world, carrier ? this.visuals.get(carrier)?.at : undefined);
      }
      for (const point of markers) {
        const label = this.labels.get(point.id);
        const height = point.id === "advance" || point.id === "signal" ? 2.48 : world.mission === "terminal" ? .66 : 1.33;
        if (label) this.project(label, new Vector3(point.x, height, point.z));
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.time += dt;
      if (effect.time >= effect.lasts) {
        effect.label?.remove(); effect.mesh?.dispose(); effect.material?.dispose();
        this.effects.splice(i, 1);
      } else if (effect.label) {
        const amount = effect.time / effect.lasts;
        effect.label.style.opacity = String(1 - amount * .7);
        this.project(effect.label, effect.position.add(new Vector3(0, amount * .65, 0)));
      } else if (effect.material && effect.time > effect.lasts * (effect.fadeAt ?? .45)) {
        effect.material.alpha *= Math.max(.42, 1 - dt * 11);
      }
    }
    this.scene.render();
  }
}
