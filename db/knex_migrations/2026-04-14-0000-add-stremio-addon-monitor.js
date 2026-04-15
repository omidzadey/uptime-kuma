exports.up = async function (knex) {
    await knex.schema.alterTable("monitor", function (table) {
        table.text("stremio_manifest_url").nullable();
        table.text("stremio_last_check").nullable();
    });
    await knex.schema.alterTable("heartbeat", function (table) {
        table.text("stremio_data").nullable();
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable("heartbeat", function (table) {
        table.dropColumn("stremio_data");
    });
    await knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("stremio_manifest_url");
        table.dropColumn("stremio_last_check");
    });
};
