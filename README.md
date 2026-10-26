# WebGL Fluid Simulation

Webcam-controlled fork of [Pavel Dobryakov's WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation).

## Run locally

No build or package installation is required. From this directory run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open **http://localhost:8000**, click **Enable camera**, and allow webcam access.
Camera access requires localhost or HTTPS; a plain HTTP address on your LAN will not work.

## Webcam controls

- **Camera input** defaults to **Hand tracking**. Show one or both hands and move your fingertips to stir; holding still stops injection. A skeleton preview shows the detected hands. Choose **Motion** to react to the whole scene instead.
- Hand tracking loads pinned TensorFlow.js 4.22.0 and hand-pose-detection 2.0.1 libraries from jsDelivr and the MediaPipe Hands lite model from TensorFlow Hub. The first use needs an internet connection and a WebGL-capable browser. If loading or inference fails, a message explains the switch to motion; select hand tracking again to retry.
- **Motion** compares successive blurred grayscale frames. Moving regions inject color and force, with direction estimated from local image gradients. The first frame calibrates without triggering fluid.
- **Sensitivity** increases detection of subtle movement. In hand mode it reduces the fingertip movement needed to trigger fluid; lower it to suppress tracking jitter. In motion mode it adjusts the frame-difference threshold.
- **Force** adjusts the strength of the webcam's color and velocity injection; zero disables injection while keeping the preview running.
- The two previews show your mirrored camera and the detected signal. The whole camera image maps to the whole fluid canvas, so positions align but proportions may differ with the window shape.
- **Stop camera** releases the webcam. Mouse and touch input, the original simulation settings, and the **P** pause shortcut remain available. Camera injection pauses with the simulation; the preview continues.
- **Close Controls** and **Open Controls** hide and show both the fluid controls and webcam panel together. The camera keeps controlling the fluid while the panels are closed. Use **Stop camera** before closing if you want to release it. The **H** shortcut also hides both panels.

Video is processed on this device. No audio is requested and no video is uploaded or recorded. Hand tracking runs with the TensorFlow.js WebGL backend on the camera frames; motion detection uses a small Canvas 2D image. Detection runs at most 20 times per second, with one hand inference at a time, and injects at most 10 fingertip sources or 12 motion sources per update. Lost or newly detected hands calibrate without triggering fluid. Motion detection reacts to lighting changes and camera movement too; use a steady camera and stable lighting.

## Checks and implementation

```sh
node --test tests/*.test.cjs
```

`camera-filters.js` contains motion detection, `hand-tracking.js` loads the hand model and converts fingertip motion into fluid sources, `webcam.js` owns camera access and previews, and `script.js` feeds their output into the existing fluid `splat` function. The hand detector is cached for the document lifetime so camera stop/restart does not redownload the model.

Hand model API: [TensorFlow.js MediaPipe Hands](https://github.com/tensorflow/tfjs-models/tree/master/hand-pose-detection/src/tfjs).

[Original demo](https://paveldogreat.github.io/WebGL-Fluid-Simulation/)

<img src="/screenshot.jpg?raw=true" width="880">

## References

https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu

https://github.com/mharrys/fluids-2d

https://github.com/haxiomic/GPU-Fluid-Experiments

## License

The code is available under the [MIT license](LICENSE)
