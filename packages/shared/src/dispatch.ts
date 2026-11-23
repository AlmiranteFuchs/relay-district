import type { Mission } from "./content.ts";

export const DISPATCH_INVITE = "dispatchInvite";
export const DISPATCH_INVITE_LIMIT = 3;
export const DISPATCH_RECENT_CREW = "dispatchRecentCrew";
export const DISPATCH_RECENT_CREW_TTL_MS = 30 * 60_000;

export interface DispatchInviteRequest {
  roomId: string;
  targets: string[];
}

export interface DispatchInvitation {
  roomId: string;
  mission: Mission;
  inviter: string;
}

export interface DispatchRecentCrew {
  targets: string[];
}
