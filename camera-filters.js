'use strict';

class RollingLuminanceMedian {
    constructor () {
        this.samples = [];
        this.startedAt = null;
    }

    add (value, now) {
        while (this.samples.length && this.samples[0].time <= now - 60000) this.samples.shift();
        if (!this.samples.length) this.startedAt = now;
        this.samples.push({ value, time: now });
        const values = this.samples.map(sample => sample.value).sort((a, b) => a - b);
        const middle = Math.floor(values.length / 2);
        return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    }
}

// Shared by the browser and the dependency-free Node tests.
class CameraFilters {
    constructor (width, height) {
        this.width = width;
        this.height = height;
        this.gray = new Float32Array(width * height);
        this.previousGray = new Float32Array(width * height);
        this.current = new Float32Array(width * height);
        this.previous = new Float32Array(width * height);
        this.binary = new Uint8Array(width * height);
        this.histogram = new Uint32Array(256);
        this.luminance = new RollingLuminanceMedian();
        this.mask = new Uint8ClampedArray(width * height * 4);
        this.reset();
    }

    reset () {
        this.hasPrevious = false;
    }

    process (rgba, threshold, activationOffset = 12, now = performance.now()) {
        const { width, height, gray, previousGray, current, previous, binary, histogram, mask } = this;
        histogram.fill(0);
        for (let i = 0; i < gray.length; i++) {
            const p = i * 4;
            gray[i] = rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114;
            histogram[Math.round(gray[i])]++;
        }

        let cumulative = 0;
        let lower = -1;
        let upper = 0;
        for (let value = 0; value < histogram.length; value++) {
            cumulative += histogram[value];
            if (lower < 0 && cumulative > Math.floor((gray.length - 1) / 2)) lower = value;
            if (cumulative > Math.floor(gray.length / 2)) {
                upper = value;
                break;
            }
        }
        const luminanceMedian = this.luminance.add((lower + upper) / 2, now);
        const activationThreshold = Math.max(0, Math.min(255, luminanceMedian + activationOffset));

        // A small blur suppresses camera noise before frame differencing.
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let sum = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const sx = Math.max(0, Math.min(width - 1, x + dx));
                        const sy = Math.max(0, Math.min(height - 1, y + dy));
                        sum += gray[sy * width + sx];
                    }
                }
                current[y * width + x] = sum / 9;
            }
        }

        for (let i = 0; i < binary.length; i++) {
            const moving = this.hasPrevious && Math.abs(current[i] - previous[i]) > threshold;
            // Include both arriving and departing bright pixels so both sides of movement can stir.
            binary[i] = moving && Math.max(gray[i], previousGray[i]) >= activationThreshold ? 1 : 0;
        }

        // The median of nine binary pixels is white when at least five neighbors are white.
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let white = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const sx = Math.max(0, Math.min(width - 1, x + dx));
                        const sy = Math.max(0, Math.min(height - 1, y + dy));
                        white += binary[sy * width + sx];
                    }
                }
                const p = (y * width + x) * 4;
                mask[p] = mask[p + 1] = mask[p + 2] = white >= 5 ? 255 : 0;
                mask[p + 3] = 255;
            }
        }

        const cells = new Map();
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = y * width + x;
                const signal = Math.abs(current[i] - previous[i]);
                if (mask[i * 4] === 0 || signal <= threshold) continue;
                const gx = (-current[i - width - 1] + current[i - width + 1]
                    - 2 * current[i - 1] + 2 * current[i + 1]
                    - current[i + width - 1] + current[i + width + 1]) / 8;
                const gy = (-current[i - width - 1] - 2 * current[i - width] - current[i - width + 1]
                    + current[i + width - 1] + 2 * current[i + width] + current[i + width + 1]) / 8;
                const delta = current[i] - previous[i];

                // One source per 8x8 cell keeps a detailed scene from flooding the GPU.
                const cell = Math.floor(y / 8) * Math.ceil(width / 8) + Math.floor(x / 8);
                if (cells.has(cell) && cells.get(cell).signal >= signal) continue;
                // Local brightness change estimates motion along the image gradient.
                const scale = -delta / (gx * gx + gy * gy + 25);
                const dx = Math.max(-2, Math.min(2, gx * scale));
                const dy = Math.max(-2, Math.min(2, -gy * scale));
                cells.set(cell, {
                    cell,
                    x: (x + 0.5) / width,
                    y: 1 - (y + 0.5) / height,
                    dx, dy, signal,
                    strength: Math.min(1, signal / 80)
                });
            }
        }
        previous.set(current);
        previousGray.set(gray);
        this.hasPrevious = true;
        return {
            mask, points: Array.from(cells.values()), luminanceMedian, activationThreshold,
            windowSeconds: Math.min(60, (now - this.luminance.startedAt) / 1000)
        };
    }
}

if (typeof module !== 'undefined') {
    module.exports = CameraFilters;
    module.exports.RollingLuminanceMedian = RollingLuminanceMedian;
}
