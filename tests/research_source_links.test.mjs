import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root = process.env.IVLYRICS_SOURCE_ROOT || fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(`${root}/SongInfoTicker.js`, "utf8");
const managerSource = readFileSync(`${root}/AIAddonManager.js`, 'utf8');
const normalizerStart = managerSource.indexOf('    const RESEARCH_OUTPUT_VERSION =');
const normalizerEnd = managerSource.indexOf('    const PROMPT_LANGUAGE_DATA =', normalizerStart);
assert.ok(normalizerStart >= 0 && normalizerEnd > normalizerStart);
const normalizers = vm.runInNewContext(`${managerSource.slice(normalizerStart, normalizerEnd)}\n({normalizeResearchResult, normalizeResearchSource})`, {URL});
const createHarness = (mode = 'none') => {
  const opened = [];
  const slots = [];
  let cursor = 0;
  let language = "en";
  let elementCreations = 0;
  let previousBody = null;
  let renderedBody = null;
  const useState = (initial) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
  };
  const useMemo = (factory, deps) => {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) {
      slots[index] = { value: factory(), deps };
    }
    return slots[index].value;
  };
  const react = {
    createElement(type, props, ...children) {
      elementCreations++;
      return { type, props: { ...props, ...(children.length > 0 ? {
        children: children.length === 1 ? children[0] : children,
      } : {}) } };
    },
    Fragment: Symbol("Fragment"),
    memo: (type) => ({ type }),
    useState, useMemo,
    useRef: (current) => useMemo(() => ({ current }), []),
    useCallback: (callback, deps) => useMemo(() => callback, deps),
    useEffect: () => { cursor++; },
  };
  const context = vm.createContext({
    Spicetify: { React: react, Player: {data:{item:{uri:'spotify:track:fixture',name:'Fixture',artists:[{name:'Fixture artist'}]}}} },
    CONFIG: { visual: {} },
    window: {
      I18n: { t: (key) => `${language}:${key}`, getCurrentLanguage: () => language },
      dispatchEvent() {},
      open: (...args) => opened.push(args),
      AIAddonManager: typeof mode === 'object' ? mode : mode === 'full' ? normalizers : mode === 'source' ? {normalizeResearchSource:normalizers.normalizeResearchSource} : undefined,
    },
    CustomEvent: class {}, URL,
  });
  vm.runInContext(source.replace("    return {\n        ResearchFullView,", "    globalThis.components = { ResearchFullView, ResearchDocument };\n    return {\n        ResearchFullView,"), context);
  const components = context.components;
  assert.ok(components);
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object" || !("type" in node)) return node;
    if (typeof node.type === "function") return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  };
  return {
    opened,
    async legacyDocument(info) {
      context.window.LyricsService = {getTMI: async () => info};
      return context.window.SongInfoTMI.fetchSongInfo('fixture', true);
    },
    render(props) {
      cursor = 0;
      const view = components.ResearchFullView.type(props);
      const body = elements(view).find((element) => element.type === components.ResearchDocument);
      return { view, body };
    },
    renderBody(body) {
      elementCreations = 0;
      // React.memo compares every prop, including the language invalidation token.
      const next = body.props;
      const previous = previousBody?.props;
      const unchanged = previous && Object.keys(next).length === Object.keys(previous).length
        && Object.keys(next).every((key) => Object.is(next[key], previous[key]));
      if (!unchanged) renderedBody = expand(components.ResearchDocument.type(next));
      previousBody = body;
      return { tree: renderedBody, elementCreations };
    },
    setActiveSection(id) {
      const index = slots.findIndex((value) => value === "thesis" || value === "overview" || value === "sources");
      assert.ok(index >= 0);
      slots[index] = id;
    },
    setLanguage(value) { language = value; },
    sectionMap: () => slots.find((slot) => slot?.value?.current instanceof Map)?.value.current
      || slots.find((slot) => Object.prototype.toString.call(slot?.value?.current) === "[object Map]")?.value.current,
  };
};

const elements = (node) => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("type" in node)) return [];
  return [node, ...elements(node.props.children)];
};
for (const mode of ['none','source']) {
  for (const url of ['javascript:void(0)','data:text/plain,fixture','file:///fixture','ftp://fixture.invalid/source']) {
    test(`${mode}: legacy research renderer must reject non-HTTP source ${url.split(':')[0]}`, async () => {
      const h=createHarness(mode);
      const info=await h.legacyDocument({metadata:{title:'Fixture'},sources:[{url,title:'Fixture source',publisher:'Fixture'}]});
      assert.equal(info.error,undefined);
      const rendered=h.renderBody(h.render({info}).body);
      const unsafe=elements(rendered.tree).filter(x=>x.type==='a' && !['http:','https:'].includes(new URL(x.props.href).protocol));
      assert.equal(unsafe.length,0);
    });
  }
  test(`${mode}: malformed legacy citation cannot crash the article`,async()=>{
    const h=createHarness(mode),info=await h.legacyDocument({metadata:{title:'Fixture'},sources:[{url:'relative-citation',title:'Fixture source'}]});
    const rendered=h.renderBody(h.render({info}).body);
    assert.equal(elements(rendered.tree).filter(x=>x.type==='a').length,0);
  });
}
test('complete normalizer already filters rejected sources before rendering',async()=>{
  const h=createHarness('full'),info=await h.legacyDocument({metadata:{title:'Fixture'},sources:[{url:'javascript:void(0)'}]});
  assert.equal(info.sources.length,0);
  const rendered=h.renderBody(h.render({info}).body);
  assert.ok(elements(rendered.tree).filter(x=>x.type==='a').every(x=>['http:','https:'].includes(new URL(x.props.href).protocol)));
});
for(const mode of ['none','source','full'])test(`${mode}: valid source keeps its metadata and inert click target`,async()=>{
  const item=Object.freeze({url:'https://EXAMPLE.org:443/paper',title:'Saved title',publisher:'Publisher',source_type:'article',relevance:'Relevant note'});
  const h=createHarness(mode),info=await h.legacyDocument({metadata:{title:'Fixture'},sources:[item]});
  const rendered=h.renderBody(h.render({info}).body);
  const link=elements(rendered.tree).find(x=>x.type==='a' && new URL(x.props.href).pathname==='/paper');
  assert.ok(link);assert.equal(link.props.target,'_blank');assert.equal(link.props.rel,'noopener noreferrer');
  let prevented=0;link.props.onClick({preventDefault(){prevented++;}});
  assert.equal(prevented,1);assert.deepEqual(h.opened,[[link.props.href,'_blank','noopener,noreferrer']]);
  assert.ok(JSON.stringify(link.props.children).includes('Saved title'));assert.ok(JSON.stringify(link.props.children).includes('Relevant note'));
  assert.equal(item.url,'https://EXAMPLE.org:443/paper');
});
test('normalizer rejection is not replaced by the original source',async()=>{
  const h=createHarness({normalizeResearchSource:()=>null});
  const info=await h.legacyDocument({metadata:{title:'Fixture'},sources:[{url:'https://example.org/rejected',title:'Rejected source'}]});
  const rendered=h.renderBody(h.render({info}).body);
  assert.equal(elements(rendered.tree).filter(x=>x.type==='a').length,0);
});
test('custom normalizer retains its receiver and normalized metadata',async()=>{
  const manager={href:'https://example.org/custom',normalizeResearchSource(){assert.equal(this,manager);return{url:this.href,title:'Custom title'};}};
  const h=createHarness(manager),info=await h.legacyDocument({metadata:{title:'Fixture'},sources:[{url:'https://example.org/original'}]});
  const rendered=h.renderBody(h.render({info}).body),link=elements(rendered.tree).find(x=>x.type==='a');
  assert.equal(link.props.href,'https://example.org/custom');assert.ok(JSON.stringify(link.props.children).includes('Custom title'));
});
test('available source normalizer preserves legacy string and URI aliases',async()=>{
  const h=createHarness('source'),info=await h.legacyDocument({metadata:{title:'Fixture'},sources:['https://example.org/paper',{uri:'https://example.org/other'}]});
  const rendered=h.renderBody(h.render({info}).body);
  assert.deepEqual(Array.from(elements(rendered.tree).filter(x=>x.type==='a'),x=>x.props.href),['https://example.org/paper','https://example.org/other']);
});
