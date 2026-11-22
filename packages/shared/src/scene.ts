import type { Lore, Mission } from "./content.ts";

export interface Marker { id: string; x: number; z: number; title: string; lore?: Lore }
export const PLAZA: Marker[] = [
  { id: "workbench", title: "Morph Workbench", x: -6.7, z: 2.8 },
  { id: "room", title: "Companion Room", x: -1.85, z: 3.1 },
  { id: "plaque", title: "Closure Plaque", x: 2.8, z: 3.1, lore: "plaque" },
  { id: "dispatch", title: "Dispatch", x: 7.25, z: 2.65 },
];

export function routeMarkers(mission: Mission, stage: number): Marker[] {
  if (mission === "night") return [{ id: "register", x: 8.25, z: 2.25, title: "Return Register" }];
  if (mission === "return") return [{ id: "signal", x: 8.25, z: 1.25, title: "Return Signal" }];
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
