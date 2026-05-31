import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const db = neon(databaseUrl);

await db`delete from alerts where ticker = 'CPO'`;
await db`delete from price_snapshots where ticker = 'CPO'`;
await db`delete from stock_mentions where ticker = 'CPO'`;
await db`delete from stock_profiles where ticker = 'CPO'`;

console.log("removed CPO from stock tables");
