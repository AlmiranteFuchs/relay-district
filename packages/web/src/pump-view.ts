import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Scene } from "@babylonjs/core";
import { LIMITS } from "../../shared/src/combat.ts";
import { PUMP_LANES, PUMP_PHASE, PUMP_TIMING, type Marker } from "../../shared/src/scene.ts";
import type { WorldView } from "./view.ts";

const floorTints = ["#667f89", "#938f7a", "#67867c"];

export class PumpScenery {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly materials: StandardMaterial[] = [];
  private readonly fields: { sheet: Mesh; rim: TransformNode }[] = [];
  private readonly board: DynamicTexture;
  private readonly warning: ReturnType<PumpScenery["paint"]>;
  private readonly burst: ReturnType<PumpScenery["paint"]>;
  private readonly rim: StandardMaterial;
  private readonly stationLamp: StandardMaterial;
  private lastMessage = "";

  constructor(scene: Scene, root: TransformNode, markers: Marker[]) {
    this.scene = scene;
    this.root = root;
    const dark = this.material("Pump cast iron", "#475148");
    const coat = this.material("Pump vitreous teal", "#557d68");
    const porcelain = this.material("Pump glazed cream ceramic", "#cac3a2");
    const cream = this.material("Municipal pump stenciling", "#c4b38d");
    this.stationLamp = this.material("Pump station aperture", "#98bf86");

    this.tiles(porcelain, dark, cream);
    for (const [i, x] of [-8.25, 0, 8.25].entries()) this.pump(x, i, coat, dark, cream);
    const header = MeshBuilder.CreateTube("Municipal discharge header", {
      path: [new Vector3(-12.45, 4.19, 5.42), new Vector3(12.3, 4.19, 5.42)], radius: .23, tessellation: 10, cap: Mesh.CAP_ALL,
    }, this.scene);
    header.parent = root; header.material = coat;
    this.warning = this.paint("Pressure warning hatch", 256, 128, true);
    this.burst = this.paint("Pump backwash over the channel", 256, 128, true);
    for (const material of [this.warning.material, this.burst.material]) material.disableDepthWrite = true;
    this.paintFields();
    this.rim = this.material("Active drain channel edge", "#e5b765");
    this.rim.disableLighting = true;
    for (const [index, lane] of PUMP_LANES.entries()) this.channel(index, lane.minZ, lane.maxZ, dark, cream);

    const board = this.paint("Pump Court pressure board", 512, 96, true);
    this.board = board.texture;
    this.box("Board wall housing", 11.9, 1.29, .16, 0, 4.05, 4.91, dark);
    this.face("Pressure board display", 11.7, 1.18, 0, 4.05, 4.815, board.material);
    for (const marker of markers) this.station(marker, dark, coat, cream);
  }

  private material(name: string, color: string) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor.set(.11, .135, .11);
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

  private tiles(porcelain: StandardMaterial, dark: StandardMaterial, cream: StandardMaterial) {
    const wall = this.paint("Hand-painted municipal ceramics", 512, 128);
    wall.ctx.fillStyle = "#7b8270"; wall.ctx.fillRect(0, 0, 512, 128);
    for (let row = 0; row < 8; row++) for (let col = 0; col < 16; col++) {
      const x = col * 32, y = row * 16;
      const glaze = wall.ctx.createLinearGradient(x, y, x + 6, y + 16);
      glaze.addColorStop(0, row < 5 ? "#cecfac" : "#8da699");
      glaze.addColorStop(1, row < 5 ? ((row + col) % 3 ? "#a7b298" : "#b2b698") : "#6f9085");
      wall.ctx.fillStyle = glaze; wall.ctx.fillRect(x + 1, y + 1, 30, 14);
      wall.ctx.fillStyle = "#e9dbc54f"; wall.ctx.fillRect(x + 2, y + 2, 25, 1);
    }
    wall.texture.update();
    this.box("Pump hall structural wall", 28, 6.2, .35, 0, 3, 6.16, porcelain);
    this.face("Municipal glazed wall frieze", 27.9, 5.9, 0, 3, 5.977, wall.material);
    this.box("Hall ceramic picture rail", 27.9, .16, .18, 0, 3.47, 5.89, cream);
    this.box("Dark sump kick plate", 27.9, .21, .18, 0, .153, 5.87, dark);
    const light = this.material("Milk glass pump lights", "#e3d5a8");
    light.emissiveColor.set(.38, .34, .18);
    for (const x of [-12.22, -4.1, 4.05, 12.21]) {
      this.box("Beveled ceramic pier", .32, 5.81, .47, x, 2.98, 5.78, porcelain);
      this.box("Bakélite light socket", .62, .28, .25, x, 4.31, 5.45, dark);
      this.box("Frosted service lamp", .50, .153, .11, x, 4.31, 5.287, light);
    }
    const slab = MeshBuilder.CreateGround("Pump Court contact floor", { width: 34, height: 20 }, this.scene);
    slab.parent = this.root; slab.position.z = -3.1;
    slab.material = this.material("Pump Court concrete apron", "#65726e");
  }

  private pump(x: number, index: number, enamel: StandardMaterial, dark: StandardMaterial, cream: StandardMaterial) {
    const level = 1.51;
    this.box("Pump isolation footing", 3.52, .28, .91, x, .14, 5.45, dark);
    this.box("Motor frame", 2.64, .41, .79, x, .47, 5.43, enamel);
    const outline = [[1.18, 5.88], [1.20, 5.42], [1.07, 5.21], [.55, 5.14]];
    const rings = outline.map(([radius, z]) => Array.from({ length: 20 }, (_, i) => {
      const angle = 2 * Math.PI * i / 20;
      const flare = Math.max(0, Math.cos(angle - .61)) ** 5;
      return new Vector3(x + (radius + .32 * flare) * Math.cos(angle), level + radius * Math.sin(angle) + .12 * flare, z);
    }));
    const shell = MeshBuilder.CreateRibbon("Cast spiral pump volute " + (index + 1), { pathArray: rings, closePath: true, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    shell.parent = this.root; shell.material = enamel;
    const hub = MeshBuilder.CreateCylinder("Pump inspection cover", { diameter: 1.18, height: .22, tessellation: 14 }, this.scene);
    hub.parent = this.root; hub.rotation.x = Math.PI / 2; hub.position.set(x, level, 5.14); hub.material = dark;
    const plate = MeshBuilder.CreateCylinder("Pump inlet flange", { diameter: .92, height: .095, tessellation: 14 }, this.scene);
    plate.parent = this.root; plate.rotation.x = Math.PI / 2; plate.position.set(x, level, 4.986); plate.material = cream;
    for (let bolt = 0; bolt < 6; bolt++) {
      const theta = bolt * Math.PI / 3;
      const cap = this.box("Flange bolt", .09, .09, .052, x + Math.cos(theta) * .365, level + Math.sin(theta) * .365, 4.925, dark);
      cap.rotation.z = theta;
    }
    const pipe = MeshBuilder.CreateTube("Swept pump discharge pipe", {
      path: [[.85, 2.15], [1.34, 2.25], [1.61, 2.48], [1.68, 2.80], [1.68, 3.62], [1.77, 3.91], [1.99, 4.12], [2.26, 4.19]]
        .map(([dx, y]) => new Vector3(x + dx, y, 5.42)),
      radius: .225, tessellation: 10, cap: Mesh.CAP_ALL,
    }, this.scene);
    pipe.parent = this.root; pipe.material = enamel;
    this.box("Discharge pressure collar", .49, .114, .49, x + 1.68, 3.06, 5.42, cream);
  }

  private channel(index: number, minZ: number, maxZ: number, dark: StandardMaterial, cream: StandardMaterial) {
    const { material, texture, ctx } = this.paint("Painted drain tiles " + (index + 1), 512, 128);
    ctx.fillStyle = "#495854"; ctx.fillRect(0, 0, 512, 128);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 10; col++) {
      const x = col * 51.2, y = row * 64;
      const clay = ctx.createLinearGradient(x, y, x + 25, y + 64);
      clay.addColorStop(0, floorTints[index]); clay.addColorStop(1, "#667878");
      ctx.fillStyle = clay; ctx.fillRect(x + 1, y + 1, 49, 62);
      ctx.fillStyle = "#ded6b760"; ctx.fillRect(x + 3, y + 3, 44, 1);
    }
    texture.update();
    const center = (minZ + maxZ) / 2, depth = maxZ - minZ;
    const tile = MeshBuilder.CreateGround("Drain lane tiles " + (index + 1), { width: 34, height: depth }, this.scene);
    tile.parent = this.root; tile.position.set(0, .003, center); tile.material = material;
    this.box("Narrow channel seal", 34, .015, .08, 0, .008, minZ, dark);
    for (let x = -11; x <= 11; x += 1.35) this.box("Glazed drain marker", .19, .011, .075, x, .011, minZ + .11, cream);
    const sheet = MeshBuilder.CreateGround("Pump hazard lane " + (index + 1), { width: 2 * LIMITS.x, height: depth }, this.scene);
    sheet.parent = this.root; sheet.position.set(0, .020, center); sheet.setEnabled(false);
    const rim = new TransformNode("Pump hazard guide " + (index + 1), this.scene);
    rim.parent = this.root;
    for (const z of [minZ + .024, maxZ - .024]) this.box("Channel lit edge", 2 * LIMITS.x, .007, .048, 0, .026, z, this.rim, rim);
    for (const x of [-LIMITS.x + .024, LIMITS.x - .024]) this.box("Channel end cap", .048, .007, depth, x, .026, center, this.rim, rim);
    rim.setEnabled(false);
    this.fields.push({ sheet, rim });
  }

  private paintFields() {
    const hatch = this.warning.ctx;
    hatch.fillStyle = "#bd793d"; hatch.fillRect(0, 0, 256, 128);
    hatch.strokeStyle = "#fbc185"; hatch.lineWidth = 5;
    for (let x = -60; x < 320; x += 25.6) {
      hatch.beginPath(); hatch.moveTo(x - 30, 0); hatch.lineTo(x + 30, 128); hatch.stroke();
    }
    this.warning.texture.update();
    const water = this.burst.ctx;
    water.fillStyle = "#488b92"; water.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 46; i++) {
      const x = (i * 43) % 256, y = (i * 19) % 128;
      water.fillStyle = i % 3 ? "#b2e6d5" : "#78c1bf";
      water.fillRect(x, y, 7 + (i * 7) % 27, i % 6 ? 2 : 4);
      water.fillRect(x + 5, y + 3, 5 + i % 11, 1);
    }
    this.burst.texture.update();
  }

  private station(marker: Marker, dark: StandardMaterial, enamel: StandardMaterial, cream: StandardMaterial) {
    const { id, x, z } = marker;
    this.box(id + " enamel body", 1.28, .47, .68, x, .27, z + .13, enamel);
    this.box(id + " lower boot", 1.39, .12, .76, x, .066, z + .13, dark);
    this.box(id + " indicator slot", .93, .076, .059, x, .449, z - .236, this.stationLamp);
    if (id === "pump-intake") {
      const lever = this.box("Intake brass lever", .13, .25, .13, x - .24, .614, z + .12, cream);
      lever.rotation.z = .37;
      this.box("Intake lock plate", .34, .029, .32, x - .21, .52, z + .12, dark);
    } else {
      this.box("Bound pump record", .61, .047, .36, x, .53, z + .13, cream).rotation.y = -.18;
      for (const dx of [-.15, .15]) this.box("Typed record column", .18, .005, .105, x + dx, .555, z + .145, dark);
    }
    const ring = MeshBuilder.CreateTorus(id + " locator", { diameter: 1.75, thickness: .053, tessellation: 18 }, this.scene);
    ring.parent = this.root; ring.position.set(x, .033, z); ring.material = this.stationLamp;
  }

  update(world: WorldView, time: number) {
    const { readerMask: phase, wave, stage, status } = world;
    const warning = stage === 2 && phase === PUMP_PHASE.warning;
    const burst = stage === 2 && phase === PUMP_PHASE.burst;
    const active = status === "combat" && (warning || burst) && PUMP_LANES[wave];
    for (const [index, field] of this.fields.entries()) {
      const lit = Boolean(active) && index === wave;
      field.sheet.setEnabled(lit);
      field.rim.setEnabled(lit);
      if (lit) field.sheet.material = warning ? this.warning.material : this.burst.material;
    }
    if (active) {
      const allotted = warning ? PUMP_TIMING.warning : PUMP_TIMING.burst;
      const progress = Math.max(0, Math.min(1, 1 - (world.readerUntil - world.frame) / allotted));
      if (warning) {
        this.warning.texture.uOffset = progress * .30;
        this.warning.material.alpha = .43 + .16 * Math.sin(time * 15) ** 2;
        this.rim.emissiveColor.set(1, .575 + .15 * progress, .26);
      } else {
        this.burst.texture.uOffset = progress * 1.24;
        this.burst.material.alpha = .57 + .2 * Math.sin(progress * Math.PI);
        this.rim.emissiveColor.set(.65, .99, .93);
      }
      this.rim.alpha = warning ? .73 + .23 * Math.sin(time * 15) ** 2 : .96;
    }

    const message = active ? `${active.title.toUpperCase()} / ${warning ? "GET CLEAR" : "DRAIN BURST"}` :
      stage === 3 ? "PUMP RECORD / READY" : stage === 1 ? "INTAKE CONTROL / READY" : "SERVICE DRAINS / STANDBY";
    if (message === this.lastMessage) return;
    this.lastMessage = message;
    this.stationLamp.emissiveColor.set(.28, .44, .21);
    const ctx = this.board.getContext();
    ctx.fillStyle = "#395352"; ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = "#bbc5a7"; ctx.strokeRect(4, 4, 504, 88);
    ctx.fillStyle = "#e8dfb5"; ctx.font = "bold 29px Tahoma"; ctx.fillText("PUMP COURT", 18, 40, 213);
    ctx.fillStyle = "#d6bc7c"; ctx.font = "bold 17px Tahoma"; ctx.fillText("SOUTH WALL / MUNICIPAL INTAKE", 238, 38, 251);
    ctx.fillStyle = active ? warning ? "#75513e" : "#387379" : "#2b4649"; ctx.fillRect(12, 52, 488, 33);
    ctx.fillStyle = "#f3e2b7"; ctx.font = "bold 21px Tahoma"; ctx.fillText(message, 21, 76, 466);
    this.board.update();
  }

  dispose() {
    for (const material of this.materials) material.dispose(false, true);
  }
}
