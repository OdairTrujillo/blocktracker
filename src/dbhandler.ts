import { MongoClient, Db } from 'mongodb';
import { Collection, InsertManyResult } from 'mongodb';

import { Chain, Trade } from 'lib';
import { CustomError, logger } from 'lib';

const mongoUri: string = 'mongodb://localhost:27017';
// Setting the test string to switch db in test environmnet
const test: string = process.env.NODE_ENV === 'test' ? '_test' : '';

export async function addTrades(
  chain: Chain,
  collectionName: string,
  trades: Array<Trade>
): Promise<Trade | null> {
  const client: MongoClient = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db: Db = client.db(chain + 'Trades' + test);

    const collectionExists: boolean =
      (await db.listCollections({ name: collectionName }).toArray()).length > 0
        ? true
        : false;

    // Using existing collection or creating a new one.
    const reservesCollection: Collection = db.collection(collectionName);

    /* TODO: separate create collection and index from add reserves, the collection
       have to exist before write try. */

    // Creating index if collection does not exist.
    if (!collectionExists) {
      logger.info(`Creating index for new collection: ${collectionName}`, {
        module: 'Blocktracker/DbHandler'
      });
      reservesCollection.createIndex(
        { blockTimestamp: 1 },
        {
          name: 'Time',
          unique: false,
          collation: { locale: 'en', numericOrdering: true }
        }
      );
    }
    // Inserting and returning last stored element
    const result: InsertManyResult = await reservesCollection.insertMany(trades);
    return result.insertedCount > 0 ? trades.slice(-1)[0] : null;
  } catch (error) {
    throw new CustomError({
      name: 'DB_HANDLER_ERROR',
      message: `Failed adding trades to database chain: ${chain}`,
      cause: error
    });
  } finally {
    await client.close();
  }
}
