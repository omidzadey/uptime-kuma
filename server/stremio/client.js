const axios = require("axios");

/*
 * Thin wrapper around the Stremio Addon protocol. Raw HTTP (axios) is used
 * rather than the Stremio Addon SDK because the SDK targets addon *authors*,
 * not clients. All outbound Stremio requests go through this module so a
 * future swap (SDK, custom transport, per-monitor auth) is localised.
 *
 * Extension points for future work:
 *  - fetchStream / fetchCatalog accept an `options` bag; per-monitor auth
 *    headers or API keys can be threaded through here without API churn.
 *  - pickStrategy returns a tagged object; adding meta/subtitles support is
 *    a new mode branch in the object and a new case in the monitor check().
 */

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Classify an HTTP response's cache status from its headers.
 *
 * Priority: explicit CDN cache header > Cache-Control directives > fallback.
 * @param {object} headers response headers (axios-style, lowercased keys)
 * @returns {"HIT"|"MISS"|"DYNAMIC"|"STATIC"} classification
 */
function classifyCache(headers) {
    const h = (name) => {
        if (!headers) {
            return "";
        }
        const v = headers[name] ?? headers[name.toLowerCase()] ?? "";
        return String(v).toLowerCase();
    };
    const cdn = h("x-cache") || h("cf-cache-status") || h("x-vercel-cache");
    if (cdn.includes("hit")) {
        return "HIT";
    }
    if (cdn.includes("miss")) {
        return "MISS";
    }
    if (cdn.includes("dynamic")) {
        return "DYNAMIC";
    }
    const cc = h("cache-control");
    if (cc.includes("no-store") || cc.includes("no-cache") || cc.includes("private")) {
        return "DYNAMIC";
    }
    if (/max-age=\d+/.test(cc)) {
        return "STATIC";
    }
    return "DYNAMIC";
}

/**
 * Build a {ms, status, cache} meta record for an addon fetch.
 * @param {number} startedAt Date.now() before the request
 * @param {object} res axios response
 * @returns {{ms: number, status: number, cache: string}} meta
 */
function buildMeta(startedAt, res) {
    return {
        ms: Date.now() - startedAt,
        status: res?.status ?? 0,
        cache: classifyCache(res?.headers),
    };
}

/**
 * Derive an addon base URL from its manifest URL.
 *
 * Stremio addons may encode per-user config into the URL path BEFORE
 * `/manifest.json` (e.g. `https://host/<token>/manifest.json`). We must
 * strip ONLY the trailing `/manifest.json` segment so that per-addon
 * config tokens are preserved in the base.
 * @param {string} manifestUrl manifest URL
 * @returns {string} base URL
 */
function manifestToBase(manifestUrl) {
    return String(manifestUrl).replace(/\/manifest\.json$/, "");
}

/**
 * Build a resource URL per the Stremio addon protocol:
 *   <base>/<resource>/<type>/<id>.json
 * @param {string} manifestUrl manifest URL
 * @param {string} resource resource name (stream, catalog, ...)
 * @param {string} type type (movie, series, ...)
 * @param {string} id content id (e.g. tt0903747 for stream, "top" for catalog)
 * @returns {string} fully qualified resource URL
 */
function buildResourceUrl(manifestUrl, resource, type, id) {
    const base = manifestToBase(manifestUrl);
    return `${base}/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
}

/**
 * Fetch and parse an addon manifest.
 * @param {string} manifestUrl manifest URL
 * @param {object} options options bag
 * @param {number} options.timeoutMs timeout
 * @param {object} options.httpClient injectable axios-like client (for tests)
 * @returns {Promise<{manifest: object, meta: {ms: number, status: number, cache: string}}>} parsed manifest + fetch meta
 */
async function fetchManifest(manifestUrl, options = {}) {
    const client = options.httpClient || axios;
    const startedAt = Date.now();
    const res = await client.get(manifestUrl, {
        timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        responseType: "json",
        validateStatus: (s) => s >= 200 && s < 300,
    });
    if (!res.data || typeof res.data !== "object") {
        throw new Error("Manifest is not a JSON object");
    }
    return { manifest: res.data, meta: buildMeta(startedAt, res) };
}

/**
 * Fetch streams for a given type/id.
 * @param {string} manifestUrl manifest URL
 * @param {string} type type
 * @param {string} id id
 * @param {object} options options bag
 * @returns {Promise<{streams: Array}>} stream response
 */
async function fetchStream(manifestUrl, type, id, options = {}) {
    const client = options.httpClient || axios;
    const url = buildResourceUrl(manifestUrl, "stream", type, id);
    const startedAt = Date.now();
    const res = await client.get(url, {
        timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        responseType: "json",
        validateStatus: (s) => s >= 200 && s < 300,
    });
    const streams = Array.isArray(res.data?.streams) ? res.data.streams : [];
    return { streams, url, meta: buildMeta(startedAt, res) };
}

/**
 * Fetch a catalog for a given type/id.
 * @param {string} manifestUrl manifest URL
 * @param {string} type type
 * @param {string} catalogId catalog id
 * @param {object} options options bag
 * @returns {Promise<{metas: Array}>} catalog response
 */
async function fetchCatalog(manifestUrl, type, catalogId, options = {}) {
    const client = options.httpClient || axios;
    const url = buildResourceUrl(manifestUrl, "catalog", type, catalogId);
    const startedAt = Date.now();
    const res = await client.get(url, {
        timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        responseType: "json",
        validateStatus: (s) => s >= 200 && s < 300,
    });
    const metas = Array.isArray(res.data?.metas) ? res.data.metas : [];
    return { metas, url, meta: buildMeta(startedAt, res) };
}

/**
 * Normalise a manifest's `resources` field. An entry may be a plain string
 * ("stream") or an object like `{ name: "stream", types: [...] }`.
 * @param {object} manifest manifest object
 * @returns {Array<{name: string, types: ?Array<string>}>} normalised list
 */
function normaliseResources(manifest) {
    const raw = Array.isArray(manifest?.resources) ? manifest.resources : [];
    return raw.map((r) => {
        if (typeof r === "string") {
            return { name: r, types: null };
        }
        if (r && typeof r === "object" && typeof r.name === "string") {
            return { name: r.name, types: Array.isArray(r.types) ? r.types : null };
        }
        return { name: "", types: null };
    }).filter((r) => r.name);
}

/**
 * Decide how to health-check this manifest.
 *
 * Preference order:
 *   1. stream resource with movie and/or series types
 *   2. first catalog entry whose type is movie or series, else any catalog
 *
 * @param {object} manifest manifest object
 * @returns {{mode: string, types?: Array<string>, catalogType?: string, catalogId?: string}} strategy
 */
function pickStrategy(manifest) {
    const manifestTypes = Array.isArray(manifest?.types) ? manifest.types : [];
    const resources = normaliseResources(manifest);
    const streamRes = resources.find((r) => r.name === "stream");

    if (streamRes) {
        const streamTypes = streamRes.types || manifestTypes;
        const supported = ["movie", "series"].filter((t) => streamTypes.includes(t));
        if (supported.length > 0) {
            return { mode: "stream", types: supported };
        }
    }

    const catalogs = Array.isArray(manifest?.catalogs) ? manifest.catalogs : [];
    if (catalogs.length > 0) {
        const preferred = catalogs.find((c) => c && (c.type === "movie" || c.type === "series")) || catalogs[0];
        if (preferred && preferred.type && preferred.id) {
            return { mode: "catalog", catalogType: preferred.type, catalogId: preferred.id };
        }
    }

    throw new Error("Manifest has no stream or catalog resources Kuma can check");
}

module.exports = {
    fetchManifest,
    fetchStream,
    fetchCatalog,
    pickStrategy,
    buildResourceUrl,
    manifestToBase,
    normaliseResources,
    classifyCache,
};
