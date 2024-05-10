import { EthersError } from 'ethers';

import { CustomRpcProvider, BackendSelector } from 'lib';
import { Config, logger, saveObject, readObject, Protocol } from 'lib';
import { Trade, TradesByChain } from 'lib';

import { getBlockTrades } from './transactions.js';

// This array will store 24 hours of traded pairs.
export const tradesHistory: TradesByChain = {} as TradesByChain;

export function trackTrades(): void {
  for (const blockchain of Config.blockchains) {
    logger.info(`Tracking trades for ${blockchain.name} ...`, { module: 'Tracker' });

    // Read heach blockchain history file.
    try {
      tradesHistory[blockchain.name] = readObject(
        `${blockchain.name.toLowerCase()}trades.json`,
        []
      );
    } catch (error) {
      const ethError: EthersError = error as EthersError;
      logger.error(
        `Failed reading file ${blockchain.name.toLowerCase()}trades.json. ` +
          `${process.env.RISE_ERROR ? ethError.message : ''}`,
        { module: 'Trakcer' }
      );
      continue;
    }

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
        try {
          const blockTrades: Array<Trade> | null = await getBlockTrades(
            blockchain,
            blockNumber - 1,
            { backendSelector: backendSelector }
          );

          // Process pairs if there were protocols traded.
          if (blockTrades !== null) {
            tradesByInterval.push(...blockTrades);
          } else {
            logger.warn(
              `Trades for block ${blockNumber} could not be fetched. ` +
                `Continuing from the next block.`,
              { module: 'Tracker' }
            );
          }
        } catch (error) {
          const ethError: EthersError = error as EthersError;
          logger.error(
            `Failed getting trades for ${blockchain.name}. ` +
              `${process.env.RISE_ERROR ? ethError.message : ''}`,
            { module: 'Trakcer' }
          );
          provider.removeAllListeners();
          clearInterval(historyInterval);
        }
      }
    });

    // Store pairs that were fetched each time interval.
    const historyInterval: NodeJS.Timeout = setInterval(async () => {
      try {
        // Add one interval of data.
        tradesHistory[blockchain.name].push(structuredClone(tradesByInterval));

        // Removing the elder element of history pool
        if (tradesHistory[blockchain.name].length > blockchain.cacheCapacity) {
          tradesHistory[blockchain.name].shift();
        }

        // Caching history to be used by other modules.
        saveObject(
          tradesHistory[blockchain.name],
          `${blockchain.name.toLowerCase()}trades.json`
        );

        logger.debug(
          `${tradesByInterval.length} trades were stored for ${blockchain.name}.`,
          { module: 'Tracker' }
        );
        // Flush to star over with fresh traded pools per interval.
        tradesByInterval = [];
      } catch (error) {
        const ethError: EthersError = error as EthersError;
        logger.error(
          `Failed saving trades history for ${blockchain.name}. ` +
            `${process.env.RISE_ERROR ? ethError.message : ''}`,
          { module: 'Trakcer' }
        );
        provider.removeAllListeners();
        clearInterval(historyInterval);
      }
    }, blockchain.cacheInterval * 1000);
  }
}
