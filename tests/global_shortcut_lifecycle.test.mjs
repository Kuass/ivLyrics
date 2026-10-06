import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the complete shortcut module with deterministic history and timers.
// No Spotify instance or browser UI is required; the override runs the same
// cases against a saved, unchanged production revision.
const source = readFileSync(process.env.IVLYRICS_SHORTCUT_SOURCE_DIR
    ? resolve(process.env.IVLYRICS_SHORTCUT_SOURCE_DIR, 'GlobalShortcuts.js')
    : new URL('../GlobalShortcuts.js', import.meta.url), 'utf8');

function harness(initialPath = '/collection') {
    let now = 0, timerId = 0, toggles = 0;
    const timers = new Map(), bindings = new Map(), nodes = new Map();
    const storage = new Map(), historyListeners = new Set(), pushes = [];
    const eventTarget = () => {
        const listeners = new Map();
        return {
            addEventListener(name, callback) {
                if (!listeners.has(name)) listeners.set(name, new Set());
                listeners.get(name).add(callback);
            },
            dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); },
        };
    };
    const document = {
        ...eventTarget(), activeElement: null, visibilityState: 'visible',
        getElementById: id => nodes.get(id) || null,
        querySelector: () => null,
        body: { classList: { remove() {} } },
    };
    const window = eventTarget();
    const history = {
        location: { pathname: initialPath },
        listen(callback) { historyListeners.add(callback); return () => historyListeners.delete(callback); },
        push(pathname) {
            pushes.push(pathname);
            const location = { pathname };
            history.location = location;
            for (const callback of historyListeners) callback(location, 'PUSH');
        },
    };
    historyListeners.add((location, action) => window.beforeHistory?.(location, action));
    history.pop = location => {
        history.location = location;
        for (const callback of historyListeners) callback(location, 'POP');
    };
    const Spicetify = {
        Platform: { History: history },
        LocalStorage: { get: key => storage.get(key), set: (key, value) => storage.set(key, value) },
        Mousetrap: class {
            bind(key, callback) { bindings.set(key, callback); }
            unbind(key) { bindings.delete(key); }
        },
    };
    vm.runInNewContext(source, {
        window, document, Spicetify,
        CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
        console: { debug() {}, warn() {} },
        setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        setInterval() { throw new Error('Spicetify is already initialized'); }, clearInterval() {},
    });
    return {
        window, document, history, timers, pushes, bindings,
        get toggles() { return toggles; },
        activate() { bindings.get('f12')({ preventDefault() {} }); },
        clickPlaybar() { window.dispatchEvent({ type: 'ivLyrics', detail: { type: 'fullscreen-toggle' } }); },
        ready() { window.lyricContainer = { state: { isFullscreen: false }, toggleFullscreen() { toggles++; this.state.isFullscreen = !this.state.isFullscreen; } }; },
        addFullscreenNode() { nodes.set('lyrics-fullscreen-container', { remove() { nodes.delete('lyrics-fullscreen-container'); } }); },
        hasFullscreenNode() { return nodes.has('lyrics-fullscreen-container'); },
        close() { window.dispatchEvent({ type: 'ivLyrics:fullscreen-closed' }); },
        advance(ms) {
            const end = now + ms;
            while (true) {
                const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
                if (!next) break;
                now = next[1].at; timers.delete(next[0]); next[1].callback();
            }
            now = end;
        },
    };
}

test('newer navigation cancels a delayed fullscreen entry before the container is ready', () => {
    const h = harness();
    h.activate();
    assert.equal(h.history.location.pathname, '/ivLyrics');
    h.history.push('/search');
    h.ready();
    h.advance(3000);
    assert.equal(h.toggles, 0);
    assert.equal(h.history.location.pathname, '/search');
    assert.equal(h.window._ivLyricsPreviousPath, null);
    assert.equal(h.timers.size, 0);
});

test('leaving and re-entering the lyrics page does not revive an obsolete entry request', () => {
    const h = harness();
    h.activate();
    h.history.push('/search');
    h.history.push('/ivLyrics');
    h.ready();
    h.advance(3000);
    assert.equal(h.toggles, 0);
});

test('repeated shortcut and playbar activations share one pending fullscreen entry', () => {
    const h = harness();
    h.activate(); h.clickPlaybar(); h.activate();
    h.advance(200);
    h.clickPlaybar();
    h.ready();
    h.advance(3000);
    assert.equal(h.toggles, 1);
    assert.equal(h.window.lyricContainer.state.isFullscreen, true);
    assert.deepEqual(h.pushes, ['/ivLyrics']);
    h.close();
    assert.equal(h.history.location.pathname, '/collection');
    assert.equal(h.window._ivLyricsPreviousPath, null);
});

test('delayed entry is bounded and an expired request forgets its return location', () => {
    const h = harness();
    h.activate();
    h.advance(3000);
    assert.equal(h.timers.size, 0);
    assert.equal(h.window._ivLyricsPreviousPath, null);
    h.ready();
    h.close();
    assert.equal(h.history.location.pathname, '/ivLyrics');
});

test('navigating away from fullscreen retains the chosen destination during orphan cleanup', () => {
    const h = harness();
    h.activate(); h.ready(); h.advance(200);
    assert.equal(h.toggles, 1);
    h.addFullscreenNode();
    h.history.push('/playlist/new-destination');
    h.advance(3000);
    assert.equal(h.history.location.pathname, '/playlist/new-destination');
    assert.equal(h.hasFullscreenNode(), false);
    assert.equal(h.window.lyricContainer.state.isFullscreen, false);
    assert.equal(h.window._ivLyricsPreviousPath, null);
});

test('a new entry after cancellation returns to its own starting page', () => {
    const h = harness();
    h.activate();
    h.history.push('/search');
    h.activate();
    h.ready();
    h.advance(3000);
    assert.equal(h.toggles, 1);
    h.close();
    assert.equal(h.history.location.pathname, '/search');
});

test('normal delayed entry returns to the starting page on close', () => {
    const h = harness('/playlist/original');
    h.activate();
    h.advance(300);
    h.ready();
    h.advance(100);
    assert.equal(h.toggles, 1);
    h.close();
    assert.equal(h.history.location.pathname, '/playlist/original');
    assert.equal(h.window._ivLyricsPreviousPath, null);
});

test('ready lyrics-page activations still toggle immediately each time', () => {
    const h = harness('/ivLyrics');
    h.ready();
    h.activate(); h.activate();
    assert.equal(h.toggles, 2);
    assert.equal(h.window.lyricContainer.state.isFullscreen, false);
    assert.deepEqual(h.pushes, []);
});

test('a delayed entry originating on the lyrics page has no return navigation', () => {
    const h = harness('/ivLyrics');
    h.clickPlaybar(); h.ready(); h.advance(200);
    assert.equal(h.toggles, 1);
    h.close();
    assert.deepEqual(h.pushes, []);
});

test('close on the lyrics page cancels pending entry without a return path', () => {
    const h = harness('/ivLyrics');
    h.activate();
    h.close();
    h.ready();
    h.advance(3000);
    assert.equal(h.toggles, 0, 'an explicitly closed request must not reopen fullscreen');
});

test('close during a cross-page pending entry returns and cancels', () => {
    const h = harness('/collection');
    h.activate();
    h.close();
    h.ready();
    h.advance(3000);
    assert.equal(h.toggles, 0);
    assert.equal(h.history.location.pathname, '/collection');
});

test('synchronous history redirect away and back invalidates the original entry', () => {
    const h = harness();
    let redirected = false;
    h.history.listen(({ pathname }) => {
        if (pathname === '/ivLyrics' && !redirected) {
            redirected = true;
            h.history.push('/search');
            h.history.push('/ivLyrics');
        }
    });
    h.activate();
    h.ready();
    h.advance(3000);
    assert.equal(h.toggles, 0, 'navigation in the initial History.push must cancel too');
});

test('a synchronous history callback cannot toggle twice after readiness', () => {
    const h = harness();
    let entered = false;
    h.history.listen(({ pathname }) => {
        if (pathname === '/ivLyrics' && !entered) {
            entered = true;
            h.ready();
            h.clickPlaybar();
        }
    });
    h.activate();
    h.advance(3000);
    assert.equal(h.toggles, 1, 'the initial push is part of the pending entry');
    assert.equal(h.window.lyricContainer.state.isFullscreen, true);
});

test('a canceled callback already queued cannot mutate a newer request', () => {
    const h = harness();
    h.activate();
    const callback = [...h.timers.values()].find(timer => timer.at === 200).callback;
    h.history.push('/search');
    h.activate();
    h.ready();
    callback();
    assert.equal(h.toggles, 0);
    h.advance(3000);
    assert.equal(h.toggles, 1);
    h.close();
    assert.equal(h.history.location.pathname, '/search');
});

test('clearing return state before push preserves a reentrant new request', () => {
    const h = harness();
    h.activate(); h.ready(); h.advance(200);
    let reopened = false;
    h.history.listen(({ pathname }) => {
        if (pathname === '/collection' && !reopened) {
            reopened = true;
            delete h.window.lyricContainer;
            h.activate();
        }
    });
    h.close();
    h.ready(); h.advance(3000);
    h.close();
    assert.equal(h.history.location.pathname, '/collection');
    assert.equal(h.window._ivLyricsPreviousPath, null);
});

test('focus and visibility cleanup cancel navigation even without a history notification', () => {
    for (const trigger of ['focus', 'visibilitychange']) {
        const h = harness();
        h.activate();
        h.history.location = { pathname: '/search' };
        (trigger === 'focus' ? h.window : h.document).dispatchEvent({ type: trigger });
        h.history.location = { pathname: '/ivLyrics' };
        h.ready(); h.advance(3000);
        assert.equal(h.toggles, 0);
    }
});

test('page-ui-only fullscreen navigation forgets return path without an orphan node', () => {
    const h = harness();
    h.activate(); h.ready(); h.advance(200);
    h.history.push('/search');
    h.close(); h.advance(3000);
    assert.equal(h.history.location.pathname, '/search');
    assert.equal(h.window._ivLyricsPreviousPath, null);
});

test('listener payload detects an away event even after an earlier listener navigates back', () => {
    const h = harness();
    h.activate();
    h.window.beforeHistory = ({ pathname }) => {
        if (pathname === '/search') h.history.push('/ivLyrics');
    };
    h.history.push('/search');
    h.ready();
    h.advance(3000);
    assert.equal(h.toggles, 0, 'the /search event is newer navigation despite reentrant return');
});

test('off-page navigation wins over reentrant entry during the same history dispatch', () => {
    const h = harness();
    h.activate(); h.ready(); h.advance(200);
    let reopened = false;
    h.window.beforeHistory = ({ pathname }) => {
        if (pathname === '/collection' && !reopened) {
            reopened = true;
            delete h.window.lyricContainer;
            h.activate();
        }
    };
    h.close();
    h.ready(); h.advance(3000);
    assert.equal(h.toggles, 1, 'navigation cancels ambiguous reentrant fullscreen intent');
    assert.equal(h.window._ivLyricsPreviousPath, null);
    h.activate();
    assert.equal(h.toggles, 2, 'a later user activation still works normally');
    h.close();
    assert.equal(h.history.location.pathname, '/ivLyrics');
});

test('a synchronous close while entering cancels before initial scheduling', () => {
    const h = harness();
    let closed = false;
    h.history.listen(({ pathname }) => {
        if (pathname === '/ivLyrics' && !closed) { closed = true; h.close(); }
    });
    h.activate(); h.ready(); h.advance(3000);
    assert.equal(h.toggles, 0);
    assert.equal(h.history.location.pathname, '/collection');
    assert.equal(h.timers.size, 0);
});

test('a throwing History.push does not block a subsequent entry', () => {
    const h = harness();
    const originalPush = h.history.push;
    h.history.push = () => { throw new Error('navigation failed'); };
    assert.throws(() => h.activate(), /navigation failed/);
    assert.equal(h.window._ivLyricsPreviousPath, null);
    h.history.push = originalPush;
    h.activate(); h.ready(); h.advance(3000);
    assert.equal(h.toggles, 1);
    h.close();
    assert.equal(h.history.location.pathname, '/collection');
});

test('a callback already queued before close cannot reopen fullscreen on the lyrics page', () => {
    const h = harness('/ivLyrics');
    h.activate();
    const callback = [...h.timers.values()].find(timer => timer.at === 200).callback;
    h.close(); h.ready(); callback(); h.advance(3000);
    assert.equal(h.toggles, 0);
    assert.deepEqual(h.pushes, []);
    assert.equal(h.timers.size, 0);
});


test('Back/Forward to the same stored location cannot revive an old entry', () => {
    const h = harness();
    h.activate();
    const lyricsLocation = h.history.location;
    h.window.beforeHistory = ({ pathname }) => {
        if (pathname === '/search') h.history.pop(lyricsLocation);
    };
    h.history.push('/search');
    h.ready(); h.advance(3000);
    assert.equal(h.toggles, 0);
    assert.equal(h.window._ivLyricsPreviousPath, null);
});

test('Back/Forward between lyrics locations supersedes delayed fullscreen entry', () => {
    const h = harness('/ivLyrics');
    h.activate();
    h.history.pop({ pathname: '/ivLyrics', key: 'previous-history-entry' });
    h.ready(); h.advance(3000);
    assert.equal(h.toggles, 0);
    assert.deepEqual(h.pushes, []);
});
