import { EthersError, TransactionReceipt } from 'ethers';
import { format } from 'date-fns';

import { CustomRpcProvider, BackendSelector } from 'core';
import { Protocol, ProtocolCode  } from 'core';
import { Address, Pool } from 'core';
import { Config, logger, absBigInt } from 'core';
import { Pools, MappedPools, callPools, addPools, callRelatedPool } from 'core';

import { toUnsafeFloat, toPrice, getChainCoinPrice } from 'core';
import { Price } from 'core';
import { DbHandler } from 'core';

import { RawTrade, Trade, TradesByChain } from './declarations.js';
import { callTxsReceipts } from './calls/index.js';
import { parseTxReceipts } from './utils/transactions.js';
import { isTradeBuy } from './utils/trades.ts~';

// This array will store 24 hours of traded pairs.
export const tradesHistory: TradesByChain = {} as TradesByChain;

/**
 * Scan blocks for each available [[Blockchain]] in the config file and stores each
 * [[Trade]] related to each [[Protocol]] supported in the config file.
 *
 * @returns {Promise<void>}
 *
 * @throws {CustomError} - Handled by nested functions [[callPool]] and [[callTxReceipts]].
 *
 * @description
 * This function tracks all the trades of the supported protocols for each 
 * blockchain supported in the config file. [[Trade]] objects are stored into
 * database to be available to query them.
 */
export function trackTrades(): void {
  for (const blockchain of Config.blockchains) {
    logger.info(`Tracking trades for ${blockchain.name} ...`, { module: 'Tracker' });

    const protocols: Array<Protocol> = Config.protocols.filter(
      (protocol: Protocol) => protocol.chain === blockchain.name
    );

    const provider: CustomRpcProvider = new CustomRpcProvider(
      'fullNode',
      blockchain.name
    );

    const backendSelector: Generator<number> = BackendSelector(
      'fullNode',
      blockchain.name
    );

    // To store trades for each blokchain, will be flushed after stores succeed.
    let blockTrades: Array<RawTrade> = [];
    /**
     * Register event for new blocks for each unique blockchain provider.
     */
    provider.on('block', async (blockNumber: number) => {
      try {
        logger.debug(
	  `Processing block ${blockNumber} on ${blockchain.name}... `,
	  { module: 'Tracker' }
	);
	const txsReceipts: Array<TransactionReceipt> | null = await callTxsReceipts(
	    blockchain,
            blockNumber - 1,
            { backendSelector: backendSelector }	      
	);
	if (txsReceipts !== null) {
	  const currentTrades: Array<RawTrade> | null = await parseTxReceipts(
            blockchain,
	    txsReceipts
          );  
          blockTrades.push(...currentTrades);
	}
        // Send non succesfully blocks to a child process.
        else {
          logger.warn(
            `Trades for block ${blockNumber} could not be processed. ` +
              `TODO: Build a child process to proccess failed blocks.`,
            { module: 'Tracker' }
          );
        }
      } catch (error) {
        const ethError: EthersError = error as EthersError;
        logger.error(
          `Failed getting trades for ${blockchain.name}. ` +
            `${process.env.RISE_ERROR ? JSON.stringify(ethError) : ''}`,
          { module: 'Tracker' }
        );
      }
    });

    /**
     * Store processed pairs each time interval.
     */
    setInterval(async () => {
      // Call traded pools for current blockchain for each protocol.
      const tradedPools: Array<Pool> = protocols.map(
	async (protocol: Protocol) => {
	  const poolsAddresses: Array<Address> = blockTrades.filter(
	    async (rawTrade: RawTrade) => rawTrade.protocolCode === protocol.code
	  );
	  // Call pools with traded pool addresses.
	  return await callPools(
	    blockchain.name,
	    poolsAddresses
	  );
	}
      );
     
      // Map the pools using poolAddress as key.
      const mappedPools: MappedPools = tradedPools.reduce(
        (acc: MappedPools, pool: Pools) => {
          acc[pool.poolAddress] = pool;
          return acc;
        },
        {} as MappedPools
      );
      
      // Store non-stored pools to query them in other modules.
      const lastStoredPool: Pool | null = await addPools(blockchain.name, tradedPools);
      const logMessage: string = lastStoredPool
	? `Last stored pool: ${lastStoredPool.poolAddress}.`
	: 'No pools have been stored.';
      logger.silly(logMessage, { module: 'BlockTracker/trackTrades'});

      /**
       * Trades have to be processed using the full %%pool%% info, as traded pools are
       * called before, it is useful to build a map between traded pools and the pair
       * address of each trade.
       */
      const tradesByInterval: Array<Trade> = [];


      // USD calculations.
      const chainCoinPrice: number = await getChainCoinPrice(blockchain);

      for (const trade of blockTrades) {
	  // Getting the protocol and pool of the current trade and its data.
          const protocolCode: ProtocolCode = trade.protocolCode;
          const pool: Pool = mappedPools[trade.pairAddress];

        /**
	 * A related pool is the pool that matches any token of a non normal pool, a non
	 * normal pool is one composed of ABC/XYZ tokens, i.e without a chaincoin or a stable.
	 * This call is done if the current pool is not normal.
	 */
          const relatedPool: Pool | undefined = !pool.status.normal
            ? await callRelatedPool(pool.token0Address, pool.token1Address)
            : undefined;

	try {
          /**
	   * Variables amount0 and amount1 are defined signed bigints for protocols V3,
	   * but for protocols V2 variables amount0In, amount0Out, amount1In and amount1Out
	   * could be undefined or be positive bigints depending on the trade method used.
	   *
	   * Equations for V2 describes the behavior of a trade in that protocol,
	   * while for trades in protocols V3 a simple assignment is used.
	   */
          const amount0: bigint = trade.amount0
            ? trade.amount0 // V3
            : absBigInt((trade.amount0Out ?? 0n) - (trade.amount0In ?? 0n)); // V2.

          const amount1: bigint = trade.amount1
            ? trade.amount1 // V3
            : absBigInt((trade.amount1Out ?? 0n) - (trade.amount1In ?? 0n)); // V2.

          // Calc price taking into account related pair element.
          const price: Price = await toPrice(
            blockchain,
            protocolCode,
            mappedPools[trade.pairAddress],
            amount0,
            amount1,
            chainCoinPrice,
            { relatedPool: relatedPool, backendSelector: backendSelector }
          );

          // from bigint with decimals to float (loosing precision).
          const amount0Float: number = toUnsafeFloat(
            amount0,
            Number(pool.token0Decimals)
          );
          const amount1Float: number = toUnsafeFloat(
            amount1,
            Number(pool.token1Decimals)
          );

          // If price side was price0 take amount0Float.
          const tradedAmountFloat: number =
            price.side === 'price0' ? amount0Float : amount1Float;

	  // If price side was price0, tokenIn is token0 and tokenOut is token1.
          const tokenIn: Address = price.side === 'price0' ? pool.token0 : pool.token1;
	  const tokenOut: Address = price.side === 'price0' ? pool.token1 : pool.token0;
	  
	  // Determine if the trade was a buy or a sell. 
	  const tradeIsBuy: boolean = isTradeBuy(trade, pool, tokenIn);
	  
          const tradeUsd: Trade = {
            protocolCode: trade.protocolCode,
            pairAddress: trade.pairAddress,
            txHash: trade.txHash,
            router: trade.router,
            trader: trade.trader,
            recipient: trade.recipient,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            symbolIn: price.side === 'price0' ? pool.token0Symbol : pool.token1Symbol,
            symbolOut: price.side === 'price0' ? pool.token1Symbol : pool.token0Symbol,
            timestamp: trade.timestamp,
            amountIn: price.side === 'price0' ? amount0Float : amount1Float,
            amountOut: price.side === 'price0' ? amount1Float : amount0Float,
            priceUsd: price.value,
            tradedAmountUsd: tradedAmountFloat * price.value,
            tradeIsBuy: tradeIsBuy
          };

          tradesByInterval.push(tradeUsd);
        }
      } catch (error) {
        const ethError: EthersError = error as EthersError;
        logger.error(
          `Failed calculating prices of raw trades for ${blockchain.name}. ` +
            `${process.env.RISE_ERROR ? JSON.stringify(ethError) : ethError.message}`,
          { module: 'Tracker' }
        );
      }

      // Storing trades to DB.
      try {
	const currentDate: Date = new Date();
	const tradesCollectionName: string = 'trades' + format(currentDate, 'yyyyMMdd');

        const result: Trade | null = await DbHandler.addTrades(
          blockchain.name,
          tradesCollectionName,
          tradesByInterval
        );

        if (result !== null) {
          logger.debug(
            `${tradesByInterval.length} trades were stored for ${blockchain.name}.`,
            { module: 'Tracker' }
          );

          // Flushing blocks trades to star over.
          blocksTrades = [];
        } else {
          logger.warn(
            `Could not store trades for ${blockchain.name} at ${tradesCollectionName}.`,
            { module: 'Tracker' }
          );
        }
      } catch (error) {
        const ethError: EthersError = error as EthersError;
        logger.error(
          `Failed adding trades to database for blockchain ${blockchain.name}. ` +
            `${process.env.RISE_ERROR ? ethError : 'ethError.message'}`,
          { module: 'Tracker' }
        );
      }
    }, Config.cacheInterval * 1000);
  }
}
