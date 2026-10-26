'use strict';

// Shared by the browser and the dependency-free Node tests.
class CameraFilters {
    constructor (width, height) {
        this.width = width;
        this.height = height;
        this.gray = new Float32Array(width * height);
        this.current = new Float32Array(width * height);
        this.previous = new Float32Array(width * height);
        this.mask = new Uint8ClampedArray(width * height * 4);
        this.reset();
    }

    reset () {
        this.hasPrevious = false;
    }

    process (rgba, threshold) {
        const { width, height, gray, current, previous, mask } = this;
        for (let i = 0; i < gray.length; i++) {
            const p = i * 4;
            gray[i] = rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114;
        }

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

        mask.fill(0);
        const cells = new Map();
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = y * width + x;
                const gx = (-current[i - width - 1] + current[i - width + 1]
                    - 2 * current[i - 1] + 2 * current[i + 1]
                    - current[i + width - 1] + current[i + width + 1]) / 8;
                const gy = (-current[i - width - 1] - 2 * current[i - width] - current[i - width + 1]
                    + current[i + width - 1] + 2 * current[i + width] + current[i + width + 1]) / 8;
                const delta = current[i] - previous[i];
                const signal = this.hasPrevious ? Math.abs(delta) : 0;
                const active = signal > threshold;
                const p = i * 4;
                mask[p] = active ? 70 : 0;
                mask[p + 1] = active ? 220 : 0;
                mask[p + 2] = active ? 255 : 0;
                mask[p + 3] = 255;
                if (!active) continue;

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
        this.hasPrevious = true;
        return { mask, points: Array.from(cells.values()) };
    }
}

if (typeof module !== 'undefined') module.exports = CameraFilters;
