const { test } = require('node:test');
const assert = require('node:assert/strict');
const CameraFilters = require('../camera-filters.js');
const { RollingLuminanceMedian } = CameraFilters;

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
    assert.ok(moving.mask.some((v, index) => index % 4 === 1 && v === 255));
    const stopped = filters.process(image, 10);
    assert.equal(stopped.points.length, 0);
    assert.ok(stopped.mask.every((v, index) => index % 4 === 3 || v === 0));
});

test('the one-minute median uses available samples and expires old timestamps', () => {
    const median = new RollingLuminanceMedian();
    assert.equal(median.add(10, 0), 10);
    assert.equal(median.add(30, 1000), 20);
    assert.equal(median.add(200, 2000), 30);
    assert.equal(median.add(50, 60000), 50);
    assert.equal(median.add(70, 62000), 60);
    assert.equal(median.add(90, 130000), 90);
    assert.equal(median.startedAt, 130000);
    assert.equal(median.samples.length, 1);
});

test('the rolling median resists isolated brightness outliers', () => {
    const median = new RollingLuminanceMedian();
    for (const [time, value] of [100, 100, 100, 255, 0].entries()) {
        assert.equal(median.add(value, time * 50), 100);
    }
});

test('luminance activation follows a full sixty-second window', () => {
    const filters = new CameraFilters(width, height);
    const dark = frame(() => 20);
    for (const time of [0, 1000, 2000]) filters.process(dark, 10, 12, time);
    const flash = filters.process(frame(() => 80), 10, 12, 59000);
    assert.equal(flash.luminanceMedian, 20);
    assert.equal(flash.activationThreshold, 32);
    const changed = filters.process(frame(() => 80), 10, 12, 62000);
    assert.equal(changed.luminanceMedian, 80);
    assert.equal(changed.activationThreshold, 92);
    assert.equal(changed.windowSeconds, 60);
});

test('luminance activation offset excludes dim regions without requiring movement', () => {
    const low = new CameraFilters(width, height);
    const high = new CameraFilters(width, height);
    const baseline = frame(() => 20);
    const moving = frame(x => x >= 16 ? 40 : 20);
    low.process(baseline, 5, 0, 0, 'luminance');
    high.process(baseline, 5, 40, 0, 'luminance');
    assert.ok(low.process(moving, 5, 0, 50, 'luminance').points.length > 0);
    assert.equal(high.process(moving, 5, 40, 50, 'luminance').points.length, 0);
});

test('stationary bright regions continuously activate luminance mode, including the first frame', () => {
    const filters = new CameraFilters(width, height);
    const image = frame((x, y) => x >= 10 && x <= 20 && y >= 6 && y <= 16 ? 200 : 20);
    for (const now of [0, 50, 100]) {
        const { points } = filters.process(image, 255, 12, now, 'luminance');
        assert.ok(points.length > 0);
        assert.ok(points.every(p => p.dx === 0 && p.dy === 1 && p.strength > 0));
    }
});

test('motion mode ignores the luminance threshold and gives detected displacement full strength', () => {
    const filters = new CameraFilters(width, height);
    filters.process(frame(x => x >= 12 ? 40 : 0), 5, 255, 0, 'motion');
    const moving = frame(x => x >= 16 ? 40 : 0);
    const { points } = filters.process(moving, 5, 255, 50, 'motion');
    assert.ok(points.length > 0);
    assert.ok(points.every(p => p.strength === 1 && Math.hypot(p.dx, p.dy) > 0));
    assert.ok(points.every(p => Math.abs(p.dx) <= 8 && Math.abs(p.dy) <= 8));
    assert.equal(filters.process(moving, 5, 255, 100, 'motion').points.length, 0);
});

test('motion sources select moving gradients instead of a flat bright interior', () => {
    const filters = new CameraFilters(width, height);
    filters.process(frame(x => x >= 8 ? 255 : 0), 10, 12, 0, 'motion');
    const { points } = filters.process(frame(x => x >= 16 ? 255 : 0), 10, 12, 50, 'motion');
    assert.ok(points.length > 0);
    assert.ok(points.every(p => p.dx > 0));
    assert.ok(points.some(p => p.dx > 2));
});

test('switching back to motion recalibrates without discarding the luminance window', () => {
    const filters = new CameraFilters(width, height);
    const image = frame((x, y) => x >= 10 && x <= 20 && y >= 6 && y <= 16 ? 200 : 20);
    filters.process(image, 10, 12, 0, 'luminance');
    const history = filters.luminance;
    filters.reset();
    assert.equal(filters.process(image, 10, 12, 50, 'motion').points.length, 0);
    assert.equal(filters.luminance, history);
    assert.equal(filters.luminance.samples.length, 2);
});

test('luminance mode excludes brightness at the cutoff and keeps the spatial median cleanup', () => {
    const filters = new CameraFilters(width, height);
    const speckle = filters.process(frame((x, y) => x === 16 && y === 12 ? 255 : 0), 10, 12, 0, 'luminance');
    assert.equal(speckle.points.length, 0);
    const off = filters.process(frame(() => 255), 10, 255, 50, 'luminance');
    assert.equal(off.activationThreshold, 255);
    assert.equal(off.points.length, 0);
});

test('activation mask is opaque black or white on every pixel', () => {
    const filters = new CameraFilters(width, height);
    filters.process(frame(() => 0), 10, 12, 0);
    const { mask, points } = filters.process(frame(x => x >= 16 ? 255 : 0), 10, 12, 50);
    assert.ok(points.length > 0);
    for (let p = 0; p < mask.length; p += 4) {
        assert.ok(mask[p] === 0 || mask[p] === 255);
        assert.equal(mask[p + 1], mask[p]);
        assert.equal(mask[p + 2], mask[p]);
        assert.equal(mask[p + 3], 255);
    }
});

test('spatial median removes isolated luminance speckles and preserves broad bright regions', () => {
    const filters = new CameraFilters(width, height);
    filters.process(frame(() => 0), 5, 12, 0, 'luminance');
    const speckle = filters.process(frame((x, y) => x === 16 && y === 12 ? 255 : 0), 5, 12, 50, 'luminance');
    assert.equal(speckle.points.length, 0);
    assert.ok(speckle.mask.every((value, index) => index % 4 === 3 || value === 0));
    const region = filters.process(frame((x, y) => x >= 12 && x <= 20 && y >= 8 && y <= 16 ? 255 : 0), 5, 12, 100, 'luminance');
    assert.ok(region.points.length > 0);
});

test('one-pixel camera movement remains detectable after the binary median', () => {
    const filters = new CameraFilters(width, height);
    filters.process(frame(x => x >= 16 ? 255 : 0), 23, 12, 0, 'motion');
    const { points } = filters.process(frame(x => x >= 17 ? 255 : 0), 23, 12, 50, 'motion');
    assert.ok(points.length > 0);
    assert.ok(points.every(p => p.dx > 0 && p.strength === 1));
});

test('activation clamps to the valid luminance range and motion reset preserves calibration', () => {
    const filters = new CameraFilters(width, height);
    assert.equal(filters.process(frame(() => 20), 10, -128, 0).activationThreshold, 0);
    filters.process(frame(() => 20), 10, 12, 50);
    filters.reset();
    const result = filters.process(frame(() => 240), 10, 128, 100);
    assert.equal(result.luminanceMedian, 20);
    assert.equal(result.activationThreshold, 148);
    assert.equal(result.points.length, 0);
    const bright = new CameraFilters(width, height).process(frame(() => 240), 10, 128, 0);
    assert.equal(bright.activationThreshold, 255);
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
