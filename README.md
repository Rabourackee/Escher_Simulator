# Relativity — an endless Escher space

A walkable, endlessly generated space after M. C. Escher's lithograph *Relativity* (1953),
drawn in real time as an etching.

You start in front of the print: a 3D reconstruction of it, seen through the print's own
camera and shown as a plate on the page. Click one of its sixteen inhabitants and the
plate grows to fill the screen while the camera dives into that figure's eyes. From there you walk: the ground under
your feet decides which way is down. Walk into a wall and keep pushing, and the wall
becomes your floor. Walk off an edge, and you roll over it onto the side below. Jump,
and you fall along your current gravity onto whatever lies below. Every staircase serves
two gravities, as in the print: one people climbs its treads while another walks its
risers. Everything beyond the three halls of the print is generated as you approach it.

## Running it

It is a static site with no build step. ES modules need to be served over HTTP. From the
repository folder:

```sh
python serve.py
```

That starts a local server and opens the game in your browser. Press Ctrl+C or close the
terminal to stop. You can also run any other static server, for example
`python -m http.server 8000` or `npx serve .`, then open <http://localhost:8000>.

It needs a browser with WebGL 2 (current Chrome, Edge, Firefox or Safari) and a keyboard
and mouse. It also works as-is on GitHub Pages.

## Controls

| Input | Action |
| --- | --- |
| Click a figure | Step into its world |
| W A S D / arrow keys | Walk |
| Mouse | Look around |
| Shift | Run |
| Space | Jump. Off an edge you fall along your gravity to the ground below; a ledge one step above a jump can be climbed onto |
| Walk into a wall | That wall becomes your floor (push for a moment) |
| Walk over an edge | Roll over onto the face below the edge |
| Esc | Pause (then *Resume* or *Return to the print*, or press R) |

A jump into nothing does not last forever: after about three seconds of falling, the
plate is redrawn with you back where you jumped.

If the browser refuses to capture the mouse pointer, drag with the mouse to look and
press Esc to pause.

URL options: `?seed=1234` for a different endless world, `?shadows` for short cast
shadows, `?scale=1` to fix the render resolution.

## How it works

**The world is a lattice of halls.** Each hall is a 40×40×40 voxel cube (one voxel is
about half a metre) and is one streamed chunk. Neighbouring halls share a wall. Whether
that wall exists and how it is opened up is a pure function of the wall's lattice
coordinates, so two halls always agree on it no matter which is generated first. About a
third of the walls are missing altogether. Most of the rest are arcades (rows of arches,
often with a second tier), grand arches, or little more than a frame around one huge
opening, so the halls run into each other. The rest are pierced with doorways, round
windows, barred windows and closed doors. Halls are generated in a Web Worker, closest
first, and dropped when far away. Fog fades everything beyond about 30 m into the paper,
so the edge of generation is never visible.

**Inside a hall, features are placed and then validated.** The vocabulary is Relativity's:

- corner stairs
- thin double-sided stairs flying from floor to wall
- balconies reached by wall flights, with doors to the "basements" beneath them
- landings with free stairs, plain balconies, bridges spanning the hall
- towers (sometimes pierced by an arched passage) with stairs and balconies hung on their
  faces and gardens, urns or statues on their roofs
- columns, arcade walls and gardens with trees
- urns on pedestals, potted plants, stone balls, statues and benches

The walls also carry ornament: pilasters, string courses, blind niches with urns, lanterns
beside doorways and medallions. Inhabitants walk checked paths, stand about, sit on
benches and steps, and lean on railings. The ones that don't walk are baked into the
hall's mesh, so they cost nothing to draw.

Each feature is written in one canonical frame and can be rotated into any of the 24
orientations of the cube, so it can belong to any of the six gravities. It can also be
offset to hang off a tower instead of a hall wall. A feature declares the voxels it fills,
the voxels that must stay empty (headroom over every step, landing zones at both ends of
every stair) and the voxels that must already be stone (what it is attached to). It is
only committed if all three checks pass against everything already in the hall. The space
in front of every doorway is reserved before any feature is placed. Inhabitants' paths and
standing places are checked voxel by voxel.

**Stairs are 45° wedges**, walkable by both gravities whose "up" lies in the wedge's
normal. That is what makes one staircase usable by two peoples at once.

**The walker** keeps gravity along one of six axes. Ground is sampled under the centre of
the feet, and the body is a box in the walker's own frame. Pushing into a stone wall at
least three voxels tall rotates gravity onto the wall. Walking off an edge of stone rolls
you onto its side face. Edges you cannot roll over (railings, stair sides) act like
kerbs, so walking alone never drops you into the void. Jumping is the deliberate way
down: you keep your gravity, steer in the air, bump your head on ceilings and land on
whatever is below, stairs included. A fall never enters a hall that is still being
generated; it waits for it. The camera eases through every 90° turn and dips a little on
landing.

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

*Relativity* is drawn in true three-point perspective, so its camera can be recovered.
The print's straight edges were detected and fitted to three vanishing points. Those give
the focal length (a vertical field of view of about 52°) and the camera's orientation:
it looks up about 32° into the corner where the ceiling and two walls meet. Each
staircase, landing, arch and opening was then placed by casting rays from the print
through that camera onto the plane it lies on. Each inhabitant was lifted to 3D from the
size it is drawn at. The title view uses exactly that camera, at the print's proportions,
and it does not move.

The hall's three peoples are the print's:

- the floor people, upright: the climber at the foot of the print, the leaner on the
  landing, the sitter by the box
- the left-wall people: the garden party seen through the arch on the right, the walker
  under the right staircase
- the right-wall people: the couple in the garden at the top left, the sack carrier, the
  basket carrier

On the top stairway, a left-wall person and a right-wall person walk side by side, each
on their own face of the same steps.

`src/world/printhall.js` holds the reconstruction. Add `?frame&outline` to the URL to see
it at the print's exact framing with outlines only, for comparing against the print.

## Memory

Nothing is saved on your computer: no cookies, local storage, databases, offline caches
or service workers. The browser keeps its ordinary copy of the site's files and fonts
(about 1 MB), as it does for any website.

While it runs, it holds only the halls around you:

- **Hall meshes** live only on the graphics card (about 45–70 MB). They are stored
  compactly at 12 bytes a vertex, and the copy in main memory is let go as soon as a
  mesh has been uploaded.
- **Voxels** for collision and lighting take 128 KB a hall.
- **Walkers:** every walker is kept as a few numbers, and only the nearest 40 are drawn,
  using a reused pool of figures.
- **Caches:** the generator's are kept small and emptied whenever a walk ends.

At the start of a walk, nothing carries over from before: no stray key press, mouse
movement, or fall in progress. At the end of a walk (returning to the print), every hall
the walk loaded is dropped. Nothing is generated along the flight back, so the world is
left exactly as a fresh start would have it.

When you leave the page (close the tab, reload or navigate away), the generation worker
is stopped, every mesh, texture and buffer is freed and the graphics context is released.
If you come back with the Back button, the page starts over from scratch.

## Tests

```sh
node tests/controller.test.mjs   # gravity changes, stairs, railings, walking round a slab, jumps and falls
node tests/generator.test.mjs    # determinism, shared walls agree, doorways clear, openness, prefab valid, connectivity
node tests/wander.test.mjs 120   # 16 walkers wander and jump through the real world; never in stone, never without ground
node tests/memory.test.mjs       # walks end exactly as a fresh start; stale work is ignored; shutdown frees everything
```

From the print's inhabitants, about 93% of all standing places in a 4×3×4 block of halls
are reachable on foot.

## Layout

```
index.html, style.css     title, HUD and pause overlays
src/main.js               app states: title print -> fly-in -> walking -> pause
src/core/                 constants, hashing/PRNG, cube rotations and stair wedges
src/world/walls.js        shared hall walls and their openings
src/world/features.js     the architectural vocabulary
src/world/decor.js        ornament on the walls
src/world/placement.js    rotate + validate + commit
src/world/hall.js         generation of one hall
src/world/prefab.js       which halls are hand-built
src/world/printhall.js    the reconstruction of the print, its camera and its inhabitants
src/world/pieces.js       stairs, blocks, railings and arched walls placed by coordinates
src/world/world.js        streaming and voxel queries (worker.js generates)
src/player/               the walker and input
src/render/               etching shaders, occlusion volume, the inhabitants
vendor/three/             three.js r160 (MIT)
```

*Relativity* is a work by M. C. Escher. This project is an homage and is not affiliated
with the M. C. Escher Company.
