import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const cacheStart = indexSource.indexOf("const CacheManager = {");
const cacheEnd = indexSource.indexOf("\n// window에 등록", cacheStart);
assert.ok(cacheStart >= 0 && cacheEnd > cacheStart);

test("memory cache keeps lyric references, expiry and LRU without traversing lyric data", () => {
  let now = 0;
  let serializationReads = 0;
  const context = vm.createContext({ Date: { now: () => now } });
  vm.runInContext(`${indexSource.slice(cacheStart, cacheEnd)}\nglobalThis.cache = CacheManager;`, context);
  const cache = context.cache;
  cache._ttl = 100;
  cache._maxSize = 4;
  const lyrics = [{ text: "original", syllables: [{ text: "word", startTime: 1 }] }];
  Object.defineProperty(lyrics, "toJSON", {
    get() {
      serializationReads += 1;
      return undefined;
    },
  });

  cache.set("track:lyrics", lyrics);
  assert.strictEqual(cache.get("track:lyrics"), lyrics);
  assert.equal(serializationReads, 0);
  now = 1;
  cache.set("oldest", []);
  now = 2;
  cache.set("newer", []);
  now = 3;
  cache.set("newest", []);
  now = 4;
  assert.strictEqual(cache.get("track:lyrics"), lyrics);
  cache.set("overflow", []);
  assert.equal(cache.get("oldest"), null);
  assert.strictEqual(cache.get("track:lyrics"), lyrics);
  now = 101;
  assert.equal(cache.get("track:lyrics"), null);
});

test("cache replacement retains unrelated songs and uses access order when timestamps tie", () => {
  const context = vm.createContext({ Date: { now: () => 100 } });
  vm.runInContext(`${indexSource.slice(cacheStart, cacheEnd)}\nglobalThis.cache = CacheManager;`, context);
  const cache = context.cache;
  cache._maxSize = 3;
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  cache.set("a", 4);
  assert.equal(cache._cache.size, 3);
  assert.equal(cache.get("b"), 2);
  cache.set("d", 5);
  assert.equal(cache.get("c"), null);
  assert.equal(cache.get("a"), 4);
  assert.equal(cache.get("b"), 2);
});

test("small caches remain bounded and repeated initialization owns one cleanup timer", () => {
  const timers = new Set();
  const context = vm.createContext({
    Date, performance: {},
    setInterval: callback => { timers.add(callback); return callback; },
    clearInterval: callback => timers.delete(callback),
  });
  vm.runInContext(`${indexSource.slice(cacheStart, cacheEnd)}\nglobalThis.cache = CacheManager;`, context);
  const cache = context.cache;
  cache._maxSize = 1;
  for (let i = 0; i < 10; i++) cache.set(i, i);
  assert.equal(cache._cache.size, 1);
  assert.equal(cache.get(9), 9);
  cache.init();
  cache.init();
  assert.equal(timers.size, 1);
  cache.clear();
  assert.equal(timers.size, 0);
});

const serviceSource = readFileSync(new URL("../LyricsService.js", import.meta.url), "utf8");
// The fork keeps the shared lifecycle on LyricsSenderBase and the helper's own
// progress worker as a property descriptor on lyricsHelperSender.
const baseStart = serviceSource.indexOf("const LyricsSenderBase = {");
const stopStart = serviceSource.indexOf("        stopProgressSync() {", baseStart);
const stopEnd = serviceSource.indexOf("        teardownOffsetListener() {", stopStart);
const senderStart = serviceSource.indexOf("const lyricsHelperSender = Object.create(LyricsSenderBase, {");
const workerStart = serviceSource.indexOf("        startProgressSync: {", senderStart);
const workerEnd = serviceSource.indexOf("        stopProgressSync: {", workerStart);
assert.ok(baseStart >= 0 && stopStart > baseStart && stopEnd > stopStart);
assert.ok(senderStart >= 0 && workerStart > senderStart && workerEnd > workerStart);

const createSender = ({ failWorker = false } = {}) => {
  const urls = new Set();
  const workers = [];
  let createdCount = 0;
  const context = vm.createContext({
    Blob,
    URL: {
      createObjectURL() {
        const url = `blob:test-${++createdCount}`;
        urls.add(url);
        return url;
      },
      revokeObjectURL(url) { urls.delete(url); },
    },
    Worker: class {
      constructor(url) {
        assert.ok(urls.has(url), "the worker must receive a live URL");
        if (failWorker) throw new Error("worker startup failed");
        this.messages = [];
        workers.push(this);
      }
      postMessage(message) { this.messages.push(message); }
      terminate() { this.terminated = true; }
    },
  });
  vm.runInContext(`
    const cleanupWorker = (worker) => { worker.postMessage('stop'); worker.terminate(); };
    const base = { ${serviceSource.slice(stopStart, stopEnd)} };
    globalThis.sender = Object.create(base, { enabled: { value: true }, isConnected: { value: true }, ${serviceSource.slice(workerStart, workerEnd)} });
  `, context);
  return { sender: context.sender, urls, workers };
};

test("helper worker starts once, restarts after stop, and releases each Blob URL", () => {
  const { sender, urls, workers } = createSender();
  sender.startProgressSync();
  sender.startProgressSync();
  assert.equal(workers.length, 1);
  assert.deepEqual(workers[0].messages, ["start"]);
  assert.equal(urls.size, 0);
  sender.stopProgressSync();
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(workers[0].messages, ["start", "stop"]);
  sender.startProgressSync();
  assert.equal(workers.length, 2);
  assert.equal(urls.size, 0);
  sender.stopProgressSync();
});

test("helper worker releases its Blob URL when startup fails", () => {
  const { sender, urls } = createSender({ failWorker: true });
  assert.throws(() => sender.startProgressSync(), /worker startup failed/);
  assert.equal(urls.size, 0);
  assert.equal(sender._worker, undefined);
});
