const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HandSources, HandTracking } = require('../hand-tracking.js');

function hand (x = 40, y = 50, handedness = 'Left', score = 0.95) {
    return { handedness, score, keypoints: Array.from({ length: 21 }, () => ({ x, y })) };
}

test('hand acquisition calibrates without emitting, then moving fingertips inject', () => {
    const sources = new HandSources();
    assert.deepEqual(sources.process([hand()], 100, 100, 0, 65), []);
    const points = sources.process([hand(45, 45)], 100, 100, 50, 65);
    assert.equal(points.length, 5);
    assert.ok(points.every(p => p.x > 0.4 && p.x < 0.45 && p.y > 0.5 && p.y < 0.55));
    assert.ok(points.every(p => p.dx > 0 && p.dy > 0 && p.strength > 0));
});

test('stationary fingers and small tracking jitter do not emit fluid', () => {
    const sources = new HandSources();
    sources.process([hand()], 100, 100, 0, 65);
    assert.deepEqual(sources.process([hand()], 100, 100, 50, 65), []);
    assert.deepEqual(sources.process([hand(40.05)], 100, 100, 100, 65), []);
});

test('sensitivity controls the minimum fingertip movement', () => {
    for (const [sensitivity, expected] of [[0, 0], [100, 5]]) {
        const sources = new HandSources();
        sources.process([hand()], 100, 100, 0, sensitivity);
        assert.equal(sources.process([hand(40.2)], 100, 100, 50, sensitivity).length, expected);
    }
});

test('both hands retain identity if the detector changes output order', () => {
    const sources = new HandSources();
    sources.process([hand(20), hand(80, 50, 'Right')], 100, 100, 0, 65);
    const points = sources.process([hand(75, 50, 'Right'), hand(25)], 100, 100, 50, 65);
    assert.equal(points.length, 10);
    assert.ok(points.slice(0, 5).every(p => p.dx < 0));
    assert.ok(points.slice(5).every(p => p.dx > 0));
});

test('low confidence, lost hands, and reset clear previous positions', () => {
    const sources = new HandSources();
    sources.process([hand()], 100, 100, 0, 65);
    assert.deepEqual(sources.process([hand(50, 50, 'Left', 0.4)], 100, 100, 50, 65), []);
    assert.deepEqual(sources.process([hand(70)], 100, 100, 100, 65), []);
    sources.process([], 100, 100, 150, 65);
    assert.deepEqual(sources.process([hand(20)], 100, 100, 200, 65), []);
    sources.reset();
    assert.deepEqual(sources.process([hand(80)], 100, 100, 250, 65), []);
});

test('long gaps and abrupt identity jumps recalibrate instead of drawing a streak', () => {
    const sources = new HandSources();
    sources.process([hand(5)], 100, 100, 0, 65);
    assert.deepEqual(sources.process([hand(95)], 100, 100, 50, 65), []);
    assert.deepEqual(sources.process([hand(95)], 100, 100, 100, 65), []);
    assert.deepEqual(sources.process([hand(80)], 100, 100, 2100, 65), []);
});

test('out-of-frame and invalid model coordinates do not reach the renderer', () => {
    const sources = new HandSources();
    for (const invalid of [hand(NaN), hand(-10), hand(110), hand(40, Infinity), hand(40, 50, 'Left', NaN)]) {
        assert.deepEqual(sources.process([invalid], 100, 100, 0, 65), []);
        assert.equal(sources.previous.size, 0);
    }
});

test('fast fingertip force and color stay bounded', () => {
    const sources = new HandSources();
    sources.process([hand(40)], 100, 100, 0, 65);
    const points = sources.process([hand(55)], 100, 100, 10, 65);
    assert.equal(points.length, 5);
    assert.ok(points.every(p => p.dx <= 2 && p.dy >= -2 && p.strength <= 1));
});

test('inference snapshots live video before asynchronous model work', async () => {
    const originalDocument = global.document;
    const frame = { width: 0, height: 0 };
    frame.getContext = () => ({ drawImage: video => { frame.pixels = video.pixels; } });
    global.document = { createElement: () => frame };
    try {
        const video = { videoWidth: 100, videoHeight: 80, pixels: 'first frame' };
        const tracker = new HandTracking();
        tracker.detector = {
            async estimateHands (input, options) {
                video.pixels = 'next frame';
                await Promise.resolve();
                assert.notEqual(input, video);
                assert.equal(input.pixels, 'first frame');
                assert.equal(options.flipHorizontal, true);
                return [hand()];
            }
        };
        assert.equal((await tracker.detect(video)).length, 1);
    } finally {
        global.document = originalDocument;
    }
});

test('invalid model output is reported as an error instead of no hands', async () => {
    const tracker = new HandTracking();
    tracker.frame = { width: 100, height: 80 };
    tracker.context = { drawImage () {} };
    tracker.detector = { estimateHands: async () => [hand(NaN)] };
    await assert.rejects(tracker.detect({ videoWidth: 100, videoHeight: 80 }), /invalid landmarks/);
    assert.equal(tracker.needsReset, true);
});
