/**
 * QuickStock seed import script.
 *
 * Usage:
 * 1. Put this file in scripts/seedQuickstock.js
 * 2. Put the seed JSON files in data/
 * 3. Install deps if needed: npm install firebase
 * 4. Make sure .env contains VITE_FIREBASE_* values
 * 5. Run:
 *    node scripts/seedQuickstock.js YOUR_HOUSEHOLD_ID
 *
 * Notes:
 * - This script is idempotent by document id: it uses setDoc(..., { merge: true }).
 * - It does not delete existing data.
 * - It imports stockItems first, then recipes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, serverTimestamp, setDoc } from "firebase/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function loadEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error("Missing .env file in project root.");
  }

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] = value;
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function readJson(relativePath) {
  const fullPath = path.join(rootDir, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

async function main() {
  loadEnv();

  const householdId = process.argv[2];
  if (!householdId) {
    throw new Error("Usage: node scripts/seedQuickstock.js YOUR_HOUSEHOLD_ID");
  }

  const app = initializeApp({
    apiKey: requiredEnv("VITE_FIREBASE_API_KEY"),
    authDomain: requiredEnv("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: requiredEnv("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: requiredEnv("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: requiredEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: requiredEnv("VITE_FIREBASE_APP_ID"),
  });

  const db = getFirestore(app);
  const stockItems = readJson("data/stockItems.seed.json");
  const recipes = readJson("data/recipes.seed.json");

  console.log(`Importing ${stockItems.length} stock items...`);
  for (const item of stockItems) {
    const { id, ...data } = item;
    await setDoc(
      doc(db, "households", householdId, "stockItems", id),
      {
        ...data,
        seeded: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  console.log(`Importing ${recipes.length} recipes...`);
  for (const recipe of recipes) {
    const { id, ...data } = recipe;
    await setDoc(
      doc(db, "households", householdId, "recipes", id),
      {
        ...data,
        seeded: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  console.log("Seed import complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
