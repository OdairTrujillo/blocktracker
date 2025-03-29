import { Address, Pool, Price } from 'core';

import { RawTrade } from '../declarations.js';
import { Config } from '../config.js';
import { Address } from '../declarations/generics.js';
import { Trade, TradesResultsByAddr, TradesResult } from '../declarations/trades.js';
import { TradesResults, TradesResultByPair } from '../declarations/trades.js';
import { SortTradeOption } from '../declarations/trades.js';
import { PriceData } from '../declarations/market.js';

export function getTradesResultByPair(
  trades: Array<Trade>,
  options: { includeTradesFor?: Array<string> } = {}
): TradesResultByPair {
  // Accumulating trades by pairAddress for the given interval of trades.
  const tradesResultByPair: TradesResultByPair = trades.reduce(
    (tradesResultAcc: TradesResultByPair, trade: Trade) => {
      // Assign values if pairAddress is not pressent.
      if (tradesResultAcc[trade.pairAddress] === undefined) {
        tradesResultAcc[trade.pairAddress] = {
          protocolCode: trade.protocolCode,
          tokenA: trade.tokenA,
          tokenB: trade.tokenB,
          symbolA: trade.symbolA,
          symbolB: trade.symbolB,
          tradedAmountA: trade.amountA,
          tradedAmountB: trade.amountB,
          tradedAmountUsd: trade.tradedAmountUsd,
          initPriceUsd: trade.priceUsd,
          finalPriceUsd: trade.priceUsd,
          priceDelta: 0,
          tradesCount: 1
        };
      } else {
        /* eslint-disable */
        // Increment count and traded amount but override final amounts.
        tradesResultAcc[trade.pairAddress].tradedAmountA += trade.amountA,
        tradesResultAcc[trade.pairAddress].tradedAmountB += trade.amountB,
        tradesResultAcc[trade.pairAddress].tradedAmountUsd += trade.tradedAmountUsd;
        tradesResultAcc[trade.pairAddress].finalPriceUsd = trade.priceUsd;
        tradesResultAcc[trade.pairAddress].tradesCount += 1;
      }

      return tradesResultAcc;
    },
    {} as TradesResultByPair
  );

  
  // Filter trades by tradesCount.
  const tradesReturn: TradesResultByPair = {} as TradesResultByPair;
  for (const pairAddress in tradesResultByPair) {
    let forceInclude: boolean = false;
    // Force inclusion of optional pair addresses to avoud tradesCount filter.
    if (options.includeTradesFor && options.includeTradesFor.includes(pairAddress)) {
      forceInclude = true;
    }
    // Filter trades by tradesCount or force state.
    const fitsTradesCount: boolean =
      tradesResultByPair[pairAddress].tradesCount >= Config.minTradesCountByPair;
    if (fitsTradesCount || forceInclude) {
      // Calc of price delta.
      const item = tradesResultByPair[pairAddress];
      item.priceDelta = item.initPriceUsd // Zero check.
	? (item.finalPriceUsd - item.initPriceUsd) / item.initPriceUsd
	: 0;
     
      tradesReturn[pairAddress] = tradesResultByPair[pairAddress];
    }
  }

  return tradesReturn;
}

export function getTradesResultsByTrader(
  trades: Array<Trade>
): TradesResultsByAddr {
  const tradesResultsByTrader: TradesResultsByAddr = trades.reduce(
    (tradesAcc: TradesResultsByAddr, trade: Trade) => {
      // Assign values if trader is not pressent.
      if (tradesAcc[trade.trader] === undefined) {
        tradesAcc[trade.trader] = {
          pairAddresses: [trade.pairAddress],
	  tradedAmountsUsd: [trade.tradedAmountUsd],
	  tradesCount: 1,
	  totalTradedAmountUsd: 0,
	  priceDeltaMean: 0
        };
      } else {
	/* eslint-disable */
        // Increment count and traded amount but override final amounts.
	tradesAcc[trade.trader].pairAddresses.push(trade.pairAddress);
	tradesAcc[trade.trader].tradedAmountsUsd.push(trade.tradedAmountUsd);
	tradesAcc[trade.trader].tradesCount += 1;
      }

      return tradesAcc;
    },
    {}
  );
  
  // Filter trades by tradesCount.
  const tradesReturn: TradesResultsByAddr = {} as TradesResultsByAddr;
  for (const pairAddress in tradesResultsByTrader) {
    if (tradesResultsByTrader[pairAddress].tradesCount >= Config.minTradesCountByTrader) {
      tradesReturn[pairAddress] = tradesResultsByTrader[pairAddress];
    }
  }

  return tradesReturn;
}

// Overloaded function signatures.
export function sortTradesResult(
  tradesResult: TradesResultByPair,
  sortBy: SortTradeOption,
  sortDesc: boolean,
  listLength: number
): TradesResultByPair;
export function sortTradesResult(
  tradesResult: TradesResultsByAddr,
  sortBy: SortTradeOption,
  sortDesc: boolean,
  listLength: number
): TradesResultsByAddr
// Function implementation.
export function sortTradesResult(
  tradesResult: TradesResultByPair | TradesResultsByAddr,
  sortBy: SortTradeOption,
  sortDesc: boolean,
  listLength: number
): TradesResultByPair | TradesResultsByAddr {
  // Setting a local type to use sort in any case.
  type EntryData = TradesResult & TradesResults;
  type Entry = [Address, EntryData];
  
  // Convert the object to a matrix of entries elements.
  const tradesResultEntries = Object.entries(tradesResult);

  // Sort the array by tradesCount in descending order
  const sortTradesCountFunc = (current: Entry, next: Entry) => sortDesc === true
	? (next[1].tradesCount - current[1].tradesCount)
	: (current[1].tradesCount - next[1].tradesCount);

  const sortPriceDeltaFunc = (current: Entry, next: Entry) => sortDesc === true
	? (next[1].priceDelta - current[1].priceDelta)
    : (current[1].priceDelta - next[1].priceDelta);

  const sortPriceDeltaMeanFunc = (current: Entry, next: Entry) => sortDesc === true
	? (next[1].priceDeltaMean - current[1].priceDeltaMean)
	: (current[1].priceDeltaMean - next[1].priceDeltaMean);

  const sortTradedAmountFunc = (current: Entry, next: Entry) => sortDesc === true
	? (next[1].tradedAmountUsd - current[1].tradedAmountUsd)
	: (current[1].tradedAmountUsd - next[1].tradedAmountUsd);

  let sortFunction;
  switch (sortBy) {
  case 'tradesCount':
    sortFunction = sortTradesCountFunc;
    break;
  case 'priceDelta':
    sortFunction = sortPriceDeltaFunc;
      break;
    case 'priceDeltaMean':
    sortFunction = sortPriceDeltaMeanFunc;
    break;
  case 'tradedAmountUsd':
    sortFunction = sortTradedAmountFunc;
    break;
  default:
    sortFunction = sortTradesCountFunc; // Default sorting function
  }
  
  tradesResultEntries.sort(sortFunction);

  const tradesResultSlice = tradesResultEntries.slice(0, listLength);

  // Convert the sorted array back to an object with pairAddress as keys
  const sortedTradesResult = {} as TradesResultByPair;
  for (const resultEntrie of tradesResultSlice) {
    sortedTradesResult[resultEntrie[0]] = resultEntrie[1];
  }

  return sortedTradesResult;  
}

export function sortTrades(
  trades: Array<Trade>,
  sortBy: SortTradeOption,
  listLength: number,
  options: { pairAddress?: Address; } = {}
): Array<Trade> {
  // Declare sort functions.
  const sortAmountFunc = (current: Trade, next: Trade) => 
    (next.tradedAmountUsd - current.tradedAmountUsd);

  const sortTimestampFunc = (current: Trade, next: Trade) => 
    (next.timestamp - current.timestamp);

  let sortFunc;
  switch (sortBy) {
    case 'tradedAmountUsd':
      sortFunc = sortAmountFunc;
      break;
    case 'timestamp':
      sortFunc = sortTimestampFunc;
      break;
    default:
      sortFunc = sortAmountFunc;
  }

  if (options.pairAddress !== undefined) {
    const filteredTrades: Array<Trade> = trades.filter(
      (trade: Trade) => trade.pairAddress === options.pairAddress
    );
    
    return filteredTrades.sort(sortFunc).slice(0, listLength);
  }
  
  // Use a Set to track seen pair addresses and remove duplicates.
  const seenPairAddresses = new Set<Address>();
  const filteredTrades = [];

  for (const trade of trades) {
    if (!seenPairAddresses.has(trade.pairAddress)) {
      seenPairAddresses.add(trade.pairAddress); // Flag the pairAddress.
      filteredTrades.push(trade); // Push the entire trade.
    }
    if (filteredTrades.length >= listLength) { // Act as slice.
      break;
    }
  }

  return filteredTrades;
}

export function addPriceDeltaMean(
  tradesResultByPair: TradesResultByPair,
  tradesResultsByTrader: TradesResultsByAddr
): void {
  type DeltasAcc = { priceDeltas: Array<number>, tradedAmountsUsd: Array<number> };
  type WeightedAcc = { sumWeightedDeltas: number, totalTradedAmountUsd: number };
  // Calc of priceDelta weighted mean value.
  for (const trader in tradesResultsByTrader) {
    // Get price deltas and trades amounts of pair addresses traded by the trader.
    const { priceDeltas, tradedAmountsUsd } = tradesResultsByTrader[trader].pairAddresses
      .reduce((acc: DeltasAcc, pairAddress: Address, index: number) => {
	if (tradesResultByPair[pairAddress] !== undefined) {
	  acc.priceDeltas.push(tradesResultByPair[pairAddress].priceDelta);
	  acc.tradedAmountsUsd.push(tradesResultsByTrader[trader].tradedAmountsUsd[index]);
	}
	return acc;
      }, { priceDeltas: [], tradedAmountsUsd: [] });

    // Calc of delta price mean.
    const { sumWeightedDeltas, totalTradedAmountUsd } = priceDeltas
      .reduce((acc: WeightedAcc, currPriceDelta: number, index: number) => {
	const currTradedAmountUsd = tradedAmountsUsd[index];
	acc.sumWeightedDeltas += currPriceDelta * currTradedAmountUsd;
	acc.totalTradedAmountUsd += currTradedAmountUsd;
	return acc;
      }, { sumWeightedDeltas: 0, totalTradedAmountUsd: 0 });
    /*
      If any of the trader pairAddresses did not match with any pairAddress
      in resultByPair tradedAmountUsd will be zero and priceDelta should be zero too.
    */
    const priceDelta = totalTradedAmountUsd // Safe zero check.
      ? sumWeightedDeltas / totalTradedAmountUsd
      : 0;

    // Adding properties.
    tradesResultsByTrader[trader].totalTradedAmountUsd = totalTradedAmountUsd;
    tradesResultsByTrader[trader].priceDeltaMean = priceDelta;
  }
}

/*
  This function will discard all blocks with same blockTimestamplast, if the next
  iteration have the same blockTimestampLast for all the blocks, the entire batch will
  be discarted
*/
export function filterPricesData(
  unfilteredPriceDatas: Array<PriceData>
): Array<PriceData> {
  const filteredPriceDatas: Array<PriceData> = [];
  for (let i: number = 0; i < unfilteredPriceDatas.length; i++) {
    if (filteredPriceDatas.length === 0) {
      filteredPriceDatas.push(unfilteredPriceDatas[i]);
    } else {
      if (
        filteredPriceDatas[filteredPriceDatas.length - 1].blockTimestamp ===
        unfilteredPriceDatas[i].blockTimestamp
      ) {
        // Update the block to the most recent one
        filteredPriceDatas[filteredPriceDatas.length - 1].block =
          unfilteredPriceDatas[i].block;
      } else {
        filteredPriceDatas.push(unfilteredPriceDatas[i]);
      }
    }
  }
  return filteredPriceDatas;
}




/**
 * Returns true if the trade is a buy or false if the trade is a sell.
 *
 * @param {RawTrade} trade - Trade whitout price calculations.
 * @param {Pool} pool - The fool info of the pool related to the trade.
 * @param {tokenA} - In a trade tokenA is the left token, could be token0 or token1.
 * @returns {boolean} - Return value, true for a buy, false for a sell.
 *
 * @description
 * 
 */
export function isTradeBuy(
  trade: RawTrade,
  pool: Pool,
  tokenA: Address,
): boolean {
  /**
   * First at all is required to determines where the traded amount came from,
   * from token0 or from token1.
   *
   * (trade.amount0 could be negative for v3 protocol). 
  */
  const amountInFrom0: boolean = trade.amount0 !== undefined
    ? trade.amount0 > 0
      ? true
      : false
    : (trade.amount0In ?? 0n) > 0
      ? true
      : false;

  const amountInFrom1: boolean = trade.amount1 !== undefined
    ? trade.amount1 > 0
      ? true
      : false
    : (trade.amount1In ?? 0n) > 0
      ? true
      : false;

  /**
   * The trade is a buy if tokenA is token0 and amountIn came from token1, or if tokenA
   * is token1 and amountIn came from token0; otherwise the trade is a sell
   */
  
  const isBuy: boolean =
    (tokenA === pool.token0 && amountInFrom1) ||
    (tokenA === pool.token1 && amountInFrom0);
  
  return isBuy;
}
