import { writeFileSync } from "node:fs";
import { join } from "node:path";

// The note tables and patch settings are the editable score. All voices and
// drum hits are synthesized here, including the samples reused in the break.
const rate = 32000;
const TAU = Math.PI * 2;
const hz = (note) => 440 * 2 ** ((note - 69) / 12);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const envelope = (age, length, attack, release) => clamp(Math.min(age / attack, (length - age) / release));

class Cue {
  constructor(bpm, bars) {
    this.beat = 60 / bpm;
    this.left = new Float32Array(Math.round(this.beat * bars * 4 * rate));
    this.right = new Float32Array(this.left.length);
  }

  write(at, length, pan, gain, render) {
    const start = Math.round(at * rate);
    const lc = gain * Math.cos((pan + 1) * Math.PI / 4);
    const rc = gain * Math.sin((pan + 1) * Math.PI / 4);
    const count = Math.round(length * rate);
    for (let n = 0; n < count; n++) {
      const frame = (start + n + this.left.length) % this.left.length;
      const signal = render(n / rate, n);
      this.left[frame] += signal * lc;
      this.right[frame] += signal * rc;
    }
  }

  note(instrument, at, length, pitch, gain, pan = 0, echo = false) {
    const duration = length * this.beat;
    const tone = patch(instrument, hz(pitch), duration);
    this.write(at * this.beat, duration, pan, gain, tone);
    if (echo) {
      this.write((at + .75) * this.beat, duration, -pan * .84, gain * .22, tone);
      this.write((at + 1.5) * this.beat, duration, pan * .92, gain * .105, tone);
    }
  }

  hit(name, at, gain, pan = 0, pitch = 1) {
    const data = kit[name];
    this.write(at * this.beat, data.length / (rate * pitch), pan, gain, (_time, frame) => {
      const point = frame * pitch;
      const index = Math.floor(point);
      const first = data[index] ?? 0;
      return first + ((data[index + 1] ?? 0) - first) * (point - index);
    });
  }

  save(out, file, gain) {
    const bytes = Buffer.alloc(44 + this.left.length * 4);
    bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 4, 28);
    bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36); bytes.writeUInt32LE(this.left.length * 4, 40);
    for (let i = 0; i < this.left.length; i++) {
      bytes.writeInt16LE(Math.round(Math.tanh(this.left[i] * gain) * 32767), 44 + i * 4);
      bytes.writeInt16LE(Math.round(Math.tanh(this.right[i] * gain) * 32767), 46 + i * 4);
    }
    writeFileSync(join(out, file + ".wav"), bytes);
  }
}

function patch(kind, f, length) {
  const omega = TAU * f;
  if (kind === "keys") {
    return (t) => {
      const phase = omega * t;
      const tine = Math.sin(phase + Math.sin(phase * 2.002) * (.21 + .83 * Math.exp(-9 * t)));
      return envelope(t, length, .005, .106) * Math.exp(-1.44 * t)
        * (.63 * tine + .29 * Math.sin(phase * .9985) + .08 * Math.sin(phase * 4.012) * Math.exp(-15 * t));
    };
  }
  if (kind === "pad") {
    return (t) => {
      const phase = omega * t;
      const shimmer = Math.sin(TAU * .63 * t);
      const chord = (.51 * Math.sin(phase + .14 * Math.sin(phase * 2.001))
        + .28 * Math.sin(phase * 1.0038 + shimmer * .12) + .23 * Math.sin(phase * .9965) + .12 * Math.sin(phase * 2));
      return chord * envelope(t, length, .28, .39) * (.87 + .13 * shimmer);
    };
  }
  if (kind === "rubber" || kind === "sub") {
    return (t) => {
      const phase = omega * t;
      const body = .72 * Math.sin(phase) + .2 * Math.sin(phase * 2 + .6);
      const bite = Math.sin(phase + Math.sin(phase * 2) * (.34 + 1.48 * Math.exp(-13 * t)));
      return envelope(t, length, .009, .063) * (kind === "sub" ? .91 * body + .22 * bite : .63 * body + .56 * bite)
        * (.66 + .34 * Math.exp(-5.2 * t));
    };
  }
  if (kind === "lead") {
    return (t) => {
      const bend = .018 * Math.exp(-36 * t) + .0014 * Math.sin(TAU * 5.1 * t);
      const phase = omega * t * (1 - bend);
      return envelope(t, length, .016, .093) * Math.exp(-1.65 * t)
        * (.56 * Math.sin(phase + .45 * Math.sin(phase * 2.01)) + .25 * Math.sin(phase * .998) + .12 * Math.sin(phase * 3));
    };
  }
  return (t) => {
    const phase = omega * t;
    return envelope(t, length, .004, .085) * Math.exp(-4.1 * t)
      * (.58 * Math.sin(phase + .58 * Math.sin(phase * 3.005) * Math.exp(-7 * t)) + .19 * Math.sin(1.499 * phase));
  };
}

function drum(length, seed, synthesis) {
  let low = 0, bright = 0;
  return Float32Array.from({ length: Math.round(length * rate) }, (_, n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    low += (noise - low) * .065;
    const high = noise - low;
    bright += (high - bright) * .36;
    const t = n / rate;
    return synthesis(t, low, bright, high - bright) * envelope(t, length, .0011, .018);
  });
}

const kit = {
  kick: drum(.28, 337, (t, _low, mid, high) => {
    const pitch = TAU * (49 * t + 2.15 * (1 - Math.exp(-44 * t)));
    const body = Math.sin(pitch) * Math.exp(-12.9 * t);
    return Math.tanh(1.18 * body + .26 * mid * Math.exp(-105 * t) + .12 * high * Math.exp(-270 * t)) * 1.16;
  }),
  snare: drum(.31, 4817, (t, low, mid, high) => {
    const skin = (.56 * Math.sin(TAU * (183 * t + 1.18 * (1 - Math.exp(-60 * t))))
      + .19 * Math.sin(TAU * 326 * t) + .13 * Math.sin(TAU * 482 * t)) * Math.exp(-24 * t);
    const wires = (.55 * mid + .7 * high - .12 * low) * (Math.exp(-13 * t) + .34 * Math.exp(-72 * t));
    const room = t > .018 ? .11 * mid * Math.exp(-18 * (t - .018)) : 0;
    return Math.tanh((skin + wires + room) * 1.22);
  }),
  rim: drum(.15, 522, (t, _low, mid, high) => (.39 * Math.sin(TAU * 721 * t) + .25 * Math.sin(TAU * 1537 * t)
    + .32 * mid + .19 * high) * Math.exp(-43 * t)),
  tight: drum(.104, 221, (t, _low, mid, high) => (.32 * mid + .7 * high + .095 * Math.sin(TAU * 4709 * t)
    + .067 * Math.sin(TAU * 6847 * t)) * Math.exp(-41 * t)),
  open: drum(.32, 479, (t, _low, mid, high) => (.3 * mid + .72 * high + .096 * Math.sin(TAU * 3947 * t)
    + .063 * Math.sin(TAU * 6101 * t) + .053 * Math.sin(TAU * 8219 * t)) * Math.exp(-13.5 * t)),
};

function pattern(cue, start, instrument, steps, gain, swing, pan = 0) {
  for (let i = 0; i < steps.length; i++) {
    const [step, velocity] = steps[i];
    const drift = ((i * 7 + Math.round(start) * 13) % 9 - 4) * .0018;
    const offbeat = step % 2 ? swing : 0;
    const at = start + (step + offbeat) / 4 + drift;
    cue.hit(instrument, at, gain * velocity, pan + drift * 4, 1 + drift * 4);
    if (instrument === "snare" && velocity > .4) {
      cue.hit("snare", at + .014 / cue.beat, gain * velocity * .13, -.56, .947);
      cue.hit("snare", at + .027 / cue.beat, gain * velocity * .09, .62, .93);
    }
  }
}

const plazaChanges = [
  [38, [54, 57, 61, 64]], [35, [54, 57, 61, 62]], [43, [54, 57, 59, 62]], [45, [55, 57, 59, 64]],
  [40, [55, 59, 62, 66]], [42, [54, 57, 61, 64]], [43, [54, 59, 62, 66]], [45, [55, 59, 62, 66]],
];
const plazaHook = [
  [[.25, 66, .65], [1.35, 69, .43], [2.55, 76, .88], [3.62, 73, .37]],
  [[.4, 71, .7], [1.37, 69, .42], [2.09, 66, 1.02]],
  [[.75, 66, .54], [1.5, 69, .54], [2.52, 74, .63], [3.35, 76, .47]],
  [[.31, 73, .44], [1.12, 71, .56], [2.8, 69, .8]],
];

function writePlaza(out) {
  const plaza = new Cue(112, 24);
  for (let bar = 0; bar < 24; bar++) {
    const start = bar * 4;
    const bridge = bar >= 12 && bar < 20;
    const [bass, chord] = plazaChanges[(bridge ? 4 : 0) + bar % 4];
    const keys = bar % 2 ? [[.18, 1.65], [2.72, 1.42]] : [[0, 1.42], [1.76, .64], [3.19, .92]];
    for (const [offset, length] of keys) for (const [i, pitch] of chord.entries()) {
      plaza.note("keys", start + offset + i * .013, length + (3 - i) * .08, pitch, .081 - i * .007, (i - 1.5) * .22);
    }
    for (const [i, pitch] of chord.entries()) plaza.note("pad", start - .21 + i * .03, 4.38, pitch, bridge ? .061 : .036, (i - 1.5) * .41);
    const line = bar % 4 === 3 ? [[0, 0, .87], [1.18, 7, .31], [1.87, 10, .37], [2.47, 12, .31], [3.22, 7, .43], [3.76, -2, .21]]
      : [[0, 0, .91], [1.47, 12, .25], [1.83, 7, .47], [2.74, 0, .69], [3.63, 12, .23]];
    for (const [at, interval, length] of line) plaza.note("rubber", start + at, length, bass + interval, .185);
    pattern(plaza, start, "kick", [[0, 1], [7, .57], [10, .83], ...(bar % 2 ? [[14, .51]] : [])], .265, .1);
    pattern(plaza, start, "rim", [[4, .9], [12, .94], [15, .24]], .181, .16, -.22);
    pattern(plaza, start, "tight", [[1, .22], [2, .89], [5, .38], [6, .66], [9, .31], [10, .77], [13, .34], [14, .59]], .165, .16, .32);
    if (bar % 4 === 3) pattern(plaza, start, "open", [[10, .78], [14, .62]], .123, .12, -.39);
    if ((bar >= 4 && bar < 12) || bar >= 20) {
      for (const [at, pitch, length] of plazaHook[bar % 4]) plaza.note("lead", start + at, length, pitch, .112, .2, true);
    } else if (bridge && bar % 2 === 0) {
      plaza.note("glass", start + 2.25, .58, chord[2] + 12, .074, -.31, true);
    }
  }
  plaza.save(out, "plaza", 1.03);
}

const missionChanges = [
  [40, [52, 55, 59, 66]], [40, [52, 55, 60, 64]], [41, [53, 57, 60, 64]], [38, [50, 55, 57, 62]],
  [36, [48, 55, 59, 64]], [38, [50, 55, 57, 62]], [40, [52, 55, 59, 64]], [42, [54, 57, 60, 64]],
];
const relayCalls = [
  [[.75, 67, .26], [1.51, 71, .49], [2.88, 76, .57]], [[1.27, 74, .43], [2.24, 71, .85]],
  [[.35, 69, .37], [1.67, 67, .59], [3.12, 64, .69]], [[1.75, 62, .51], [2.71, 67, .49]],
];

function writeRail(out) {
  const bpm = 136;
  const service = new Cue(bpm, 24), breakbeat = new Cue(bpm, 24);
  for (let bar = 0; bar < 24; bar++) {
    const start = bar * 4;
    const bridge = bar >= 12 && bar < 20;
    const [bass, chord] = missionChanges[(bridge ? 4 : 0) + bar % 4];
    for (const [i, pitch] of chord.entries()) {
      service.note("pad", start - .36 + i * .04, 4.82, pitch + (i === 0 ? -12 : 0), .079 - i * .011, (i - 1.5) * .42);
      if (bar % 2 === 0) service.note("keys", start + 1.17 + i * .033, 1.43, pitch, .054, (i - 1.5) * .25);
    }
    service.note("sub", start + .14, 1.18, bass - 12, .13);
    service.note("sub", start + 2.66, .71, bass - 12, .123);
    pattern(service, start, "tight", [[2, .58], [7, .35], [10, .73], [13, .33]], .179, .095, .44);
    if (bar % 2) pattern(service, start, "rim", [[8, .57], [15, .42]], .063, .1, -.48);
    if (!bridge || bar % 2 === 0) for (const [at, pitch, length] of relayCalls[bar % 4]) {
      service.note("glass", start + at, length + .28, pitch, .125, bar % 2 ? -.27 : .25, true);
    }

    const stop = bar % 8 === 7;
    const kicks = stop ? [[0, 1], [5, .65], [10, .85], [14, .75], [15, .37]] : bar % 2
      ? [[0, 1], [3, .62], [9, .9], [11, .45], [14, .66]] : [[0, 1], [6, .79], [10, .83], [13, .54]];
    pattern(breakbeat, start, "kick", kicks, .361, .085);
    pattern(breakbeat, start, "snare", [[3, .18], [4, 1], [7, .27], [11, .14], [12, .94], ...(stop ? [[14, .48], [15, .56]] : [])], .321, .12, -.08);
    pattern(breakbeat, start, "tight", [[1, .33], [2, .81], [3, .35], [5, .64], [6, .35], [8, .49], [9, .39], [11, .91], [13, .5], [15, .72]], .166, .16, .23);
    pattern(breakbeat, start, "open", [[2, .51], [10, .79], ...(bar % 2 ? [[14, .65]] : [])], .122, .09, -.34);
    const color = (chord[1] - bass) % 12;
    const riff = bridge ? [[.17, 0, .64], [1.27, 0, .46], [1.97, color, .64], [3.15, 12, .48]]
      : [[.25, 0, .67], [1.2, 0, .42], [1.83, 12, .31], [2.74, 0, .63], [3.43, bar % 2 ? 7 : color, .45]];
    for (const [at, interval, length] of riff) breakbeat.note("rubber", start + at, length, bass + interval, .19);
    if (bar % 4 >= 2) {
      const chords = [[.52, .36], [1.37, .36], [2.58, .46]];
      for (const [at, length] of chords) for (const [i, pitch] of chord.slice(1).entries()) {
        breakbeat.note("lead", start + at + i * .014, length, pitch + (bridge ? 7 : 12), .054, (i - 1) * .38, true);
      }
    }
  }
  service.save(out, "lane", .96);
  breakbeat.save(out, "fight", 1.05);
}

function writeClear(out) {
  const sting = new Cue(112, 1);
  sting.hit("rim", .02, .16, -.3);
  for (const [at, note, length, pan] of [[0, 66, 1.52, -.26], [.36, 69, 1.72, .33], [.79, 73, 1.94, -.25], [1.31, 76, 2.12, .12]]) {
    sting.note("keys", at, length, note, .22, pan);
    sting.note("glass", at + .54, length * .6, note + 12, .081, -pan);
  }
  sting.note("pad", .98, 2.6, 50, .18);
  sting.save(out, "clear", 1.02);
}

export function renderScore(out) {
  writePlaza(out);
  writeRail(out);
  writeClear(out);
}
