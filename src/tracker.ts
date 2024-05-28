import { EthersError } from 'ethers';
import { format } from 'date-fns';

import { CustomRpcProvider, BackendSelector, ProtocolCode } from 'lib';
import { Config, logger, Protocol } from 'lib';
import { RawTrade, Trade, TradesByChain, Price } from 'lib';
import { Address, PairElement, absBigInt } from 'lib';

import { ReadOnlyOracle } from 'oracle';
import { toUnsafeFloat, toPrice, getChainCoinPrice } from 'oracle';

import { oraclesByChain } from './index.js';
import { getBlockTrades } from './transactions.js';
import { addTrades } from './dbhandler.js';
// This array will store 24 hours of traded pairs.
export const tradesHistory: TradesByChain = {} as TradesByChain;

export function trackTrades(): void {
  for (const blockchain of Config.blockchains) {
    logger.info(`Tracking trades for ${blockchain.name} ...`, { module: 'Tracker' });

    const protocols: Array<Protocol> = Config.protocols.filter(
      (protocol: Protocol) => protocol.chain === blockchain.name
    );

    // FIXME: Remove this protocol code.
    const v3: Protocol = { code: 'PCAKESWAP_V3' } as Protocol;
    protocols.push(v3);

    const backendSelector: Generator<number> = BackendSelector(
      'fullNode',
      blockchain.name
    );

    const provider: CustomRpcProvider = new CustomRpcProvider(
      'regularNode',
      blockchain.name
    );

    // Refresh pair elements to work with fresh data.
    setInterval(async () => {
      const oracles: Array<ReadOnlyOracle> = oraclesByChain[blockchain.name];
      for (const oracle of oracles) {
        await oracle.refreshPairElements();
      }
    }, blockchain.refreshInterval * 1000);

    // To store trades for each blokchain.
    let tradesByInterval: Array<Trade> = [];
    // Register event for new blocks for each unique blockchain provider.
    provider.on('block', async (blockNumber: number) => {
      if (blockNumber % 3 === 0) {
        try {
          const blockTrades: Array<RawTrade> | null = await getBlockTrades(
            blockchain,
            blockNumber - 1,
            { backendSelector: backendSelector }
          );

          // Process pairs if there were protocols traded.
          if (blockTrades !== null) {
            const chainCoinPrice: number = getChainCoinPrice(blockchain);
            const oracles: Array<ReadOnlyOracle> = oraclesByChain[blockchain.name];
            const matchPairElements: Array<PairElement> = [];

            // Object to speedup oracle selection
            type MappedOracles = { [key: string]: ReadOnlyOracle };
            const oraclesObj: MappedOracles = oracles.reduce(
              (acc: MappedOracles, oracle: ReadOnlyOracle) => {
                acc[oracle.protocol.code] = oracle;
                return acc;
              },
              {} as MappedOracles
            );

            // Get all pairElements related with trades for all protocols.
            for (const oracle of oracles) {
              // Getting pair addresses for all protocols that were traded.
              const allPairAddrs: Array<Address> = blockTrades.map(
                (trade: RawTrade) => trade.pairAddress
              );

              // Getting pairElements that match for current oracle.
              const pairElements: Array<PairElement> = oracle.getPairElements(
                { pairAddresses: allPairAddrs },
                { enabled: true }
              );

              // Adding pair elements of the current oracle.
              matchPairElements.push(...pairElements);
            }

            const matchPairAddrs: Array<Address> = matchPairElements.map(
              (item: PairElement) => item.pairAddress
            );

            // Finally get trades that has a matching pair address of available oracles.
            const blockTradesFiltered: Array<RawTrade> = blockTrades.filter(
              (trade: RawTrade) => matchPairAddrs.includes(trade.pairAddress)
            );

            // Object with key pairAddress and value pairElement to speed up selection.
            type MappedPairs = { [key: Address]: PairElement };
            const pairElementsObj: MappedPairs = matchPairElements.reduce(
              (acc: MappedPairs, pairElement: PairElement) => {
                acc[pairElement.pairAddress] = pairElement;
                return acc;
              },
              {} as MappedPairs
            );

            const backendSelector: Generator<number> = BackendSelector(
              'regularNode',
              blockchain.name
            );

            for (const trade of blockTradesFiltered) {
              const protocolCode: ProtocolCode = trade.protocolCode;
              const pairElement: PairElement = pairElementsObj[trade.pairAddress];
              const token0Address: Address = pairElement.token0Address as Address;
              const token1Address: Address = pairElement.token1Address as Address;
              const token0Symbol: string = pairElement.token0Symbol as string;
              const token1Symbol: string = pairElement.token1Symbol as string;

              // Selecting respective amounts for v3 protocol or v2.
              const amount0: bigint = trade.amount0
                ? trade.amount0
                : absBigInt((trade.amount0Out ?? 0n) - (trade.amount0In ?? 0n));

              const amount1: bigint = trade.amount1
                ? trade.amount1
                : absBigInt((trade.amount1Out ?? 0n) - (trade.amount1In ?? 0n));

              // Convering amounts from bigint|decimals to float (loosing precition).
              const amount0Float: number = toUnsafeFloat(
                amount0,
                Number(pairElement.token0Decimals)
              );
              const amount1Float: number = toUnsafeFloat(
                amount1,
                Number(pairElement.token1Decimals)
              );

              // Get the related pair for any of both tokens in case of abc|xyz pairs.
              const relPairElement: PairElement | undefined = !pairElement.meta.normal
                ? oraclesObj[protocolCode].getRelPairElement(token0Address, token1Address)
                : undefined;

              // Calc price taking into account related pair element.
              const price: Price = await toPrice(
                blockchain,
                protocolCode,
                pairElement,
                amount0,
                amount1,
                chainCoinPrice,
                { relPairElement: relPairElement, backendSelector: backendSelector }
              );

              // Selecting right price and token by side.
              const tradedAmountFloat: number =
                price.side === 'price0' ? amount0Float : amount1Float;

              const tokenA: Address =
                price.side === 'price0' ? token0Address : token1Address;

              /*
		Determines where the amount come from, from token0 or from token1.
		trade.amount0 could be negative for v3 protocol. 
	      */
              const amountIn0: boolean =
                trade.amount0 !== undefined
                  ? trade.amount0 > 0
                    ? true
                    : false
                  : (trade.amount0In ?? 0n) > 0
                    ? true
                    : false;

              const amountIn1: boolean =
                trade.amount1 !== undefined
                  ? trade.amount1 > 0
                    ? true
                    : false
                  : (trade.amount1In ?? 0n) > 0
                    ? true
                    : false;

              let isBuy: boolean = false;

              /*
		If tokenA is token0 and amountIn was also with token0 it means a sell,
		on the contrary if the amountIn was with token1 it means a buy.
	       */
              if (tokenA === token0Address && amountIn0) {
                isBuy = false;
              }

              if (tokenA === token0Address && amountIn1) {
                isBuy = true;
              }
              /*
		If tokenA is token1 and amountIn was also with token1 it means a sell,
		on the contrary if the amountIn was with token0 it means a buy.
	       */
              if (tokenA === token1Address && amountIn1) {
                isBuy = false;
              }

              if (tokenA === token1Address && amountIn0) {
                isBuy = true;
              }

              const tradeUsd: Trade = {
                protocolCode: trade.protocolCode,
                pairAddress: trade.pairAddress,
                txHash: trade.txHash,
                router: trade.router,
                trader: trade.trader,
                recipient: trade.recipient,
                tokenA: tokenA,
                tokenB: price.side === 'price0' ? token1Address : token0Address,
                symbolA: price.side === 'price0' ? token0Symbol : token1Symbol,
                symbolB: price.side === 'price0' ? token1Symbol : token0Symbol,
                timestamp: trade.timestamp,
                amountA: price.side === 'price0' ? amount0Float : amount1Float,
                amountB: price.side === 'price0' ? amount1Float : amount0Float,
                priceUsd: price.value,
                tradedAmountUsd: tradedAmountFloat * price.value,
                isBuy: isBuy
              };

              tradesByInterval.push(tradeUsd);
            }
          } else {
            logger.warn(
              `Trades for block ${blockNumber} could not be fetched. ` +
                `Continuing from the next block.`,
              { module: 'Tracker' }
            );
          }
        } catch (error) {
          const ethError: EthersError = error as EthersError;
          logger.error(
            `Failed getting trades for ${blockchain.name}. ` +
              `${process.env.RISE_ERROR ? ethError.message : ''}`,
            { module: 'Trakcer' }
          );
          provider.removeAllListeners();
          clearInterval(storeTradesInterval);
        }
      }
    });

    // Store pairs that were fetched each time interval.
    const storeTradesInterval: NodeJS.Timeout = setInterval(async () => {
      const currentDate: Date = new Date();
      const tradesCollectionName: string = format(currentDate, 'yyyyMMdd') + 'Trades';

      try {
        const result: Trade | null = await addTrades(
          blockchain.name,
          tradesCollectionName,
          tradesByInterval
        );

        if (result !== null) {
          logger.debug(
            `${tradesByInterval.length} trades were stored for ${blockchain.name}.`,
            { module: 'Tracker' }
          );
        } else {
          logger.warn(
            `Could not store trades for ${blockchain.name} at ${tradesCollectionName}.`,
            { module: 'Tracker' }
          );
        }

        // Flush to star over with fresh traded pools per interval.
        tradesByInterval = [];
      } catch (error) {
        const ethError: EthersError = error as EthersError;
        logger.error(
          `Failed adding trades DB for blockchain ${blockchain.name}. ` +
            `${process.env.RISE_ERROR ? ethError.message : ''}`,
          { module: 'Trakcer' }
        );
        provider.removeAllListeners();
        clearInterval(storeTradesInterval);
      }
    }, blockchain.cacheInterval * 1000);
  }
}
