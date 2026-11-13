// Cannon shots made with the Web Audio API: no sound files.
// Sound only. The screen flash that goes with a shot lives in announcement.js.

const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const audio = new AudioContextClass();

export const SECOND_SHOT_SECONDS = 1.9;

// Exponential fades cannot reach zero, so "silent" is a value too small to hear.
const SILENT = 0.0001;
const ECHO_TAIL_SECONDS = 5;

const FIRST_SHOT = { tone: 1, level: 1, treble: 6500 };
// Deeper, quieter and duller: it sounds farther away.
const SECOND_SHOT = { tone: 0.84, level: 0.8, treble: 2600 };

// The shot bouncing off far terrain: each echo later, quieter and duller.
const ECHOES = [
  { delay: 0.46, level: 0.34, treble: 900 },
  { delay: 1.02, level: 0.21, treble: 520 },
  { delay: 1.85, level: 0.12, treble: 320 },
];

/* ---------- Small helpers ---------- */

function randomSample() {
  return Math.random() * 2 - 1;
}

/** Connects audio nodes in a row: first -> second -> third ... */
function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].connect(nodes[i + 1]);
  }
}

function makeGain(level) {
  const gain = audio.createGain();
  gain.gain.value = level;
  return gain;
}

function makeFilter(type, frequency) {
  const filter = audio.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = 0.5;
  return filter;
}

/**
 * Moves an audio setting through points over time.
 * @param {AudioParam} param
 * @param {number} start time on the audio clock
 * @param {Array<[number, number]>} points pairs of [seconds after start, value]
 */
function envelope(param, start, points) {
  const [[firstTime, firstValue], ...rest] = points;
  param.setValueAtTime(firstValue, start + firstTime);
  for (const [time, value] of rest) {
    param.exponentialRampToValueAtTime(value, start + time);
  }
}

/** Plays a stretch of a noise buffer. The random offset makes every shot a little different. */
function playNoise(buffer, start, seconds) {
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const offset = Math.random() * (buffer.duration - 0.1);
  source.start(start, offset);
  source.stop(start + seconds);
  return source;
}

/* ---------- Parts every shot shares, built once (the noise is costly to make on a Raspberry Pi) ---------- */

function makeWhiteNoise(seconds) {
  const buffer = audio.createBuffer(1, audio.sampleRate * seconds, audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = randomSample();
  }
  return buffer;
}

/** Noise with mostly low frequencies, for the rumble. */
function makeBrownNoise(seconds) {
  const buffer = audio.createBuffer(1, audio.sampleRate * seconds, audio.sampleRate);
  const samples = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < samples.length; i++) {
    last = (last + 0.02 * randomSample()) / 1.02;
    samples[i] = last * 3.5;
  }
  return buffer;
}

/** An echo tail that gets darker as it dies, like sound rolling back off hills. */
function makeEchoTail() {
  const length = Math.floor(audio.sampleRate * ECHO_TAIL_SECONDS);
  const tail = audio.createBuffer(2, length, audio.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = tail.getChannelData(channel);
    let smoothed = 0;
    for (let i = 0; i < length; i++) {
      const position = i / length; // 0 at the start of the tail, 1 at the end
      // One-pole lowpass whose cutoff falls from about 2 kHz to about 90 Hz.
      const openness = 0.25 * (1 - position) ** 2 + 0.012;
      smoothed += openness * (randomSample() - smoothed);
      samples[i] = (smoothed / Math.sqrt(openness)) * (1 - position) ** 2.2;
    }
  }
  return tail;
}

/** Soft saturation: turns a clean thump into a gritty blast with harmonics small TV speakers can play. */
function makeBlastCurve() {
  const curve = new Float32Array(2048);
  const middle = (curve.length - 1) / 2;
  for (let i = 0; i < curve.length; i++) {
    const input = i / middle - 1; // -1 to 1
    curve[i] = Math.tanh(3 * input);
  }
  return curve;
}

const whiteNoise = makeWhiteNoise(4);
const brownNoise = makeBrownNoise(6);
const blastCurve = makeBlastCurve();

// Output chain: shots -> compressor -> master volume -> speakers.
const master = makeGain(1);
const compressor = audio.createDynamicsCompressor(); // keeps the loud hit from clipping
compressor.threshold.value = -14;
compressor.ratio.value = 8;
compressor.attack.value = 0.002;
compressor.release.value = 0.35;
chain(compressor, master, audio.destination);

// Each shot sends its direct sound to dryOut and a copy to the reverb for the long outdoor echo.
const dryOut = makeGain(0.62);
chain(dryOut, compressor);
const reverb = audio.createConvolver();
reverb.buffer = makeEchoTail();
chain(reverb, makeGain(0.28), compressor);

/* ---------- The layers of one shot ---------- */

/** Muzzle crack: 30 ms of bright noise, the first thing that reaches you. */
function addCrack(output, start) {
  const level = makeGain(0);
  envelope(level.gain, start, [[0, 0.9], [0.035, SILENT]]);
  chain(playNoise(whiteNoise, start, 0.05), makeFilter('highpass', 1800), level, output);
}

/** Body: a pressure thump whose pitch collapses fast, then sags. */
function addThump(output, start, tone) {
  const thump = audio.createOscillator();
  const level = makeGain(0);
  envelope(thump.frequency, start, [[0, 160 * tone], [0.1, 55 * tone], [1.2, 30 * tone]]);
  envelope(level.gain, start, [[0, SILENT], [0.004, 1], [0.2, 0.4], [1.5, SILENT]]);
  chain(thump, level, output);
  thump.start(start);
  thump.stop(start + 1.6);
}

/** Blast: a broadband burst that closes down to a dull roar. */
function addBlast(output, start, tone) {
  const filter = makeFilter('lowpass', 8000);
  const level = makeGain(0);
  envelope(filter.frequency, start, [[0, 8000 * tone], [0.1, 1100], [2.8, 140]]);
  envelope(level.gain, start, [[0, SILENT], [0.003, 1.3], [0.18, 0.32], [3.1, SILENT]]);
  chain(playNoise(whiteNoise, start, 3.2), filter, level, output);
}

/** Rumble: a slow low roll that swells after the hit and lingers. */
function addRumble(output, start) {
  const level = makeGain(0);
  envelope(level.gain, start, [[0, SILENT], [0.3, 0.45], [1.4, 0.18], [5, SILENT]]);
  chain(playNoise(brownNoise, start, 5.2), makeFilter('lowpass', 170), level, output);
}

/** Slap-back echoes of everything that passes through `source`. */
function addEchoes(source) {
  for (const echo of ECHOES) {
    const delay = audio.createDelay(3);
    const jitter = 0.9 + Math.random() * 0.2; // never exactly the same twice
    delay.delayTime.value = echo.delay * jitter;
    const level = makeGain(echo.level);
    chain(source, delay, makeFilter('lowpass', echo.treble), level);
    level.connect(dryOut);
    level.connect(reverb);
  }
}

/**
 * One cannon shot.
 * @param {number} start time on the audio clock
 * @param {{tone: number, level: number, treble: number}} shot
 *   tone: below 1 is deeper. level: loudness. treble: how much high sound survives the distance (Hz).
 */
function playShot(start, { tone, level, treble }) {
  // Everything ends in `mix`, then passes the distance filter to the direct sound and the echo.
  const mix = makeGain(level);
  const distance = makeFilter('lowpass', treble);
  chain(mix, distance, dryOut);
  distance.connect(reverb);

  // The thump and the blast go through distortion first.
  const drive = makeGain(0.9);
  const distortion = audio.createWaveShaper();
  distortion.curve = blastCurve;
  distortion.oversample = '2x';
  chain(drive, distortion, mix);

  addCrack(mix, start);
  addThump(drive, start, tone);
  addBlast(drive, start, tone);
  addRumble(mix, start);
  addEchoes(distance);
}

/* ---------- What the rest of the page uses ---------- */

/** Browsers keep sound locked until a key press or click, unless started with the kiosk autoplay flag. */
export function soundIsUnlocked() {
  return audio.state === 'running';
}

/**
 * Call from a key press or click.
 * @returns {Promise<void>} settles once sound is really on; unlocking takes a moment
 */
export function unlockSound() {
  return audio.resume();
}

/** @param {number} volume 0 to 1 */
export function setCannonVolume(volume) {
  master.gain.value = volume;
}

/** Two shots, the second a moment after the first. Silent while sound is locked. */
export function playCannonShots() {
  // While sound is locked the audio clock stands still. Shots scheduled now would pile up
  // and all fire together on the first key press, so they are skipped.
  if (!soundIsUnlocked()) return;

  const start = audio.currentTime + 0.05;
  playShot(start, FIRST_SHOT);
  playShot(start + SECOND_SHOT_SECONDS, SECOND_SHOT);
}
