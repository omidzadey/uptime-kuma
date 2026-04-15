const STREMIO_ADDONS_HUB_BASE = "https://stremio-addons.net";

/**
 * Search the stremio-addons.net v0 API.
 *
 * CORS is permissive (Access-Control-Allow-Origin: *) so we call directly
 * from the browser. NSFW is excluded by default; the v0 API only exposes
 * nsfw=only|exclude with no "include" value.
 *
 * @param {object} params
 * @param {string} [params.search] free-text query
 * @param {number} [params.limit=20]
 * @param {string} [params.sort_by="stars"]
 * @param {string} [params.order="desc"]
 * @param {string} [params.nsfw="exclude"]
 * @returns {Promise<Array<{name:string, manifestUrl:string, description?:string, stars?:number, slug?:string}>>}
 */
export async function searchStremioAddonsHub(params = {}) {
    const qs = new URLSearchParams();
    if (params.search) {
        qs.set("search", params.search);
    }
    qs.set("limit", String(params.limit ?? 20));
    qs.set("sort_by", params.sort_by ?? "stars");
    qs.set("order", params.order ?? "desc");
    qs.set("nsfw", params.nsfw ?? "exclude");

    const url = `${STREMIO_ADDONS_HUB_BASE}/api/v0/addons?${qs.toString()}`;
    const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
    });
    if (!res.ok) {
        throw new Error(`stremio-addons.net HTTP ${res.status}`);
    }
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body?.addons ?? body?.data ?? []);
    return list.map((a) => ({
        name: a.name ?? a.title ?? a.slug ?? "unknown",
        manifestUrl: a.manifestUrl ?? a.manifest_url ?? a.url ?? "",
        description: a.description ?? a.desc ?? "",
        stars: typeof a.stars === "number" ? a.stars : (a.rating ?? null),
        slug: a.slug ?? "",
    })).filter((a) => a.manifestUrl);
}
