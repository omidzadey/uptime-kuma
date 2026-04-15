const { MonitorType } = require("./monitor-type");
const { R } = require("redbean-node");
const { UP } = require("../../src/util");
const stremio = require("../stremio/client");
const cinemeta = require("../stremio/cinemeta");

const MAX_STORED_STREAMS = 50;
const MAX_STORED_METAS = 50;

class StremioAddonMonitorType extends MonitorType {
    name = "stremio-addon";
    supportsConditions = false;
    allowCustomStatus = false;

    /**
     * @inheritdoc
     */
    async check(monitor, heartbeat, _server) {
        const timeoutMs = (monitor.timeout && monitor.timeout > 0 ? monitor.timeout : 30) * 1000;
        const manifestUrl = monitor.stremio_manifest_url;
        if (!manifestUrl) {
            throw new Error("Manifest URL is not configured");
        }

        const diag = {
            manifestUrl,
            strategy: null,
            testedTypes: [],
            movie: null,
            series: null,
            catalog: null,
            checkedAt: new Date().toISOString(),
        };

        // Write diag to heartbeat even on throw — bean mutations pre-throw
        // survive into R.store(bean) (see server/model/monitor.js:949-1099).
        // bean.msg is overwritten with error.message in the catch path, so
        // user-facing UP/DOWN text lives in the thrown Error message.
        // beat() never re-stores the monitor bean, so persist explicitly.
        // bean.stremio_data rides along on R.store(bean) at monitor.js:1099.
        const persistDiag = async () => {
            const json = JSON.stringify(diag);
            heartbeat.stremio_data = json;
            monitor.stremio_last_check = json;
            try {
                await R.store(monitor);
            } catch (_) {
                // non-fatal: heartbeat still carries the diag
            }
        };

        let manifest;
        try {
            manifest = await stremio.fetchManifest(manifestUrl, { timeoutMs });
        } catch (e) {
            await persistDiag();
            throw new Error(`Manifest unreachable: ${e.message}`);
        }

        let strategy;
        try {
            strategy = stremio.pickStrategy(manifest);
        } catch (e) {
            await persistDiag();
            throw new Error(e.message);
        }
        diag.strategy = strategy;

        if (strategy.mode === "stream") {
            diag.testedTypes = strategy.types.slice();
            const results = {};

            for (const type of strategy.types) {
                let pick;
                try {
                    pick = type === "movie"
                        ? await cinemeta.pickRandomMovieId({ timeoutMs })
                        : await cinemeta.pickRandomSeriesId({ timeoutMs });
                } catch (e) {
                    await persistDiag();
                    throw new Error(`Cinemeta test-pick failed: ${e.message}`);
                }

                try {
                    const { streams } = await stremio.fetchStream(manifestUrl, type, pick.id, { timeoutMs });
                    results[type] = {
                        id: pick.id,
                        name: pick.name,
                        poster: pick.poster,
                        count: streams.length,
                        streams: streams.slice(0, MAX_STORED_STREAMS),
                    };
                } catch (e) {
                    results[type] = {
                        id: pick.id,
                        name: pick.name,
                        poster: pick.poster,
                        count: 0,
                        streams: [],
                        error: e.message,
                    };
                }
            }

            diag.movie = results.movie || null;
            diag.series = results.series || null;

            const anyOk = Object.values(results).some((r) => r.count > 1);
            if (!anyOk) {
                await persistDiag();
                const parts = Object.entries(results).map(([ t, r ]) => `${r.count} ${t}`);
                const anyError = Object.values(results).find((r) => r.error);
                const reason = anyError ? ` (${anyError.error})` : "";
                throw new Error(`Insufficient streams — ${parts.join(", ")}${reason}`);
            }

            const summary = Object.entries(results)
                .map(([ t, r ]) => `${r.count} ${t} (${r.id})`)
                .join(" / ");
            heartbeat.msg = `Stream OK — ${summary}`;
            heartbeat.status = UP;
            await persistDiag();
            return;
        }

        if (strategy.mode === "catalog") {
            diag.testedTypes = [ strategy.catalogType ];
            let metas;
            try {
                const res = await stremio.fetchCatalog(
                    manifestUrl,
                    strategy.catalogType,
                    strategy.catalogId,
                    { timeoutMs }
                );
                metas = res.metas;
            } catch (e) {
                await persistDiag();
                throw new Error(`Catalog request failed: ${e.message}`);
            }

            diag.catalog = {
                type: strategy.catalogType,
                id: strategy.catalogId,
                count: metas.length,
                metas: metas.slice(0, MAX_STORED_METAS),
            };

            if (metas.length === 0) {
                await persistDiag();
                throw new Error("Catalog returned 0 items");
            }

            heartbeat.msg = `Catalog OK — ${metas.length} items`;
            heartbeat.status = UP;
            await persistDiag();
            return;
        }

        await persistDiag();
        throw new Error(`Unknown strategy mode: ${strategy.mode}`);
    }
}

module.exports = {
    StremioAddonMonitorType,
};
