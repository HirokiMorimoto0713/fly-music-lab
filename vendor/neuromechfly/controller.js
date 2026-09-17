// Derived from NeLy-EPFL/flygym wasm/game/game.js, Apache-2.0.
// CPG only; deterministic xorshift32 initialization replaces Math.random.
// See NOTICE.md for revision and changes.
const TAU = Math.PI * 2;

export class WalkingController {
  constructor(meta, seed = 1) {
    this.seed = seed;
    this.dt = meta.timestep;
    this.legs = meta.control.leg_order; // 6 leg names
    this.cmap = meta.ctrl_index_by_leg_dof; // [6][7] -> ctrl index
    this.adh = meta.adhesion; // [6] -> adhesion ctrl index
    this.tripodMap = meta.control.tripod_map; // [6] -> 0/1
    const cpg = meta.control.cpg;
    this.freqs0 = cpg.intrinsic_freqs.slice(); // base |freq| per leg
    this.W = cpg.coupling_weights; // [6][6]
    this.PB = cpg.phase_biases; // [6][6]
    this.conv = cpg.convergence_coefs; // [6]
    this.phaseInc = (this.dt / meta.control.leg_step_time) * TAU;

    const pp = meta.preprogrammed;
    this.N = pp.n_samples;
    this.tab = this.legs.map((l) => pp.legs[l]); // {angles:[N][7], neutral:[7], swing:[2]}

    // scratch
    this._cpgAmps = new Float64Array(6);
    this._cpgFreqs = new Float64Array(6);
    this._d6 = new Float64Array(6);
    this._a7 = new Float64Array(7);
    this.reset();
  }

  reset() {
    let state = this.seed >>> 0 || 1;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
    this.phases = new Float64Array(6).map(() => random() * TAU); // deterministic CPG phases
    this.mags = new Float64Array(6); // CPG magnitudes
    this.legPhases = new Float64Array(6); // single-leg
    this.stepDir = new Float64Array(6);
    this.tripodPhases = new Float64Array(2); // tripod groups
    this.tripodDir = new Float64Array(2);
  }

  // Joint angles for one leg at a phase / magnitude, by periodic-lerp of the
  // baked table: angle = neutral + magnitude * (table(phase) - neutral).
  _anglesInto(li, phase, mag, out) {
    const t = this.tab[li],
      N = this.N;
    let x = ((((phase % TAU) + TAU) % TAU) / TAU) * N;
    const i0 = Math.floor(x) % N,
      i1 = (i0 + 1) % N,
      f = x - Math.floor(x);
    const a0 = t.angles[i0],
      a1 = t.angles[i1],
      nu = t.neutral;
    for (let d = 0; d < 7; d++) {
      const samp = a0[d] * (1 - f) + a1[d] * f;
      out[d] = nu[d] + mag * (samp - nu[d]);
    }
  }

  _adhesionOn(li, phase) {
    const [s, e] = this.tab[li].swing; // swing = adhesion OFF
    const p = ((phase % TAU) + TAU) % TAU;
    return !(p > s && p < e);
  }

  _writeLeg(ctrl, li, phase, mag) {
    this._anglesInto(li, phase, mag, this._a7);
    const row = this.cmap[li];
    for (let d = 0; d < 7; d++) ctrl[row[d]] = this._a7[d];
    ctrl[this.adh[li]] = this._adhesionOn(li, phase) ? 1 : 0;
  }

  // Level 1: descending signal action=[gainL,gainR] modulates CPG amplitude
  // (|action|) and stepping direction (sign), then one Euler integration step.
  stepCPG(ctrl, gainL, gainR) {
    const amps = this._cpgAmps,
      freqs = this._cpgFreqs;
    const aL = Math.abs(gainL),
      aR = Math.abs(gainR);
    amps[0] = amps[1] = amps[2] = aL;
    amps[3] = amps[4] = amps[5] = aR;
    const sL = gainL > 0 ? 1 : -1,
      sR = gainR > 0 ? 1 : -1;
    for (let i = 0; i < 6; i++) freqs[i] = this.freqs0[i] * (i < 3 ? sL : sR);

    // dtheta = 2pi*freq + sum_j mags_j*W_ij*sin(theta_j - theta_i - PB_ij);  dr = conv*(amp - r)
    const ph = this.phases,
      mg = this.mags,
      dt = this.dt;
    const dph = this._d6;
    for (let i = 0; i < 6; i++) {
      let coupling = 0;
      for (let j = 0; j < 6; j++)
        coupling +=
          mg[j] * this.W[i][j] * Math.sin(ph[j] - ph[i] - this.PB[i][j]);
      dph[i] = TAU * freqs[i] + coupling;
    }
    for (let i = 0; i < 6; i++) {
      ph[i] += dph[i] * dt;
      mg[i] += this.conv[i] * (amps[i] - mg[i]) * dt;
    }
    for (let i = 0; i < 6; i++) this._writeLeg(ctrl, i, ph[i], mg[i]);
  }
}
