export { tradesHistory } from './tracker.js';
import { Protocol } from 'lib';
import { Config, BackendSelectorByChain } from 'lib';
import { BackendSelector, logger } from 'lib';
import { Oracle, OraclesByChain } from 'oracle';

import { trackTrades } from './tracker.js';

import './mods.js'; // Polyfill

export const fullBackendSelectors: BackendSelectorByChain = {} as BackendSelectorByChain;

export const oraclesByChain: OraclesByChain = {} as OraclesByChain;

// Instantiation of oracles from config.json
logger.info(`Initializing oracles ...`, { module: 'Blocktracker' });
for (const blockchain of Config.blockchains) {
  const protocols: Array<Protocol> = Config.protocols.filter(
    (protocol: Protocol) => protocol.chain === blockchain.name
  );
  // Preparing oracles promises.
  const oraclePromises: Array<Promise<Oracle>> = protocols.map(
    async (protocol: Protocol) => {
      const oracle: Oracle = new Oracle(blockchain, protocol);
      return oracle;
    }
  );
  // Resolve oracles promises for each chain.
  oraclesByChain[blockchain.name] = await Promise.all(oraclePromises);
}
// Filling backends selectors.
for (const blockchain of Config.blockchains) {
  fullBackendSelectors[blockchain.name] = BackendSelector('fullNode', blockchain.name);
}

if (process.env.TRACK_TRADES === 'true') {
  trackTrades();
}
