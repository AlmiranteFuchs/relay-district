import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, type Scene } from "@babylonjs/core";
import type { Marker } from "../../shared/src/scene.ts";
import type { WorldView } from "./view.ts";

const arrivalSeconds = 4.2;
const dwellSeconds = 1.5;
const departureSeconds = 3.2;
const trainStart = -29;
const trainStop = .45;
const trainExit = 34;

export class DepartureScenery {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly previousSky;
  private readonly materials: StandardMaterial[] = [];
  private readonly stations: StandardMaterial[] = [];
  private readonly train: TransformNode;
  private readonly board: DynamicTexture;
  private boardText = "";
  private arrivalAt?: number;

  constructor(scene: Scene, root: TransformNode, markers: Marker[]) {
    this.scene = scene;
    this.root = root;
    this.previousSky = scene.clearColor.clone();
    scene.clearColor.set(.42, .55, .62, 1);
    const enamel = this.material("Bay blue enamel", "#557980");
    const trim = this.material("Bay faded cream", "#c5bf9d");
    const metal = this.material("Bay rail steel", "#52616a");
    const warm = this.material("Canopy fluorescent tube", "#d8d4a1");
    warm.emissiveColor.set(.32, .31, .15);

    this.skyline();
    this.platform();
    this.box("Far track bed", 45, .19, 2.56, 0, -.19, 5.93, metal);
    for (let x = -20; x < 21; x += .79) this.box("Bay tie", .22, .055, 1.74, x, -.071, 5.83, enamel);
    for (const z of [5.18, 6.32]) this.box("Bay rail", 45, .082, .084, 0, -.027, z, trim);
    this.box("Far inspection walk", 45, .28, .84, 0, -.135, 7.3, enamel);
    const canopy = this.box("Bay platform canopy", 32, .23, 2.12, 0, 4.88, 7.35, enamel);
    canopy.rotation.x = -.075;
    this.box("Canopy fascia", 32.1, .25, .15, 0, 4.858, 6.27, trim);
    for (const x of [-12.4, -6.25, -.1, 6.05, 12.2]) {
      this.box("Canopy support", .21, 5.02, .23, x, 2.35, 7.4, metal);
      this.box("Canopy footing", .39, .35, .39, x, .06, 7.4, metal);
      const brace = this.box("Canopy knee brace", .135, .88, .15, x + .31, 4.45, 7.36, metal);
      brace.rotation.z = -.68;
      this.box("Canopy work lamp", 2.55, .061, .16, x + 1.5, 4.68, 6.62, warm);
      this.box("Far safety fence post", .06, 1.02, .07, x, .43, 7.68, metal);
    }
    for (const y of [.37, .83]) this.box("Far safety fence rail", 30, .052, .08, 0, y, 7.68, metal);

    const { material, texture } = this.paint("Mechanical departure board", 512, 96);
    material.diffuseTexture = null;
    material.emissiveTexture = texture;
    material.disableLighting = true;
    this.board = texture;
    this.box("Departure board housing", 12.72, 1.26, .26, 0, 3.93, 6.7, metal);
    this.face("Departure board lettering", 12.51, 1.08, 0, 3.93, 6.56, material);
    this.box("Board hanger", 12, .77, .12, 0, 4.43, 6.74, metal);
    this.train = this.buildTrain(metal);
    for (const marker of markers) this.station(marker, enamel, metal, trim);
  }

  private material(name: string, color: string) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor.set(.10, .12, .12);
    this.materials.push(material);
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

  private skyline() {
    const { material, texture, ctx } = this.paint("Dawn across the pump district", 512, 128);
    material.diffuseTexture = null;
    material.emissiveTexture = texture;
    material.disableLighting = true;
    const sky = ctx.createLinearGradient(0, 0, 0, 100);
    sky.addColorStop(0, "#7898a4"); sky.addColorStop(.57, "#a7b6b1"); sky.addColorStop(1, "#ddc2a3");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 512, 128);
    for (const [base, color, widths] of [
      [89, "#879b9b", [8, 10, 34, 17, 13, 37, 12, 25, 43, 10, 26, 16, 43, 25, 12, 35, 28, 41, 37, 17]],
      [104, "#687d83", [22, 24, 13, 30, 15, 34, 21, 38, 30, 27, 14, 27, 31, 24, 38, 30, 48, 25]],
    ] as const) {
      let x = 0;
      ctx.fillStyle = color; ctx.fillRect(0, base, 512, 128 - base);
      for (const width of widths) {
        const height = 8 + (x * 7 % 19);
        ctx.fillRect(x, base - height, width, height + 1);
        x += width + (x % 4) + 2;
      }
    }
    ctx.fillStyle = "#5c7279"; ctx.fillRect(0, 114, 512, 14);
    ctx.fillStyle = "#afaaa09c"; ctx.fillRect(0, 114, 512, 3);
    for (const x of [103, 232, 401]) {
      ctx.fillStyle = "#71848a"; ctx.fillRect(x, 66, 3, 38); ctx.fillRect(x - 8, 72, 19, 2);
    }
    texture.update();
    this.face("Painted city horizon", 96, 14.4, 0, 4, 24, material);
  }

  private platform() {
    const { material, texture, ctx } = this.paint("Worn transit platform tiles", 512, 256);
    ctx.fillStyle = "#445560"; ctx.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
      const x = col * 64, y = row * 64;
      const stone = ctx.createLinearGradient(x, y, x + 40, y + 64);
      stone.addColorStop(0, (row + col) % 2 ? "#8c9fa0" : "#93a4a0");
      stone.addColorStop(1, "#637c82");
      ctx.fillStyle = stone; ctx.fillRect(x + 1, y + 1, 62, 62);
      ctx.fillStyle = "#cad1b74d"; ctx.fillRect(x + 2, y + 3, 60, 1);
    }
    texture.update();
    const floor = MeshBuilder.CreateGround("Bay 4 walkable platform", { width: 36, height: 20 }, this.scene);
    floor.parent = this.root; floor.position.z = -5.15; floor.material = material;
    const band = this.material("Bay platform safety yellow", "#cbb274");
    const lip = this.material("Bay platform lip", "#617982");
    this.box("Platform edge face", 36, .18, .12, 0, -.083, 4.84, lip);
    this.box("Platform edge stripe", 36, .025, .16, 0, .015, 4.56, band);
    for (let x = -11.5; x < 12; x += .59) this.box("Tactile paving", .26, .031, .06, x, .017, 4.36, band);
  }

  private buildTrain(underframe: StandardMaterial) {
    const train = new TransformNode("Bay 4 arriving train", this.scene);
    train.parent = this.root; train.position.set(trainStart, -.035, 5.83); train.setEnabled(false);
    const body = this.material("Train dawn enamel", "#819993");
    const crossSection = [[.38, -.47], [.55, -.60], [1.96, -.60], [2.37, -.43], [2.47, .04],
      [2.36, .43], [1.91, .61], [.56, .60], [.38, .46]];
    const paths = crossSection.map(([y, z]) => [new Vector3(-10, y, z), new Vector3(6.21, y, z),
      new Vector3(6.73, y * .79, z * .86)]);
    const hull = MeshBuilder.CreateRibbon("Curved copper line train", { pathArray: paths, closeArray: true, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    hull.parent = train; hull.material = body;
    this.box("Train trailing coupling", 15.98, .23, 1.03, -1.93, .282, 0, underframe, train);
    this.box("Rounded train cab end", .075, 1.53, .93, 6.67, 1.108, 0, body, train);
    const lamp = this.material("Train cab lamps", "#f4d691");
    lamp.emissiveColor.set(.42, .28, .11);
    for (const z of [-.38, .38]) this.box("Train headlamp", .09, .18, .125, 6.724, .69, z, lamp, train);

    const { material, texture, ctx } = this.paint("First Departure cabin windows", 512, 80);
    const green = ctx.createLinearGradient(0, 0, 0, 80);
    green.addColorStop(0, "#adc1aa"); green.addColorStop(.33, "#a0b59f"); green.addColorStop(1, "#708e87");
    ctx.fillStyle = green; ctx.fillRect(0, 0, 512, 80);
    ctx.fillStyle = "#b88659"; ctx.fillRect(0, 53, 512, 13);
    ctx.fillStyle = "#e1c393"; ctx.fillRect(0, 54, 512, 2);
    for (const x of [15, 71, 127, 221, 277, 370, 426]) {
      ctx.fillStyle = "#77908b"; ctx.fillRect(x, 13, 43, 31);
      ctx.fillStyle = "#314950"; ctx.fillRect(x + 2, 15, 39, 27);
      ctx.fillStyle = "#729393"; ctx.fillRect(x + 4, 18, 35, 3);
    }
    for (const x of [179, 329]) {
      ctx.fillStyle = "#557d7e"; ctx.fillRect(x, 5, 31, 71);
      ctx.fillStyle = "#203c42"; ctx.fillRect(x + 3, 10, 25, 31);
      ctx.fillStyle = "#96a99c"; ctx.fillRect(x + 15, 7, 1, 67);
    }
    ctx.fillStyle = "#415d64"; ctx.fillRect(477, 15, 22, 20);
    ctx.font = "bold 12px Tahoma"; ctx.fillStyle = "#f0d6a1"; ctx.fillText("04", 481, 30, 16);
    texture.update();
    this.face("First Departure copper line livery", 16.13, 1.39, -1.875, 1.24, -.605, material, train);
    return train;
  }

  private station(marker: Marker, enamel: StandardMaterial, metal: StandardMaterial, trim: StandardMaterial) {
    const { id, x, z } = marker;
    this.box(id + " post", .79, .53, .55, x, .275, z + .082, enamel);
    this.box(id + " bevel", 1.14, .16, .66, x, .55, z + .05, metal).rotation.x = -.19;
    this.box(id + " instrument face", .98, .045, .54, x, .632, z + .039, trim).rotation.x = -.19;
    const signal = this.material(id + " lamp", "#79685a");
    this.box(id + " indicator", .83, .092, .062, x, .556, z - .298, signal);
    if (id === "departure-boarding") {
      this.box("Boarding reader ticket slot", .39, .038, .065, x, .668, z + .06, metal);
      this.box("Boarding reader receipt", .27, .015, .17, x, .671, z - .025, trim);
    } else {
      this.box("Departure signal switch", .13, .093, .223, x - .22, .68, z + .075, metal);
      this.box("Departure signal lens", .24, .06, .16, x + .23, .678, z + .086, signal);
    }
    const ring = MeshBuilder.CreateTorus(id + " locator", { diameter: 1.76, thickness: .054, tessellation: 16 }, this.scene);
    ring.parent = this.root; ring.position.set(x, .033, z); ring.material = signal;
    this.stations.push(signal);
  }

  update(world: WorldView, time: number) {
    const complete = world.status === "complete";
    const ready = world.status === "signal" || complete;
    const title = complete ? this.moveTrain(time)
      : world.stage === 2 && ready ? "BOARDING" : world.stage === 1 && world.wave === 1 ? "LINE HOLD"
      : ready ? "SIGNAL READY" : "ON HOLD";
    if (title === this.boardText) return;
    this.boardText = title;
    const ctx = this.board.getContext();
    ctx.fillStyle = "#243c48"; ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = "#8ba39d"; ctx.strokeRect(4, 4, 504, 88);
    ctx.fillStyle = "#355461"; ctx.fillRect(12, 12, 103, 72);
    ctx.fillStyle = "#e5e5c7"; ctx.font = "bold 27px Tahoma"; ctx.fillText("BAY 4", 21, 57, 85);
    ctx.fillStyle = "#d1ae74"; ctx.font = "bold 24px Tahoma"; ctx.fillText("05:20", 134, 42, 78);
    ctx.fillStyle = "#e6e2c1"; ctx.fillText("FIRST DEPARTURE", 224, 42, 264);
    ctx.fillStyle = "#172f3b"; ctx.fillRect(127, 52, 372, 32);
    ctx.fillStyle = ready ? "#d2e8a8" : "#d5b181"; ctx.font = "bold 19px Tahoma";
    ctx.fillText(title, 134, 74, 354);
    this.board.update();
    for (const material of this.stations) {
      material.diffuseColor.set(ready ? .64 : .46, ready ? .82 : .38, ready ? .52 : .31);
      material.emissiveColor.set(ready ? .27 : .15, ready ? .49 : .083, ready ? .17 : .059);
    }
  }

  private moveTrain(time: number) {
    this.arrivalAt ??= time;
    const elapsed = time - this.arrivalAt;
    if (elapsed < arrivalSeconds) {
      const progress = elapsed / arrivalSeconds;
      this.train.setEnabled(true);
      this.train.position.x = trainStart + (trainStop - trainStart) * (1 - (1 - progress) ** 2.4);
      return "ARRIVING";
    }
    const departureProgress = Math.max(0, (elapsed - arrivalSeconds - dwellSeconds) / departureSeconds);
    if (departureProgress >= 1) {
      this.train.setEnabled(false);
      return "DEPARTED";
    }
    this.train.position.x = trainStop + (trainExit - trainStop) * departureProgress ** 1.72;
    return departureProgress === 0 ? "ARRIVED" : "DEPARTING";
  }

  dispose() {
    this.scene.clearColor.copyFrom(this.previousSky);
    for (const material of this.materials) material.dispose(false, true);
  }
}
