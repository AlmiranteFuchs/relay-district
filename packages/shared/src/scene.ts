import type { Lore, Mission } from "./content.ts";

export interface Marker { id: string; x: number; z: number; title: string; lore?: Lore; readerBit?: number }
export const PLAZA: Marker[] = [
  { id: "workbench", title: "Morph Workbench", x: -6.7, z: 2.8 },
  { id: "room", title: "Companion Room", x: -1.85, z: 3.1 },
  { id: "plaque", title: "Closure Plaque", x: 2.8, z: 3.1, lore: "plaque" },
  { id: "dispatch", title: "Dispatch", x: 7.25, z: 2.65 },
];

export const TERMINAL_READERS_COMPLETE = 0b11;
const terminalMarkers: Marker[] = [
  { id: "outbound-reader", x: -5.8, z: 2.8, title: "Outbound Reader", readerBit: 0b01 },
  { id: "return-reader", x: 1.3, z: -2.5, title: "Return Reader", readerBit: 0b10 },
  { id: "manifest", x: 8.25, z: 2.25, title: "East Terminal Manifest" },
];

export function routeMarkers(mission: Mission, stage: number): Marker[] {
  if (mission === "night") return [{ id: "register", x: 8.25, z: 2.25, title: "Return Register" }];
  if (mission === "return") return [{ id: "signal", x: 8.25, z: 1.25, title: "Return Signal" }];
  if (mission === "terminal") return terminalMarkers;
  if (mission !== "chapter") return [];
  return stage === 0
    ? [
      { id: "log", x: -4.2, z: 3, title: "Maintenance Log", lore: "log" },
      { id: "advance", x: 8.3, z: 0, title: "Relay Room" },
    ]
    : [
      { id: "announcement", x: -4, z: 3.1, title: "Broken Speaker", lore: "announcement" },
      { id: "signal", x: 8.2, z: 0, title: "Inspect Signal" },
    ];
}

export function nearestMarker(markers: readonly Marker[], x: number, z: number, range = 2.05): Marker | undefined {
  return markers.find((marker) => Math.hypot(marker.x - x, marker.z - z) <= range);
}
