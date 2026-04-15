// Opt-in integration tests — hit real Cinemeta + public Stremio addons.
// Run with: RUN_STREMIO_INTEGRATION=1 node --test test/backend-test/test-stremio-addon-integration.js

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const skip = !process.env.RUN_STREMIO_INTEGRATION;

const { UP } = require("../../src/util");
const stremio = require("../../server/stremio/client");
const cinemeta = require("../../server/stremio/cinemeta");

// Stub R.store so check() doesn't need a DB.
const redbean = require("redbean-node");
if (!redbean.R.store || !redbean.R.store.__stubbed) {
    redbean.R.store = async () => {};
    redbean.R.store.__stubbed = true;
}

const { StremioAddonMonitorType } = require("../../server/monitor-types/stremio-addon");

describe("stremio integration", { skip }, () => {
    test("Cinemeta top catalogs return ≥20 movies and series", { timeout: 20000 }, async () => {
        const movie = await cinemeta.pickRandomMovieId({ timeoutMs: 15000 });
        const series = await cinemeta.pickRandomSeriesId({ timeoutMs: 15000 });
        assert.ok(movie.id.startsWith("tt"));
        assert.ok(series.id.startsWith("tt"));
    });

    test("Cinemeta manifest → catalog mode UP", { timeout: 20000 }, async () => {
        const type = new StremioAddonMonitorType();
        const monitor = {
            stremio_manifest_url: "https://v3-cinemeta.strem.io/manifest.json",
            timeout: 15,
        };
        const heartbeat = {};
        await type.check(monitor, heartbeat, null);
        assert.strictEqual(heartbeat.status, UP);
        assert.match(heartbeat.msg, /Catalog OK/);
    });

    test("nonexistent manifest → DOWN", { timeout: 20000 }, async () => {
        const type = new StremioAddonMonitorType();
        const monitor = {
            stremio_manifest_url: "https://does-not-exist.invalid/manifest.json",
            timeout: 5,
        };
        const heartbeat = {};
        await assert.rejects(type.check(monitor, heartbeat, null), /Manifest unreachable/);
    });

    test("pickStrategy on live Cinemeta manifest", { timeout: 15000 }, async () => {
        const manifest = await stremio.fetchManifest(
            "https://v3-cinemeta.strem.io/manifest.json",
            { timeoutMs: 10000 }
        );
        const s = stremio.pickStrategy(manifest);
        assert.strictEqual(s.mode, "catalog");
    });
});
