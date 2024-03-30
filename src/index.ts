import http, { Server } from 'http';
import { logger, Config, BackendSelectorByChain } from 'libchainstream';
import { BackendSelector, Protocol } from 'libchainstream';
import { Oracle, OraclesByChain } from 'oracle';

import { app } from './server/index.js';
import { config } from './server/config.js';
import { trackTrades, trackCreatedPairs } from './tracker.js';

import './mods.js'; // Polyfill

export const fullBackendSelectors: BackendSelectorByChain = {} as BackendSelectorByChain;
export const archiveBackendSelectors: BackendSelectorByChain =
  {} as BackendSelectorByChain;
export const oracles: OraclesByChain = {} as OraclesByChain;

// Filling backends selectors.
for (const blockchain of Config.blockchains) {
  fullBackendSelectors[blockchain.name] = BackendSelector('fullNode', blockchain.name);
  archiveBackendSelectors[blockchain.name] = BackendSelector(
    'archiveNode',
    blockchain.name
  );
}

logger.info(`Initializing oracles ...`, { module: 'BlockTracker' });
for (const blockchain of Config.blockchains) {
  const protocols: Array<Protocol> = Config.protocols.filter(
    (protocol: Protocol) => protocol.chain === blockchain.name
  );
  // Preparing oracles promises.
  const oraclePromises: Array<Promise<Oracle>> = protocols.map(
    async (protocol: Protocol) => {
      const pairs: object = { startIndex: 0 };
      const options: object = { pairsCount: 1000, withDbRead: true, withDbWrite: true };
      const oracle: Oracle = new Oracle(blockchain, protocol, { isReadonly: false });
      await oracle.init(pairs, options);
      return oracle;
    }
  );
  oracles[blockchain.name] = await Promise.all(oraclePromises);
}

// Starting Blocktracker api server.
const { hostname, port, url } = config.server;
const apiServer: Server = http.createServer(app);

apiServer.listen(port, Number(hostname), () => {
  logger.info(`BlockTracker server is running at ${url}/.`, { module: 'BlockTracker' });
});

// Calling track events.
trackCreatedPairs();
trackTrades();
