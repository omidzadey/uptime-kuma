<template>
    <div ref="modal" class="modal fade" tabindex="-1">
        <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">{{ $t("Check history") }}</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" :aria-label="$t('Close')" />
                </div>
                <div class="modal-body">
                    <div v-if="loading" class="text-center p-4">
                        <div class="spinner-border" role="status"></div>
                    </div>
                    <div v-else-if="error" class="alert alert-danger">{{ error }}</div>
                    <div v-else-if="history.length === 0" class="text-center text-muted p-4">
                        {{ $t("No data") }}
                    </div>
                    <div v-else class="history-list">
                        <div v-for="beat in history" :key="beat.id" class="history-row mb-2">
                            <div class="summary d-flex align-items-center p-2" role="button" @click="toggle(beat.id)">
                                <span class="badge me-2" :class="beat.status === 1 ? 'bg-success' : 'bg-danger'">
                                    {{ beat.status === 1 ? $t("Up") : $t("Down") }}
                                </span>
                                <span class="me-2 small text-muted">{{ formatTime(beat.time) }}</span>
                                <span class="flex-grow-1">{{ beat.msg }}</span>
                                <font-awesome-icon :icon="expanded[beat.id] ? 'chevron-up' : 'chevron-down'" />
                            </div>
                            <div v-if="expanded[beat.id]" class="details p-2">
                                <div v-if="!parsed[beat.id]" class="text-muted small">
                                    {{ $t("No raw data stored for this check") }}
                                </div>
                                <template v-else>
                                    <div v-for="section in sectionsFor(parsed[beat.id])" :key="section.key" class="mb-3">
                                        <h6 class="mb-2">
                                            {{ section.heading }}
                                            <span v-if="section.id" class="small text-muted ms-1">({{ section.id }})</span>
                                        </h6>
                                        <div v-if="section.items.length === 0" class="text-muted small">
                                            {{ $t("No raw data stored for this check") }}
                                        </div>
                                        <div v-else class="item-grid">
                                            <div v-for="(item, idx) in section.items" :key="idx" class="raw-item p-2">
                                                <template v-if="section.kind === 'stream'">
                                                    <div class="fw-bold">{{ item.name || item.title || "stream" }}</div>
                                                    <div v-if="item.title && item.title !== item.name" class="small">{{ item.title }}</div>
                                                    <div v-if="item.description" class="small text-muted">{{ item.description }}</div>
                                                    <div class="small text-muted mt-1">
                                                        <span v-if="item.url">URL</span>
                                                        <span v-else-if="item.infoHash">{{ item.infoHash }}<span v-if="item.fileIdx != null">:{{ item.fileIdx }}</span></span>
                                                        <span v-else-if="item.externalUrl">external</span>
                                                    </div>
                                                </template>
                                                <template v-else>
                                                    <div class="d-flex">
                                                        <img v-if="item.poster" :src="item.poster" class="meta-poster me-2" :alt="item.name" />
                                                        <div>
                                                            <div class="fw-bold">{{ item.name }}</div>
                                                            <div class="small text-muted">{{ item.id }}</div>
                                                        </div>
                                                    </div>
                                                </template>
                                            </div>
                                        </div>
                                    </div>
                                </template>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                        {{ $t("Close") }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { Modal } from "bootstrap";
import dayjs from "dayjs";

export default {
    props: {
        monitor: {
            type: Object,
            required: true,
        },
        preloadedHistory: {
            type: Array,
            default: () => [],
        },
    },
    data() {
        return {
            modal: null,
            loading: false,
            error: null,
            history: [],
            expanded: {},
            parsed: {},
            initialKey: null,
        };
    },
    mounted() {
        this.modal = new Modal(this.$refs.modal);
    },
    methods: {
        show(initialKey) {
            this.initialKey = initialKey || null;
            this.expanded = {};
            this.parsed = {};
            this.history = this.preloadedHistory.slice();
            this.modal.show();
            this.load();
            if (this.history.length > 0) {
                this.toggle(this.history[0].id);
            }
        },
        load() {
            this.loading = this.history.length === 0;
            this.error = null;
            this.$root.getStremioHistory(this.monitor.id, (res) => {
                this.loading = false;
                if (!res || !res.ok) {
                    this.error = (res && res.msg) || "Failed to load history";
                    return;
                }
                this.history = res.data || [];
                if (this.history.length > 0 && Object.keys(this.expanded).length === 0) {
                    this.toggle(this.history[0].id);
                }
            });
        },
        toggle(id) {
            if (this.expanded[id]) {
                this.expanded = { ...this.expanded, [id]: false };
                return;
            }
            if (!this.parsed[id]) {
                const beat = this.history.find((b) => b.id === id);
                if (beat && beat.stremio_data) {
                    try {
                        this.parsed = { ...this.parsed, [id]: JSON.parse(beat.stremio_data) };
                    } catch (_) {
                        this.parsed = { ...this.parsed, [id]: null };
                    }
                } else {
                    this.parsed = { ...this.parsed, [id]: null };
                }
            }
            this.expanded = { ...this.expanded, [id]: true };
        },
        formatTime(t) {
            return dayjs(t).format("YYYY-MM-DD HH:mm:ss");
        },
        sectionsFor(diag) {
            const sections = [];
            if (!diag) {
                return sections;
            }
            if (diag.movie) {
                sections.push({
                    key: "movie",
                    kind: "stream",
                    heading: `${this.$t("Movie")}: ${diag.movie.name || ""}`,
                    id: diag.movie.id,
                    items: Array.isArray(diag.movie.streams) ? diag.movie.streams : [],
                });
            }
            if (diag.series) {
                sections.push({
                    key: "series",
                    kind: "stream",
                    heading: `${this.$t("Series")}: ${diag.series.name || ""}`,
                    id: diag.series.id,
                    items: Array.isArray(diag.series.streams) ? diag.series.streams : [],
                });
            }
            if (diag.catalog) {
                sections.push({
                    key: "catalog",
                    kind: "meta",
                    heading: `${this.$t("Catalog")}: ${diag.catalog.type}/${diag.catalog.id}`,
                    id: null,
                    items: Array.isArray(diag.catalog.metas) ? diag.catalog.metas : [],
                });
            }
            return sections;
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.history-list {
    max-height: 70vh;
    overflow-y: auto;
}

.history-row {
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 6px;
    overflow: hidden;

    .summary {
        background: rgba(0, 0, 0, 0.02);
        cursor: pointer;
        &:hover {
            background: rgba(0, 0, 0, 0.05);
        }
    }

    .details {
        border-top: 1px solid rgba(0, 0, 0, 0.08);
    }
}

.item-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 6px;
}

.raw-item {
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.01);
    word-break: break-word;
}

.meta-poster {
    width: 40px;
    height: 60px;
    object-fit: cover;
    border-radius: 3px;
}

.dark {
    .history-row {
        border-color: rgba(255, 255, 255, 0.08);
        .summary {
            background: rgba(255, 255, 255, 0.03);
            &:hover {
                background: rgba(255, 255, 255, 0.06);
            }
        }
        .details {
            border-top-color: rgba(255, 255, 255, 0.08);
        }
    }
    .raw-item {
        border-color: rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.02);
    }
}
</style>
