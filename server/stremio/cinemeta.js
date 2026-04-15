const axios = require("axios");

/*
 * Cinemeta random-pick helper. Provides fresh random IMDb IDs for test
 * probes so addon checks aren't biased by a single hardcoded title rotting.
 */

const CINEMETA_BASE = "https://v3-cinemeta.strem.io";
const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10000;

const cache = {
    movie: { metas: null, fetchedAt: 0 },
    series: { metas: null, fetchedAt: 0 },
};

/**
 * Fetch and cache the top catalog for a given type.
 * @param {string} type "movie" or "series"
 * @param {object} options options bag
 * @returns {Promise<Array>} metas array
 */
async function getTopCatalog(type, options = {}) {
    const slot = cache[type];
    const now = Date.now();
    if (slot.metas && now - slot.fetchedAt < CACHE_TTL_MS) {
        return slot.metas;
    }
    const client = options.httpClient || axios;
    const url = `${CINEMETA_BASE}/catalog/${type}/top.json`;
    const res = await client.get(url, {
        timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        responseType: "json",
        validateStatus: (s) => s >= 200 && s < 300,
    });
    const metas = Array.isArray(res.data?.metas) ? res.data.metas : [];
    if (metas.length === 0) {
        throw new Error(`Cinemeta ${type} top catalog is empty`);
    }
    slot.metas = metas;
    slot.fetchedAt = now;
    return metas;
}

/**
 * Pick a random entry from the cached pool (selection is always random,
 * even when the pool is cached).
 * @param {Array} metas metas array
 * @returns {{id: string, name: string}} entry
 */
function pickRandom(metas) {
    const idx = Math.floor(Math.random() * metas.length);
    const m = metas[idx];
    return { id: m.id, name: m.name, poster: m.poster || null };
}

/**
 * Pick a random movie id.
 * @param {object} options options bag
 * @returns {Promise<{id: string, name: string}>} entry
 */
async function pickRandomMovieId(options = {}) {
    return pickRandom(await getTopCatalog("movie", options));
}

/**
 * Pick a random series id.
 * @param {object} options options bag
 * @returns {Promise<{id: string, name: string}>} entry
 */
async function pickRandomSeriesId(options = {}) {
    return pickRandom(await getTopCatalog("series", options));
}

/**
 * Clear the cache (test helper).
 * @returns {void}
 */
function _resetCache() {
    cache.movie = { metas: null, fetchedAt: 0 };
    cache.series = { metas: null, fetchedAt: 0 };
}

module.exports = {
    pickRandomMovieId,
    pickRandomSeriesId,
    _resetCache,
};
