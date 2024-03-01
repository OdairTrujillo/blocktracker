import { Blockchain, CustomRpcProvider, BackendSelector } from 'libchainstream';
import { ProtocolCode, AddrsByProtocol, UniqueAddrsByProtocol } from 'libchainstream';
import { AddrsByChain, UniqueAddrsByChain, PROTOCOLS } from 'libchainstream';
import { Config } from 'libchainstream';

import { getTradedPairs } from './transactions.js';

// Objects tu be used with the API controllers
export const pairsPool: AddrsByChain = {} as AddrsByChain;
export const uniquePairsPool: UniqueAddrsByChain = {} as UniqueAddrsByChain;
// This array will store 24 hours of traded pairs.
export const historyPool: Array<AddrsByChain> = [];

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
      'fullNode',
      blockchain.name
    );
    const provider: CustomRpcProvider = new CustomRpcProvider(
      'fullNode',
      blockchain.name
    );

    provider.on('block', async (blockNumber: number) => {
      if (blockNumber % 3 === 0) {
        const tradedPairAddrs: AddrsByProtocol = await getTradedPairs(
          blockchain,
          blockNumber,
          { backendSelector: backendSelector }
        );
        // Process it if there were protocols traded
        if (Object.keys(tradedPairAddrs).length > 0) {
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
          console.log('Pool traded pairs:\n', pairsPool);
          //console.log('Pool unique traded pairs:\n', uniquePairsPool);
        }
      }
    });

    setInterval(async () => {
      // Adding one cacheinterval of data
      historyPool.push(structuredClone(pairsPool));
      // Flush recent stored pairs.
      PROTOCOLS[blockchain.name].forEach((protocolCode: ProtocolCode) => {
        pairsPool[blockchain.name][protocolCode] = [];
      });
      console.log('History pool:\n', historyPool);
    }, blockchain.cacheinterval);
  });
}
