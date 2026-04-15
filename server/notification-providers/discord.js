const NotificationProvider = require("./notification-provider");
const axios = require("axios");
const { DOWN, UP, PENDING, MAINTENANCE } = require("../../src/util");

// Status → Discord embed stripe color (left bar of the embed)
const STATUS_COLOR = {
    [UP]: 65280,           // green
    [DOWN]: 16711680,      // red
    [PENDING]: 16753920,   // orange
    [MAINTENANCE]: 10070709, // grey-blue
};

const CACHE_EMOJI = {
    HIT: "✅",
    MISS: "⚠️",
    DYNAMIC: "⚡",
    STATIC: "📦",
};

class Discord extends NotificationProvider {
    name = "discord";

    /**
     * @inheritdoc
     */
    async send(notification, msg, monitorJSON = null, heartbeatJSON = null) {
        const okMsg = "Sent Successfully.";

        // Discord Message Flags
        // @see https://discord.com/developers/docs/resources/message#message-object-message-flags
        // This message will not trigger push and desktop notifications
        const SUPPRESS_NOTIFICATIONS_FLAG = 1 << 12;

        try {
            let config = this.getAxiosConfigWithProxy({});
            const discordDisplayName = notification.discordUsername || "Uptime Kuma";
            const webhookUrl = new URL(notification.discordWebhookUrl);
            if (notification.discordChannelType === "postToThread") {
                webhookUrl.searchParams.append("thread_id", notification.threadId);
            }

            // Check if the webhook has an avatar
            let webhookHasAvatar = true;
            try {
                const webhookInfo = await axios.get(webhookUrl.toString(), config);
                webhookHasAvatar = !!webhookInfo.data.avatar;
            } catch (e) {
                // If we can't verify, we assume he has an avatar to avoid forcing the default avatar
                webhookHasAvatar = true;
            }

            const messageFormat =
                notification.discordMessageFormat || (notification.discordUseMessageTemplate ? "custom" : "normal");

            // If heartbeatJSON is null, assume we're testing.
            if (heartbeatJSON == null) {
                let content = msg;
                if (messageFormat === "minimalist") {
                    content = "Test: " + msg;
                } else if (messageFormat === "custom") {
                    const customMessage = notification.discordMessageTemplate?.trim() || "";
                    if (customMessage !== "") {
                        content = await this.renderTemplate(customMessage, msg, monitorJSON, heartbeatJSON);
                    }
                }
                let discordtestdata = {
                    username: discordDisplayName,
                    content: content,
                };
                if (!webhookHasAvatar) {
                    discordtestdata.avatar_url = "https://github.com/louislam/uptime-kuma/raw/master/public/icon.png";
                }
                if (notification.discordChannelType === "createNewForumPost") {
                    discordtestdata.thread_name = notification.postName;
                }
                if (notification.discordSuppressNotifications) {
                    discordtestdata.flags = SUPPRESS_NOTIFICATIONS_FLAG;
                }
                await axios.post(webhookUrl.toString(), discordtestdata, config);
                return okMsg;
            }

            // If heartbeatJSON is not null, we go into the normal alerting loop.
            let addess = this.extractAddress(monitorJSON);

            // Minimalist: status + name only (is down / is up; no "back up" — may be first trigger)
            if (messageFormat === "minimalist") {
                const content =
                    heartbeatJSON["status"] === DOWN
                        ? "🔴 " + monitorJSON["name"] + " is down."
                        : "🟢 " + monitorJSON["name"] + " is up.";
                let payload = {
                    username: discordDisplayName,
                    content: content,
                };
                if (!webhookHasAvatar) {
                    payload.avatar_url = "https://github.com/louislam/uptime-kuma/raw/master/public/icon.png";
                }
                if (notification.discordChannelType === "createNewForumPost") {
                    payload.thread_name = notification.postName;
                }
                if (notification.discordSuppressNotifications) {
                    payload.flags = SUPPRESS_NOTIFICATIONS_FLAG;
                }
                await axios.post(webhookUrl.toString(), payload, config);
                return okMsg;
            }

            // Custom template: send only content (no embeds)
            const useCustomTemplate =
                messageFormat === "custom" && (notification.discordMessageTemplate?.trim() || "") !== "";
            if (useCustomTemplate) {
                const content = await this.renderTemplate(
                    notification.discordMessageTemplate.trim(),
                    msg,
                    monitorJSON,
                    heartbeatJSON
                );
                let payload = {
                    username: discordDisplayName,
                    content: content,
                };
                if (!webhookHasAvatar) {
                    payload.avatar_url = "https://github.com/louislam/uptime-kuma/raw/master/public/icon.png";
                }
                if (notification.discordChannelType === "createNewForumPost") {
                    payload.thread_name = notification.postName;
                }
                if (notification.discordSuppressNotifications) {
                    payload.flags = SUPPRESS_NOTIFICATIONS_FLAG;
                }
                await axios.post(webhookUrl.toString(), payload, config);
                return okMsg;
            }

            // Stremio Addon monitor: build a richer embed using the diag blob
            // captured by server/monitor-types/stremio-addon.js. Falls through
            // to the generic UP/DOWN embeds on any parse failure so a broken
            // addon can never break the notification.
            if (monitorJSON?.["type"] === "stremio-addon" && heartbeatJSON?.["stremio_data"]) {
                const stremioEmbed = this.buildStremioEmbed(monitorJSON, heartbeatJSON);
                if (stremioEmbed) {
                    let payload = {
                        username: discordDisplayName,
                        embeds: [ stremioEmbed ],
                    };
                    if (!webhookHasAvatar) {
                        payload.avatar_url = "https://github.com/louislam/uptime-kuma/raw/master/public/icon.png";
                    }
                    if (notification.discordChannelType === "createNewForumPost") {
                        payload.thread_name = notification.postName;
                    }
                    if (notification.discordPrefixMessage) {
                        payload.content = notification.discordPrefixMessage;
                    }
                    if (notification.discordSuppressNotifications) {
                        payload.flags = SUPPRESS_NOTIFICATIONS_FLAG;
                    }
                    await axios.post(webhookUrl.toString(), payload, config);
                    return okMsg;
                }
            }

            if (heartbeatJSON["status"] === DOWN) {
                const wentOfflineTimestamp = Math.floor(new Date(heartbeatJSON["time"]).getTime() / 1000);

                let discorddowndata = {
                    username: discordDisplayName,
                    embeds: [
                        {
                            title: "❌ Your service " + monitorJSON["name"] + " went down. ❌",
                            color: 16711680,
                            timestamp: heartbeatJSON["time"],
                            fields: [
                                {
                                    name: "Service Name",
                                    value: monitorJSON["name"],
                                },
                                ...(!notification.disableUrl && addess
                                    ? [
                                          {
                                              name: monitorJSON["type"] === "push" ? "Service Type" : "Service URL",
                                              value: addess,
                                          },
                                      ]
                                    : []),
                                {
                                    name: "Went Offline",
                                    // F for full date/time
                                    value: `<t:${wentOfflineTimestamp}:F>`,
                                },
                                {
                                    name: `Time (${heartbeatJSON["timezone"]})`,
                                    value: heartbeatJSON["localDateTime"],
                                },
                                {
                                    name: "Error",
                                    value: heartbeatJSON["msg"] == null ? "N/A" : heartbeatJSON["msg"],
                                },
                            ],
                        },
                    ],
                };
                if (!webhookHasAvatar) {
                    discorddowndata.avatar_url = "https://github.com/louislam/uptime-kuma/raw/master/public/icon.png";
                }
                if (notification.discordChannelType === "createNewForumPost") {
                    discorddowndata.thread_name = notification.postName;
                }
                if (notification.discordPrefixMessage) {
                    discorddowndata.content = notification.discordPrefixMessage;
                }
                if (notification.discordSuppressNotifications) {
                    discorddowndata.flags = SUPPRESS_NOTIFICATIONS_FLAG;
                }

                await axios.post(webhookUrl.toString(), discorddowndata, config);
                return okMsg;
            } else if (heartbeatJSON["status"] === UP) {
                const backOnlineTimestamp = Math.floor(new Date(heartbeatJSON["time"]).getTime() / 1000);
                let downtimeDuration = null;
                let wentOfflineTimestamp = null;
                if (heartbeatJSON["lastDownTime"]) {
                    wentOfflineTimestamp = Math.floor(new Date(heartbeatJSON["lastDownTime"]).getTime() / 1000);
                    downtimeDuration = this.formatDuration(backOnlineTimestamp - wentOfflineTimestamp);
                }

                let discordupdata = {
                    username: discordDisplayName,
                    embeds: [
                        {
                            title: "✅ Your service " + monitorJSON["name"] + " is up! ✅",
                            color: 65280,
                            timestamp: heartbeatJSON["time"],
                            fields: [
                                {
                                    name: "Service Name",
                                    value: monitorJSON["name"],
                                },
                                ...(!notification.disableUrl && addess
                                    ? [
                                          {
                                              name: monitorJSON["type"] === "push" ? "Service Type" : "Service URL",
                                              value: addess,
                                          },
                                      ]
                                    : []),
                                ...(wentOfflineTimestamp
                                    ? [
                                          {
                                              name: "Went Offline",
                                              // F for full date/time
                                              value: `<t:${wentOfflineTimestamp}:F>`,
                                          },
                                      ]
                                    : []),
                                ...(downtimeDuration
                                    ? [
                                          {
                                              name: "Downtime Duration",
                                              value: downtimeDuration,
                                          },
                                      ]
                                    : []),
                                // Show server timezone for parity with the DOWN notification embed
                                {
                                    name: `Time (${heartbeatJSON["timezone"]})`,
                                    value: heartbeatJSON["localDateTime"],
                                },
                                ...(heartbeatJSON["ping"] != null
                                    ? [
                                          {
                                              name: "Ping",
                                              value: heartbeatJSON["ping"] + " ms",
                                          },
                                      ]
                                    : []),
                            ],
                        },
                    ],
                };
                if (!webhookHasAvatar) {
                    discordupdata.avatar_url = "https://github.com/louislam/uptime-kuma/raw/master/public/icon.png";
                }

                if (notification.discordChannelType === "createNewForumPost") {
                    discordupdata.thread_name = notification.postName;
                }

                if (notification.discordPrefixMessage) {
                    discordupdata.content = notification.discordPrefixMessage;
                }
                if (notification.discordSuppressNotifications) {
                    discordupdata.flags = SUPPRESS_NOTIFICATIONS_FLAG;
                }

                await axios.post(webhookUrl.toString(), discordupdata, config);
                return okMsg;
            }
        } catch (error) {
            this.throwGeneralAxiosError(error);
        }
    }

    /**
     * Build a Discord embed tailored for the Stremio Addon monitor type.
     *
     * Mirrors the layout of src/components/StremioCheckDetails.vue: a compact
     * card with status / timing / cache / count rows plus linked movie & series
     * titles. Returns null if the diag blob is missing or malformed so the
     * caller can fall back to the generic embed.
     * @param {object} monitorJSON serialized monitor
     * @param {object} heartbeatJSON serialized heartbeat (must include stremio_data)
     * @returns {?object} Discord embed object, or null to fall through
     */
    buildStremioEmbed(monitorJSON, heartbeatJSON) {
        let diag;
        try {
            diag = JSON.parse(heartbeatJSON["stremio_data"]);
        } catch (_) {
            return null;
        }
        if (!diag || typeof diag !== "object") {
            return null;
        }

        const status = heartbeatJSON["status"];
        const isUp = status === UP;
        const color = STATUS_COLOR[status] ?? STATUS_COLOR[DOWN];

        // Wrap values in a single-line code block so Discord renders them
        // as the boxed monospaced cells shown in the reference screenshot.
        const box = (v) => "```\n" + v + "\n```";
        const fmtSeconds = (ms) => {
            if (typeof ms !== "number") {
                return box("—");
            }
            return box(`${(ms / 1000).toFixed(3)}s`);
        };
        const fmtCache = (cache) => {
            if (!cache) {
                return box("—");
            }
            const emoji = CACHE_EMOJI[cache] || "";
            return box(`${emoji} ${cache}`.trim());
        };
        const fmtCount = (n) => box(typeof n === "number" ? String(n) : "—");
        const fmtStatus = (v) => box(v);
        const truncate = (s, max) => {
            if (!s) {
                return "";
            }
            const str = String(s);
            return str.length > max ? str.slice(0, max - 1) + "…" : str;
        };
        const imdbLink = (id, name) => {
            if (!id || !name) {
                return null;
            }
            if (/^tt\d+$/.test(id)) {
                return `[${truncate(name, 80)}](https://www.imdb.com/title/${id}/)`;
            }
            return truncate(name, 80);
        };

        const hasManifest = !!diag.manifestMeta;
        const hasMovie = !!diag.movie;
        const hasSeries = !!diag.series;
        const hasCatalog = !!diag.catalog;

        const movieOk = hasMovie && !diag.movie.error && (diag.movie.count ?? 0) > 0;
        const seriesOk = hasSeries && !diag.series.error && (diag.series.count ?? 0) > 0;

        const fields = [];

        // Row 1: Status badges (Manifest / Movie Search / Series Search) — or catalog variant
        fields.push({
            name: "Manifest",
            value: fmtStatus(hasManifest ? "✓ Valid" : "✗ Failed"),
            inline: true,
        });
        if (hasCatalog) {
            fields.push({
                name: "Catalog",
                value: fmtStatus(diag.catalog.count > 0 ? "✓ Working" : "✗ Empty"),
                inline: true,
            });
            fields.push({
                name: "Strategy",
                value: fmtStatus(`catalog (${diag.catalog.type})`),
                inline: true,
            });
        } else {
            fields.push({
                name: "Movie Search",
                value: fmtStatus(hasMovie ? (movieOk ? "✓ Working" : "✗ Failed") : "—"),
                inline: true,
            });
            fields.push({
                name: "Series Search",
                value: fmtStatus(hasSeries ? (seriesOk ? "✓ Working" : "✗ Failed") : "—"),
                inline: true,
            });
        }

        // Row 2: Timings
        fields.push({
            name: "Manifest Time",
            value: fmtSeconds(diag.manifestMeta?.ms),
            inline: true,
        });
        if (hasCatalog) {
            fields.push({
                name: "Catalog Time",
                value: fmtSeconds(diag.catalog.meta?.ms),
                inline: true,
            });
            fields.push({
                name: "Total Time",
                value: fmtSeconds(diag.totalMs),
                inline: true,
            });
        } else {
            fields.push({
                name: "Movie Time",
                value: fmtSeconds(diag.movie?.meta?.ms),
                inline: true,
            });
            fields.push({
                name: "Series Time",
                value: fmtSeconds(diag.series?.meta?.ms),
                inline: true,
            });
        }

        // Row 3: Cache status
        fields.push({
            name: "Manifest Cache",
            value: fmtCache(diag.manifestMeta?.cache),
            inline: true,
        });
        if (hasCatalog) {
            fields.push({
                name: "Catalog Cache",
                value: fmtCache(diag.catalog.meta?.cache),
                inline: true,
            });
            fields.push({
                name: "Items",
                value: fmtCount(diag.catalog.count),
                inline: true,
            });
        } else {
            fields.push({
                name: "Movie Cache",
                value: fmtCache(diag.movie?.meta?.cache),
                inline: true,
            });
            fields.push({
                name: "Series Cache",
                value: fmtCache(diag.series?.meta?.cache),
                inline: true,
            });
        }

        // Row 4 (stream mode only): Stream counts + total time
        if (!hasCatalog) {
            fields.push({
                name: "Movie Streams",
                value: fmtCount(diag.movie?.count),
                inline: true,
            });
            fields.push({
                name: "Series Streams",
                value: fmtCount(diag.series?.count),
                inline: true,
            });
            fields.push({
                name: "Total Time",
                value: fmtSeconds(diag.totalMs),
                inline: true,
            });
        }

        // Row 5 (stream mode): linked movie/series titles (IMDb)
        if (!hasCatalog) {
            const movieLink = hasMovie ? imdbLink(diag.movie.id, diag.movie.name) : null;
            const seriesLink = hasSeries ? imdbLink(diag.series.id, diag.series.name) : null;
            if (movieLink) {
                fields.push({
                    name: "Tested Movie",
                    value: `${movieLink}\n\`${diag.movie.id}\``,
                    inline: true,
                });
            }
            if (seriesLink) {
                fields.push({
                    name: "Tested Series",
                    value: `${seriesLink}\n\`${diag.series.id}\``,
                    inline: true,
                });
            }
        }

        // Manifest URL (full-width)
        fields.push({
            name: "Manifest URL",
            value: "`" + truncate(diag.manifestUrl || "", 200) + "`",
            inline: false,
        });

        // Error (DOWN only)
        if (!isUp) {
            const errorText =
                heartbeatJSON["msg"] ||
                diag.movie?.error ||
                diag.series?.error ||
                "Unknown error";
            fields.push({
                name: "Error",
                value: truncate(errorText, 1000),
                inline: false,
            });
        }

        // Thumbnail = addon logo pulled from the manifest
        const thumbnailUrl = diag.manifestLogo || null;

        const title = isUp
            ? `${monitorJSON["name"]} is healthy`
            : status === DOWN
                ? `${monitorJSON["name"]} is down`
                : status === PENDING
                    ? `${monitorJSON["name"]} is pending`
                    : `${monitorJSON["name"]} is in maintenance`;

        // Human-friendly one-liner mirroring the reference screenshot
        let description;
        if (!isUp) {
            description = heartbeatJSON["msg"] || "Instance is unhealthy";
        } else if (hasCatalog) {
            description = `Catalog returned ${diag.catalog.count} items`;
        } else {
            const parts = [];
            if (movieOk) {
                parts.push("movie");
            }
            if (seriesOk) {
                parts.push("series");
            }
            description =
                parts.length === 2
                    ? "Instance is healthy and both movie/series searches working"
                    : parts.length === 1
                        ? `Instance is healthy and ${parts[0]} search working`
                        : "Instance is healthy";
        }

        const embed = {
            author: thumbnailUrl
                ? { name: monitorJSON["name"], icon_url: thumbnailUrl }
                : { name: monitorJSON["name"] },
            title,
            description: truncate(description, 500),
            color,
            timestamp: heartbeatJSON["time"],
            fields,
            footer: {
                text: "stremio-addons.net",
                icon_url: "https://stremio-addons.net/img/web-app-manifest-192x192.png",
            },
        };
        return embed;
    }

    /**
     * Format duration as human-readable string (e.g., "1h 23m", "45m 30s")
     * TODO: Update below to `Intl.DurationFormat("en", { style: "short" }).format(duration)` once we are on a newer node version
     * @param {number} timeInSeconds The time in seconds to format a duration for
     * @returns {string} The formatted duration
     */
    formatDuration(timeInSeconds) {
        const hours = Math.floor(timeInSeconds / 3600);
        const minutes = Math.floor((timeInSeconds % 3600) / 60);
        const seconds = timeInSeconds % 60;

        const durationParts = [];
        if (hours > 0) {
            durationParts.push(`${hours}h`);
        }
        if (minutes > 0) {
            durationParts.push(`${minutes}m`);
        }
        if (seconds > 0 && hours === 0) {
            // Only show seconds if less than an hour
            durationParts.push(`${seconds}s`);
        }

        return durationParts.length > 0 ? durationParts.join(" ") : "0s";
    }
}

module.exports = Discord;
