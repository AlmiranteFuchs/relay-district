import { Color3, DynamicTexture, MeshBuilder, StandardMaterial, type Scene, type TransformNode } from "@babylonjs/core";
import type { Marker } from "../../shared/src/scene.ts";
import type { WorldView } from "./view.ts";

type StationState = "hold" | "open" | "read";
const stationStyles = {
  hold: { field: "#253946", display: "#9ab1b5", lamp: "#5e737b" },
  open: { field: "#23526a", display: "#e5fbff", lamp: "#78dcf0" },
  read: { field: "#2c5443", display: "#d8ffc4", lamp: "#a2d775" },
};
const sections = ["INDEX HALL", "CHANNEL FLOOR", "RELAY STACK", "LISTENING ROOM"];

export class ArchiveScenery {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly surfaces: StandardMaterial[] = [];
  private readonly stations: { bit: number; texture: DynamicTexture; lamp: StandardMaterial; state?: StationState }[] = [];

  constructor(scene: Scene, root: TransformNode, stage: number, markers: Marker[]) {
    this.scene = scene;
    this.root = root;
    const porcelain = this.material("Seafoam porcelain", "#8caea2");
    const aluminium = this.material("Anodized aluminium", "#8baba7");
    const frame = this.material("Archive steel", "#394f57");
    const cabinet = this.material("Gunmetal tape drawer", "#445e63");
    const glass = this.material("Opal skylight", "#c6ddbb");
    glass.emissiveColor.set(.22, .35, .21);

    this.buildDeck();
    this.box("Transom wall", 27, 5, .4, 0, 2.5, 5.7, porcelain);
    this.box("Continuous skylight", 25, .55, .13, 0, 4.58, 5.41, glass);
    this.box("Lower wall guard", 26, .35, .32, 0, .19, 5.23, frame);
    const recorders = this.recorderFace();
    for (const x of [-9.8, -4.9, 0, 4.9, 9.8]) {
      this.box("Rack foot", 3.9, .34, 1.18, x, .17, 5.1, frame);
      this.box("Tape rack", 3.86, 2.76, .66, x, 1.69, 5.29, cabinet);
      this.box("Rack brow", 4.01, .14, .79, x, 3.09, 5.23, aluminium);
      this.box("Rack spindle shelf", 4.02, .11, .83, x, .61, 5.18, aluminium);
      this.plane("Twin reel drives", 3.61, 2.44, x, 1.78, 4.947, recorders);
      this.box("Roof glass mullion", .18, .61, .18, x, 4.58, 5.36, aluminium);
    }
    for (const x of [-12.25, -7.35, -2.45, 2.45, 7.35, 12.25]) {
      this.box("Enamel structural fin", .38, 4, .64, x, 2, 5.14, porcelain);
      this.box("Polished fin edge", .11, 3.63, .16, x, 2.01, 4.77, aluminium);
    }
    this.buildSign(stage);
    for (const marker of markers) this.buildStation(marker, frame, porcelain, aluminium);
  }

  private material(name: string, color: string) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor.set(.10, .13, .12);
    this.surfaces.push(material);
    return material;
  }

  private texture(name: string, width: number, height: number) {
    const material = this.material(name, "#ffffff");
    const texture = new DynamicTexture(name, { width, height }, this.scene, true);
    material.diffuseTexture = texture;
    return { material, texture, ctx: texture.getContext() };
  }

  private box(name: string, width: number, height: number, depth: number, x: number, y: number, z: number, material: StandardMaterial) {
    const box = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    box.parent = this.root; box.position.set(x, y, z); box.material = material;
    return box;
  }

  private plane(name: string, width: number, height: number, x: number, y: number, z: number, material: StandardMaterial) {
    const plane = MeshBuilder.CreatePlane(name, { width, height }, this.scene);
    plane.parent = this.root; plane.position.set(x, y, z); plane.material = material;
    return plane;
  }

  private buildDeck() {
    const { material, texture, ctx } = this.texture("Archive painted linoleum", 512, 256);
    ctx.fillStyle = "#304450"; ctx.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
      const x = col * 64, y = row * 64;
      const tile = ctx.createLinearGradient(x, y, x + 40, y + 64);
      tile.addColorStop(0, (row + col) % 2 ? "#5c787d" : "#57747a");
      tile.addColorStop(1, "#425e66");
      ctx.fillStyle = tile; ctx.fillRect(x + 1, y + 1, 62, 62);
      ctx.fillStyle = "#a0b0a550"; ctx.fillRect(x + 2, y + 2, 60, 1);
    }
    ctx.fillStyle = "#7a9b8d"; ctx.fillRect(0, 24, 512, 2);
    ctx.fillStyle = "#8f9b78"; ctx.fillRect(0, 28, 512, 1);
    ctx.fillStyle = "#7a9b8d"; ctx.fillRect(0, 145, 512, 3);
    texture.update();
    const floor = MeshBuilder.CreateGround("Archive access deck", { width: 36, height: 20 }, this.scene);
    floor.parent = this.root; floor.position.z = -3.7; floor.material = material;
  }

  private recorderFace() {
    const { material, texture, ctx } = this.texture("Painted reel controls", 128, 128);
    const face = ctx.createLinearGradient(0, 0, 0, 128);
    face.addColorStop(0, "#455f66"); face.addColorStop(1, "#273b43");
    ctx.fillStyle = face; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "#92aaa4"; ctx.lineWidth = 1; ctx.strokeRect(2, 2, 124, 124);
    ctx.fillStyle = "#1c333a"; ctx.fillRect(8, 13, 112, 66);
    for (const reel of [35, 93]) {
      const metal = ctx.createLinearGradient(0, 22, 0, 66);
      metal.addColorStop(0, "#acc8bf"); metal.addColorStop(.42, "#668d88"); metal.addColorStop(1, "#476c6e");
      ctx.fillStyle = metal; ctx.beginPath(); ctx.arc(reel, 44, 23, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#263d42";
      for (let i = 0; i < 3; i++) {
        const angle = i * Math.PI * 2 / 3 + .2;
        ctx.beginPath(); ctx.arc(reel + 13 * Math.cos(angle), 44 + 13 * Math.sin(angle), 6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(reel, 44, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#c4ad78"; ctx.fillRect(44, 67, 40, 2);
    ctx.fillStyle = "#83a5a1"; ctx.fillRect(11, 92, 58, 2);
    ctx.fillStyle = "#1b3038"; ctx.fillRect(75, 87, 42, 13);
    ctx.fillStyle = "#ccbe8b"; ctx.fillRect(78, 91, 23, 4);
    ctx.fillStyle = "#779b78"; ctx.fillRect(104, 91, 10, 4);
    ctx.fillStyle = "#8dafa6";
    for (let x = 12; x < 74; x += 11) ctx.fillRect(x, 107, 7, 4);
    texture.update();
    return material;
  }

  private buildSign(stage: number) {
    const { material, texture, ctx } = this.texture("Tidegate fascia lettering", 512, 64);
    const paint = ctx.createLinearGradient(0, 0, 0, 64);
    paint.addColorStop(0, "#759b96"); paint.addColorStop(.22, "#2b505b"); paint.addColorStop(1, "#253e49");
    ctx.fillStyle = paint; ctx.fillRect(0, 0, 512, 64);
    ctx.strokeStyle = "#c5dbbf"; ctx.strokeRect(4, 4, 504, 56);
    ctx.fillStyle = "#ddead2"; ctx.font = "bold 29px Tahoma";
    ctx.fillText("TIDEGATE SIGNAL ARCHIVE", 18, 44, 320);
    ctx.fillStyle = "#d1b87f"; ctx.fillRect(353, 13, 2, 38);
    ctx.font = "bold 18px Tahoma"; ctx.fillText(sections[stage] ?? sections[0], 371, 41, 120);
    material.emissiveColor.set(.18, .23, .19);
    texture.update();
    this.plane("Archive section fascia", 17.5, .91, 0, 3.74, 4.58, material);
  }

  private buildStation(marker: Marker, frame: StandardMaterial, enamel: StandardMaterial, trim: StandardMaterial) {
    const { id, x, z, readerBit = 0 } = marker;
    this.box(id + " cabinet", 1.53, .34, .65, x, .18, z + .24, frame);
    this.box(id + " fascia", 1.43, .23, .49, x, .4, z + .24, enamel);
    const { material, texture } = this.texture(id + " aperture", 128, 64);
    material.disableLighting = true;
    material.diffuseTexture = null;
    material.emissiveTexture = texture;
    this.box(id + " bezel", 1.64, .49, .19, x, .56, z - .018, trim).rotation.x = .56;
    this.plane(id + " readout", 1.52, .43, x, .617, z - .11, material).rotation.x = .56;
    const lamp = this.material(id + " ground cue", stationStyles.hold.lamp);
    const ring = MeshBuilder.CreateTorus(id + " locator", { diameter: 1.8, thickness: .060, tessellation: 16 }, this.scene);
    ring.parent = this.root; ring.position.set(x, .030, z); ring.material = lamp;
    this.stations.push({ bit: readerBit, texture, lamp });
  }

  update(world: WorldView, time: number) {
    for (const station of this.stations) {
      const scanned = station.bit ? (world.readerMask & station.bit) !== 0 : world.status === "complete";
      const active = station.bit ? world.status === "route" && station.bit === 2 ** world.wave : world.status === "signal";
      const state = scanned ? "read" : active ? "open" : "hold";
      if (state !== station.state) {
        const style = stationStyles[state];
        station.lamp.diffuseColor.copyFrom(Color3.FromHexString(style.lamp));
        const ctx = station.texture.getContext();
        ctx.fillStyle = style.field; ctx.fillRect(0, 0, 128, 64);
        ctx.strokeStyle = style.display; ctx.lineWidth = 2; ctx.strokeRect(3, 3, 122, 58);
        ctx.beginPath(); ctx.lineWidth = 4;
        if (state === "open") { ctx.moveTo(16, 21); ctx.lineTo(32, 32); ctx.lineTo(16, 43); ctx.closePath(); }
        else if (state === "read") { ctx.moveTo(13, 32); ctx.lineTo(21, 41); ctx.lineTo(34, 22); }
        else { ctx.moveTo(18, 24); ctx.lineTo(18, 41); ctx.moveTo(29, 24); ctx.lineTo(29, 41); }
        ctx.stroke();
        ctx.fillStyle = style.display; ctx.font = "bold 34px Tahoma";
        ctx.fillText(state.toUpperCase(), 43, 44, 79);
        station.texture.update();
        station.state = state;
      }
      station.lamp.diffuseColor.scaleToRef(state === "open" ? .64 + .18 * Math.sin(time * 9) : state === "read" ? .4 : .1, station.lamp.emissiveColor);
    }
  }

  dispose() {
    for (const material of this.surfaces) material.dispose(false, true);
  }
}
