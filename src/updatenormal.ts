import { Address, PairElement } from 'lib';
import { DbHandler } from 'oracle';
import { Blockchain, Protocol } from 'lib';
import { Config, STABLES } from 'lib';
const blockchain: Blockchain | undefined = Config.blockchains.find(
  (blockchain: Blockchain) => blockchain.name === 'BNBChain'
);

const allPairElements: Array<PairElement> = await DbHandler.readPairElements(
  'PCAKESWAP_V2',
  { pairIndexFrom: 0 }
);

if (blockchain) {
  for (const pairElement of allPairElements) {
    const token0Address: string = pairElement.token0Address as Address;
    const token1Address: string = pairElement.token1Address as Address;
    const isChainPairUsd: boolean =
      (token0Address === blockchain.chainCoinAddr ||
        STABLES[blockchain.name].includes(token0Address)) &&
      (token1Address === blockchain.chainCoinAddr ||
        STABLES[blockchain.name].includes(token1Address));

    const isNormal: boolean =
      token0Address === blockchain.chainCoinAddr ||
      STABLES[blockchain.name].includes(token0Address) ||
      token1Address === blockchain.chainCoinAddr ||
      STABLES[blockchain.name].includes(token1Address);

    if (isNormal || isChainPairUsd){
        pairElement.meta.normal = true
    }else{
        pairElement.meta.normal = false
    }
  }
}


const pairElementsSlices : Array<PairElement[]> = []

for (let i: number = 0; i < allPairElements.length; i += 1000) {
    const slice: Array<PairElement> = allPairElements.slice(i, i + 1000);
    pairElementsSlices.push(slice);
  }



const updatePairElements: Promise<void>[] = pairElementsSlices.map(async (pairElemnts:Array<PairElement>)=>{DbHandler.updatePairElementsNormal('PCAKESWAP_V2',pairElemnts)})
await Promise.all(updatePairElements)
