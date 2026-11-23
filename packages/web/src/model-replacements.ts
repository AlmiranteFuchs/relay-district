import type { Family } from "../../shared/src/content.ts";

export const MODEL_SLOTS = ["courier", "moth", "brick", "heron", "boar", "moth-weapon", "brick-weapon",
  "heron-weapon", "boar-weapon", "skitter", "guard", "keeper"] as const;
export type ModelSlot = (typeof MODEL_SLOTS)[number];

export type CourierClip = "idle" | "armedIdle" | "run" | "armedRun" | "jump" | "dodge" | "hurt" | "down" | "rescue"
  | "arm" | "recall" | "attack1" | "attack2" | "attack3" | "skill" | "mastery" | "air";
export type ClipNames = Partial<Record<CourierClip, string>>;

export interface CourierClips {
  clips: ClipNames & { idle: string };
  families?: Partial<Record<Family, ClipNames>>;
  weaponSocket?: string;
}

export interface ModelReplacement {
  file: string;
  yawDegrees?: number;
  scale?: number;
  offset?: readonly [x: number, y: number, z: number];
}

// Files live under packages/web/public/models. An empty table uses the bundled models.
export const MODEL_REPLACEMENTS: Partial<Record<ModelSlot, ModelReplacement>> & {
  courier?: ModelReplacement & { animation?: CourierClips };
} = {};
