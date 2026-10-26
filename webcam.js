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
        this.trackingStatus = document.getElementById('camera-tracking-status');
        this.sensitivity = document.getElementById('camera-sensitivity');
        this.force = document.getElementById('camera-force');
        this.hands = new HandTracking();
        this.handSources = new HandSources();
        this.revision = 0;
        this.handReady = false;
        this.pendingHands = false;
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
        this.mode.addEventListener('change', () => this.configureInput());
        for (const input of [this.sensitivity, this.force]) {
            input.addEventListener('input', () => {
                document.getElementById(input.id + '-value').value = input.value;
            });
        }
        document.addEventListener('visibilitychange', () => {
            ++this.revision;
            this.filters?.reset();
            this.handSources.reset();
            this.hands.reset();
            this.lastVideoTime = -1;
            if (!document.hidden) this.configureInput();
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
            this.configureInput();
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
        ++this.revision;
        this.starting = false;
        if (this.stream) this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
        this.video.pause();
        this.video.srcObject = null;
        this.filters?.reset();
        this.handSources.reset();
        this.hands.reset();
        this.handReady = false;
        this.trackingStatus.hidden = true;
        this.previewContext.clearRect(0, 0, this.preview.width, this.preview.height);
        document.getElementById('camera-previews').hidden = true;
        this.button.textContent = 'Enable camera';
        this.button.setAttribute('aria-pressed', 'false');
        this.status.textContent = message;
    }

    async configureInput () {
        const revision = ++this.revision;
        this.handReady = false;
        this.handSources.reset();
        this.hands.reset();
        this.filters?.reset();
        this.lastVideoTime = -1;
        this.trackingStatus.hidden = true;
        const useHands = this.mode.value === 'hands';
        const width = useHands ? 320 : this.capture.width;
        const ratio = useHands && this.video.videoWidth ? this.video.videoHeight / this.video.videoWidth : this.capture.height / this.capture.width;
        const height = Math.round(width * ratio);
        this.preview.width = width;
        this.preview.height = height;
        document.getElementById('camera-filter-caption').textContent = useHands ? 'Hand landmarks' : 'Fluid sources';
        if (!this.stream) return;
        if (!useHands) {
            this.status.textContent = 'Motion active. Move to stir the fluid. Video stays on this device.';
            return;
        }
        this.status.textContent = 'Loading hand tracking model… First use needs an internet connection.';
        try {
            await this.hands.load();
            if (revision !== this.revision || !this.stream) return;
            this.handReady = true;
            this.trackingStatus.hidden = false;
            this.trackingStatus.textContent = 'Show one or both hands to the camera.';
            this.status.textContent = 'Hands active. Move your fingertips to stir. Video stays on this device.';
        } catch (error) {
            if (revision !== this.revision || !this.stream) return;
            this.useMotionFallback();
        }
    }

    useMotionFallback () {
        this.mode.value = 'motion';
        this.configureInput();
        this.status.textContent = 'Hand tracking unavailable. Check your connection and WebGL support; motion input is active. Select hand tracking to retry.';
    }

    update (now, paused) {
        this.paused = paused;
        if (!this.stream || this.starting || document.hidden || this.video.readyState < 2) return;
        const useHands = this.mode.value === 'hands';
        if (useHands && (!this.handReady || this.pendingHands)) return;
        if (now - this.lastFrame < 50 || this.video.currentTime === this.lastVideoTime) return;
        this.lastFrame = now;
        this.lastVideoTime = this.video.currentTime;
        if (useHands) {
            this.updateHands();
            return;
        }
        try {
            const { width, height } = this.capture;
            // Mirror pixels before filtering so the preview and fluid share coordinates.
            this.context.setTransform(-1, 0, 0, 1, width, 0);
            this.context.drawImage(this.video, 0, 0, width, height);
            const rgba = this.context.getImageData(0, 0, width, height).data;
            const threshold = 2 + (100 - Number(this.sensitivity.value)) * 0.6;
            const { mask, points } = this.filters.process(rgba, threshold);
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

    async updateHands () {
        const revision = this.revision;
        const width = this.video.videoWidth;
        const height = this.video.videoHeight;
        this.pendingHands = true;
        try {
            const hands = await this.hands.detect(this.video);
            if (revision !== this.revision || !this.stream || document.hidden) return;
            const reliable = hands.filter(hand => hand.score >= 0.6);
            const points = this.handSources.process(reliable, width, height, performance.now(), Number(this.sensitivity.value));
            this.drawHands(reliable, width, height);
            this.trackingStatus.textContent = reliable.length ? `${reliable.length} hand${reliable.length === 1 ? '' : 's'} tracked. Move your fingers to stir.` : 'No hands detected. Show your hands to the camera.';
            if (!this.paused) points.forEach(point => this.inject(point, Number(this.force.value)));
        } catch (error) {
            if (revision === this.revision && this.stream) this.useMotionFallback();
        } finally {
            this.pendingHands = false;
        }
    }

    drawHands (hands, width, height) {
        const ctx = this.previewContext;
        ctx.fillStyle = '#071019';
        ctx.fillRect(0, 0, this.preview.width, this.preview.height);
        const x = point => point.x / width * this.preview.width;
        const y = point => point.y / height * this.preview.height;
        for (const hand of hands) {
            ctx.strokeStyle = hand.handedness === 'Left' ? '#66d9ed' : '#ffc878';
            ctx.lineWidth = 2;
            for (const finger of [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20]]) {
                ctx.beginPath();
                finger.forEach((index, i) => {
                    const point = hand.keypoints[index];
                    if (i === 0) ctx.moveTo(x(point), y(point));
                    else ctx.lineTo(x(point), y(point));
                });
                ctx.stroke();
            }
            ctx.fillStyle = '#ffffff';
            for (const index of [4, 8, 12, 16, 20]) {
                const point = hand.keypoints[index];
                ctx.beginPath();
                ctx.arc(x(point), y(point), 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}
