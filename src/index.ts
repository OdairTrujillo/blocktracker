import http, { Server } from 'http';
import { logger, Reserves, Price01, priceCalc } from 'libchainstream';

import { app } from './server/index.js';
import { config } from './server/config.js';
import { trackTrades } from './tracker.js';

import './mods.js'; // Polyfill

// Este código es para probar, quítalo ...
const reserves: Reserves = {
  reserve0: 93301389754092013684936971038409n,
  reserve1: 16223058684530148812n,
  blockTimestamp: 1711388505n
};

const token0Decimals: number = 6;
const token1Decimals: number = 18;

const prices: Price01 = priceCalc(reserves, '0xTEST', token0Decimals, token1Decimals);

console.log('price0:', prices.price0);
console.log('price1:', prices.price1);
// Hasta aquí

const { hostname, port, url } = config.server;
const apiServer: Server = http.createServer(app);

apiServer.listen(port, Number(hostname), () => {
  logger.info(`BlockTracker server is running at ${url}/.`, { module: 'BlockTracker' });
});

trackTrades();
