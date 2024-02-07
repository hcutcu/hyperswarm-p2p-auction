'use strict';

const RPC = require('@hyperswarm/rpc');
const DHT = require('hyperdht');
const Hypercore = require('hypercore');
const Hyperbee = require('hyperbee');
const b4a = require('b4a');
const crypto = require('crypto');

const main = async () => {
  // Create a Hypercore database for storing auction data
  const hcore = new Hypercore('./db/auction');
  const hbee = new Hyperbee(hcore, {
    keyEncoding: 'utf-8',
    valueEncoding: 'binary',
  });
  await hbee.ready();

  // Generate or retrieve DHT seed for key pair
  let dhtSeed = (await hbee.get('dht-seed'))?.value;
  if (!dhtSeed) {
    dhtSeed = crypto.randomBytes(32);
    await hbee.put('dht-seed', dhtSeed);
  }

  // Start DHT
  const dht = new DHT({
    bootstrap: [{ host: '127.0.0.1', port: 30001 }],
    keyPair: DHT.keyPair(dhtSeed),
  });
  await dht.ready();

  // Generate or retrieve RPC seed for key pair
  let rpcSeed = (await hbee.get('rpc-seed'))?.value;
  if (!rpcSeed) {
    rpcSeed = crypto.randomBytes(32);
    await hbee.put('rpc-seed', rpcSeed);
  }

  // Setup RPC server
  const rpc = new RPC({ dht, seed: rpcSeed });
  const rpcServer = rpc.createServer();
  await rpcServer.listen();

  console.log(
    'RPC Server started. Public key:',
    rpcServer.publicKey.toString('hex')
  );

  // Define auction object structure
  const Auction = {
    id: null,
    item: null,
    price: null,
    highestBid: null,
    highestBidder: null,
    closed: false,
    owner: null,
  };

  // Initialize auctions map
  const auctions = new Map();

  // Handle open auction RPC request
  rpcServer.respond('openAuction', async (params, pubkey) => {
    const paramsDecoded = JSON.parse(b4a.toString(params));

    const { id, item, price, owner } = paramsDecoded;
    console.log('auction owner', owner);
    if (!id || !item || !price) {
      throw new Error('Missing required parameters for opening an auction');
    }

    if (auctions.has(id)) {
      throw new Error('Auction with the same ID already exists');
    }

    auctions.set(id, { ...Auction, id, item, price, owner });
    return b4a.from('Auction opened successfully', 'utf-8');
  });

  // Handle bid RPC request
  rpcServer.respond('placeBid', async (params, pubkey) => {
    const paramsDecoded = JSON.parse(b4a.toString(params));
    const { id, bid, bidderPubKey } = paramsDecoded;
    if (!id || !bid || !bidderPubKey) {
      throw new Error('Missing required parameters for placing a bid');
    }

    const auction = auctions.get(id);
    if (!auction) {
      throw new Error('Auction not found');
    }

    if (auction.closed) {
      throw new Error('Auction is closed');
    }

    if (bid <= auction.highestBid) {
      throw new Error('Bid must be higher than current highest bid');
    }

    //TODO : Bids gotta be stored in somewhere and some sort of validation of bidder

    auction.highestBid = bid;
    auction.highestBidder = bidderPubKey;
    console.log(
      `For item ${auction.id} - ${auction.item} New bid placed:`,
      bid,
      'by',
      bidderPubKey
    );
    return b4a.from('Bid placed successfully', 'utf-8');
  });

  // Handle close auction RPC request
  rpcServer.respond('closeAuction', async (params, pubkey) => {
    const paramsDecoded = JSON.parse(b4a.toString(params));
    const { id, owner } = paramsDecoded;
    if (!id || !owner) {
      throw new Error('Missing required parameters for closing an auction');
    }

    const auction = auctions.get(id);
    if (auction.owner !== owner) {
      throw new Error('You are not the owner of this auction');
    }
    if (!auction) {
      throw new Error('Auction not found');
    }

    if (auction.closed) {
      throw new Error('Auction already closed');
    }

    auction.closed = true;

    const result = {
      winner: auction.highestBidder,
      price: auction.highestBid,
    };

    console.log(
      'Auction closed. Winner:',
      result.winner,
      'Price:',
      result.price
    );

    auctions.delete(id);

    return b4a.from(JSON.stringify(result), 'utf-8');
  });
};

main().catch(console.error);
