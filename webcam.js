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
        this.mode = document.getElementById('camera-mode');
        this.sensitivity = document.getElementById('camera-sensitivity');
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
        this.mode.addEventListener('change', () => this.filters?.reset());
        for (const input of [this.sensitivity, this.force]) {
            input.addEventListener('input', () => {
                document.getElementById(input.id + '-value').value = input.value;
            });
        }
        document.addEventListener('visibilitychange', () => {
            this.filters?.reset();
            this.lastVideoTime = -1;
        });
        window.addEventListener('pagehide', () => this.stop());
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
            this.previewImage = this.previewContext.createImageData(width, height);
            this.lastFrame = 0;
            this.lastVideoTime = -1;
            this.starting = false;
            this.button.textContent = 'Stop camera';
            this.button.setAttribute('aria-pressed', 'true');
            document.getElementById('camera-previews').hidden = false;
            this.status.textContent = 'Camera active. Move to stir the fluid. Video stays on this device.';
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
        this.previewContext.clearRect(0, 0, this.preview.width, this.preview.height);
        document.getElementById('camera-previews').hidden = true;
        this.button.textContent = 'Enable camera';
        this.button.setAttribute('aria-pressed', 'false');
        this.status.textContent = message;
    }

    update (now, paused) {
        if (!this.stream || this.starting || document.hidden || this.video.readyState < 2) return;
        if (now - this.lastFrame < 50 || this.video.currentTime === this.lastVideoTime) return;
        this.lastFrame = now;
        this.lastVideoTime = this.video.currentTime;
        try {
            const { width, height } = this.capture;
            // Mirror pixels before filtering so the preview and fluid share coordinates.
            this.context.setTransform(-1, 0, 0, 1, width, 0);
            this.context.drawImage(this.video, 0, 0, width, height);
            const rgba = this.context.getImageData(0, 0, width, height).data;
            const threshold = 2 + (100 - Number(this.sensitivity.value)) * 0.6;
            const { mask, points } = this.filters.process(rgba, this.mode.value, threshold);
            this.previewImage.data.set(mask);
            this.previewContext.putImageData(this.previewImage, 0, 0);
            if (paused || !points.length) return;
            const count = Math.min(12, points.length);
            for (let i = 0; i < count; i++) {
                const point = points[(this.offset + Math.floor(i * points.length / count)) % points.length];
                this.inject(point, Number(this.force.value));
            }
            this.offset = (this.offset + 1) % points.length;
        } catch (error) {
            this.stop('Camera processing failed. Enable the camera to try again.');
        }
    }
}
