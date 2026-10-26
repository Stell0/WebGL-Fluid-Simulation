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
    assert.equal(filters.process(image, 10).points.length, 0);
    assert.equal(filters.process(image, 10).points.length, 0);
});

test('motion detects a moving boundary and pushes in its direction', () => {
    const filters = new CameraFilters(width, height);
    filters.process(frame(x => x >= 12 ? 255 : 0), 10);
    const { points } = filters.process(frame(x => x >= 16 ? 255 : 0), 10);
    assert.ok(points.length > 0);
    assert.ok(points.every(p => p.x > 0.3 && p.x < 0.6));
    assert.ok(points.some(p => p.dx > 0));
    assert.ok(points.every(p => Number.isFinite(p.dx) && Number.isFinite(p.dy)));
});

test('motion clears the detection preview when movement stops', () => {
    const filters = new CameraFilters(width, height);
    const image = frame(x => x >= 16 ? 255 : 0);
    filters.process(frame(() => 0), 10);
    const moving = filters.process(image, 10);
    assert.ok(moving.points.length > 0);
    assert.ok(moving.mask.some((v, index) => index % 4 === 1 && v === 220));
    const stopped = filters.process(image, 10);
    assert.equal(stopped.points.length, 0);
    assert.ok(stopped.mask.every((v, index) => index % 4 === 3 || v === 0));
});

test('low camera noise is suppressed', () => {
    const filters = new CameraFilters(width, height);
    filters.process(frame(() => 90), 10);
    assert.equal(filters.process(frame((x, y) => 90 + (x + y) % 3), 10).points.length, 0);
});

test('reset recalibrates motion after returning to the page or restarting', () => {
    const filters = new CameraFilters(width, height);
    filters.process(frame(() => 0), 10);
    filters.reset();
    assert.equal(filters.process(frame(() => 255), 10).points.length, 0);
});

test('sensitivity threshold rejects weak signals', () => {
    const image = frame(x => x >= 16 ? 40 : 0);
    const sensitive = new CameraFilters(width, height);
    const insensitive = new CameraFilters(width, height);
    const baseline = frame(() => 0);
    sensitive.process(baseline, 2);
    insensitive.process(baseline, 60);
    assert.ok(sensitive.process(image, 2).points.length > 0);
    assert.equal(insensitive.process(image, 60).points.length, 0);
});

test('sources are spatially bounded and image Y maps to fluid Y', () => {
    const filters = new CameraFilters(width, height);
    filters.process(frame((x, y) => y >= 10 ? 255 : 0), 10);
    const { points } = filters.process(frame((x, y) => y >= 6 ? 255 : 0), 10);
    assert.ok(points.length > 0);
    assert.ok(points.length <= Math.ceil(width / 8) * Math.ceil(height / 8));
    assert.equal(new Set(points.map(p => p.cell)).size, points.length);
    for (const point of points) {
        assert.ok(point.x > 0 && point.x < 1);
        assert.ok(point.y > 0.6 && point.y < 0.9);
        assert.ok(point.dy >= 0);
        assert.ok(point.strength > 0 && point.strength <= 1);
    }
    assert.ok(points.some(p => p.dy > 0));
});
