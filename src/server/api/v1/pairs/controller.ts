import { Request, Response, NextFunction } from 'express';
import { Blockchain, ProtocolCode } from 'libchainstream';

import { pairsPool } from '../../../../events';

export async function read(req: Request, res: Response, next: NextFunction) {
  const { query = {} } = req;
  const { chain: Blockchain = 'BNBChain', timeframe: number = 1 } = query;
  
  try {
    const protocolCodes: Array<ProtocolCode> = Object.keys(pairsPool) as Array<ProtocolCode>;
    if (protocolCodes.length > 0) {
      // If a new price feed was created return 201, else return 200
      res.status(200).json({
        success: true,
        message: `${protocolCodes.length} protocols with traded pairs were found.`,
        data: pairsPool
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
