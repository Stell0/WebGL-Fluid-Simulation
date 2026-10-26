'use strict';

class HandSources {
    constructor () {
        this.reset();
    }

    reset () {
        this.previous = new Map();
    }

    process (hands, width, height, now, sensitivity) {
        const next = new Map();
        const points = [];
        for (const hand of hands) {
            if (!Number.isFinite(hand.score) || hand.score < 0.6 || !['Left', 'Right'].includes(hand.handedness)) continue;
            for (const index of [4, 8, 12, 16, 20]) {
                const tip = hand.keypoints[index];
                if (!tip || !Number.isFinite(tip.x) || !Number.isFinite(tip.y)) continue;
                const key = hand.handedness + index;
                if (next.has(key)) continue;
                const x = tip.x / width;
                const y = 1 - tip.y / height;
                if (x < 0 || x > 1 || y < 0 || y > 1) continue;
                const previous = this.previous.get(key);
                const dt = previous ? (now - previous.time) / 1000 : 0;
                if (!previous || dt <= 0 || dt > 1) {
                    next.set(key, { x, y, time: now });
                    continue;
                }
                const alpha = 1 - Math.exp(-dt / 0.05);
                const smoothX = previous.x + (x - previous.x) * alpha;
                const smoothY = previous.y + (y - previous.y) * alpha;
                const dx = smoothX - previous.x;
                const dy = smoothY - previous.y;
                next.set(key, { x: smoothX, y: smoothY, time: now });
                const distance = Math.hypot(dx, dy);
                if (distance < 0.006 - sensitivity * 0.000055) continue;
                // Reacquiring a hand far from its previous position must not throw fluid across the screen.
                if (distance > 0.2) {
                    next.set(key, { x, y, time: now });
                    continue;
                }
                points.push({
                    x: smoothX, y: smoothY,
                    dx: Math.max(-2, Math.min(2, dx / dt * 0.35)),
                    dy: Math.max(-2, Math.min(2, dy / dt * 0.35)),
                    strength: Math.min(1, 0.4 + distance / dt * 2)
                });
            }
        }
        this.previous = next;
        return points;
    }
}

class HandTracking {
    async load () {
        if (this.detector) return;
        if (!this.loading) {
            this.loading = this.createDetector().catch(error => {
                this.loading = null;
                throw error;
            });
        }
        await this.loading;
    }

    async createDetector () {
        if (!window.tf) await this.loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
        if (!window.handPoseDetection) await this.loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/hand-pose-detection@2.0.1/dist/hand-pose-detection.min.js');
        if (!await tf.setBackend('webgl')) throw new Error('WebGL inference unavailable');
        await tf.ready();
        this.detector = await handPoseDetection.createDetector(handPoseDetection.SupportedModels.MediaPipeHands, {
            runtime: 'tfjs', modelType: 'lite', maxHands: 2
        });
    }

    loadScript (url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            script.onerror = () => {
                script.remove();
                reject(new Error('Could not download hand tracking library'));
            };
            document.head.appendChild(script);
        });
    }

    reset () {
        this.needsReset = true;
    }

    async detect (video) {
        if (this.needsReset) {
            this.detector.reset();
            this.needsReset = false;
        }
        // Snapshot the frame so asynchronous GPU reads cannot race a live video texture update.
        if (!this.frame) {
            this.frame = document.createElement('canvas');
            this.context = this.frame.getContext('2d');
        }
        if (this.frame.width !== video.videoWidth || this.frame.height !== video.videoHeight) {
            this.frame.width = video.videoWidth;
            this.frame.height = video.videoHeight;
        }
        this.context.drawImage(video, 0, 0);
        const hands = await this.detector.estimateHands(this.frame, { flipHorizontal: true });
        if (hands.some(hand => !Number.isFinite(hand.score) || hand.keypoints.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)))) {
            this.reset();
            throw new Error('Hand model returned invalid landmarks');
        }
        return hands;
    }
}

if (typeof module !== 'undefined') module.exports = { HandSources, HandTracking };
