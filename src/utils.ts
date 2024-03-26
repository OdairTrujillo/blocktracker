import {
  AddrsByProtocol,
  TradesCount,
  ProtocolCode,
  TradesDetails
} from 'libchainstream';
import { FixedNumber } from 'ethers';
import { PairElement, Blockchain, Protocol } from 'libchainstream';
import { PairReserves, Reserves } from 'libchainstream';
import { Price01, Numeric, ReserveFullElement } from 'libchainstream';
import { BigNumberish, delayedLogger, Config, PairsPriceData } from 'libchainstream';
import { Liquidity, Pairs } from 'oracle';
import { padReserves, priceCalc, PaddedReserves } from  'dexapi';

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

  const WBNB_USDT: string = '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE';
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
    const price01: Price01 = priceCalc(reserves, WBNB_USDT, 18n, 18n);
    return price01.price1;
  })();

  const WBNB: string = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
  const USDT: string = '0x55d398326f99059fF775485246999027B3197955';

  const hotPriceData: PairsPriceData = reserveFullElements.reduce(
    (accumulator, reservefullelement) => {
      const reserves: Reserves = {
        reserve0: reservefullelement.reserve0,
        reserve1: reservefullelement.reserve1,
        blockTimestamp: reservefullelement.blockTimestamp
      };

      const price01: Price01 = priceCalc(
        reserves,
        reservefullelement.pairAddress,
        reservefullelement.token0Decimals,
        reservefullelement.token1Decimals
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
      
      const paddReserves: PaddedReserves = padReserves(reserves,
        reservefullelement.token0Decimals,
        reservefullelement.token1Decimals)

      const reserve0: number = FixedNumber.fromValue(
        paddReserves.reserve0,
        (reservefullelement.token0Decimals as Numeric) ?? undefined
      ).toUnsafeFloat()*10**paddReserves.removed0Decimals;
      const reserve1: number = FixedNumber.fromValue(
        paddReserves.reserve1,
        (reservefullelement.token1Decimals as Numeric) ?? undefined
      ).toUnsafeFloat()*10**paddReserves.removed1Decimals;

      const reserve0Usd: number =
        reservefullelement.token0Address === WBNB
          ? reserve0 * WBNB_PRICE
          : reservefullelement.token0Address === USDT
            ? reserve0
            : reserve0 * tokenPriceUsd;
      const reserve1Usd: number =
        reservefullelement.token1Address === WBNB
          ? reserve1 * WBNB_PRICE
          : reservefullelement.token1Address === USDT
            ? reserve1
            : reserve1 * tokenPriceUsd;
      const liquidity: number = reserve0Usd + reserve1Usd;

      accumulator[reservefullelement.pairAddress] = {
        priceUsd: tokenPriceUsd,
        liquidityUsd: liquidity
      };

      return accumulator;
    },
    {} as PairsPriceData
  );

  return hotPriceData;
}

interface TruncateReserves extends Reserves{
  token0Decimals: number;
  token1Decimals: number
}
