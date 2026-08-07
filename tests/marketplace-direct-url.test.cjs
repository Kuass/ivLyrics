const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const managerSource = fs.readFileSync(path.join(root, "MarketplaceManager.js"), "utf8");
const uiSource = fs.readFileSync(path.join(root, "Marketplace.js"), "utf8");

const translationKeys = [
  "browseTab",
  "installedTab",
  "addFromUrl",
  "searchInstalled",
  "installedNotice",
  "loading",
  "uninstallError",
  "directUrlTitle",
  "directWarningTitle",
  "directWarningBody",
  "directUrlLabel",
  "directUrlPlaceholder",
  "directSnapshotNotice",
  "directConsent",
  "directInstallSuccess",
  "directErrorUrl",
  "directErrorDownload",
  "directErrorMetadata",
  "directErrorDuplicate",
  "directErrorGeneric",
  "sourceDirect",
  "sourceUnavailable",
  "loadFailed",
  "viewSource",
  "installedEmpty",
];

function createManagerHarness() {
  const lyricsAddons = new Map();
  const createRuntimeManager = (addons) => ({
    getAddon: (id) => addons.get(id) || null,
    register: (addon) => {
      addons.set(addon.id, addon);
      return true;
    },
    unregister: (id) => addons.delete(id),
    markAsMarketplaceAddon() {},
    getProviderOrder: () => [],
    setProviderOrder() {},
  });

  const window = {
    Spicetify: { LocalStorage: {} },
    LyricsAddonManager: createRuntimeManager(lyricsAddons),
    AIAddonManager: createRuntimeManager(new Map()),
  };
  const context = {
    window,
    Spicetify: window.Spicetify,
    indexedDB: { open: () => ({}) },
    Blob,
    URL,
    AbortController,
    console,
    fetch: async () => {
      throw new Error("fetch not stubbed");
    },
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
  };
  vm.runInNewContext(managerSource, context, { filename: "MarketplaceManager.js" });
  return { manager: window.MarketplaceManager, context, lyricsAddons };
}

test("direct URL validation only accepts credential-free HTTPS .js paths", () => {
  const { manager } = createManagerHarness();

  assert.equal(
    manager._validateDirectAddonUrl("https://example.com/addon.js#latest"),
    "https://example.com/addon.js"
  );
  assert.throws(() => manager._validateDirectAddonUrl("http://example.com/addon.js"), { code: "HTTPS_REQUIRED" });
  assert.throws(() => manager._validateDirectAddonUrl("https://example.com/addon.txt"), { code: "JS_REQUIRED" });
  assert.throws(() => manager._validateDirectAddonUrl("https://user:pass@example.com/addon.js"), { code: "INVALID_URL" });
});

test("direct addon metadata is inferred without evaluating downloaded code", () => {
  const { manager } = createManagerHarness();
  const code = `
    /** @author Example Dev @version 2.4.1 */
    (() => {
      const ADDON_INFO = {
        id: 'direct-test',
        name: 'Direct Test',
        author: 'Example Dev',
        version: '2.4.1'
      };
      window.LyricsAddonManager.register({ ...ADDON_INFO });
    })();
  `;

  const metadata = manager._extractDirectAddonMetadata(code, "https://example.com/direct-test.js");
  assert.equal(metadata.runtimeId, "direct-test");
  assert.equal(metadata.name, "Direct Test");
  assert.equal(metadata.type, "lyrics");
  assert.equal(metadata.source, "direct-url");
  assert.match(metadata.id, /^direct-url:/);
});

test("installed records remain queryable and removable after a load failure", async () => {
  const { manager } = createManagerHarness();
  const removedRuntimeIds = [];
  manager._dbDelete = async () => {};
  manager._installedAddons.set("missing/source-addon", {
    id: "missing/source-addon",
    code: "throw new Error('broken')",
    metadata: {
      name: "Missing Source",
      type: "lyrics",
      runtimeId: "missing-runtime",
      source: "marketplace",
    },
    installedAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
  });
  manager._loadErrors.set("missing/source-addon", "Script load failed");
  manager._removeFromProviderOrder = (runtimeId) => removedRuntimeIds.push(runtimeId);

  const installed = manager.getInstalledAddons();
  assert.equal(installed.length, 1);
  assert.equal(installed[0].loadStatus, "failed");

  await manager.uninstallAddon("missing/source-addon");
  assert.equal(manager.getInstalledAddons().length, 0);
  assert.deepEqual(removedRuntimeIds, ["missing-runtime"]);
});

test("Marketplace UI includes direct install warning and installed management", () => {
  assert.match(uiSource, /installAddonFromUrl/);
  assert.match(uiSource, /directWarningBody/);
  assert.match(uiSource, /directConsent/);
  assert.match(uiSource, /getInstalledAddons/);
  assert.match(uiSource, /sourceUnavailable/);
  assert.match(uiSource, /uninstallAddon/);
});

test("all bundled languages include every new Marketplace string", () => {
  const languageFiles = fs.readdirSync(path.join(root, "langs"))
    .filter((file) => /^Lang.*\.js$/.test(file));

  assert.equal(languageFiles.length, 22);
  for (const file of languageFiles) {
    const source = fs.readFileSync(path.join(root, "langs", file), "utf8");
    const marketplaceStart = source.indexOf('"marketplace": {');
    assert.notEqual(marketplaceStart, -1, `${file} has no marketplace section`);
    const marketplaceSection = source.slice(marketplaceStart);
    for (const key of translationKeys) {
      assert.match(marketplaceSection, new RegExp(`"${key}"\\s*:`), `${file} is missing marketplace.${key}`);
    }
  }
});
