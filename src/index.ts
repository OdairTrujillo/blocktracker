import http, { Server } from 'http';
import { logger, Config, BackendSelectorByChain } from 'libchainstream';
import { BackendSelector } from 'libchainstream';

import { app } from './server/index.js';
import { config } from './server/config.js';
import { trackTrades } from './tracker.js';

import './mods.js'; // Polyfill

export const fullBackendSelectors: BackendSelectorByChain = {} as BackendSelectorByChain;
for (const blockchain of Config.blockchains) {
  fullBackendSelectors[blockchain.name] = BackendSelector('fullNode', blockchain.name);
}

export const archiveBackendSelectors: BackendSelectorByChain =
  {} as BackendSelectorByChain;
for (const blockchain of Config.blockchains) {
  archiveBackendSelectors[blockchain.name] = BackendSelector(
    'archiveNode',
    blockchain.name
  );
}

const { hostname, port, url } = config.server;
const apiServer: Server = http.createServer(app);

apiServer.listen(port, Number(hostname), () => {
  logger.info(`BlockTracker server is running at ${url}/.`, { module: 'BlockTracker' });
});

trackTrades();
