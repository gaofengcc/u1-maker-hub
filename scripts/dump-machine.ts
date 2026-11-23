// Prints the travel, retraction and z-hop keys of the U1 machine and a filament preset.
// Run: node --experimental-strip-types scripts/dump-machine.ts ["Snapmaker PLA @U1"]
import * as profiles from "../src/lib/profiles.ts";

const pattern = /z_hop|retract|wipe|travel|avoid|accel|jerk|resonance|first_layer|initial_layer|bed_temp|cool|fan|slow_down|nozzle_temp|volumetric|pressure/;
for (const name of [profiles.U1_MACHINE, process.argv[2] ?? "Snapmaker PLA @U1"]) {
  const p = profiles.flattenPreset(name);
  console.log(`## ${name}`);
  for (const k of Object.keys(p).filter((k) => pattern.test(k)).sort()) console.log(k, JSON.stringify(p[k]));
}
