import { EthersError } from 'ethers';

import { CustomRpcProvider, BackendSelector, TradeData, ProtocolCode } from 'lib';
import { Config, logger, saveObject, readObject, Protocol } from 'lib';
import { Trade, TradesByChain, Price } from 'lib';
import { Address, PairElement, absBigInt } from 'lib';

import { ReadOnlyOracle } from 'oracle';
import { toUnsafeFloat, toPrice, getChainCoinPrice } from 'oracle';

import { getBlockTrades } from './transactions.js';
import { oracles } from './index.js';
// This array will store 24 hours of traded pairs.
export const tradesHistory: TradesByChain = {} as TradesByChain;

export function trackTrades(): void {
  for (const blockchain of Config.blockchains) {
    logger.info(`Tracking trades for ${blockchain.name} ...`, { module: 'Tracker' });

    // Read heach blockchain history file.
    try {
      tradesHistory[blockchain.name] = readObject(
        `${blockchain.name.toLowerCase()}trades.json`,
        []
      );
    } catch (error) {
      const ethError: EthersError = error as EthersError;
      logger.error(
        `Failed reading file ${blockchain.name.toLowerCase()}trades.json. ` +
          `${process.env.RISE_ERROR ? ethError.message : ''}`,
        { module: 'Trakcer' }
      );
      continue;
    }

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

    // To store trades for each blokchain.
    let tradesByInterval: Array<TradeData> = [];
    // Register event for new blocks for each unique blockchain provider.
    provider.on('block', async (blockNumber: number) => {
      if (blockNumber % 3 === 0) {
        try {
          const blockTrades: Array<Trade> | null = await getBlockTrades(
            blockchain,
            blockNumber - 1,
            { backendSelector: backendSelector }
          );
          const chainCoinPrice: number = getChainCoinPrice(blockchain);
          // Process pairs if there were protocols traded.
          if (blockTrades !== null) {
            // Obtain all pairElements related with trades for all protocols
            const oraclesForThisChain: Array<ReadOnlyOracle> = oracles[blockchain.name];
            const pairElements: Array<PairElement> = [];
            for (const oracle of oraclesForThisChain) {
              const pairAddresses: Array<Address> = blockTrades.map(
                (trade: Trade) => trade.pairAddress
              );
              pairElements.push(
                ...oracle.getPairElements(
                  { pairAddresses: pairAddresses },
                  { enabled: true }
                )
              );
            }
            // AllPairAddress viene de los pairElement del oráculo pero no necsariamente son todos los pairAddress que vienen del bloque.
            const allPairAddrs: Array<Address> = pairElements.map(
              (item: PairElement) => item.pairAddress
            );
            // Solo trabajamos con los trades para los cuales tengamos los pairElements en la base de datos.
            const blockTradesFiltered: Array<Trade> = blockTrades.filter((trade: Trade) =>
              allPairAddrs.includes(trade.pairAddress)
            );

            // Creo el siguiente objeto e interfaz, para en el siguiente ciclo for evitar el uso de un find, y ahorrar tiempos.
            interface PairElmnts {
              [key: Address]: PairElement;
            }
            const pairElementsObj: PairElmnts = pairElements.reduce(
              (acc: PairElmnts, pairElement: PairElement) => {
                acc[pairElement.pairAddress] = pairElement;
                return acc;
              },
              {} as PairElmnts
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

              const amount0: bigint = trade.amount0
                ? trade.amount0
                : absBigInt((trade.amount0Out ?? 0n) - (trade.amount0In ?? 0n));

              const amount1: bigint = trade.amount1
                ? trade.amount1
                : absBigInt((trade.amount1Out ?? 0n) - (trade.amount1In ?? 0n));

              const amount0Tokens: number = toUnsafeFloat(
                amount0,
                Number(pairElement.token0Decimals)
              );
              const amount1Tokens: number = toUnsafeFloat(
                amount1,
                Number(pairElement.token1Decimals)
              );

              let relPairElement: PairElement | undefined = undefined;

              const oracle: ReadOnlyOracle | undefined = oraclesForThisChain.find(
                (oracle: ReadOnlyOracle) => oracle.protocol.code === protocolCode
              );
              // relPairElement will no overrided if oracle is undefined.
              if (oracle !== undefined && pairElement.meta.normal === false) {
                // Get the related pair for any of both tokens in case of abc|xyz pairs.
                relPairElement = oracle.getRelPairElement(token0Address, token1Address);
              }

              const price: Price = await toPrice(
                blockchain,
                protocolCode,
                pairElement,
                amount0,
                amount1,
                chainCoinPrice,
                { relPairElement: relPairElement, backendSelector: backendSelector }
              );

              const tradedAmountFloat: number =
                price.side === 'price0' ? amount0Tokens : amount1Tokens;

              const tokenA: Address =
                price.side === 'price0' ? token0Address : token1Address;

              const amountIn0: boolean = trade.amount0
                ? trade.amount0 > 0
                  ? true
                  : false
                : (trade.amount0In ?? 0n) > 0
                  ? true
                  : false;
              const amountIn1: boolean = trade.amount1
                ? trade.amount1 > 0
                  ? true
                  : false
                : (trade.amount1In ?? 0n) > 0
                  ? true
                  : false;
              let itsBuy: boolean = false;

              if (tokenA === token0Address && amountIn0) {
                itsBuy = false;
              }

              if (tokenA === token0Address && amountIn1) {
                itsBuy = true;
              }

              if (tokenA === token1Address && amountIn1) {
                itsBuy = false;
              }

              if (tokenA === token1Address && amountIn0) {
                itsBuy = true;
              }

              const tradeDataUsd: TradeData = {
                protocolCode: trade.protocolCode,
                pairAddress: trade.pairAddress,
                txHash: trade.txHash,
                router: trade.router,
                trader: trade.trader,
                recipient: trade.recipient,
                tokenA: tokenA,
                tokenB: price.side === 'price0' ? token1Address : token0Address,
                tokenASymbol: price.side === 'price0' ? token0Symbol : token1Symbol,
                tokenBSymbol: price.side === 'price0' ? token1Symbol : token0Symbol,
                timestamp: trade.timestamp,
                amountA: price.side === 'price0' ? amount0Tokens : amount1Tokens,
                amountB: price.side === 'price0' ? amount1Tokens : amount0Tokens,
                priceUsd: price.value,
                tradedAmountUsd: tradedAmountFloat * price.value,
                itsBuy: itsBuy
              };

              tradesByInterval.push(tradeDataUsd);
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
          clearInterval(historyInterval);
        }
      }
    });

    // Store pairs that were fetched each time interval.
    const historyInterval: NodeJS.Timeout = setInterval(async () => {
      try {
        // Refresh pairElements for all oracles each interval
        const oraclesForThisChain: Array<ReadOnlyOracle> = oracles[blockchain.name];
        for (const oracle of oraclesForThisChain) {
          await oracle.refreshPairElements();
        }

        // Add one interval of data.
        tradesHistory[blockchain.name].push(structuredClone(tradesByInterval));

        // Removing the elder element of history pool
        if (tradesHistory[blockchain.name].length > blockchain.cacheCapacity) {
          tradesHistory[blockchain.name].shift();
        }

        // Caching history to be used by other modules.
        saveObject(
          tradesHistory[blockchain.name],
          `${blockchain.name.toLowerCase()}trades.json`
        );

        logger.debug(
          `${tradesByInterval.length} trades were stored for ${blockchain.name}.`,
          { module: 'Tracker' }
        );
        // Flush to star over with fresh traded pools per interval.
        tradesByInterval = [];
      } catch (error) {
        const ethError: EthersError = error as EthersError;
        logger.error(
          `Failed saving trades history for ${blockchain.name}. ` +
            `${process.env.RISE_ERROR ? ethError.message : ''}`,
          { module: 'Trakcer' }
        );
        provider.removeAllListeners();
        clearInterval(historyInterval);
      }
    }, blockchain.cacheInterval * 1000);
  }
}
