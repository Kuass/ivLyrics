import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../FullscreenOverlay.js', import.meta.url), 'utf8');
const start = source.indexOf('    const CrossfadeAlbumImage =');
const end = source.indexOf('    // Main Overlay Component', start);
const createHarness = () => {
    const hooks = [], pending = [], requests = [], timers = new Map();
    let index = 0, nextTimer = 0, component;
    const context = vm.createContext({
        Image: class { constructor() { requests.push(this); } async decode() {} },
        setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
        clearTimeout(id) { timers.delete(id); },
        useState(initial) {
            const i = index++;
            if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
            return [hooks[i].value, update => { hooks[i].value = typeof update === 'function' ? update(hooks[i].value) : update; }];
        },
        useEffect(fn, deps) {
            const i = index++, prior = hooks[i];
            if (prior && deps.every((dep, j) => Object.is(dep, prior.deps[j]))) return;
            prior?.cleanup?.();
            const hook = hooks[i] = { deps };
            pending.push(() => { hook.cleanup = fn(); });
        },
        react: { createElement: (tag, props, ...children) => ({ tag, props, children: children.filter(Boolean) }) },
    });
    vm.runInContext(`${source.slice(start, end)}; globalThis.component = CrossfadeAlbumImage;`, context);
    component = context.component;
    return {
        requests, timers,
        render(src) { index = 0; const tree = component({ src, className: 'album', style: { width: '100%' } }); pending.splice(0).forEach(fn => fn()); return tree; },
        dispose() { hooks.forEach(hook => hook?.cleanup?.()); },
    };
};

test('keeps the displayed cover until the replacement has loaded and decoded, then removes the old layer', async () => {
    const h = createHarness();
    h.render('a');
    assert.equal(h.render('b').children[0].props.src, 'a');
    await h.requests[0].onload();
    let tree = h.render('b');
    assert.deepEqual(tree.children.map(child => child.props.src), ['a', 'b']);
    assert.match(tree.children[1].props.className, /is-entering/);
    [...h.timers.values()].forEach(fn => fn());
    tree = h.render('b');
    assert.deepEqual(tree.children.map(child => child.props.src), ['b']);
    assert.equal(h.requests.length, 1);
    h.dispose();
});

test('ignores a stale decode when tracks are skipped rapidly', async () => {
    const h = createHarness();
    h.render('a'); h.render('b');
    let resolve;
    h.requests[0].decode = () => new Promise(done => { resolve = done; });
    const staleLoad = h.requests[0].onload();
    h.render('c');
    await h.requests[1].onload();
    resolve(); await staleLoad;
    assert.deepEqual(h.render('c').children.map(child => child.props.src), ['a', 'c']);
    h.dispose();
    assert.equal(h.timers.size, 0);
});

test('retains the last cover when decoding fails and cancels loads on unmount', async () => {
    const h = createHarness();
    h.render('a'); h.render('b');
    h.requests[0].decode = async () => { throw new Error('bad image'); };
    await h.requests[0].onload();
    assert.deepEqual(h.render('b').children.map(child => child.props.src), ['a']);
    h.render('c'); h.dispose();
    assert.equal(h.requests[1].onload, null);
});
