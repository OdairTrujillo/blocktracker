import { Blockchain, CustomRpcProvider, BackendSelector } from 'libchainstream';
import { ProtocolCode, AddrsByProtocol, UniqueAddrsByProtocol } from 'libchainstream';
import { AddrsByBlockchain, UniqueAddrsByBlockchain} from 'libchainstream';

import { getTradedPairs } from './transactions';

export const pairsPool: AddrsByProtocol = {} as AddrsByProtocol;
export const uniquePairsPool: UniqueAddrsByProtocol = {} as UniqueAddrsByProtocol;
export const pairsPoolByChain: AddrsByBlockchain = {} as AddrsByBlockchain;
export const uniquePairsPoolBychain: UniqueAddrsByBlockchain = {} as UniqueAddrsByBlockchain;

// As one blockchain has several protocols, use a Set to store unique blockchains.
export function newBlock() {
  const blockchains: Set<Blockchain> = new Set();
  // Register event for new blocks for each unique blockchain provider
  blockchains.forEach((blockchain: Blockchain) => {
    const backendSelector: Generator<number> = BackendSelector('fullNode', blockchain);
    const provider: CustomRpcProvider = new CustomRpcProvider(
      'fullNode',
      blockchain
    );
    
    provider.on('block', async (blockNumber: number) => {
      if (blockNumber % 3 === 0) {
	const pairAddrsByProtocol: AddrsByProtocol =
	  await getTradedPairs(
	    blockchain,
	    blockNumber,
	    { backendSelector: backendSelector }
	  );
	console.log('Pairs traded:\n', pairAddrsByProtocol);
	const protocolCodes: Array<ProtocolCode> =
	  Object.keys(pairAddrsByProtocol) as Array<ProtocolCode>;
	protocolCodes.forEach((protocolCode: ProtocolCode) => {
	  // Adding pair addresses traded in block by protocol
          pairsPool[protocolCode] = pairAddrsByProtocol[protocolCode];
	  // Adding pair addresses traded in block by protocol (unique)
	  for (const pairAddress of pairAddrsByProtocol[protocolCode]) {
	    uniquePairsPool[protocolCode].add(pairAddress);
	  }
	});
	console.log('Pool traded pairs:\n', pairsPool);
	console.log('Pool unique traded pairs:\n', uniquePairsPool);
      }
    });
    
    pairsPoolByChain[blockchain].push(pairsPool);
    uniquePairsPoolBychain[blockchain].push(uniquePairsPool);
  });
}
