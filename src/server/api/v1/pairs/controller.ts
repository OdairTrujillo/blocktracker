import { Request, Response, NextFunction } from 'express';
import { Chain, ProtocolCode, AddrsByProtocol } from 'libchainstream';
import { PROTOCOLS } from 'libchainstream';

import { uniquePairsPool } from '../../../../events.js';

export async function read(req: Request, res: Response, next: NextFunction) {
  const { body = {} } = req;
  const { chain = 'BNBChain' } = body;

  try {
    let uniquePairsPoolSize: number = 0;
    const responseUniquePairs: AddrsByProtocol = {} as AddrsByProtocol;

    PROTOCOLS[chain as Chain].forEach((protocolCode: ProtocolCode) => {
      uniquePairsPoolSize += uniquePairsPool[chain as Chain][protocolCode].size;
      // Converting the sets to arrays to be able to send it as http response
      responseUniquePairs[protocolCode] = Array.from(
        uniquePairsPool[chain as Chain][protocolCode]
      );
    });

    if (uniquePairsPoolSize > 0) {
      // If a new price feed was created return 201, else return 200
      res.status(200).json({
        success: true,
        message: `${uniquePairsPoolSize} unique pairs were traded for ${chain}.`,
        data: responseUniquePairs
      });
      // await sleep(2000);
      // flush data to start over.
      PROTOCOLS[chain as Chain].forEach((protocolCode: ProtocolCode) => {
        uniquePairsPool[chain as Chain][protocolCode].clear();
      });
    } else {
      res.status(404).json({
        success: false,
        message: `Traded pair addresses pool is empty.`
      });
    }
  } catch (error) {
    next(error);
  }
}
