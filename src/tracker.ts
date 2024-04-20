import { CustomRpcProvider, BackendSelector } from 'libchainstream';
import { Config, logger, saveObject, readObject, Protocol } from 'libchainstream';
import { Trade, TradesByChain } from 'libchainstream';

import { getBlockTrades } from './transactions.js';

// This array will store 24 hours of traded pairs.
export const tradesHistory: TradesByChain = {} as TradesByChain;

export function trackTrades() {
  for (const blockchain of Config.blockchains) {
    // Read heach blockchain history file.
    tradesHistory[blockchain.name] =
      readObject(`${blockchain.name.toLowerCase()}trades.json`, []);

    const protocols: Array<Protocol> = Config.protocols.filter(
      (protocol: Protocol) => protocol.chain === blockchain.name
    );

    // FIXME: Remove this protocol code.
    const v3: Protocol = { code: 'PCAKESWAP_V3' } as Protocol;
    protocols.push(v3);

    const backendSelector: Generator<number> = BackendSelector(
      'fullNode',
      blockchain.name
    );

    const provider: CustomRpcProvider = new CustomRpcProvider(
      'regularNode',
      blockchain.name
    );

    // To store trades for each blokchain.
    let tradesByInterval: Array<Trade> = [];

    // Register event for new blocks for each unique blockchain provider.
    provider.on('block', async (blockNumber: number) => {
      if (blockNumber % 3 === 0) {
        const blockTrades: Array<Trade> | null = await getBlockTrades(
          blockchain,
          blockNumber - 1,
          { backendSelector: backendSelector }
        );

        // Process pairs if there were protocols traded.
        if (blockTrades !== null) {
	    tradesByInterval.push(...blockTrades)
        } else {
          logger.warn(
            `Trades for block ${blockNumber} could not be fetched. ` +
              `Continuing from the next block.`,
            { module: 'Tracker' }
          );
        }
      }
    });

    // Store pairs that were fetched each time interval.
    setInterval(async () => {
      // Add one interval of data.
      tradesHistory[blockchain.name].push(structuredClone(tradesByInterval));

      // Flush to star over with fresh traded pools per interval.
      tradesByInterval = [];

      // Removing the elder element of history pool
      if (tradesHistory[blockchain.name].length > blockchain.cacheCapacity) {
        tradesHistory[blockchain.name].shift();
      }

      // Caching historyPool in case of program exit.
      saveObject(
	tradesHistory[blockchain.name],
	`${blockchain.name.toLowerCase()}trades.json`
      );
    }, blockchain.cacheInterval * 1000);
  }
}

