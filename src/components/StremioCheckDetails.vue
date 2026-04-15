<template>
    <div class="shadow-box mb-4 stremio-check-details" :class="compact ? 'compact-padding' : 'big-padding'">
        <div class="header d-flex align-items-center justify-content-between mb-3">
            <h4 class="mb-0">{{ $t("Stremio Check Details") }}</h4>
            <span class="small text-muted">
                {{ $t("Last checked") }}: {{ lastCheckedRelative }}
            </span>
        </div>

        <div v-if="rows.length === 0" class="text-muted small">
            {{ $t("No raw data stored for this check") }}
        </div>

        <div v-for="row in rows" :key="row.key" class="row-item d-flex align-items-center p-2 mb-2">
            <div class="poster-wrap me-3">
                <img v-if="row.poster" :src="row.poster" :alt="row.title" class="poster" />
                <div v-else class="poster poster-placeholder d-flex align-items-center justify-content-center">
                    <font-awesome-icon icon="film" />
                </div>
            </div>
            <div class="flex-grow-1">
                <div class="title-line fw-bold">{{ row.title }}</div>
                <div v-if="row.id" class="small text-muted">{{ row.id }}</div>
                <div class="mt-1">
                    <span class="badge bg-success">{{ row.count }} {{ row.kind }}</span>
                </div>
            </div>
            <button type="button" class="btn btn-sm btn-outline-primary ms-2" @click="openHistory(row.key)">
                {{ $t("Details") }} <font-awesome-icon icon="arrow-right" />
            </button>
        </div>

        <StremioHistoryModal
            ref="historyModal"
            :monitor="monitor"
            :preloaded-history="history"
            :public-mode="publicMode"
            :slug="slug"
        />
    </div>
</template>

<script>
import axios from "axios";
import dayjs from "dayjs";
import StremioHistoryModal from "./StremioHistoryModal.vue";

export default {
    components: { StremioHistoryModal },
    props: {
        monitor: {
            type: Object,
            required: true,
        },
        publicMode: {
            type: Boolean,
            default: false,
        },
        slug: {
            type: String,
            default: "",
        },
        compact: {
            type: Boolean,
            default: false,
        },
    },
    data() {
        return {
            history: [],
            pollTimer: null,
        };
    },
    mounted() {
        this.load();
        this.pollTimer = setInterval(this.load, 30000);
    },
    beforeUnmount() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }
    },
    watch: {
        "monitor.id"() {
            this.load();
        },
        latestBeat() {
            this.load();
        },
        slug() {
            this.load();
        },
    },
    methods: {
        load() {
            if (!this.monitor || !this.monitor.id) {
                return;
            }
            if (this.publicMode) {
                if (!this.slug) {
                    return;
                }
                axios
                    .get(`/api/status-page/${encodeURIComponent(this.slug)}/stremio/${this.monitor.id}`)
                    .then((res) => {
                        if (res.data && res.data.ok) {
                            this.history = res.data.data || [];
                        }
                    })
                    .catch(() => {});
                return;
            }
            this.$root.getStremioHistory(this.monitor.id, (res) => {
                if (res && res.ok) {
                    this.history = res.data || [];
                }
            });
        },
        openHistory(initialKey) {
            this.$refs.historyModal.show(initialKey);
        },
    },
    computed: {
        latestBeat() {
            const list = this.$root.heartbeatList && this.$root.heartbeatList[this.monitor.id];
            if (!list || list.length === 0) {
                return null;
            }
            const b = list[list.length - 1];
            return `${b.time}:${b.status}`;
        },
        diag() {
            const latest = this.history[0];
            if (!latest || !latest.stremio_data) {
                return null;
            }
            try {
                return JSON.parse(latest.stremio_data);
            } catch (_) {
                return null;
            }
        },
        latestTime() {
            const latest = this.history[0];
            return latest ? latest.time : null;
        },
        lastCheckedRelative() {
            const when = (this.diag && this.diag.checkedAt) || this.latestTime;
            if (!when) {
                return "—";
            }
            return dayjs(when).fromNow();
        },
        rows() {
            if (!this.diag) {
                return [];
            }
            const out = [];
            if (this.diag.movie) {
                out.push({
                    key: "movie",
                    title: this.diag.movie.name || this.$t("Movie"),
                    id: this.diag.movie.id,
                    poster: this.diag.movie.poster,
                    count: this.diag.movie.count ?? 0,
                    kind: this.$t("streams"),
                });
            }
            if (this.diag.series) {
                out.push({
                    key: "series",
                    title: this.diag.series.name || this.$t("Series"),
                    id: this.diag.series.id,
                    poster: this.diag.series.poster,
                    count: this.diag.series.count ?? 0,
                    kind: this.$t("streams"),
                });
            }
            if (this.diag.catalog) {
                out.push({
                    key: "catalog",
                    title: `${this.diag.catalog.type} / ${this.diag.catalog.id}`,
                    id: null,
                    poster: null,
                    count: this.diag.catalog.count ?? 0,
                    kind: this.$t("items"),
                });
            }
            return out;
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.stremio-check-details {
    &.compact-padding {
        padding: 12px 16px;
    }

    .row-item {
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.02);
    }

    .poster-wrap .poster {
        width: 56px;
        height: 84px;
        object-fit: cover;
        border-radius: 4px;
    }

    .poster-placeholder {
        background: rgba(0, 0, 0, 0.1);
        color: rgba(0, 0, 0, 0.4);
        font-size: 24px;
    }
}

.dark {
    .stremio-check-details .row-item {
        border-color: rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
    }
    .stremio-check-details .poster-placeholder {
        background: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.5);
    }
}
</style>
