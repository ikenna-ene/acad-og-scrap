const { MongoClient } = require("mongodb");
require("dotenv").config();
// Use environment variable for the database URI for security

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI environment variable not set.");
}

let client = new MongoClient(uri, {
  maxPoolSize: 10,
  minPoolSize: 2,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 45000,
  socketTimeoutMS: 45000,
});

let db; // This variable will hold the database instance once connected

/**
 * Connects to the MongoDB database. Should be called once at application startup.
 */
async function initializeDatabase() {
  try {
    await client.connect();
    db = client.db("academy-db");

    // Create indexes for better query performance
    await createIndexes();
    console.log("✅ Successfully connected to MongoDB Atlas!");
  } catch (error) {
    console.error("⛔ Error connecting to MongoDB Atlas:", error);
    process.exit(1);
  }
}

/**
 * Creates necessary indexes for optimal query performance
 */
async function createIndexes() {
  try {
    let academyDB_Collection = db.collection("academy-db-scholarships");

    // Create indexes in parallel for better performance
    await Promise.all([
      academyDB_Collection.createIndex({ post_title: 1 }, { background: true }),
      academyDB_Collection.createIndex({ application_deadline: 1 }, { background: true }),
      academyDB_Collection.createIndex({ application_link: 1 }, { unique: true, background: true }),
    ]);

    console.log("✅ Database indexing configuration completed");
    return;
  } catch (error) {
    console.error("⛔ Error configuring indexes:", error);
    // Non-critical error, don't throw
    console.log("ℹ️ Application will continue without optimal indexes");
  }
}

/**
 * Closes the MongoDB connection. Should be called once during application shutdown.
 */
async function closeDatabase() {
  try {
    await client.close();
    console.log("🔌 MongoDB connection closed.");
  } catch (error) {
    console.error("⛔ Error closing MongoDB connection:", error);
    process.exit(1);
  }
}

async function storePosts(postsArr) {
  const posts = Array.isArray(postsArr) ? postsArr : [postsArr];

  if (posts.length === 0) {
    return {
      success: true,
      message: "No posts to process",
      inserted: 0,
      duplicates: 0,
      errors: 0,
    };
  }

  try {
    const result = await db.collection("academy-db-scholarships").insertMany(posts, { ordered: false });

    return {
      success: true,
      message: `Processed ${posts.length} scholar post(s)`,
      inserted: result.insertedCount,
      duplicates: 0,
      errors: 0,
    };
  } catch (error) {
    // If the error is a bulk write error (some succeeded, some failed)
    if (error.name === "MongoBulkWriteError" || error.result) {
      const inserted = error.result.insertedCount;
      const duplicateCount = error.writeErrors?.filter((err) => err.code === 11000).length || 0;
      const otherErrors = (error.writeErrors?.length || 0) - duplicateCount;

      return {
        success: true,
        message: `Processed ${posts.length} scholar post(s) with partial successes`,
        inserted: inserted,
        duplicates: duplicateCount,
        errors: otherErrors,
      };
    }

    // Handle complete system/connection failures
    console.error("Critical error in storage operation:", error.message);
    return {
      success: false,
      message: "Failed to process jobs",
      error: error.message,
      attempted: posts.length,
    };
  }
}

async function checkPostsCount() {
  try {
    // Get collection from the shared 'db' instance
    let sa_Collection = db.collection("academy-db-scholarships");

    // Use estimatedDocumentCount for better performance on large collections
    let count = await sa_Collection.estimatedDocumentCount();

    if (count > 10000) {
      console.log(`🗑️ Posted-Jobs collection has ~${count} documents. Deleting...`);

      let result = await sa_Collection.deleteMany(
        {},
        {
          writeConcern: { w: 1, j: false },
        }
      );

      console.log(`✅ Deleted ${result.deletedCount} documents from Posted-Jobs.`);
      sa_Collection = null;
    } else {
      console.log(
        `Documents are within the target count threshold (10,000 docs)\ncurrent count: `,
        count
      );
    }
  } catch (error) {
    console.error("⛔ Error managing Posted-Jobs collection:", error.message);
    process.exit(1);
  }
}

// -------------------------------------------------------
// Persistent proxy BATCH INDEX only (not the proxy itself)
// Collection: academy-db-config  |  document _id: "proxyBatch"
// Stores: { batchIndex, updatedAt }
// When a working proxy dies, search resumes from this batch.
// -------------------------------------------------------

/**
 * Retrieve the last successful proxy batch index from the database.
 * @returns {Promise<number>} batch start index (0 if none)
 */
async function getProxyBatchIndex() {
  try {
    const doc = await db.collection("academy-db-config").findOne({ _id: "proxyBatch" });
    if (doc && typeof doc.batchIndex === "number") {
      console.log(`📂 Loaded proxy batch index from DB: ${doc.batchIndex}`);
      return doc.batchIndex;
    }
    return 0;
  } catch (error) {
    console.error("⛔ Error reading proxy batch index from DB:", error.message);
    return 0;
  }
}

/**
 * Persist the batch index where a working proxy was found.
 * @param {number} batchIndex  start index of the batch in allProxies
 */
async function saveProxyBatchIndex(batchIndex) {
  try {
    const index = typeof batchIndex === "number" && batchIndex >= 0 ? batchIndex : 0;
    await db.collection("academy-db-config").updateOne(
      { _id: "proxyBatch" },
      {
        $set: {
          batchIndex: index,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    console.log(`💾 Persisted proxy batch index: ${index}`);
  } catch (error) {
    console.error("⛔ Error saving proxy batch index to DB:", error.message);
    // Non-critical – continue without persistence
  }
}

/**
 * Delete the persisted proxy batch index after a full scrape run completes.
 */
async function clearProxyBatchIndex() {
  try {
    const result = await db.collection("academy-db-config").deleteOne({ _id: "proxyBatch" });
    if (result.deletedCount > 0) {
      console.log("🗑️ Cleared proxy batch index from DB");
    } else {
      console.log("ℹ️ No proxy batch index to clear");
    }
  } catch (error) {
    console.error("⛔ Error clearing proxy batch index from DB:", error.message);
    // Non-critical
  }
}

// -------------------------------------------------------
// Scrape progress (listing page + detail index)
// Collection: academy-db-config  |  document _id: "scrapeProgress"
// Survives process crashes so the next run can resume.
// Cleared after a full successful scrape of all listing pages,
// or after a hard browser-restart failure.
// -------------------------------------------------------

/**
 * Load unfinished scrape progress.
 * @returns {Promise<{pageNum:number, detailIndex:number}|null>}
 */
async function getScrapeProgress() {
  try {
    const doc = await db.collection("academy-db-config").findOne({ _id: "scrapeProgress" });
    if (
      doc &&
      typeof doc.pageNum === "number" &&
      typeof doc.detailIndex === "number"
    ) {
      console.log(
        `📂 Loaded scrape progress from DB: page ${doc.pageNum}, detail index ${doc.detailIndex}`
      );
      return { pageNum: doc.pageNum, detailIndex: doc.detailIndex };
    }
    return null;
  } catch (error) {
    console.error("⛔ Error reading scrape progress from DB:", error.message);
    return null;
  }
}

/**
 * Persist current listing page number and detail-post index.
 * @param {number} pageNum
 * @param {number} detailIndex
 */
async function saveScrapeProgress(pageNum, detailIndex) {
  try {
    const p = typeof pageNum === "number" && pageNum >= 1 ? pageNum : 1;
    const d = typeof detailIndex === "number" && detailIndex >= 0 ? detailIndex : 0;
    await db.collection("academy-db-config").updateOne(
      { _id: "scrapeProgress" },
      {
        $set: {
          pageNum: p,
          detailIndex: d,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (error) {
    console.error("⛔ Error saving scrape progress to DB:", error.message);
    // Non-critical
  }
}

/**
 * Delete scrape progress after a clean full run or hard failure.
 */
async function clearScrapeProgress() {
  try {
    const result = await db
      .collection("academy-db-config")
      .deleteOne({ _id: "scrapeProgress" });
    if (result.deletedCount > 0) {
      console.log("🗑️ Cleared scrape progress from DB");
    } else {
      console.log("ℹ️ No scrape progress to clear");
    }
  } catch (error) {
    console.error("⛔ Error clearing scrape progress from DB:", error.message);
    // Non-critical
  }
}

// -------------------------------------------------------
// Proxy run state (working-proxy count + no-proxy attempt chain)
// Collection: academy-db-config  |  document _id: "proxyRunState"
//
// workingProxyCount: successes in the current/last session
// noProxyAttempts:   consecutive full-list failures (0, 1, or 2)
//
// Flow:
//   - Normal start: if leftover workingProxyCount > 0 → clear it and continue
//   - All proxies fail, attempts 0→1 → save, reset cursor to batch 0, re-fetch list, walk proxies again
//   - All proxies fail again, attempts 1→2 → shutdown until next cron run
//   - Session had working proxies → clear state on clean exit
// -------------------------------------------------------

/**
 * @returns {Promise<{workingProxyCount:number, noProxyAttempts:number}>}
 */
async function getProxyRunState() {
  try {
    const doc = await db.collection("academy-db-config").findOne({ _id: "proxyRunState" });
    if (doc) {
      return {
        workingProxyCount:
          typeof doc.workingProxyCount === "number" ? doc.workingProxyCount : 0,
        noProxyAttempts:
          typeof doc.noProxyAttempts === "number" ? doc.noProxyAttempts : 0,
      };
    }
    return { workingProxyCount: 0, noProxyAttempts: 0 };
  } catch (error) {
    console.error("⛔ Error reading proxy run state from DB:", error.message);
    return { workingProxyCount: 0, noProxyAttempts: 0 };
  }
}

/**
 * Persist proxy run state (partial updates allowed).
 * @param {{workingProxyCount?: number, noProxyAttempts?: number}} partial
 */
async function saveProxyRunState(partial) {
  try {
    const $set = { updatedAt: new Date() };
    if (typeof partial.workingProxyCount === "number") {
      $set.workingProxyCount = Math.max(0, partial.workingProxyCount);
    }
    if (typeof partial.noProxyAttempts === "number") {
      $set.noProxyAttempts = Math.max(0, partial.noProxyAttempts);
    }
    await db.collection("academy-db-config").updateOne(
      { _id: "proxyRunState" },
      { $set },
      { upsert: true }
    );
    console.log(
      `💾 Proxy run state saved: workingProxyCount=${
        $set.workingProxyCount !== undefined ? $set.workingProxyCount : "(unchanged)"
      } noProxyAttempts=${
        $set.noProxyAttempts !== undefined ? $set.noProxyAttempts : "(unchanged)"
      }`
    );
  } catch (error) {
    console.error("⛔ Error saving proxy run state to DB:", error.message);
  }
}

/**
 * Delete proxy run state document entirely.
 */
async function clearProxyRunState() {
  try {
    const result = await db
      .collection("academy-db-config")
      .deleteOne({ _id: "proxyRunState" });
    if (result.deletedCount > 0) {
      console.log("🗑️ Cleared proxy run state from DB");
    } else {
      console.log("ℹ️ No proxy run state to clear");
    }
  } catch (error) {
    console.error("⛔ Error clearing proxy run state from DB:", error.message);
  }
}

module.exports = {
  initializeDatabase,
  closeDatabase,
  storePosts,
  checkPostsCount,
  getProxyBatchIndex,
  saveProxyBatchIndex,
  clearProxyBatchIndex,
  getScrapeProgress,
  saveScrapeProgress,
  clearScrapeProgress,
  getProxyRunState,
  saveProxyRunState,
  clearProxyRunState,
};