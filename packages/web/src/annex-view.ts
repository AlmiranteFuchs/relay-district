import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, VertexData, type Scene } from "@babylonjs/core";
import { ANNEX_CASE_HOME, ANNEX_FILING_DESK } from "../../shared/src/scene.ts";
import type { WorldView } from "./view.ts";

export class AnnexScenery {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly materials: StandardMaterial[] = [];
  private readonly board: DynamicTexture;
  private readonly deskDisplay: DynamicTexture;
  private readonly deskLamp: StandardMaterial;
  private readonly caseHandle: TransformNode;
  private readonly locator: Mesh;
  private lastBoard = "";
  private lastDesk = "";

  constructor(scene: Scene, root: TransformNode) {
    this.scene = scene;
    this.root = root;
    const rose = this.material("Municipal oxblood enamel", "#775557");
    const teal = this.material("Dusty file cabinet teal", "#527d7e");
    const chrome = this.material("Desk worn nickel", "#8d9790");
    const bone = this.material("Beige counter Formica", "#b8b29e");
    const dark = this.material("Smoked Registry steel", "#394e53");

    this.hall(rose, teal, chrome, bone, dark);
    this.cabinets(teal, chrome, dark);
    const service = this.paint("East clerk service card", 128, 64, true);
    this.deskDisplay = service.texture;
    this.deskLamp = this.material("Registry clerk slot lamp", "#978267");
    this.serviceDesks(rose, teal, chrome, bone, dark, service.material);
    this.caseHandle = this.makeRosterCase(chrome, bone, dark);
    const red = this.material("Case finder bulb", "#eca377");
    red.emissiveColor.set(.39, .17, .079);
    this.locator = MeshBuilder.CreateTorus("Loose roster case locator", { diameter: 1.64, thickness: .056, tessellation: 18 }, scene);
    this.locator.parent = root; this.locator.material = red; this.locator.setEnabled(false);

    const board = this.paint("Registry office wall board", 512, 96, true);
    this.board = board.texture;
    this.box("Registry fascia frame", 12.48, 1.24, .23, 0, 4.19, 4.95, dark);
    this.face("Registry fascia lettering", 12.26, 1.10, 0, 4.19, 4.82, board.material);
  }

  private material(name: string, color: string) {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor.set(.14, .12, .115);
    material.specularPower = 40;
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

  private face(name: string, width: number, height: number, x: number, y: number, z: number, material: StandardMaterial, parent = this.root) {
    const mesh = MeshBuilder.CreatePlane(name, { width, height }, this.scene);
    mesh.parent = parent; mesh.position.set(x, y, z); mesh.material = material;
    return mesh;
  }

  private hall(rose: StandardMaterial, teal: StandardMaterial, chrome: StandardMaterial, bone: StandardMaterial, dark: StandardMaterial) {
    const { material, texture, ctx } = this.paint("Dusty Registry linoleum", 512, 256);
    ctx.fillStyle = "#555858"; ctx.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
      const x = col * 64, y = row * 64;
      const tile = ctx.createLinearGradient(x, y, x + 31, y + 64);
      tile.addColorStop(0, (row + col) % 2 ? "#8d8f83" : "#959587");
      tile.addColorStop(1, "#737a78");
      ctx.fillStyle = tile; ctx.fillRect(x + 1, y + 1, 62, 62);
      ctx.fillStyle = "#bab6a568"; ctx.fillRect(x + 3, y + 2, 57, 1);
    }
    ctx.fillStyle = "#7b8886"; ctx.fillRect(0, 117, 512, 3);
    ctx.fillStyle = "#9c837a"; ctx.fillRect(0, 141, 512, 3);
    texture.update();
    const floor = MeshBuilder.CreateGround("Registry contact floor", { width: 34, height: 20 }, this.scene);
    floor.parent = this.root; floor.position.z = -3.02; floor.material = material;

    this.box("Registry municipal partition", 29, 6.31, .38, 0, 3.13, 6.05, rose);
    this.box("Pale plaster above the file alcove", 28.95, 4.08, .13, 0, 3.67, 5.83, bone);
    this.box("Maroon corridor dado", 29, .77, .26, 0, .395, 5.78, rose);
    this.box("Registry quarter round", 29, .096, .28, 0, .814, 5.76, teal);
    this.box("Dark Registry skirting", 29, .14, .24, 0, .099, 5.81, dark);
    for (const x of [-12.4, -1.3, 1.2, 12.4]) {
      this.box("Office partition mullion", .34, 5.28, .38, x, 2.63, 5.66, teal);
      this.box("Registry pillar nickel trim", .075, 4.39, .055, x, 2.91, 5.433, chrome);
    }

    const pane = this.paint("Registry counter etched wireglass", 256, 128);
    const glaze = pane.ctx.createLinearGradient(0, 0, 0, 128);
    glaze.addColorStop(0, "#8ba49b"); glaze.addColorStop(.38, "#a9b5a2"); glaze.addColorStop(1, "#556f73");
    pane.ctx.fillStyle = glaze; pane.ctx.fillRect(0, 0, 256, 128);
    pane.ctx.fillStyle = "#3a565b"; pane.ctx.fillRect(0, 94, 256, 34);
    for (const x of [2, 83, 170, 252]) pane.ctx.fillRect(x, 0, 4, 128);
    pane.ctx.fillStyle = "#d0d4b57a";
    for (const x of [21, 107, 198]) { pane.ctx.fillRect(x, 16, 42, 8); pane.ctx.fillRect(x, 29, 28, 2); }
    pane.ctx.fillStyle = "#a1b1a5"; pane.ctx.font = "bold 14px Tahoma"; pane.ctx.fillText("SERVICE WINDOWS  /  01   02   03", 19, 116, 227);
    pane.texture.update();
    this.box("Registry window iron reveal", 9.37, 2.98, .39, 7.05, 2.31, 5.62, dark);
    this.face("Three clerk service windows", 9.03, 2.42, 7.05, 2.39, 5.414, pane.material);
    this.box("Counter window sill", 9.41, .16, .72, 7.05, 1.071, 5.32, chrome);
    this.box("Counter bin apron", 9.43, .78, .38, 7.05, .49, 5.51, rose);
    for (const x of [-10.6, -5.04, 4.18, 9.92]) {
      this.box("Registry milk-glass lamp", 2.25, .115, .14, x, 3.88, 5.40, bone);
    }
  }

  private cabinets(teal: StandardMaterial, chrome: StandardMaterial, dark: StandardMaterial) {
    const { material, texture, ctx } = this.paint("Painted card file drawers", 128, 128);
    ctx.fillStyle = "#344d50"; ctx.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 2; col++) {
      const x = col * 64, y = row * 25.6;
      const enamel = ctx.createLinearGradient(0, y, 0, y + 25.6);
      enamel.addColorStop(0, "#78948b"); enamel.addColorStop(1, "#50757a");
      ctx.fillStyle = enamel; ctx.fillRect(x + 2, y + 2, 60, 21);
      ctx.fillStyle = "#adc1a97c"; ctx.fillRect(x + 4, y + 3, 56, 1);
      ctx.fillStyle = "#b4aa8b"; ctx.fillRect(x + 12, y + 7, 15, 7);
      ctx.fillStyle = "#716f63"; ctx.fillRect(x + 14, y + 9, 9 + row % 3, 1);
      ctx.fillStyle = "#354d52"; ctx.fillRect(x + 35, y + 10, 13, 3);
    }
    texture.update();
    for (const x of [-10.65, -7.38, -4.1]) {
      this.box("Paper registry drawer cabinet", 2.99, 2.79, .66, x, 1.61, 5.58, teal);
      this.box("Cabinet support shoe", 3.06, .18, .71, x, .235, 5.56, dark);
      this.box("Cabinet chromium cap", 3.04, .095, .71, x, 3.036, 5.55, chrome);
      this.face("Registry indexed paper drawer faces", 2.87, 2.60, x, 1.629, 5.241, material);
      for (const row of [0, 1, 2, 3, 4]) for (const dx of [-.47, .97]) {
        this.box("Physical drawer pull", .23, .045, .061, x + dx, 2.72 - row * .523, 5.193, chrome);
      }
    }
  }

  private serviceDesks(rose: StandardMaterial, teal: StandardMaterial, chrome: StandardMaterial, bone: StandardMaterial, dark: StandardMaterial,
    display: StandardMaterial) {
    const home = ANNEX_CASE_HOME, desk = ANNEX_FILING_DESK;
    this.box("Intake parcel floor plate", 1.55, .044, .91, home.x, .026, home.z + .028, rose);
    this.box("Intake stripe", 1.35, .017, .08, home.x, .055, home.z + .356, chrome);
    this.box("Records counter base", 1.84, .56, .82, desk.x, .294, desk.z + .13, teal);
    this.box("Counter oxblood apron", 1.76, .22, .13, desk.x, .464, desk.z - .34, rose);
    this.box("Records counter surface", 2.0, .127, .92, desk.x, .638, desk.z + .12, bone);
    this.box("Records niche frame", 1.35, .12, .18, desk.x, .435, desk.z - .402, dark);
    this.face("Records desk filing card", 1.49, .406, desk.x, .501, desk.z - .555, display).rotation.x = .54;
    this.box("Records counter transaction lamp", 1.02, .065, .062, desk.x, .254, desk.z - .32, this.deskLamp);
    this.box("Ready-use inkwell", .16, .13, .146, desk.x + .72, .764, desk.z + .32, dark);
  }

  private makeRosterCase(chrome: StandardMaterial, bone: StandardMaterial, dark: StandardMaterial) {
    const handle = new TransformNode("Portable roster case", this.scene);
    handle.parent = this.root;
    handle.setEnabled(false);
    const enamel = this.material("Crimson roster-case enamel", "#b85f57");
    enamel.emissiveColor.set(.20, .045, .03);
    const outline = [[-.41, .083], [-.34, 0], [.34, 0], [.41, .083], [.41, .42], [.34, .49], [-.34, .49], [-.41, .42]];
    const positions = outline.flatMap(([x, y]) => [x, y, -.171, x, y, .171]);
    const indices: number[] = [];
    for (let i = 0; i < outline.length; i++) {
      const a = i * 2;
      const next = ((i + 1) % outline.length) * 2;
      indices.push(a, a + 1, next, next, a + 1, next + 1);
      if (i > 0 && i < outline.length - 1) indices.push(0, next, a, 1, a + 1, next + 1);
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData();
    data.positions = positions; data.indices = indices; data.normals = normals;
    const shell = new Mesh("Clipped crimson carrying case", this.scene);
    data.applyToMesh(shell); shell.parent = handle; shell.material = enamel;
    enamel.backFaceCulling = false;
    this.box("Case carrying grip", .39, .084, .13, 0, .626, 0, dark, handle);
    for (const x of [-.151, .151]) this.box("Case handle anchor", .061, .143, .069, x, .535, 0, chrome, handle);
    for (const dx of [-.27, .27]) this.box("Case brass buckle", .108, .088, .052, dx, .393, -.183, chrome, handle);
    this.box("Case rubber bottom bumper", .69, .037, .30, 0, .029, 0, dark, handle);
    this.box("Case ivory docket label", .39, .18, .035, 0, .233, -.181, bone, handle);
    for (const y of [.266, .222, .197]) this.box("Printed docket entry", y === .266 ? .244 : .179, .021, .014, -.013, y, -.2, dark, handle);
    return handle;
  }

  update(world: WorldView, renderedCarrier?: { x: number; y: number; z: number }) {
    const placed = world.rosterCase;
    const carrier = placed?.carrier ? world.actors.get(placed.carrier) : undefined;
    const filed = !!placed?.filed;
    this.caseHandle.setEnabled(Boolean(placed));
    this.locator.setEnabled(Boolean(placed && !carrier && !filed));
    if (placed) {
      if (filed) {
        this.caseHandle.position.set(placed.x, .71, placed.z + .12);
        this.caseHandle.rotation.set(0, -.16, 0);
      } else if (carrier) {
        const position = renderedCarrier ?? carrier;
        this.caseHandle.position.set(position.x + carrier.facing * .32, position.y + .49, position.z - .23);
        this.caseHandle.rotation.set(.12, carrier.facing * .16, carrier.facing * -.12);
      } else {
        const atIntake = Math.hypot(placed.x - ANNEX_CASE_HOME.x, placed.z - ANNEX_CASE_HOME.z) < .07;
        this.caseHandle.position.set(placed.x, atIntake ? .052 : .012, placed.z);
        this.caseHandle.rotation.set(0, 0, 0);
        this.locator.position.set(placed.x, .026, placed.z);
      }
    }

    const ready = world.stage === 2 && world.status === "signal";
    const note = filed ? "FILED" : ready ? "FILE CASE" : "HOLD";
    if (note !== this.lastDesk) {
      this.lastDesk = note;
      const ctx = this.deskDisplay.getContext();
      const ink = ready || filed ? "#daedb6" : "#d2c3a3";
      this.deskLamp.diffuseColor.copyFrom(Color3.FromHexString(ready || filed ? "#aacc78" : "#8d7f6b"));
      this.deskLamp.emissiveColor.copyFrom(this.deskLamp.diffuseColor).scaleInPlace(ready || filed ? .55 : .13);
      ctx.fillStyle = ready || filed ? "#365543" : "#4e4a41"; ctx.fillRect(0, 0, 128, 64);
      ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.strokeRect(4, 4, 120, 56);
      ctx.fillStyle = ink; ctx.font = "bold 18px Tahoma"; ctx.fillText("RECORDS DESK", 10, 25, 111);
      ctx.font = "bold 22px Tahoma"; ctx.fillText(note, 10, 50, 108);
      this.deskDisplay.update();
    }

    const message = filed ? "RECORDS DESK / CASE FILED" : carrier ? "CASE IN TRANSIT / " + (ready ? "FILE AT EAST DESK" : "KEEP THE CARRIER CLEAR")
      : !placed ? "WEST INTAKE / SERVICE HOLD" : world.stage === 1 ? "WEST INTAKE / COLLECT THE ROSTER CASE" : "ROSTER CASE ON FLOOR / RECOVER";
    if (message === this.lastBoard) return;
    this.lastBoard = message;
    const ctx = this.board.getContext();
    ctx.fillStyle = "#394f52"; ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = "#a9b5a4"; ctx.strokeRect(4, 4, 504, 88);
    ctx.fillStyle = "#e8dec3"; ctx.font = "bold 29px Tahoma"; ctx.fillText("REGISTRY ANNEX", 18, 41, 256);
    ctx.fillStyle = "#d7b9a4"; ctx.font = "bold 16px Tahoma"; ctx.fillText("SOUTH WALL / CIVIC RECORDS", 288, 39, 200);
    ctx.fillStyle = filed ? "#385449" : "#3c454b"; ctx.fillRect(12, 52, 488, 33);
    ctx.fillStyle = filed ? "#dbedb4" : "#ecd5ac"; ctx.font = "bold 20px Tahoma";
    ctx.fillText(message, 21, 76, 469);
    this.board.update();
  }

  dispose() {
    for (const material of this.materials) material.dispose(false, true);
  }
}
