import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import vm from 'node:vm';

// Execute the actual addon closures and pin pre-extraction requests, callbacks
// and failures. This deliberately does not substitute a copied provider parser.
const root = new URL('../', import.meta.url);
const baseline = 'df668b77e01a11fbec384b6c1c57cebcab7936fa';
const helper = readFileSync(new URL('AIStreamReader.js', root), 'utf8');
const encoder = new TextEncoder();
const sources = new Map(['Groq', 'OpenRouter'].map(provider => {
  const file = `Addon_AI_${provider}.js`;
  return [provider, {
    current: readFileSync(new URL(file, root), 'utf8'),
    baseline: execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' }),
  }];
}));
const plain = value => JSON.parse(JSON.stringify(value));
const frame = (content, finish = null, ending = '\n\n') => `data: ${JSON.stringify({
  choices: [{ delta: { content }, finish_reason: finish }],
})}${ending}`;
const data = value => `data: ${JSON.stringify(value)}\n\n`;
const ok = text => [frame(text, 'stop'), 'data: [DONE]\n\n'];
const namedError = name => new DOMException(`fixture ${name}`, name);

async function run(provider, version, scenario = {}) {
  const events = [];
  let addon, requestIndex = 0;
  const responses = scenario.responses || [{ chunks: scenario.chunks || ok('first\nsecond') }];
  const settings = { 'api-keys': ['fixture-key-1'], model: 'fixture-model', ...scenario.settings };
  const window = {
    AIAddonManager: {
      register(value) { addon = value; },
      getAddonSetting(_id, key, fallback) { return settings[key] ?? fallback; },
      getProviderRequestAttempts() { return scenario.attempts ?? 1; },
      createResearchStreamProgressParser(callback) { return { push(text) { callback(text); } }; },
    },
    async ivLyricsFetch(url, init, timeout) {
      events.push(['request', url, plain(init), timeout]);
      if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: [] }) };
      const response = responses[requestIndex++];
      assert.ok(response, 'unexpected extra provider request');
      if (response.error) throw response.error;
      const status = response.status || 200;
      let chunkIndex = 0;
      return {
        status, ok: status === 200, json: async () => response.json || {},
        body: { getReader() { return { async read() {
          const chunk = response.chunks?.[chunkIndex++];
          events.push(['read', requestIndex, chunkIndex, chunk === undefined]);
          if (chunk instanceof Error) throw chunk;
          return chunk === undefined ? { done: true }
            : { value: typeof chunk === 'string' ? encoder.encode(chunk) : chunk, done: false };
        }, async cancel() {}, releaseLock() {} }; } },
      };
    },
  };
  const context = vm.createContext({ window, TextDecoder, console,
    setTimeout(callback, delay) { events.push(['delay', delay]); callback(); },
  });
  if (version === 'current') vm.runInContext(helper, context, { filename: 'AIStreamReader.js' });
  const source = sources.get(provider)[version];
  // Expose only an existing entry point inside the VM; no production test hooks.
  const marker = '    registerAddon();';
  assert.ok(source.includes(marker));
  vm.runInContext(source.replace(marker, `${marker}\n    window.testStream = call${provider}APIStream;`), context,
    { filename: `Addon_AI_${provider}.js` });
  const onLine = scenario.noLine ? null : (index, text) => {
    events.push(['line', index, text]);
    if (scenario.throwLine) throw new Error('fixture line callback failed');
  };
  const onReset = scenario.noReset ? null : details => {
    events.push(['reset', plain(details)]);
    if (scenario.throwReset) throw new Error('fixture reset callback failed');
  };
  const onRaw = text => {
    events.push(['raw', text]);
    if (scenario.throwRaw) throw new Error('fixture raw callback failed');
  };
  const options = provider === 'Groq'
    ? { model: 'fixture-override-model', body: { max_tokens: 321, temperature: 0.7 } }
    : { max_tokens: 321, temperature: 0.7, plugins: [{ id: 'web', enabled: false }] };
  try {
    let result;
    if (scenario.publicLyrics) {
      result = await addon.translateLyrics({ text: scenario.sourceText || 'source 1\nsource 2',
        translationPrompt: 'fixture prompt', phoneticPrompt: 'fixture phonetic',
        wantSmartPhonetic: !!scenario.phonetic, onLine, onStreamReset: onReset });
    } else if (scenario.publicResearch) {
      result = await addon.generateTMI({ title: 'fixture title', artist: 'fixture artist',
        tmiPrompt: 'fixture research', requestTimeoutMs: 12345, webSearch: scenario.researchWebSearch ?? false,
        onResearchProgress: (text, details) => events.push(['progress', text, details ? plain(details) : null]) });
    } else {
      result = await window.testStream({ systemPrompt: 'fixture system', userPrompt: 'fixture prompt' },
        onLine, onReset, scenario.attempts ?? 1, scenario.transform || null, 12345, onRaw, options);
    }
    return { events, result: plain(result) };
  } catch (error) {
    return { events, error: { name: error.name, message: error.message, code: error.code, reason: error.reason } };
  }
}
async function compare(provider, scenario) {
  const expected = await run(provider, 'baseline', scenario);
  const actual = await run(provider, 'current', scenario);
  assert.deepEqual(actual, expected);
  return actual;
}
const only = (result, kind) => result.events.filter(event => event[0] === kind);

for (const provider of ['Groq', 'OpenRouter']) {
  test(`${provider}: every byte split preserves UTF-8, CRLF and frame delimiters`, async () => {
    const bytes = encoder.encode(': keepalive\r\nevent: message\r\n\r\n' + frame('한글🙂\nsecond', 'stop', '\r\n\r\n') + 'data: [DONE]\r\n');
    const splits = Array.from({ length: bytes.length + 1 }, (_, at) => [bytes.slice(0, at), bytes.slice(at)]);
    splits.push(Array.from(bytes, byte => Uint8Array.of(byte)));
    for (const chunks of splits) {
      const result = await compare(provider, { chunks });
      assert.equal(result.result, '한글🙂\nsecond');
      assert.deepEqual(only(result, 'line'), [['line', 0, '한글🙂'], ['line', 1, 'second']]);
      assert.deepEqual(only(result, 'raw'), [['raw', '한글🙂\nsecond']]);
    }
  });
  test(`${provider}: ignored fields, blank data, usage frames and content arrays`, async () => {
    const result = await compare(provider, { chunks: [
      ': comment\nevent: token\nid: 1\n\ndata:\n\ndata:   \n' + data({ usage: { tokens: 5 }, choices: [] }),
      frame(['first', { text: '\n' }, { image: 'ignored' }, 'second'], ' STOP '),
    ] });
    assert.equal(result.result, 'first\nsecond');
  });
  test(`${provider}: preserves unterminated final frame and EOF emission boundary`, async () => {
    const result = await compare(provider, { chunks: [frame('first\nsecond', 'stop', '')] });
    assert.equal(result.result, 'first\nsecond');
    assert.deepEqual(only(result, 'line'), [['line', 0, 'first\nsecond']]);
  });
  test(`${provider}: DONE remains a marker rather than transport cancellation`, async () => {
    const result = await compare(provider, { chunks: ['data: [DONE]\n', frame('after marker', 'stop')] });
    assert.equal(result.result, 'after marker');
  });
  for (const [label, chunks, pattern] of [
    ['empty stream', [], /missing_finish_reason/],
    ['missing finish', [frame('provisional')], /missing_finish_reason/],
    ['empty successful response', [frame('', 'stop')], /Empty response/],
    ['whitespace response', [frame('  \n ', 'stop')], /Empty response/],
    ['malformed first frame', ['data: invalid\n'], /Unexpected token/],
    ['truncated trailing JSON', ['data: {\"choices\":'], /Unexpected end/],
    ['malformed later frame', [frame('provisional\n'), 'data: invalid\n'], /Unexpected token/],
    ['malformed frame in same read', [frame('provisional\n') + 'data: invalid\n'], /Unexpected token/],
    ['API error', [frame('provisional'), data({ error: { message: 'fixture API error' } })], /fixture API error/],
    ['choice error', [frame('provisional\n'), data({ choices: [{ error: { code: 'fixture_choice_error' } }] })], /fixture_choice_error/],
    ['string refusal', [data({ choices: [{ delta: { refusal: 'fixture refusal' } }] })], /refusal/],
    ['object refusal', [data({ choices: [{ delta: { refusal: { message: 'denied' } } }] })], /refusal/],
    ['length finish', [frame('provisional'), frame('discarded', 'length')], /length/],
    ['content filter finish', [frame('', 'content_filter')], /content_filter/],
    ['read cancellation', [frame('provisional\n'), namedError('AbortError')], /fixture AbortError/],
    ['read timeout', [frame('provisional'), namedError('TimeoutError')], /fixture TimeoutError/],
  ]) {
    test(`${provider}: preserves ${label} rejection and resets`, async () => {
      const result = await compare(provider, { chunks });
      assert.match(result.error.message, pattern);
    });
  }
  test(`${provider}: clears emitted lines when no reset callback exists`, async () => {
    const result = await compare(provider, { chunks: [frame('first\nsecond\n'), namedError('AbortError')], noReset: true });
    assert.deepEqual(only(result, 'line'), [
      ['line', 0, 'first'], ['line', 1, 'second'], ['line', 0, ''], ['line', 1, ''],
    ]);
  });
  test(`${provider}: retries with fresh decoder/output after partial UTF-8 failure`, async () => {
    const partial = encoder.encode(frame('옛 줄\n') + 'data: {"choices":[{"delta":{"content":"한');
    const result = await compare(provider, { attempts: 2, responses: [
      { chunks: [partial.slice(0, -1), namedError('AbortError')] }, { chunks: ok('new\nresult') },
    ] });
    assert.equal(result.result, 'new\nresult');
    assert.equal(only(result, 'request').length, 2);
    assert.deepEqual(only(result, 'delay'), [['delay', 1000]]);
    assert.equal(only(result, 'reset')[0][1].reason, 'retry');
    assert.deepEqual(only(result, 'line'), [['line', 0, '옛 줄'], ['line', 0, 'new'], ['line', 1, 'result']]);
  });
  for (const status of [429, 403]) {
    test(`${provider}: rotates keys on HTTP ${status} without reading a stream`, async () => {
      const result = await compare(provider, { settings: { 'api-keys': ['first-key', 'second-key'] }, responses: [
        { status }, { chunks: ok('success') },
      ] });
      assert.equal(result.result, 'success');
      assert.deepEqual(only(result, 'request').map(event => event[2].headers.Authorization), ['Bearer first-key', 'Bearer second-key']);
      assert.deepEqual(only(result, 'delay'), []);
    });
  }
  test(`${provider}: invalid key failures remain terminal`, async () => {
    const result = await compare(provider, { attempts: 3,
      responses: [{ status: 401, json: { error: { message: 'Invalid API key' } } }] });
    assert.match(result.error.message, /Invalid API key/);
    assert.equal(only(result, 'request').length, 1);
  });
  for (const callback of ['throwLine', 'throwRaw', 'throwReset']) {
    test(`${provider}: preserves ${callback} behavior`, async () => {
      const result = await compare(provider, { [callback]: true,
        chunks: callback === 'throwReset' ? [frame('first\n'), namedError('AbortError')] : ok('first\nsecond') });
      assert.ok(result.error);
      if (callback === 'throwReset') assert.equal(result.error.name, 'AbortError');
    });
  }
  test(`${provider}: transformed output repairs and clears provisional lines`, async () => {
    const result = await compare(provider, { chunks: ok('first\nsecond\nthird'), transform: () => ['changed'] });
    assert.deepEqual(result.result, ['changed']);
    assert.deepEqual(only(result, 'line').slice(-3), [['line', 0, 'changed'], ['line', 1, ''], ['line', 2, '']]);
  });
  test(`${provider}: raw-only output still resets`, async () => {
    const result = await compare(provider, { noLine: true, chunks: [frame('raw only'), namedError('TimeoutError')] });
    assert.deepEqual(only(result, 'line'), []);
    assert.deepEqual(only(result, 'raw'), [['raw', 'raw only']]);
    assert.equal(only(result, 'reset').length, 1);
  });
  for (const phonetic of [false, true]) {
    test(`${provider}: registered ${phonetic ? 'phonetic' : 'translation'} entry repairs fences`, async () => {
      const result = await compare(provider, { publicLyrics: true, phonetic, chunks: ok('```text\nfirst\nsecond\n```') });
      assert.deepEqual(result.result, { [phonetic ? 'phonetic' : 'translation']: ['first', 'second'] });
      assert.deepEqual(only(result, 'line').slice(-4), [['line', 0, 'first'], ['line', 1, 'second'], ['line', 2, ''], ['line', 3, '']]);
    });
  }
  test(`${provider}: web research preserves provider-specific tools and preliminary requests`, async () => {
    const result = await compare(provider, { publicResearch: true, researchWebSearch: true,
      responses: provider === 'Groq'
        ? [{ chunks: ok('fixture source dossier') }, { chunks: ok('{"title":"result"}') }]
        : [{ chunks: ok('{"title":"result"}') }],
    });
    assert.deepEqual(result.result, { title: 'result' });
    const requests = only(result, 'request').filter(event => event[1].endsWith('/chat/completions'));
    const first = JSON.parse(requests[0][2].body);
    if (provider === 'Groq') {
      assert.equal(requests.length, 2);
      assert.equal(first.model, 'groq/compound');
      assert.deepEqual(first.compound_custom.tools.enabled_tools, ['web_search', 'visit_website']);
      const final = JSON.parse(requests[1][2].body);
      assert.equal(final.model, 'fixture-model');
      assert.match(final.messages.at(-1).content, /fixture source dossier/);
    } else {
      assert.equal(requests.length, 1);
      assert.equal(first.tool_choice, 'required');
      assert.equal(first.tools[0].type, 'openrouter:web_search');
    }
  });
  test(`${provider}: registered research preserves progress, JSON and request options`, async () => {
    const result = await compare(provider, { publicResearch: true, chunks: [frame('{"title":'), frame('"한글"}', 'stop')] });
    assert.deepEqual(result.result, { title: '한글' });
    assert.deepEqual(only(result, 'progress'), [['progress', '{"title":', null], ['progress', '"한글"}', null]]);
    const request = only(result, 'request').at(-1);
    assert.equal(request[3], 12345);
    const body = JSON.parse(request[2].body);
    assert.equal(body.stream, true);
    if (provider === 'Groq') {
      assert.equal(body.max_tokens, undefined);
      assert.equal(body.max_completion_tokens, 16000);
    } else {
      assert.deepEqual(body.tools, []);
      assert.deepEqual(body.plugins, [{ id: 'web', enabled: false }]);
    }
  });
}

test('manifest loads reader before both consumers, which have no private reader copies', () => {
  const order = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8')).subfiles_extension;
  assert.equal(order.filter(file => file === 'AIStreamReader.js').length, 1);
  for (const provider of sources.keys()) {
    assert.ok(order.indexOf('AIStreamReader.js') < order.indexOf(`Addon_AI_${provider}.js`));
    assert.match(sources.get(provider).current, /window\.ivLyricsReadAIStream\(response\.body,/);
    assert.doesNotMatch(sources.get(provider).current, /new TextDecoder|function emitStreamingLines/);
  }
});
