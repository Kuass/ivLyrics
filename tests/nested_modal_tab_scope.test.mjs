import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=process.env.IVLYRICS_SOURCE_ROOT || fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(resolve(root,'OptionsMenu.js'),'utf8');
const community=readFileSync(resolve(root,'CommunityVideoSelector.js'),'utf8');
const slice=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a);return text.slice(a,b);};
const componentSource=slice(community,'const CommunityVideoSelector = ({','window.CommunityVideoSelector =');
const confirmSource=slice(community,'const ConfirmDialog =','const COMMUNITY_VIDEO_MAX_START_TIME_SECONDS');
const selectionSource=slice(community,'const COMMUNITY_VIDEO_MAX_START_TIME_SECONDS','// 현재 음악 재생 시간에 맞춰');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const extract = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `extract ${startMarker}`);
  return source.slice(start, end);
};
// No browser, storage, player, provider, network, or credential operations occur.
// Actual complete host, wrapper, selector opener, selector component and confirmation.
// DOM phases, hooks, scheduler, row reads and rendering are inert collaborators.
const production = [
  extract('function createFluentModalHost(', 'function resolveFirstLanguagePromptMountNode('),
  extract('function openFluentReactModal(', 'function ensureFluentModalStyles('),
  extract('function openCommunityVideoSelector(', '// Community Video Selector Button'),
  confirmSource,selectionSource,componentSource,
].join('\n');

function harness({ reducedMotion = false } = {}) {
  const frames = new Map(), timers = new Map(), roots = [], focuses = [], effects=[], reads=[], deletions=[], dispatches=[];
  let current=null, cursor=0, activeRoot=null;
  let callbackId = 0;
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.dataset = {}; this.style = {};
      this.attributes = {}; this.listeners = new Map(); this.className = '';
      this.classList = {
        add: name => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), name])].join(' '); },
        remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); },
        contains: name => this.className.split(' ').includes(name),
      };
    }
    get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    remove() {
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode = null;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key]; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    closest(selector) {
      assert.equal(selector, '[role="dialog"][aria-modal="true"]');
      for (let node=this;node;node=node.parentNode) {
        if (node.getAttribute('role')==='dialog' && node.getAttribute('aria-modal')==='true') return node;
      }
      return null;
    }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelectorAll(selector) {
      if (selector.startsWith('button:not(')) return this.descendants().filter(node =>
        (['button', 'input', 'select', 'textarea'].includes(node.tag) && !node.disabled)
        || (node.tag === 'a' && node.attributes.href)
        || (node.tabIndex !== undefined && node.tabIndex !== -1));
      return this.descendants().filter(node => selector.split(', ').some(part =>
        part === node.tag || (part.startsWith('.') && node.classList.contains(part.slice(1)))
        || (part.startsWith('[tabindex]') && node.tabIndex !== undefined && node.tabIndex !== -1)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() {
      // A detached DOM element cannot take focus in a browser. Preserve this
      // protection so queued callbacks cannot manufacture a false positive.
      if (!this.isConnected || this.disabled) return;
      document.activeElement = this; focuses.push(this);
    }
  }
  const listeners = new Map();
  const document = {
    body: new Element('body'), activeElement: null,
    createElement: name => new Element(name),
    getElementById(id) { return [this.body, ...this.body.descendants()].find(node => node.id === id) || null; },
    contains(node) { return this.body.contains(node); },
    addEventListener(name, callback, capture) {
      const entries = listeners.get(name) || [];
      entries.push({ callback, capture: !!capture }); listeners.set(name, entries);
    },
    removeEventListener(name, callback, capture) {
      listeners.set(name, (listeners.get(name) || []).filter(entry => entry.callback !== callback || entry.capture !== !!capture));
    },
  };
  document.activeElement = document.body;
  const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
  const react = {
    Fragment: Symbol('fragment'), memo: callback => callback,
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial){const n=cursor++;if(!current[n]){const s={kind:'state',value:typeof initial==='function'?initial():initial};s.set=value=>{s.value=typeof value==='function'?value(s.value):value;};current[n]=s;}return[current[n].value,current[n].set];},
    useRef(initial){const n=cursor++;if(!current[n])current[n]={kind:'ref',value:{current:initial}};return current[n].value;},
    useCallback(fn,deps){const n=cursor++,old=current[n];if(!old||changed(old.deps,deps))current[n]={kind:'callback',value:fn,deps};return current[n].value;},
    useMemo(fn,deps){const n=cursor++,old=current[n];if(!old||changed(old.deps,deps))current[n]={kind:'memo',value:fn(),deps};return current[n].value;},
    useEffect(setup,deps){const n=cursor++,old=current[n];if(!old||changed(old.deps,deps)){const s={kind:'effect',deps,setup,cleanup:old?.cleanup};current[n]=s;effects.push(s);}},
  };
  const mount = (node, parent) => {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(child => mount(child, parent)); return; }
    if (node.type === react.Fragment) { node.children.forEach(child => mount(child, parent)); return; }
    if (typeof node.type === 'function') {
      let slots=activeRoot.instances.get(node.type);if(!slots){slots=[];activeRoot.instances.set(node.type,slots);}
      const previous=current, previousCursor=cursor;current=slots;cursor=0;
      const rendered=node.type(node.props);current=previous;cursor=previousCursor;
      mount(rendered,parent);return;
    }
    const element = document.createElement(node.type);
    for (const [key, value] of Object.entries(node.props)) {
      if(key==='ref'){if(value)value.current=element;}
      else if(key.startsWith('aria-')||key==='role')element.setAttribute(key,value);
      else element[key] = value;
    }
    parent.appendChild(element); node.children.forEach(child => mount(child, element));
  };
  const renderRoot=root=>{if(root.unmounts)return;for(const child of [...root.shell.children])child.remove();activeRoot=root;mount(root.tree,root.shell);activeRoot=null;for(const e of effects.splice(0)){e.cleanup?.();e.cleanup=e.setup();}};
  const reactDom = {
    render(tree, shell) {const root={tree,shell,unmounts:0,instances:new Map()};roots.push(root);renderRoot(root);},
    unmountComponentAtNode(shell) {
      const root=roots.find(root=>root.shell===shell);root.unmounts++;
      for(const slots of root.instances.values())for(const s of slots)if(s.kind==='effect')s.cleanup?.();
      for (const child of [...shell.children]) child.remove();
    },
  };
  const context = {
    react, document, HTMLElement: Element, CONFIG:{visual:{}}, URL,
    Utils:{extractYouTubeVideoId(value){assert.equal(value,'','No URL entry in this assessment');return null;},getCurrentUserHash:()=> 'fixture-owner',extractTrackId:()=> 'fixture-track',normalizeVideoSkipSegments:v=>v||[],
      getCommunityVideos(){const d=deferred();reads.push(d);return d.promise;},
      deleteCommunityVideo(){deletions.push(true);throw Error('Deletion must stay inert and uncalled');}},
    StorageManager:{saveConfig(){throw Error('Preference write outside scope');}},Toast:{success(){},error(){}},
    SyncedVideoPreview:'inert-preview',SimpleVideoPreview:'inert-simple',
    setTimeout(callback,delay){timers.set(++callbackId,{callback,delay});return callbackId;},clearTimeout:id=>timers.delete(id),
    console:{error(){}},
    window: {
      ReactDOM: reactDom, LyricsAddonManager: { getEnabledProviders: () => [] },
      setTimeout(callback, delay) { timers.set(++callbackId, { callback, delay }); return callbackId; },
      clearTimeout(id) { timers.delete(id); }, matchMedia: () => ({ matches: reducedMotion }),
    },
    requestAnimationFrame(callback) { frames.set(++callbackId, callback); return callbackId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    resolveOptionsReactDom: () => reactDom, ensureFluentModalStyles() {}, getSettingsSurfaceTheme: () => 'dark',
    getOptionsText: (_key, fallback) => fallback, I18n: { t: key => key },
    IvConfigButton: 'config-button', SettingRowDescription: 'description', ICONS: {},
    IvLyricsTooltip: 'tooltip', IvLyricsToolbarIcon: 'toolbar-icon',
  };
  vm.runInNewContext(`${production}\nglobalThis.api = { createFluentModalHost, openFluentReactModal, openCommunityVideoSelector, ConfirmDialog };`, context);
  const trigger = document.body.appendChild(new Element('button'));
  trigger.id = 'local-tools-trigger'; trigger.focus();
  const h = {
    document, trigger, frames, timers, roots, focuses, reads, deletions, dispatches, api: context.api,
    standaloneConfirm(props){const shell=document.body.appendChild(new Element('section'));reactDom.render(react.createElement(context.api.ConfirmDialog,props),shell);return shell;},
    commit(){roots.forEach(renderRoot);},
    openSelector(){context.api.openCommunityVideoSelector("spotify:track:fixture",null,()=>{});return document.getElementById("ivLyrics-community-video-overlay");},
    find(cls){return document.body.descendants().find(n=>n.className===cls);},
    click(cls){const n=this.find(cls);assert.ok(n,cls);assert.notEqual(n.disabled,true);n.onClick({target:n,stopPropagation(){}});this.commit();},
    async loadRows(){reads[0].resolve({videos:[{id:"row",youtubeVideoId:"abcdefghijk",youtubeTitle:"Synthetic owned row",submitterId:"fixture-owner",likes:0,dislikes:0,score:0,userVote:null}]});await flush();this.commit();},
    runFrames() {
      const batch = [...frames];
      batch.forEach(([id]) => frames.delete(id));
      batch.forEach(([, callback]) => callback());
    },
    finishClose() {
      const entry = [...timers].find(([, timer]) => timer.delay === 180);
      assert.ok(entry, 'a pending 180 ms close'); timers.delete(entry[0]); entry[1].callback();
    },
    key(key, extra = {}) {
      const event = { key, target: document.activeElement, ...extra,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() { this.immediatePropagationStopped = true; this.propagationStopped = true; },
      };
      // Document capture precedes descendants and document bubble, regardless
      // of registration order. Removed listeners are skipped like DOM dispatch.
      for(const capture of [true,false]){
        if(event.propagationStopped)break;
        for(const entry of [...(listeners.get('keydown')||[])]){
          if(entry.capture!==capture||!(listeners.get('keydown')||[]).includes(entry))continue;
          dispatches.push(capture?'capture':'bubble');entry.callback(event);
          if(event.immediatePropagationStopped)break;
        }
      }
      return event;
    },
    listenerCount() { return (listeners.get('keydown') || []).length; },
    openHost(id = 'test-modal', options = {}) {
      const host = context.api.createFluentModalHost({ overlayId: id, ...options });
      host.button = host.shell.appendChild(new Element('button'));
      return host;
    },

  };
  return h;
}




async function confirmation(){const h=harness(),overlay=h.openSelector();h.runFrames();await h.loadRows();h.click('action-btn delete');h.runFrames();const dialog=h.find('confirm-dialog');assert.ok(dialog);assert.equal(dialog.getAttribute('role'),'dialog');assert.equal(dialog.getAttribute('aria-modal'),'true');assert.equal(h.document.activeElement,h.find('confirm-dialog-btn confirm'));return{h,overlay,dialog};}
test('desired: Tab from actual final confirmation button stays inside the modal confirmation',async()=>{
 const {h,overlay,dialog}=await confirmation();const event=h.key('Tab');
 assert.equal(event.defaultPrevented,true,'the production host explicitly handled Tab');
 assert.equal(h.document.activeElement.className,'confirm-dialog-btn cancel','last confirmation control must wrap to its own first control');
 assert.equal(dialog.contains(h.document.activeElement),true);assert.equal(overlay.getAttribute('aria-hidden'),undefined);assert.equal(h.deletions.length,0);
});
test('control: normal host wraps forward and backward within its shell',()=>{
 const h=harness(),host=h.openHost();const last=host.shell.appendChild(h.document.createElement('button'));last.focus();
 assert.equal(h.key('Tab').defaultPrevented,true);assert.equal(h.document.activeElement,host.button);
 assert.equal(h.key('Tab',{shiftKey:true}).defaultPrevented,true);assert.equal(h.document.activeElement,last);
});
test('control: nested nonmodal dialog does not change the outer host boundary',()=>{
 const h=harness(),host=h.openHost();const nested=host.shell.appendChild(h.document.createElement('div'));nested.setAttribute('role','dialog');nested.setAttribute('aria-modal','false');
 const first=nested.appendChild(h.document.createElement('button')),last=nested.appendChild(h.document.createElement('button'));last.focus();
 h.key('Tab');assert.equal(h.document.activeElement,host.button);assert.notEqual(h.document.activeElement,first);
});
test('control: canceled confirmation restores the ordinary selector boundary',async()=>{
 const {h,overlay}=await confirmation();h.click('confirm-dialog-btn cancel');assert.equal(h.find('confirm-dialog'),undefined);
 const focusable=overlay.children[0].querySelectorAll('button:not([disabled])');focusable.at(-1).focus();h.key('Tab');assert.equal(h.document.activeElement,focusable[0]);assert.equal(overlay.getAttribute('aria-hidden'),undefined);
});
test('control: logically closed host no longer explicitly changes focus for Tab',async()=>{
 const {h,overlay}=await confirmation();overlay.__ivLyricsCloseModal();const before=h.document.activeElement;
 const event=h.key('Tab');assert.equal(event.defaultPrevented,undefined);assert.equal(h.document.activeElement,before);
 assert.equal(h.roots[0].unmounts,0);h.finishClose();assert.equal(h.roots[0].unmounts,1);
});
test('control: a host with trapFocus disabled performs no explicit wrap',()=>{
 const h=harness(),host=h.openHost('untrapped',{trapFocus:false});const last=host.shell.appendChild(h.document.createElement('button'));last.focus();
 const event=h.key('Tab');assert.equal(event.defaultPrevented,undefined);assert.equal(h.document.activeElement,last);
});
test('control: an empty ordinary host focuses its shell in the existing explicit branch',()=>{
 const h=harness(),host=h.api.createFluentModalHost({overlayId:'empty'});h.trigger.focus();
 assert.equal(h.key('Tab').defaultPrevented,true);assert.equal(h.document.activeElement,host.shell);
});

test('Shift Tab from first actual confirmation control wraps to its own final control',async()=>{
 const {h,dialog}=await confirmation();h.find('confirm-dialog-btn cancel').focus();const e=h.key('Tab',{shiftKey:true});assert.equal(e.defaultPrevented,true);assert.equal(h.document.activeElement,h.find('confirm-dialog-btn confirm'));assert.equal(dialog.contains(h.document.activeElement),true);assert.equal(h.deletions.length,0);
});
test('interior confirmation traversal stays with browser default movement',async()=>{
 const {h}=await confirmation();const first=h.find('confirm-dialog-btn cancel'),last=h.find('confirm-dialog-btn confirm');first.focus();assert.equal(h.key('Tab').defaultPrevented,undefined);assert.equal(h.document.activeElement,first);last.focus();assert.equal(h.key('Tab',{shiftKey:true}).defaultPrevented,undefined);assert.equal(h.document.activeElement,last);
});
test('nearest nested modal owns the explicit wrap',()=>{
 const h=harness(),host=h.openHost();const outer=host.shell.appendChild(h.document.createElement('section'));outer.setAttribute('role','dialog');outer.setAttribute('aria-modal','true');outer.appendChild(h.document.createElement('button'));const inner=outer.appendChild(h.document.createElement('section'));inner.setAttribute('role','dialog');inner.setAttribute('aria-modal','true');const first=inner.appendChild(h.document.createElement('button')),last=inner.appendChild(h.document.createElement('button'));last.focus();h.key('Tab');assert.equal(h.document.activeElement,first);h.key('Tab',{shiftKey:true});assert.equal(h.document.activeElement,last);
});
test('a modal outside this host does not become its focus scope',()=>{
 const h=harness();h.openHost();const other=h.document.body.appendChild(h.document.createElement('section'));other.setAttribute('role','dialog');other.setAttribute('aria-modal','true');other.appendChild(h.document.createElement('button'));const last=other.appendChild(h.document.createElement('button'));last.focus();const e=h.key('Tab');assert.equal(e.defaultPrevented,undefined);assert.equal(h.document.activeElement,last);
});
for(const backward of [false,true])test(`disabled nested boundary controls stay excluded (${backward})`,async()=>{
 const {h,dialog}=await confirmation();h.find('confirm-dialog-btn cancel').disabled=true;const active=h.find('confirm-dialog-btn confirm');active.focus();const e=h.key('Tab',{shiftKey:backward});assert.equal(e.defaultPrevented,true);assert.equal(h.document.activeElement,active);assert.equal(dialog.contains(h.document.activeElement),true);
});
test('empty active nested modal retains its own focusable container',()=>{
 const h=harness(),host=h.openHost();const nested=host.shell.appendChild(h.document.createElement('section'));nested.setAttribute('role','dialog');nested.setAttribute('aria-modal','true');nested.tabIndex=-1;nested.focus();assert.equal(h.key('Tab').defaultPrevented,true);assert.equal(h.document.activeElement,nested);assert.equal(h.key('Tab',{shiftKey:true}).defaultPrevented,true);assert.equal(h.document.activeElement,nested);
});
for(const kind of ['hidden','aria-hidden'])test(`existing ${kind} filter remains within the active nested scope`,async()=>{
 const {h}=await confirmation();const first=h.find('confirm-dialog-btn cancel');if(kind==='hidden')first.hidden=true;else first.setAttribute('aria-hidden','true');const last=h.find('confirm-dialog-btn confirm');last.focus();const e=h.key('Tab');assert.equal(e.defaultPrevented,true);assert.equal(h.document.activeElement,last);
});
test('an explicitly trapped nonmodal host retains its normal shell scope',()=>{
 const h=harness(),host=h.openHost('nonmodal',{modal:false,trapFocus:true});const last=host.shell.appendChild(h.document.createElement('button'));last.focus();assert.equal(h.key('Tab').defaultPrevented,true);assert.equal(h.document.activeElement,host.button);
});
