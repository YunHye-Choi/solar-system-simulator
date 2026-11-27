[한국어 README.md 보기](README.ko.md)

# Solar System Journey

Explore a playable Solar System built with real-world planetary sizes and distances. Walk across planetary surfaces, fly between worlds, visit notable landing sites, and inspect the scene through an in-game HUD and minimap.

The simulator runs directly in a modern browser. It uses WebGL 2 and has no build step or external runtime dependencies.

## Run

Open `index.html` in a recent browser, or serve the project directory over HTTP:

```sh
python3 -m http.server 8765
```

Then visit <http://localhost:8765>. Use the language button in the upper-right corner to switch between English and Korean. Your choice is saved in the browser.

## Controls

| Key | Action |
| --- | --- |
| W A S D, mouse | Move and look |
| Q / E | Descend / ascend; press E on the ground to take off |
| Shift | Move faster (4× on foot, 8× in flight) |
| Space | Jump using the body's gravity |
| Mouse wheel | Change flight speed |
| 1–9 | Visit Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune, or Pluto |
| 0 / ` | Visit the Sun / Moon |
| Same body key again | View from orbit; press again to land |
| G | Land on the surface directly below |
| M / B | Toggle the minimap / cycle its mode (automatic, Solar System, Milky Way) |
| N | Open navigation; choose a destination, then hold W to fly toward it |
| X | Clear the navigation destination |
| L | Toggle body and star labels |
| [ / ] | Decrease / increase time speed |
| P / R | Pause time / reset to the current time |
| V | Toggle sound effects |
| J | Toggle ambient background music |
| H / Esc | Toggle information / menu |

## Project files

- `index.html` — page structure, styles, and language switch
- `i18n.js` — English and Korean interface translations
- `main.js` — orbital calculations, movement, rendering, HUD, and minimap
- `data.js` — body properties, orbital elements, atmospheres, landing sites, and bright stars
- `shaders.js` — scene and star-sky shaders
- `terrain.glsl.js` — terrain height functions shared by rendering and collision logic
- `earth-data.js` — generated Earth surface map data
- `tools/build_earth.py` — script for generating `earth-data.js`

## Performance

Near a surface, terrain heights are baked into a set of 512×512 textures at multiple scales. Ray marching and shadows sample these textures, while procedural noise is evaluated for surface color and nearby detail. The textures are refreshed incrementally as the camera moves. Devices that cannot render to floating-point textures use a fallback path.

The scene uses the display pixel ratio (capped at 1.5×); High renders at that native device resolution without supersampling the ray-marched scene. High is the default on desktop, while touch devices and low-memory systems start at a lighter preset. GPU timing includes terrain baking, scene rendering, and the final blit; render resolution adjusts automatically to keep frame times usable. The interface uses Inter and Noto Sans KR, with system-font fallbacks. Press **H** to show frame rate, GPU time, and the current resolution scale.

## Modeling notes

- The Sun and gas giants do not have solid surfaces. The Sun's photosphere and the gas giants' cloud tops at 1 bar are used as walkable surfaces.
- Major terrain features are placed by hand; smaller surface details are procedural. Notable features include lunar maria, Olympus Mons and Valles Marineris on Mars, and Sputnik Planitia on Pluto.
- Flight speed can exceed the speed of light, up to roughly 0.1 AU per second before the Shift boost.
- Travel is bounded by the heliopause at approximately 120 AU.
