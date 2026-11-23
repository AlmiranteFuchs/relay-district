import { Client, type Room } from "@colyseus/sdk";
import { COMPANION_PLAY, type CompanionPlayMessage } from "../../shared/src/companion-play.ts";
import type { CrewAssist } from "../../shared/src/crew-assists.ts";
import { ARM_TICKS, canRescueIn, DT, rescueDistance, RESCUE_RANGE, RESCUE_TICKS, stepWalk, type CombatEvent, type Input } from "../../shared/src/combat.ts";
import { availableTrinkets, battleRank, FORMS, isFamily, isMission, JOBS, LORE, missionLockReason, ROOM_THEMES, TICK_RATE, type Action, type Family,
  type Mission, type Profile } from "../../shared/src/content.ts";
import {
  DISPATCH_INVITE, DISPATCH_INVITE_LIMIT, DISPATCH_RECENT_CREW,
  type DispatchInvitation, type DispatchInviteRequest, type DispatchRecentCrew,
} from "../../shared/src/dispatch.ts";
import { annexCaseAction, BELLHOUSE_CALLS, FLOOD_INDEX_BANKS, LIFT_PHASE, nearestMarker, PLAZA, PUMP_LANES, PUMP_PHASE, routeMarkers,
  TERMINAL_READERS_COMPLETE, type BellhouseCue, type IndexScan } from "../../shared/src/scene.ts";
import { GameView, type ViewActor, type WorldView } from "./view.ts";
import { GameAudio } from "./audio.ts";
import { CompanionRoomPlay } from "./companion-room-play.ts";
import "./style.css";

type Wire = Omit<WorldView, "actors" | "indexScans"> & {
  actors: { forEach(callback: (actor: ViewActor, id: string) => void): void };
  crewAssists: Iterable<CrewAssist>;
  indexScans?: { size: number; forEach(callback: (scan: IndexScan, id: string) => void): void };
};
type RelayRoom = Room<any, Wire>;
type Panel = "" | "dispatch" | "lobby" | "room" | "room-play" | "workbench" | "confirm";

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
const canvas = element<HTMLCanvasElement>("view");
const audio = new GameAudio();
const guest = new URLSearchParams(location.search).get("guest")?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || "default";
const tokenKey = "relay-session-" + guest;
const resumeKey = "relay-room-" + guest;
const endpoint = new URL(location.origin);
if (endpoint.port === "5173") endpoint.port = "2567";
const sdk = new Client(endpoint.origin);
let token = localStorage.getItem(tokenKey) ?? "";
let view: GameView;
let world: WorldView | undefined;
let room: RelayRoom | undefined;
let profile: Profile;
let panel: Panel = "";
let companionPlay: CompanionRoomPlay | undefined;
let targetFamily: Family = "moth";
let busy = false;
let connected = false;
let seq = 0;
let timestamp = 0;
let accumulated = 0;
let introShown = false;
let pending: Input[] = [];
let pendingAction: Action | undefined;
let responsive: { action: Action; seq: number; at: number } | undefined;
const keys = new Set<string>();
const codes: Record<string, Action> = { KeyQ: "morph", KeyJ: "attack", KeyK: "skill", KeyL: "mastery", Space: "jump", ShiftLeft: "dodge", ShiftRight: "dodge" };
const movement = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
let noticeTimer = 0;
let storyTimer = 0;
const invitedCouriers = new Set<string>();
const dispatchInvites = new Map<string, { invitation: DispatchInvitation; timer: number }>();
let crewRosterKey = "";

function text(id: string, value: string) { element(id).textContent = value; }
function show(id: string, enabled: boolean) { element(id).classList.toggle("hidden", !enabled); }
function escape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function notify(message: string) {
  text("toast", message);
  show("toast", true);
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => show("toast", false), 3700);
}

function story(data: { title: string; text: string }) {
  window.clearTimeout(noticeTimer);
  show("toast", false);
  text("story-title", data.title); text("story-text", data.text); show("story", true);
  window.clearTimeout(storyTimer);
  storyTimer = window.setTimeout(() => show("story", false), 24000);
}

function setConnection(value: string) { text("connection", value); }
function clearControls() { keys.clear(); pendingAction = undefined; }

async function api<T>(path: string, body?: object): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(endpoint.origin + "/api/" + path, { method: body ? "POST" : "GET", headers, body: body && JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Relay request failed.");
  return data as T;
}

async function connectProfile() {
  if (token) {
    try {
      profile = (await api<{ profile: Profile }>("profile")).profile;
      sdk.auth.token = token;
      return;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Guest session required")) throw error;
      token = "";
      localStorage.removeItem(tokenKey);
    }
  }
  const result = await api<{ token: string; profile: Profile }>("session", { name: guest === "default" ? "Courier" : guest });
  token = result.token;
  profile = result.profile;
  localStorage.setItem(tokenKey, token);
  sdk.auth.token = token;
}

function markers() {
  if (!world || world.kind === "plaza") return PLAZA;
  if (world.status === "lobby") return [];
  return routeMarkers(world.mission as Mission, world.stage);
}

function capture(state: Wire) {
  const actors = new Map<string, ViewActor>();
  const indexScans = state.indexScans?.size ? new Map<string, IndexScan>() : undefined;
  if (indexScans) state.indexScans?.forEach(({ courier, until }, id) => indexScans.set(id, { courier, until }));
  state.actors.forEach((entry, id) => {
    actors.set(id, {
      x: entry.x, y: entry.y, z: entry.z, facing: entry.facing, name: entry.name, companion: entry.companion,
      family: entry.family, kind: entry.kind, hp: entry.hp, maxHp: entry.maxHp, energy: entry.energy,
      armed: entry.armed, connected: entry.connected, phase: entry.phase, age: entry.age, duration: entry.duration,
      combo: entry.combo, step: entry.step, ack: entry.ack, moving: entry.moving, rank: entry.rank,
      rescued: entry.rescued, rescueTarget: entry.rescueTarget, rescueTicks: entry.rescueTicks,
      signalTag: entry.signalTag, bayFourTicket: entry.bayFourTicket, relayPennant: entry.relayPennant,
      bellhouseSeal: entry.bellhouseSeal,
    });
  });
  return {
    kind: state.kind, mission: state.mission, status: state.status, code: state.code, leader: state.leader,
    stage: state.stage, wave: state.wave, readerMask: state.readerMask, readerUntil: state.readerUntil,
    rosterCase: state.rosterCase && { x: state.rosterCase.x, z: state.rosterCase.z, carrier: state.rosterCase.carrier, filed: state.rosterCase.filed },
    frame: state.frame, practice: state.practice, actors, indexScans,
  };
}

function attach(next: RelayRoom) {
  next.reconnection.minUptime = 0;
  room = next;
  world = undefined;
  seq = 0;
  pending = [];
  responsive = undefined;
  connected = true;
  invitedCouriers.clear();
  for (const { timer } of dispatchInvites.values()) window.clearTimeout(timer);
  dispatchInvites.clear();
  sessionStorage.setItem(resumeKey, next.reconnectionToken);
  setConnection("Online");
  next.onStateChange((incoming) => {
    if (room !== next) return;
    const oldStatus = world?.status, oldStage = world?.stage, oldLeader = world?.leader;
    const localBefore = world?.actors.get(next.sessionId);
    world = capture(incoming);
    const local = world.actors.get(next.sessionId);
    if (local) {
      seq = Math.max(seq, local.ack);
      if (oldStage !== undefined && oldStage !== world.stage
        || (localBefore && Math.abs(localBefore.x - local.x) > 8)) pending = [];
      else pending = pending.filter((input) => input.seq > local.ack);
      if (responsive && responsive.seq <= local.ack) responsive = undefined;
    }
    if (panel === "lobby" && (oldStatus !== world.status || oldLeader !== world.leader)) {
      if (world.status === "lobby" || world.status === "failed" || world.status === "complete") drawPanel();
      else closePanel();
    } else if (panel === "lobby" && world.status === "lobby") {
      const roster = element("lobby-roster");
      if (roster) roster.textContent = participantText();
    }
    if (!oldStatus && world.status === "lobby") openPanel("lobby");
    if (world.status === "failed" && oldStatus !== "failed") openPanel("lobby");
    if (world.kind === "plaza" && !introShown && !profile.clears.includes("chapter")) {
      introShown = true;
      story({ title: "Repair Plaza • 2007", text: profile.companion + " slips a fare token into your hand. You recognize the date: 1999, the night the city closed the line. Check the dispatch board to see where it leads." });
    }
    audio.mix(world.kind, world.status === "combat");
    updateHUD(local);
    if (panel === "dispatch") syncDispatchCrew();
  });
  next.onMessage("combat", (event: CombatEvent) => {
    if (room === next) { view.react(event); audio.sound(event.type); }
  });
  next.onMessage("bell", ({ note, source, x, z }: BellhouseCue) => {
    if (room !== next) return;
    view.react({ type: "observe", source, x, z });
    audio.bellhouse(note);
  });
  next.onMessage("profile", (result: Profile) => {
    if (room !== next) return;
    profile = result;
    if (panel === "room" || panel === "workbench" || panel === "confirm" || panel === "dispatch") drawPanel();
  });
  next.onMessage(COMPANION_PLAY, (message: CompanionPlayMessage) => {
    if (room === next) companionPlay?.receive(message);
  });
  next.onMessage("story", (result: { title: string; text: string }) => { if (room === next) story(result); });
  next.onMessage("notice", (message: string) => { if (room === next) notify(message); });
  next.onMessage(DISPATCH_INVITE, (invitation: DispatchInvitation) => {
    if (room !== next || !isMission(invitation.mission)) return;
    removeDispatchInvite(invitation.roomId);
    const timer = window.setTimeout(() => removeDispatchInvite(invitation.roomId), 60_000);
    dispatchInvites.set(invitation.roomId, { invitation, timer });
    syncDispatchInvites();
    notify(invitation.inviter + " invited you to " + JOBS[invitation.mission].title + ". Open Dispatch to join.");
  });
  next.onMessage(DISPATCH_RECENT_CREW, ({ targets }: DispatchRecentCrew) => {
    if (room !== next || panel !== "dispatch") return;
    const available = new Set(plazaCouriers().map(([id]) => id));
    const current = [...new Set(targets.filter((id) => available.has(id)))].slice(0, DISPATCH_INVITE_LIMIT);
    if (!current.length) {
      text("dispatch-last-crew-status", "None of your last crewmates are in this plaza.");
      return;
    }
    invitedCouriers.clear();
    for (const id of current) invitedCouriers.add(id);
    syncDispatchCrew();
    text("dispatch-last-crew-status", "Last crew selected. Choose a mission to invite them.");
  });
  next.onMessage("panel", (id: string) => {
    if (room === next && ["room", "dispatch", "workbench"].includes(id)) openPanel(id as Panel);
  });
  next.onDrop(() => {
    if (room !== next) return;
    connected = false; pending = []; responsive = undefined; clearControls(); setConnection("Reconnecting");
    companionPlay?.interrupt();
  });
  next.onReconnect(() => {
    if (room !== next) return;
    sessionStorage.setItem(resumeKey, next.reconnectionToken);
    connected = true; setConnection("Online"); notify("Back on the line.");
    if (panel === "lobby" && world?.mission === "bayrelay") drawPanel();
  });
  next.onLeave(() => {
    if (room !== next) return;
    sessionStorage.removeItem(resumeKey);
    connected = false; clearControls(); setConnection("Offline");
    notify("The line closed. Return to the plaza to start a new room.");
    openPanel("lobby");
  });
}

async function enter(create: () => Promise<RelayRoom>) {
  if (busy) return;
  busy = true;
  try {
    clearControls();
    const next = await create();
    const previous = room;
    closePanel();
    show("story", false);
    attach(next);
    if (previous) await previous.leave();
  } catch (error) {
    notify(error instanceof Error ? error.message : "Could not enter the room.");
    if (!room) throw error;
  } finally {
    busy = false;
  }
}

const plaza = () => enter(() => sdk.joinOrCreate("plaza") as Promise<RelayRoom>);

function create(mission: Mission, preview?: Family) {
  const source = connected && world?.kind === "plaza" && mission !== "training" ? room : undefined;
  const targets = source ? [...invitedCouriers] : [];
  return enter(async () => {
    const next = await sdk.create("mission", { mission, preview }) as RelayRoom;
    if (source && targets.length) {
      try { source.send(DISPATCH_INVITE, { roomId: next.roomId, targets } satisfies DispatchInviteRequest); }
      catch { notify("The mission room opened. The plaza connection could not send its invitations."); }
    }
    return next;
  });
}

async function join(code: string) {
  if (!/^[A-Fa-f0-9]{6}$/.test(code.trim())) { notify("Enter the six-character room code."); return; }
  await enter(async () => {
    const { id } = await api<{ id: string }>("rooms/" + code.trim());
    return sdk.joinById(id) as Promise<RelayRoom>;
  });
}

function participantText() {
  const players = [...(world?.actors.values() ?? [])].filter((actor) => actor.kind === "player");
  return players.length + " / " + (world?.mission === "training" ? 1 : 4) + " • " + players.map((actor) => actor.name).join(", ");
}

function endCompanionPlay() {
  companionPlay?.dispose();
  companionPlay = undefined;
}

function openPanel(value: Panel) {
  if (value === "room-play" && companionPlay) return;
  endCompanionPlay();
  panel = value;
  clearControls();
  drawPanel();
}
function closePanel() {
  endCompanionPlay();
  panel = "";
  show("shade", false);
  canvas.focus({ preventScroll: true });
}
const button = (label: string, action: string, disabled = false) =>
  '<button type="button" class="button" data-menu="' + action + '"' + (disabled ? " disabled" : "") + ">" + label + "</button>";
const item = (title: string, info: string, actions = "") =>
  '<div class="item"><div><strong>' + title + "</strong><small>" + info + '</small></div><div class="item-actions">' + actions + "</div></div>";

function syncDispatchInvites() {
  const list = document.getElementById("dispatch-invitations");
  if (!list) return;
  list.classList.toggle("hidden", dispatchInvites.size === 0);
  list.innerHTML = [...dispatchInvites.values()].map(({ invitation }) => item(
    escape(JOBS[invitation.mission].title), "Invitation from " + escape(invitation.inviter),
    button("Join crew", "accept-invite-" + escape(invitation.roomId))
      + button("Decline", "decline-invite-" + escape(invitation.roomId)),
  )).join("");
}

function removeDispatchInvite(roomId: string) {
  const pending = dispatchInvites.get(roomId);
  if (!pending) return;
  window.clearTimeout(pending.timer);
  dispatchInvites.delete(roomId);
  syncDispatchInvites();
}

function plazaCouriers() {
  return [...(world?.actors ?? [])].filter(([id, actor]) => id !== room?.sessionId && actor.connected && actor.kind === "player");
}

function syncDispatchCrew() {
  const list = document.getElementById("dispatch-couriers");
  if (!list) return;
  const couriers = plazaCouriers();
  const available = new Set(couriers.map(([id]) => id));
  for (const id of invitedCouriers) if (!available.has(id)) invitedCouriers.delete(id);
  const key = JSON.stringify(couriers.map(([id, actor]) => [id, actor.name]));
  if (crewRosterKey !== key) {
    crewRosterKey = key;
    list.innerHTML = couriers.map(([id, actor]) =>
      '<label><input type="checkbox" data-dispatch-courier value="' + escape(id) + '">' + escape(actor.name) + "</label>",
    ).join("") || "<p>No other couriers are online in this plaza.</p>";
  }
  const full = invitedCouriers.size >= DISPATCH_INVITE_LIMIT;
  for (const input of list.querySelectorAll<HTMLInputElement>("[data-dispatch-courier]")) {
    input.checked = invitedCouriers.has(input.value);
    input.disabled = full && !input.checked;
  }
  const summary = element("dispatch-crew-count");
  const count = "Invite couriers (" + invitedCouriers.size + " / " + DISPATCH_INVITE_LIMIT + ")";
  if (summary.textContent !== count) summary.textContent = count;
}

function roomPortrait() {
  const themeClass = profile.roomTheme === "Amber window" ? "amber" : profile.roomTheme === "Moss glass" ? "moss" : "";
  return '<div class="room-portrait ' + themeClass + '"><img class="critter" src="/models/' + profile.family + '-portrait.png" alt="">'
    + "<strong>" + escape(profile.companion) + "</strong><small>" + FORMS[profile.family].name + " • " + escape(profile.trinket) + "</small></div>";
}

function crewAssistReport() {
  const assists = Array.from(room?.state.crewAssists ?? []);
  const entries = assists.map(({ kind, source, target, station }) => item(
    escape(source),
    kind === "rescue" ? "Revived " + escape(target) + "."
      : escape(station) + " gave " + escape(target) + " an opening.",
  )).join("");
  return '<section class="panel-grid" aria-labelledby="crew-assists-title">'
    + '<h2 id="crew-assists-title">Crew assists</h2>'
    + (entries || '<p class="quiet">Cover a crewmate with a call box or revive them to record an assist.</p>')
    + "</section>";
}

function drawPanel() {
  if (!panel || !profile) return;
  let title = "";
  let body = "";
  if (panel === "dispatch") {
    title = "District dispatch";
    body = '<div class="panel-grid"><div id="dispatch-invitations" class="panel-grid"></div><details'
      + (invitedCouriers.size ? " open" : "") + '><summary id="dispatch-crew-count"></summary>'
      + '<div class="panel-grid"><div id="dispatch-couriers" class="panel-grid"></div><div>'
      + button("Select last crew", "select-last-crew") + ' <small id="dispatch-last-crew-status" role="status"></small></div>'
      + '<small>Selected couriers get an invitation when you create a mission room.</small></div></details></div>'
      + '<div class="panel-grid">' + (Object.keys(JOBS) as Mission[]).map((job) => {
      const locked = missionLockReason(job, profile.clears);
      return item(JOBS[job].title, escape(locked ?? JOBS[job].description),
        button(job === "training" ? "Train" : "Create room", "create-" + job, !!locked));
    }).join("") + '</div><form id="join" class="join-code"><label>Room code <input name="code" maxlength="6" autocomplete="off" size="8" required></label><button class="button">Join</button></form>';
  } else if (panel === "lobby") {
    title = world?.mission && JOBS[world.mission as Mission]?.title || "Mission room";
    if (!connected) {
      body = "<p>The connection is closed.</p>" + button("Return to plaza", "plaza");
    } else {
      const leader = room?.sessionId === world?.leader;
      body = '<p>Room code <strong>' + (world?.code ?? "…") + '</strong></p><p id="lobby-roster">' + escape(participantText()) + "</p>";
      if (world && ["lobby", "failed", "complete"].includes(world.status)) {
        if (leader) body += button(world.status === "lobby" ? "Start mission" : world.status === "failed" ? "Retry mission" : "Replay mission", "begin");
        else if (world.status === "lobby") body += "<p>Waiting for the room leader.</p>";
      } else body += button("Resume mission", "resume");
      body += " " + button("Return to plaza", "plaza");
      if (world?.mission === "bayrelay" && world.status === "complete") body += crewAssistReport();
    }
  } else if (panel === "room") {
    title = escape(profile.companion) + "’s room";
    body = roomPortrait();
    body += "<p>Bond " + profile.bond + " • Battle rank " + battleRank(profile.battleXp) + " • " + profile.battleXp + " XP</p>";
    body += '<form id="customize" class="panel-grid"><label>Name <input name="companion" maxlength="20" value="' + escape(profile.companion) + '"></label>'
      + '<label>Trinket <select name="trinket">' + options(availableTrinkets(profile), profile.trinket) + "</select></label>"
      + '<label>Room <select name="roomTheme">' + options(ROOM_THEMES, profile.roomTheme) + '</select></label>'
      + '<div><button class="button">Save room</button> ' + button("Play together", "care") + "</div></form>";
    body += '<div class="panel-grid">' + item("Signal Echo", "Listen to your partner and echo four pulses.",
      button("Play Signal Echo", "signal-echo")) + "</div>";
    body += "<p class='quiet'>Favorite keepsake: the fare token. Former shapes: "
      + profile.history.map((family) => FORMS[family].name).join(" → ") + ".</p>";
    body += '<div class="panel-grid">' + (Object.keys(LORE) as (keyof typeof LORE)[]).map((id) => {
      const entry = LORE[id];
      const discovered = profile.lore.includes(id);
      return item(entry.title, escape(discovered ? entry.text : entry.hint),
        discovered && id === "bellhouse" ? button("Hear the bells", "bellhouse-reply") : "");
    }).join("") + "</div>";
  } else if (panel === "room-play") {
    title = "Signal Echo";
    body = roomPortrait()
      + "<p>Watch your partner send four short or long pulses. Echo them in order when it's your turn.</p>"
      + '<p id="signal-status" role="status" tabindex="-1">Ready when you are.</p>'
      + '<div><button id="signal-start" type="button" class="button">Start round</button> '
      + '<button id="signal-short" type="button" class="button" disabled>Short pulse</button> '
      + '<button id="signal-long" type="button" class="button" disabled>Long pulse</button> '
      + button("Back to room", "companion-room") + "</div>";
  } else if (panel === "workbench") {
    title = "Morph workbench";
    body = "<p>" + escape(profile.companion) + " • " + FORMS[profile.family].name + " • " + profile.battleXp + " battle XP</p><p>"
      + (profile.catalyst ? "One catalyst is ready." : "Catalyst progress " + profile.catalystProgress.length + " / 2 distinct mission clears.") + "</p>";
    body += '<div class="panel-grid">' + (Object.keys(FORMS) as Family[]).map((family) => {
      const form = FORMS[family], known = profile.discovered.includes(family), current = family === profile.family;
      return item(form.name + " • " + form.weapon, form.role + " · " + form.signature + (profile.mastery.includes(family) ? " · Mastery recorded" : ""),
        current ? '<small class="quiet">Current form</small>' : known
          ? button("Preview", "preview-" + family) + button("Morph", "confirm-" + family, !profile.catalyst)
          : '<small class="quiet">Undiscovered</small>');
    }).join("") + "</div>";
  } else {
    title = "Confirm family morph";
    body = "<p>Change " + escape(profile.companion) + " from " + FORMS[profile.family].name + " to " + FORMS[targetFamily].name + ".</p>"
      + '<p class="danger">Spend your catalyst and reset battle XP from ' + profile.battleXp + " to 0.</p>"
      + "<p>Your bond, memories, cosmetics, and mastery records carry forward. Advanced techniques become available again at rank 3.</p>"
      + button("Confirm morph", "morph-confirm", !profile.catalyst) + " " + button("Back", "workbench");
  }
  element("panel-title").innerHTML = title;
  element("panel-body").innerHTML = body;
  if (panel === "dispatch") {
    crewRosterKey = "";
    syncDispatchCrew();
    syncDispatchInvites();
  }
  show("shade", true);
  if (panel === "room-play") {
    companionPlay = new CompanionRoomPlay(element("panel-body"), profile.companion, (message) => {
      if (!connected || !room || world?.kind !== "plaza") return false;
      room.send(COMPANION_PLAY, message);
      return true;
    }, (signal) => audio.signal(signal));
  }
}

function options(values: string[], selected: string) {
  return values.map((value) => "<option" + (value === selected ? " selected" : "") + ">" + escape(value) + "</option>").join("");
}

function signalObjective(world: WorldView) {
  if (world.mission === "night") return "Bring your recalled companion to the return register.";
  if (world.mission === "return") return "Bring your recalled companion to the return signal.";
  if (world.mission === "archive") return world.stage === 0
    ? "Recall your companion and use the archive console."
    : "Recall your companion and recover the recording at the playback deck.";
  if (world.mission === "exchange") return world.stage === 0
    ? "Recall your companion and use the Transfer Control."
    : "Recall your companion and read the Crew Log.";
  if (world.mission === "departure") return world.stage === 0
    ? "Recall your companion and set the Departure Signal."
    : "Bring your recalled companion to the Boarding Reader.";
  if (world.mission === "viaduct") {
    if (world.stage === 3) return "Recall your companion and read the Signal Ledger.";
    const seconds = readerSeconds(world);
    return seconds > 0
      ? "East Relay is live for " + seconds + "s. Answer with a recalled companion."
      : "Open West Relay with your companion recalled, then answer East Relay.";
  }
  if (world.mission === "lift") return world.stage === 3
    ? "Recall your companion and read the Lift Log."
    : "Recall your companion and use the Brake Wheel.";
  if (world.mission === "pump") return world.stage === 3
    ? "Recall your companion and read the Pump Record."
    : "Recall your companion and use the Intake Control.";
  if (world.mission === "bellhouse") return bellhouseObjective(world);
  if (world.mission === "annex") return annexObjective(world);
  if (world.mission === "flood") return floodObjective(world);
  if (world.mission === "bayrelay") return bayRelayObjective(world);
  if (world.mission !== "terminal") return "Inspect the incoming signal at the end of the lane.";
  if (world.readerMask === TERMINAL_READERS_COMPLETE) return "Bring your recalled companion to the manifest at the east end.";
  if (!world.readerMask) return "Bring your recalled companion to both fare readers.";
  const missing = routeMarkers("terminal", world.stage)
    .find(({ readerBit }) => readerBit && !(world.readerMask & readerBit));
  return missing ? "Bring a recalled companion to the " + missing.title + "." : "Check both fare readers.";
}

function archiveRouteObjective(world: WorldView) {
  const activeBit = 1 << world.wave;
  const live = routeMarkers("archive", world.stage).find((point) => point.readerBit === activeBit);
  if (!live) return "Match both relay banks with your companion recalled.";
  return world.readerMask & activeBit
    ? live.title + " logged. Wait for the other bank."
    : live.title + " live. Scan it with your companion recalled.";
}

function bayRelayObjective(world: WorldView) {
  const waiting = routeMarkers("bayrelay", world.stage)
    .filter(({ readerBit }) => readerBit && !(world.readerMask & readerBit))
    .map(({ title }) => title);
  if (!waiting.length) return "Both calls are linked. Clear the remaining patrol.";
  const goal = "Link " + waiting.join(" and ") + " with your companion recalled.";
  return world.status === "combat" ? goal + " Each call staggers the patrol." : goal;
}

function readerSeconds(world: WorldView) {
  return Math.max(0, Math.ceil((world.readerUntil - world.frame) / TICK_RATE));
}

function liftCombatObjective(world: WorldView) {
  if (world.stage === 0) return "Clear the upper landing.";
  if (world.readerMask === LIFT_PHASE.jammed) return "Recall your companion and reset the Brake Wheel.";
  if (world.readerMask === LIFT_PHASE.docked) return "Lower landing reached. Defeat the remaining guard.";
  return "Lift descending. " + readerSeconds(world) + "s to the "
    + (world.readerMask === LIFT_PHASE.lowering ? "midpoint." : "lower landing.");
}

function pumpCombatObjective(world: WorldView) {
  if (world.stage === 0) return "Clear the pump hall patrol.";
  if (world.readerMask === PUMP_PHASE.idle) return "Fight the Switchkeeper. Watch the floor lanes.";
  const lane = PUMP_LANES[world.wave].title;
  if (world.readerMask === PUMP_PHASE.warning) return `Leave the ${lane.toLowerCase()} before it bursts (${readerSeconds(world)}s).`;
  return lane + " discharge. Stay clear of the next marked lane.";
}

function bellhouseObjective(world: WorldView) {
  if (world.stage === 0) return "Clear the Bellhouse patrol.";
  if (world.stage === 3) return "Recall your companion and read the Roster Desk.";
  const answered = BELLHOUSE_CALLS.filter(({ readerBit }) => world.readerMask & readerBit).length;
  if (answered === BELLHOUSE_CALLS.length) return "All three bells answered. Clear the remaining guard.";
  return `Answer the bells with your companion recalled (${answered}/${BELLHOUSE_CALLS.length}).`;
}

function annexObjective(world: WorldView) {
  const rosterCase = world.rosterCase;
  if (!rosterCase) return "Clear the Registry Annex intake.";
  if (rosterCase.filed) return "Roster filed. Clear the remaining guard.";
  if (rosterCase.carrier === room?.sessionId) return "Carry the Roster Case to the Records Desk. Recall your companion to file it.";
  if (rosterCase.carrier) return "Cover " + (world.actors.get(rosterCase.carrier)?.name ?? "the carrier") + " to the Records Desk.";
  return world.stage === 1 ? "Pick up the red Roster Case at the west intake."
    : "Pick up the dropped Roster Case and bring it to the Records Desk.";
}

function annexPrompt(world: WorldView, actor: ViewActor) {
  if (!world.rosterCase || !room || (world.status !== "combat" && world.status !== "signal")) return "";
  switch (annexCaseAction(world.rosterCase, room.sessionId, actor.x, actor.z)) {
    case "pick-up": return "E  •  Pick up Roster Case";
    case "set-down": return "E  •  Set down Roster Case";
    case "file": return actor.armed ? "Q  •  Recall " + actor.companion + " to file" : "E  •  File the roster";
    case "needs-case": return "Records Desk  •  Bring the Roster Case";
    default: return "";
  }
}

function floodObjective(world: WorldView) {
  if (world.stage === 0) return "Clear the lower archive patrol.";
  if (world.stage === 3) return "Recall your companion and read the Flood Folio.";
  const courierId = room?.sessionId;
  const ownScan = courierId ? FLOOD_INDEX_BANKS.find(({ id }) => world.indexScans?.get(id)?.courier === courierId) : undefined;
  if (ownScan) return "Hold still at the " + ownScan.title + ".";
  const saved = FLOOD_INDEX_BANKS.filter(({ readerBit }) => world.readerMask & readerBit).length;
  if (saved === FLOOD_INDEX_BANKS.length) return "Both records saved. Defeat the Switchkeeper.";
  return `Scan both banks with your companion recalled (${saved}/${FLOOD_INDEX_BANKS.length}).`;
}

function stationPrompt(world: WorldView, actor: ViewActor) {
  if (!actor.hp) return "";
  if (world.mission === "annex") return annexPrompt(world, actor);
  const point = nearestMarker(markers(), actor.x, actor.z);
  if (!point) return "";
  if ((world.mission === "exchange" || world.mission === "departure" || world.mission === "viaduct" || world.mission === "pump")
    && world.status !== "signal") return "";
  if (world.mission === "terminal") {
    const ready = point.readerBit ? !(world.readerMask & point.readerBit) : world.readerMask === TERMINAL_READERS_COMPLETE;
    if (world.status !== "signal" || !ready) return "";
  }
  if (world.mission === "archive") {
    if (world.status !== "signal" && world.status !== "route") return "";
    if (point.readerBit) {
      if (world.readerMask & point.readerBit) return point.title + " • Logged";
      if (point.readerBit !== (1 << world.wave)) return point.title + " • Waiting for signal";
    }
  }
  if (world.mission === "bayrelay") {
    if (world.status !== "combat" && world.status !== "signal") return "";
    if (point.readerBit && (world.readerMask & point.readerBit)) return point.title + " • Linked";
  }
  if (world.mission === "bellhouse") {
    if (world.status !== "combat" && world.status !== "signal") return "";
    if (point.readerBit && (world.readerMask & point.readerBit)) return point.title + " • Answered";
  }
  if (world.mission === "flood") {
    if (world.status !== "combat" && world.status !== "signal") return "";
    if (point.readerBit && (world.readerMask & point.readerBit)) return point.title + " • Saved";
    const scan = world.indexScans?.get(point.id);
    if (scan) return point.title + (scan.courier === room?.sessionId ? " • Stay still" : " • Reading");
  }
  if (world.mission === "viaduct" && world.stage === 1) {
    const seconds = readerSeconds(world);
    if (point.id === "viaduct-west" && seconds > 0) return "West Relay • Sending to East Relay";
    if (point.id === "viaduct-east" && seconds === 0) return "East Relay • Waiting for West Relay";
  }
  if (world.mission === "lift" && world.status !== "signal"
    && !(world.status === "combat" && world.readerMask === LIFT_PHASE.jammed)) return "";
  const recall = world.mission === "archive" || world.mission === "bayrelay" || world.mission === "lift"
    || world.mission === "bellhouse" || world.mission === "flood"
    || world.status === "signal" && (world.mission === "terminal"
    || world.mission === "exchange" || world.mission === "departure" || world.mission === "viaduct" || world.mission === "pump"
    || point.id === "register" || point.id === "signal" && world.mission === "return");
  return recall && actor.armed ? "Q  •  Recall " + actor.companion + " to use the " + point.title : "E  •  " + point.title;
}

function updateHUD(actor?: ViewActor) {
  if (!world || !actor) return;
  const form = FORMS[actor.family];
  text("dispatch-key", world.kind === "plaza" ? "Dispatch" : "Mission");
  text("companion-name", actor.companion);
  text("form-name", form.name);
  const portrait = element<HTMLImageElement>("portrait-image");
  const picture = "/models/" + actor.family + "-portrait.png";
  if (portrait.getAttribute("src") !== picture) portrait.src = picture;
  for (const [selector, value, max] of [[".meter.hp", actor.hp, actor.maxHp], [".meter.energy", Math.floor(actor.energy), 100]] as const) {
    const bar = document.querySelector<HTMLElement>(selector)!;
    bar.querySelector("div")!.style.width = Math.max(0, value / max * 100) + "%";
    bar.querySelector("span")!.textContent = value + " / " + max;
    bar.setAttribute("aria-valuenow", String(value));
  }
  document.querySelector('[data-action="skill"]')?.classList.toggle("cool", !actor.armed || actor.energy < 28);
  document.querySelector('[data-action="mastery"]')?.classList.toggle("cool", !actor.armed || actor.rank < 3 || !profile.mastery.includes(actor.family) || actor.energy < 40);
  const place = world.kind === "plaza" ? "Repair Plaza"
    : world.mission === "chapter" ? world.stage === 0 ? "Service Entry" : "Relay Room"
      : JOBS[world.mission as Mission]?.title || "Mission";
  text("location", place + " • 2007");
  text("objective-title", world.kind === "plaza" ? "Repair Plaza" : JOBS[world.mission as Mission]?.title || "Mission");
  const target = world.kind === "plaza"
    ? (profile.clears.includes("chapter") ? "Visit the workbench to preview a form. Dispatch has new jobs." : "Investigate the fare token at Dispatch.")
    : ({
      lobby: "Share room code " + world.code + ", then start the job.",
      approach: world.mission === "night" ? "Follow the train along Platform 07." : "Read the maintenance log or head down the service lane.",
      combat: world.mission === "watch" ? `Patrol ${world.wave + 1} of 2. Clear the lane.`
        : world.mission === "bayrelay" ? bayRelayObjective(world)
        : world.mission === "archive" ? world.stage === 0 ? "Clear the archive entrance." : "Defend the archive while the playback deck spins up."
        : world.mission === "exchange" ? world.stage === 0 ? "Step off the Cable Runner’s marked line, then strike during recovery."
          : "Cover the rear lane while the transfer line powers up."
        : world.mission === "departure" ? world.stage === 0 ? "Clear the entrance to Bay Four."
          : world.wave === 0 ? "Punish the Switchkeeper after it swings."
          : "Watch the rear lane and clear both enemies."
        : world.mission === "viaduct" ? world.stage === 0 ? "Clear the scouts from the viaduct."
          : "Hold the viaduct while the Signal Ledger powers up."
        : world.mission === "lift" ? liftCombatObjective(world)
        : world.mission === "pump" ? pumpCombatObjective(world)
        : world.mission === "bellhouse" ? bellhouseObjective(world)
        : world.mission === "annex" ? annexObjective(world)
        : world.mission === "flood" ? floodObjective(world)
        : world.mission === "training" ? "Arm your companion and practice on the target." : "Clear the lane. Step aside when an enemy winds up.",
      interlude: world.mission === "departure" ? "The Switchkeeper is staggered. A Cable Runner is coming from the west."
        : world.mission === "watch" ? "Second patrol approaching. Recall your companion to recover energy." : "Another group is approaching.",
      route: world.mission === "archive" ? archiveRouteObjective(world) : "Use the blue door marker to enter the relay room.",
      signal: signalObjective(world),
      complete: world.mission === "departure" ? "Job complete. Watch the train or use Mission to return to the plaza."
        : world.mission === "bayrelay" ? "Job complete. Open Mission to see the crew report."
        : "Job complete. Use Mission to return to the plaza.",
      failed: "Party down. Retry from the Mission panel.",
    })[world.status] ?? "";
  text("objective-line", target);
  const prompt = rescuePrompt(actor) || stationPrompt(world, actor);
  text("prompt", prompt);
  show("prompt", !!prompt);
  text("combo", actor.combo + " HIT");
  show("combo", actor.combo > 1);
}

function rescuePrompt(actor: ViewActor) {
  if (!world || !room || !connected || world.kind !== "mission" || !canRescueIn(world.status)) return "";
  const progress = (helper: ViewActor) => Math.floor(helper.rescueTicks / RESCUE_TICKS * 100) + "%";
  if (actor.rescueTarget) {
    return "Hold still  •  " + actor.companion + " is reviving " + world.actors.get(actor.rescueTarget)?.name + "  •  " + progress(actor);
  }
  if (!actor.hp) {
    const helper = [...world.actors.values()].find((teammate) => teammate.rescueTarget === room?.sessionId);
    if (helper) return helper.companion + " is reviving you  •  " + progress(helper);
    return actor.rescued ? "Downed  •  Rescue already used this run" : "Downed  •  A teammate can rescue you";
  }
  if (actor.phase !== "idle" || actor.moving) return "";
  let closest: ViewActor | undefined;
  let nearest = RESCUE_RANGE;
  const busy = new Set([...world.actors.values()].map((teammate) => teammate.rescueTarget));
  for (const [id, target] of world.actors) {
    if (target.kind !== "player" || target.hp || !target.connected || target.rescued || busy.has(id)) continue;
    const distance = rescueDistance(actor, target);
    if (distance > nearest || (closest && distance === nearest)) continue;
    nearest = distance;
    closest = target;
  }
  if (!closest) return "";
  return actor.armed ? "Q  •  Recall " + actor.companion + " to rescue " + closest.name : "E  •  Rescue " + closest.name;
}

function impulse(action: Action) {
  if (connected && !panel) pendingAction = action;
}

function tick() {
  if (!room || !world || !connected) return;
  const axis = (positive: string[], negative: string[]) =>
    Number(positive.some((key) => keys.has(key))) - Number(negative.some((key) => keys.has(key)));
  const input: Input = {
    seq: ++seq, x: axis(["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"]),
    z: axis(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]), action: pendingAction,
  };
  pendingAction = undefined;
  const local = world.actors.get(room.sessionId);
  if (local && local.phase === "idle" && local.hp && input.action && (input.action === "morph" || (local.armed && input.action === "attack"))) {
    responsive = { action: input.action, seq: input.seq, at: performance.now() };
  }
  pending.push(input);
  if (pending.length > 120) pending.shift();
  room.send("input", input);
}

function prediction(now: number): WorldView | undefined {
  if (!world || !room) return world;
  const actor = world.actors.get(room.sessionId);
  if (!actor || !connected || !actor.hp || ["complete", "failed"].includes(world.status)) return world;
  const local = { ...actor };
  if (local.phase === "idle" || local.phase === "jump") {
    for (const input of pending) {
      if (input.action === "attack" || input.action === "morph") break;
      stepWalk(local, input, local.phase === "jump" ? DT * .83 : DT);
    }
    local.moving = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].some((key) => keys.has(key));
    if (responsive && now - responsive.at < 250) {
      local.phase = responsive.action === "morph" ? local.armed ? "recall" : "arm" : "attack";
      local.age = Math.floor((now - responsive.at) / (DT * 1000));
      const strike = FORMS[local.family].chain[0];
      local.duration = responsive.action === "morph" ? ARM_TICKS : strike.startup + strike.active + strike.recovery;
    }
  }
  const actors = new Map(world.actors);
  actors.set(room.sessionId, local);
  return { ...world, actors };
}

element("close-panel").addEventListener("click", closePanel);
element("dismiss-story").addEventListener("click", () => show("story", false));
element("companion-key").addEventListener("click", () => {
  if (world?.kind === "plaza") openPanel("room");
  else notify("Your companion’s room is at the plaza.");
});
element("dispatch-key").addEventListener("click", () => openPanel(world?.kind === "plaza" ? "dispatch" : "lobby"));
element("sound-key").addEventListener("click", async () => {
  try { await audio.toggle(); } catch (error) { notify((error as Error).message); }
  text("sound-key", audio.enabled ? "Sound on" : "Sound off");
  element("sound-key").setAttribute("aria-pressed", String(audio.enabled));
});
document.addEventListener("click", (event) => {
  const control = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!control || control.disabled) return;
  if (control.dataset.action) impulse(control.dataset.action as Action);
  const action = control.dataset.menu;
  if (!action) return;
  if (action === "select-last-crew") {
    if (connected && world?.kind === "plaza") room?.send(DISPATCH_RECENT_CREW);
    return;
  }
  if (action.startsWith("accept-invite-")) {
    const id = action.slice("accept-invite-".length);
    if (!busy && dispatchInvites.has(id)) {
      removeDispatchInvite(id);
      void enter(() => sdk.joinById(id) as Promise<RelayRoom>);
    }
    return;
  }
  if (action.startsWith("decline-invite-")) {
    removeDispatchInvite(action.slice("decline-invite-".length));
    return;
  }
  if (action === "plaza") { void plaza(); return; }
  if (action === "begin") { room?.send("begin"); closePanel(); return; }
  if (action === "resume") { closePanel(); return; }
  if (action === "signal-echo" && panel === "room") { openPanel("room-play"); return; }
  if (action === "companion-room" && panel === "room-play") { openPanel("room"); return; }
  if (action === "bellhouse-reply" && panel === "room" && profile.lore.includes("bellhouse")) {
    audio.bellhouse();
    const local = room && world?.actors.get(room.sessionId);
    if (local && room) view.react({ type: "observe", source: room.sessionId, x: local.x, z: local.z });
    notify(profile.companion + " remembers Spindle, Nacre, and Pith.");
    return;
  }
  if (action === "care") {
    room?.send("customize", { play: true });
    const remembersDeparture = profile.lore.includes("departure");
    audio.sound(remembersDeparture ? "departure" : "observe");
    const local = room && world?.actors.get(room.sessionId);
    if (local && room) view.react({ type: "observe", source: room.sessionId, x: local.x, z: local.z });
    notify(profile.companion + (remembersDeparture ? " taps the Bay Four departure rhythm." : " answers with a two-beat pulse."));
    return;
  }
  if (action === "morph-confirm") {
    room?.send("changeFamily", { family: targetFamily, expectedFamily: profile.family });
    openPanel("workbench");
    return;
  }
  if (action === "workbench") { openPanel("workbench"); return; }
  const [type, id] = action.split("-");
  if (type === "create" && Object.hasOwn(JOBS, id)) void create(id as Mission);
  if (type === "preview" && isFamily(id)) void create("training", id);
  if (type === "confirm" && isFamily(id)) { targetFamily = id; openPanel("confirm"); }
});
element("panel-body").addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.hasAttribute("data-dispatch-courier")) return;
  if (input.checked && invitedCouriers.size < DISPATCH_INVITE_LIMIT) invitedCouriers.add(input.value);
  else invitedCouriers.delete(input.value);
  text("dispatch-last-crew-status", "");
  syncDispatchCrew();
});
element("panel-body").addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  event.preventDefault();
  if (form.id === "join") void join(String(data.get("code") ?? ""));
  else if (form.id === "customize") room?.send("customize", Object.fromEntries(data));
});
window.addEventListener("keydown", (event) => {
  if (event.code === "Escape") { if (panel) closePanel(); else show("story", false); return; }
  if ((event.target as HTMLElement | null)?.matches("input, select, textarea") || panel || !connected) return;
  if (movement.has(event.code) || codes[event.code] || event.code === "KeyE") event.preventDefault();
  if (movement.has(event.code)) keys.add(event.code);
  if (event.repeat) return;
  if (codes[event.code]) impulse(codes[event.code]);
  if (event.code === "KeyE") room?.send("interact");
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
window.addEventListener("blur", clearControls);

async function start() {
  view = new GameView(canvas, element("labels"));
  await Promise.all([view.load(), connectProfile()]);
  const savedRoom = sessionStorage.getItem(resumeKey);
  if (savedRoom) {
    try {
      attach(await sdk.reconnect(savedRoom) as RelayRoom);
    } catch {
      sessionStorage.removeItem(resumeKey);
    }
  }
  if (!room) await plaza();
  show("loading", false);
  view.engine.runRenderLoop(() => {
    const now = performance.now();
    if (!timestamp) timestamp = now;
    accumulated = Math.min(.1, accumulated + (now - timestamp) / 1000);
    timestamp = now;
    while (accumulated >= DT) { tick(); accumulated -= DT; }
    view.render(prediction(now), markers(), room?.sessionId);
  });
}

void start().catch((error) => {
  text("loading-text", (error instanceof Error ? error.message : "Connection failed.") + " Check that the relay server is running.");
  element("loading").append(Object.assign(document.createElement("button"), { textContent: "Retry", className: "button", onclick: () => location.reload() }));
});
