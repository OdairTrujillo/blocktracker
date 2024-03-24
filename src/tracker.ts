import { FixedNumber } from 'ethers';
import { CustomRpcProvider, BackendSelector } from 'libchainstream';
import { AddrsByChain, AddrsByProtocol, UniqueAddrsByProtocol, AddrsByChainByProto } from 'libchainstream';
import { TradesCountByChain } from 'libchainstream'
import { AddrsCountByChain, UniqAddrsByChainByProto, PROTOCOLS } from 'libchainstream';
import { Config, logger, saveObject, readObject } from 'libchainstream';
import { PairElement, Blockchain, Protocol } from 'libchainstream';
import { PriceData, PairReserves, Reserves } from 'libchainstream';
import { Price01, Numeric, ReserveFullElement } from 'libchainstream';
import { BigNumberish, delayedLogger } from 'libchainstream';
import { Liquidity, Pairs } from 'oracle';
import { getTradedPairs } from './transactions.js';
import { toTradesCount, sortTradesCount } from './utils.js';

// Objects tu be used with the API controllers
export const uniquePairsPool: UniqAddrsByChainByProto = {} as UniqAddrsByChainByProto;
// This array will store 24 hours of traded pairs.
export const historyPool: Array<TradesCountByChain> = readObject('historypool.json', []);

export function trackTrades() {
  const tradedPairsPool: AddrsByChainByProto = {} as AddrsByChainByProto;
  const tradesCountByChain: TradesCountByChain = {} as TradesCountByChain;
  // Init objects
  const initUniquePairAddr: UniqueAddrsByProtocol = {} as UniqueAddrsByProtocol;
  // Register event for new blocks for each unique blockchain provider.
  
  for (const blockchain of Config.blockchains) {
    // Init objects with empty sets for each blockchain

    tradedPairsPool[blockchain.name] = {} as AddrsByProtocol;
    
    for (const protocolCode of PROTOCOLS[blockchain.name]) {
      initUniquePairAddr[protocolCode] = new Set();
      tradedPairsPool[blockchain.name][protocolCode] = [];
    }
    
    uniquePairsPool[blockchain.name] = initUniquePairAddr;

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
            // Ading pairs traded for each protocol.
            tradedPairsPool[blockchain.name][protocolCode].push(...tradedPairAddrs[protocolCode]);
            // Adding unique pairs traded by blockchain and protocol.
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
      //Count pairs repetitions and sort them by repetition count.
      tradesCountByChain[blockchain.name] = sortTradesCount(
        toTradesCount(tradedPairsPool[blockchain.name])
      );
      
      // Add one interval of data.
      historyPool.push(structuredClone(tradesCountByChain));
      // Flush recent recieved pairs.
      for (const protocolCode of PROTOCOLS[blockchain.name]) {
        tradedPairsPool[blockchain.name][protocolCode] = [];
      }

      let elapsedIntervals: number = historyPool.length;

      // Removing the elder element of history pool
      if (elapsedIntervals > blockchain.cacheCapacity) {
        historyPool.shift();
        elapsedIntervals = historyPool.length;
      }

      // Safe flush for unique pairs if API calls did not flushed it.
      if (elapsedIntervals > Config.cacheSafeFlush) {
        for (const protocolCode of PROTOCOLS[blockchain.name]) {
          uniquePairsPool[blockchain.name][protocolCode].clear();
        }
      }

      // Caching historyPool in case of program exit.
      saveObject(historyPool, 'historypool.json');
    }, blockchain.cacheInterval * 1000);
  }
}

