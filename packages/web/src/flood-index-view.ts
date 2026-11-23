import { Color3, DynamicTexture, MeshBuilder, StandardMaterial, type Mesh, type Scene, type TransformNode } from "@babylonjs/core";
import { FLOOD_FOLIO, FLOOD_INDEX_BANKS, FLOOD_SCAN_TICKS, type Marker } from "../../shared/src/scene.ts";
import type { WorldView } from "./view.ts";

const readerPaint = {
  hold: { field: "#343e4a", ink: "#b5bec4", light: "#747c86" },
  ready: { field: "#504937", ink: "#f6e4a8", light: "#d2a760" },
  reading: { field: "#214b6c", ink: "#ddf7fb", light: "#86c9ea" },
  saved: { field: "#345348", ink: "#dfefb7", light: "#a6ca7b" },
};
type ReaderState = keyof typeof readerPaint;
interface Reader {
  id: string;
  name: string;
  bit: number;
  screen: DynamicTexture;
  bulb: StandardMaterial;
  card: Mesh;
  dockingZ: number;
  last?: string;
}

export class FloodIndexScenery {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly materials: StandardMaterial[] = [];
  private readonly readers: Reader[] = [];
  private readonly board: DynamicTexture;
  private readonly folioPanel: DynamicTexture;
  private readonly folioBulb: StandardMaterial;
  private lastBoard = "";
  private lastFolio = "";

  constructor(scene: Scene, root: TransformNode) {
    this.scene = scene;
    this.root = root;
    const enamel = this.material("Flood Index blue enamel", "#58778b");
    const pale = this.material("Flood Index white concrete", "#a7b1af");
    const cast = this.material("Sealed stack iron", "#3f4d5d");
    const nickel = this.material("Flood Index old nickel", "#8c9991");
    const paper = this.material("Index card ivory", "#cfbc89");
    this.buildHall(enamel, pale, cast, nickel);
    this.buildRacks(enamel, cast, nickel, paper);
    for (const marker of FLOOD_INDEX_BANKS) this.readers.push(this.makeReader(marker, enamel, cast, paper));

    const panel = this.paint("Folio inspection display", 128, 64, true);
    this.folioPanel = panel.texture;
    this.folioBulb = this.material("Folio glass latch", readerPaint.hold.light);
    const { x, z, id } = FLOOD_FOLIO;
    this.box("Recovery folio pedestal", 1.26, .52, .62, x, .275, z + .18, enamel);
    this.box("Recovery folio tray", 1.39, .11, .67, x, .57, z + .16, cast).rotation.x = -.10;
    this.box("Folded flood index folio", .59, .055, .32, x + .07, .65, z + .20, paper).rotation.y = .18;
    for (const dx of [-.09, .21]) this.box("Stamped folio grid", .15, .008, .17, x + dx, .681, z + .15, nickel).rotation.y = .18;
    this.box("Folio lamp slot", .86, .075, .058, x, .326, z - .146, this.folioBulb);
    this.face("Folio access card", 1.47, .39, x, .492, z - .254, panel.material).rotation.x = .53;
    this.ring(id, x, z, this.folioBulb);

    const board = this.paint("Flood Index collector board", 512, 96, true);
    this.board = board.texture;
    this.box("Flood Index fascia frame", 12.18, 1.24, .25, 0, 4.21, 4.90, cast);
    this.face("Flood Index fascia lettering", 11.95, 1.11, 0, 4.21, 4.761, board.material);
  }

  private material(name: string, tint: string) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(tint);
    material.specularColor.set(.105, .13, .15);
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

  private box(name: string, width: number, height: number, depth: number, x: number, y: number, z: number, material: StandardMaterial) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    mesh.parent = this.root; mesh.position.set(x, y, z); mesh.material = material;
    return mesh;
  }

  private face(name: string, width: number, height: number, x: number, y: number, z: number, material: StandardMaterial) {
    const mesh = MeshBuilder.CreatePlane(name, { width, height }, this.scene);
    mesh.parent = this.root; mesh.position.set(x, y, z); mesh.material = material;
    return mesh;
  }

  private buildHall(enamel: StandardMaterial, pale: StandardMaterial, cast: StandardMaterial, nickel: StandardMaterial) {
    this.box("Flood containment wall", 29.3, 6.27, .32, 0, 3.08, 6.05, pale);
    this.box("Blue stack wainscot", 29.31, 1.31, .13, 0, .718, 5.82, enamel);
    this.box("Stack threshold skirting", 29.36, .17, .21, 0, .109, 5.76, cast);
    for (const x of [-12, -5, 5, 12]) {
      this.box("Stack fire break pilaster", .34, 5.84, .38, x, 2.91, 5.72, enamel);
      this.box("Blue enamel nickel highlight", .077, 5.06, .055, x, 2.86, 5.504, nickel);
    }
    this.box("Sealed lower stack gate reveal", 7.85, 3.06, .49, 0, 1.66, 5.52, cast);
    this.box("Sealed gate face", 7.48, 2.76, .14, 0, 1.64, 5.215, enamel);
    for (let x = -3.60; x < 3.80; x += .33) this.box("Stack roll shutter rebated rib", .085, 2.68, .06, x, 1.66, 5.113, cast);
    this.box("Roll shutter upper lock beam", 7.55, .17, .15, 0, 2.18, 5.035, nickel);
    this.box("Roll shutter lower lock beam", 7.55, .15, .13, 0, .90, 5.048, nickel);
    this.box("Mortised stack latch", .69, .56, .22, 0, 1.56, 4.995, cast);
    this.box("Lock latch nickel plate", .29, .35, .06, 0, 1.56, 4.85, nickel);
    const gate = this.paint("Lower stack restriction stencil", 256, 48, true);
    gate.ctx.fillStyle = "#3b4960"; gate.ctx.fillRect(0, 0, 256, 48);
    gate.ctx.strokeStyle = "#9faea8"; gate.ctx.strokeRect(3, 3, 250, 42);
    gate.ctx.fillStyle = "#e7d8af"; gate.ctx.font = "bold 15px Tahoma";
    gate.ctx.fillText("LOWER STACKS  /  SEALED", 15, 30, 226);
    gate.texture.update();
    this.face("Lower stacks seal plate", 4.6, .52, 0, 2.665, 5.062, gate.material);

    const { material, texture, ctx } = this.paint("Flood index glazed floor", 512, 256);
    ctx.fillStyle = "#54616a"; ctx.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
      const x = col * 64, y = row * 64;
      const glaze = ctx.createLinearGradient(x, y, x + 32, y + 64);
      glaze.addColorStop(0, (row + col) % 2 ? "#82929b" : "#8d9b9d"); glaze.addColorStop(1, "#687a8a");
      ctx.fillStyle = glaze; ctx.fillRect(x + 1, y + 1, 62, 62);
      ctx.fillStyle = "#b9c9c173"; ctx.fillRect(x + 2, y + 2, 60, 1);
    }
    ctx.fillStyle = "#afa68a";
    for (let x = 0; x < 512; x += 18) ctx.fillRect(x, 87, 13, 2);
    ctx.fillStyle = "#829199"; ctx.fillRect(0, 143, 512, 3);
    texture.update();
    const floor = MeshBuilder.CreateGround("Flood Index contact floor", { width: 34, height: 20 }, this.scene);
    floor.parent = this.root; floor.position.z = -3.03; floor.material = material;
  }

  private buildRacks(enamel: StandardMaterial, cast: StandardMaterial, nickel: StandardMaterial, paper: StandardMaterial) {
    const { material, texture, ctx } = this.paint("Painted perforated filing cards", 256, 128);
    ctx.fillStyle = "#68727b"; ctx.fillRect(0, 0, 256, 128);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) {
      const x = col * 32 + 2, y = row * 42 + 2;
      ctx.fillStyle = (row + col) % 3 ? "#bcad86" : "#92a39c";
      ctx.fillRect(x, y + 3, 27, 30);
      ctx.fillStyle = "#536875"; ctx.fillRect(x + 1, y + 7, 25, 3);
      ctx.fillStyle = "#6e7d7b";
      for (let i = 0; i < 9; i++) ctx.fillRect(x + 4 + (i * 7 + row) % 19, y + 14 + (i * 9 + col) % 16, 2, 2);
      ctx.fillStyle = "#c7c1a3"; ctx.fillRect(x + 2, y + 4, 22, 1);
    }
    texture.update();
    for (const x of [-8.52, 8.52]) {
      this.box("Open index rack carcass", 5.98, 2.90, .73, x, 1.67, 5.61, enamel);
      this.box("Reinforced punched rack plinth", 6.02, .19, .78, x, .229, 5.64, cast);
      this.face("Rows of perforated card stock", 5.74, 2.62, x, 1.70, 5.226, material);
      for (const y of [.418, 1.295, 2.168, 3.052]) this.box("Nickel rack shelf lip", 5.93, .081, .19, x, y, 5.167, nickel);
      for (const dx of [-2.4, -.88, .9, 2.24]) this.box("Painted tab stop", .141, .11, .028, x + dx, 2.19, 5.051, paper);
    }
  }

  private makeReader(marker: Marker & { readerBit: number }, enamel: StandardMaterial, cast: StandardMaterial, paper: StandardMaterial): Reader {
    const { id, x, z } = marker;
    this.box(id + " foot casting", 1.42, .15, .83, x, .077, z + .12, cast);
    this.box(id + " indexing reader casing", 1.24, .47, .58, x, .358, z + .18, enamel);
    this.box(id + " card insertion chute", .74, .11, .43, x, .626, z + .17, cast);
    const card = this.box(id + " feeder card", .58, .026, .31, x, .70, z + .185, paper);
    const bulb = this.material(id + " scan glass", readerPaint.hold.light);
    this.box(id + " scan lamp bar", .97, .073, .065, x, .365, z - .126, bulb);
    const display = this.paint(id + " physical readout", 128, 64, true);
    this.box(id + " panel mounting plate", 1.72, .46, .08, x, .555, z - .125, cast).rotation.x = .53;
    this.face(id + " indexed bank screen", 1.64, .40, x, .576, z - .177, display.material).rotation.x = .53;
    this.ring(id, x, z, bulb);
    return { id, name: marker.title.toUpperCase(), bit: marker.readerBit, screen: display.texture, bulb, card, dockingZ: z + .185 };
  }

  private ring(id: string, x: number, z: number, material: StandardMaterial) {
    const ring = MeshBuilder.CreateTorus(id + " locator", { diameter: 1.81, thickness: .056, tessellation: 18 }, this.scene);
    ring.parent = this.root; ring.position.set(x, .032, z); ring.material = material;
  }

  private drawScreen(texture: DynamicTexture, name: string, status: string, style: ReaderState, buckets?: number) {
    const { field, ink } = readerPaint[style];
    const ctx = texture.getContext();
    ctx.fillStyle = field; ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.strokeRect(4, 4, 120, 56);
    ctx.fillStyle = ink; ctx.font = "bold 19px Tahoma"; ctx.fillText(name, 10, 25, 109);
    ctx.font = "bold 17px Tahoma"; ctx.fillText(status, 10, buckets === undefined ? 48 : 42, 108);
    if (buckets !== undefined) {
      ctx.fillStyle = "#172f4a"; ctx.fillRect(10, 48, 108, 7);
      ctx.fillStyle = ink; ctx.fillRect(10, 48, 108 * buckets / 20, 7);
    }
    texture.update();
  }

  update(world: WorldView, time: number) {
    const available = world.stage === 1 || world.stage === 2;
    let savedCount = 0;
    for (const reader of this.readers) {
      const saved = Boolean(world.readerMask & reader.bit);
      if (saved) savedCount++;
      const scan = available && !saved ? world.indexScans?.get(reader.id) : undefined;
      const progress = scan ? Math.max(0, Math.min(1, 1 - (scan.until - world.frame) / FLOOD_SCAN_TICKS)) : 0;
      const buckets = scan ? Math.floor(progress * 20) : undefined;
      const state = saved ? "saved" : scan ? "reading" : available ? "ready" : "hold";
      const key = `${state}/${buckets ?? ""}`;
      if (key !== reader.last) {
        reader.last = key;
        const status = state === "saved" ? "SAVED" : state === "reading" ? "STAY STILL" : state === "ready" ? "READ" : "HOLD";
        this.drawScreen(reader.screen, reader.name, status, state, buckets);
        reader.bulb.diffuseColor.copyFrom(Color3.FromHexString(readerPaint[state].light));
      }
      reader.card.position.z = reader.dockingZ + progress * .19 + (saved ? .19 : 0);
      reader.bulb.diffuseColor.scaleToRef(scan ? .65 + .19 * Math.sin(time * 13) : saved ? .54 : available ? .40 : .12,
        reader.bulb.emissiveColor);
    }
    const folio = world.status === "complete" ? "READ" : world.stage === 3 ? "OPEN" : "HOLD";
    if (folio !== this.lastFolio) {
      this.lastFolio = folio;
      const state = folio === "HOLD" ? "hold" : "saved";
      this.drawScreen(this.folioPanel, "FLOOD FOLIO", folio, state);
      this.folioBulb.diffuseColor.copyFrom(Color3.FromHexString(readerPaint[state].light));
      this.folioBulb.diffuseColor.scaleToRef(folio === "HOLD" ? .12 : .52, this.folioBulb.emissiveColor);
    }

    const message = world.stage === 3 ? `FLOOD FOLIO / ${folio}` : available ? `PUNCH BANKS / ${savedCount} OF ${this.readers.length} SAVED`
      : "SEALED LOWER STACKS / SERVICE HOLD";
    if (message === this.lastBoard) return;
    this.lastBoard = message;
    const ctx = this.board.getContext();
    ctx.fillStyle = "#394d61"; ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = "#9cabaf"; ctx.strokeRect(4, 4, 504, 88);
    ctx.fillStyle = "#e3dcc2"; ctx.font = "bold 29px Tahoma"; ctx.fillText("FLOOD INDEX", 18, 41, 221);
    ctx.fillStyle = "#d2c6a4"; ctx.font = "bold 16px Tahoma"; ctx.fillText("SOUTH WALL / LOWER STACKS", 263, 39, 222);
    ctx.fillStyle = "#2b4151"; ctx.fillRect(12, 52, 488, 33);
    ctx.fillStyle = savedCount === this.readers.length ? "#d7eab8" : "#e9d8ac"; ctx.font = "bold 21px Tahoma";
    ctx.fillText(message, 21, 76, 465);
    this.board.update();
  }

  dispose() {
    for (const material of this.materials) material.dispose(false, true);
  }
}
