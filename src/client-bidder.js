'use strict';

const RPC = require('@hyperswarm/rpc');
const DHT = require('hyperdht');
const Hypercore = require('hypercore');
const Hyperbee = require('hyperbee');
const crypto = require('crypto');
const b4a = require('b4a');

const main = async () => {
  // hyperbee db
  const hcore = new Hypercore('./db/rpc-client-bidder');

  const hbee = new Hyperbee(hcore, {
    keyEncoding: 'utf-8',
    valueEncoding: 'binary',
  });
  await hbee.ready();

  // resolved distributed hash table seed for key pair
  let dhtSeed = (await hbee.get('dht-seed'))?.value;
  if (!dhtSeed) {
    // not found, generate and store in db
    dhtSeed = crypto.randomBytes(32);
    await hbee.put('dht-seed', dhtSeed);
  }

  // start distributed hash table, it is used for rpc service discovery
  const dht = new DHT({
    port: 50001,
    keyPair: DHT.keyPair(dhtSeed),
    bootstrap: [{ host: '127.0.0.1', port: 30001 }], // note boostrap points to dht that is started via cli
  });
  await dht.ready();

  // public key of rpc server, used instead of address, the address is discovered via dht
  const serverPubKey = Buffer.from(
    'da9f14ac38c5dc59c94499faabcc5b5f577add66c7a82a87bc4112b0be794621',
    'hex'
  );

  console.log('Bidder : hcore PKey', b4a.toString(hcore.key, 'hex'));

  // rpc lib
  const rpc = new RPC({ dht });

  //place a bid
  const payload = {
    id: 'Pic1',
    bid: 100,
    bidderPubKey: b4a.toString(hcore.key, 'hex'),
  };
  const payloadRaw = Buffer.from(JSON.stringify(payload), 'utf-8');

  const respRaw = await rpc.request(serverPubKey, 'placeBid', payloadRaw);
  const resp = b4a.toString(respRaw);
  console.log(resp);

  // closing connection
  await rpc.destroy();
  await dht.destroy();
};

main().catch(console.error);
