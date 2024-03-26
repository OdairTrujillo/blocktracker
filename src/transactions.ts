import { Block, EthersError, PerformActionRequest } from 'ethers';
import { TransactionDescription, dataSlice, getAddress, dataLength } from 'ethers';
import { CustomRpcProvider, BackendSelector, PairAB, PairElement } from 'libchainstream';
import { Blockchain, PerformTxResponse } from 'libchainstream';
import { logger, sleep, CustomError } from 'libchainstream';
import { TxsByProtocol, AddrsByProtocol } from 'libchainstream';
import { PROTOCOLS, ROUTER_ADDRESS, UNIVERSAL_ROUTER } from 'libchainstream';
import { Config, Protocol } from 'libchainstream';
import { Pairs } from 'oracle';

// Get the traded pairs whithin a block by protocol
export async function getTradedPairs(
  blockchain: Blockchain,
  blockNumber: number,
  options: {
    attempts?: number;
    backendSelector?: Generator<number>;
  } = {}
): Promise<AddrsByProtocol | null> {
  // Store traded pair addresses by protocol with repetitions.
  const tradedPairAddrs: AddrsByProtocol = {} as AddrsByProtocol;
  // Arranging transactions for each protocol
  const routersTransactions: TxsByProtocol = {} as TxsByProtocol;

  // TODO: read attempts from config file.
  const attempts: number = options.attempts ?? blockchain.attempts;
  const backendSelector: Generator<number> =
    options.backendSelector ?? BackendSelector('fullNode', blockchain.name);

  async function parseWithAttempts(
    attempts: number,
    backendPosition: number
  ): Promise<Array<PerformTxResponse> | null> {
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
        logger.error(`Block ${blockNumber} could not be fetched.`, {
          module: 'Transactions'
        });
        return null;
      }
      // Get data of all transactions.
      const txs: Array<PerformTxResponse> = await Promise.all(
        block.transactions.map(async (txHash: string) => {
          const req: PerformActionRequest = { method: 'getTransaction', hash: txHash };
          return await provider._perform(req);
        })
      );
      return txs;
    } catch (error) {
      const ethError: EthersError = error as EthersError;
      if (attempts > 1) {
        logger.warn(
          `${ethError.code ?? 'UNHANDLED_ERROR'},` +
            ` retrying get transactions for block ${blockNumber}`,
          { module: 'Transactions' }
        );
        // TODO: Read this from a config file.
        await sleep(blockchain.sleep);
        return await parseWithAttempts(attempts - 1, backendSelector.next().value);
      } else {
        logger.error(`${ethError.shortMessage ?? ethError.message}. ${ethError.code}.`, {
          module: 'Liquidity'
        });
        throw new CustomError({
          name: 'TRANSACTIONS_ERROR',
          message: `Failed getting transactions for block ${blockNumber}`,
          cause: error
        });
      }
    }
  }

  const txs: Array<PerformTxResponse> | null = await parseWithAttempts(
    attempts,
    backendSelector.next().value
  );

  if (txs) {
    for (const protocolCode of PROTOCOLS[blockchain.name]) {
      const pairsAB: Array<PairAB> = [];
      // Adding each protocol transactions
      routersTransactions[protocolCode] = txs.filter((tx: PerformTxResponse) => {
        return ROUTER_ADDRESS[protocolCode].toLowerCase() === (tx ? tx.to : '');
      });
      // Parsing each transaction for each protocol
      routersTransactions[protocolCode].forEach((tx: PerformTxResponse) => {
        const parsedTx: TransactionDescription | null = UNIVERSAL_ROUTER[
          blockchain.name
        ].parseTransaction({
          data: tx.input
        });
        // Multicalls
        if (parsedTx && parsedTx.name === 'multicall') {
          if (parsedTx.args.length > 1) {
            // Position 1 is the multicall encoded data
            parsedTx.args[1].forEach((txData: string) => {
              const parsedSingleTx: TransactionDescription | null = UNIVERSAL_ROUTER[
                blockchain.name
              ].parseTransaction({ data: txData });
              if (parsedSingleTx) {
                const pairAB: PairAB | null = pairABfromSingleCall(parsedSingleTx);
                if (pairAB) {
                  pairsAB.push(pairAB);
                }
              }
            });
          }
        }
        // Single calls
        if (parsedTx && parsedTx.name !== 'multicall') {
          const pairAB: PairAB | null = pairABfromSingleCall(parsedTx);
          if (pairAB) {
            pairsAB.push(pairAB);
          }
        }
      });
      // Generate traded pair addresses with repetitios.
      // TODO: review how to build pairsAB for v3 routers.
      // const pairAddresses: Array<string> = fromPairsAB('PCAKESWAP_V2', pairsAB);
      const protocols: Array<Protocol> = Config.protocols.filter(
        (protocol: Protocol) => protocol.code === 'PCAKESWAP_V2'
      );
      const pairsElements: Array<PairElement> = await Pairs.callPairs(
        blockchain,
        protocols[0],
        { pairsAB: pairsAB }
      );
      const pairAddresses: Array<string> = pairsElements.map(
        (pairElement: PairElement) => pairElement.pairAddress
      );

      // Adding traded pair addresses.

      // TODO: Make it for all protocols
      tradedPairAddrs['PCAKESWAP_V2'] = pairAddresses;
      tradedPairAddrs['PCAKESWAP_V3'] = [];
    }

    return tradedPairAddrs;
  } else {
    return null;
  }
}

// Utility functions
function pairABfromSingleCall(parsedTx: TransactionDescription): PairAB | null {
  // Router v2 swaps
  if (/^swap.+/.test(parsedTx.name)) {
    if (parsedTx.args.path && parsedTx.args.path.length > 1) {
      return {
        tokenA: String(parsedTx.args.path[0]),
        tokenB: String(parsedTx.args.path[1])
      };
    }
  }
  // Router v3 single swaps
  if (/^(exactInputSingle|exactOutputSingle)$/.test(parsedTx.name)) {
    if (parsedTx.args.params) {
      return {
        tokenA: String(parsedTx.args.params.tokenIn),
        tokenB: String(parsedTx.args.params.tokenOut)
      };
    }
  }
  // Router v3 multihop swaps
  if (/^(exactInput|exactOutput)$/.test(parsedTx.name)) {
    if (parsedTx.args.params.path) {
      const path: string = parsedTx.args.params.path;
      switch (dataLength(path)) {
        case 43: // path = [address, uint24, address]
          return {
            tokenA: getAddress(dataSlice(path, 0, 20)),
            tokenB: getAddress(dataSlice(path, 23))
          };
        case 66: // path = [address, uint24, address, uint24, address]
          return {
            tokenA: getAddress(dataSlice(path, 0, 20)),
            tokenB: getAddress(dataSlice(path, 46))
          };
        case 89: // path = [address, uint24, address, uint24, address, uint24, address]
          return {
            tokenA: getAddress(dataSlice(path, 0, 20)),
            tokenB: getAddress(dataSlice(path, 69))
          };
        default:
          return null;
      } // switch end
    }
  } // multihop if end
  return null; // end function return
}
