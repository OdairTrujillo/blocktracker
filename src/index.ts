export { tradesHistory } from './tracker.js';
import { Protocol } from 'lib';
import { Config, BackendSelectorByChain } from 'lib';
import { BackendSelector, logger } from 'lib';
import { ReadOnlyOracle, ReadOnlyOraclesByChain } from 'oracle';

import { trackTrades } from './tracker.js';

import './mods.js'; // Polyfill

export const fullBackendSelectors: BackendSelectorByChain = {} as BackendSelectorByChain;

export const oracles: ReadOnlyOraclesByChain = {} as ReadOnlyOraclesByChain;

// Instantiation of oracles from config.json
logger.info(`Initializing oracles ...`, { module: 'Blocktracker' });
for (const blockchain of Config.blockchains) {
  const protocols: Array<Protocol> = Config.protocols.filter(
    (protocol: Protocol) => protocol.chain === blockchain.name
  );
  // Preparing oracles promises.
  const oraclePromises: Array<Promise<ReadOnlyOracle>> = protocols.map(
    async (protocol: Protocol) => {
      const pairs: object = { startIndex: 0 };
      const oracle: ReadOnlyOracle = new ReadOnlyOracle(blockchain, protocol);
      await oracle.init(pairs);
      return oracle;
    }
  );
  // Resolve oracles promises for each chain.
  oracles[blockchain.name] = await Promise.all(oraclePromises);
}
// Filling backends selectors.
for (const blockchain of Config.blockchains) {
  fullBackendSelectors[blockchain.name] = BackendSelector('fullNode', blockchain.name);
}

if (process.env.TRACK_TRADES === 'true') {
  trackTrades();
}
