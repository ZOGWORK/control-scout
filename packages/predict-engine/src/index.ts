// @control-scout/predict-engine — FTC match + event predictions.
//
// One engine, two apps: Control Scout and Control Point both run exactly this
// code (same version), server-side and in the browser. Pure TypeScript: no
// network, no Node APIs, no globals beyond Math/Date.
export * from "./types.js";
export * from "./inputs.js";
export * from "./rating.js";
export * from "./matchModel.js";
export * from "./contextual.js";
export * from "./calibration.js";
export * from "./rules.js";
export * from "./sim.js";
export * from "./awards.js";
export * from "./metrics.js";
export * from "./forecast.js";
export * from "./scoutData.js";
export * from "./explain.js";
export { FITTED_MODEL } from "./model.js";

/** Package version (kept in step with package.json by a test). */
export const ENGINE_VERSION = "2.0.0";
