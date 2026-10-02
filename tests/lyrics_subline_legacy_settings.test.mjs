import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../Pages.js', import.meta.url), 'utf8');
const start = source.indexOf('const renderLyricSubLine =');
const end = source.indexOf('const renderLyricMainContent =', start);
assert.ok(start >= 0 && end > start);

for (const highlightEnabled of [false, true]) {
  test(`legacy highlight preferences preserve ordinary sublines (enabled: ${highlightEnabled})`, () => {
    const annotations = [{ marker: 1 }];
    const html = 'Translation <sup>1</sup>';
    const onContextMenu = () => {};
    const context = vm.createContext({
      CONFIG: { visual: {
        'inactive-color': '#aaa',
        'phonetic-semantic-highlight': highlightEnabled,
        'translation-semantic-highlight': highlightEnabled,
      } },
      window: { LyricsAlignment: new Proxy({}, {
        get() { throw new Error('Removed alignment service must never run'); },
      }) },
      MeaningLinkedSubline: 'removed-component',
      react: { createElement: (type, props, ...children) => ({ type, props, children }) },
      renderAnnotatedLyricHTML(text, received) {
        assert.equal(text, 'Translation');
        assert.equal(received, annotations);
        return html;
      },
    });
    vm.runInContext(`${source.slice(start, end)}\nglobalThis.render = renderLyricSubLine;`, context);
    for (const kind of ['phonetic', 'translation']) {
      const tree = context.render(kind, 'Translation', onContextMenu,
        annotations, kind);
      assert.equal(tree.type, 'p');
      assert.equal(tree.props.onContextMenu, onContextMenu);
      assert.equal(tree.props.key, kind);
      assert.equal(tree.props.style['--sub-lyric-color'], '#aaa');
      assert.equal(tree.props.dangerouslySetInnerHTML.__html, html);
    }
  });
}
