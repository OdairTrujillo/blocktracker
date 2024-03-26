import {
  AddrsByProtocol,
  TradesCount,
  ProtocolCode,
  TradesDetails
} from 'libchainstream';
import { PairElement, Blockchain, Protocol } from 'libchainstream';
import { PairReserves, Reserves } from 'libchainstream';
import { Price01, ReserveFullElement } from 'libchainstream';
import { Config, PairsPriceData } from 'libchainstream';
import { Liquidity, Pairs } from 'oracle';
import { liquidityCalc, priceCalc } from 'libchainstream';

import { WBNB, USDT, WBNB_USDT } from 'libchainstream';

export async function toTradesCount(
  addrsByProtocol: AddrsByProtocol
): Promise<TradesCount> {
  const frequencyMap: TradesCount = {};
  for (const protocolCode in addrsByProtocol) {
    const pairAddresses: Array<string> = addrsByProtocol[protocolCode as ProtocolCode];

    const blockchain: Blockchain | undefined = Config.blockchains.find(
      (blockchain: Blockchain) => blockchain.name === 'BNBChain'
    );
    const protocol: Protocol | undefined = Config.protocols.find(
      (protocol: Protocol) => protocol.code === 'PCAKESWAP_V2'
    );
    const pairsElements: Array<PairElement> = await Pairs.callPairs(
      blockchain!,
      protocol!,
      { pairAddresses: pairAddresses },
      { attempts: 2 }
    );
    const pricesData: PairsPriceData = await calcHotData(
      pairsElements,
      blockchain!,
      protocol!,
      'latest'
    );

    for (const pairAddress in pricesData) {
      frequencyMap[pairAddress] =
        frequencyMap[pairAddress] === undefined
          ? {
              trades: 1,
              protocolCode: protocolCode,
              priceUsd: pricesData[pairAddress].priceUsd,
              liquidityUsd: pricesData[pairAddress].liquidityUsd
            }
          : {
              trades: frequencyMap[pairAddress].trades + 1,
              protocolCode: protocolCode,
              priceUsd: pricesData[pairAddress].priceUsd,
              liquidityUsd: pricesData[pairAddress].liquidityUsd
            };
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
  const pairsAddresses: Array<string> = pairsElements.map(
    (pairElement: PairElement) => pairElement.pairAddress
  );
  const reservesElements: Array<PairReserves> = await Liquidity.getReserves(
    blockchain,
    protocol,
    pairsAddresses,
    {
      blockTag: blockTag,
      attempts: 2
    }
  );
  const reserveFullElements: Array<ReserveFullElement> = pairsElements.map(
    (pairElement: PairElement, index: number) => {
      const reservesElement: PairReserves = reservesElements[index];
      return {
        ...pairElement,
        ...reservesElement,
        block: reservesElement.block
      };
    }
  );

  const WBNB_PRICE: number = await (async () => {
    const wbnbreserves: Array<PairReserves> = await Liquidity.getReserves(
      blockchain,
      protocol,
      [WBNB_USDT],
      {
        blockTag: blockTag,
        attempts: 2
      }
    );
    const reserves: Reserves = {
      reserve0: wbnbreserves[0].reserve0,
      reserve1: wbnbreserves[0].reserve1,
      blockTimestamp: wbnbreserves[0].blockTimestamp
    };
    const price01: Price01 = priceCalc(reserves, WBNB_USDT, 18, 18);
    return price01.price1;
  })();

  const hotPriceData: PairsPriceData = reserveFullElements.reduce(
    (accumulator, reservefullelement) => {
      const reserves: Reserves = {
        reserve0: reservefullelement.reserve0,
        reserve1: reservefullelement.reserve1,
        blockTimestamp: reservefullelement.blockTimestamp
      };

      // TODO: Move tokenPriceUSd calculation to function and for all chains
      const price01: Price01 = priceCalc(
        reserves,
        reservefullelement.pairAddress,
        Number(reservefullelement.token0Decimals),
        Number(reservefullelement.token1Decimals)
      );
      const price: number =
        reservefullelement.token0Address === WBNB ||
        reservefullelement.token0Address === USDT
          ? price01.price1
          : price01.price0;

      const tokenPriceUsd: number =
        reservefullelement.pairAddress !== WBNB_USDT
          ? reservefullelement.token0Address === WBNB ||
            reservefullelement.token1Address === WBNB
            ? price * WBNB_PRICE
            : price
          : price;

      // TODO: Fix this for all blockchains
      const liquidityUsd: number = liquidityCalc(
        reserves,
        reservefullelement.token0Address,
        reservefullelement.token1Address,
        reservefullelement.token0Decimals,
        reservefullelement.token1Decimals,
        tokenPriceUsd,
        WBNB_PRICE
      );

      accumulator[reservefullelement.pairAddress] = {
        priceUsd: tokenPriceUsd,
        liquidityUsd: liquidityUsd
      };

      return accumulator;
    },
    {} as PairsPriceData
  );
  return hotPriceData;
}
