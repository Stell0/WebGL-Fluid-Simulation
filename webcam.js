'use strict';

class WebcamInput {
    constructor (inject) {
        this.inject = inject;
        this.video = document.getElementById('camera-video');
        this.preview = document.getElementById('camera-filter');
        this.previewContext = this.preview.getContext('2d');
        this.capture = document.createElement('canvas');
        this.context = this.capture.getContext('2d', { willReadFrequently: true });
        this.button = document.getElementById('camera-toggle');
        this.status = document.getElementById('camera-status');
        this.smooth = document.getElementById('camera-smooth-on');
        this.smoother = new MotionSmoother();
        this.luminanceMode = document.getElementById('camera-mode-luminance');
        this.sensitivity = document.getElementById('camera-sensitivity');
        this.activation = document.getElementById('camera-activation');
        this.luminanceStatus = document.getElementById('camera-luminance');
        this.force = document.getElementById('camera-force');
        this.stream = null;
        this.request = 0;
        this.starting = false;
        this.lastFrame = 0;
        this.lastVideoTime = -1;
        this.offset = 0;
        this.button.addEventListener('click', () => {
            if (this.stream || this.starting) this.stop();
            else this.start();
        });
        document.querySelectorAll('input[name="camera-smoothing"]').forEach(input => {
            input.addEventListener('change', () => {
                this.smoother.reset();
                this.filters?.reset();
                this.lastVideoTime = -1;
            });
        });
        document.querySelectorAll('input[name="camera-mode"]').forEach(input => {
            input.addEventListener('change', () => {
                this.smoother.reset();
                this.filters?.reset();
                this.lastVideoTime = -1;
                this.syncActivationMode();
            });
        });
        for (const input of [this.sensitivity, this.activation, this.force]) {
            input.addEventListener('input', () => {
                document.getElementById(input.id + '-value').value = input === this.activation && Number(input.value) > 0 ? '+' + input.value : input.value;
            });
        }
        document.addEventListener('visibilitychange', () => {
            this.smoother.reset();
            this.filters?.reset();
            this.lastVideoTime = -1;
        });
        window.addEventListener('pagehide', () => this.stop());
        this.syncActivationMode();
    }

    syncActivationMode () {
        document.getElementById('camera-motion-controls').hidden = this.luminanceMode.checked;
        document.getElementById('camera-luminance-controls').hidden = !this.luminanceMode.checked;
        if (this.stream && !this.starting) {
            this.status.textContent = this.luminanceMode.checked
                ? 'Luminance active. Bright areas stir even when still. Video stays on this device.'
                : 'Motion active. Move to stir the fluid. Video stays on this device.';
        }
    }

    async start () {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            this.status.textContent = 'Camera needs HTTPS or localhost and a browser with webcam support.';
            return;
        }
        const request = ++this.request;
        this.starting = true;
        this.button.textContent = 'Cancel camera';
        this.status.textContent = 'Allow camera access in your browser…';
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
            });
            if (request !== this.request) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            this.stream = stream;
            this.video.srcObject = stream;
            stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
                if (this.stream === stream) this.stop('Camera disconnected. Enable it to reconnect.');
            }));
            await this.video.play();
            if (request !== this.request) return;
            const width = 96;
            const height = Math.max(24, Math.min(144, Math.round(width * this.video.videoHeight / this.video.videoWidth)));
            this.capture.width = this.preview.width = width;
            this.capture.height = this.preview.height = height;
            this.filters = new CameraFilters(width, height);
            this.smoother.reset();
            this.previewImage = this.previewContext.createImageData(width, height);
            this.lastFrame = 0;
            this.lastVideoTime = -1;
            this.starting = false;
            this.button.textContent = 'Stop camera';
            this.button.setAttribute('aria-pressed', 'true');
            document.getElementById('camera-previews').hidden = false;
            this.syncActivationMode();
        } catch (error) {
            if (request !== this.request) return;
            const messages = {
                NotAllowedError: 'Camera permission denied. Allow camera access in your browser, then try again.',
                NotFoundError: 'No camera found. Connect a webcam, then try again.',
                NotReadableError: 'Camera is busy or unavailable. Close other camera apps, then try again.'
            };
            this.stop(messages[error.name] || 'Could not start the camera. Check your device and try again.');
        }
    }

    stop (message = 'Camera off. Mouse and touch still work.') {
        ++this.request;
        this.starting = false;
        if (this.stream) this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
        this.video.pause();
        this.video.srcObject = null;
        this.filters?.reset();
        this.smoother.reset();
        this.previewContext.clearRect(0, 0, this.preview.width, this.preview.height);
        document.getElementById('camera-previews').hidden = true;
        this.button.textContent = 'Enable camera';
        this.button.setAttribute('aria-pressed', 'false');
        this.status.textContent = message;
        this.luminanceStatus.textContent = 'Enable camera to measure luminance.';
    }

    update (now, paused) {
        if (!this.stream || this.starting || document.hidden || this.video.readyState < 2) {
            this.smoother.reset();
            return;
        }
        if (paused) this.smoother.reset();
        try {
            if (now - this.lastFrame >= 50 && this.video.currentTime !== this.lastVideoTime) {
                this.lastFrame = now;
                this.lastVideoTime = this.video.currentTime;
                const { width, height } = this.capture;
                // Mirror pixels before filtering so the preview and fluid share coordinates.
                this.context.setTransform(-1, 0, 0, 1, width, 0);
                this.context.drawImage(this.video, 0, 0, width, height);
                const rgba = this.context.getImageData(0, 0, width, height).data;
                const threshold = 2 + (100 - Number(this.sensitivity.value)) * 0.6;
                const mode = this.luminanceMode.checked ? 'luminance' : 'motion';
                const { mask, points, luminanceMedian, activationThreshold, windowSeconds } = this.filters.process(rgba, threshold, Number(this.activation.value), now, mode);
                this.luminanceStatus.textContent = `Median ${Math.round(luminanceMedian)} → threshold ${Math.round(activationThreshold)}/255${windowSeconds < 60 ? ` · ${Math.floor(windowSeconds)}/60 s` : ''}`;
                this.previewImage.data.set(mask);
                this.previewContext.putImageData(this.previewImage, 0, 0);
                if (!paused) {
                    if (this.smooth.checked) this.smoother.setTargets(points, now);
                    else {
                        const count = Math.min(12, points.length);
                        for (let i = 0; i < count; i++) {
                            const point = points[(this.offset + Math.floor(i * points.length / count)) % points.length];
                            this.inject(point, Number(this.force.value));
                        }
                        if (points.length) this.offset = (this.offset + 1) % points.length;
                    }
                }
            }
            if (!paused && this.smooth.checked) {
                for (const point of this.smoother.sample(now)) this.inject(point, Number(this.force.value));
            }
        } catch (error) {
            this.stop('Camera processing failed. Enable the camera to try again.');
        }
    }
}
