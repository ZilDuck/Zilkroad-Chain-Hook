
require("dotenv").config();
const { Zilliqa } = require("@zilliqa-js/zilliqa");
const { fromBech32Address, toChecksumAddress } = require('@zilliqa-js/crypto')
const { StatusType, MessageType } = require("@zilliqa-js/subscriptions");
const axios = require("axios");
const Big = require('big.js');
const zilliqa = new Zilliqa(process.env.ZILLIQA_NETWORK);

const {
  TestConnection,
  PublishListing,
  PublishDelisting,
  PublishSale,
  PublishUpdateListing
} = require('./queryManager.js')

function ListenToChainEvents() 
{
  console.log("Listening to events")
    const subscriber = zilliqa.subscriptionBuilder.buildEventLogSubscriptions(
    process.env.ZILLIQA_API_WS, // network to listen on
    {
      // contract address you want to listen on
      addresses: [process.env.NFT_MARKETPLACE_ADDRESS],
    }
  );

  subscriber.emitter.on(MessageType.EVENT_LOG, (event) => 
  {
    console.log("Got new block at %s", new Date().toLocaleString());
    try 
    {
      if (event.value)
      {
        for (const value of event.value) // For each over all the transactions in that block
        {
          for (const eventLog of value.event_logs) // For each over all the events in a transaction
          {
            if (eventLog._eventname === "Sold") 
            {
              SoldHook(eventLog);
            } 
            if (eventLog._eventname === "Listed") 
            {
              ListedHook(eventLog);
            } 
            if (eventLog._eventname === "Delisted") 
            {
              DelistedHook(eventLog);
            } 
            if (eventLog._eventname === "EditListing") 
            {
              EditListingHook(eventLog);
            } 
          }
        }
      }
    } catch (ex) {
      throw ex;
    }
  });

  subscriber.start();
  // await subscriber.stop();
}

console.log("Started listening to contract %s on %s on %s", process.env.NFT_MARKETPLACE_ADDRESS, process.env.ZILLIQA_API_WS, process.env.ZILLIQA_NETWORK);
console.log("Testing Postgres connection before continuing");
try {
  TestConnection();
  console.log("Connection successful");
} catch (e) {
  console.error("Could not establish connection to Postgres: %s", e);
  throw e;
}
ListenToChainEvents();

// give it ticker and it'll figure out how  (mainnet only)
async function getUSDValuefromTokens(ticker, numberOfTokens) 
{
  console.log("In getUSDValueFromTokens")
  // account for wzil
  const final_ticker = ticker.toLowerCase() == "wzil" ? "zil" : ticker;
  const token_info = await axios.get(`https://api.zilstream.com/tokens/${final_ticker}`)
  const usd_rate = token_info.data.rate_usd;

  // TODO break each one into new method
  const tradedValueUSD = new Big(usd_rate).mul(numberOfTokens).round(2);
  console.log(`trade value of ${ticker} is ${tradedValueUSD}`)
  return tradedValueUSD.toNumber();
}

async function getOneTokenAsUSD(ticker) 
{
  console.log("In getOneTokenAsUSD")
  // account for wzil
  const final_ticker = ticker.toLowerCase() == "wzil" ? "zil" : ticker;
  const token_info = await axios.get(`https://api.zilstream.com/tokens/${final_ticker}`)
  const usd_rate = token_info.data.rate_usd;

  const oneTokenAsUSD = new Big(usd_rate).round(2);
  console.log(`1 token as USD 2DP ${oneTokenAsUSD}`)
  return oneTokenAsUSD.toNumber();
}


/* fn_insertAllRowsForStaticListing
   Assumes the fungible address has already been added to database and contract

  _nonfungible_address varchar(42),             -- nonfungible      @Emitted    X
  _nonfungible_symbol varchar(255),             -- nonfungible      @Lookup     X
  _nonfungible_name varchar(255),               -- nonfungible      @Lookup     X
  _token_id numeric(78,0),                      -- nonfungibletoken @Emitted    X
  _fungible_address varchar(42),                -- fungible         @Emitted    X
  _static_order_id integer,                     -- listing          @Emitted    X
  _listing_transaction_hash varchar(66),        -- listing          @Emitted    X
  _listing_fungible_token_price numeric(40),    -- listing          @Emitted    X
  _listing_block numeric,                       -- listing          @Emitted    X
  _listing_unixtime integer,                    -- listing          @Calculated X
  _listing_user_address varchar(42)             -- listing          @Emitted    X

    _eventname : "Listed"; 
    nonfungible: nonfungible; 0
    token_id: token_id; 1
    fungible: fungible; 2
    sell_price: sell_price; 3 
    lister: _sender; 4
    block: now; 5
    oid: oid 6
  
 */
async function ListedHook(eventLog)
{
  console.log("In ListingHook");

  const nonfungible_contract = eventLog.params[0].value;
  const nft_contract_object = await zilliqa.contracts.at(nonfungible_contract);
  const nft_name_object = await nft_contract_object.getSubState("token_name");
  const nft_symbol_object = await nft_contract_object.getSubState("token_symbol");
  
  const nft_name = nft_name_object["token_name"];
  const nft_symbol = nft_symbol_object["token_symbol"];

  const token_id = eventLog.params[1].value;
  const fungible_contract = eventLog.params[2].value;
  const fungible_sell_price = eventLog.params[3].value;
  var lister_address = eventLog.params[4].value;
  const this_block = eventLog.params[5].value;
  const order_id = eventLog.params[6].value;
  const unix_time = Date.now();

  let block_transactions = await getTransactionsForBlock(eventLog.params);
  getTransactionHashForBlock(block_transactions, nonfungible_contract, token_id, lister_address);

  const tx_id = block_transactions[0].id;

  // We need to convert the address after getting the transactions
  // Otherwise it can't find them lol
  if( lister_address.startsWith('zil1') )
  {
    lister_address = fromBech32Address(lister_address);
  } else {
    lister_address = toChecksumAddress(lister_address);
  }

  const listing_object =
  {
    _nonfungible_address : nonfungible_contract,
    _nonfungible_symbol : nft_symbol,
    _nonfungible_name : nft_name,
    _token_id : token_id,
    _fungible_address : fungible_contract,
    _static_order_id : order_id,
    _listing_transaction_hash : tx_id,
    _listing_fungible_token_price : fungible_sell_price,
    _listing_block : this_block,
    _listing_unixtime : unix_time,
    _listing_user_address : lister_address
  }

  console.log("Got listing object: %j", listing_object);

  try {
    await PublishListing(listing_object);
    console.log("Published Listing object to Postgres");

  } catch (e) {
    console.error("Couldn't publish Listing object to Postgres: %s", e);
  } 

}


/*
e = {_eventname : "Delisted"; oid: oid; nonfungible: nonfungible; token_id: token_id; delister: _sender; block: now};
event e

    _static_order_id integer,
    _delisting_transaction_hash varchar(66),
    _delisting_block numeric,
    _delisting_unixtime bigint
*/
async function DelistedHook(eventLog)
{
  console.log("In DelistingHook");

  const oid = eventLog.params[0].value;
  const nonfungible_contract = eventLog.params[1].value;
  const token_id = eventLog.params[2].value;
  const delister_address = eventLog.params[3].value;
  const block = eventLog.params[4].value;

  const unix_time = Date.now();

  let block_transactions = await getTransactionsForBlock(eventLog.params);
  getTransactionHashForBlock(block_transactions, nonfungible_contract, token_id, delister_address);

  const tx_id = block_transactions[0].id;

  const delisting_object =
  {
    _static_order_id : oid,
    _delisting_transaction_hash : tx_id,
    _delisting_block : block,
    _delisting_unixtime : unix_time
  }

  console.log("Got delisting object: %j", delisting_object);
  try {
    await PublishDelisting(delisting_object);
    console.log("Published Delisting object to Postgres");
  } catch (e) {
    console.error("Couldn't publish Delisting object to Postgres: %s", e);
  } 

}

/*
  _static_order_id integer,
	_sale_transaction_hash varchar(66),
	_sale_block numeric,
	_sale_unixtime int8,
	_buyer_address varchar(42),
	_royalty_recipient_address varchar(42),
	_tax_recipient_address varchar(42),
	_x_tokens_to_1_usd numeric(40,0),
	_tax_amount_token numeric(40,0),
	_tax_amount_usd numeric(15, 2),
	_royalty_amount_token numeric(40,0),
	_royalty_amount_usd numeric(15, 2),
	_final_sale_after_taxes_tokens numeric(40,0),
	_final_sale_after_taxes_usd numeric(15, 2)

  e = {_eventname : "Sold"; (* royalty fee, marketplace zero *)
  block: now;
  order_id: oid;
  nonfungible: nonfungible;
  token_id: token_id;
  fungible: fungible;
  sell_price: sell_price;
  seller: seller;
  buyer: _sender;
  marketplace_recipient: null_bystr20;
  tax_amount: uint128_zero;
  royalty_recipient: royalty_recipient;
  royalty_amount: sale_after_royalty
*/
async function SoldHook(eventLog)
{
  console.log("In Sale-listingHook - %j", eventLog);

  const block =  eventLog.params[0].value;
  const order_id =  eventLog.params[1].value;
  const nonfungible_contract =  eventLog.params[2].value;
  const token_id =  eventLog.params[3].value;
  const fungible_contract =  eventLog.params[4].value;
  const sell_price =  parseInt(eventLog.params[5].value) || 0;
  const seller =  eventLog.params[6].value;
  const buyer_address =  eventLog.params[7].value;
  const marketplace_recipient =  eventLog.params[8].value;
  const tax_amount =  parseInt(eventLog.params[9].value) || 0;
  const royalty_recipient =  eventLog.params[10].value;
  const royalty_amount =  parseInt(eventLog.params[11].value) || 0;

  const unix_time = Date.now();

  const ft_contract_object = zilliqa.contracts.at(fungible_contract);
  const ft_contract_immutables = await ft_contract_object.getInit();
  let ft_symbol = ft_contract_immutables.filter(function(immutable) {
    return immutable.vname == "symbol"
  })[0].value;
  console.log("Symbol is %s, Sell price is %s", ft_symbol, sell_price);

  const seller_fungible_amount_approx_usd = await getUSDValuefromTokens(ft_symbol, sell_price);
  const royalty_fungible_amount_approx_usd = await getUSDValuefromTokens(ft_symbol, royalty_amount);
  const marketplace_fungible_amount_approx_usd = await getUSDValuefromTokens(ft_symbol, tax_amount);

  let block_transactions = await getTransactionsForBlock(eventLog.params);
  getTransactionHashForBlock(block_transactions, nonfungible_contract, token_id, buyer_address);
  let final_sale_tokens = sell_price - tax_amount;
  let final_sale_price = seller_fungible_amount_approx_usd - marketplace_fungible_amount_approx_usd;

  const tx_id = block_transactions[0].id;

  const sale_object =
  {
    _static_order_id : order_id,
    _sale_transaction_hash : tx_id,
    _sale_block : block,
    _sale_unixtime : unix_time,
    _buyer_address : buyer_address,
    _royalty_recipient_address : royalty_recipient,
    _tax_recipient_address : marketplace_recipient,
    _one_token_to_usd : await getOneTokenAsUSD(ft_symbol),
    _tax_amount_token : tax_amount,
    _tax_amount_usd : marketplace_fungible_amount_approx_usd,
    _royalty_amount_token : royalty_amount,
    _royalty_amount_usd : royalty_fungible_amount_approx_usd,
    _final_sale_after_taxes_tokens : final_sale_tokens,
    _final_sale_after_taxes_usd : final_sale_price
  }

  console.log("Got sale-listing object %j", sale_object);

  try {
    await PublishSale(sale_object);
    console.log("Published Sale object to Postgres");
  } catch (e) {
    console.error("Couldn't publish Sale object to Postgres: %s", e);
  } 
}

async function getTransactionsForBlock(block_data)
{
  let block_transactions = block_data.filter(function (object) {
    return object.vname == "block" || object.vname == "this_block";
  });
  await Promise.all(
    block_transactions.map(async (object) => {
      object.transactions = await zilliqa.blockchain.getTxnBodiesForTxBlock(object.value);
    })
  );
  return block_transactions;
}

function getTransactionHashForBlock(block_transactions, nonfungible_contract, token_id, user)
{
  // If we can garuntee that there will always be 1 block transaction, result, event_logs, and not multiple
  // this would be a lot simpler, commented version is the simpler one
  var updateBlock = false;
  var id;
  block_transactions.forEach(function(block) {
    block.transactions.result.forEach(function(result) {
      id = result.ID;
      if ( !result.receipt.hasOwnProperty("event_logs") ) {
        console.log("Event logs can't be found for result, skipping");
        return;
      }
      result.receipt.event_logs.forEach(function(eventLogs) {
        if ( updateBlock ) {
          return;
        }
        var components = eventLogs.params.filter(function(object) {
          // When testing SoldTest on testnet, the buyer and seller have the same ID
          // So we add this extra check on that level to make sure it's bound to
          // the object where it's either the user or buyer to account for all three
          // cases [Listing, Delisting, Sold]
          return object.value === token_id ||
                 (
                   object.value === nonfungible_contract && object.vname === "nonfungible"
                 ) ||
                 (
                   object.value === user && object.vname === "user"
                 ) ||
                 (
                   object.value === user && object.vname === "buyer"
                 ) ||
                 (
                   object.value === user && object.vname === "delister"
                 ) ||
                 (
                   object.value === user && object.vname === "lister"
                 )
        });
        if ( components.length == 3 ) {
          updateBlock = true;
          return;
        }
      });
    });
    if ( updateBlock && id != null) {
      block.id = "0x" + id;
    } else {
      console.log("Could not get transaction hash for some reason");
    }
  });

}


async function EditListingHook(){
  console.log("In Sale-listingHook");
  const order_id =  eventLog.params[0].value;
  const old_fungible =  eventLog.params[1].value;
  const old_sell_price =  eventLog.params[2].value;
  const new_fungible =  eventLog.params[3].value;
  const new_sell_price =  eventLog.params[4].value;
  const nonfungible_contract =  eventLog.params[5].value; 
  const token_id =  eventLog.params[6].value;
  const lister =  eventLog.params[7].value;
  const block =  eventLog.params[8].value;

  const unix_time = Date.now();

  let block_transactions = await getTransactionsForBlock(eventLog.params);
  getTransactionHashForBlock(block_transactions, nonfungible_contract, token_id, lister);

  const tx_id = block_transactions[0].id;

  const edit_listing =
  {
    _static_order_id : order_id,
    _edit_listing_transaction_hash : tx_id,
    _previous_fungible_address : old_fungible,
    _previous_fungible_token_price : old_sell_price,
    _new_fungible_address: new_fungible,
    _new_fungible_token_price : new_sell_price,
    _edit_listing_block : block,
    _edit_listing_unixtime : unix_time,
  }

  console.log("Got sale-listing object %j", edit_listing);

  try {
    await PublishUpdateListing(edit_listing);
    console.log("Published Edit sale object to Postgres");
  } catch (e) {
    console.error("Couldn't publish Edit sale object to Postgres: %s", e);
  } 

}