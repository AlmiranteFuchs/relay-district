import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

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
    if (style === "pad") return .5 * (Math.sin(p) + .3 * Math.sin(p * 1.006) + .22 * Math.sin(p * 2)) * Math.sin(t / duration * Math.PI);
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

const beat = 60 / 128;
const plaza = buffer(32 * beat), lane = buffer(32 * beat), fight = buffer(32 * beat);
const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [50, 57, 60, 65], [55, 59, 62, 67]];
const theme = [[0, 69], [1.5, 72], [2, 76], [3, 74], [4, 72], [5.5, 67], [6, 69]];
for (let bar = 0; bar < 8; bar++) {
  const notes = chords[bar >> 1], start = bar * 4 * beat;
  for (const note of notes) {
    tone(plaza, start, beat * 3.96, note, .038, "pad");
    tone(lane, start, beat * 3.96, note - 12, .031, "pad");
  }
  for (let step = 0; step < 8; step++) {
    const at = start + step * beat / 2;
    if (step % 2 === 0) {
      drum(plaza, at, "kick", .09);
      drum(fight, at, "kick", .27);
      tone(fight, at + .05, beat * .83, notes[step === 6 ? 2 : 0] - 24, .10, "bass");
    } else {
      drum(plaza, at, "hat", .043);
      drum(fight, at, "hat", .079);
      if (step === 3 || step === 7) tone(lane, at, beat * .76, notes[0] - 12, .08, "bass");
    }
    if (step === 2 || step === 6) drum(fight, at, "snare", .15);
  }
}
for (const start of [0, 8, 16, 24]) for (const [at, note] of theme) {
  tone(plaza, (start + at) * beat, .48, note, .106);
  tone(fight, (start + at) * beat, .27, note - 12, .083);
  if (at === 0 || at === 2 || at === 6) tone(lane, (start + at) * beat, .63, note - 12, .052);
}
save("plaza", plaza); save("lane", lane); save("fight", fight);
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
clip("clear", 1.8, (sound) => [69, 72, 76, 81].forEach((note, i) => tone(sound, i * .13, 1.1, note, .17)));
