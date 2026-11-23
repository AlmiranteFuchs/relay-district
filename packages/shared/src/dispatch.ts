import type { Mission } from "./content.ts";

export const DISPATCH_INVITE = "dispatchInvite";
export const DISPATCH_INVITE_LIMIT = 3;

export interface DispatchInviteRequest {
  roomId: string;
  targets: string[];
}

export interface DispatchInvitation {
  roomId: string;
  mission: Mission;
  inviter: string;
}
