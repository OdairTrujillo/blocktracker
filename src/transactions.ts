import { Block, EthersError, PerformActionRequest } from 'ethers';
import { Log, LogDescription } from 'ethers';
import { Interface } from 'ethers';

import { CustomRpcProvider, BackendSelector, toChecksumAddress } from 'lib';
import { Blockchain, Protocol, PerformTxReceipt } from 'lib';
import { Config, logger, sleep, CustomError } from 'lib';
import { Trade, DecodedLogs } from 'lib';
import { ROUTERS_ADDRESSES, PAIR_ABI } from 'lib';

// Get the traded pairs whithin a block by protocol
export async function getBlockTrades(
  blockchain: Blockchain,
  blockNumber: number,
  options: {
    attempts?: number;
    backendSelector?: Generator<number>;
  } = {}
): Promise<Array<Trade> | null> {
  const protocols: Array<Protocol> = Config.protocols.filter(
    (protocol: Protocol) => protocol.chain === blockchain.name
  );

  // FIXME: Remove this protocol code.
  const v3: Protocol = { code: 'PCAKESWAP_V3' } as Protocol;
  protocols.push(v3);

  const attempts: number = options.attempts ?? blockchain.attempts;
  const backendSelector: Generator<number> =
    options.backendSelector ?? BackendSelector('fullNode', blockchain.name);

  async function callWithAttempts(
    attempts: number,
    backendPosition: number
  ): Promise<Array<PerformTxReceipt> | null> {
    const provider: CustomRpcProvider = new CustomRpcProvider(
      'fullNode',
      blockchain.name,
      {
        backendPosition: backendPosition
      }
    );
    logger.silly(`Backend: ${new URL(provider.url).hostname}.`, {
      module: 'Transactions'
    });
    // If network error or similar, destroy the provider will throw an error.
    provider.on('error', () => provider.destroy());

    try {
      // Getting the entire block for the given blockNumber
      const block: Block | null = await provider.getBlock(blockNumber);
      if (!block) {
        logger.error(
          `Block ${blockNumber} could not be fetched. ` +
            `Backend: ${new URL(provider.url).hostname}.`,
          { module: 'Transactions' }
        );
        return null;
      }
      // Get receipts for all transactions.
      const receiptsPromises: Array<Promise<PerformTxReceipt | null>> =
        block.transactions.map(async (txHash: string) => {
          const req: PerformActionRequest = {
            method: 'getTransactionReceipt',
            hash: txHash
          };
          return provider._perform(req);
        });

      // A null receipt means that transaction was not mined.
      const receiptsWithNulls: Array<PerformTxReceipt | null> =
        await Promise.all(receiptsPromises);

      // Returning receipts (with typeguard to tell TS that will return not nulls).
      return receiptsWithNulls.filter(
        (receipt: PerformTxReceipt | null): receipt is PerformTxReceipt =>
          receipt !== null
      );
    } catch (error) {
      const ethError: EthersError = error as EthersError;
      if (attempts > 1) {
        logger.warn(
          `${ethError.code ?? 'UNHANDLED_ERROR'}, ` +
            `retrying to get transactions receipts for block ${blockNumber}. ` +
            `Backend: ${new URL(provider.url).hostname}. ` +
            `\nMessage: ${process.env.RISE_ERROR === 'true' ? ethError.shortMessage : ''}.`,
          { module: 'Transactions' }
        );

        await sleep(blockchain.sleep);
        return await callWithAttempts(attempts - 1, backendSelector.next().value);
      } else {
        logger.error(`${ethError.shortMessage ?? ethError.message}. ${ethError.code}.`, {
          module: 'Transactions'
        });
        throw new CustomError({
          name: 'TRANSACTIONS_ERROR',
          message: `Failed getting transactions receipts for block ${blockNumber}`,
          cause: error
        });
      }
    }
  }

  // Store trades in a pair address.
  const trades: Array<Trade> = [];

  // Call of the recursive function.
  const receipts: Array<PerformTxReceipt> | null = await callWithAttempts(
    attempts,
    backendSelector.next().value
  );

  if (receipts !== null) {
    for (const protocol of protocols) {
      const pairInterface: Interface = new Interface(PAIR_ABI[protocol.code]);

      const routersReceipts: Array<PerformTxReceipt> = receipts.filter(
        (receipt: PerformTxReceipt) => {
          return ROUTERS_ADDRESSES[protocol.code].some(
            (routerAddress: string) =>
              routerAddress.toLowerCase() === receipt.to?.toLowerCase()
          );
        }
      );

      // Decode logs for each receipt.
      for (const receipt of routersReceipts) {
        if (receipt.logs && receipt.logs.length > 0) {
          // Arrange decoded logs along with pairs addresses.
          const decodedLogs: DecodedLogs = receipt.logs.reduce(
            (acc: DecodedLogs, log: Log) => {
              const logDecoded: LogDescription | null = pairInterface.parseLog({
                topics: Array.from(log.topics),
                data: log.data
              });
              // Accumulate logs with Swap name, v2 and v3 matches this.
              if (logDecoded !== null && logDecoded.name === 'Swap') {
                acc[log.address] = logDecoded;
              }
              return acc;
            },
            {} as DecodedLogs
          );

          // Assemble the trade objects
          for (const pairAddress in decodedLogs) {
            const decodedLog: LogDescription = decodedLogs[pairAddress];
	    // TODO: Calcular precio y amountTokens, amountUsd, incluir timestamp
	    // ...
	    // Usar toChecksumAddress(pairAddress) para encontrar el pairAddress.
	    // hay que encontrar el oracle.
	    // Identificar si es abc|xyz y obtener el relPairAddress
            const trade: Trade =
              protocol.code.slice(-2) === 'V2'
                ? {
                    pairAddress: toChecksumAddress(pairAddress),
                    txHash: receipt.transactionHash,
                    trader: receipt.from,
                    protocolCode: protocol.code,
                    router: toChecksumAddress(decodedLog.args.sender),
                    recipient: toChecksumAddress(decodedLog.args.to),
                    amount0In: decodedLog.args.amount0In,
                    amount1In: decodedLog.args.amount1In,
                    amount0Out: decodedLog.args.amount0Out,
                    amount1Out: decodedLog.args.amount1Out
                  }
                : {
                    pairAddress: toChecksumAddress(pairAddress),
                    txHash: receipt.transactionHash,
                    trader: receipt.from,
                    protocolCode: protocol.code,
                    router: toChecksumAddress(decodedLog.args.sender),
                    recipient: toChecksumAddress(decodedLog.args.recipient),
                    amount0: decodedLog.args.amount0,
                    amount1: decodedLog.args.amount1
                  };

            trades.push(trade);
          }
        }
      }
    }
    return trades;
  } else {
    return null;
  }
}
