import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { matchMaker, Room, ServerError, type AuthContext, type Client } from "@colyseus/core";
import {
  battleRank, BAY_FOUR_TICKET, BELLHOUSE_SEAL, isFamily, isMission, JOBS, LORE, missionLockReason, PATCH_MS, RELAY_PENNANT, SIGNAL_TAG, TICK_RATE,
  type Action, type Family, type Mission, type Profile,
} from "../../shared/src/content.ts";
import { canRescueIn, hurtPlayer, isInvulnerable, makeEnemy, makePlayer, resetPlayer, rescueDistance, RESCUE_HEALTH, RESCUE_RANGE, RESCUE_TICKS,
  sanitizeAxes, stepEnemy, stepPlayer, type CombatEvent, type Enemy, type EnemyKind, type Input, type Player } from "../../shared/src/combat.ts";
import { COMPANION_PLAY, SIGNAL_COUNT, SIGNAL_PLAYBACK_MS, SIGNAL_ROUND_MS,
  type CompanionPlayMessage, type Signal } from "../../shared/src/companion-play.ts";
import { DISPATCH_INVITE, DISPATCH_INVITE_LIMIT, DISPATCH_RECENT_CREW, DISPATCH_RECENT_CREW_TTL_MS,
  type DispatchInvitation, type DispatchRecentCrew } from "../../shared/src/dispatch.ts";
import { ARCHIVE_CHANNELS_COMPLETE, ARCHIVE_CHANNEL_TICKS, BAY_RELAY_CALLS_COMPLETE, BAY_RELAY_STAGGER_TICKS,
  BELLHOUSE_CALLS, BELLHOUSE_CALLS_COMPLETE, DEPARTURE_REINFORCEMENT_TICKS, LIFT_LEG_TICKS, LIFT_PHASE, nearestMarker, PLAZA,
  PUMP_LANES, PUMP_PHASE, PUMP_TIMING, routeMarkers, TERMINAL_READERS_COMPLETE, type BellhouseCue, type BellhouseNote,
  VIADUCT_RELAY_TICKS, type Marker } from "../../shared/src/scene.ts";
import { ActorState, CrewAssistState, GameState } from "./wire.ts";
import type { Session, Store } from "./store.ts";

let store: Store;
const codes = new Map<string, string>();
const profileRooms = new Map<string, Set<GameRoom>>();
const recentCrews = new Map<string, { members: string[]; expiresAt: number }>();
let recentCrewExpiry: ReturnType<typeof setTimeout> | undefined;
const actions = new Set<Action>(["attack", "skill", "mastery", "morph", "dodge", "jump"]);
export function configureRooms(db: Store) {
  store = db;
  recentCrews.clear();
  clearTimeout(recentCrewExpiry);
  recentCrewExpiry = undefined;
}
export function roomByCode(code: string) { return codes.get(code.toUpperCase()); }

function expireRecentCrews() {
  recentCrewExpiry = undefined;
  const now = Date.now();
  let nextExpiry = Infinity;
  for (const [id, crew] of recentCrews) {
    if (crew.expiresAt <= now) recentCrews.delete(id);
    else nextExpiry = Math.min(nextExpiry, crew.expiresAt);
  }
  if (nextExpiry !== Infinity) recentCrewExpiry = setTimeout(expireRecentCrews, nextExpiry - now).unref();
}

function rememberCrew(members: string[]) {
  if (members.length < 2) return;
  const crew = { members, expiresAt: Date.now() + DISPATCH_RECENT_CREW_TTL_MS };
  for (const profileId of members) recentCrews.set(profileId, crew);
  recentCrewExpiry ??= setTimeout(expireRecentCrews, DISPATCH_RECENT_CREW_TTL_MS).unref();
}

interface Entry {
  profileId: string;
  player: Player;
  client: Client;
  connected: boolean;
  input: Input;
  at: number;
  ack: number;
  rescued?: boolean;
  rescue?: { target: Entry; start: number };
}

interface SignalRound {
  id: string;
  signals: Signal[];
  startedAt: number;
}

interface RelayOpening {
  callerId: string;
  callerName: string;
  station: string;
  enemyIds: Set<string>;
  lastFrame: number;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? input as Record<string, unknown> : {};
}

function isColyseusId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export class GameRoom extends Room<{ state: GameState }> {
  state = new GameState();
  protected players = new Map<string, Entry>();
  protected enemies = new Map<string, Enemy>();
  protected events: CombatEvent[] = [];

  static async onAuth(token: string, _options: unknown, context: AuthContext) {
    const session = store.session(token || context.token);
    if (!session) throw new ServerError(401, "A local guest session is required.");
    return session;
  }

  protected install() {
    this.setPatchRate(PATCH_MS);
    this.onMessage("input", (client, raw: unknown) => this.readInput(client, raw));
    this.onMessage("interact", (client) => this.interact(client));
    this.setFixedTimestep(() => this.step(), TICK_RATE);
  }

  onJoin(client: Client, _options: unknown, auth: Session) {
    if (this.players.size >= this.maxClients || [...this.players.values()].some((entry) => entry.profileId === auth.id)) {
      throw new ServerError(409, "This character is already in the room or the room is full.");
    }
    const entry: Entry = {
      client, profileId: auth.id, connected: true, input: { seq: 0, x: 0, z: 0 }, at: 0, ack: 0,
      player: makePlayer(client.sessionId, auth.profile.name, auth.profile.companion, auth.profile.family),
    };
    resetPlayer(entry.player, this.players.size);
    this.players.set(client.sessionId, entry);
    this.state.actors.set(client.sessionId, new ActorState());
    const rooms = profileRooms.get(auth.id) ?? new Set<GameRoom>();
    rooms.add(this);
    profileRooms.set(auth.id, rooms);
    this.applyProfile(entry, auth.profile);
    this.syncPlayer(entry);
  }

  async onDrop(client: Client) {
    const entry = this.players.get(client.sessionId);
    if (!entry) return;
    entry.connected = false;
    entry.input = { seq: entry.ack, x: 0, z: 0 };
    try {
      const resumed = await this.allowReconnection(client, 30);
      entry.client = resumed;
      entry.connected = true;
      entry.at = this.state.frame;
      this.applyProfile(entry, store.profile(entry.profileId));
    } catch {
      // Colyseus calls onLeave when the reservation expires.
    }
  }

  onLeave(client: Client) {
    const entry = this.players.get(client.sessionId);
    if (!entry) return;
    this.players.delete(client.sessionId);
    this.state.actors.delete(client.sessionId);
    const rooms = profileRooms.get(entry.profileId);
    if (rooms?.delete(this) && rooms.size === 0) profileRooms.delete(entry.profileId);
  }

  protected readInput(client: Client, raw: unknown) {
    const entry = this.players.get(client.sessionId);
    if (!entry?.connected) return;
    const input = asRecord(raw);
    const seq = input.seq;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq <= entry.input.seq || seq > 0xffffffff) return;
    const axes = sanitizeAxes({ x: typeof input.x === "number" ? input.x : 0, z: typeof input.z === "number" ? input.z : 0 });
    const action = typeof input.action === "string" && actions.has(input.action as Action) ? input.action as Action : undefined;
    entry.input = { ...axes, seq, action: action ?? entry.input.action };
    entry.at = this.state.frame;
  }

  protected actors(): Player[] { return [...this.players.values()].map((entry) => entry.player); }

  protected applyProfile(entry: Entry, profile: Profile) {
    entry.player.name = profile.name;
    entry.player.companion = profile.companion;
    entry.player.rank = battleRank(profile.battleXp);
    entry.player.mastered = profile.mastery.includes(entry.player.family);
    const actor = this.state.actors.get(entry.player.id)!;
    actor.signalTag = profile.trinket === SIGNAL_TAG;
    actor.bayFourTicket = profile.trinket === BAY_FOUR_TICKET;
    actor.relayPennant = profile.trinket === RELAY_PENNANT;
    actor.bellhouseSeal = profile.trinket === BELLHOUSE_SEAL;
    if (entry.connected) entry.client.send("profile", profile);
  }

  protected syncPlayer(entry: Entry) {
    const p = entry.player;
    const view = this.state.actors.get(p.id)!;
    Object.assign(view, {
      x: p.x, y: p.y, z: p.z, facing: p.facing, name: p.name, companion: p.companion, family: p.family,
      hp: p.hp, energy: p.energy, armed: p.armed, connected: entry.connected, ack: entry.ack,
      phase: !p.hp ? "down" : p.stagger ? "hurt" : p.move?.kind ?? (p.y > 0.04 ? "jump" : "idle"),
      age: p.move?.age ?? 0, duration: p.move?.length ?? 0, step: p.move?.step ?? 0, combo: p.combo,
      moving: !p.move && !p.stagger && (Math.abs(entry.input.x) + Math.abs(entry.input.z) > 0.1) && this.state.frame - entry.at < 24,
      rank: p.rank,
      rescued: entry.rescued ?? false, rescueTarget: entry.rescue?.target.player.id ?? "",
      rescueTicks: entry.rescue ? this.state.frame - entry.rescue.start : 0,
    });
  }

  protected syncEnemy(enemy: Enemy) {
    const view = this.state.actors.get(enemy.id)!;
    Object.assign(view, { x: enemy.x, y: enemy.y, z: enemy.z, facing: enemy.facing, hp: enemy.hp,
      maxHp: enemy.maxHp, phase: enemy.phase, age: enemy.ticks, moving: enemy.phase === "advance",
      kind: enemy.kind, name: ({
        keeper: "Switchkeeper", guard: "Gateback", skitter: "Signal Crawler", runner: "Cable Runner", dummy: "Practice target",
      })[enemy.kind] });
  }

  protected step() {
    this.state.frame++;
    this.events.length = 0;
    const safe = this.state.status !== "combat" || ![...this.enemies.values()].some((enemy) => enemy.hp && enemy.kind !== "dummy");
    const frozen = this.state.status === "failed" || this.state.status === "complete";
    const attackTargets = this.state.status === "interlude" ? [] : this.enemies;
    for (const entry of this.players.values()) {
      if (!frozen && entry.connected) {
        const input = this.state.frame - entry.at > 24 ? { x: 0, z: 0 } : entry.input;
        stepPlayer(entry.player, input, entry.input.action, this.state.frame, attackTargets.values(), this.events, safe);
        entry.ack = entry.input.seq;
      }
    }
    if (this.state.status === "combat") {
      const targets = [...this.players.values()].filter((entry) => entry.connected).map((entry) => entry.player);
      const occupied = new Set([...this.enemies.values()]
        .filter((enemy) => enemy.hp && (enemy.phase === "windup" || enemy.phase === "active"))
        .map((enemy) => enemy.target));
      for (const enemy of this.enemies.values()) {
        stepEnemy(enemy, targets, this.state.frame, this.events, (target) => !occupied.has(target));
        if (enemy.phase === "windup" || enemy.phase === "active") occupied.add(enemy.target);
      }
    }
    this.afterStep();
    for (const entry of this.players.values()) {
      entry.input.action = undefined;
      this.syncPlayer(entry);
    }
    for (const enemy of this.enemies.values()) this.syncEnemy(enemy);
    for (const event of this.events) this.broadcast("combat", event);
  }

  protected afterStep() {}
  protected interact(_client: Client) {}

  protected observe(entry: Entry, marker: Marker) {
    if (!marker.lore) return;
    const profile = store.discoverLore(entry.profileId, marker.lore);
    this.applyProfile(entry, profile);
    entry.client.send("story", LORE[marker.lore]);
    this.broadcast("combat", { type: "observe", source: entry.player.id, x: marker.x, z: marker.z });
  }
}

export class PlazaRoom extends GameRoom {
  maxClients = 16;
  private readonly signalRounds = new WeakMap<Entry, SignalRound>();

  onCreate() {
    this.install();
    this.onMessage(COMPANION_PLAY, (client, raw: unknown) => this.playSignalEcho(client, raw));
    this.onMessage(DISPATCH_INVITE, (client, raw: unknown) => this.sendDispatchInvites(client, raw));
    this.onMessage(DISPATCH_RECENT_CREW, (client) => this.sendRecentCrew(client));
    this.onMessage("customize", (client, raw: unknown) => {
      const entry = this.players.get(client.sessionId);
      if (entry) this.applyProfile(entry, store.customize(entry.profileId, asRecord(raw)));
    });
    this.onMessage("changeFamily", (client, raw: unknown) => {
      const entry = this.players.get(client.sessionId);
      if (!entry) return;
      const point = PLAZA[0];
      if (Math.hypot(entry.player.x - point.x, entry.player.z - point.z) > 2.7) {
        client.send("notice", "Move closer to the morph workbench.");
        return;
      }
      const data = asRecord(raw);
      if (!isFamily(data.family) || !isFamily(data.expectedFamily)) return;
      if ([...(profileRooms.get(entry.profileId) ?? [])].some((room) => room.state.kind === "mission")) {
        client.send("notice", "Return from the mission before morphing.");
        return;
      }
      const result = store.morph(entry.profileId, data.family, data.expectedFamily);
      entry.player.family = result.profile.family;
      entry.player.armed = false;
      entry.player.move = null;
      this.applyProfile(entry, result.profile);
      client.send("notice", result.notice);
      if (result.ok) this.broadcast("combat", { type: "arm", source: entry.player.id, x: entry.player.x, z: entry.player.z });
    });
  }

  private playSignalEcho(client: Client, raw: unknown) {
    const entry = this.players.get(client.sessionId);
    if (!entry?.connected) return;
    const request = asRecord(raw);
    if (request.type === "start") {
      const { requestId } = request;
      if (typeof requestId !== "number" || !Number.isSafeInteger(requestId) || requestId <= 0) return;
      const pattern = randomInt(1, 2 ** SIGNAL_COUNT - 1);
      const signals = Array.from({ length: SIGNAL_COUNT }, (_, index): Signal => pattern & (1 << index) ? "long" : "short");
      const round = { id: randomUUID(), signals, startedAt: Date.now() };
      this.signalRounds.set(entry, round);
      client.send(COMPANION_PLAY, { type: "round", requestId, roundId: round.id, signals } satisfies CompanionPlayMessage);
      return;
    }

    const round = this.signalRounds.get(entry);
    if (!round || request.roundId !== round.id) return;
    if (request.type === "cancel") {
      this.signalRounds.delete(entry);
      return;
    }
    const { signals } = request;
    if (request.type !== "answer" || !Array.isArray(signals) || signals.length !== SIGNAL_COUNT
      || !signals.every((signal: unknown) => signal === "short" || signal === "long")) return;
    const now = Date.now();
    const elapsed = now - round.startedAt;
    if (elapsed < SIGNAL_PLAYBACK_MS) return;
    this.signalRounds.delete(entry);

    let outcome: "matched" | "missed" | "expired" = "missed";
    let bondAdded = false;
    if (elapsed >= SIGNAL_ROUND_MS) {
      outcome = "expired";
    } else if (round.signals.every((signal, index) => signal === signals[index])) {
      outcome = "matched";
      const before = store.profile(entry.profileId).bond;
      const profile = store.customize(entry.profileId, { play: true }, now);
      bondAdded = profile.bond > before;
      this.applyProfile(entry, profile);
    }
    client.send(COMPANION_PLAY, { type: "result", roundId: round.id, outcome, bondAdded } satisfies CompanionPlayMessage);
  }

  private sendDispatchInvites(client: Client, raw: unknown) {
    const sender = this.players.get(client.sessionId);
    if (!sender?.connected) return;
    const { roomId, targets } = asRecord(raw);
    if (!isColyseusId(roomId) || !Array.isArray(targets) || !targets.length
      || targets.length > DISPATCH_INVITE_LIMIT || !targets.every(isColyseusId)) {
      client.send("notice", "Select up to three couriers from this plaza to invite.");
      return;
    }
    const mission = matchMaker.getLocalRoomById(roomId);
    if (!(mission instanceof MissionRoom)) {
      client.send("notice", "That mission lobby is no longer open.");
      return;
    }
    mission.inviteFromPlaza(sender, [...new Set(targets)].map((target) => this.players.get(target)));
  }

  private sendRecentCrew(client: Client) {
    const sender = this.players.get(client.sessionId);
    if (!sender?.connected) return;
    const crew = recentCrews.get(sender.profileId);
    const targets: string[] = [];
    if (crew && crew.expiresAt > Date.now()) {
      const connected = new Map<string, string>();
      for (const [sessionId, entry] of this.players) {
        if (entry.connected && entry !== sender) connected.set(entry.profileId, sessionId);
      }
      for (const profileId of crew.members) {
        const sessionId = connected.get(profileId);
        if (sessionId) targets.push(sessionId);
      }
    }
    client.send(DISPATCH_RECENT_CREW, { targets } satisfies DispatchRecentCrew);
  }

  protected override interact(client: Client) {
    const entry = this.players.get(client.sessionId);
    if (!entry) return;
    const point = nearestMarker(PLAZA, entry.player.x, entry.player.z);
    if (!point) return client.send("notice", "Move closer to a plaza station.");
    if (point.lore) this.observe(entry, point);
    else client.send("panel", point.id);
  }
}

interface Spawn { kind: EnemyKind; x: number; z: number }
const wave = (...entries: [EnemyKind, number, number][]): Spawn[] => entries.map(([kind, x, z]) => ({ kind, x, z }));
const chapterWaves = [
  wave(["skitter", 2.2, -1.2], ["skitter", 5.0, 1.65]),
  wave(["guard", 4.3, 0.2], ["skitter", 6.4, -2.05], ["skitter", 5.4, 2.45]),
  wave(["keeper", 6, 0.1]),
];
const challengeWaves = {
  platform: wave(["skitter", 3.0, -2], ["skitter", 5.5, 0.2], ["skitter", 3.2, 2.4], ["guard", 7.3, 1.7]),
  transformer: wave(["guard", 4.1, -1.6], ["guard", 5.8, 1.8], ["keeper", 8.6, 0]),
};
const nightWave = wave(["skitter", 3.8, -1.5], ["guard", 6.4, 1.7]);
const returnWaves = [
  wave(["skitter", 2.2, -2.25], ["skitter", 5.15, 2.45]),
  wave(["keeper", 0.2, -1.45], ["skitter", 4.9, 3.35]),
];
const terminalPatrol = wave(["skitter", -2.8, -1.1], ["guard", 4.4, 0.1], ["skitter", 7.1, 2.7]);
const archiveWaves = [
  wave(["skitter", -1.85, -2.3], ["guard", 4.2, 2.1]),
  wave(["keeper", 8, -1.6], ["skitter", -6.3, 2.7]),
];
const exchangeWaves = [
  wave(["runner", 1.2, -1.25]),
  wave(["guard", 8.4, -.7], ["runner", -3.8, -.85]),
];
const departureWaves = [
  wave(["skitter", .2, -2], ["guard", 5.1, 1.85]),
  wave(["keeper", 8.35, -.85]),
  wave(["runner", -5.8, -2.15]),
];
const viaductWaves = [
  wave(["runner", 2.6, -2.1], ["skitter", 5.2, 2.4]),
  wave(["guard", 8.4, 2.15], ["runner", -3.7, 1.25]),
];
const liftWaves = [
  wave(["skitter", -2.45, -2.8], ["skitter", 3.85, 2.6]),
  wave(["guard", 6.1, 1.5], ["runner", 2.7, -2.55]),
];
const pumpWaves = [
  wave(["runner", .65, -2.4], ["skitter", 3.75, 2.4]),
  wave(["keeper", 5.35, 0]),
];
const bellhouseWaves = [
  wave(["skitter", -2.7, -1.8], ["skitter", 3.1, 2.6]),
  wave(["guard", 6.8, -.85], ["runner", 1.85, 1]),
];
const nextPressureLane = [2, 0, 1];
const bayRelayPatrol = wave(["runner", -2.85, -1.3], ["guard", 4.75, .9], ["runner", 7.25, -2.35]);
const watchWaves = [
  wave(["skitter", -2.5, 2.1], ["guard", 3.8, -1.7]),
  wave(["keeper", 4.5, -.9], ["skitter", -5.8, 2.9]),
];

export class MissionRoom extends GameRoom {
  maxClients = 4;
  private mission: Mission = "chapter";
  private previewFamily?: Family;
  private runId = "";
  private waveReady = 0;
  private serial = 0;
  private watchCommended = true;
  private dispatchInvitesSent = false;
  private relayOpening?: RelayOpening;

  onCreate(raw: unknown) {
    const options = asRecord(raw);
    if (isMission(options.mission)) this.mission = options.mission;
    if (this.mission === "training" && isFamily(options.preview)) {
      this.previewFamily = options.preview;
      this.state.practice = true;
    }
    if (this.mission === "training") this.maxClients = 1;
    this.state.kind = "mission";
    this.state.mission = this.mission;
    this.state.status = "lobby";
    do { this.state.code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase(); } while (codes.has(this.state.code));
    codes.set(this.state.code, this.roomId);
    this.install();
    this.onMessage("begin", (client) => {
      if (client.sessionId === this.state.leader && ["lobby", "failed", "complete"].includes(this.state.status)) this.begin();
    });
  }

  override onJoin(client: Client, options: unknown, auth: Session) {
    if (this.state.status !== "lobby") throw new ServerError(409, "This mission already started.");
    const locked = missionLockReason(this.mission, auth.profile.clears);
    if (locked) throw new ServerError(403, locked);
    if (this.previewFamily && !auth.profile.discovered.includes(this.previewFamily)) throw new ServerError(403, "This form has not been discovered.");
    super.onJoin(client, options, auth);
    if (!this.state.leader) this.state.leader = client.sessionId;
    if (this.previewFamily) {
      const entry = this.players.get(client.sessionId)!;
      entry.player.family = this.previewFamily;
      entry.player.rank = 1;
      entry.player.mastered = false;
    }
  }

  inviteFromPlaza(sender: Entry, targets: (Entry | undefined)[]) {
    const leader = this.players.get(this.state.leader);
    if (this.state.status !== "lobby" || !leader?.connected || leader.profileId !== sender.profileId) {
      sender.client.send("notice", "Only the leader of an open mission lobby can invite couriers.");
      return;
    }
    if (this.mission === "training") {
      leader.client.send("notice", "The practice floor is for one courier.");
      return;
    }
    if (this.dispatchInvitesSent) {
      leader.client.send("notice", "Dispatch invitations have already been sent for this room.");
      return;
    }

    const invitation: DispatchInvitation = { roomId: this.roomId, mission: this.mission, inviter: leader.player.name };
    const present = new Set([...this.players.values()].map((entry) => entry.profileId));
    const slots = this.maxClients - this.players.size;
    const skipped: string[] = [];
    let sent = 0;
    for (const target of targets) {
      if (!target?.connected) {
        skipped.push("A selected courier is no longer in this plaza.");
        continue;
      }
      if (present.has(target.profileId)) {
        skipped.push(target.player.name + " is already in the mission lobby.");
        continue;
      }
      const locked = missionLockReason(this.mission, store.profile(target.profileId).clears);
      if (locked) {
        skipped.push("The job is locked for " + target.player.name + ". " + locked);
        continue;
      }
      if (sent >= slots) {
        skipped.push("There is no open seat for " + target.player.name + ".");
        continue;
      }
      target.client.send(DISPATCH_INVITE, invitation);
      sent++;
    }
    this.dispatchInvitesSent = sent > 0;
    const result = sent ? (sent === 1 ? "Invitation sent." : "Invitations sent to " + sent + " couriers.") : "No invitations were sent.";
    leader.client.send("notice", [result, ...skipped].join(" "));
  }

  override onLeave(client: Client) {
    super.onLeave(client);
    if (this.state.leader === client.sessionId) this.state.leader = this.players.keys().next().value ?? "";
  }

  onDispose() {
    codes.delete(this.state.code);
    for (const entry of this.players.values()) {
      const rooms = profileRooms.get(entry.profileId);
      if (rooms?.delete(this) && rooms.size === 0) profileRooms.delete(entry.profileId);
    }
  }

  private story(title: string, text: string) { this.broadcast("story", { title, text }); }

  private begin() {
    void this.lock();
    if (this.mission !== "training") {
      const members = [...this.players.values()].filter((entry) => entry.connected).map((entry) => entry.profileId);
      rememberCrew(members);
    }
    this.runId = randomUUID();
    this.state.stage = 0;
    this.state.wave = 0;
    this.state.readerMask = 0;
    this.state.readerUntil = 0;
    this.state.crewAssists.clear();
    this.state.status = "approach";
    this.waveReady = 0;
    this.watchCommended = true;
    this.relayOpening = undefined;
    this.clearEnemies();
    [...this.players.values()].forEach((entry, index) => {
      entry.rescue = undefined;
      entry.rescued = false;
      resetPlayer(entry.player, index);
    });
    if (this.mission === "chapter") {
      this.story("The Last Crossing", "A fare token dated 1999. The gate still recognizes it. Read the service desk if you want to know what happened here, then head down the lane.");
    } else if (this.mission === "night") {
      this.story(JOBS.night.title, "The train from the relay has arrived with its lights out. Your partner answers the door chime with two pulses. Follow the platform to the conductor’s register.");
      for (const { client, connected, player } of this.players.values()) {
        if (connected) client.send("combat", { type: "observe", source: player.id, x: player.x, z: player.z });
      }
    } else if (this.mission === "return") {
      this.spawn(returnWaves[0]);
      this.story(JOBS.return.title, "The register points to a turnout at the east junction. Clear the track, then let your partner answer the return signal.");
    } else if (this.mission === "terminal") {
      this.state.status = "signal";
      this.story(JOBS.terminal.title, "The terminal split each fare between two readers. Bring your partner to both with its weapon recalled. A party can split up and use one reader each.");
    } else if (this.mission === "archive") {
      this.spawn(archiveWaves[0]);
      this.story(JOBS.archive.title, "The manifest leads to a console sealed under the river wall. Its reader is still warm. Clear the entrance patrol and bring your recalled partner to the console.");
    } else if (this.mission === "exchange") {
      this.spawn(exchangeWaves[0]);
      this.story(JOBS.exchange.title, "Mara's recording leads to the exchange under the river pumps. A Cable Runner is hunting in the entrance. Step across the lane when it coils, then strike while it recovers.");
    } else if (this.mission === "departure") {
      this.spawn(departureWaves[0]);
      this.story(JOBS.departure.title, "Bay 4 has been waiting for both halves of the fare. Clear the concourse and bring your recalled partner to the departure signal.");
    } else if (this.mission === "viaduct") {
      this.spawn(viaductWaves[0]);
      this.story(JOBS.viaduct.title, "The 05:20 train crossed into the river fog. Your partner can still hear the hand switches Mara's crew used to keep the east feed running. Clear the scout patrol and follow the signal.");
    } else if (this.mission === "lift") {
      this.spawn(liftWaves[0]);
      this.story(JOBS.lift.title, "The signal ledger leads to a service lift under the river wall. Clear the upper landing to get to the Brake Wheel.");
    } else if (this.mission === "pump") {
      this.spawn(pumpWaves[0]);
      this.story(JOBS.pump.title, "The 05:20 passed the pump intake before the gates closed. Clear the patrol and check the Intake Control with your partner.");
    } else if (this.mission === "bellhouse") {
      this.spawn(bellhouseWaves[0]);
      this.story(JOBS.bellhouse.title, "The original pump roster is at the east desk. Ina is waiting for the old roll call before she and the other couriers add their signatures. Clear the hall so your partner can answer.");
    } else if (this.mission === "bayrelay") {
      this.spawn(bayRelayPatrol);
      this.story(JOBS.bayrelay.title, "Dispatch needs both call boxes checked. Use each box with a recalled partner. During combat, each call interrupts the patrol once. Clear the platform to sign off.");
    } else if (this.mission === "watch") {
      this.spawn(watchWaves[0]);
      this.story(JOBS.watch.title, "Dispatch needs the night crew to keep this platform open. Clear both patrols. If everyone stays on their feet, take a Signal Tag home for your partner.");
    } else if (this.mission === "training") {
      this.spawn(wave(["dummy", 0, 0]));
      const target = [...this.enemies.values()][0];
      target.hp = target.maxHp = 132;
      this.story(this.state.practice ? "Form preview" : "Mastery drill",
        this.state.practice ? "Try the discovered form. Your current family and battle XP remain safe at the plaza." : "Arm your partner and break the practice target to record this family's mastery drill.");
    } else {
      this.spawn(challengeWaves[this.mission]);
      this.story(JOBS[this.mission].title,
        "Keep your partner close. The signal resolves when the lane is clear.");
    }
  }

  private clearEnemies() {
    for (const id of this.enemies.keys()) this.state.actors.delete(id);
    this.enemies.clear();
  }

  private spawn(entries: Spawn[]) {
    this.clearEnemies();
    this.joinFight(entries);
  }

  private joinFight(entries: Spawn[]) {
    for (const { kind, x, z } of entries) {
      const id = "enemy-" + ++this.serial;
      const enemy = makeEnemy(id, kind, x, z, this.players.size);
      this.enemies.set(id, enemy);
      this.state.actors.set(id, new ActorState());
      this.syncEnemy(enemy);
    }
    this.state.status = "combat";
  }

  protected override afterStep() {
    this.creditRelayOpening();
    if (this.mission === "viaduct") this.expireViaductRelay();
    if (this.mission === "watch" && this.watchCommended && this.state.status === "combat"
      && this.actors().some((player) => player.hp === 0)) {
      this.watchCommended = false;
      this.broadcast("notice", "A courier went down. The patrol contract can still be cleared.");
    }
    this.stepRescues();
    if (this.mission === "archive" && this.state.status === "route" && this.state.frame >= this.waveReady) {
      this.state.wave = this.state.wave === 0 ? 1 : 0;
      this.waveReady += ARCHIVE_CHANNEL_TICKS;
    }
    if (this.state.status === "approach" && this.actors().some((player) => player.x > -2.35)) {
      this.spawn(this.mission === "night" ? nightWave : chapterWaves[0]);
      return;
    }
    if (this.state.status === "interlude" && this.waveReady && this.state.frame >= this.waveReady) {
      this.waveReady = 0;
      if (this.mission === "departure") {
        this.joinFight(departureWaves[2]);
      } else {
        this.spawn(this.mission === "watch" ? watchWaves[1] : chapterWaves[1]);
      }
      return;
    }
    if (this.state.status !== "combat") return;
    if ([...this.players.values()].length && this.actors().every((player) => player.hp === 0)) {
      this.state.status = "failed";
      this.story("Signal lost", "The party is down. Use Mission to retry the job.");
      return;
    }
    if (this.mission === "lift" && this.state.stage === 2) this.advanceLift();
    if (this.mission === "departure" && this.state.stage === 1 && this.state.wave === 0) {
      const keeper = [...this.enemies.values()].find((enemy) => enemy.kind === "keeper");
      if (keeper && keeper.hp * 2 <= keeper.maxHp) {
        this.state.status = "interlude";
        this.state.wave = 1;
        this.waveReady = this.state.frame + DEPARTURE_REINFORCEMENT_TICKS;
        if (keeper.hp > 0) {
          keeper.phase = "recover";
          keeper.ticks = 30;
          keeper.target = "";
        }
        this.story("West duct opening", "The Switchkeeper braces against the brake handle. A Cable Runner is approaching through the west duct. Move off the west lane and get ready.");
        return;
      }
    }
    const enemiesRemain = [...this.enemies.values()].some((enemy) => enemy.hp > 0);
    if (enemiesRemain && this.mission === "pump" && this.state.stage === 2) this.advancePump();
    if (!this.enemies.size || enemiesRemain) return;
    if (this.mission === "night") {
      this.state.status = "signal";
      this.story("The return register", "The platform is quiet. The register’s reader gives two short pulses. Recall your partner and bring it to the reader.");
      return;
    }
    if (this.mission === "return") {
      this.state.status = "signal";
      if (this.state.wave === 0) {
        this.story("The east turnout", "The signal can move the turnout now. Recall your partner with Q, then use the signal box to open the return track.");
      } else {
        this.story("A live line", "The guards are down. The signal is green for the first time since the evacuation. Bring your recalled partner to the box again to read the log.");
      }
      return;
    }
    if (this.mission === "terminal") {
      this.state.status = "signal";
      this.story("Terminal clear", "The manifest drawer is open. Take your recalled partner to the east end and read the manifest together.");
      return;
    }
    if (this.mission === "archive") {
      if (this.state.stage === 2) this.state.stage = 3;
      this.state.status = "signal";
      if (this.state.stage === 0) {
        this.story("Archive entrance clear", "The old console is answering the fare token. Recall your partner before you touch it.");
      } else {
        this.story("Playback available", "The archive has kept one voice message. Bring your recalled partner to the recorder at the east end.");
      }
      return;
    }
    if (this.mission === "exchange") {
      this.state.status = "signal";
      if (this.state.stage === 0) {
        this.story("The transfer control", "The junction is clear. Take your recalled partner to the transfer control. It remembers the rhythm from the Tidegate recording.");
      } else {
        this.state.stage = 2;
        this.story("Crew desk clear", "The transfer gate is holding. Recall your partner at the crew desk and recover the log.");
      }
      return;
    }
    if (this.mission === "departure") {
      this.state.status = "signal";
      if (this.state.stage === 0) {
        this.story("Departure signal clear", "The lamp is flashing the same rhythm as the keepsake. Recall your partner and let it answer the departure signal.");
      } else {
        this.state.stage = 2;
        this.story("Boarding reader ready", "The platform is clear. Recall your partner and match both halves of the fare at the boarding reader.");
      }
      return;
    }
    if (this.mission === "viaduct") {
      this.state.stage = this.state.stage === 0 ? 1 : 3;
      this.state.status = "signal";
      if (this.state.stage === 1) {
        this.story("The hand switches", "Recall your partner and start at West Relay. The east post needs to answer within ten seconds. Two couriers can split up, or you can cross the lane yourself.");
      } else {
        this.story("East feed restored", "The east relay is holding. Bring your recalled partner to the signal ledger to see where the feed goes next.");
      }
      return;
    }
    if (this.mission === "lift") {
      if (this.state.stage === 0) {
        this.state.stage = 1;
        this.state.status = "signal";
        this.story("Upper landing clear", "Recall your partner at the Brake Wheel to lower the lift. The brake has a bad tooth. Listen for it to catch halfway down.");
      } else if (this.state.readerMask === LIFT_PHASE.docked) {
        this.state.stage = 3;
        this.state.status = "signal";
        this.story("Lower landing clear", "The lift has reached the bottom and the guard is down. Bring your recalled partner to the Lift Log.");
      }
      return;
    }
    if (this.mission === "pump") {
      this.state.status = "signal";
      this.state.readerMask = PUMP_PHASE.idle;
      this.state.readerUntil = 0;
      if (this.state.stage === 0) {
        this.state.stage = 1;
        this.story("Intake clear", "Your partner recognizes the markings beside the intake. Recall it and use the Intake Control. Watch the floor when pressure returns.");
      } else {
        this.state.stage = 3;
        this.story("Pressure dropping", "The Switchkeeper is down and the intake is settling. Recall your partner at the Pump Record by the east wall.");
      }
      return;
    }
    if (this.mission === "bellhouse") {
      this.state.status = "signal";
      if (this.state.stage === 0) {
        this.state.stage = 1;
        this.story("The shift calls", "Spindle, Nacre, and Pith each had their own bell. Bring your recalled partner to any call to start. The first reply will draw the guard into the hall.");
      } else if (this.state.readerMask === BELLHOUSE_CALLS_COMPLETE) {
        this.openBellhouseRoster();
      } else {
        this.story("The hall is quiet", "The guard is down. Answer the remaining calls with your recalled partner so the crews can sign the roster.");
      }
      return;
    }
    if (this.mission === "bayrelay") {
      if (this.state.readerMask === BAY_RELAY_CALLS_COMPLETE) {
        this.finish();
      } else {
        this.state.status = "signal";
        this.story("Patrol clear", "Recall your partner and use any call box still waiting for an answer.");
      }
      return;
    }
    if (this.mission === "watch" && this.state.wave === 0) {
      this.state.wave = 1;
      this.state.status = "interlude";
      this.waveReady = this.state.frame + 150;
      this.story("Patrol incoming", "Your partner picks up movement at both ends of the platform. A Switchkeeper is coming down the east lane.");
      return;
    }
    if (this.mission !== "chapter") { this.finish(); return; }
    if (this.state.stage === 1) {
      this.state.status = "signal";
      this.story("The board is still green", "The Switchkeeper has fallen. The signal board at the end of the lane is still receiving.");
    } else if (this.state.wave === 0) {
      this.state.wave = 1;
      this.state.status = "interlude";
      this.waveReady = this.state.frame + 200;
      this.story("Footsteps in the service lane", "Your companion gives its quiet two-beat warning. Another group is approaching.");
    } else {
      this.state.status = "route";
      this.story("Relay access open", "Follow the blue door marker to the relay room.");
    }
  }

  private canAssist(entry: Entry) {
    const player = entry.player;
    return entry.connected && player.hp > 0 && !player.armed && player.y === 0 && !player.move && !player.stagger;
  }

  private canReachDowned(entry: Entry, target: Entry) {
    return target.connected && !target.player.hp && !target.rescued
      && rescueDistance(entry.player, target.player) <= RESCUE_RANGE;
  }

  private stepRescues() {
    for (const entry of this.players.values()) {
      const rescue = entry.rescue;
      if (!rescue) continue;
      const { target, start } = rescue;
      const moving = this.state.frame - entry.at <= 24 && (entry.input.x !== 0 || entry.input.z !== 0);
      if (!canRescueIn(this.state.status) || !this.canAssist(entry) || moving || entry.input.action
        || !this.players.has(target.player.id) || !this.canReachDowned(entry, target)) {
        entry.rescue = undefined;
        continue;
      }
      if (this.state.frame - start < RESCUE_TICKS) continue;
      Object.assign(target.player, { hp: RESCUE_HEALTH, y: 0, vy: 0, stagger: 0, armed: false });
      target.rescued = true;
      entry.rescue = undefined;
      this.events.push({ type: "revive", source: entry.player.id, target: target.player.id, x: target.player.x, z: target.player.z });
      if (this.mission === "bayrelay") {
        this.state.crewAssists.push(new CrewAssistState().assign({
          kind: "rescue", source: entry.player.name, target: target.player.name, station: "",
        }));
      }
    }
  }

  protected override interact(client: Client) {
    const entry = this.players.get(client.sessionId);
    if (!entry?.connected || !entry.player.hp || this.state.status === "lobby" || entry.rescue) return;
    if (canRescueIn(this.state.status) && this.canAssist(entry)) {
      let closest: Entry | undefined;
      for (const target of this.players.values()) {
        if (!this.canReachDowned(entry, target) || [...this.players.values()].some((other) => other.rescue?.target === target)) continue;
        if (!closest || rescueDistance(entry.player, target.player) < rescueDistance(entry.player, closest.player)) closest = target;
      }
      if (closest) {
        entry.rescue = { target: closest, start: this.state.frame };
        return;
      }
    }
    const point = nearestMarker(routeMarkers(this.mission, this.state.stage), entry.player.x, entry.player.z);
    if (!point) return;
    if (point.lore) { this.observe(entry, point); return; }
    if (point.id === "advance" && this.state.status === "route") {
      this.state.stage = 1;
      this.clearEnemies();
      [...this.players.values()].forEach((partyMember, index) => {
        partyMember.rescue = undefined;
        resetPlayer(partyMember.player, index);
      });
      this.spawn(chapterWaves[2]);
      this.story("The Switchkeeper", "Its hands still close around the route controls. Step out of its wind-up, then answer during recovery.");
    } else if (this.mission === "terminal" && this.state.status === "signal") {
      this.interactTerminal(entry, point);
    } else if (this.mission === "archive") {
      this.interactArchive(entry, point);
    } else if (this.mission === "viaduct") {
      this.interactViaduct(entry, point);
    } else if (this.mission === "lift") {
      this.interactLift(entry, point);
    } else if (this.mission === "pump" && this.state.status === "signal") {
      if (!this.hearSignal(entry, point, "Recall your partner with Q first.")) return;
      if (point.id === "pump-record") this.finish();
      else {
        this.state.stage = 2;
        this.state.readerUntil = this.state.frame + PUMP_TIMING.initial;
        this.spawn(pumpWaves[1]);
        this.story("Pressure rising", "The Switchkeeper is blocking the record. The pumps mark one floor lane before each discharge. Step across a painted boundary before it bursts.");
      }
    } else if (this.mission === "bellhouse") {
      this.interactBellhouse(entry, point);
    } else if (this.mission === "bayrelay") {
      this.interactBayRelay(entry, point);
    } else if (this.state.status === "signal" && (point.id === "signal" || point.id === "register"
      || this.mission === "exchange" || this.mission === "departure")) {
      this.interactSignal(entry, point);
    } else client.send("notice", "The passage opens when the lane is safe.");
  }

  private hearSignal(entry: Entry, point: Marker, armedNotice = "Recall your partner with Q and let it answer the reader.", note?: BellhouseNote) {
    const player = entry.player;
    if (player.armed || player.move?.kind === "arm" || player.move?.kind === "recall") {
      entry.client.send("notice", armedNotice);
      return false;
    }
    const mark = { source: player.id, x: point.x, z: point.z };
    if (note === undefined) this.broadcast("combat", { type: "observe", ...mark });
    else this.broadcast("bell", { note, ...mark } satisfies BellhouseCue);
    return true;
  }

  private interactTerminal(entry: Entry, point: Marker) {
    const { readerBit } = point;
    if (!readerBit) {
      if (this.state.readerMask !== TERMINAL_READERS_COMPLETE) {
        entry.client.send("notice", "The drawer needs both halves of the fare. Use the outbound and return readers.");
      } else if (this.hearSignal(entry, point)) this.finish();
      return;
    }
    if (this.state.readerMask & readerBit) {
      entry.client.send("notice", "This reader already has its half of the fare.");
      return;
    }
    if (!this.hearSignal(entry, point)) return;
    this.state.readerMask |= readerBit;
    if (this.state.readerMask === TERMINAL_READERS_COMPLETE) {
      this.spawn(terminalPatrol);
      this.story("Fare matched", "The drawer unlocks with a bell. A terminal patrol answers from both ends of the lane. Arm your partner and clear the patrol before reading the manifest.");
    } else {
      this.story(point.title, "Your partner's pulse registers one half of the fare. Bring a recalled partner to the other reader.");
    }
  }

  private interactBayRelay(entry: Entry, point: Marker) {
    const { readerBit } = point;
    if (!readerBit || (this.state.status !== "combat" && this.state.status !== "signal")) return;
    if (this.state.readerMask & readerBit) {
      entry.client.send("notice", "This call box has already checked in.");
      return;
    }
    if (!this.hearSignal(entry, point)) return;
    this.state.readerMask |= readerBit;
    if (this.state.status === "signal") {
      if (this.state.readerMask === BAY_RELAY_CALLS_COMPLETE) this.finish();
      else entry.client.send("notice", point.title + " recorded. Check the other call box.");
      return;
    }
    this.relayOpening = undefined;
    let saved: Entry | undefined;
    const enemyIds = new Set<string>();
    for (const enemy of this.enemies.values()) {
      if (!enemy.hp) continue;
      if (!saved && (enemy.phase === "windup" || (enemy.phase === "active" && !enemy.hit.has(enemy.target)))) {
        const target = this.players.get(enemy.target);
        if (target !== entry && target?.connected && target.player.hp > 0) saved = target;
      }
      enemyIds.add(enemy.id);
      enemy.ticks = enemy.phase === "hurt" ? Math.max(enemy.ticks, BAY_RELAY_STAGGER_TICKS) : BAY_RELAY_STAGGER_TICKS;
      enemy.phase = "hurt";
      enemy.target = "";
      this.broadcast("combat", { type: "interrupt", source: enemy.id, x: enemy.x, z: enemy.z } satisfies CombatEvent);
    }
    if (saved) {
      this.state.crewAssists.push(new CrewAssistState().assign({
        kind: "call", source: entry.player.name, target: saved.player.name, station: point.title,
      }));
    } else if (enemyIds.size && this.players.size > 1) {
      this.relayOpening = {
        callerId: entry.player.id, callerName: entry.player.name, station: point.title,
        enemyIds, lastFrame: this.state.frame + BAY_RELAY_STAGGER_TICKS,
      };
    }
    this.broadcast("notice", point.title + " recorded. The patrol is staggered.");
  }

  private creditRelayOpening() {
    const opening = this.relayOpening;
    if (!opening) return;
    if (this.state.status !== "combat" || this.state.frame > opening.lastFrame) {
      this.relayOpening = undefined;
      return;
    }
    for (const event of this.events) {
      if (event.type !== "hit" || event.source === opening.callerId || !event.target || !opening.enemyIds.has(event.target)) continue;
      const teammate = this.players.get(event.source);
      if (!teammate?.connected) continue;
      this.state.crewAssists.push(new CrewAssistState().assign({
        kind: "call", source: opening.callerName, target: teammate.player.name, station: opening.station,
      }));
      this.relayOpening = undefined;
      return;
    }
    if (this.state.frame === opening.lastFrame) this.relayOpening = undefined;
  }

  private interactSignal(entry: Entry, point: Marker) {
    if (this.mission !== "chapter" && !this.hearSignal(entry, point)) return;
    if (this.mission === "return" && this.state.wave === 0) {
      this.state.wave = 1;
      this.spawn(returnWaves[1]);
      this.story("Return track open", "The turnout throws. Your partner tastes a charge on the rail as a Switchkeeper comes up the open track. Arm again and keep the line clear.");
    } else if (point.id === "exchange-transfer") {
      this.state.stage = 1;
      this.spawn(exchangeWaves[1]);
      this.story("Transfer accepted", "Your partner sends the pump rhythm down the line. A Gateback is moving in from the gate. Stay close and watch for a Cable Runner hunting anyone who has recalled.");
    } else if (point.id === "departure-signal") {
      this.state.stage = 1;
      this.spawn(departureWaves[1]);
      this.story("Bay 4 signalled", "Your partner reaches the train's reader. The Switchkeeper is still holding the platform brake. Arm your partner and drive it clear.");
    } else this.finish();
  }

  private interactArchive(entry: Entry, point: Marker) {
    if (this.state.status === "signal") {
      if (!this.hearSignal(entry, point)) return;
      if (this.state.stage === 3) {
        this.finish();
        return;
      }
      this.clearEnemies();
      this.state.stage = 1;
      this.state.wave = 0;
      this.state.status = "route";
      this.waveReady = this.state.frame + ARCHIVE_CHANNEL_TICKS;
      this.story("Tidegate dispatch capsule", "Fare confirmed. The override is split between two channels. Use each reader while its lamp is lit, with your partner recalled. Each reading stays recorded when the lamps switch.");
      return;
    }
    const { readerBit } = point;
    if (this.state.status !== "route" || !readerBit) {
      entry.client.send("notice", "The archive opens when the lane is safe.");
      return;
    }
    if (this.state.readerMask & readerBit) {
      entry.client.send("notice", "This channel is already recorded. Use the other channel.");
      return;
    }
    if (readerBit !== (1 << this.state.wave)) {
      const live = this.state.wave === 0 ? "near" : "far";
      entry.client.send("notice", "This channel is quiet. The " + live + " channel is live. Wait for this lamp to light.");
      return;
    }
    if (!this.hearSignal(entry, point)) return;
    this.state.readerMask |= readerBit;
    if (this.state.readerMask === ARCHIVE_CHANNELS_COMPLETE) {
      this.state.stage = 2;
      this.waveReady = 0;
      this.spawn(archiveWaves[1]);
      this.story("Override accepted", "The recorder unlocks. A Switchkeeper is coming from the east while a crawler cuts in behind you. Arm your partner and defend the archive.");
    } else {
      this.broadcast("notice", point.title + " recorded.");
    }
  }

  private expireViaductRelay() {
    if (this.state.readerUntil === 0 || this.state.frame < this.state.readerUntil) return;
    this.state.readerMask = 0;
    this.state.readerUntil = 0;
    this.broadcast("notice", "Signal faded. Restart at West Relay.");
  }

  private interactViaduct(entry: Entry, point: Marker) {
    if (this.state.status !== "signal") return;
    if (point.id === "viaduct-ledger") {
      if (this.hearSignal(entry, point)) this.finish();
      return;
    }
    const { readerBit } = point;
    if (!readerBit) return;
    this.expireViaductRelay();
    if (point.id === "viaduct-west") {
      if (this.state.readerUntil > 0) {
        entry.client.send("notice", "West Relay is already live. Head east.");
        return;
      }
      if (!this.hearSignal(entry, point)) return;
      this.state.readerMask = readerBit;
      this.state.readerUntil = this.state.frame + VIADUCT_RELAY_TICKS;
      this.broadcast("notice", "West Relay sent. East Relay is live.");
      return;
    }
    if (this.state.readerUntil === 0) {
      entry.client.send("notice", "West Relay must open the signal first.");
      return;
    }
    if (!this.hearSignal(entry, point)) return;
    this.state.readerMask |= readerBit;
    this.state.readerUntil = 0;
    this.state.stage = 2;
    this.spawn(viaductWaves[1]);
    this.story("Relay bridged", "The old east feed is carrying current. A Gateback is coming from the far side while a Cable Runner flanks the west post. Arm your partner and keep the line open.");
  }

  private advanceLift() {
    if (!this.state.readerUntil || this.state.frame < this.state.readerUntil) return;
    const jammed = this.state.readerMask === LIFT_PHASE.lowering;
    this.state.readerMask = jammed ? LIFT_PHASE.jammed : LIFT_PHASE.docked;
    this.state.readerUntil = 0;
    this.broadcast("notice", jammed ? "Brake jammed. Recall and reset at the wheel." : "The lift is at the lower landing.");
  }

  private interactLift(entry: Entry, point: Marker) {
    const armedNotice = "Recall your partner with Q first.";
    if (this.state.status === "signal") {
      if (!this.hearSignal(entry, point, armedNotice)) return;
      if (point.id === "lift-log") {
        this.finish();
        return;
      }
      this.state.stage = 2;
      this.state.readerMask = LIFT_PHASE.lowering;
      this.state.readerUntil = this.state.frame + LIFT_LEG_TICKS;
      this.spawn(liftWaves[1]);
      this.story("Going down", "A Gateback and a Cable Runner are on the lift. When the brake catches, one courier can reset it with a recalled partner while the rest hold off the guard.");
      return;
    }
    if (this.state.status !== "combat" || this.state.stage !== 2) return;
    if (this.state.readerMask !== LIFT_PHASE.jammed) {
      entry.client.send("notice", this.state.readerMask === LIFT_PHASE.docked ? "The lift is already docked." : "The brake wheel is already turning.");
      return;
    }
    if (!this.hearSignal(entry, point, armedNotice)) return;
    this.state.readerMask = LIFT_PHASE.resuming;
    this.state.readerUntil = this.state.frame + LIFT_LEG_TICKS;
    this.broadcast("notice", "Brake released. The lift is moving again.");
  }

  private advancePump() {
    const { frame, readerMask, readerUntil, wave: laneIndex } = this.state;
    if (!readerUntil || frame < readerUntil) return;
    const lane = PUMP_LANES[laneIndex];
    if (readerMask === PUMP_PHASE.idle) {
      this.state.readerMask = PUMP_PHASE.warning;
      this.state.readerUntil = frame + PUMP_TIMING.warning;
      this.events.push({ type: "windup", source: "pump-discharge", x: 0, z: (lane.minZ + lane.maxZ) / 2 });
    } else if (readerMask === PUMP_PHASE.warning) {
      this.state.readerMask = PUMP_PHASE.burst;
      this.state.readerUntil = frame + PUMP_TIMING.burst;
      // The pressure wave hits on the first burst tick. The foam remains visible as it drains.
      for (const { connected, player } of this.players.values()) {
        const inside = player.z >= lane.minZ && (player.z < lane.maxZ || laneIndex === 2 && player.z === lane.maxZ);
        if (!connected || !player.hp || !inside || player.y >= .42 || isInvulnerable(player)) continue;
        hurtPlayer(player, frame, this.events, { source: "pump-discharge", damage: 18, heavy: true });
      }
    } else {
      this.state.readerMask = PUMP_PHASE.idle;
      this.state.readerUntil = frame + PUMP_TIMING.gap;
      this.state.wave = nextPressureLane[laneIndex];
    }
  }

  private interactBellhouse(entry: Entry, point: Marker) {
    if (this.state.status !== "signal" && this.state.status !== "combat") return;
    const armedNotice = "Recall your partner with Q first.";
    if (point.id === "bell-roster") {
      if (this.state.status === "signal" && this.hearSignal(entry, point, armedNotice)) this.finish();
      return;
    }
    const call = BELLHOUSE_CALLS.find(({ id }) => id === point.id);
    if (!call) return;
    if (this.state.readerMask & call.readerBit) {
      entry.client.send("notice", call.title + " has answered.");
      return;
    }
    if (!this.hearSignal(entry, point, armedNotice, call.note)) return;
    this.state.readerMask |= call.readerBit;
    if (this.state.stage === 1) {
      this.state.stage = 2;
      this.spawn(bellhouseWaves[1]);
      this.story("Guard approaching", "A Gateback and a Cable Runner heard the bell. You can answer the remaining calls while a crewmate holds the guard or once the hall is clear.");
    } else if (this.state.status === "signal" && this.state.readerMask === BELLHOUSE_CALLS_COMPLETE) {
      this.openBellhouseRoster();
    } else {
      this.broadcast("notice", call.title + " answered.");
    }
  }

  private openBellhouseRoster() {
    this.state.stage = 3;
    this.state.status = "signal";
    this.story("The signed roster", "The hall is clear and all three bells have answered. Ina and the other couriers have signed at the east desk. Bring your recalled partner to read the names and take a seal home.");
  }

  private finish() {
    const entries = [...this.players.values()];
    for (const entry of entries) entry.rescue = undefined;
    const profiles = store.reward(entries.map((entry) => entry.profileId), this.runId, this.mission, {
      trainingFamily: entries[0]?.player.family, practice: this.state.practice, watchCommended: this.watchCommended,
    });
    for (const entry of entries) {
      const profile = profiles.get(entry.profileId);
      if (profile) this.applyProfile(entry, profile);
    }
    this.state.status = "complete";
    this.broadcast("combat", { type: "clear", source: "", x: 0, z: 0 });
    const memory = JOBS[this.mission].clearLore;
    if (this.mission === "chapter") {
      this.story("Incoming train • Line closed", "The display changes to ARRIVING. Your partner gives the two-beat pulse you know, then shows you a memory of Brickback. You can explore that form in the plaza.");
    } else if (memory) {
      this.story(LORE[memory].title, LORE[memory].text);
    } else if (this.mission === "training") {
      this.story("Practice complete", this.state.practice ? "Return to the plaza when you’re ready." : "Mastery recorded in your partner’s journal. The follow-up becomes usable at battle rank 3.");
    } else if (this.mission === "watch") {
      this.story("The watch is over", this.watchCommended
        ? "Everyone stayed on their feet. The Signal Tag is available in your companion room."
        : "The terminal is safe. To earn the Signal Tag, complete both patrols without anyone going down.");
    } else if (this.mission === "bayrelay") {
      this.story("Both calls received", "Bay 4 is ready for the next shift. The Relay Pennant is available in your companion room.");
    } else this.story("Signal recovered", "A new form is recorded in your partner’s journal. Explore it at the plaza workbench.");
  }
}
