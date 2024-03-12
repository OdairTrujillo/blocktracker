import { CustomRpcProvider, BackendSelector, AddressCount } from 'libchainstream';
import { AddrsByChain, AddrsByProtocol, UniqueAddrsByProtocol } from 'libchainstream';
import { AddrsCountByChain, AddrsByProtoByChain } from 'libchainstream';
import { UniqAddrsByProtoByChain, PROTOCOLS } from 'libchainstream';
import { Config, logger, saveObject, readObject } from 'libchainstream';

import { getTradedPairs } from './transactions.js';

// Objects tu be used with the API controllers
export const pairsPool: AddrsByProtoByChain = {} as AddrsByProtoByChain;
export const uniquePairsPool: UniqAddrsByProtoByChain =
  {} as UniqAddrsByProtoByChain;
// This array will store 24 hours of traded pairs.
export const historyPool: Array<AddrsCountByChain> = readObject('historypool.json', []);
export const uniqueHistoryPool: Array<UniqAddrsByProtoByChain> = readObject(
  'uniquehistorypool.json',
  []
);

const addrsCountByChain: AddrsCountByChain = {} as AddrsCountByChain;
const addrsByChain: AddrsByChain = {} as AddrsByChain;

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

      addrsByChain[blockchain.name] = [];
      for (const protocolCode of PROTOCOLS[blockchain.name]) {
        addrsByChain[blockchain.name].push(...pairsPool[blockchain.name][protocolCode]);
      }

      const data: string[] = addrsByChain[blockchain.name];
      addrsCountByChain[blockchain.name] = sortAddressCount(toPairCount(data));

      historyPool.push(structuredClone(addrsCountByChain));
      uniqueHistoryPool.push(structuredClone(uniquePairsPool));

      let elapsedIntervals: number = historyPool.length;
      // Flush recent recieved pairs.
      for (const protocolCode of PROTOCOLS[blockchain.name]) {
        pairsPool[blockchain.name][protocolCode] = [];
      }
      // Removing the elder element of history pool
      if (elapsedIntervals > blockchain.cacheCapacity) {
        historyPool.shift();
        uniqueHistoryPool.shift();
        elapsedIntervals = historyPool.length;
      }
      // Safe flush for unique pairs if api calls did not flushed it.
      if (elapsedIntervals > Config.cacheSafeFlush) {
        for (const protocolCode of PROTOCOLS[blockchain.name]) {
          uniquePairsPool[blockchain.name][protocolCode].clear();
        }
      }

      // Caching historyPool in case of program exit.
      saveObject(historyPool, 'historypool.json');

      saveObject(uniqueHistoryPool, 'uniquehistorypool.json');
    }, blockchain.cacheInterval);
  }
}

function toPairCount(pairsAddresses: string[]): AddressCount {
  const frequencyMap: { [key: string]: number } = {};
  pairsAddresses.forEach((pair: string) => {
    frequencyMap[pair] = (frequencyMap[pair] || 0) + 1;
  });
  return frequencyMap;
}

function sortAddressCount(obj: AddressCount): AddressCount {
  // Convertir el objeto a una matriz de pares [clave, valor]
  const entries: Array<[string, number]> = Object.entries(obj);

  // Ordenar la matriz en función de los valores numéricos (de mayor a menor)
  entries.sort((a, b) => b[1] - a[1]);

  // Convertir la matriz ordenada de nuevo a un objeto
  const sortedObj: AddressCount = {};
  entries.forEach(([key, value]) => {
    sortedObj[key] = value;
  });

  return sortedObj;
}
