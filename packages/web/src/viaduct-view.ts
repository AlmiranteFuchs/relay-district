import { Color3, DynamicTexture, MeshBuilder, StandardMaterial, type Mesh, type Scene, type TransformNode } from "@babylonjs/core";
import { TICK_RATE } from "../../shared/src/content.ts";
import { routeMarkers, type Marker } from "../../shared/src/scene.ts";
import type { WorldView } from "./view.ts";

const styles = {
  hold: { face: "#344647", ink: "#aeb7aa", lamp: "#748179" },
  ready: { face: "#534933", ink: "#fae4b0", lamp: "#d8ad64" },
  live: { face: "#194860", ink: "#d6f8f7", lamp: "#83d8e3" },
  linked: { face: "#305345", ink: "#d5efb0", lamp: "#9cc970" },
};

export class ViaductScenery {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly previousSky;
  private readonly materials: StandardMaterial[] = [];
  private readonly stations: { bit?: number; display: DynamicTexture; lamp: StandardMaterial; locator: Mesh; last?: string }[] = [];

  constructor(scene: Scene, root: TransformNode, markers: Marker[]) {
    this.scene = scene;
    this.root = root;
    this.previousSky = scene.clearColor.clone();
    scene.clearColor.set(.49, .59, .62, 1);
    const teal = this.material("Floodproof teal enamel", "#557777");
    const dark = this.material("Viaduct riveted steel", "#3f555b");
    const stone = this.material("Flood channel concrete", "#818778");
    const ochre = this.material("Viaduct warning ochre", "#b99b60");
    const zinc = this.material("Burnished bolt caps", "#858e83");

    this.canal(stone);
    this.deck(teal, ochre, stone);
    for (const x of [-13, -6.5, 0, 6.5, 13]) {
      this.box("Long flood pier", 1.38, 3.36, 1.75, x, -2.17, -4.56, stone);
      this.box("Poured truss footing", .66, .49, .53, x, .22, 5.12, stone);
      this.beam("Viaduct lattice upright", x, .33, x, 3.47, 5.13, .25, teal);
      if (x < 13) {
        const left = x / 6.5 % 2 === 0;
        this.beam("Inclined flood brace", x, left ? .45 : 3.27, x + 6.5, left ? 3.27 : .45, 5.17, .24, teal);
      }
      for (const y of [.54, 3.27]) {
        this.box("Viaduct joint plate", .53, .32, .09, x, y, 4.98, dark);
        for (const dx of [-.158, .158]) this.box("Joint bolt", .068, .07, .033, x + dx, y, 4.917, zinc);
      }
    }
    this.box("Upper truss flange", 26.6, .31, .42, 0, 3.49, 5.13, dark);
    this.box("Upper ochre flange edge", 26.6, .07, .054, 0, 3.56, 4.89, ochre);
    this.box("Flood railing cap", 26.8, .084, .105, 0, .88, 4.95, ochre);
    this.box("Flood railing bottom", 26.8, .079, .078, 0, .37, 4.95, dark);
    for (let x = -12.65; x < 13; x += .91) this.box("Railing stanchion", .055, .72, .063, x, .45, 4.95, dark);
    this.sign();
    for (const marker of routeMarkers("viaduct", 1)) this.station(marker, teal, dark, zinc);
    for (const marker of markers) {
      if (!marker.readerBit) this.station(marker, teal, dark, zinc);
    }
  }

  private material(name: string, tint: string) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(tint);
    material.specularColor.set(.09, .12, .12);
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

  private box(name: string, width: number, height: number, depth: number,
    x: number, y: number, z: number, material: StandardMaterial) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    mesh.parent = this.root; mesh.position.set(x, y, z); mesh.material = material;
    return mesh;
  }

  private face(name: string, width: number, height: number, x: number, y: number, z: number, material: StandardMaterial) {
    const mesh = MeshBuilder.CreatePlane(name, { width, height }, this.scene);
    mesh.parent = this.root; mesh.position.set(x, y, z); mesh.material = material;
    return mesh;
  }

  private beam(name: string, ax: number, ay: number, bx: number, by: number, z: number, depth: number, material: StandardMaterial) {
    const dx = bx - ax, dy = by - ay;
    this.box(name, Math.hypot(dx, dy), .21, depth, (ax + bx) / 2, (ay + by) / 2, z, material).rotation.z = Math.atan2(dy, dx);
  }

  private canal(stone: StandardMaterial) {
    const { material, texture, ctx } = this.paint("Painted canal water", 512, 256, true);
    const wash = ctx.createLinearGradient(0, 0, 0, 256);
    wash.addColorStop(0, "#718f93"); wash.addColorStop(.48, "#446c75"); wash.addColorStop(1, "#527e83");
    ctx.fillStyle = wash; ctx.fillRect(0, 0, 512, 256);
    for (let stripe = 0; stripe < 48; stripe++) {
      const length = 38 + (stripe * 31) % 103;
      const x = (stripe * 83) % 512, y = (stripe * 21) % 256;
      ctx.fillStyle = stripe % 3 ? "#a6beb157" : "#294c5460";
      ctx.fillRect(x, y, length, stripe % 4 === 0 ? 2 : 1);
    }
    texture.update();
    const water = MeshBuilder.CreateGround("Flood channel below the walking span", { width: 56, height: 40 }, this.scene);
    water.parent = this.root; water.position.set(0, -2.23, 3); water.material = material;
    this.box("Canal floodwall", 46, 2.42, .43, 0, -1.15, 15.25, stone);
    this.box("Concrete floodwall ledge", 46, .21, .84, 0, .033, 15.23, stone);

    const bank = this.paint("Low painted floodbank skyline", 512, 128, true);
    const sky = bank.ctx.createLinearGradient(0, 0, 0, 128);
    sky.addColorStop(0, "#8ca8ad"); sky.addColorStop(.72, "#b8beb1"); sky.addColorStop(1, "#bcbb99");
    bank.ctx.fillStyle = sky; bank.ctx.fillRect(0, 0, 512, 128);
    for (let x = 0; x < 512; x += 38) {
      const top = 65 + (x * 11) % 24;
      bank.ctx.fillStyle = "#849793"; bank.ctx.fillRect(x, top, 24 + (x % 7), 128 - top);
      bank.ctx.fillStyle = "#a8ad98"; bank.ctx.fillRect(x + 3, top + 5, 15, 3);
    }
    for (const x of [102, 212, 365]) {
      bank.ctx.fillStyle = "#798e8c"; bank.ctx.fillRect(x, 54, 3, 59); bank.ctx.fillRect(x - 7, 60, 17, 2);
    }
    bank.texture.update();
    this.face("Floodbank beyond the bridge", 81, 13, 0, 3.15, 21, bank.material);
  }

  private deck(teal: StandardMaterial, ochre: StandardMaterial, stone: StandardMaterial) {
    const { material, texture, ctx } = this.paint("Painted viaduct deck", 512, 192);
    ctx.fillStyle = "#495761"; ctx.fillRect(0, 0, 512, 192);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
      const x = col * 64, y = row * 48;
      const slab = ctx.createLinearGradient(x, y, x + 20, y + 48);
      slab.addColorStop(0, (row + col) % 2 ? "#8c9891" : "#81949a");
      slab.addColorStop(1, "#637983");
      ctx.fillStyle = slab; ctx.fillRect(x + 1, y + 1, 62, 46);
      ctx.fillStyle = "#becbb386"; ctx.fillRect(x + 3, y + 3, 55, 1);
    }
    ctx.fillStyle = "#727858"; ctx.fillRect(0, 111, 512, 2);
    ctx.fillStyle = "#ae9e68";
    for (let x = 0; x < 512; x += 17) {
      ctx.fillRect(x, 10, 12, 3); ctx.fillRect(x, 179, 12, 3);
    }
    texture.update();
    const path = MeshBuilder.CreateGround("Viaduct walking surface", { width: 34, height: 10.32 }, this.scene);
    path.parent = this.root; path.material = material;
    this.box("Concrete deck slab", 34, .46, 10.39, 0, -.27, 0, stone);
    this.box("Front enamel I beam", 34.1, .39, .21, 0, -.34, -5.172, teal);
    this.box("Front bridge lip", 34.1, .095, .18, 0, -.045, -5.146, ochre);
  }

  private sign() {
    const { material, texture, ctx } = this.paint("Viaduct banner", 512, 64, true);
    ctx.fillStyle = "#39575c"; ctx.fillRect(0, 0, 512, 64);
    ctx.strokeStyle = "#bdb996"; ctx.strokeRect(4, 4, 504, 56);
    ctx.fillStyle = "#e2dfbf"; ctx.font = "bold 27px Tahoma"; ctx.fillText("SOUTH VIADUCT", 22, 41, 238);
    ctx.fillStyle = "#cfb778"; ctx.fillRect(271, 12, 2, 40);
    ctx.font = "bold 18px Tahoma"; ctx.fillText("FLOOD CHANNEL / SPAN 04", 291, 38, 200);
    texture.update();
    this.face("South Viaduct plate", 13.7, .83, 0, 3.055, 4.77, material);
  }

  private station(marker: Marker, teal: StandardMaterial, dark: StandardMaterial, zinc: StandardMaterial) {
    const { id, x, z, readerBit: bit } = marker;
    this.box(id + " concrete shoe", 1.65, .16, .85, x, .08, z + .16, zinc);
    this.box(id + " sloped relay casing", 1.26, .46, .54, x, .36, z + .15, teal);
    this.box(id + " screen pod", 1.61, .45, .15, x, .696, z + .092, dark).rotation.x = .52;
    const display = this.paint(id + " relay display", 128, 64, true);
    this.face(id + " display", 1.46, .376, x, .744, z + .01, display.material).rotation.x = .52;
    if (!bit) this.box("Signal Ledger marked folio", .48, .036, .24, x, .605, z + .37, zinc).rotation.y = -.2;
    const lamp = this.material(id + " signal glass", styles.hold.lamp);
    this.box(id + " lamp band", .94, .075, .078, x, .397, z - .13, lamp);
    const locator = MeshBuilder.CreateTorus(id + " locator", { diameter: 1.87, thickness: .058, tessellation: 18 }, this.scene);
    locator.parent = this.root; locator.position.set(x, .032, z); locator.material = lamp;
    this.stations.push({ bit, display: display.texture, lamp, locator });
  }

  update(world: WorldView, time: number) {
    const westLinked = (world.readerMask & 1) !== 0;
    const eastLinked = (world.readerMask & 2) !== 0;
    const seconds = westLinked && !eastLinked ? Math.max(0, Math.ceil((world.readerUntil - world.frame) / TICK_RATE)) : 0;
    const answering = world.stage === 1 && world.status === "signal";
    for (const station of this.stations) {
      station.locator.setEnabled(station.bit ? answering : world.status === "signal");
      const state = station.bit === 1 ? westLinked ? "linked" : answering ? "ready" : "hold"
        : station.bit === 2 ? eastLinked ? "linked" : seconds ? "live" : "hold"
          : world.status === "complete" ? "linked" : world.status === "signal" ? "ready" : "hold";
      const message = state === "live" ? `LIVE ${seconds}s` : state === "linked" ? station.bit ? eastLinked ? "LINKED" : "SENT" : "READ"
        : state === "ready" ? station.bit ? "START" : "OPEN" : "WAIT";
      const style = styles[state];
      if (message !== station.last) {
        station.last = message;
        station.lamp.diffuseColor.copyFrom(Color3.FromHexString(style.lamp));
        const ctx = station.display.getContext();
        ctx.fillStyle = style.face; ctx.fillRect(0, 0, 128, 64);
        ctx.strokeStyle = style.ink; ctx.lineWidth = 2; ctx.strokeRect(4, 4, 120, 56);
        ctx.fillStyle = style.ink; ctx.font = "bold 28px Tahoma"; ctx.fillText(message, 11, 42, 105);
        station.display.update();
      }
      station.lamp.diffuseColor.scaleToRef(state === "live" ? .67 + .23 * Math.sin(time * 8) : state === "hold" ? .13 : .40,
        station.lamp.emissiveColor);
    }
  }

  dispose() {
    this.scene.clearColor.copyFrom(this.previousSky);
    for (const material of this.materials) material.dispose(false, true);
  }
}
