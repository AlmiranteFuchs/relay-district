import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { JOBS, MORPH_CLEARS, ROOM_THEMES, TRINKETS, isFamily, type Family, type Lore, type Mission, type Profile } from "../../shared/src/content.ts";

interface Row { id: string; profile: string; cared_at: number }
export interface Session { id: string; profile: Profile }
export interface MorphResult { ok: boolean; notice: string; profile: Profile }

function hash(token: string) { return createHash("sha256").update(token).digest("hex"); }

function clean(value: string, max: number) {
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
}

function addMemory(profile: Profile, lore: Lore) {
  if (profile.lore.includes(lore)) return false;
  profile.lore.push(lore);
  profile.bond = Math.min(100, profile.bond + 2);
  return true;
}

export function newProfile(name: string): Profile {
  return {
    name: clean(name, 20) || "Courier", companion: "Neri", family: "moth",
    battleXp: 0, bond: 0, catalyst: false, discovered: ["moth"], history: ["moth"],
    mastery: [], lore: [], clears: [], catalystProgress: [], trinket: TRINKETS[0],
    roomTheme: ROOM_THEMES[0],
  };
}

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, profile TEXT NOT NULL,
        cared_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS rewards (
        profile_id TEXT NOT NULL REFERENCES profiles(id), reward_id TEXT NOT NULL,
        PRIMARY KEY (profile_id, reward_id)
      );
    `);
  }

  close() { this.db.close(); }

  create(name: string) {
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const profile = newProfile(name);
    this.db.prepare("INSERT INTO profiles (id, token_hash, profile) VALUES (?, ?, ?)")
      .run(id, hash(token), JSON.stringify(profile));
    return { token, id, profile };
  }

  session(token: unknown): Session | null {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = this.db.prepare("SELECT id, profile FROM profiles WHERE token_hash = ?").get(hash(token)) as Row | undefined;
    return row ? { id: row.id, profile: JSON.parse(row.profile) as Profile } : null;
  }

  profile(id: string): Profile {
    const row = this.db.prepare("SELECT profile FROM profiles WHERE id = ?").get(id) as Row | undefined;
    if (!row) throw new Error("Profile missing");
    return JSON.parse(row.profile) as Profile;
  }

  private save(id: string, profile: Profile) {
    this.db.prepare("UPDATE profiles SET profile = ? WHERE id = ?").run(JSON.stringify(profile), id);
    return profile;
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  morph(id: string, target: Family, expectedFamily: Family): MorphResult {
    return this.transaction(() => {
      const profile = this.profile(id);
      const failed = (notice: string) => ({ ok: false, notice, profile });
      if (profile.family !== expectedFamily) return failed("The family changed. Preview the morph again.");
      if (target === profile.family) return failed("Your partner already has this form.");
      if (!profile.discovered.includes(target)) return failed("Discover this form in its mission first.");
      if (!profile.catalyst) return failed("A catalyst is required to morph.");
      profile.family = target;
      profile.battleXp = 0;
      profile.catalyst = false;
      profile.catalystProgress = [];
      profile.history.push(target);
      this.save(id, profile);
      return { ok: true, notice: "Morph complete. Battle training begins again.", profile };
    });
  }

  customize(id: string, update: Record<string, unknown>, now = Date.now()) {
    return this.transaction(() => {
      const profile = this.profile(id);
      if (typeof update.companion === "string") profile.companion = clean(update.companion, 20) || profile.companion;
      if (typeof update.trinket === "string" && TRINKETS.includes(update.trinket)) profile.trinket = update.trinket;
      if (typeof update.roomTheme === "string" && ROOM_THEMES.includes(update.roomTheme)) profile.roomTheme = update.roomTheme;
      const row = this.db.prepare("SELECT cared_at FROM profiles WHERE id = ?").get(id) as Pick<Row, "cared_at">;
      if (update.play === true && now - row.cared_at > 10000) {
        profile.bond = Math.min(100, profile.bond + 1);
        this.db.prepare("UPDATE profiles SET cared_at = ? WHERE id = ?").run(now, id);
      }
      return this.save(id, profile);
    });
  }

  discoverLore(id: string, lore: Lore) {
    const profile = this.profile(id);
    if (addMemory(profile, lore)) this.save(id, profile);
    return profile;
  }

  reward(ids: string[], runId: string, mission: Mission, trainingFamily?: Family, practice = false) {
    return this.transaction(() => {
      const result = new Map<string, Profile>();
      for (const id of new Set(ids)) {
        const profile = this.profile(id);
        result.set(id, profile);
        if (practice) continue;
        const granted = this.db.prepare("INSERT OR IGNORE INTO rewards VALUES (?, ?)").run(id, "clear:" + runId);
        if (!granted.changes) continue;
        if (mission === "training") {
          if (!isFamily(trainingFamily) || trainingFamily !== profile.family) continue;
          const drill = this.db.prepare("INSERT OR IGNORE INTO rewards VALUES (?, ?)").run(id, "mastery:" + trainingFamily);
          if (drill.changes) {
            profile.mastery.push(trainingFamily);
            profile.battleXp += 34;
          }
          this.save(id, profile);
          continue;
        }
        const first = !profile.clears.includes(mission);
        if (first) {
          profile.clears.push(mission);
          profile.bond = Math.min(100, profile.bond + 4);
        }
        profile.battleXp += mission === "chapter" ? 64 : 48;
        const { reward: discovery, clearLore } = JOBS[mission];
        if (discovery && !profile.discovered.includes(discovery)) profile.discovered.push(discovery);
        if (clearLore) addMemory(profile, clearLore);
        if (!profile.catalyst) {
          if (!profile.catalystProgress.includes(mission)) profile.catalystProgress.push(mission);
          if ((first && mission === "chapter") || profile.catalystProgress.length >= MORPH_CLEARS) {
            profile.catalyst = true;
            profile.catalystProgress = [];
          }
        }
        this.save(id, profile);
      }
      return result;
    });
  }
}
