import { AddressesCount } from 'libchainstream';
import { PairElement, Blockchain, Protocol } from 'libchainstream';
import { PairReserves, Reserves } from 'libchainstream';
import { Price01, PairReservesElement } from 'libchainstream';
import { PairsPriceData } from 'libchainstream';
import { Liquidity } from 'oracle';
import { liquidityCalc, priceCalc, toPriceUsd } from 'libchainstream';
import { fullBackendSelectors } from './index.js';

import { CHAINCOIN, CHAINCOIN_PAIR, STABLES } from 'libchainstream';

export function toAddrsCount(
  pairAddresses: Array<string>,
  options: {
    sorted: boolean;
  }
): AddressesCount {
  const frequencyMap: AddressesCount = {};
  /*
    Create the property and assign its value, if property value does not
    exists assign it 0 and add 1. If property exists add 1 to its value.
  */
  for (const pairAddress of pairAddresses) {
    frequencyMap[pairAddress] = (frequencyMap[pairAddress] || 0) + 1;
  }

  return options.sorted ? frequencyMap : sortAddressesCount(frequencyMap);
}

export function sortAddressesCount(
  addressesCount: AddressesCount,
  listLength?: number
): AddressesCount {
  // Converts the AddressesCount into a matrix with elements of [key, value]
  const entries: Array<[string, number]> = Object.entries(addressesCount);
  /* Descendent sort, if the result of substracting values is positive
     shifts nextEntry with currentEntry. */
  entries.sort((currentEntry, nextEntry) => nextEntry[1] - currentEntry[1]);
  // Converts the sorted matrix into an AddrssCount object.
  const sortedAddrsCount: AddressesCount = {};
  for (const entry of listLength ? entries.slice(0, listLength) : entries) {
    sortedAddrsCount[entry[0]] = entry[1];
  }
  return sortedAddrsCount;
}

async function calcHotData(
  pairsElements: Array<PairElement>,
  blockchain: Blockchain,
  protocol: Protocol
): Promise<PairsPriceData> {
  const pairAddresses: Array<string> = pairsElements.map(
    (pairElement: PairElement) => pairElement.pairAddress
  );

  // Adding BNB price in USD to calc prices based on USD.
  pairAddresses.push(CHAINCOIN_PAIR[blockchain.name]);

  const pairsReserves: Array<PairReserves> = await Liquidity.callReserves(
    blockchain,
    protocol,
    pairAddresses,
    {
      nodeType: 'fullNode',
      backendSelector: fullBackendSelectors[blockchain.name]
    }
  );

  // Getting WBNB price in USD.
  const chainCoinPrice: number = await (async () => {
    const reserves: Reserves = {
      reserve0: pairsReserves.slice(-1)[0].reserve0,
      reserve1: pairsReserves.slice(-1)[0].reserve1,
      blockTimestamp: pairsReserves.slice(-1)[0].blockTimestamp
    };

    const price01: Price01 = priceCalc(reserves, CHAINCOIN_PAIR[blockchain.name], 18, 18);

    return price01.price1;
  })();

  // PairReservesElement cannot has null properties.
  const pairReservesElements: Array<PairReservesElement> = pairsElements
    .map(
      (pairElement: PairElement, index: number) => {
        return {
          token0Symbol: pairElement.token0Symbol,
          token0Address: pairElement.token0Address,
          token0Decimals: pairElement.token0Decimals,
          token1Symbol: pairElement.token1Symbol,
          token1Address: pairElement.token1Address,
          token1Decimals: pairElement.token1Decimals,
          ...pairsReserves[index]
        } as PairReservesElement;
      } // Filter item if some of these properties is null.
    )
    .filter((item) => {
      const someNull: boolean =
        item.token0Address === null ||
        item.token0Decimals === null ||
        item.token1Address === null ||
        item.token1Decimals === null;
      return !someNull;
    });

  const hotPriceData: PairsPriceData = pairReservesElements.reduce(
    (accumulator: PairsPriceData, item: PairReservesElement) => {
      const reserves: Reserves = {
        reserve0: item.reserve0,
        reserve1: item.reserve1,
        blockTimestamp: item.blockTimestamp
      };

      // TODO: Move tokenPriceUSd calculation to function and for all chains
      const price01: Price01 = priceCalc(
        reserves,
        item.pairAddress,
        Number(item.token0Decimals),
        Number(item.token1Decimals)
      );

      const tokenPriceUsd: number = toPriceUsd(
        blockchain.name,
        item.pairAddress,
        item.token0Address,
        item.token1Address,
        price01,
        chainCoinPrice
      );

      // TODO: Generalize all this code for all blockchains, WBNB = ChainCoin
      const tokenSymbol: string =
        item.token0Address === CHAINCOIN[blockchain.name] ||
        STABLES[blockchain.name].includes(item.token0Address)
          ? item.token1Symbol
          : item.token0Symbol;

      const tokenAddress: string =
        item.token0Address === CHAINCOIN[blockchain.name] ||
        STABLES[blockchain.name].includes(item.token0Address)
          ? item.token1Address
          : item.token0Address;

      const liquidityUsd: number = liquidityCalc(
        blockchain.name,
        reserves,
        item.token0Address,
        item.token1Address,
        Number(item.token0Decimals),
        Number(item.token1Decimals),
        tokenPriceUsd,
        chainCoinPrice
      );

      accumulator[item.pairAddress] = {
        tokenAddress: tokenAddress,
        tokenSymbol: tokenSymbol,
        priceUsd: tokenPriceUsd,
        liquidityUsd: liquidityUsd
      };

      return accumulator;
    },
    {} as PairsPriceData
  );
  return hotPriceData;
}
