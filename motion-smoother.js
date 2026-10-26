'use strict';

class MotionSmoother {
    constructor () {
        this.reset();
    }

    reset () {
        this.cells = new Map();
        this.lastUpdate = null;
        this.lastSample = null;
        this.offset = 0;
    }

    setTargets (points, now) {
        for (const cell of this.cells.values()) cell.target = null;
        for (const point of points) {
            let cell = this.cells.get(point.cell);
            if (!cell) {
                cell = { x: point.x, y: point.y, vx: 0, vy: 0, strength: 0 };
                this.cells.set(point.cell, cell);
            }
            cell.target = point;
        }
        this.lastSample = now;
    }

    sample (now) {
        if (this.lastUpdate === null) {
            this.lastUpdate = now;
            return [];
        }
        // Limit the impulse after a stalled render loop instead of accumulating missed frames.
        const dt = Math.max(0, Math.min(0.05, (now - this.lastUpdate) / 1000));
        this.lastUpdate = now;
        if (!dt) return [];
        const fresh = this.lastSample !== null && now - this.lastSample <= 150;
        for (const [id, cell] of this.cells) {
            const target = fresh ? cell.target : null;
            const alpha = 1 - Math.exp(-dt / (target ? 0.1 : 0.08));
            const strength = target ? target.strength : 0;
            cell.vx += ((target ? target.dx * strength : 0) - cell.vx) * alpha;
            cell.vy += ((target ? target.dy * strength : 0) - cell.vy) * alpha;
            cell.strength += (strength - cell.strength) * alpha;
            if (target) {
                cell.x += (target.x - cell.x) * alpha;
                cell.y += (target.y - cell.y) * alpha;
            } else if (cell.strength < 0.002) {
                this.cells.delete(id);
            }
        }

        const cells = Array.from(this.cells.values());
        const count = Math.min(12, cells.length);
        const points = [];
        for (let i = 0; i < count; i++) {
            const cell = cells[(this.offset + Math.floor(i * cells.length / count)) % cells.length];
            if (cell.strength <= 0) continue;
            points.push({
                x: cell.x, y: cell.y,
                dx: cell.vx / cell.strength,
                dy: cell.vy / cell.strength,
                // The old detector delivered one impulse every 50 ms.
                strength: cell.strength * dt * 20
            });
        }
        if (cells.length) this.offset = (this.offset + 1) % cells.length;
        return points;
    }
}

if (typeof module !== 'undefined') module.exports = MotionSmoother;
