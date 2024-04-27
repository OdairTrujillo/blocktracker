export { tradesHistory } from './tracker.js';

import { Config, BackendSelectorByChain } from 'lib';
import { BackendSelector } from 'lib';

import { trackTrades } from './tracker.js';

import './mods.js'; // Polyfill

export const fullBackendSelectors: BackendSelectorByChain = {} as BackendSelectorByChain;

// Filling backends selectors.
for (const blockchain of Config.blockchains) {
  fullBackendSelectors[blockchain.name] = BackendSelector('fullNode', blockchain.name);
}

if (process.env.TRACK_TRADES === 'true') {
  trackTrades();
}
