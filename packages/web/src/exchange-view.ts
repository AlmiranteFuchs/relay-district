import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Scene } from "@babylonjs/core";
import type { Marker } from "../../shared/src/scene.ts";
import type { WorldView } from "./view.ts";

const sectionNames = ["SWITCH GALLERY", "BROKEN RUN", "CREW BAY"];

export class ExchangeScenery {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly surfaces: StandardMaterial[] = [];
  private readonly stations: StandardMaterial[] = [];

  constructor(scene: Scene, root: TransformNode, stage: number, markers: Marker[]) {
    this.scene = scene;
    this.root = root;
    const concrete = this.material("Sealant concrete", "#746a60");
    const blackSteel = this.material("Blackened steel", "#373b3d");
    const steel = this.material("Oiled rail", "#81817b");
    const oldPaint = this.material("Primer enamel", "#86614e");
    const lamp = this.material("Incandescent service strip", "#f0c493");
    lamp.emissiveColor.set(.51, .26, .10);

    this.buildFloor(stage);
    this.box("Exchange tunnel wall", 28, 5.4, .45, 0, 2.7, 6, concrete);
    this.box("Overhead service band", 27, .48, .58, 0, 4.53, 5.56, blackSteel);
    this.box("Grease trap skirting", 27, .41, .28, 0, .215, 5.61, oldPaint);
    this.buildCarriage(blackSteel, steel);
    this.buildSwitchWall(stage, blackSteel, steel, lamp);
    for (const x of [-12.05, -1.9, 11.05]) {
      this.box("Rib pier", .34, 3.6, .72, x, 2.6, 5.27, concrete);
      this.box("Recessed cage lamp", .23, 1.05, .085, x, 3.43, 4.87, lamp);
    }
    for (const z of [4.89, 5.21]) {
      const inRail = this.box("Approach rail", 11.38, .094, .073, -5.9, .09, z, steel);
      inRail.rotation.y = -.045;
      const tornRail = this.box("Torn turnout blade", 3.36, .088, .069, 1.78, .13, z + .09, steel);
      tornRail.rotation.y = .13;
      tornRail.rotation.z = -.041;
      this.box("Return rail", 6.73, .094, .073, 7.01, .09, z, steel);
    }
    for (let x = -11.04; x < 11; x += .72) {
      this.box("Rail sleeper", .22, .076, .64, x, .04, 5.05, blackSteel);
    }
    for (const marker of markers) this.buildStation(marker, oldPaint, blackSteel, steel);
  }

  private material(name: string, color: string) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor.set(.14, .12, .1);
    this.surfaces.push(material);
    return material;
  }

  private paint(name: string, width: number, height: number) {
    const material = this.material(name, "#ffffff");
    const texture = new DynamicTexture(name, { width, height }, this.scene, true);
    material.diffuseTexture = texture;
    return { material, texture, ctx: texture.getContext() };
  }

  private box(name: string, width: number, height: number, depth: number, x: number, y: number, z: number,
    material: StandardMaterial, parent = this.root) {
    const box = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    box.parent = parent; box.position.set(x, y, z); box.material = material;
    return box;
  }

  private panel(name: string, width: number, height: number, x: number, y: number, z: number,
    material: StandardMaterial, parent = this.root) {
    const panel = MeshBuilder.CreatePlane(name, { width, height }, this.scene);
    panel.parent = parent; panel.position.set(x, y, z); panel.material = material;
    return panel;
  }

  private buildFloor(stage: number) {
    const { material, texture, ctx } = this.paint("Exchange worn floor", 512, 256);
    ctx.fillStyle = "#464947"; ctx.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
      const x = col * 64, y = row * 64;
      const patch = ctx.createLinearGradient(x, y, x + 22, y + 64);
      patch.addColorStop(0, (row + col) % 3 ? "#7f796b" : "#777568");
      patch.addColorStop(1, "#595c52");
      ctx.fillStyle = patch; ctx.fillRect(x + 1, y + 1, 62, 62);
      ctx.fillStyle = "#b0a89652"; ctx.fillRect(x + 4, y + 3, 56, 1);
    }
    ctx.fillStyle = "#ad7858"; ctx.fillRect(0, 122, 512, 3);
    ctx.fillStyle = "#b09a61"; ctx.fillRect(0, 115, 512, 1);
    if (stage === 1) {
      ctx.strokeStyle = "#484946"; ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(60, 136); ctx.lineTo(139, 125); ctx.lineTo(176, 134); ctx.lineTo(236, 119);
      ctx.lineTo(305, 139); ctx.lineTo(351, 124); ctx.lineTo(422, 128); ctx.stroke();
    }
    texture.update();
    const floor = MeshBuilder.CreateGround("Exchange service deck", { width: 36, height: 20 }, this.scene);
    floor.parent = this.root; floor.position.z = -3.7; floor.material = material;
  }

  private buildCarriage(underframe: StandardMaterial, steel: StandardMaterial) {
    const body = new TransformNode("Fire-damaged switch car", this.scene);
    body.parent = this.root; body.position.set(-7.0, .24, 5.27); body.rotation.set(-.04, -.027, .084);
    const side = this.material("Sand green carriage enamel", "#767868");
    const profile = [[0, -.45], [.31, -.58], [1.92, -.58], [2.20, -.42], [2.25, .34], [1.94, .52], [.22, .52], [0, .34]];
    const pathArray = profile.map(([y, z]) => [new Vector3(-4.7, y, z), new Vector3(4.1, y, z)]);
    const shell = MeshBuilder.CreateRibbon("Rounded railway car shell", { pathArray, closeArray: true, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    shell.parent = body; shell.material = side;
    this.box("Broken coupling", .8, .15, .22, 4.38, .35, -.11, underframe, body);
    this.box("Railcar axle frame", 8.2, .25, .93, -.22, .04, -.03, underframe, body);
    this.box("Peeled steel nose", .055, 1.47, 1.04, 4.1, 1.06, -.025, steel, body).rotation.x = -.07;

    const { material, texture, ctx } = this.paint("Scorched carriage windows and doors", 512, 128);
    const paint = ctx.createLinearGradient(0, 0, 0, 128);
    paint.addColorStop(0, "#a4a691"); paint.addColorStop(.42, "#858b78"); paint.addColorStop(1, "#646b62");
    ctx.fillStyle = paint; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = "#87594a"; ctx.fillRect(0, 77, 512, 13);
    ctx.fillStyle = "#bea67d"; ctx.fillRect(0, 78, 512, 1);
    ctx.fillStyle = "#474845"; ctx.fillRect(0, 112, 512, 16);
    for (const x of [14, 75, 136, 288, 348, 410]) {
      ctx.fillStyle = "#a6ad99"; ctx.fillRect(x, 16, 52, 51);
      ctx.fillStyle = "#293e41"; ctx.fillRect(x + 3, 19, 46, 45);
      ctx.fillStyle = "#60726c"; ctx.fillRect(x + 4, 24, 44, 4);
    }
    ctx.fillStyle = "#364044"; ctx.fillRect(197, 5, 69, 118);
    ctx.fillStyle = "#888978"; ctx.fillRect(197, 5, 21, 118);
    ctx.fillStyle = "#565952"; ctx.fillRect(217, 5, 7, 118);
    ctx.fillStyle = "#cfba89"; ctx.font = "bold 16px Tahoma"; ctx.fillText("SVC 04", 436, 107, 72);
    for (const [x, y, width] of [[188, 69, 98], [258, 33, 62], [268, 40, 52], [247, 95, 100]]) {
      ctx.fillStyle = "#3d413f78"; ctx.fillRect(x, y, width, 2);
    }
    texture.update();
    this.panel("Service car enamel", 8.78, 1.59, -.3, 1.113, -.587, material, body);
  }

  private buildSwitchWall(stage: number, dark: StandardMaterial, steel: StandardMaterial, lamp: StandardMaterial) {
    this.box("Route interlocking cabinet", 9.9, 2.72, .57, 5.8, 1.53, 5.62, dark);
    this.box("Route interlocking cap", 10.19, .15, .68, 5.8, 2.925, 5.54, steel);
    this.box("Route work light", 8.56, .073, .115, 5.8, 2.875, 5.15, lamp);
    const { material, texture, ctx } = this.paint("Control wall route map", 512, 128);
    ctx.fillStyle = "#414948"; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = "#926c57"; ctx.strokeRect(5, 5, 502, 118);
    ctx.strokeStyle = "#cbb78b"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(32, 88); ctx.lineTo(230, 88); ctx.lineTo(277, 49); ctx.lineTo(478, 49); ctx.stroke();
    ctx.strokeStyle = "#84998b"; ctx.beginPath(); ctx.moveTo(32, 66); ctx.lineTo(241, 66);
    ctx.lineTo(284, 96); ctx.lineTo(478, 96); ctx.stroke();
    ctx.fillStyle = "#ded3a9"; ctx.font = "bold 18px Tahoma"; ctx.fillText("TRANSFER 04  /  INTERLOCKING", 28, 33);
    ctx.fillStyle = "#aa6954"; ctx.fillRect(237, 81, 13, 12);
    for (const x of [38, 94, 156, 306, 366, 439]) {
      ctx.fillStyle = "#293937"; ctx.fillRect(x, 100, 15, 13);
      ctx.fillStyle = x === 306 ? "#b29a61" : "#839a80"; ctx.fillRect(x + 3, 104, 9, 5);
    }
    material.emissiveColor.set(.12, .09, .056);
    texture.update();
    this.panel("Enamel interlocking diagram", 9.3, 2.32, 5.8, 1.59, 5.326, material);

    const fascia = this.paint("Dead Line fascia", 512, 64);
    fascia.ctx.fillStyle = "#4d4338"; fascia.ctx.fillRect(0, 0, 512, 64);
    fascia.ctx.strokeStyle = "#b7906c"; fascia.ctx.strokeRect(4, 4, 504, 56);
    fascia.ctx.fillStyle = "#e0d1aa"; fascia.ctx.font = "bold 28px Tahoma";
    fascia.ctx.fillText("DEAD LINE EXCHANGE", 21, 42, 294);
    fascia.ctx.fillStyle = "#b48d66"; fascia.ctx.fillRect(334, 12, 2, 40);
    fascia.ctx.font = "bold 19px Tahoma"; fascia.ctx.fillText(sectionNames[stage] ?? sectionNames[0], 345, 40, 145);
    fascia.material.emissiveColor.set(.21, .15, .095);
    fascia.texture.update();
    this.panel("Exchange section fascia", 13.8, .82, 0, 3.93, 4.78, fascia.material);
  }

  private buildStation(marker: Marker, enamel: StandardMaterial, dark: StandardMaterial, steel: StandardMaterial) {
    const { id, x, z } = marker;
    this.box(id + " black plinth", 1.45, .16, .81, x, .085, z + .14, dark);
    this.box(id + " sloped worktop", 1.31, .16, .70, x, .43, z + .14, steel).rotation.x = -.13;
    this.box(id + " supports", 1.21, .34, .52, x, .22, z + .17, enamel);
    const signal = this.material(id + " status lamp", "#695e58");
    const ring = MeshBuilder.CreateTorus(id + " locator", { diameter: 1.76, thickness: .05, tessellation: 16 }, this.scene);
    ring.parent = this.root; ring.position.set(x, .03, z); ring.material = signal;
    this.box(id + " lamp aperture", .94, .068, .077, x, .48, z - .219, signal);
    this.stations.push(signal);
    if (id === "exchange-transfer") {
      const selector = MeshBuilder.CreateCylinder("Brass rotary selector", { height: .11, diameter: .43, tessellation: 12 }, this.scene);
      selector.parent = this.root; selector.position.set(x - .21, .52, z + .14); selector.material = dark;
      this.box("White selector index", .28, .048, .077, x - .21, .583, z + .14, steel).rotation.y = -.52;
      for (const dx of [.18, .36]) this.box("Route key", .10, .078, .12, x + dx, .53, z + .12, signal);
      return;
    }
    const paper = this.material("Manila log leaves", "#e5d2a5");
    const ink = this.material("Ink on log", "#7a6d55");
    const binding = this.box("Crew log folio", .75, .057, .34, x, .539, z + .12, enamel);
    binding.rotation.y = -.11;
    this.box("Log pages", .64, .028, .29, x, .578, z + .12, paper).rotation.y = -.11;
    for (const dx of [-.15, .15]) for (const dz of [-.06, .015, .081]) {
      this.box("Handwritten crew entry", .21, .004, .015, x + dx, .594, z + .12 + dz, ink).rotation.y = -.11;
    }
  }

  update(world: WorldView) {
    for (const signal of this.stations) {
      if (world.status === "signal" || world.status === "complete") {
        signal.diffuseColor.set(.68, .81, .51);
        signal.emissiveColor.set(.3, .49, .16);
      } else {
        signal.diffuseColor.set(.44, .35, .3);
        signal.emissiveColor.set(.16, .068, .045);
      }
    }
  }

  dispose() {
    for (const material of this.surfaces) material.dispose(false, true);
  }
}
