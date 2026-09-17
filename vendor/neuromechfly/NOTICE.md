# NeuroMechFly browser components

Source: [NeLy-EPFL/flygym](https://github.com/NeLy-EPFL/flygym), commit
`38c8ec61034cd59bc5ba0de20688d4a3c0000d60`, Apache-2.0 (LICENSE).

- `controller.js` is derived from `wasm/game/game.js`. Retains the CPG controller
  and interpolation of the supplied PreprogrammedSteps trajectories. Other control
  modes were removed. Initial phases use seeded xorshift32 instead of Math.random.
- `meshes.js` retains the geometry construction and solved-pose rendering helpers
  from `wasm/shared/scene.js`.
- Generated NeuroMechFly v2 model and step tables come from the official gh-pages
  commit `0884af08981994543634563d95e9b1eb49945082` (Apache-2.0).
  The source slalom model is unchanged; this app hides decorative world poles
  when rendering. They have no collision response. Model units are mm, g, s.
- MuJoCo 3.9.0 by Google DeepMind, Apache-2.0 (LICENSE-mujoco).
- Three.js 0.169.0 by its authors, MIT (LICENSE-three). Isolated to walk.html.

The asset manifest in `public/embodied/manifest.json` records immutable source
URLs, byte counts and SHA-256 hashes. `npm run prepare:body` fetches only these
files, with no install hooks. Runtime code and assets are served locally.

Please cite the [NeuroMechFly v2 publication and project](https://neuromechfly.org/).
This application's manual controls and measurements do not imply that a whole
brain model generated or learned the gait. MaleCNS is not connected in this stage.
