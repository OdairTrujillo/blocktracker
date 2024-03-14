import { AddressesCount } from 'libchainstream';

export function sortedAddrsCount(pairAddresses: string[]): AddressesCount {
  const frequencyMap: AddressesCount = {};
  for (const pairAddress of pairAddresses) {
    /* Create the property and assign its value, if property value does not
       exists assign it 0 and add 1. If property exists add 1 to its value. */
    frequencyMap[pairAddress] = (frequencyMap[pairAddress] || 0) + 1;
  };

  // Converts the AddressCount into a matrix with elements of [key, value]
  const entries: Array<[string, number]> = Object.entries(frequencyMap);

  /* Descendent sort, if the result of substracting values is positive
     shifts nextEntry with currentEntry. */ 
  entries.sort((currentEntry, nextEntry) => nextEntry[1] - currentEntry[1]);

  // Converts the sorted matrix into an AddrssCount object.
  const sortedAddrsCount: AddressesCount = {};
  for (const entry of entries) {
    sortedAddrsCount[entry[0]] = entry[1];
  };
  
  return sortedAddrsCount;
}
