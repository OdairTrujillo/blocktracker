export { tradesHistory } from './tracker.js';

import { Config, BackendSelectorByChain } from 'libchainstream';
import { BackendSelector } from 'libchainstream';

import { trackTrades } from './tracker.js';

import './mods.js'; // Polyfill

export const fullBackendSelectors: BackendSelectorByChain = {} as BackendSelectorByChain;
export const archiveBackendSelectors: BackendSelectorByChain =
  {} as BackendSelectorByChain;

// Filling backends selectors.
for (const blockchain of Config.blockchains) {
  fullBackendSelectors[blockchain.name] = BackendSelector('fullNode', blockchain.name);
  archiveBackendSelectors[blockchain.name] = BackendSelector(
    'archiveNode',
    blockchain.name
  );
}

// Calling track events.
if (process.env.TRACK_TRADES === 'true') {
  trackTrades();
}
