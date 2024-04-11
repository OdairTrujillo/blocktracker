import { Request, Response, NextFunction } from 'express';
import { Chain, TradesCount } from 'libchainstream';
import { TradesCountByChain } from 'libchainstream';

import { historyPool } from '../../../../tracker.js';
import { sortTradesCount } from '../../../../utils.js';

export async function traded(req: Request, res: Response, next: NextFunction) {
  const { body = {} } = req;
  const { timeWindow = 5, listLength = 10 } = body;

  try {
    /*
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
                    tokenAddress: pairsCountByChain[chain][pairAddress].tokenAddress,
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
      res.status(410).json({
        success: false,
        message: `No traded pairs found for all blockchains.`,
        data: {}
      });
    }
  } catch (error) {
    next(error);
  }
}
