import { AddrsByProtocol,TradesCount, ProtocolCode, TradesDetails } from 'libchainstream';

export function toTradesCount(addrsByProtocol: AddrsByProtocol): TradesCount {
  const frequencyMap: TradesCount = {};
  for (const protocolCode in addrsByProtocol) {
    const pairAddresses: Array<string> = addrsByProtocol[protocolCode as ProtocolCode]
    for (let i:number = 0; i < pairAddresses.length; i++){
      frequencyMap[pairAddresses[i]] = frequencyMap[pairAddresses[i]] === undefined 
      ? { trades: 1, protocolCode: protocolCode }
      : { trades: frequencyMap[pairAddresses[i]].trades + 1, protocolCode: protocolCode }
    }
  }
  return frequencyMap;
}

export function sortTradesCount(
  tradesCount: TradesCount,
  listLength?: number
): TradesCount {
  // Converts the AddressesCount into a matrix with elements of [key, value]
  const entries: Array<[string, TradesDetails]> = Object.entries(tradesCount);
  /* Descendent sort, if the result of substracting values is positive
     shifts nextEntry with currentEntry. */
  entries.sort((currentEntry, nextEntry) => nextEntry[1].trades - currentEntry[1].trades);
  // Converts the sorted matrix into an AddrssCount object.
  const sortedAddrsCount: TradesCount = {};
  for (const entry of listLength ? entries.slice(0, listLength) : entries) {
    sortedAddrsCount[entry[0]] = entry[1];
  }

  return sortedAddrsCount;
}