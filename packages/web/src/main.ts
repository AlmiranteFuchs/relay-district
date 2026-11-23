import { Client, type Room } from "@colyseus/sdk";
import { ARM_TICKS, canRescueIn, DT, rescueDistance, RESCUE_RANGE, RESCUE_TICKS, stepWalk, type CombatEvent, type Input } from "../../shared/src/combat.ts";
import { availableTrinkets, battleRank, FORMS, isFamily, JOBS, LORE, missionLockReason, ROOM_THEMES, type Action, type Family,
  type Mission, type Profile } from "../../shared/src/content.ts";
import { nearestMarker, PLAZA, routeMarkers, TERMINAL_READERS_COMPLETE } from "../../shared/src/scene.ts";
import { GameView, type ViewActor, type WorldView } from "./view.ts";
import { GameAudio } from "./audio.ts";
import "./style.css";

type Wire = Omit<WorldView, "actors"> & { actors: { forEach(callback: (actor: ViewActor, id: string) => void): void } };
type RelayRoom = Room<any, Wire>;
type Panel = "" | "dispatch" | "lobby" | "room" | "workbench" | "confirm";

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
  state.actors.forEach((entry, id) => {
    actors.set(id, {
      x: entry.x, y: entry.y, z: entry.z, facing: entry.facing, name: entry.name, companion: entry.companion,
      family: entry.family, kind: entry.kind, hp: entry.hp, maxHp: entry.maxHp, energy: entry.energy,
      armed: entry.armed, connected: entry.connected, phase: entry.phase, age: entry.age, duration: entry.duration,
      combo: entry.combo, step: entry.step, ack: entry.ack, moving: entry.moving, rank: entry.rank,
      rescued: entry.rescued, rescueTarget: entry.rescueTarget, rescueTicks: entry.rescueTicks, signalTag: entry.signalTag,
    });
  });
  return {
    kind: state.kind, mission: state.mission, status: state.status, code: state.code, leader: state.leader,
    stage: state.stage, wave: state.wave, readerMask: state.readerMask, frame: state.frame, practice: state.practice, actors,
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
  });
  next.onMessage("combat", (event: CombatEvent) => {
    if (room === next) { view.react(event); audio.sound(event.type); }
  });
  next.onMessage("profile", (result: Profile) => {
    if (room !== next) return;
    profile = result;
    if (panel === "room" || panel === "workbench" || panel === "confirm" || panel === "dispatch") drawPanel();
  });
  next.onMessage("story", (result: { title: string; text: string }) => { if (room === next) story(result); });
  next.onMessage("notice", (message: string) => { if (room === next) notify(message); });
  next.onMessage("panel", (id: string) => {
    if (room === next && ["room", "dispatch", "workbench"].includes(id)) openPanel(id as Panel);
  });
  next.onDrop(() => {
    if (room !== next) return;
    connected = false; pending = []; responsive = undefined; clearControls(); setConnection("Reconnecting");
  });
  next.onReconnect(() => {
    if (room !== next) return;
    sessionStorage.setItem(resumeKey, next.reconnectionToken);
    connected = true; setConnection("Online"); notify("Back on the line.");
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
const create = (mission: Mission, preview?: Family) => enter(() => sdk.create("mission", { mission, preview }) as Promise<RelayRoom>);

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

function openPanel(value: Panel) { panel = value; clearControls(); drawPanel(); }
function closePanel() { panel = ""; show("shade", false); canvas.focus({ preventScroll: true }); }
const button = (label: string, action: string, disabled = false) =>
  '<button type="button" class="button" data-menu="' + action + '"' + (disabled ? " disabled" : "") + ">" + label + "</button>";
const item = (title: string, info: string, actions = "") =>
  '<div class="item"><div><strong>' + title + "</strong><small>" + info + '</small></div><div class="item-actions">' + actions + "</div></div>";

function drawPanel() {
  if (!panel || !profile) return;
  let title = "";
  let body = "";
  if (panel === "dispatch") {
    title = "District dispatch";
    body = '<div class="panel-grid">' + (Object.keys(JOBS) as Mission[]).map((job) => {
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
    }
  } else if (panel === "room") {
    title = escape(profile.companion) + "’s room";
    const form = FORMS[profile.family];
    const themeClass = profile.roomTheme === "Amber window" ? "amber" : profile.roomTheme === "Moss glass" ? "moss" : "";
    body = '<div class="room-portrait ' + themeClass + '"><img class="critter" src="/models/' + profile.family + '-portrait.png" alt="">'
      + "<strong>" + escape(profile.companion) + "</strong><small>" + form.name + " • " + escape(profile.trinket) + "</small></div>";
    body += "<p>Bond " + profile.bond + " • Battle rank " + battleRank(profile.battleXp) + " • " + profile.battleXp + " XP</p>";
    body += '<form id="customize" class="panel-grid"><label>Name <input name="companion" maxlength="20" value="' + escape(profile.companion) + '"></label>'
      + '<label>Trinket <select name="trinket">' + options(availableTrinkets(profile), profile.trinket) + "</select></label>"
      + '<label>Room <select name="roomTheme">' + options(ROOM_THEMES, profile.roomTheme) + '</select></label>'
      + '<div><button class="button">Save room</button> ' + button("Play together", "care") + "</div></form>";
    body += "<p class='quiet'>Favorite keepsake: the fare token. Former shapes: "
      + profile.history.map((family) => FORMS[family].name).join(" → ") + ".</p>";
    body += '<div class="panel-grid">' + (Object.keys(LORE) as (keyof typeof LORE)[]).map((id) => {
      const entry = LORE[id];
      return item(entry.title, escape(profile.lore.includes(id) ? entry.text : entry.hint));
    }).join("") + "</div>";
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
  show("shade", true);
}

function options(values: string[], selected: string) {
  return values.map((value) => "<option" + (value === selected ? " selected" : "") + ">" + escape(value) + "</option>").join("");
}

function signalObjective(world: WorldView) {
  if (world.mission === "night") return "Bring your recalled companion to the return register.";
  if (world.mission === "return") return "Bring your recalled companion to the return signal.";
  if (world.mission !== "terminal") return "Inspect the incoming signal at the end of the lane.";
  if (world.readerMask === TERMINAL_READERS_COMPLETE) return "Bring your recalled companion to the manifest at the east end.";
  if (!world.readerMask) return "Bring your recalled companion to both fare readers.";
  const missing = routeMarkers("terminal", world.stage)
    .find(({ readerBit }) => readerBit && !(world.readerMask & readerBit));
  return missing ? "Bring a recalled companion to the " + missing.title + "." : "Check both fare readers.";
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
        : world.mission === "training" ? "Arm your companion and practice on the target." : "Clear the lane. Step aside when an enemy winds up.",
      interlude: world.mission === "watch" ? "Second patrol approaching. Recall your companion to recover energy." : "Another group is approaching.",
      route: "Use the blue door marker to enter the relay room.",
      signal: signalObjective(world),
      complete: "Job complete. Use Mission to return to the plaza.",
      failed: "Party down. Retry from the Mission panel.",
    })[world.status] ?? "";
  text("objective-line", target);
  const nearby = nearestMarker(markers(), actor.x, actor.z);
  const terminalReady = world.status === "signal" && (nearby?.readerBit
    ? !(world.readerMask & nearby.readerBit) : world.readerMask === TERMINAL_READERS_COMPLETE);
  const point = world.mission !== "terminal" || terminalReady ? nearby : undefined;
  const needsRecall = world.status === "signal" && (point?.id === "register" || point?.id === "signal" && world.mission === "return"
    || point?.id === "manifest" && world.readerMask === TERMINAL_READERS_COMPLETE
    || point?.readerBit && !(world.readerMask & point.readerBit));
  const stationPrompt = point && actor.hp
    ? needsRecall && actor.armed ? "Q  •  Recall " + actor.companion + " to use the " + point.title : "E  •  " + point.title
    : "";
  const prompt = rescuePrompt(actor) || stationPrompt;
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
  if (action === "plaza") { void plaza(); return; }
  if (action === "begin") { room?.send("begin"); closePanel(); return; }
  if (action === "resume") { closePanel(); return; }
  if (action === "care") {
    room?.send("customize", { play: true });
    audio.sound("observe");
    const local = room && world?.actors.get(room.sessionId);
    if (local && room) view.react({ type: "observe", source: room.sessionId, x: local.x, z: local.z });
    notify(profile.companion + " answers with a two-beat pulse.");
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
