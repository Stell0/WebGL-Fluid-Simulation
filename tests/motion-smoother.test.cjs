const { test } = require('node:test');
const assert = require('node:assert/strict');
const MotionSmoother = require('../motion-smoother.js');

function source (cell = 0, dx = 1, strength = 1, x = 0.25) {
    return { cell, x, y: 0.5, dx, dy: 0, strength };
}

test('a camera update produces gradual forces between camera frames', () => {
    const smoother = new MotionSmoother();
    smoother.setTargets([source()], 0);
    assert.deepEqual(smoother.sample(0), []);
    const first = smoother.sample(1000 / 60)[0];
    const second = smoother.sample(2000 / 60)[0];
    assert.ok(first.strength > 0 && first.strength < 1 / 3);
    assert.ok(second.strength > first.strength);
    assert.equal(second.dx, 1);
});

test('direction and position changes ease through the previous force', () => {
    const smoother = new MotionSmoother();
    smoother.setTargets([source()], 0);
    smoother.sample(0);
    for (let now = 50; now <= 500; now += 50) {
        smoother.setTargets([source()], now);
        smoother.sample(now);
    }
    smoother.setTargets([source(0, -1, 1, 0.75)], 500);
    const point = smoother.sample(500 + 1000 / 60)[0];
    assert.ok(point.dx > 0 && point.dx < 1);
    assert.ok(point.x > 0.25 && point.x < 0.75);
});

test('stationary input fades gently and eventually stops emitting', () => {
    const smoother = new MotionSmoother();
    smoother.setTargets([source()], 0);
    smoother.sample(0);
    smoother.sample(50);
    smoother.setTargets([], 50);
    const first = smoother.sample(100)[0];
    const second = smoother.sample(150)[0];
    assert.ok(first.strength > second.strength && second.strength > 0);
    for (let now = 200; now <= 800; now += 50) smoother.sample(now);
    assert.deepEqual(smoother.sample(850), []);
    assert.equal(smoother.cells.size, 0);
});

test('a frozen video expires its last force instead of stirring forever', () => {
    const smoother = new MotionSmoother();
    smoother.setTargets([source()], 0);
    smoother.sample(0);
    for (let now = 50; now <= 1000; now += 50) smoother.sample(now);
    assert.equal(smoother.cells.size, 0);
});

test('force and dye totals stay consistent at 30, 60, and 120 render frames per second', () => {
    const totals = [30, 60, 120].map(fps => {
        const smoother = new MotionSmoother();
        smoother.setTargets([source()], 0);
        smoother.sample(0);
        let force = 0;
        let dye = 0;
        let nextCamera = 50;
        for (let i = 1; i <= fps * 2; i++) {
            const now = i * 1000 / fps;
            if (now >= nextCamera) {
                smoother.setTargets([source()], now);
                nextCamera += 50;
            }
            for (const point of smoother.sample(now)) {
                if (i > fps) {
                    force += point.dx * point.strength;
                    dye += point.strength;
                }
            }
        }
        return { force, dye };
    });
    for (const total of totals) {
        assert.ok(Math.abs(total.force - 20) < 0.01);
        assert.ok(Math.abs(total.dye - 20) < 0.01);
    }
});

test('cell identity survives detector output reordering', () => {
    const smoother = new MotionSmoother();
    smoother.setTargets([source(0, 1, 1, 0.2), source(1, -1, 1, 0.8)], 0);
    smoother.sample(0);
    smoother.sample(50);
    smoother.setTargets([source(1, -1, 1, 0.8), source(0, 1, 1, 0.2)], 50);
    const points = smoother.sample(100);
    assert.equal(smoother.cells.size, 2);
    assert.ok(points.every(p => p.x < 0.5 ? p.dx > 0 : p.dx < 0));
});

test('reset discards forces after pause, camera stop, or changing smoothing mode', () => {
    const smoother = new MotionSmoother();
    smoother.setTargets([source()], 0);
    smoother.sample(0);
    assert.ok(smoother.sample(50).length > 0);
    smoother.reset();
    assert.deepEqual(smoother.sample(100), []);
    assert.deepEqual(smoother.sample(150), []);
});

test('source count and impulses stay bounded through a render stall', () => {
    const smoother = new MotionSmoother();
    smoother.setTargets(Array.from({ length: 100 }, (_, cell) => source(cell)), 0);
    smoother.sample(0);
    assert.equal(smoother.sample(50).length, 12);
    smoother.setTargets(Array.from({ length: 100 }, (_, cell) => source(cell)), 1000);
    const points = smoother.sample(1000);
    assert.equal(points.length, 12);
    assert.ok(points.every(p => p.strength <= 1 && Number.isFinite(p.dx)));
});
