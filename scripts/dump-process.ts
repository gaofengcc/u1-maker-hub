// Prints the reliability-related keys of a flattened U1 process preset.
// Run: node --experimental-strip-types scripts/dump-process.ts ["0.20 Standard @Snapmaker U1 (0.4 nozzle)"]
import * as profiles from "../src/lib/profiles.ts";

const name = process.argv[2] ?? "0.20 Standard @Snapmaker U1 (0.4 nozzle)";
const p = profiles.flattenPreset(name);
const pattern = /speed|accel|jerk|first_layer|initial_layer|brim|skirt|wipe|z_hop|bridge|overhang|seam|wall|top|bottom|infill|support|prime|ooze|elephant|arc|resolution|precise|line_width|order|ironing/;
for (const k of Object.keys(p).filter((k) => pattern.test(k)).sort()) console.log(k, JSON.stringify(p[k]));
