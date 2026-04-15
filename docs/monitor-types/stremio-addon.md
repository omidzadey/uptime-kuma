# Stremio Addon Monitor

End-to-end health check for a Stremio addon. Goes beyond a plain HTTP probe by
actually exercising the addon's `stream` or `catalog` resource against real
titles pulled from Cinemeta.

## Adding a monitor

1. New Monitor → type **Stremio Addon**.
2. Paste the addon's `manifest.json` URL (or use the stremio-addons.net search
   box to find one and autofill the URL).
3. Save.

The backend validates the URL on save and then runs the first check.

## UP / DOWN rules

The monitor auto-detects the check strategy from the manifest:

- **Stream addons** (manifest declares the `stream` resource with `movie`
  and/or `series` types):
  - A fresh random IMDb ID is picked from Cinemeta's top movie and series
    catalogs on **every** check.
  - The monitor calls `/stream/{type}/{id}.json` on the addon for each
    supported type.
  - **UP** if _any_ tested type returns more than 1 stream.
  - **DOWN** otherwise (including 0 and 1 streams, or network errors).
  - A movie-only addon is only tested for movies; it won't be penalised for
    not serving series.

- **Catalog addons** (no stream resource, at least one catalog):
  - The first catalog listed in the manifest is fetched.
  - **UP** if it returns a non-empty `metas` array.
  - **DOWN** otherwise.

## Diagnostics

Every check writes a JSON diagnostic blob to the heartbeat row and to the
monitor's "last check" snapshot, so the **Details** page always shows:

- Which strategy was used (`stream` vs `catalog`).
- The exact movie / series titles and IMDb IDs tested on the last run, with
  their stream counts.
- For catalog mode, the catalog id, type, and item count.
- Timestamp of the last attempt.

DOWN heartbeats still carry the blob, so you can see _what_ failed, not just
that it failed.

## Recommended settings

- **Interval**: 300s (5 min) or higher. Addons aren't latency-critical and
  Cinemeta is a shared resource — don't pound it.
- **Retries**: 1 is usually enough; addons can be flaky.
- **Timeout**: default (30s) works for most addons.

## Notes

- **Cinemeta dependency**: if Cinemeta itself is down, stream-mode checks
  surface a clear `"Cinemeta test-pick failed: ..."` error so you can tell it
  apart from a real addon failure.
- **Config tokens in URLs**: manifest URLs of the form
  `https://host/<token>/manifest.json` are supported — only the trailing
  `/manifest.json` is stripped when deriving the resource base.
- **NSFW in search**: the stremio-addons.net v0 API exposes
  `nsfw=only|exclude` with no "include" value. v1 defaults to `exclude`.
