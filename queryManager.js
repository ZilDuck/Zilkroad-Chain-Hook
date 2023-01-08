const { Pool } = require("pg");

const pgClient = new Pool
({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT
});

// If I had a general function with 2 params, sql and params, and passed them through
// I would get postgres errors with it trying to parse the sql, so thats why
// There is a lot of repition with calling postgres

async function TestConnection() {
    const sql = "SELECT 1"
    await pgClient.query(sql).catch((error) => {throw error});
}

async function PublishListing(data) {
    const sql = "SELECT fn_insertallrowsforstaticlisting($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)";
    const values = [
        data._nonfungible_address,
        data._nonfungible_symbol,
        data._nonfungible_name,
        data._token_id,
        data._fungible_address,
        data._static_order_id,
        data._listing_transaction_hash,
        data._listing_fungible_token_price,
        data._listing_block,
        data._listing_unixtime,
        data._listing_user_address
    ]
    await pgClient.query(sql, values).catch((error) => {throw error});
}

async function PublishDelisting(data) {
    const sql = "SELECT fn_insertstaticdelistingforlisting($1, $2, $3, $4)"
    const values = [
        data._static_order_id,
        data._delisting_transaction_hash,
        data._delisting_block,
        data._delisting_unixtime
    ]
    await pgClient.query(sql, values).catch((error) => {throw error});
} 

async function PublishSale(data) {
    const sql = "SELECT fn_insertstaticsaleforlisting($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)"
    const values = [
        data._static_order_id,
        data._sale_transaction_hash,
        data._sale_block,
        data._sale_unixtime,
        data._buyer_address,
        data._royalty_recipient_address,
        data._tax_recipient_address,
        data._one_token_to_usd,
        data._tax_amount_token,
        data._tax_amount_usd,
        data._royalty_amount_token,
        data._royalty_amount_usd,
        data._final_sale_after_taxes_tokens,
        data._final_sale_after_taxes_usd
    ]
    await pgClient.query(sql, values).catch((error) => {throw error});
}

async function PublishUpdateListing(data) {
    const sql = "SELECT fn_insertEditStaticListing($1, $2, $3, $4, $5, $6, $7, $8)"
    const values = [
        data._static_order_id,
        data._edit_listing_transaction_hash,     
        data._previous_fungible_address,
        data._previous_fungible_token_price,
        data._new_fungible_address,
        data._new_fungible_token_price,
        data._edit_listing_block,
        data._edit_listing_unixtime
    ]
    await pgClient.query(sql, values).catch((error) => {throw error});
}


module.exports = {
    TestConnection,
    PublishListing,
    PublishDelisting,
    PublishSale,
    PublishUpdateListing
}
