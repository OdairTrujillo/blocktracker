import { Contract } from 'ethers';
import {
  CustomRpcProvider,
  BackendSelector,
  PairsElmByProtocol,
  FACTORY_ADDRESS,
  FACTORY_ABI
} from 'libchainstream';
import { PairElement, UniqueAddrsByProtocol } from 'libchainstream';
import { PairsByChain, PairsByProtocol } from 'libchainstream';
import { TradesCountByChain, PairsElmByChain } from 'libchainstream';
import { UniqAddrsByChain } from 'libchainstream';
import { Config, logger, saveObject, readObject, Protocol } from 'libchainstream';
import { Oracle, evalPairsElements } from 'oracle';

import { getTradedPairs } from './transactions.js';
import { toTradesCount, sortTradesCount } from './utils.js';
import { oracles } from './index.js';

// Objects tu be used with the API controllers
export const uniquePairsPool: UniqAddrsByChain = {} as UniqAddrsByChain;
// This array will store 24 hours of traded pairs.
export const historyPool: Array<TradesCountByChain> = readObject('historypool.json', []);
// Oracle to query pair elements and reserves, also to sync by pair created.

export function trackTrades() {
  const tradedPairsPool: PairsByChain = {} as PairsByChain;
  const tradesCountByChain: TradesCountByChain = {} as TradesCountByChain;
  // Init objects
  const initUniquePairAddr: UniqueAddrsByProtocol = {} as UniqueAddrsByProtocol;
  // Register event for new blocks for each unique blockchain provider.

  for (const blockchain of Config.blockchains) {
    const protocols: Array<Protocol> = Config.protocols.filter(
      (protocol: Protocol) => protocol.chain === blockchain.name
    );
    // Init objects with empty sets for each blockchain

    tradedPairsPool[blockchain.name] = {} as PairsByProtocol;

    for (const protocol of protocols) {
      initUniquePairAddr[protocol.code] = new Set();
      tradedPairsPool[blockchain.name][protocol.code] = [];
    }

    uniquePairsPool[blockchain.name] = initUniquePairAddr;

    const backendSelector: Generator<number> = BackendSelector(
      'fullNode',
      blockchain.name
    );
    const provider: CustomRpcProvider = new CustomRpcProvider(
      'regularNode',
      blockchain.name
    );

    provider.on('block', async (blockNumber: number) => {
      if (blockNumber % 3 === 0) {
        const tradedPairsAB: PairsByProtocol | null = await getTradedPairs(
          blockchain,
          blockNumber,
          { backendSelector: backendSelector }
        );
        // Process pairs if there were protocols traded.
        if (tradedPairsAB && Object.keys(tradedPairsAB).length > 0) {
          for (const protocol of protocols) {
            // Ading pairs traded for each protocol.
            tradedPairsPool[blockchain.name][protocol.code].push(
              ...tradedPairsAB[protocol.code]
            );
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

    let elapsedIntervals: number = 0;
    // Store pairs that were fetched each time interval.
    setInterval(async () => {
      elapsedIntervals++;
      // Call pairs elements from pairsAB.
      const pairsElmByChain: PairsElmByChain = {} as PairsElmByChain;
      // Loop to fill pairs elements by chain object.
      for (const protocol of protocols) {
        const oracle: Oracle | undefined = oracles[blockchain.name].find(
          (oracle: Oracle) => oracle.protocol.code === protocol.code
        );

        if (oracle) {
          const pairsElements: Array<PairElement> = oracle.poolsFeed.getPairsElements({
            pairsAB: tradedPairsPool[blockchain.name][protocol.code]
          });

          // Eval tu enable recent trades pairs elements.
          const avalsPairsElements: Array<PairElement> = await evalPairsElements(
            blockchain,
            protocol,
            pairsElements,
            {
              withDbWrite: true
            }
          );

          const enabledPairsElements: Array<PairElement> = avalsPairsElements.filter(
            (pairElement: PairElement) => pairElement.meta.enabled
          );

          // Adding unique pairs traded by blockchain and protocol.
          const pairAddresses: Array<string> = enabledPairsElements.map(
            (pairElement: PairElement) => pairElement.pairAddress
          );

          for (const pairAddress of pairAddresses) {
            uniquePairsPool[blockchain.name][protocol.code].add(pairAddress);
          }

          const pairsElmByProtocol: PairsElmByProtocol = {} as PairsElmByProtocol;
          pairsElmByProtocol[protocol.code] = pairsElements;
          pairsElmByChain[blockchain.name] = pairsElmByProtocol;
        }
      }

      //Count pairs repetitions and sort them by repetition count.
      tradesCountByChain[blockchain.name] = sortTradesCount(
        await toTradesCount(pairsElmByChain[blockchain.name])
      );

      // Add one interval of data.
      historyPool.push(structuredClone(tradesCountByChain));
      // Flush recent recieved pairs.
      for (const protocol of protocols) {
        tradedPairsPool[blockchain.name][protocol.code] = [];
      }

      // Removing the elder element of history pool
      if (historyPool.length > blockchain.cacheCapacity) {
        historyPool.shift();
      }

      // Safe flush for unique pairs if API calls did not flushed it.
      if (elapsedIntervals > Config.cacheSafeFlush) {
        for (const protocol of protocols) {
          uniquePairsPool[blockchain.name][protocol.code].clear();
        }
        elapsedIntervals = 0;
      }

      // Caching historyPool in case of program exit.
      saveObject(historyPool, 'historypool.json');
    }, blockchain.cacheInterval * 1000);
  }
}

export async function trackCreatedPairs() {
  for (const blockchain of Config.blockchains) {
    // Getting protocols available.
    const protocols: Array<Protocol> = Config.protocols.filter(
      (protocol: Protocol) => protocol.chain === blockchain.name
    );
    // Registering events on each protocol.
    for (const protocol of protocols) {
      const oracle: Oracle | undefined = oracles[blockchain.name].find(
        (oracle: Oracle) => oracle.protocol.code === protocol.code
      );
      if (oracle) {
        const provider: CustomRpcProvider = new CustomRpcProvider(
          'regularNode',
          blockchain.name
        );

        // TODO: make it for v3.
        const factoryContract: Contract = new Contract(
          FACTORY_ADDRESS['PCAKESWAP_V2'],
          FACTORY_ABI['PCAKESWAP_V2'],
          provider
        );

        // Register event pair created on factory
        factoryContract.on(
          'PairCreated',
          async (_token0: string, _token1: string, _pair: string, _event: bigint) => {
            if (oracle.isSyncingPairs === false) {
              logger.info(`Syncing ${oracle.protocol.code} to last pair index ...`, {
                module: 'BlockTracker'
              });
              await oracle.syncPoolsFeed();
            } else {
              logger.silly(`${oracle.protocol.code} is bussy syncing pairs.`, {
                module: 'BlockTracker '
              });
            }
          }
        );
      }
    }
  }
}
