import type { CombatEvent } from "../../shared/src/combat.ts";

export class GameAudio {
  enabled = false;
  private context?: AudioContext;
  private gain?: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private beds = new Map<string, GainNode>();
  private loading?: Promise<void>;
  private place = "plaza";
  private active = false;
  private lastHit = 0;

  async toggle() {
    if (this.enabled) {
      this.enabled = false;
      await this.context?.suspend();
      return;
    }
    this.context ??= new AudioContext();
    await this.context.resume();
    this.enabled = true;
    this.loading ??= this.load();
    try { await this.loading; }
    catch (error) { this.loading = undefined; this.enabled = false; await this.context.suspend(); throw error; }
    this.mix(this.place, this.active);
  }

  private async load() {
    const audio = this.context!;
    const names = ["plaza", "lane", "fight", "arm", "hit", "swing", "windup", "dodge", "observe", "clear"];
    await Promise.all(names.map(async (name) => {
      const response = await fetch("/audio/" + name + ".wav");
      if (!response.ok) throw new Error("Audio could not be loaded.");
      this.buffers.set(name, await audio.decodeAudioData(await response.arrayBuffer()));
    }));
    this.gain = audio.createGain();
    this.gain.gain.value = .65;
    this.gain.connect(audio.destination);
    const start = audio.currentTime + .05;
    for (const name of ["plaza", "lane", "fight"]) {
      const source = audio.createBufferSource();
      const stem = audio.createGain();
      stem.gain.value = 0;
      source.buffer = this.buffers.get(name)!;
      source.loop = true;
      source.connect(stem).connect(this.gain);
      source.start(start);
      this.beds.set(name, stem);
    }
  }

  mix(place: string, active: boolean) {
    if (this.beds.size && place === this.place && active === this.active) {
      const plaza = this.beds.get("plaza")!;
      if (plaza.gain.value > 0.01 || this.beds.get("lane")!.gain.value > .01) return;
    }
    this.place = place;
    this.active = active;
    if (!this.context) return;
    for (const [name, stem] of this.beds) {
      const value = name === "plaza" ? (place === "plaza" ? .66 : 0)
        : name === "lane" ? (place === "mission" ? .61 : 0) : (place === "mission" && active ? .65 : 0);
      stem.gain.setTargetAtTime(value, this.context.currentTime, .21);
    }
  }

  sound(type: CombatEvent["type"]) {
    const audio = this.context;
    const clip = this.buffers.get(type);
    if (!audio || !this.enabled || !clip || !this.gain) return;
    if (type === "hit") {
      if (audio.currentTime - this.lastHit < .055) return;
      this.lastHit = audio.currentTime;
    }
    const source = audio.createBufferSource();
    const channel = audio.createGain();
    source.buffer = clip; channel.gain.value = type === "windup" ? .67 : type === "hit" ? .55 : .47;
    source.connect(channel).connect(this.gain);
    source.start();
  }
}
