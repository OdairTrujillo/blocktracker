import { Request, Response, NextFunction } from 'express';
import {
  Chain,
  AddrsByProtocol,
  AddrsCountByChain,
  AddrsByProtocolByChain,
  AddressCount
} from 'libchainstream';
import { Config, Blockchain, PROTOCOLS, CustomError } from 'libchainstream';

import { uniquePairsPool, historyPool } from '../../../../events.js';

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

export async function hot(req: Request, res: Response, next: NextFunction) {
  const { body = {} } = req;

  const { chain, minuteAmmount = 5, sizeHotList = 5 } = body;

  let addrsCount: AddressCount = {} as AddressCount;
  let hotList: string[] = [];

  try {
    if (chain) {
      const blockchain: Blockchain | undefined = Config.blockchains.find(
        (blockchain: Blockchain) => (blockchain.name = chain)
      );

      if (blockchain) {
        addrsCount = historyPool
          .slice(-minuteAmmount)
          .reduce((result: AddressCount, element: AddrsCountByChain) => {
            const blockchainData: AddressCount = element[blockchain.name];
            Object.keys(blockchainData).forEach((pairAddress: string) => {
              result[pairAddress] =
                (result[pairAddress] || 0) + blockchainData[pairAddress];
            });
            return result;
          }, {} as AddressCount);

        addrsCount = sortAddressCount(addrsCount);
      }
    } else {
      addrsCount = historyPool
        .slice(-minuteAmmount)
        .reduce((result: AddressCount, element: AddrsCountByChain) => {
          Object.values(element).forEach((blockchainData: AddressCount) => {
            Object.keys(blockchainData).forEach((pairAddress: string) => {
              result[pairAddress] =
                (result[pairAddress] || 0) + blockchainData[pairAddress];
            });
          });

          return result;
        }, {} as AddressCount);
      addrsCount = sortAddressCount(addrsCount);
    }

    //TODO: Mostrar a odair, y ajustar a que el resultados sea hotList, no addressCount
    const pairsAddresses: string[] = Object.keys(addrsCount);
    hotList = pairsAddresses.slice(0, sizeHotList);
    const slicedAddrsCount: AddressCount = {};
    hotList.forEach((pairsAddress: string) => {
      slicedAddrsCount[pairsAddress] = addrsCount[pairsAddress];
    });

    const addrsCountSize: number = addrsCount ? Object.keys(addrsCount).length : 0;
    if (addrsCountSize > 0) {
      res.status(200).json({
        success: true,
        message: `Total size ${addrsCountSize} hot list lenght for ${chain}, and data for last  ${minuteAmmount} minutes`,
        data: hotList
      });
    } else {
      res.status(404).json({
        success: false,
        message: `HistoryPool is empty.`,
        data: hotList
      });
    }
  } catch (error) {
    next(error);
  }
}

function sortAddressCount(addressCount: AddressCount): AddressCount {
  if (addressCount) {
    const addrsCountSize: number = Object.keys(addressCount).length;
    if (addrsCountSize > 0) {
      // Convertir el objeto a una matriz de pares [clave, valor]
      const entries: Array<[string, number]> = Object.entries(addressCount);

      // Ordenar la matriz en función de los valores numéricos (de mayor a menor)
      entries.sort((a, b) => b[1] - a[1]);

      // Convertir la matriz ordenada de nuevo a un objeto
      const sortedObj: AddressCount = {};
      entries.forEach(([key, value]) => {
        sortedObj[key] = value;
      });

      return sortedObj;
    } else {
      return addressCount;
    }
  } else {
    return addressCount;
  }
}
