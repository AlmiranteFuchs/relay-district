import { TICK_RATE, type Lore, type Mission } from "./content.ts";

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

export const ARCHIVE_CHANNEL_TICKS = 3.5 * TICK_RATE;
export const ARCHIVE_CHANNELS_COMPLETE = 0b11;
const archiveMarkers: Marker[][] = [
  [{ id: "archive-console", x: 7.2, z: 2.3, title: "Archive Console" }],
  [
    { id: "archive-near", x: -3.4, z: -2.75, title: "Near Channel", readerBit: 0b01 },
    { id: "archive-far", x: 3.7, z: 2.75, title: "Far Channel", readerBit: 0b10 },
  ],
  [],
  [{ id: "archive-recording", x: 8.05, z: 2.35, title: "Tidegate Recording" }],
];
const exchangeMarkers: Marker[][] = [
  [{ id: "exchange-transfer", x: 6.6, z: 2.8, title: "Transfer Control" }],
  [],
  [{ id: "exchange-log", x: 8.35, z: 2.6, title: "Crew Log" }],
];
export const DEPARTURE_REINFORCEMENT_TICKS = 2.4 * TICK_RATE;
const departureMarkers: Marker[][] = [
  [{ id: "departure-signal", x: 6.65, z: 2.8, title: "Departure Signal" }],
  [],
  [{ id: "departure-boarding", x: 8.2, z: 2.7, title: "Boarding Reader" }],
];
export const VIADUCT_RELAY_TICKS = 10 * TICK_RATE;
const viaductMarkers: Marker[][] = [
  [],
  [
    { id: "viaduct-west", x: -6.55, z: 2.65, title: "West Relay", readerBit: 0b01 },
    { id: "viaduct-east", x: 6.55, z: -1.75, title: "East Relay", readerBit: 0b10 },
  ],
  [],
  [{ id: "viaduct-ledger", x: 8.25, z: 2.55, title: "Signal Ledger" }],
];
export const BAY_RELAY_CALLS_COMPLETE = 0b11;
export const BAY_RELAY_STAGGER_TICKS = 40;
const bayRelayMarkers: Marker[] = [
  { id: "relay-west", x: -7.25, z: 2.7, title: "West Call", readerBit: 0b01 },
  { id: "relay-east", x: 7.65, z: 2.7, title: "East Call", readerBit: 0b10 },
];

export function routeMarkers(mission: Mission, stage: number): Marker[] {
  if (mission === "night") return [{ id: "register", x: 8.25, z: 2.25, title: "Return Register" }];
  if (mission === "return") return [{ id: "signal", x: 8.25, z: 1.25, title: "Return Signal" }];
  if (mission === "terminal") return terminalMarkers;
  if (mission === "archive") return archiveMarkers[stage] ?? [];
  if (mission === "exchange") return exchangeMarkers[stage] ?? [];
  if (mission === "departure") return departureMarkers[stage] ?? [];
  if (mission === "viaduct") return viaductMarkers[stage] ?? [];
  if (mission === "bayrelay") return bayRelayMarkers;
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
