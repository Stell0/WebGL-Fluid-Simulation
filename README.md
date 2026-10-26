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

- **Motion** compares successive blurred grayscale frames. Moving regions inject color and force, with direction estimated from local image gradients. The first frame calibrates without triggering fluid.
- **Edges** uses a Sobel filter to inject along visible outlines, including stationary objects.
- **Sensitivity** increases detection of subtle changes or edges. Lower it if sensor noise or lighting changes cause too much activity.
- **Force** adjusts the strength of the webcam's color and velocity injection; zero disables injection while keeping the preview running.
- The two previews show your mirrored camera and the detected signal. The whole camera image maps to the whole fluid canvas, so positions align but proportions may differ with the window shape.
- **Stop camera** releases the webcam. Mouse and touch input, the original simulation settings, and the **P** pause shortcut remain available. Camera injection pauses with the simulation; the preview continues.

Video is processed on this device using a small Canvas 2D image. No audio is requested and no video is uploaded or recorded. Detection runs at most 20 times per second and injects at most 12 sources per update to limit GPU work. Motion detection reacts to lighting changes and camera movement too; use a steady camera and stable lighting.

## Checks and implementation

```sh
node --test tests/*.test.cjs
```

`camera-filters.js` contains the frame filters, `webcam.js` owns camera access and previews, and `script.js` feeds their output into the existing fluid `splat` function. To add a filter module, add its option to `index.html` and implement its signal and force direction in `CameraFilters.process`.

[Original demo](https://paveldogreat.github.io/WebGL-Fluid-Simulation/)

<img src="/screenshot.jpg?raw=true" width="880">

## References

https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu

https://github.com/mharrys/fluids-2d

https://github.com/haxiomic/GPU-Fluid-Experiments

## License

The code is available under the [MIT license](LICENSE)
