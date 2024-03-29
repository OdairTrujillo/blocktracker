import { Request, Response, NextFunction } from 'express';
import { Chain, AddrsByProtocol, TradesCount, Protocol } from 'libchainstream';
import { Config, Blockchain, CustomError, TradesCountByChain } from 'libchainstream';

import { uniquePairsPool, historyPool } from '../../../../tracker.js';
import { sortTradesCount } from '../../../../utils.js';

export async function traded(req: Request, res: Response, next: NextFunction) {
  const { body = {} } = req;
  const { chain = 'BNBChain' } = body;

  const blockchain: Blockchain | undefined = Config.blockchains.find(
    (blockchain: Blockchain) => (blockchain.name = chain)
  );

  if (blockchain) {
    try {
      const protocols: Array<Protocol> = Config.protocols.filter(
        (protocol: Protocol) => protocol.chain === blockchain.name
      );

      let uniquePairsPoolSize: number = 0;
      const responseUniquePairs: AddrsByProtocol = {} as AddrsByProtocol;

      for (const protocol of protocols) {
        uniquePairsPoolSize += uniquePairsPool[blockchain.name][protocol.code].size;
        // Converting the sets to arrays to be able to send it as http response
        responseUniquePairs[protocol.code] = Array.from(
          uniquePairsPool[blockchain.name][protocol.code]
        );
      }

      if (uniquePairsPoolSize > 0) {
        // If a new price feed was created return 201, else return 200
        res.status(200).json({
          success: true,
          message: `${uniquePairsPoolSize} pairs were traded for ${chain}.`,
          data: responseUniquePairs
        });
        // flush data to start over.
        for (const protocol of protocols) {
          uniquePairsPool[blockchain.name][protocol.code].clear();
        }
      } else {
        res.status(404).json({
          success: false,
          message: `Traded pair addresses pool is empty.`,
          data: responseUniquePairs
        });
      }
    } catch (error) {
      next(error);
    }
  } else {
    next(
      new CustomError({
        name: 'CONFIG_ERROR',
        message: `Blockchain ${chain} could not be found.`,
        cause: `${chain} is not pressent in gneneral config file.`
      })
    );
  }
}

export async function tradedCount(req: Request, res: Response, next: NextFunction) {
  const { body = {} } = req;
  const { chain, timeWindow = 5, listLength = 10 } = body;

  try {
    if (chain) {
      const blockchain: Blockchain | undefined = Config.blockchains.find(
        (blockchain: Blockchain) => (blockchain.name = chain)
      );

      if (blockchain) {
        /*
	  slice: get the last desired units of Config.cacheInterval (i.e. minutes)
	  of the history.
	  filter: filter elements by the desired blockchain.
	  map: remove the Chain key of each AddressesCount child object.
	  reduce: get the summation of coincident pair address into a new object.
	*/
        const tradesCount: TradesCount = structuredClone(historyPool)
          .slice(-timeWindow)
          .filter((item: TradesCountByChain) => item[blockchain.name] !== undefined)
          .map((item: TradesCountByChain) => item[blockchain.name])
          .reduce((accumulator: TradesCount, pairTradesCount: TradesCount) => {
            for (const pairAddress in pairTradesCount) {
              // Check if key pairAddress exists before try to sume its value.
              if (accumulator[pairAddress]) {
                accumulator[pairAddress].trades += pairTradesCount[pairAddress].trades;
                accumulator[pairAddress].priceUsd = pairTradesCount[pairAddress].priceUsd;
                accumulator[pairAddress].liquidityUsd =
                  pairTradesCount[pairAddress].liquidityUsd;
              }
              // If the key does not exists create it with its respective value.
              else {
                accumulator[pairAddress] = {
                  tokenSymbol: pairTradesCount[pairAddress].tokenSymbol,
                  trades: pairTradesCount[pairAddress].trades,
                  protocolCode: pairTradesCount[pairAddress].protocolCode,
                  priceUsd: pairTradesCount[pairAddress].priceUsd,
                  liquidityUsd: pairTradesCount[pairAddress].liquidityUsd
                };
              }
            }
            return accumulator;
          }, {} as TradesCount);

        // Finally sort descending and slice the final result.
        const sortedTradesCount: TradesCount = sortTradesCount(tradesCount, listLength);
        const pairsCountSize: number = Object.keys(sortedTradesCount).length;

        const sortedPairsCountbyChain: TradesCountByChain = {} as TradesCountByChain;
        sortedPairsCountbyChain[blockchain.name] = sortedTradesCount;

        if (pairsCountSize > 0) {
          res.status(200).json({
            success: true,
            message: `${pairsCountSize} Traded pairs found for ${chain}.`,
            data: sortedPairsCountbyChain
          });
        } else {
          res.status(404).json({
            success: false,
            message: `No traded pairs found for ${chain}.`,
            data: {}
          });
        }
      } else {
        next(
          new CustomError({
            name: 'CONFIG_ERROR',
            message: `Blockchain ${chain} could not be found.`,
            cause: `${chain} is not pressent in gneneral config file.`
          })
        );
      }
    } else {
      /*
	If no chain was passed.
	slice: get the last desired units of Config.cacheInterval (minutes) of the history.
	reduce: get the summation of coincident pair address by blockchain into a new object.
      */
      const tradesCount: TradesCountByChain = structuredClone(historyPool)
        .slice(-timeWindow)
        .reduce(
          (accumulator: TradesCountByChain, pairsCountByChain: TradesCountByChain) => {
            // Iterate over chain keys
            for (const key in pairsCountByChain) {
              const chain: Chain = key as Chain;
              if (accumulator[chain]) {
                // Iterate AddressesCount for each chain.
                for (const pairAddress in pairsCountByChain[chain]) {
                  if (accumulator[chain][pairAddress]) {
                    accumulator[chain][pairAddress].trades +=
                      pairsCountByChain[chain][pairAddress].trades;
                    accumulator[chain][pairAddress].priceUsd =
                      pairsCountByChain[chain][pairAddress].priceUsd;
                    accumulator[chain][pairAddress].liquidityUsd =
                      pairsCountByChain[chain][pairAddress].liquidityUsd;
                  } else {
                    accumulator[chain][pairAddress] = {
                      tokenSymbol: pairsCountByChain[chain][pairAddress].tokenSymbol,
                      trades: pairsCountByChain[chain][pairAddress].trades,
                      protocolCode: pairsCountByChain[chain][pairAddress].protocolCode,
                      priceUsd: pairsCountByChain[chain][pairAddress].priceUsd,
                      liquidityUsd: pairsCountByChain[chain][pairAddress].liquidityUsd
                    };
                  }
                }
              } else {
                accumulator[chain] = pairsCountByChain[chain];
              }
            }
            return accumulator;
          },
          {} as TradesCountByChain
        );

      // Finally sort and slice the list for each blockchain
      const sortedTradesCount: TradesCountByChain = {} as TradesCountByChain;
      for (const key in tradesCount) {
        const chain: Chain = key as Chain;
        sortedTradesCount[chain] = sortTradesCount(tradesCount[chain], listLength);
      }

      // Sum each AddressesCount item for all the blockchains.
      const tradesCountSize: number = Object.values(sortedTradesCount).reduce(
        (accumulator: number, addressesCount: TradesCount) => {
          return accumulator + Object.keys(addressesCount).length;
        },
        0
      );

      if (tradesCountSize > 0) {
        res.status(200).json({
          success: true,
          message: `${tradesCountSize} Traded pairs for all blockchains.`,
          data: sortedTradesCount
        });
      } else {
        res.status(404).json({
          success: false,
          message: `No traded pairs found for all blockchains.`,
          data: {}
        });
      }
    }
  } catch (error) {
    next(error);
  }
}
