exports.up = async function (knex) {
    await knex.schema.alterTable("status_page", function (table) {
        table.boolean("show_stremio").notNullable().defaultTo(true);
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable("status_page", function (table) {
        table.dropColumn("show_stremio");
    });
};
