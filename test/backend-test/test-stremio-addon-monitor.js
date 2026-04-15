const { describe, test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { UP } = require("../../src/util");
const stremio = require("../../server/stremio/client");
const cinemeta = require("../../server/stremio/cinemeta");

// Stub R.store so check()'s persistDiag() doesn't touch the database.
const redbean = require("redbean-node");
if (!redbean.R.store || !redbean.R.store.__stubbed) {
    redbean.R.store = async () => {};
    redbean.R.store.__stubbed = true;
}

const { StremioAddonMonitorType } = require("../../server/monitor-types/stremio-addon");

function makeManifest(overrides = {}) {
    return {
        id: "test",
        version: "1.0.0",
        resources: [ "stream" ],
        types: [ "movie", "series" ],
        catalogs: [],
        ...overrides,
    };
}

const FAKE_META = { ms: 10, status: 200, cache: "DYNAMIC" };

/**
 * Wrap a bare manifest object in the new fetchManifest return shape.
 * @param {object} m bare manifest
 * @returns {{manifest: object, meta: object}} wrapped shape
 */
function wrapManifest(m) {
    return { manifest: m, meta: FAKE_META };
}

describe("stremio client.pickStrategy", () => {
    test("stream resource with movie+series → stream mode", () => {
        const s = stremio.pickStrategy(makeManifest());
        assert.strictEqual(s.mode, "stream");
        assert.deepStrictEqual(s.types.sort(), [ "movie", "series" ]);
    });

    test("stream resource, movie-only", () => {
        const s = stremio.pickStrategy(makeManifest({ types: [ "movie" ] }));
        assert.strictEqual(s.mode, "stream");
        assert.deepStrictEqual(s.types, [ "movie" ]);
    });

    test("catalog-only manifest → catalog mode", () => {
        const s = stremio.pickStrategy(makeManifest({
            resources: [ "catalog" ],
            catalogs: [ { type: "movie", id: "top" } ],
        }));
        assert.strictEqual(s.mode, "catalog");
        assert.strictEqual(s.catalogType, "movie");
        assert.strictEqual(s.catalogId, "top");
    });

    test("manifest with object-form resources", () => {
        const s = stremio.pickStrategy(makeManifest({
            resources: [ { name: "stream", types: [ "movie" ] } ],
            types: [],
        }));
        assert.strictEqual(s.mode, "stream");
        assert.deepStrictEqual(s.types, [ "movie" ]);
    });

    test("manifest with no usable resource → throw", () => {
        assert.throws(
            () => stremio.pickStrategy(makeManifest({ resources: [ "meta" ], catalogs: [] })),
            /no supported|no stream or catalog/i
        );
    });
});

describe("stremio client.buildResourceUrl", () => {
    test("strips only trailing /manifest.json", () => {
        const url = stremio.buildResourceUrl(
            "https://host.example/token/abc/manifest.json",
            "stream",
            "movie",
            "tt0903747"
        );
        assert.strictEqual(url, "https://host.example/token/abc/stream/movie/tt0903747.json");
    });
});

describe("StremioAddonMonitorType.check", () => {
    const type = new StremioAddonMonitorType();

    const origFetchManifest = stremio.fetchManifest;
    const origFetchStream = stremio.fetchStream;
    const origFetchCatalog = stremio.fetchCatalog;
    const origPickMovie = cinemeta.pickRandomMovieId;
    const origPickSeries = cinemeta.pickRandomSeriesId;

    beforeEach(() => {
        stremio.fetchManifest = origFetchManifest;
        stremio.fetchStream = origFetchStream;
        stremio.fetchCatalog = origFetchCatalog;
        cinemeta.pickRandomMovieId = origPickMovie;
        cinemeta.pickRandomSeriesId = origPickSeries;
    });

    test("stream UP when movie returns >1 streams", async () => {
        stremio.fetchManifest = async () => wrapManifest(makeManifest({ types: [ "movie", "series" ] }));
        cinemeta.pickRandomMovieId = async () => ({ id: "tt1", name: "Movie A" });
        cinemeta.pickRandomSeriesId = async () => ({ id: "tt2", name: "Series A" });
        const calls = [];
        stremio.fetchStream = async (_u, t, id) => {
            calls.push({ t, id });
            return {
                streams: t === "movie" ? [ {}, {}, {}, {}, {} ] : [],
                url: "",
                meta: FAKE_META,
            };
        };

        const monitor = { stremio_manifest_url: "https://h/manifest.json", timeout: 5 };
        const heartbeat = {};
        await type.check(monitor, heartbeat, null);
        assert.strictEqual(heartbeat.status, UP);
        assert.match(heartbeat.msg, /Stream OK/);
        const diag = JSON.parse(heartbeat.stremio_data);
        assert.strictEqual(diag.movie.count, 5);

        // Series stream ID must include season/episode per Stremio protocol.
        const movieCall = calls.find((c) => c.t === "movie");
        const seriesCall = calls.find((c) => c.t === "series");
        assert.strictEqual(movieCall.id, "tt1");
        assert.strictEqual(seriesCall.id, "tt2:1:1");
        // Diag should still store the bare IMDb id for the IMDb link.
        assert.strictEqual(diag.series.id, "tt2");
    });

    test("stream DOWN when movie and series both ≤1", async () => {
        stremio.fetchManifest = async () => wrapManifest(makeManifest({ types: [ "movie", "series" ] }));
        cinemeta.pickRandomMovieId = async () => ({ id: "tt1", name: "M" });
        cinemeta.pickRandomSeriesId = async () => ({ id: "tt2", name: "S" });
        stremio.fetchStream = async () => ({ streams: [ {} ], url: "", meta: FAKE_META });

        const monitor = { stremio_manifest_url: "https://h/manifest.json", timeout: 5 };
        const heartbeat = {};
        await assert.rejects(
            type.check(monitor, heartbeat, null),
            /Insufficient streams/
        );
        assert.ok(heartbeat.stremio_data);
    });

    test("manifest fetch fails → DOWN with clear error", async () => {
        stremio.fetchManifest = async () => {
            throw new Error("ENOTFOUND");
        };
        const monitor = { stremio_manifest_url: "https://h/manifest.json", timeout: 5 };
        const heartbeat = {};
        await assert.rejects(
            type.check(monitor, heartbeat, null),
            /Manifest unreachable/
        );
    });

    test("cinemeta fetch fails → DOWN with clear error", async () => {
        stremio.fetchManifest = async () => wrapManifest(makeManifest({ types: [ "movie" ] }));
        cinemeta.pickRandomMovieId = async () => {
            throw new Error("EAI_AGAIN");
        };
        const monitor = { stremio_manifest_url: "https://h/manifest.json", timeout: 5 };
        const heartbeat = {};
        await assert.rejects(
            type.check(monitor, heartbeat, null),
            /Cinemeta test-pick failed/
        );
    });

    test("catalog UP when metas non-empty", async () => {
        stremio.fetchManifest = async () => wrapManifest(makeManifest({
            resources: [ "catalog" ],
            catalogs: [ { type: "movie", id: "top" } ],
        }));
        stremio.fetchCatalog = async () => ({
            metas: new Array(25).fill({ id: "tt1", name: "x" }),
            url: "",
            meta: FAKE_META,
        });

        const monitor = { stremio_manifest_url: "https://h/manifest.json", timeout: 5 };
        const heartbeat = {};
        await type.check(monitor, heartbeat, null);
        assert.strictEqual(heartbeat.status, UP);
        assert.match(heartbeat.msg, /Catalog OK — 25 items/);
    });

    test("catalog DOWN when metas empty", async () => {
        stremio.fetchManifest = async () => wrapManifest(makeManifest({
            resources: [ "catalog" ],
            catalogs: [ { type: "movie", id: "top" } ],
        }));
        stremio.fetchCatalog = async () => ({ metas: [], url: "", meta: FAKE_META });

        const monitor = { stremio_manifest_url: "https://h/manifest.json", timeout: 5 };
        const heartbeat = {};
        await assert.rejects(
            type.check(monitor, heartbeat, null),
            /Catalog returned 0 items/
        );
    });

    test("diag blob populated on DOWN path", async () => {
        stremio.fetchManifest = async () => wrapManifest(makeManifest({
            resources: [ "catalog" ],
            catalogs: [ { type: "movie", id: "top" } ],
        }));
        stremio.fetchCatalog = async () => ({ metas: [], url: "", meta: FAKE_META });

        const monitor = { stremio_manifest_url: "https://h/manifest.json", timeout: 5 };
        const heartbeat = {};
        await assert.rejects(type.check(monitor, heartbeat, null));
        const diag = JSON.parse(heartbeat.stremio_data);
        assert.strictEqual(diag.catalog.count, 0);
        assert.strictEqual(diag.strategy.mode, "catalog");
    });
});
