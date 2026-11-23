export const COMPANION_PLAY = "companion-play";
export const SIGNAL_CUE_MS = 850;
export const SIGNAL_GAP_MS = 200;
export const SIGNAL_COUNT = 4;
export const SIGNAL_PLAYBACK_MS = SIGNAL_COUNT * (SIGNAL_CUE_MS + SIGNAL_GAP_MS);
export const SIGNAL_ROUND_MS = 120_000;

export type Signal = "short" | "long";

export type CompanionPlayRequest =
  | { type: "start"; requestId: number }
  | { type: "answer"; roundId: string; signals: Signal[] }
  | { type: "cancel"; roundId: string };

export type CompanionPlayMessage =
  | { type: "round"; requestId: number; roundId: string; signals: Signal[] }
  | { type: "result"; roundId: string; outcome: "matched" | "missed" | "expired"; bondAdded: boolean };
