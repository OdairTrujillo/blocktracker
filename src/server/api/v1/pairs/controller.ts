import { Request, Response, NextFunction } from 'express';
import { Chain, AddrsByProtocol } from 'libchainstream';
import { Config, Blockchain, PROTOCOLS, CustomError } from 'libchainstream';

import { uniquePairsPool } from '../../../../events.js';

export async function read(req: Request, res: Response, next: NextFunction) {
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
        // await sleep(2000);
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
