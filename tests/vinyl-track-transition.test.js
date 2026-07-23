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
    const source = fs.readFileSync(path.join(__dirname, '..', 'VinylPlayerMode.js'), 'utf8');

    vm.runInNewContext(source, context, { filename: 'VinylPlayerMode.js' });

    return {
        clock,
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

    assert.match(css, /is-track-record-sleeving[\s\S]*?translate3d\(-82%, 0, 0\)/);
    assert.match(css, /ivlyrics-vinyl-player--portrait-layout:is\([\s\S]*?translate3d\(0, -40%, 0\)/);
    assert.match(
        css,
        /is-track-album-departing \.ivlyrics-vinyl-outgoing-pair[\s\S]*?fullscreen-vinyl-old-pair-depart/
    );
});
