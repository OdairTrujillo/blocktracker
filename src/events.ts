import { Blockchain, CustomRpcProvider, BackendSelector } from 'libchainstream';
import { ProtocolCode, AddrsByProtocol, UniqueAddrsByProtocol } from 'libchainstream';
import { AddrsByChain, UniqueAddrsByChain, PROTOCOLS } from 'libchainstream';
import { Config, logger, saveObject, readObject, getMemorySize } from 'libchainstream';

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
  // Register event for new blocks for each unique blockchain provider
  Config.blockchains.forEach((blockchain: Blockchain) => {
    // Creating properties with blockchain as key with empty arrays and sets.
    PROTOCOLS[blockchain.name].forEach((protocolCode: ProtocolCode) => {
      initPairAddrs[protocolCode] = [];
      initUniquePairAddr[protocolCode] = new Set();
      pairsPool[blockchain.name] = initPairAddrs;
      uniquePairsPool[blockchain.name] = initUniquePairAddr;
    });

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
	console.log('Block:', blockNumber)
        const tradedPairAddrs: AddrsByProtocol | null = await getTradedPairs(
          blockchain,
          blockNumber,
          { backendSelector: backendSelector }
        );
        // Process it if there were protocols traded
        if (tradedPairAddrs && Object.keys(tradedPairAddrs).length > 0) {
          PROTOCOLS[blockchain.name].forEach((protocolCode: ProtocolCode) => {
            // Ading protocol pairs addresses by blockchain.
            pairsPool[blockchain.name][protocolCode].push(
              ...tradedPairAddrs[protocolCode]
            );
            // Adding protocol unique pairs addresses by blockchain.
            for (const pairAddress of tradedPairAddrs[protocolCode]) {
              uniquePairsPool[blockchain.name][protocolCode].add(pairAddress);
            }
          });
	  // TODO: remove this length code
	  let pairsPoolSize: number = 0;
	  let uniquePairsPoolSize: number = 0;

	  PROTOCOLS[blockchain.name].forEach((protocolCode: ProtocolCode) => {
	    pairsPoolSize += pairsPool[blockchain.name][protocolCode].length;
	    uniquePairsPoolSize += uniquePairsPool[blockchain.name][protocolCode].size;
	  });
          //console.log('Pool traded pairs:', pairsPoolSize);
          console.log('Pool unique traded pairs:', uniquePairsPoolSize);
        } else {
	  logger.warn(
	    `Trades for block ${blockNumber} could not be fetched. ` +
	    `Continuing with the next block.`,
	    { module: 'Transactions' }
	  )
	}
      }
    });
    
    // Store pairs that were fetched each time interval.
    setInterval(async () => {
      // Adding one interval of data, i.e. one minute of data.
      historyPool.push(structuredClone(pairsPool));
      let elapsedIntervals: number = historyPool.length;
      // Flush recent recieved pairs.
      PROTOCOLS[blockchain.name].forEach((protocolCode: ProtocolCode) => {
        pairsPool[blockchain.name][protocolCode] = [];
      });
      // Removing the elder element of history pool
      if (elapsedIntervals > blockchain.cacheCapacity) {
	historyPool.shift();
	elapsedIntervals = historyPool.length;
      }
      // Safe flush for unique pairs if api calls did not flushed it.
      if (elapsedIntervals > Config.cacheSafeFlush) {
	PROTOCOLS[blockchain.name].forEach((protocolCode: ProtocolCode) => {
          uniquePairsPool[blockchain.name][protocolCode].clear();
	});
      }
      // TODO: remove this length code
      let historyPoolSize: number = 0;

      PROTOCOLS[blockchain.name].forEach((protocolCode: ProtocolCode) => {
	for (let i=0; i < historyPool.length; i++) {
	  historyPoolSize += historyPool[i][blockchain.name][protocolCode].length;
	}
      });
      console.log('Total pairs in history:', historyPoolSize, 'in', elapsedIntervals, 'intervals');
      // Caching historyPool in case of program exit.
      console.log('Total memmory used by history:', getMemorySize(historyPool, 'MB'), 'MB');
      saveObject(historyPool, 'historyPool.json');
    }, blockchain.cacheInterval);
  });
}
