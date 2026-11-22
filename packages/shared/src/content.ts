export type Family = "moth" | "brick" | "heron" | "boar";
export type Mission = "chapter" | "night" | "return" | "platform" | "transformer" | "training";
export type Action = "attack" | "skill" | "mastery" | "morph" | "dodge" | "jump";
export type Lore = "plaque" | "log" | "announcement" | "register" | "turnout";
export const TICK_RATE = 60;
export const PATCH_MS = 50;
export const MAX_ENERGY = 100;
export const MASTERY_XP = 90;
export const MORPH_CLEARS = 2;

export interface Strike {
  startup: number;
  active: number;
  recovery: number;
  reach: number;
  depth: number;
  damage: number;
  stagger: number;
  drive?: number;
  lift?: number;
  breakGuard?: boolean;
  area?: boolean;
}

export interface Form {
  name: string;
  weapon: string;
  role: string;
  signature: string;
  followup: string;
  color: string;
  body: string;
  chain: readonly [Strike, Strike, Strike];
  skill: Strike;
  mastery: Strike;
  air: Strike;
}

export const FORMS: Record<Family, Form> = {
  moth: {
    name: "Kite Moth", weapon: "Coil staff", role: "Wide sweeps and aerial control",
    signature: "Rising Arc", followup: "Falling Circuit",
    color: "#92e2d3", body: "#709b78",
    chain: [
      { startup: 10, active: 4, recovery: 12, reach: 2.6, depth: 1.05, damage: 17, stagger: 14 },
      { startup: 12, active: 5, recovery: 14, reach: 2.8, depth: 1.18, damage: 21, stagger: 17 },
      { startup: 16, active: 5, recovery: 21, reach: 3.15, depth: 1.5, damage: 31, stagger: 27 },
    ],
    skill: { startup: 13, active: 5, recovery: 18, reach: 2.45, depth: 1.3, damage: 30, stagger: 31, lift: 6.2 },
    mastery: { startup: 15, active: 6, recovery: 21, reach: 3.4, depth: 1.55, damage: 49, stagger: 36 },
    air: { startup: 6, active: 5, recovery: 13, reach: 2.65, depth: 1.2, damage: 23, stagger: 21, lift: 2 },
  },
  brick: {
    name: "Brickback", weapon: "Relay gauntlets", role: "Quick contact and close recovery punishes",
    signature: "Breaker Step", followup: "Return Current",
    color: "#ffd08c", body: "#a46552",
    chain: [
      { startup: 7, active: 4, recovery: 9, reach: 1.42, depth: 0.64, damage: 18, stagger: 13, drive: 1.6 },
      { startup: 8, active: 4, recovery: 12, reach: 1.53, depth: 0.72, damage: 22, stagger: 15, drive: 1.8 },
      { startup: 12, active: 5, recovery: 14, reach: 1.76, depth: 0.84, damage: 35, stagger: 25, drive: 2 },
    ],
    skill: { startup: 8, active: 7, recovery: 16, reach: 1.75, depth: 0.86, damage: 45, stagger: 25, drive: 6.7 },
    mastery: { startup: 9, active: 5, recovery: 16, reach: 1.85, depth: 1, damage: 57, stagger: 30, drive: 4 },
    air: { startup: 5, active: 4, recovery: 11, reach: 1.52, depth: 0.73, damage: 20, stagger: 17, lift: 1.2 },
  },
  heron: {
    name: "Glass Heron", weapon: "Long blade", role: "Fast cuts that close distance along one lane",
    signature: "Glass Passage", followup: "Afterimage",
    color: "#c3d4ff", body: "#6e79ab",
    chain: [
      { startup: 8, active: 4, recovery: 10, reach: 2.45, depth: 0.63, damage: 16, stagger: 13 },
      { startup: 8, active: 4, recovery: 11, reach: 2.5, depth: 0.72, damage: 20, stagger: 16, drive: 2.1 },
      { startup: 11, active: 4, recovery: 14, reach: 2.85, depth: 0.82, damage: 28, stagger: 23, drive: 2.7 },
    ],
    skill: { startup: 10, active: 8, recovery: 16, reach: 2.7, depth: 0.66, damage: 41, stagger: 23, drive: 7.8 },
    mastery: { startup: 8, active: 6, recovery: 16, reach: 3.2, depth: 0.88, damage: 48, stagger: 26, drive: 5 },
    air: { startup: 5, active: 5, recovery: 12, reach: 2.65, depth: 0.78, damage: 21, stagger: 20, lift: 1.7 },
  },
  boar: {
    name: "Cinder Boar", weapon: "Breaker hammer", role: "Committed impacts and guard break",
    signature: "Fault Slam", followup: "Aftershock",
    color: "#ffac69", body: "#8e6155",
    chain: [
      { startup: 16, active: 5, recovery: 15, reach: 2.2, depth: 1.1, damage: 24, stagger: 20 },
      { startup: 18, active: 5, recovery: 19, reach: 2.4, depth: 1.2, damage: 29, stagger: 23 },
      { startup: 22, active: 6, recovery: 24, reach: 2.6, depth: 1.4, damage: 41, stagger: 32, breakGuard: true },
    ],
    skill: { startup: 23, active: 7, recovery: 27, reach: 3.2, depth: 2, damage: 55, stagger: 42, breakGuard: true, area: true },
    mastery: { startup: 21, active: 7, recovery: 24, reach: 3.6, depth: 2.25, damage: 63, stagger: 42, area: true, breakGuard: true },
    air: { startup: 10, active: 5, recovery: 18, reach: 2.32, depth: 1.05, damage: 32, stagger: 26 },
  },
};

export const LORE: Record<Lore, { title: string; text: string; hint: string }> = {
  plaque: {
    title: "Closure plaque",
    text: "On 17 October 1999, a power failure ended service on the line. No passengers remained below. The last sentence was stamped over a list of names.",
    hint: "The tarnished plaque in the repair plaza",
  },
  log: {
    title: "Maintenance log • 23:41",
    text: "Mara ordered the cut from the far platform. The board stayed green for nine minutes after we pulled the cables. Something on the other side was holding the route open.",
    hint: "The service entry desk",
  },
  announcement: {
    title: "Platform announcement • recovered",
    text: "If your partner can still hear me, let it choose. Close the crossing while the signal is green. Please tell the city we were still here.",
    hint: "The damaged speaker in the relay room",
  },
  register: {
    title: "Return register • Platform 07",
    text: "Mara, 23:49. Last evacuation car departed with twelve aboard. Partners stayed at the far platform. Keep one return path open. At 00:00 someone stamped EMPTY across all twelve names.",
    hint: "Open the conductor’s register on the night platform",
  },
  turnout: {
    title: "Turnout log • Signal 12",
    text: "Route test, 23:58. Twelve passenger fares read on the outward track. Twelve partner signals read on the return track, including one pulse your partner can still repeat. Mara’s instruction in the margin: keep the east turnout live until both lists match.",
    hint: "Read the return signal at the junction past the night platform",
  },
};

export const JOBS: Record<Mission, {
  title: string; description: string; reward?: Family; clearLore?: Lore; requiresChapter?: boolean; prerequisite?: Mission;
}> = {
  chapter: { title: "The Last Crossing", description: "Trace the fare token to a line sealed since 1999.", reward: "brick" },
  night: { title: "The Night Platform", description: "Follow the train from the sealed line to its last recorded stop.", clearLore: "register", requiresChapter: true },
  return: {
    title: "Return Junction", description: "Trace the return route from the conductor’s register. Requires The Night Platform.",
    clearLore: "turnout", requiresChapter: true, prerequisite: "night",
  },
  platform: { title: "Platform Sweep", description: "Clear a crowded platform and trace the Glass Heron signal.", reward: "heron", requiresChapter: true },
  transformer: { title: "Transformer Trial", description: "Break through the substation's guard and trace Cinder Boar.", reward: "boar", requiresChapter: true },
  training: { title: "Practice floor", description: "Try a discovered form or complete the equipped form's mastery drill." },
};

export interface Profile {
  name: string;
  companion: string;
  family: Family;
  battleXp: number;
  bond: number;
  catalyst: boolean;
  discovered: Family[];
  history: Family[];
  mastery: Family[];
  lore: Lore[];
  clears: Mission[];
  catalystProgress: Mission[];
  trinket: string;
  roomTheme: string;
}

export function battleRank(xp: number): number {
  return 1 + Math.floor(Math.max(0, xp) / 45);
}

export const TRINKETS = ["Fare token", "Copper ribbon", "Blue bell"];
export const ROOM_THEMES = ["Station blue", "Amber window", "Moss glass"];

export function isFamily(value: unknown): value is Family {
  return typeof value === "string" && Object.hasOwn(FORMS, value);
}

export function isMission(value: unknown): value is Mission {
  return typeof value === "string" && Object.hasOwn(JOBS, value);
}
