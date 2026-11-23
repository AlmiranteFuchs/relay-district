import type { CombatEvent } from "../../shared/src/combat.ts";
import type { Signal } from "../../shared/src/companion-play.ts";
import type { BellhouseNote } from "../../shared/src/scene.ts";
import { BELLHOUSE_CUES, loadAudioAssets } from "./audio-assets.ts";

interface MusicStem {
  source: AudioBufferSourceNode;
  fader: GainNode;
}

const bedLevel = .78;
const bellNotes = [0, 1, 2] as const;
const bellSpacing = .23;
const bellDuplicateWindow = .18;

export class GameAudio {
  enabled = false;
  private context?: AudioContext;
  private music?: GainNode;
  private effects?: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private beds = new Map<string, MusicStem>();
  private loading?: Promise<void>;
  private place = "plaza";
  private active = false;
  private playing = "";
  private combatMix = false;
  private downbeat = 0;
  private missionBeat = 0;
  private resumeBedAt = 0;
  private lastHit = 0;
  private bellStarts: [number[], number[], number[]] = [[], [], []];
  private bellVoices = new Set<AudioBufferSourceNode>();
  private lastBellReplay = -Infinity;

  async toggle() {
    if (this.enabled) {
      this.enabled = false;
      for (const voice of this.bellVoices) voice.stop();
      this.bellVoices.clear();
      this.bellStarts = [[], [], []];
      this.lastBellReplay = -Infinity;
      await this.context?.suspend();
      return;
    }
    this.context ??= new AudioContext();
    await this.context.resume();
    this.enabled = true;
    this.loading ??= this.load();
    try { await this.loading; }
    catch (error) { this.loading = undefined; this.enabled = false; await this.context.suspend(); throw error; }
    this.updateScore();
  }

  private async load() {
    const audio = this.context!;
    const { buffers, missionBeat } = await loadAudioAssets(async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Audio could not be loaded from ${path}.`);
      return audio.decodeAudioData(await response.arrayBuffer());
    });
    this.buffers = buffers;
    this.missionBeat = missionBeat;
    this.music = audio.createGain();
    this.music.gain.value = bedLevel;
    this.music.connect(audio.destination);
    this.effects = audio.createGain();
    this.effects.gain.value = .72;
    this.effects.connect(audio.destination);
  }

  mix(place: string, active: boolean) {
    if (place === this.place && active === this.active) return;
    this.place = place;
    this.active = active;
    this.updateScore();
  }

  private updateScore() {
    const audio = this.context;
    if (!audio || !this.music || !this.enabled) return;
    const now = audio.currentTime;
    const changedPlace = this.place !== this.playing;
    if (changedPlace) {
      for (const { source, fader } of this.beds.values()) {
        fader.gain.cancelScheduledValues(now);
        fader.gain.setTargetAtTime(0, now, .062);
        source.stop(now + .4);
      }
      this.beds.clear();
      this.playing = this.place;
      this.downbeat = now + .04;
      for (const name of this.place === "mission" ? ["lane", "fight"] : ["plaza"]) {
        const source = audio.createBufferSource();
        const fader = audio.createGain();
        source.buffer = this.buffers.get(name)!;
        source.loop = true;
        fader.gain.value = 0;
        source.connect(fader).connect(this.music);
        source.onended = () => { source.disconnect(); fader.disconnect(); };
        source.start(this.downbeat);
        this.beds.set(name, { source, fader });
      }
    } else if (this.combatMix === this.active) return;
    this.combatMix = this.active;
    const beat = Math.max(0, Math.ceil((now + .012 - this.downbeat) / this.missionBeat));
    const fadeAt = changedPlace ? this.downbeat : this.downbeat + beat * this.missionBeat;
    for (const [name, { fader }] of this.beds) {
      const level = name === "plaza" ? .88 : name === "lane" ? this.active ? .54 : .84 : this.active ? .86 : 0;
      fader.gain.cancelScheduledValues(now);
      fader.gain.setTargetAtTime(level, fadeAt, .092);
    }
  }

  private leaveRoomForCue(now: number, duration: number, gain: number) {
    const bed = this.music?.gain;
    if (!bed || this.resumeBedAt > now + duration) return;
    this.resumeBedAt = now + duration;
    bed.cancelScheduledValues(now);
    bed.setTargetAtTime(gain, now, .023);
    bed.setTargetAtTime(bedLevel, this.resumeBedAt, .21);
  }

  signal(kind: Signal) {
    if (this.enabled && this.context) this.leaveRoomForCue(this.context.currentTime, .48, .54);
    this.sound("observe", kind === "short" ? 1.32 : .78);
  }

  bellhouse(note?: BellhouseNote) {
    const audio = this.context;
    if (!audio || !this.enabled || !this.effects) return;
    const now = audio.currentTime;
    if (note === undefined && now - this.lastBellReplay < bellSpacing * bellNotes.length) return;
    let played = false;
    for (const [position, bell] of (note === undefined ? bellNotes : [note]).entries()) {
      const clip = this.buffers.get(BELLHOUSE_CUES[bell]);
      if (!clip) continue;
      const when = now + position * bellSpacing;
      const recent = this.bellStarts[bell] = this.bellStarts[bell].filter((at) => at >= now - bellDuplicateWindow);
      if (recent.some((at) => Math.abs(at - when) < bellDuplicateWindow)) continue;
      recent.push(when);
      const voice = this.playEffect(clip, .64, when);
      this.bellVoices.add(voice);
      voice.onended = () => { this.bellVoices.delete(voice); };
      played = true;
    }
    if (!played) return;
    if (note === undefined) this.lastBellReplay = now;
    this.leaveRoomForCue(now, note === undefined ? .92 : .32, .54);
  }

  sound(type: CombatEvent["type"] | "departure", rate = 1) {
    const audio = this.context;
    const clip = this.buffers.get(type === "revive" ? "observe" : type);
    if (!audio || !this.enabled || !clip || !this.effects) return;
    if (type === "hit") {
      if (audio.currentTime - this.lastHit < .055) return;
      this.lastHit = audio.currentTime;
    }
    if (type === "windup") this.leaveRoomForCue(audio.currentTime, .26, .54);
    if (type === "clear") this.leaveRoomForCue(audio.currentTime, 1.05, .42);
    if (type === "departure") this.leaveRoomForCue(audio.currentTime, .86, .52);
    this.playEffect(clip, type === "windup" ? .67 : type === "hit" ? .55 : .47, audio.currentTime, rate);
  }

  private playEffect(clip: AudioBuffer, level: number, when: number, rate = 1) {
    const source = this.context!.createBufferSource();
    const channel = this.context!.createGain();
    source.buffer = clip;
    source.playbackRate.value = rate;
    channel.gain.value = level;
    source.connect(channel).connect(this.effects!);
    source.addEventListener("ended", () => { source.disconnect(); channel.disconnect(); }, { once: true });
    source.start(when);
    return source;
  }
}
