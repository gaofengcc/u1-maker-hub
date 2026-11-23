// Checks packBeds: overflow onto new plates, pinning, renumbering and models too big for the bed.
// Run: node --experimental-strip-types scripts/pack-test.ts
import assert from "node:assert/strict";
import { packBeds } from "../src/lib/packing.ts";

const big = { w: 130, d: 130 };
const small = { w: 40, d: 40 };

// Four 130 mm squares fit 2 per row; the prime tower corner takes room, so the rest overflows.
const overflow = packBeds([big, big, big, big, big]);
assert.ok(overflow.every((p) => p !== null));
assert.ok(Math.max(...overflow.map((p) => p!.bed)) >= 2, "five big parts need a second plate");

// A part pinned to plate 2 lands there even though plate 1 has room.
const pinned = packBeds([small, { ...small, bed: 2 }]);
assert.equal(pinned[0]!.bed, 1);
assert.equal(pinned[1]!.bed, 2);

// Only pinned to plate 3: plates are renumbered so nothing is left empty.
assert.equal(packBeds([{ ...small, bed: 3 }])[0]!.bed, 1);

// Too big for the bed: null, everything else still placed.
const tooBig = packBeds([{ w: 400, d: 50 }, small]);
assert.equal(tooBig[0], null);
assert.equal(tooBig[1]!.bed, 1);

// No overlaps between parts on the same plate.
const many = packBeds(Array.from({ length: 30 }, (_, i) => ({ w: 30 + (i % 5) * 10, d: 25 + (i % 3) * 15 })));
const sizes = Array.from({ length: 30 }, (_, i) => ({ w: 30 + (i % 5) * 10, d: 25 + (i % 3) * 15 }));
for (let a = 0; a < 30; a++)
  for (let b = a + 1; b < 30; b++) {
    const [p, q] = [many[a]!, many[b]!];
    if (p.bed !== q.bed) continue;
    const apart = Math.abs(p.x - q.x) >= (sizes[a].w + sizes[b].w) / 2 || Math.abs(p.y - q.y) >= (sizes[a].d + sizes[b].d) / 2;
    assert.ok(apart, `parts ${a} and ${b} overlap on plate ${p.bed}`);
  }
console.log("packBeds ok:", Math.max(...many.map((p) => p!.bed)), "plates for 30 parts");
