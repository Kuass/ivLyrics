import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { environment } from './helpers/panel_placement_harness.mjs';
import { extraction } from './helpers/panel_placement_source.mjs';
import { test } from 'node:test';

// One fixed desired oracle runs unchanged against the working source or
// PANEL_PLACEMENT_SOURCE. React does not execute the component in this fixture.
const cases = [];
async function scenario(name, options, body) {
  await test(name, async () => {
    const e = environment(options), observations = [], contracts = [];
    const observe = (label, value) => observations.push({ label, value });
    const contract = (label, pass, observed, desired) => contracts.push({ label, pass, observed, desired });
    let failure;
    try { await body(e, observe, contract); e.drain(); }
    catch (error) { failure = error; }
    const settled = e.stats();
    try { e.cleanup(); } catch (error) { failure ||= error; }
    const result = { name, observations, settled, afterCleanup: e.stats(), contracts, trace: e.trace };
    cases.push(result);
    if (failure) { result.error = String(failure); throw failure; }
    assert.deepEqual(contracts.filter(c => !c.pass).map(c => c.label), [], 'desired placement contract');
  });
}
const underHeader = (e, header = e.info) => e.container()?.parentElement === e.grid && e.container()?.previousElementSibling === header;
const bottom = e => { assert.equal(e.container()?.parentElement, e.panel); assert.equal(e.container()?.previousElementSibling, e.queue); };

await scenario('unmapped stable test-id header: initial insertion', { mapped: false }, (e, observe, contract) => {
  assert.equal(e.panel.querySelector('.main-nowPlayingView-contextItemInfo'), null);
  assert.equal(e.panel.querySelector('.main-nowPlayingView-section'), null);
  assert.ok(e.panel.querySelector('[data-testid="minimized-track-visual-enhancement"]'));
  assert.equal(e.target.findNowPlayingPanel(), e.panel);
  e.target.setupObserver(); e.target.insertPanelLyrics();
  observe('immediate position before any timer', e.position());
  e.drain(); assert.equal(e.stats().roots, 1);
  observe('settled position', e.position());
  contract('stable test-id header gives a slot below track info', underHeader(e), e.position(), { parent: 'grid', previous: 'info' });
});

for (const lateMapped of [false, true]) await scenario(`late ${lateMapped ? 'mapped' : 'unmapped'} header: observer and reinsertion`, { mapped: false, withHeader: false }, (e, observe, contract) => {
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain(); bottom(e);
  const card = e.container(), root = card.__ivLyricsPanelRoot;
  const info = e.addHeader({ mapped: lateMapped }); e.deliverObservers(); e.drain();
  assert.equal(e.container(), card); assert.equal(e.container().__ivLyricsPanelRoot, root);
  observe('after header mutation and full scheduler drain', e.position());
  contract('observer repairs the already-rendered card after late header', underHeader(e, info), e.position(), { parent: 'grid', previous: 'info' });
  e.target.insertPanelLyrics(); e.drain(); assert.equal(e.stats().roots, 1);
  observe('explicit reinsertion reuses root', e.position());
  contract('explicit insertion preserves repaired placement', underHeader(e, info), e.position(), { parent: 'grid', previous: 'info' });
});

for (const mapped of [true, false]) await scenario(`moved ${mapped ? 'mapped' : 'unmapped'} card: observer and reinsertion`, { mapped }, (e, observe, contract) => {
  e.target.insertPanelLyrics(); e.drain();
  if (!mapped) e.grid.appendChild(e.container()); // Fixture prepares a correctly placed card; this is not production repair.
  assert.equal(underHeader(e), true); const card = e.container(), root = card.__ivLyricsPanelRoot;
  e.target.setupObserver(); e.panel.appendChild(card); e.deliverObservers(); e.drain();
  observe('after card moved to bottom and observer delivery', e.position());
  contract('observer restores a moved rendered card', underHeader(e), e.position(), { parent: 'grid', previous: 'info' });
  e.target.insertPanelLyrics(); e.drain(); assert.equal(e.container(), card); assert.equal(card.__ivLyricsPanelRoot, root);
  assert.equal(e.stats().roots, 1); observe('explicit reinsertion preserves root identity', e.position());
  contract('explicit insertion keeps the repaired moved card', underHeader(e), e.position(), { parent: 'grid', previous: 'info' });
});

await scenario('mapped context item places after track info', {}, (e, observe, contract) => {
  const trailing = e.element('grid-trailing'); e.grid.appendChild(trailing);
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain();
  assert.ok(underHeader(e)); assert.equal(e.container().nextElementSibling, trailing);
  observe('mapped slot', e.position()); contract('mapped slot remains correct', underHeader(e), e.position(), { parent: 'grid', previous: 'info' });
});
await scenario('mapped related-section fallback without header', { withHeader: false }, (e, observe, contract) => {
  e.target.insertPanelLyrics(); e.drain(); assert.equal(e.container().nextElementSibling, e.aboutArtist);
  observe('fallback position', e.position()); contract('mapped section remains usable', e.container().nextElementSibling === e.aboutArtist, e.position(), { parent: 'panel', next: 'aboutArtist' });
});
await scenario('correct position: observer is idle and React root is reused', {}, (e, observe, contract) => {
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain();
  const card = e.container(), root = card.__ivLyricsPanelRoot, mutations = e.trace.filter(x => x.event.startsWith('dom-')).length;
  e.deliverObservers(); e.target.insertPanelLyrics(); e.drain();
  assert.equal(e.container(), card); assert.equal(card.__ivLyricsPanelRoot, root); assert.equal(e.stats().roots, 1);
  assert.equal(e.trace.filter(x => x.event.startsWith('dom-')).length, mutations); assert.ok(underHeader(e));
  observe('root reused without DOM relocation', e.stats()); contract('current correct placement is stable', underHeader(e), e.position(), { parent: 'grid', previous: 'info' });
});
await scenario('container outside panel: unmount and recreate', {}, (e, observe) => {
  e.target.insertPanelLyrics(); e.drain(); const old = e.container(), oldRoot = old.__ivLyricsPanelRoot;
  e.document.body.appendChild(old); e.target.setupObserver(); e.sidebar.appendChild(e.element('trigger')); e.deliverObservers(); e.drain();
  assert.notEqual(e.container(), old); assert.equal(old.isConnected, false); assert.equal(oldRoot.unmounts, 1);
  assert.equal(old.__ivLyricsPanelRoot, undefined); assert.equal(e.stats().roots, 2); assert.ok(underHeader(e)); observe('replacement', e.position());
});
await scenario('native gate: cached native removes card', {}, (e, observe) => {
  e.target.insertPanelLyrics(); e.drain(); const root = e.roots[0];
  e.target.seedNative(e.Spicetify.Player.data.item.uri, true); e.target.insertPanelLyrics();
  assert.equal(e.container(), null); assert.equal(root.unmounts, 1); assert.equal(e.requests.length, 0); observe('native card suppression', e.stats());
});
await scenario('native gate: pending then missing lyrics resumes observer and insertion', {}, async (e, observe) => {
  e.Spicetify.Player.data.item.uri = 'spotify:track:fixtureB'; e.target.insertPanelLyrics(); e.target.insertPanelLyrics();
  assert.equal(e.container(), null); assert.equal(e.requests.length, 1); assert.equal(e.stats().timers, 0);
  await e.resolveNative(0, false); e.drain(); assert.ok(underHeader(e)); assert.equal(e.stats().activeObservers, 1);
  observe('pending request settles missing', { ...e.position(), requests: e.requests.length });
});
await scenario('native gate: pending then native lyrics tears down observer', {}, async (e, observe) => {
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain();
  e.Spicetify.Player.data.item.uri = 'spotify:track:fixtureB'; const old = e.container(); e.target.insertPanelLyrics();
  assert.equal(e.container(), old); await e.resolveNative(0, true); e.drain();
  assert.equal(e.container(), null); assert.equal(e.stats().activeObservers, 0); assert.equal(e.moduleState.panelObserver, null); observe('native resolution removes and pauses', e.stats());
});
await scenario('native gate: stale URI resolution does not change current card', {}, async (e, observe) => {
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain(); const card = e.container(), observer = e.moduleState.panelObserver;
  e.Spicetify.Player.data.item.uri = 'spotify:track:fixtureB'; e.target.insertPanelLyrics();
  e.Spicetify.Player.data.item.uri = 'spotify:track:fixtureA'; await e.resolveNative(0, true); e.drain();
  assert.equal(e.container(), card); assert.equal(e.moduleState.panelObserver, observer); assert.equal(e.stats().timers, 0); observe('stale native response ignored', e.position());
});
await scenario('native preference disabled: bypass request', {}, (e, observe) => {
  e.storage.set('ivLyrics:visual:panel-lyrics-only-when-spotify-missing', 'false'); e.Spicetify.Player.data.item.uri = 'spotify:track:fixtureB';
  e.target.insertPanelLyrics(); e.drain(); assert.ok(underHeader(e)); assert.equal(e.requests.length, 0); observe('preference bypass', e.position());
});
for (const page of ['/ivLyrics', '/ivLyrics/nested', 'marker']) await scenario(`ivLyrics suppression: ${page}`, {}, (e, observe) => {
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain();
  if (page === 'marker') e.sidebar.appendChild(e.element('ivlyrics-page', { testId: 'ivlyrics-page' }));
  else { e.Spicetify.Platform.History.location.pathname = page; e.sidebar.appendChild(e.element('route-mutation')); }
  e.deliverObservers(); e.drain(); assert.equal(e.container(), null);
  e.target.insertPanelLyrics(); e.drain(); assert.equal(e.container(), null); observe('route and observer suppression', e.stats());
});
await scenario('Starry Night: route, duplicate guard, switch back, cleanup', {}, (e, observe) => {
  e.target.insertPanelLyrics(); e.drain(); const panelRoot = e.roots[0];
  const theme = e.element('starry', { classes: ['starrynight-bg-container'] }); const bar = e.element('bar', { classes: ['Root__now-playing-bar'] });
  e.document.body.append(theme, bar); e.target.insertPanelLyrics(); e.drain(); assert.equal(e.container(), null); assert.equal(panelRoot.unmounts, 1);
  const barCard = bar.querySelector('.ivlyrics-nowplaying-bar-lyrics'), barRoot = e.roots[1]; assert.ok(barCard);
  e.target.insertPanelLyrics(); assert.equal(bar.children.length, 1); assert.equal(e.stats().roots, 2);
  assert.equal(e.document.body.classList.contains('ivlyrics-starrynight-theme'), true);
  theme.remove(); e.target.insertPanelLyrics(); e.drain(); assert.ok(underHeader(e)); assert.equal(barCard.isConnected, false); assert.equal(barRoot.unmounts, 1);
  assert.equal(e.document.body.classList.contains('ivlyrics-starrynight-theme'), false);
  e.target.removePanelLyrics(); assert.equal(e.container(), null); assert.equal(e.target.snapshot().lyricsRoot, null); observe('routing and roots', e.stats());
});
await scenario('Starry Night without bar falls back to panel', {}, (e, observe) => {
  e.document.body.append(e.element('starry', { classes: ['starrynight-bg-container'] })); e.target.insertPanelLyrics(); e.drain(); assert.ok(underHeader(e)); observe('fallback position', e.position());
});
await scenario('insert timer: replacement, cancellation, module-state ownership', {}, (e, observe) => {
  e.target.scheduleInsertPanelLyrics(100); const first = e.moduleState.insertTimer; e.target.scheduleInsertPanelLyrics(200);
  assert.notEqual(first, e.moduleState.insertTimer); assert.equal(e.stats().timers, 1); e.advance(199); assert.equal(e.container(), null);
  e.target.clearInsertTimer(); e.advance(1); assert.equal(e.container(), null); assert.equal(e.moduleState.insertTimer, null);
  e.target.scheduleInsertPanelLyrics(0); e.drain(); assert.ok(underHeader(e)); assert.equal(e.moduleState.insertTimer, null); observe('timer state settled', e.stats());
});
await scenario('observer: sidebar scope, disconnected root reconnection, native pause/resume', {}, (e, observe) => {
  e.target.setupObserver(); let observer = e.moduleState.panelObserver; assert.equal(observer.__ivLyricsRoot, e.sidebarParent);
  e.document.body.append(e.element('outside-sidebar')); e.deliverObservers(); assert.equal(e.stats().timers, 0);
  e.sidebar.append(e.element('inside-sidebar')); e.deliverObservers(); assert.equal(e.stats().timers, 1); e.drain(); assert.ok(underHeader(e));
  e.sidebarParent.remove(); const replacementParent = e.element('replacement-parent'); e.document.body.append(replacementParent); replacementParent.append(e.sidebar);
  e.target.ensureObserverRoot(); assert.equal(observer.root, null); observer = e.moduleState.panelObserver; assert.equal(observer.__ivLyricsRoot, replacementParent);
  e.target.syncObserverToNativeLyrics(true); assert.equal(e.moduleState.panelObserver, null);
  e.target.syncObserverToNativeLyrics(false); assert.equal(e.moduleState.panelObserver.__ivLyricsRoot, replacementParent);
  e.target.teardownObserver(); assert.equal(e.moduleState.panelObserver, null); observe('observer ownership and scope', e.stats());
});
await scenario('observer: body fallback upgrades when sidebar appears', { withSidebar: false }, (e, observe) => {
  e.target.setupObserver(); const old = e.moduleState.panelObserver; assert.equal(old.__ivLyricsRoot, e.document.body);
  e.document.body.append(e.sidebarParent); e.sidebarParent.append(e.sidebar); e.sidebar.append(e.panel); e.target.ensureObserverRoot();
  assert.equal(old.root, null); assert.equal(e.moduleState.panelObserver.__ivLyricsRoot, e.sidebarParent);
  e.target.insertPanelLyrics(); e.drain(); observe('fallback upgraded', e.stats());
});
await scenario('observer sync respects panel-disabled setting', {}, (e, observe) => {
  e.storage.set('ivLyrics:visual:panel-lyrics-enabled', 'false'); e.target.syncObserverToNativeLyrics(false); assert.equal(e.moduleState.panelObserver, null); observe('disabled sync remains idle', e.stats());
});
await scenario('empty rendered root: existing verifier retries once then settles', { emptyRenders: 1 }, (e, observe) => {
  e.target.insertPanelLyrics(); const empty = e.container(); assert.equal(e.position().rendered, false); e.advance(299); assert.equal(e.container(), empty);
  e.advance(1); assert.equal(empty.isConnected, false); assert.equal(e.container(), null); e.advance(100); assert.ok(underHeader(e)); assert.equal(e.position().rendered, true);
  e.drain(); assert.equal(e.stats().roots, 2); assert.equal(e.roots[0].unmounts, 1); observe('one empty render recovery', e.stats());
});
await scenario('disconnected verifier callback drains without reinsertion', {}, (e, observe) => {
  e.target.insertPanelLyrics(); e.target.removePanelLyrics(); e.drain(); assert.equal(e.container(), null); assert.equal(e.stats().roots, 1); observe('detached timer no-op', e.stats());
});
await scenario('legacy React render and unmount branch', { reactMode: 'legacy' }, (e, observe) => {
  e.target.insertPanelLyrics(); e.drain(); const card = e.container(); assert.ok(underHeader(e)); assert.equal(e.target.snapshot().lyricsRoot, card);
  e.target.insertPanelLyrics(); e.drain(); assert.equal(e.container(), card); e.target.removePanelLyrics(); assert.equal(e.stats().legacyUnmounts, 1); observe('legacy branch', e.stats());
});
await scenario('missing panel: no insertion and connected orphan removal', {}, (e, observe) => {
  e.target.insertPanelLyrics(); e.drain(); const card = e.container(); e.document.body.append(card); e.target.setupObserver(); e.panel.remove(); e.deliverObservers(); e.drain();
  assert.equal(e.container(), null); e.target.insertPanelLyrics(); assert.equal(e.stats().roots, 1); observe('panel absent', e.stats());
});

await scenario('mapped header has priority over an earlier stray test-id marker', {}, (e, observe, contract) => {
  const strayParent = e.element('stray-parent');
  strayParent.append(e.element('stray-marker', { testId: 'minimized-track-visual-enhancement' }));
  e.panel.insertBefore(strayParent, e.widget);
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain();
  contract('mapped anchor wins over stray marker', underHeader(e), e.position(), { parent: 'grid', previous: 'info' });
  observe('mapped priority', e.position());
});
await scenario('late mapped header repairs the mapped-section fallback', { withHeader: false }, (e, observe, contract) => {
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain();
  assert.equal(e.container().nextElementSibling, e.aboutArtist);
  const card = e.container(), root = card.__ivLyricsPanelRoot, renders = e.stats().renderCount;
  const info = e.addHeader({ mapped: true }); e.deliverObservers(); e.drain();
  contract('late mapped anchor replaces section fallback', underHeader(e, info), e.position(), { parent: 'grid', previous: 'info' });
  assert.equal(e.container(), card); assert.equal(card.__ivLyricsPanelRoot, root);
  assert.equal(e.stats().renderCount, renders, 'placement repair does not rerender');
  assert.equal(root.unmounts, 0); observe('root-preserving repair', e.position());
});
await scenario('no usable slot immediately appends and becomes idle', { mapped: false, withHeader: false }, (e, observe) => {
  e.target.setupObserver(); e.target.insertPanelLyrics(); bottom(e);
  assert.equal(e.stats().time, 0); assert.equal(e.stats().renderCount, 1);
  assert.deepEqual(e.trace.filter(x => x.event === 'timer-set').map(x => x.delay), [300], 'only the existing render verifier');
  e.drain(); bottom(e); const before = e.stats();
  e.queue.append(e.element('unrelated')); e.deliverObservers(); e.drain();
  assert.equal(e.stats().renderCount, before.renderCount); assert.equal(e.stats().timers, 0);
  observe('immediate fallback without slot retries', e.position());
});
for (const trailingElement of [false, true]) await scenario(`mapped insertion preserves text/comment order, trailing element ${trailingElement}`, {}, (e, observe) => {
  const text = e.textNode('text'), comment = e.commentNode('comment'), trailing = e.element('trailing');
  e.grid.append(text, comment); if (trailingElement) e.grid.append(trailing);
  assert.equal(e.info.nextSibling, text); assert.equal(e.info.nextElementSibling, trailingElement ? trailing : null);
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain();
  const card = e.container(); assert.ok(underHeader(e));
  assert.deepEqual(e.grid.childNodes.map(n => n.name), ['cover', 'info', 'text', 'comment', 'ivlyrics', ...(trailingElement ? ['trailing'] : [])]);
  assert.equal(comment.nextSibling, card);
  observe('owned nextElementSibling insertion order', e.grid.childNodes.map(n => ({ name: n.name, type: n.nodeType })));
});
await scenario('correct card with intervening text/comment stays untouched and idle', {}, (e, observe) => {
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain();
  const card = e.container(), root = card.__ivLyricsPanelRoot;
  e.grid.insertBefore(e.textNode('text'), card); e.grid.insertBefore(e.commentNode('comment'), card);
  e.deliverObservers(); e.drain(); const count = e.trace.length, renders = e.stats().renderCount;
  e.aboutArtist.append(e.element('unrelated')); e.deliverObservers(); e.drain();
  assert.equal(e.stats().renderCount, renders); assert.equal(e.stats().timers, 0);
  assert.equal(e.trace.slice(count).filter(x => x.event === 'dom-insert' && x.nodeId === card.nodeId).length, 0);
  e.target.insertPanelLyrics(); e.drain();
  assert.equal(e.container(), card); assert.equal(card.__ivLyricsPanelRoot, root);
  assert.deepEqual(e.grid.childNodes.map(n => n.name), ['cover', 'info', 'text', 'comment', 'ivlyrics']);
  assert.equal(e.trace.slice(count).filter(x => x.event === 'dom-insert' && x.nodeId === card.nodeId).length, 0);
  observe('element-adjacent card is not relocated around non-elements', e.position());
});
await scenario('explicit insertion repairs moved card with element ordering and root reuse', {}, (e, observe, contract) => {
  e.grid.append(e.textNode('text'), e.commentNode('comment'), e.element('trailing'));
  e.target.insertPanelLyrics(); e.drain(); const card = e.container(), root = card.__ivLyricsPanelRoot;
  e.panel.append(card); e.target.insertPanelLyrics(); e.drain();
  contract('direct reinsertion repairs moved card', underHeader(e), e.position(), { parent: 'grid', previous: 'info' });
  assert.equal(e.container(), card); assert.equal(card.__ivLyricsPanelRoot, root); assert.equal(e.stats().roots, 1);
  observe('explicit relocation', { position: e.position(), children: e.grid.childNodes.map(n => n.name) });
});
await scenario('observer repair stops without rendering or scheduling repeated work', {}, (e, observe, contract) => {
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain(); const card = e.container(), renders = e.stats().renderCount;
  e.panel.append(card); const start = e.trace.length; e.deliverObservers(); e.drain();
  contract('observer relocates once', underHeader(e), e.position(), { parent: 'grid', previous: 'info' });
  assert.equal(e.stats().renderCount, renders); assert.equal(e.stats().timers, 0);
  const stable = e.trace.length; e.deliverObservers(); e.drain(); assert.equal(e.trace.length, stable);
  observe('repair mutations and idle state', { insertions: e.trace.slice(start).filter(x => x.event === 'dom-insert' && x.nodeId === card.nodeId).length, stats: e.stats() });
});
for (const coverKind of ['mapped-cover', 'video-player']) await scenario(`unmapped header uses ${coverKind} cover boundary`, { mapped: false }, (e, observe, contract) => {
  const cover = e.grid.children[0];
  for (const child of [...cover.children]) child.remove();
  if (coverKind === 'mapped-cover') cover.classList.add('main-nowPlayingView-coverArtContainer');
  else cover.append(e.element('video', { testId: 'video-player-npv' }));
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain();
  contract('stable header cover boundary gives slot', underHeader(e), e.position(), { parent: 'grid', previous: 'info' });
  observe('alternate cover boundary', e.position());
});
await scenario('nested unmapped header finds grid sibling instead of inner wrapper', { mapped: false }, (e, observe, contract) => {
  const marker = e.info.children[0], wrapper = e.element('header-wrapper');
  e.info.insertBefore(wrapper, marker); wrapper.append(marker);
  e.target.setupObserver(); e.target.insertPanelLyrics(); e.drain();
  contract('ancestor discovery reaches the track-info sibling', underHeader(e), e.position(), { parent: 'grid', previous: 'info' });
  observe('nested header discovery', e.position());
});

process.on('beforeExit', () => {
  if (process.env.PANEL_PLACEMENT_RESULTS) writeFileSync(process.env.PANEL_PLACEMENT_RESULTS,
    JSON.stringify({ node: process.version, source: extraction, cases }, null, 2) + '\n');
});
