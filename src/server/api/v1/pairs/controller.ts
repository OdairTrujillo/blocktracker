import { Request, Response, NextFunction } from 'express';
import { Chain, ProtocolCode, AddrsByProtocol, PROTOCOLS } from 'libchainstream';

import { pairsPool, uniquePairsPool, historyPool } from '../../../../events.js';

export async function read(req: Request, res: Response, next: NextFunction) {
  const { query = {} } = req;
  // Extracting values of query setting its types.
  const chain: Chain =
    Object.keys(query).length > 0 ? (query.chain as Chain) : 'BNBChain';
  const timeframe: number = Object.keys(query).length > 0 ? Number(query.timeframe) : 1;

  try {
    let pairsPoolSize: number = 0;
    let uniquePairsPoolSize: number = 0;
    const responseUniquePairs: AddrsByProtocol = {} as AddrsByProtocol;

    PROTOCOLS[chain].forEach((protocolCode: ProtocolCode) => {
      pairsPoolSize += pairsPool[chain][protocolCode].length;
      uniquePairsPoolSize += uniquePairsPool[chain][protocolCode].size;
      // Converting the sets to arrays to be able to send it as http response
      responseUniquePairs[protocolCode] = Array.from(
        uniquePairsPool[chain][protocolCode]
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
      PROTOCOLS[chain].forEach((protocolCode: ProtocolCode) => {
        uniquePairsPool[chain][protocolCode].clear();
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
