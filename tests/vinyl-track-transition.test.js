const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createClock() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();

    return {
        setTimeout(callback, delay = 0) {
            const id = nextId++;
            timers.set(id, { callback, time: now + Math.max(Number(delay) || 0, 0) });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        advance(milliseconds) {
            const target = now + milliseconds;

            while (true) {
                const due = [...timers.entries()]
                    .filter(([, timer]) => timer.time <= target)
                    .sort((left, right) => left[1].time - right[1].time || left[0] - right[0])[0];
                if (!due) break;

                const [id, timer] = due;
                timers.delete(id);
                now = timer.time;
                timer.callback();
            }

            now = target;
        }
    };
}

function areDependenciesEqual(left, right) {
    return Array.isArray(left)
        && Array.isArray(right)
        && left.length === right.length
        && left.every((value, index) => Object.is(value, right[index]));
}

function createHookRuntime() {
    const hooks = [];
    let cursor = 0;
    let pendingEffects = [];

    const react = {
        memo: (component) => component,
        createElement(type, props, ...children) {
            return {
                type,
                props: {
                    ...(props || {}),
                    children: children.length <= 1 ? children[0] : children
                }
            };
        },
        useState(initialValue) {
            const index = cursor++;
            if (!hooks[index]) {
                hooks[index] = {
                    kind: 'state',
                    value: typeof initialValue === 'function' ? initialValue() : initialValue
                };
            }

            const setValue = (nextValue) => {
                const currentValue = hooks[index].value;
                hooks[index].value = typeof nextValue === 'function'
                    ? nextValue(currentValue)
                    : nextValue;
            };
            return [hooks[index].value, setValue];
        },
        useRef(initialValue) {
            const index = cursor++;
            if (!hooks[index]) hooks[index] = { kind: 'ref', current: initialValue };
            return hooks[index];
        },
        useCallback(callback, dependencies) {
            const index = cursor++;
            const previous = hooks[index];
            if (previous && areDependenciesEqual(previous.dependencies, dependencies)) {
                return previous.callback;
            }

            hooks[index] = { kind: 'callback', callback, dependencies };
            return callback;
        },
        useEffect(callback, dependencies) {
            const index = cursor++;
            const previous = hooks[index];
            if (previous && areDependenciesEqual(previous.dependencies, dependencies)) return;

            pendingEffects.push({ callback, dependencies, index, previous });
        }
    };

    return {
        react,
        createRunner(component) {
            return {
                render(props) {
                    cursor = 0;
                    pendingEffects = [];
                    const output = component(props);
                    const effects = pendingEffects;
                    pendingEffects = [];

                    effects.forEach(({ callback, dependencies, index, previous }) => {
                        previous?.cleanup?.();
                        const cleanup = callback();
                        hooks[index] = {
                            kind: 'effect',
                            dependencies,
                            cleanup: typeof cleanup === 'function' ? cleanup : null
                        };
                    });

                    return output;
                }
            };
        }
    };
}

function loadVinylMode() {
    const clock = createClock();
    const hooks = createHookRuntime();
    const fakeWindow = {
        Image: class {
            constructor() {
                this.complete = true;
                this.onload = null;
                this.onerror = null;
            }
        },
        clearTimeout: (id) => clock.clearTimeout(id),
        ivLyricsActiveLyricLineRenderer: null,
        matchMedia: () => ({ matches: false }),
        setTimeout: (callback, delay) => clock.setTimeout(callback, delay)
    };
    const context = {
        I18n: { t: (key) => key },
        Spicetify: { React: hooks.react },
        console,
        window: fakeWindow
    };
    const source = fs.readFileSync(path.join(__dirname, '..', 'VinylPlayerMode.js'), 'utf8')
        .replace(
            '    return Mode;',
            '    window.__ivLyricsClampVinylSeekPosition = clampVinylSeekPosition;\n    return Mode;'
        );

    vm.runInNewContext(source, context, { filename: 'VinylPlayerMode.js' });

    return {
        clock,
        clampVinylSeekPosition: fakeWindow.__ivLyricsClampVinylSeekPosition,
        runner: hooks.createRunner(fakeWindow.ivLyricsVinylPlayerMode)
    };
}

function createProps(track) {
    return {
        track,
        albumRadius: 18,
        isPlaying: true,
        position: 12000,
        duration: 180000,
        vinylSettings: {
            animations: true,
            centerRotation: true,
            lyricsEnabled: false
        }
    };
}

function getTrackPhase(tree) {
    const className = String(tree.props.className || '');
    return className.match(/\bis-track-([a-z-]+)\b/)?.[1] || 'idle';
}

function getVinylPlayerElement(tree) {
    const children = Array.isArray(tree.props.children)
        ? tree.props.children
        : [tree.props.children];
    return children.find((child) => child?.props?.className?.includes('ivlyrics-vinyl-player--immersive'));
}

function getCssBlock(css, marker) {
    const start = css.indexOf(marker);
    if (start < 0) return '';
    const openingBrace = css.indexOf('{', start);
    if (openingBrace < 0) return '';

    let depth = 0;
    for (let index = openingBrace; index < css.length; index += 1) {
        if (css[index] === '{') depth += 1;
        if (css[index] === '}') {
            depth -= 1;
            if (depth === 0) return css.slice(start, index + 1);
        }
    }
    return '';
}

test('tonearm seek leaves enough track tail for Spotify to advance naturally', () => {
    const { clampVinylSeekPosition: clampSeek } = loadVinylMode();

    assert.equal(clampSeek(-100, 180000), 0);
    assert.equal(clampSeek(90000, 180000), 90000);
    assert.equal(clampSeek(180000, 180000), 179500);
    assert.equal(clampSeek(999999, 180000), 179500);
    assert.equal(clampSeek(5000, 5000), 4750);
});

test('track snapshots never inherit the previous LP accent while extraction is pending', () => {
    const { runner } = loadVinylMode();
    const { runner: fallbackRunner } = loadVinylMode();
    const fallbackAccent = 'var(--spice-button-active, #ff809d)';
    const firstTrack = {
        uri: 'spotify:track:first',
        coverUrl: 'first.jpg',
        title: 'First',
        artist: 'Artist A',
        album: 'Album A',
        accent: '#336699'
    };
    const secondTrack = {
        uri: 'spotify:track:second',
        coverUrl: 'second.jpg',
        title: 'Second',
        artist: 'Artist B',
        album: 'Album B'
    };

    const fallbackTree = fallbackRunner.render(createProps(secondTrack));
    assert.equal(
        getVinylPlayerElement(fallbackTree).props.style['--iv-vinyl-accent'],
        fallbackAccent
    );

    runner.render(createProps(firstTrack));
    runner.render(createProps(secondTrack));
    let player = getVinylPlayerElement(runner.render(createProps(secondTrack)));

    assert.equal(player.props.incomingTrack.accent, fallbackAccent);

    const resolvedSecondTrack = { ...secondTrack, accent: '#aa3366' };
    runner.render(createProps(resolvedSecondTrack));
    player = getVinylPlayerElement(runner.render(createProps(resolvedSecondTrack)));

    assert.equal(player.props.incomingTrack.accent, '#aa3366');
});

test('an accent resolved after the LP emerges waits until handoff is complete', () => {
    const { clock, runner } = loadVinylMode();
    const fallbackAccent = 'var(--spice-button-active, #ff809d)';
    const firstTrack = {
        uri: 'spotify:track:first',
        coverUrl: 'first.jpg',
        title: 'First',
        artist: 'Artist A',
        album: 'Album A',
        accent: '#336699'
    };
    const secondTrack = {
        uri: 'spotify:track:second',
        coverUrl: 'second.jpg',
        title: 'Second',
        artist: 'Artist B',
        album: 'Album B'
    };

    runner.render(createProps(firstTrack));
    runner.render(createProps(secondTrack));
    runner.render(createProps(secondTrack));
    clock.advance(180 + 680 + 480 + 700);

    const resolvedSecondTrack = { ...secondTrack, accent: '#aa3366' };
    runner.render(createProps(resolvedSecondTrack));
    let player = getVinylPlayerElement(runner.render(createProps(resolvedSecondTrack)));
    assert.equal(player.props.incomingTrack.accent, fallbackAccent);

    clock.advance(720 + 360 + 96);
    runner.render(createProps(resolvedSecondTrack));
    player = getVinylPlayerElement(runner.render(createProps(resolvedSecondTrack)));

    assert.equal(player.props.incomingTrack, null);
    assert.equal(player.props.style['--iv-vinyl-accent'], '#aa3366');
});

test('track replacement fully sleeves and removes the old pair before the new album arrives', () => {
    const { clock, runner } = loadVinylMode();
    const firstTrack = {
        uri: 'spotify:track:first',
        coverUrl: 'first.jpg',
        title: 'First',
        artist: 'Artist A',
        album: 'Album A'
    };
    const secondTrack = {
        uri: 'spotify:track:second',
        coverUrl: 'second.jpg',
        title: 'Second',
        artist: 'Artist B',
        album: 'Album B'
    };

    runner.render(createProps(firstTrack));
    runner.render(createProps(secondTrack));
    let tree = runner.render(createProps(secondTrack));
    assert.equal(getTrackPhase(tree), 'record-clearing');

    clock.advance(179);
    tree = runner.render(createProps(secondTrack));
    assert.equal(getTrackPhase(tree), 'record-clearing');

    clock.advance(1);
    tree = runner.render(createProps(secondTrack));
    assert.equal(getTrackPhase(tree), 'record-sleeving');

    clock.advance(679);
    tree = runner.render(createProps(secondTrack));
    assert.equal(getTrackPhase(tree), 'record-sleeving');

    clock.advance(1);
    tree = runner.render(createProps(secondTrack));
    assert.equal(getTrackPhase(tree), 'album-departing');

    clock.advance(479);
    tree = runner.render(createProps(secondTrack));
    assert.equal(getTrackPhase(tree), 'album-departing');

    clock.advance(1);
    tree = runner.render(createProps(secondTrack));
    assert.equal(getTrackPhase(tree), 'album-arriving');

    clock.advance(700);
    tree = runner.render(createProps(secondTrack));
    assert.equal(getTrackPhase(tree), 'record-emerging');

    clock.advance(720);
    tree = runner.render(createProps(secondTrack));
    assert.equal(getTrackPhase(tree), 'record-raised');

    clock.advance(360);
    tree = runner.render(createProps(secondTrack));
    assert.equal(getTrackPhase(tree), 'handoff');

    clock.advance(96);
    tree = runner.render(createProps(secondTrack));
    assert.equal(getTrackPhase(tree), 'idle');
});

test('track replacement CSS fully contains the outgoing LP in both layouts', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

    assert.match(css, /is-track-record-clearing[\s\S]*?translate3d\(26%, -1%, 0\)/);
    assert.match(css, /is-track-record-sleeving[\s\S]*?translate3d\(-82%, 0, 0\)/);
    assert.match(css, /ivlyrics-vinyl-player--portrait-layout\.is-track-record-clearing[\s\S]*?translate3d\(0, 64%, 0\)/);
    assert.match(css, /ivlyrics-vinyl-player--portrait-layout:is\([\s\S]*?translate3d\(0, -40%, 0\)/);
    assert.match(
        css,
        /is-track-album-departing \.ivlyrics-vinyl-outgoing-pair[\s\S]*?fullscreen-vinyl-old-pair-depart/
    );
});

test('handoff reveals an already-settled player without replaying the LP transition', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
    const hiddenOutgoingRule = css.match(
        /\.ivlyrics-vinyl-player:is\(\s*\.is-track-album-arriving,[\s\S]*?\) \.ivlyrics-vinyl-outgoing-pair \{[\s\S]*?\}/
    )?.[0] || '';
    const sleevedRecordRule = css.match(
        /\/\* The old LP clears the sleeve[\s\S]*?\.ivlyrics-vinyl-player:is\([\s\S]*?\) \.ivlyrics-vinyl-record-shell \{[\s\S]*?\}/
    )?.[0] || '';

    assert.ok(hiddenOutgoingRule);
    assert.doesNotMatch(hiddenOutgoingRule, /is-track-handoff/);
    assert.ok(sleevedRecordRule);
    assert.doesNotMatch(sleevedRecordRule, /is-track-handoff/);
    assert.match(
        css,
        /\.is-track-handoff \.ivlyrics-vinyl-outgoing-pair \{[\s\S]*?opacity: 1;[\s\S]*?animation: none;/
    );
    assert.match(
        css,
        /\.is-track-handoff \.ivlyrics-vinyl-sleeve,[\s\S]*?\.is-track-handoff \.ivlyrics-vinyl-record-shell \{[\s\S]*?transition: none;/
    );
    assert.match(
        css,
        /\.is-track-handoff \.ivlyrics-vinyl-outgoing-pair \.ivlyrics-vinyl-label,[\s\S]*?\.ivlyrics-vinyl-label-arc-text \{[\s\S]*?transition: none;/
    );
});

test('incoming LP clears its clip before handoff and shares one spin phase', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

    assert.match(css, /--iv-vinyl-incoming-record-clear-clip: inset\(-16%\);/);
    assert.match(
        css,
        /\.is-track-handoff \.ivlyrics-vinyl-incoming-record-shell \{[\s\S]*?clip-path: var\(--iv-vinyl-incoming-record-clear-clip\);/
    );
    assert.match(
        css,
        /\.ivlyrics-vinyl-visual-group \{[\s\S]*?animation: ivlyrics-vinyl-spin-clock 6s linear infinite;/
    );
    assert.match(
        css,
        /\.ivlyrics-vinyl-motion \{[\s\S]*?transform: rotate\(var\(--iv-vinyl-spin-angle\)\);/
    );
    assert.match(
        css,
        /\.is-center-rotation-enabled \.ivlyrics-vinyl-label \{[\s\S]*?rotate\(var\(--iv-vinyl-spin-angle\)\)/
    );
});

test('track replacement keeps large moving layers on compositor-friendly properties', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
    const immersiveRule = getCssBlock(css, '.ivlyrics-vinyl-player--immersive {');
    const transitionKeyframes = [
        'fullscreen-vinyl-cover-arrive-landscape',
        'fullscreen-vinyl-record-emerge-landscape',
        'fullscreen-vinyl-record-raise-landscape',
        'fullscreen-vinyl-cover-arrive-portrait',
        'fullscreen-vinyl-record-emerge-portrait',
        'fullscreen-vinyl-record-raise-portrait'
    ];

    assert.doesNotMatch(immersiveRule, /filter:/);
    assert.match(
        css,
        /\.ivlyrics-vinyl-incoming-record-shell \{[\s\S]*?will-change: transform, opacity, clip-path;/
    );

    transitionKeyframes.forEach((name) => {
        const block = getCssBlock(css, `@keyframes ${name}`);
        assert.ok(block, `${name} should exist`);
        assert.doesNotMatch(block, /filter:/, `${name} should not animate filters`);
    });
});

test('late LP accent updates interpolate label details instead of snapping', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

    assert.match(
        css,
        /\.ivlyrics-vinyl-label-ring \{[\s\S]*?transition: border-color 420ms ease;/
    );
    assert.match(
        css,
        /\.ivlyrics-vinyl-label-arc-text \{[\s\S]*?transition: fill 420ms ease;/
    );
});

test('fullscreen LP seek clears correction and clamps against the live player duration', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'FullscreenOverlay.js'), 'utf8');

    assert.match(
        source,
        /onSeek: \(nextPosition\) => \{[\s\S]*?clearSafePlayerProgressCorrection[\s\S]*?Player\.getDuration[\s\S]*?clampSeekPositionToLiveDuration/
    );
});
