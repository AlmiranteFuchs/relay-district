import { ArraySchema, defineTypes, MapSchema, Schema } from "@colyseus/schema";
import type { CrewAssist } from "../../shared/src/crew-assists.ts";

export class ActorState extends Schema {
  declare x: number;
  declare y: number;
  declare z: number;
  declare facing: number;
  declare name: string;
  declare companion: string;
  declare family: string;
  declare kind: string;
  declare hp: number;
  declare maxHp: number;
  declare energy: number;
  declare armed: boolean;
  declare connected: boolean;
  declare phase: string;
  declare age: number;
  declare duration: number;
  declare combo: number;
  declare step: number;
  declare ack: number;
  declare moving: boolean;
  declare rank: number;
  declare rescued: boolean;
  declare rescueTarget: string;
  declare rescueTicks: number;
  declare signalTag: boolean;
  declare bayFourTicket: boolean;
  declare relayPennant: boolean;
  declare bellhouseSeal: boolean;

  constructor() {
    super();
    Object.assign(this, { x: 0, y: 0, z: 0, facing: 1, name: "", companion: "", family: "moth", kind: "player",
      hp: 125, maxHp: 125, energy: 100, armed: false, connected: true, phase: "idle", age: 0,
      duration: 0, combo: 0, step: 0, ack: 0, moving: false, rank: 1, rescued: false, rescueTarget: "", rescueTicks: 0,
      signalTag: false, bayFourTicket: false, relayPennant: false, bellhouseSeal: false });
  }
}
defineTypes(ActorState, {
  x: "float32", y: "float32", z: "float32", facing: "int8", name: "string", companion: "string",
  family: "string", kind: "string", hp: "uint16", maxHp: "uint16", energy: "float32",
  armed: "boolean", connected: "boolean", phase: "string", age: "uint16", duration: "uint16",
  combo: "uint16", step: "uint8", ack: "uint32", moving: "boolean", rank: "uint16",
  rescued: "boolean", rescueTarget: "string", rescueTicks: "uint8", signalTag: "boolean", bayFourTicket: "boolean", relayPennant: "boolean",
  bellhouseSeal: "boolean",
});

export class CrewAssistState extends Schema implements CrewAssist {
  declare kind: CrewAssist["kind"];
  declare source: string;
  declare target: string;
  declare station: string;

  constructor() {
    super();
    Object.assign(this, { kind: "call", source: "", target: "", station: "" });
  }
}
defineTypes(CrewAssistState, { kind: "string", source: "string", target: "string", station: "string" });

export class GameState extends Schema {
  declare kind: string;
  declare mission: string;
  declare status: string;
  declare code: string;
  declare leader: string;
  declare stage: number;
  declare wave: number;
  declare readerMask: number;
  declare readerUntil: number;
  declare frame: number;
  declare practice: boolean;
  declare actors: MapSchema<ActorState>;
  declare crewAssists: ArraySchema<CrewAssistState>;
  constructor() {
    super();
    Object.assign(this, { kind: "plaza", mission: "", status: "plaza", code: "", leader: "",
      stage: 0, wave: 0, readerMask: 0, readerUntil: 0, frame: 0, practice: false, actors: new MapSchema<ActorState>(),
      crewAssists: new ArraySchema<CrewAssistState>() });
  }
}
defineTypes(GameState, {
  kind: "string", mission: "string", status: "string", code: "string", leader: "string",
  stage: "uint8", wave: "uint8", readerMask: "uint8", readerUntil: "uint32", frame: "uint32", practice: "boolean", actors: { map: ActorState },
  crewAssists: { array: CrewAssistState },
});
