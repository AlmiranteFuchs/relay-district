import { randomBytes, randomUUID } from "node:crypto";
import { Room, ServerError, type AuthContext, type Client } from "@colyseus/core";
import {
  battleRank, isFamily, isMission, LORE, PATCH_MS, TICK_RATE, type Action, type Family, type Mission, type Profile,
} from "../../shared/src/content.ts";
import { makeEnemy, makePlayer, resetPlayer, sanitizeAxes, stepEnemy, stepPlayer, type CombatEvent, type Enemy,
  type EnemyKind, type Input, type Player } from "../../shared/src/combat.ts";
import { nearestMarker, PLAZA, routeMarkers, type Marker } from "../../shared/src/scene.ts";
import { ActorState, GameState } from "./wire.ts";
import type { Session, Store } from "./store.ts";

let store: Store;
const codes = new Map<string, string>();
const profileRooms = new Map<string, Set<GameRoom>>();
const actions = new Set<Action>(["attack", "skill", "mastery", "morph", "dodge", "jump"]);
export function configureRooms(db: Store) { store = db; }
export function roomByCode(code: string) { return codes.get(code.toUpperCase()); }

interface Entry {
  profileId: string;
  player: Player;
  client: Client;
  connected: boolean;
  input: Input;
  at: number;
  ack: number;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? input as Record<string, unknown> : {};
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
    });
  }

  protected syncEnemy(enemy: Enemy) {
    const view = this.state.actors.get(enemy.id)!;
    Object.assign(view, { x: enemy.x, y: enemy.y, z: enemy.z, facing: enemy.facing, hp: enemy.hp,
      maxHp: enemy.maxHp, phase: enemy.phase, age: enemy.ticks, moving: enemy.phase === "advance",
      kind: enemy.kind, name: ({ keeper: "Switchkeeper", guard: "Gateback", skitter: "Signal Crawler", dummy: "Practice target" })[enemy.kind] });
  }

  protected step() {
    this.state.frame++;
    this.events.length = 0;
    const safe = this.state.status !== "combat" || ![...this.enemies.values()].some((enemy) => enemy.hp && enemy.kind !== "dummy");
    const frozen = this.state.status === "failed" || this.state.status === "complete";
    for (const entry of this.players.values()) {
      if (!frozen && entry.connected) {
        const input = this.state.frame - entry.at > 24 ? { x: 0, z: 0 } : entry.input;
        stepPlayer(entry.player, input, entry.input.action, this.state.frame, this.enemies.values(), this.events, safe);
        entry.ack = entry.input.seq;
      }
      entry.input.action = undefined;
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
    for (const entry of this.players.values()) this.syncPlayer(entry);
    for (const enemy of this.enemies.values()) this.syncEnemy(enemy);
    this.afterStep();
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

  onCreate() {
    this.install();
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

export class MissionRoom extends GameRoom {
  maxClients = 4;
  private mission: Mission = "chapter";
  private previewFamily?: Family;
  private runId = "";
  private waveReady = 0;
  private serial = 0;

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
    if (this.mission !== "training" && this.mission !== "chapter" && !auth.profile.clears.includes("chapter")) {
      throw new ServerError(403, "Clear The Last Crossing to access district challenges.");
    }
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
    this.runId = randomUUID();
    this.state.stage = 0;
    this.state.wave = 0;
    this.state.status = this.mission === "chapter" ? "approach" : "combat";
    this.waveReady = 0;
    this.clearEnemies();
    this.actors().forEach((player, index) => resetPlayer(player, index));
    if (this.mission === "chapter") {
      this.story("The Last Crossing", "A fare token dated 1999. The gate still recognizes it. Read the service desk if you want to know what happened here, then head down the lane.");
    } else if (this.mission === "training") {
      this.spawn(wave(["dummy", 0, 0]));
      const target = [...this.enemies.values()][0];
      target.hp = target.maxHp = 132;
      this.story(this.state.practice ? "Form preview" : "Mastery drill",
        this.state.practice ? "Try the discovered form. Your current family and battle XP remain safe at the plaza." : "Arm your partner and break the practice target to record this family's mastery drill.");
    } else {
      this.spawn(challengeWaves[this.mission]);
      this.story(this.mission === "platform" ? "Platform Sweep" : "Transformer Trial",
        "Keep your partner close. The signal resolves when the lane is clear.");
    }
  }

  private clearEnemies() {
    for (const id of this.enemies.keys()) this.state.actors.delete(id);
    this.enemies.clear();
  }

  private spawn(entries: Spawn[]) {
    this.clearEnemies();
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
    if (this.state.status === "approach" && this.actors().some((player) => player.x > -2.35)) {
      this.spawn(chapterWaves[0]);
      return;
    }
    if (this.state.status === "interlude" && this.waveReady && this.state.frame >= this.waveReady) {
      this.waveReady = 0;
      this.spawn(chapterWaves[1]);
      return;
    }
    if (this.state.status !== "combat") return;
    if ([...this.players.values()].length && this.actors().every((player) => player.hp === 0)) {
      this.state.status = "failed";
      this.story("Signal lost", "The party is down. Retry from the service entry.");
      return;
    }
    if (!this.enemies.size || [...this.enemies.values()].some((enemy) => enemy.hp > 0)) return;
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

  protected override interact(client: Client) {
    const entry = this.players.get(client.sessionId);
    if (!entry?.player.hp || this.state.status === "lobby") return;
    const point = nearestMarker(routeMarkers(this.mission, this.state.stage), entry.player.x, entry.player.z);
    if (!point) return;
    if (point.lore) { this.observe(entry, point); return; }
    if (point.id === "advance" && this.state.status === "route") {
      this.state.stage = 1;
      this.clearEnemies();
      this.actors().forEach((player, index) => resetPlayer(player, index));
      this.spawn(chapterWaves[2]);
      this.story("The Switchkeeper", "Its hands still close around the route controls. Step out of its wind-up, then answer during recovery.");
    } else if (point.id === "signal" && this.state.status === "signal") {
      this.finish();
    } else client.send("notice", "The passage opens when the lane is safe.");
  }

  private finish() {
    const entries = [...this.players.values()];
    const profiles = store.reward(entries.map((entry) => entry.profileId), this.runId, this.mission, entries[0]?.player.family, this.state.practice);
    for (const entry of entries) {
      const profile = profiles.get(entry.profileId);
      if (profile) this.applyProfile(entry, profile);
    }
    this.state.status = "complete";
    this.broadcast("combat", { type: "clear", source: "", x: 0, z: 0 });
    if (this.mission === "chapter") {
      this.story("Incoming train • Line closed", "The display changes to ARRIVING. Your partner gives the two-beat pulse you know, then shows you a memory of Brickback. You can explore that form in the plaza.");
    } else if (this.mission === "training") {
      this.story("Practice complete", this.state.practice ? "Return to the plaza when you’re ready." : "Mastery recorded in your partner’s journal. The follow-up becomes usable at battle rank 3.");
    } else this.story("Signal recovered", "A new form is recorded in your partner’s journal. Explore it at the plaza workbench.");
  }
}
