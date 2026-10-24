# Relativity — an endless Escher space

A walkable, endlessly generated space after M. C. Escher's lithograph *Relativity* (1953),
drawn in real time as an etching.

You start in front of a 3D reconstruction of the print. Click one of its sixteen
inhabitants and the camera flies into that figure's eyes. From there you walk: the ground
under your feet decides which way is down. Walk into a wall and keep pushing, and the wall
becomes your floor. Walk off an edge, and you roll over it onto the side below. Every
staircase serves two gravities, as in the print: one people climbs its treads while
another walks its risers. Everything beyond the three halls of the print is generated
as you approach it.

## Running it

It is a static site with no build step. ES modules need to be served over HTTP, so from
the repository folder run any static server, for example:

```sh
python -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>. It needs a browser with WebGL 2 (current Chrome, Edge,
Firefox or Safari) and a keyboard and mouse. It also works as-is on GitHub Pages.

## Controls

| Input | Action |
| --- | --- |
| Click a figure | Step into its world |
| W A S D / arrow keys | Walk |
| Mouse | Look around |
| Shift | Run |
| Walk into a wall | That wall becomes your floor (push for a moment) |
| Walk over an edge | Roll over onto the face below the edge |
| Esc | Pause (then *Resume* or *Return to the print*, or press R) |

If the browser refuses to capture the mouse pointer, drag with the mouse to look and
press Esc to pause.

URL options: `?seed=1234` for a different endless world, `?shadows` for short cast
shadows, `?scale=1` to fix the render resolution.

## How it works

**The world is a lattice of halls.** Each hall is a 40×40×40 voxel cube (one voxel is
about half a metre) and is one streamed chunk. Neighbouring halls share a wall. Whether
that wall exists and where its arches, round windows, barred windows and doors sit is a
pure function of the wall's lattice coordinates, so two halls always agree on it no matter
which is generated first. Halls are generated in a Web Worker, closest first, and dropped
when far away. Fog fades everything beyond about 30 m into the paper, so the edge of
generation is never visible.

**Inside a hall, features are placed and then validated.** The vocabulary is Relativity's:

- corner stairs
- thin double-sided stairs flying from floor to wall
- balconies reached by wall flights, with doors to the "basements" beneath them
- landings with free stairs
- columns
- arcade walls
- gardens with trees

Each feature is written in one canonical frame and can be rotated into any of the 24
orientations of the cube, so it can belong to any of the six gravities. A feature
declares the voxels it fills, the voxels that must stay empty (headroom over every
step, landing zones at both ends of every stair) and the voxels that must already be
stone (what it is attached to). It is only committed if all three checks pass against
everything already in the hall. The space in front of every doorway is reserved
before any feature is placed. Inhabitants' walking paths are checked voxel by voxel.

**Stairs are 45° wedges**, walkable by both gravities whose "up" lies in the wedge's
normal. That is what makes one staircase usable by two peoples at once.

**The walker** keeps gravity along one of six axes. Ground is sampled under the centre of
the feet, and the body is a box in the walker's own frame. Pushing into a stone wall at
least three voxels tall rotates gravity onto the wall. Walking off an edge of stone rolls
you onto its side face. Edges you cannot roll over (railings, stair sides) act like
kerbs, so you can never fall into the void. The camera eases through every 90° turn.

**The etching** is two passes:

1. The scene is drawn into a float buffer. Hatching is laid out in world space on every
   face, with one, two or three layers of lines depending on tone. Each line family
   doubles or halves its spacing with distance, so line density stays constant on the
   "paper", like a real engraving.
2. A screen pass draws ink outlines wherever depth, surface orientation or material
   changes, fades distant ink into the paper and adds paper grain.

Tone comes from a fixed light plus ambient occlusion read from a 3D texture of the voxels
around the viewer, which darkens the hatching in corners and recesses.

## The print

The three gravities of the print map onto the corner the title camera looks into:

- the floor people (6 inhabitants, upright)
- the left-wall people (5, heads to the right)
- the right-wall people (5, heads to the left)

You will find the climber on the shared stair, the watcher on the balcony and the reader
on the low steps. At the top, a floor person climbs the top stairway while a wall person
walks down its risers beside them. Each people has its own park, seen through the arches
and the round window.

## Tests

```sh
node tests/controller.test.mjs   # gravity changes, stairs, railings, walking round a slab
node tests/generator.test.mjs    # determinism, shared walls agree, doorways clear, prefab valid, connectivity
node tests/wander.test.mjs 120   # 16 walkers wander the real world; body never in stone, never without ground
```

From the print's inhabitants, about 90% of all standing places in a 4×3×4 block of halls
are reachable on foot.

## Layout

```
index.html, style.css     title, HUD and pause overlays
src/main.js               app states: title print -> fly-in -> walking -> pause
src/core/                 constants, hashing/PRNG, cube rotations and stair wedges
src/world/walls.js        shared hall walls and their openings
src/world/features.js     the architectural vocabulary
src/world/placement.js    rotate + validate + commit
src/world/hall.js         generation of one hall
src/world/prefab.js       the hand-built halls of the print
src/world/world.js        streaming and voxel queries (worker.js generates)
src/player/               the walker and input
src/render/               etching shaders, occlusion volume, the inhabitants
vendor/three/             three.js r160 (MIT)
```

*Relativity* is a work by M. C. Escher. This project is an homage and is not affiliated
with the M. C. Escher Company.
