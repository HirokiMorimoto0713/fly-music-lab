import { validateConfig } from "./mapping.js";
export const DATA_REVISION = "776d115ee5aa934578a87fd6d260d138084f59c1";
export function validateExperiment(input) {
  if (input?.format !== "fly-music-lab/1" || input.dataset !== DATA_REVISION)
    throw Error(
      "このアプリの実験ファイルではないか、配線データの版が異なります",
    );
  const config = validateConfig(input.config);
  if (
    !Array.isArray(input.stimuli) ||
    input.stimuli.length > 500 ||
    !Number.isInteger(input.frames) ||
    input.frames < 0 ||
    input.frames > 128
  )
    throw Error("実験の長さが範囲外です");
  const stimuli = input.stimuli.map((s) => {
    if (
      !Number.isInteger(s.frame) ||
      s.frame < 0 ||
      s.frame >= input.frames ||
      !["vision", "left", "right", "flight"].includes(s.target) ||
      !Number.isFinite(s.strength) ||
      s.strength < 0 ||
      s.strength > 300
    )
      throw Error("刺激の値が範囲外です");
    return { frame: s.frame, target: s.target, strength: s.strength };
  });
  return {
    format: "fly-music-lab/1",
    dataset: DATA_REVISION,
    config,
    stimuli,
    frames: input.frames,
  };
}
export function experiment(config, stimuli, frames) {
  return validateExperiment({
    format: "fly-music-lab/1",
    dataset: DATA_REVISION,
    config,
    stimuli,
    frames,
  });
}
