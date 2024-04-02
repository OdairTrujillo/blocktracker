import {
  TradesCount,
  ProtocolCode,
  TradesDetails,
  PairsElmByProtocol
} from 'libchainstream';
import { PairElement, Blockchain, Protocol } from 'libchainstream';
import { PairReserves, Reserves } from 'libchainstream';
import { Price01, PairReservesElement } from 'libchainstream';
import { Config, PairsPriceData } from 'libchainstream';
import { Liquidity } from 'oracle';
import { liquidityCalc, priceCalc, toPriceUsd } from 'libchainstream';
import { archiveBackendSelectors } from './index.js';

import { WBNB, USDT, WBNB_USDT } from 'libchainstream';

export async function toTradesCount(
  pairsElmByProto: PairsElmByProtocol
): Promise<TradesCount> {
  // Declare an empty object to fill it after.
  const frequencyMap: TradesCount = {};

  for (const key in pairsElmByProto) {
    const protocolCode: ProtocolCode = key as ProtocolCode;

    const pairsElements: Array<PairElement> = pairsElmByProto[protocolCode];

    const blockchain: Blockchain | undefined = Config.blockchains.find(
      (blockchain: Blockchain) => blockchain.name === 'BNBChain'
    );

    if (blockchain) {
      const protocols: Array<Protocol> = Config.protocols.filter(
        (protocol: Protocol) => protocol.chain === blockchain.name
      );

      const pricesData: PairsPriceData = await calcHotData(
        pairsElements,
        blockchain,
        protocols[0], // TODO: Modify calcHotData to work with all protocols.
        'latest'
      );

      for (const pairAddress in pricesData) {
        frequencyMap[pairAddress] =
          frequencyMap[pairAddress] === undefined
            ? {
                tokenSymbol: pricesData[pairAddress].tokenSymbol,
                trades: 1,
                protocolCode: protocolCode,
                priceUsd: pricesData[pairAddress].priceUsd,
                liquidityUsd: pricesData[pairAddress].liquidityUsd
              }
            : {
                tokenSymbol: pricesData[pairAddress].tokenSymbol,
                trades: frequencyMap[pairAddress].trades + 1,
                protocolCode: protocolCode,
                priceUsd: pricesData[pairAddress].priceUsd,
                liquidityUsd: pricesData[pairAddress].liquidityUsd
              };
      }
    }
  }
  return frequencyMap;
}

export function sortTradesCount(
  tradesCount: TradesCount,
  listLength?: number
): TradesCount {
  // Converts the AddressesCount into a matrix with elements of [key, value]
  const entries: Array<[string, TradesDetails]> = Object.entries(tradesCount);
  /* Descendent sort, if the result of substracting values is positive
     shifts nextEntry with currentEntry. */
  entries.sort((currentEntry, nextEntry) => nextEntry[1].trades - currentEntry[1].trades);
  // Converts the sorted matrix into an AddrssCount object.
  const sortedAddrsCount: TradesCount = {};
  for (const entry of listLength ? entries.slice(0, listLength) : entries) {
    sortedAddrsCount[entry[0]] = entry[1];
  }
  return sortedAddrsCount;
}

async function calcHotData(
  pairsElements: Array<PairElement>,
  blockchain: Blockchain,
  protocol: Protocol,
  blockTag: string | number
): Promise<PairsPriceData> {
  const pairAddresses: Array<string> = pairsElements.map(
    (pairElement: PairElement) => pairElement.pairAddress
  );

  // Adding BNB price in USD to calc prices based on USD.
  pairAddresses.push(WBNB_USDT);

  const pairsReserves: Array<PairReserves> = await Liquidity.callReserves(
    blockchain,
    protocol,
    pairAddresses,
    {
      blockTag: blockTag,
      attempts: 2,
      backendSelector: archiveBackendSelectors[blockchain.name]
    }
  );

  // Getting WBNB price in USD.
  const WBNB_PRICE: number = await (async () => {
    const reserves: Reserves = {
      reserve0: pairsReserves.slice(-1)[0].reserve0,
      reserve1: pairsReserves.slice(-1)[0].reserve1,
      blockTimestamp: pairsReserves.slice(-1)[0].blockTimestamp
    };

    const price01: Price01 = priceCalc(reserves, WBNB_USDT, 18, 18);

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
        item.pairAddress,
        item.token0Address,
        item.token1Address,
        price01,
        WBNB_PRICE
      );

      const tokenSymbol: string =
        item.token0Address === WBNB || item.token0Address === USDT
          ? item.token1Symbol
          : item.token0Symbol;

      // TODO: Fix this for all blockchains
      const liquidityUsd: number = liquidityCalc(
        reserves,
        item.token0Address,
        item.token1Address,
        Number(item.token0Decimals),
        Number(item.token1Decimals),
        tokenPriceUsd,
        WBNB_PRICE
      );

      accumulator[item.pairAddress] = {
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
