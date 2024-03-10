import { CustomRpcProvider, BackendSelector } from 'libchainstream';
import { AddrsByProtocol, UniqueAddrsByProtocol } from 'libchainstream';
import { AddrsByChain, UniqueAddrsByChain, PROTOCOLS } from 'libchainstream';
import { Config, logger, saveObject, readObject } from 'libchainstream';

import { getTradedPairs } from './transactions.js';

// Objects tu be used with the API controllers
export const pairsPool: AddrsByChain = {} as AddrsByChain;
export const uniquePairsPool: UniqueAddrsByChain = {} as UniqueAddrsByChain;
// This array will store 24 hours of traded pairs.
export const historyPool: Array<AddrsByChain> = readObject('historyPool.json', []);

// Init objects
const initPairAddrs: AddrsByProtocol = {} as AddrsByProtocol;
const initUniquePairAddr: UniqueAddrsByProtocol = {} as UniqueAddrsByProtocol;

export function newBlock() {
  // Register event for new blocks for each unique blockchain provider.
  for (const blockchain of Config.blockchains) {
    // Creating properties with blockchain as key with empty arrays and sets.
    for (const protocolCode of PROTOCOLS[blockchain.name]) {
      initPairAddrs[protocolCode] = [];
      initUniquePairAddr[protocolCode] = new Set();
      pairsPool[blockchain.name] = initPairAddrs;
      uniquePairsPool[blockchain.name] = initUniquePairAddr;
    }

    const backendSelector: Generator<number> = BackendSelector(
      'regularNode',
      blockchain.name
    );
    const provider: CustomRpcProvider = new CustomRpcProvider(
      'regularNode',
      blockchain.name
    );

    provider.on('block', async (blockNumber: number) => {
      if (blockNumber % 3 === 0) {
        const tradedPairAddrs: AddrsByProtocol | null = await getTradedPairs(
          blockchain,
          blockNumber,
          { backendSelector: backendSelector }
        );
        // Process pairs if there were protocols traded.
        if (tradedPairAddrs && Object.keys(tradedPairAddrs).length > 0) {
          for (const protocolCode of PROTOCOLS[blockchain.name]) {
            // Ading protocol pairs addresses by blockchain.
            pairsPool[blockchain.name][protocolCode].push(
              ...tradedPairAddrs[protocolCode]
            );
            // Adding protocol unique pairs addresses by blockchain.
            for (const pairAddress of tradedPairAddrs[protocolCode]) {
              uniquePairsPool[blockchain.name][protocolCode].add(pairAddress);
            }
          }
        } else {
          logger.warn(
            `Trades for block ${blockNumber} could not be fetched. ` +
              `Continuing from the next block.`,
            { module: 'BlockTracker' }
          );
        }
      }
    });

    // Store pairs that were fetched each time interval.
    setInterval(async () => {
      // Adding one interval of data, i.e. one minute of data.
      historyPool.push(structuredClone(pairsPool));
      let elapsedIntervals: number = historyPool.length;
      // Flush recent recieved pairs.
      for (const protocolCode of PROTOCOLS[blockchain.name]) {
        pairsPool[blockchain.name][protocolCode] = [];
      }
      // Removing the elder element of history pool
      if (elapsedIntervals > blockchain.cacheCapacity) {
        historyPool.shift();
        elapsedIntervals = historyPool.length;
      }
      // Safe flush for unique pairs if api calls did not flushed it.
      if (elapsedIntervals > Config.cacheSafeFlush) {
        for (const protocolCode of PROTOCOLS[blockchain.name]) {
          uniquePairsPool[blockchain.name][protocolCode].clear();
        }
      }
      // Caching historyPool in case of program exit.
      saveObject(historyPool, 'historyPool.json');
    }, blockchain.cacheInterval);
  }
}
