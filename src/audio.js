// 音符イベントをライブ音・再生・WAV・MIDIで共用する。
export function voice(context, destination, note, start, secondsPerBeat) {
  const osc = context.createOscillator(),
    gain = context.createGain();
  osc.type = ["sine", "triangle", "sine", "triangle", "sine"][note.group];
  osc.frequency.value = 440 * 2 ** ((note.pitch - 69) / 12);
  const duration = note.duration * secondsPerBeat,
    level = (note.velocity / 127) * 0.11;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(destination);
  osc.start(start);
  osc.stop(start + duration + 0.025);
  return osc;
}
export class AudioEngine {
  constructor() {
    this.nodes = [];
  }
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = 0.5;
      this.gain.connect(this.context.destination);
    }
    await this.context.resume();
  }
  setVolume(value) {
    if (this.gain)
      this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.03);
  }
  play(notes, bpm) {
    if (!this.context || this.context.state !== "running") return;
    this.nodes = this.nodes.filter((n) => !n.ended);
    for (const note of notes) {
      const n = voice(
        this.context,
        this.gain,
        note,
        this.context.currentTime + 0.025,
        60 / bpm / 2,
      );
      n.onended = () => (n.ended = true);
      this.nodes.push(n);
    }
  }
  stop() {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {}
    }
    this.nodes = [];
  }
}
export function midiBytes(notes, bpm) {
  const vlq = (n) => {
    const a = [n & 127];
    while ((n >>= 7)) a.unshift((n & 127) | 128);
    return a;
  };
  const tempo = Math.round(60000000 / bpm),
    events = [];
  for (const n of notes) {
    events.push({
      tick: Math.round(n.beat * 240),
      data: [0x90, n.pitch, n.velocity],
    });
    events.push({
      tick: Math.round((n.beat + n.duration) * 240),
      data: [0x80, n.pitch, 0],
    });
  }
  events.sort((a, b) => a.tick - b.tick || a.data[0] - b.data[0]);
  const track = [
    0,
    255,
    81,
    3,
    (tempo >> 16) & 255,
    (tempo >> 8) & 255,
    tempo & 255,
  ];
  let last = 0;
  for (const e of events) {
    track.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  track.push(0, 255, 47, 0);
  const length = track.length;
  return new Uint8Array([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    1,
    224,
    77,
    84,
    114,
    107,
    (length >>> 24) & 255,
    (length >>> 16) & 255,
    (length >>> 8) & 255,
    length & 255,
    ...track,
  ]);
}
export function wavBytes(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const str = (at, s) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(
      44 + i * 2,
      Math.max(-1, Math.min(1, samples[i])) * 32767,
      true,
    );
  return new Uint8Array(buffer);
}
export async function renderWav(notes, bpm) {
  const step = 60 / bpm / 2,
    last = Math.max(0, ...notes.map((n) => n.beat + n.duration));
  const context = new OfflineAudioContext(
    1,
    Math.ceil((last * step + 0.2) * 22050),
    22050,
  );
  const gain = context.createGain();
  gain.gain.value = 0.5;
  gain.connect(context.destination);
  for (const note of notes)
    voice(context, gain, note, note.beat * step + 0.02, step);
  const buffer = await context.startRendering();
  return wavBytes(buffer.getChannelData(0), 22050);
}
