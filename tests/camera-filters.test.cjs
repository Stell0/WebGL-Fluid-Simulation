const { test } = require('node:test');
const assert = require('node:assert/strict');
const CameraFilters = require('../camera-filters.js');

const width = 32;
const height = 24;

function frame (pixel) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            rgba.fill(pixel(x, y), i, i + 3);
            rgba[i + 3] = 255;
        }
    }
    return rgba;
}

test('motion warms up without a full-frame burst and ignores an unchanged scene', () => {
    const filters = new CameraFilters(width, height);
    const image = frame(x => x > 15 ? 255 : 0);
    assert.equal(filters.process(image, 'motion', 10).points.length, 0);
    assert.equal(filters.process(image, 'motion', 10).points.length, 0);
});

test('motion detects a moving boundary and pushes in its direction', () => {
    const filters = new CameraFilters(width, height);
    filters.process(frame(x => x >= 12 ? 255 : 0), 'motion', 10);
    const { points } = filters.process(frame(x => x >= 16 ? 255 : 0), 'motion', 10);
    assert.ok(points.length > 0);
    assert.ok(points.every(p => p.x > 0.3 && p.x < 0.6));
    assert.ok(points.some(p => p.dx > 0));
    assert.ok(points.every(p => Number.isFinite(p.dx) && Number.isFinite(p.dy)));
});

test('edges detect a stationary boundary on the first and following frames', () => {
    const filters = new CameraFilters(width, height);
    const image = frame(x => x >= 16 ? 255 : 0);
    for (let i = 0; i < 2; i++) {
        const { points, mask } = filters.process(image, 'edges', 10);
        assert.ok(points.length > 0);
        assert.ok(points.every(p => Math.abs(p.x - 0.5) < 0.1 && p.dx > 0));
        assert.ok(mask.some((v, index) => index % 4 === 1 && v === 220));
    }
});

test('uniform illumination has no edges and low camera noise is suppressed', () => {
    const filters = new CameraFilters(width, height);
    assert.equal(filters.process(frame(() => 90), 'edges', 10).points.length, 0);
    assert.equal(filters.process(frame((x, y) => 90 + (x + y) % 3), 'motion', 10).points.length, 0);
});

test('reset recalibrates motion after a mode change, pause, or restart', () => {
    const filters = new CameraFilters(width, height);
    filters.process(frame(() => 0), 'motion', 10);
    filters.reset();
    assert.equal(filters.process(frame(() => 255), 'motion', 10).points.length, 0);
});

test('sensitivity threshold rejects weak signals', () => {
    const image = frame(x => x >= 16 ? 40 : 0);
    assert.ok(new CameraFilters(width, height).process(image, 'edges', 2).points.length > 0);
    assert.equal(new CameraFilters(width, height).process(image, 'edges', 60).points.length, 0);
});

test('sources are spatially bounded and image Y maps to fluid Y', () => {
    const filters = new CameraFilters(width, height);
    const { points } = filters.process(frame((x, y) => y >= 6 ? 255 : 0), 'edges', 10);
    assert.ok(points.length > 0);
    assert.ok(points.length <= Math.ceil(width / 8) * Math.ceil(height / 8));
    for (const point of points) {
        assert.ok(point.x > 0 && point.x < 1);
        assert.ok(point.y > 0.6 && point.y < 0.9);
        assert.ok(point.dy < 0);
        assert.ok(point.strength > 0 && point.strength <= 1);
    }
});
