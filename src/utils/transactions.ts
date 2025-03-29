import { TransactionReceipt, Log, LogDescription } from 'ethers';
import { Interface } from 'ethers';

import { Blockchain } from 'core';
import { Config, Protocol, toChecksumAddress } from 'core';
import { ROUTERS_ADDRESSES, POOL_ABI } from 'core';

import { RawTrade, DecodedTrades } from '../declarations.js';

// Get the traded pairs whithin a block by protocol
export async function parseTxReceipts(
  blockchain: Blockchain,
  txReceipts: Array<TransactionReceipt>
): Promise<Array<RawTrade>> {
  const protocols: Array<Protocol> = Config.protocols.filter(
    (protocol: Protocol) => protocol.chain === blockchain.name
  );
  // Store trades in a pair address.
  const trades: Array<RawTrade> = [];
  const timestamp: number = Math.floor(Date.now() / 1000);

  for (const protocol of protocols) {
    const pairInterface: Interface = new Interface(POOL_ABI[protocol.code]);

    const routersReceipts: Array<TransactionReceipt> = txReceipts.filter(
      (receipt: TransactionReceipt) => {
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
        const decodedLogs: DecodedTrades = receipt.logs.reduce(
          (acc: DecodedTrades, log: Log) => {
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
          {} as DecodedTrades
        );

        // Assemble the trade objects
        for (const pairAddress in decodedLogs) {
          const decodedLog: LogDescription = decodedLogs[pairAddress];
          let trade: RawTrade;
          switch (protocol.code.slice(-2)) {
            case 'V2':
              trade = {
                pairAddress: toChecksumAddress(pairAddress),
                txHash: receipt.transactionHash,
                timestamp: timestamp,
                trader: receipt.from,
                protocolCode: protocol.code,
                router: toChecksumAddress(decodedLog.args.sender),
                recipient: toChecksumAddress(decodedLog.args.to),
                amount0In: decodedLog.args.amount0In,
                amount1In: decodedLog.args.amount1In,
                amount0Out: decodedLog.args.amount0Out,
                amount1Out: decodedLog.args.amount1Out
              };
              break;
            case 'V3':
              trade = {
                pairAddress: toChecksumAddress(pairAddress),
                txHash: receipt.transactionHash,
                timestamp: timestamp,
                trader: receipt.from,
                protocolCode: protocol.code,
                router: toChecksumAddress(decodedLog.args.sender),
                recipient: toChecksumAddress(decodedLog.args.recipient),
                amount0: decodedLog.args.amount0,
                amount1: decodedLog.args.amount1
              };
              break;
            default:
              continue; // Jump to the next trade
          }
          trades.push(trade);
        }
      }
    }
  }
  return trades;
}
