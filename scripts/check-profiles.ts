// Prints the U1 presets found in Snapmaker Orca and a few flattened values.
// Run: node --experimental-strip-types scripts/check-profiles.ts
import * as profiles from "../src/lib/profiles.ts";

console.log("processes", profiles.u1Processes());
console.log("filaments", profiles.u1Filaments());
const machine = profiles.flattenPreset(profiles.U1_MACHINE);
console.log("machine", Object.keys(machine).length, machine.printer_model, machine.nozzle_diameter, machine.extruder_colour, machine.printable_area);
const proc = profiles.flattenPreset("0.20 Standard @Snapmaker U1 (0.4 nozzle)");
for (const key of ["layer_height", "outer_wall_speed", "sparse_infill_pattern", "sparse_infill_density", "wall_loops", "ironing_type", "seam_position", "brim_type", "enable_support", "support_type", "enable_prime_tower", "compatible_printers"]) {
  console.log(key, JSON.stringify(proc[key]));
}
