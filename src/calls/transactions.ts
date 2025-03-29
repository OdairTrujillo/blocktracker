import { Block, EthersError, TransactionReceipt } from 'ethers';

import { Blockchain, PerformTxReceipt } from 'core';
import { CustomRpcProvider, BackendSelector } from 'core';
import { logger, sleep, CustomError } from 'core';

// Get the traded pairs whithin a block by protocol
export async function callTxsReceipts(
  blockchain: Blockchain,
  blockNumber: number,
  options: {
    attempts?: number;
    backendSelector?: Generator<number>;
  } = {}
): Promise<Array<PerformTxReceipt> | null> {
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
        return Promise.reject(
          new CustomError({
            name: 'SINGLE_REQUEST_ERROR',
            message: `Failed calling block: ${blockNumber}, ${attempts} attempts left`,
            cause: `Block could not be fetched.`
          })
        );
      }
      // Get receipts for all transactions.
      const receiptsPromises: Array<Promise<TransactionReceipt | null>> =
        block.transactions.map(async (txHash: string) =>
          provider.getTransactionReceipt(txHash)
        );

      // A null receipt means that transaction was not mined.
      const receipts: Array<TransactionReceipt | null> =
        await Promise.all(receiptsPromises);

      // Returning receipts (with typeguard to tell TS that will return not nulls).
      return receipts.filter(
        (receipt: TransactionReceipt | null): receipt is TransactionReceipt =>
          receipt !== null
      );
    } catch (error) {
      const ethError: EthersError = error as EthersError;
      if (attempts > 1) {
        const errorDetail: string =
          process.env.RISE_ERROR === 'true'
            ? JSON.stringify(ethError)
            : ethError.message ?? ethError.shortMessage;

        logger.warn(
          `${ethError.name ?? ethError.code ?? 'UNHANDLED_ERROR'}, ` +
            `retrying to get transactions receipts for block: ${blockNumber}. ` +
            `Backend: ${new URL(provider.url).hostname}. ` +
            `\nMessage: ${errorDetail}.`,
          { module: 'Transactions' }
        );

        await sleep(blockchain.sleep);
        return await callWithAttempts(attempts - 1, backendSelector.next().value);
      } else {
        logger.error(`${ethError.message ?? ethError.shortMessage}. ${ethError.code}.`, {
          module: 'Transactions'
        });
        /*
	  After have consumed attempts, a null value will be returned and
	  shoud be handled to not loose blocks data. The null value is the flag.
	*/
        return null;
      }
    }
  }
  // return the recursive call
  return await callWithAttempts(attempts, backendSelector.next().value);
}
