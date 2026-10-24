// Deterministic hashing and a small seeded PRNG (mulberry32).
// Everything in the world is derived from these, so a hall always regenerates identically.

export function hash(a, b = 0, c = 0, d = 0, e = 0) {
  let h = Math.imul((a | 0) ^ 0x3c6ef372, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h ^ (b | 0), 0x85ebca77);
  h ^= h >>> 13;
  h = Math.imul(h ^ (c | 0), 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h ^ (d | 0), 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h ^ (e | 0), 0x165667b1);
  h ^= h >>> 16;
  return h >>> 0;
}

export class Rng {
  constructor(seed) {
    this.s = seed >>> 0;
  }

  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }  // inclusive
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  weighted(entries) {
    let total = 0;
    for (const e of entries) total += e[1];
    let r = this.next() * total;
    for (const e of entries) {
      r -= e[1];
      if (r < 0) return e[0];
    }
    return entries[entries.length - 1][0];
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
}
