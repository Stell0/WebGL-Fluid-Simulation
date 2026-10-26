# WebGL Fluid Simulation

Webcam-controlled fork of [Pavel Dobryakov's WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation).

## Run locally

No build or dependencies are required. From this directory run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open **http://localhost:8000**, click **Enable camera**, and allow webcam access.
Camera access requires localhost or HTTPS; a plain HTTP address on your LAN will not work.

## Webcam controls

- **Activation mode** switches between **Motion** (the default) and **Luminance**. Motion reacts only to movement, independently of the luminance threshold, and calibrates its first frame without triggering fluid. Luminance continuously emits upward currents from bright regions, including stationary ones; it does not require movement.
- **Motion smoothing** has **Smooth** and **Direct** radio buttons. Smooth is enabled by default: it eases positions, direction, and strength over about 100 ms and spreads smaller pushes across animation frames. When motion stops, the remaining force fades by about 95% over 240 ms. Direct restores the original unsmoothed camera impulses. Switching modes clears pending forces.
- **Sensitivity** is shown in Motion mode and increases detection of subtle movement. Lower it if sensor noise or lighting changes cause too much activity.
- **Luminance activation** is shown in Luminance mode. It sets an offset from the rolling one-minute median brightness, in the 0–255 luminance scale. Positive values require brighter regions; negative values include darker regions. The live readout shows the median, the resulting activation threshold, and the initial window fill. It starts with the available frames immediately and expires samples older than 60 seconds.
- For each frame, the luminance filter measures the median pixel brightness, then takes the median of those frame levels over the last minute. Motion mode turns frame differences into a black/white mask; Luminance mode turns pixels above its brightness threshold into that mask. A **3×3 spatial median** removes isolated speckles before generating fluid sources. The activation preview shows the cleaned result.
- **Force** adjusts webcam color and velocity injection; zero disables injection while keeping the preview running. At **1×**, camera displacement is converted from analysis pixels to the same normalized coordinates, aspect correction, and `SPLAT_FORCE` as the mouse. Dye is calibrated per source against a 60 FPS mouse stroke. Detected motion is no longer weakened by brightness a second time; luminance source strength follows brightness. Multiple active camera regions can cover more of the canvas than one pointer.
- The two previews show your mirrored camera and the detected signal. The whole camera image maps to the whole fluid canvas, so positions align but proportions may differ with the window shape.
- **Stop camera** releases the webcam. Mouse and touch input, the original simulation settings, and the **P** pause shortcut remain available. Camera injection pauses with the simulation; the preview continues.
- **Close Controls** and **Open Controls** hide and show both the fluid controls and webcam panel together. The camera keeps controlling the fluid while the panels are closed. Use **Stop camera** before closing if you want to release it. The **H** shortcut also hides both panels.

Video is processed on this device using a small Canvas 2D image. No audio is requested and no video is uploaded or recorded. Detection runs at most 20 times per second. Smooth mode injects at most 12 sources per animation frame and scales force and dye by elapsed time; Direct injects at most 12 sources per camera update. Pausing, stopping the camera, or hiding the browser tab clears smoothed forces. If camera frames stall, the last motion expires and fades out. Motion detection reacts to lighting changes and camera movement too; use a steady camera and stable lighting.

## Checks and implementation

```sh
node --test tests/*.test.cjs
```

`camera-filters.js` contains the rolling luminance median, motion and luminance activation, and spatial median of the binary mask; `motion-smoother.js` smooths sources by image cell and normalizes per-frame impulses; `webcam.js` owns camera access and previews; and `script.js` feeds their output into the existing fluid `splat` function. Switching activation or smoothing modes clears pending forces and preserves luminance calibration; camera restart begins a fresh window.

[Original demo](https://paveldogreat.github.io/WebGL-Fluid-Simulation/)

<img src="/screenshot.jpg?raw=true" width="880">

## References

https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu

https://github.com/mharrys/fluids-2d

https://github.com/haxiomic/GPU-Fluid-Experiments

## License

The code is available under the [MIT license](LICENSE)
