import { Request, Response, NextFunction } from 'express';
import { Chain, AddrsByProtocol, AddrsCountByChain } from 'libchainstream';
import { AddressesCount } from 'libchainstream';
import { Config, Blockchain, PROTOCOLS, CustomError } from 'libchainstream';

import { uniquePairsPool, historyPool } from '../../../../tracker.js';
import { sortAddrsCount } from '../../../../utils.js';

export async function traded(req: Request, res: Response, next: NextFunction) {
  const { body = {} } = req;
  const { chain = 'BNBChain' } = body;

  const blockchain: Blockchain | undefined = Config.blockchains.find(
    (blockchain: Blockchain) => (blockchain.name = chain)
  );

  if (blockchain) {
    try {
      let uniquePairsPoolSize: number = 0;
      const responseUniquePairs: AddrsByProtocol = {} as AddrsByProtocol;

      for (const protocolCode of PROTOCOLS[blockchain.name]) {
        uniquePairsPoolSize += uniquePairsPool[chain as Chain][protocolCode].size;
        // Converting the sets to arrays to be able to send it as http response
        responseUniquePairs[protocolCode] = Array.from(
          uniquePairsPool[blockchain.name][protocolCode]
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
        for (const protocolCode of PROTOCOLS[blockchain.name]) {
          uniquePairsPool[blockchain.name][protocolCode].clear();
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
	  slice: get the last desired units of Config.cacheInterval (minutes) of the history.
	  filter: filter elements by the desired blockchain.
	  map: remove the Chain key of each AddressesCount child object.
	  reduce: get the summation of coincident pair address into a new object.
	*/
        const pairsCount: AddressesCount = structuredClone(historyPool)
          .slice(-timeWindow)
          .filter((item: AddrsCountByChain) => item[blockchain.name] !== undefined)
          .map((item: AddrsCountByChain) => item[blockchain.name])
          .reduce((accumulator: AddressesCount, pairAddrsCount: AddressesCount) => {
            for (const pairAddress in pairAddrsCount) {
              // Check if key pairAddress exists before try to sume its value.
              if (accumulator[pairAddress]) {
                accumulator[pairAddress] += pairAddrsCount[pairAddress];
              }
              // If the key does not exists create it with its respective value.
              else {
                accumulator[pairAddress] = pairAddrsCount[pairAddress];
              }
            }
            return accumulator;
          }, {} as AddressesCount);

        // Finally sort descending and slice the final result.
        const sortedPairsCount: AddressesCount = sortAddrsCount(pairsCount, listLength);
        const pairsCountSize: number = Object.keys(sortedPairsCount).length;

        if (pairsCountSize > 0) {
          res.status(200).json({
            success: true,
            message: `${pairsCountSize} tallied pairs found for ${chain}.`,
            data: sortedPairsCount
          });
        } else {
          res.status(404).json({
            success: false,
            message: `No tallied pairs found for ${chain}.`,
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
	slice: get the last desired units of Config.cacheInterval (minutes) of the history.
	reduce: get the summation of coincident pair address by blockchain into a new object.
      */
      const pairsCount: AddrsCountByChain = structuredClone(historyPool)
        .slice(-timeWindow)
        .reduce(
          (accumulator: AddrsCountByChain, pairsCountByChain: AddrsCountByChain) => {
            // Iterate over chain keys
            for (const key in pairsCountByChain) {
              const chain: Chain = key as Chain;
              if (accumulator[chain]) {
                // Iterate AddressesCount for each chain.
                for (const addressesCount in pairsCountByChain[chain]) {
                  if (accumulator[chain][addressesCount]) {
                    accumulator[chain][addressesCount] +=
                      pairsCountByChain[chain][addressesCount];
                  } else {
                    accumulator[chain][addressesCount] =
                      pairsCountByChain[chain][addressesCount];
                  }
                }
              } else {
                accumulator[chain] = pairsCountByChain[chain];
              }
            }
            return accumulator;
          },
          {} as AddrsCountByChain
        );

      // Finally sort and slice the list for each blockchain
      const sortedPairsCount: AddrsCountByChain = {} as AddrsCountByChain;
      for (const key in pairsCount) {
        const chain: Chain = key as Chain;
        sortedPairsCount[chain] = sortAddrsCount(pairsCount[chain], listLength);
      }

      // Sum each AddressesCount item for all the blockchains.
      const pairsCountSize: number = Object.values(sortedPairsCount).reduce(
        (accumulator: number, addressesCount: AddressesCount) => {
          return accumulator + Object.keys(addressesCount).length;
        },
        0
      );

      if (pairsCountSize > 0) {
        res.status(200).json({
          success: true,
          message: `${pairsCountSize} tallied pairs for all blockchains.`,
          data: sortedPairsCount
        });
      } else {
        res.status(404).json({
          success: false,
          message: `No tallied pairs found for all blockchains.`,
          data: {}
        });
      }
    }
  } catch (error) {
    next(error);
  }
}
