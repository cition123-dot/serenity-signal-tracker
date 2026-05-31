import { neon } from "@neondatabase/serverless";

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function sql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  return neon(databaseUrl);
}
