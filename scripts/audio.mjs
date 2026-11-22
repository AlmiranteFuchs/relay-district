import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { renderScore } from "./score.mjs";

const out = fileURLToPath(new URL("../packages/web/public/audio", import.meta.url));
mkdirSync(out, { recursive: true });
const sampleRate = 22050;
const tau = Math.PI * 2;
const freq = (note) => 440 * 2 ** ((note - 69) / 12);

function buffer(seconds) {
  return new Float32Array(Math.round(sampleRate * seconds));
}
function voice(target, start, duration, gain, source) {
  const first = Math.round(start * sampleRate);
  const count = Math.round(duration * sampleRate);
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const value = source(t) * Math.min(1, t / .008, (duration - t) / .035) * gain;
    target[(i + first) % target.length] += value;
  }
}
function tone(target, start, duration, note, gain, style = "key") {
  const f = freq(note);
  voice(target, start, duration, gain, (t) => {
    const p = tau * f * t;
    if (style === "bass") return (Math.sin(p) + .3 * Math.sin(2 * p) + .15 * Math.sin(3 * p)) * Math.exp(-t * 3);
    return (Math.sin(p) + .28 * Math.sin(p * 2.002) + .14 * Math.sin(p * 3.006)) * Math.exp(-t * 5);
  });
}
function drum(target, start, kind, gain) {
  let seed = Math.round(start * sampleRate) + 57;
  const length = kind === "kick" ? .23 : kind === "snare" ? .18 : .065;
  voice(target, start, length, gain, (t) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    if (kind === "kick") return Math.sin(tau * (52 * t + 2.8 * (1 - Math.exp(-35 * t)))) * Math.exp(-t * 20);
    if (kind === "snare") return (noise * .7 + .3 * Math.sin(tau * 172 * t)) * Math.exp(-t * 24);
    return (noise * (Math.sin(tau * 6221 * t) > 0 ? 1 : -.5)) * Math.exp(-t * 49);
  });
}
function save(name, samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples.length * 2, 40);
  for (let n = 0; n < samples.length; n++) bytes.writeInt16LE(Math.round(Math.max(-.94, Math.min(.94, samples[n])) * 32767), 44 + n * 2);
  writeFileSync(join(out, name + ".wav"), bytes);
}

renderScore(out);
const clip = (name, duration, author) => { const sound = buffer(duration); author(sound); save(name, sound); };
clip("arm", .64, (sound) => { tone(sound, 0, .22, 64, .24); tone(sound, .15, .4, 76, .21); drum(sound, .31, "snare", .048); });
clip("hit", .26, (sound) => { drum(sound, 0, "kick", .75); drum(sound, .021, "snare", .46); });
clip("swing", .26, (sound) => {
  voice(sound, 0, .24, .35, (t) => Math.sin(tau * (580 * t - 810 * t * t)) * Math.exp(-t * 10));
  drum(sound, .06, "hat", .27);
});
clip("windup", .56, (sound) => { tone(sound, 0, .25, 47, .29, "bass"); tone(sound, .16, .34, 68, .25, "bass"); });
clip("dodge", .25, (sound) => { drum(sound, 0, "hat", .25); tone(sound, .044, .15, 45, .14, "bass"); });
clip("observe", .65, (sound) => { tone(sound, 0, .32, 72, .23); tone(sound, .2, .37, 76, .16); });
