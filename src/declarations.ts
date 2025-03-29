import { TransactionReceipt, LogDescription } from 'ethers';
import { ObjectId } from 'mongodb';

import { Address } from 'core';
import { Chain, ProtocolCode } from 'core';

export interface PerformTxReceipt extends TransactionReceipt {
  transactionHash: string;
}

export type DecodedTrades = {
  [key: string]: LogDescription;
};

export type SortTradeOption =
  | 'tradesCount'
  | 'priceDelta'
  | 'priceDeltaMean'
  | 'tradedAmountUsd'
  | 'timestamp';

export interface RawTrade {
  pairAddress: Address;
  txHash: string;
  timestamp: number;
  trader: string;
  protocolCode: ProtocolCode;
  router: Address;
  recipient: Address;
  amount0In?: bigint;
  amount1In?: bigint;
  amount0Out?: bigint;
  amount1Out?: bigint;
  amount0?: bigint;
  amount1?: bigint;
}

export interface Trade {
  protocolCode: ProtocolCode;
  pairAddress: Address;
  txHash: string;
  router: Address;
  trader: string;
  recipient: string;
  tokenIn: Address;
  tokenOut: Address;
  symbolIn: string;
  symbolOut: string;
  timestamp: number;
  amountIn: number;
  amountOut: number;
  priceUsd: number;
  tradedAmountUsd: number;
  tradeIsBuy: boolean;
  _id?: ObjectId;
}

export type TradesByChain = {
  [key in Chain]: Array<Trade>[];
};

// To accumulate the result of certain trades over an interval by pairAddress or trader.
// TODO: Miragate interfaces to types.
export type TradesResult = {
  protocolCode: ProtocolCode;
  tokenA: string;
  tokenB: string;
  symbolA: string;
  symbolB: string;
  tradedAmountA: number;
  tradedAmountB: number;
  initPriceUsd: number;
  finalPriceUsd: number;
  tradedAmountUsd: number;
  priceDelta: number;
  tradesCount: number;
};

export type TradesResultByPair = {
  [key: Address]: TradesResult;
};

export type TradesResults = {
  pairAddresses: Array<Address>;
  tradedAmountsUsd: Array<number>;
  tradesCount: number;
  totalTradedAmountUsd: number;
  priceDeltaMean: number;
};

export type TradesResultsByAddr = {
  [key: Address]: TradesResults;
};
