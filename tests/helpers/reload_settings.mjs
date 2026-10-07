// Actual Settings section/control bodies, with inert element creation and hooks.
// The complete Settings root and actual React/browser rendering do not execute.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { source, cut } from './reload_harness.mjs';
const index = source('index.js');
const settings = source('Settings.js');
const elements = node => Array.isArray(node) ? node.flatMap(elements)
  : node && typeof node === 'object' && 'tag' in node ? [node, ...elements(node.children)] : [];

export function controls(h) {
  const saves = [];
  let slots = [], cursor = 0, effects = [];
  const useState = initial => {
    const position = cursor++;
    if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial;
    return [slots[position], value => { slots[position] = typeof value === 'function' ? value(slots[position]) : value; }];
  };
  const useEffect = effect => {
    const position = cursor++;
    if (!(position in slots)) { slots[position] = true; effects.push(effect); }
  };
  Object.assign(h.context, {
    react: { memo: fn => fn, createElement: (tag, props, ...children) => ({ tag, props, children }) },
    useState, useEffect, useCallback: fn => fn, APP_NAME: 'ivLyrics',
    syncSettingsLyricsPreviewStyles() {}, loadGoogleFontFamily() {},
    getSafeSettingsLocale: () => 'en', getSettingsText: (key, fallback) => fallback,
    StorageManager: { saveConfig: (...args) => saves.push(args), setItem: (...args) => saves.push(args) },
  });
  for (const name of ['ButtonSVG', 'SettingsSectionTitle', 'ConfigButton', 'ConfigSliderRange', 'ConfigFontWeightSlider',
    'ConfigColorPicker', 'ConfigInput', 'ConfigHotkey', 'ConfigWarning', 'ConfigInfo', 'ConfigKeyList',
    'ConfigFontSelector', 'ConfigInstrumentalBreakIconPicker', 'ConfigKaraokeFillCurveEditor',
    'VideoHelperToggle', 'LyricsHelperToggle']) h.context[name] = name;
  h.spicetify.SVGIcons = { check: 'check' };
  vm.runInContext([
    'globalThis.installControls=function(){const reloadLyrics=(...args)=>this.reloadLyrics(...args);let lyricContainerUpdate;',
    cut(index, '    lyricContainerUpdate = () => {', '    reloadLyrics = async'),
    cut(index, '    this.handleConfigChange = (event) => {', '    this.handleFuriganaReady ='),
    cut(settings, 'const ConfigSlider = react.memo(', 'const ConfigSliderRange ='),
    cut(settings, 'const ConfigSelection = ({', 'const getInstrumentalBreakPreviewStyle ='),
    cut(settings, 'const OptionList = ({ type, items, onChange }) => {', 'const getEffectiveReducedMotionPreference ='),
    cut(settings, 'const createTextOutlineSettingItems = (', 'const MULTI_VOCAL_COLOR_GROUPS ='),
    cut(settings, 'const LYRICS_TYPOGRAPHY_SECTIONS = [', 'const SETTINGS_LYRICS_PREVIEW_TEXT ='),
    cut(settings, '  const saveLyricsTypographySetting = (name, value) => {', '  // 외형 미리보기 설정 변경'),
    cut(settings, '    const renderLyricsLanguageSection = () => [', '    const renderLyricsProviderPrioritySection ='),
    cut(settings, 'const LocalCacheManager = () => {', '// 디버그 정보 패널 컴포넌트'),
    'return {typography:()=>renderLyricsTypographySections({onChange:saveLyricsTypographySetting}),language:renderLyricsLanguageSection,OptionList,ConfigSelection,ConfigSlider,LocalCacheManager};};',
  ].join('\n'), h.context);
  const ui = h.context.installControls.call(h.c);
  const fresh = fn => { slots = []; cursor = 0; effects = []; return fn(); };
  function click(kind, key, value) {
    fresh(() => {
      const section = ui[kind]();
      const list = elements(section).find(e => e.tag === ui.OptionList && e.props.items.some(item => item.key === key));
      assert.ok(list, 'actual settings section contains option');
      const row = elements(ui.OptionList(list.props)).find(e => e.props?.['data-setting-key'] === key);
      const control = elements(row).find(e => e.tag === ui.ConfigSelection || e.tag === ui.ConfigSlider);
      assert.ok(control, 'actual control found');
      const element = control.tag(control.props);
      assert.ok(!element.props.disabled);
      if (element.tag === 'select') {
        assert.ok(element.children.some(child => child.props.value === value));
        element.props.onChange({ target: { value } });
      } else element.props.onClick();
    });
  }
  return {
    saves,
    typography: () => click('typography', 'phonetic-hyphen-replace', 'space'),
    language: (key = 'spotify-fake-karaoke-enabled') => click('language', key),
    async cache(scope) {
      fresh(() => ui.LocalCacheManager());
      for (const effect of effects) effect();
      await h.settle(); cursor = 0;
      const button = elements(ui.LocalCacheManager()).find(e => e.tag === 'button'
        && e.children.includes(`settingsAdvanced.cacheManagement.localCache.clear${scope}`));
      assert.ok(button); assert.ok(!button.props.disabled);
      return button.props.onClick();
    },
  };
}
