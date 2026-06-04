/**
 * QuickStock seed import script.
 *
 * Usage:
 *   node scripts/seedQuickstock.js YOUR_HOUSEHOLD_ID
 *   node scripts/seedQuickstock.js YOUR_HOUSEHOLD_ID --replace-seeded
 *
 * Notes:
 * - Default mode uses setDoc(..., { merge: true }) and does not delete existing data.
 * - --replace-seeded deletes only documents where seeded === true in stockItems and recipes.
 * - It never deletes non-seeded/manual user data.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  where,
} from "firebase/firestore";

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

async function deleteSeededDocs(db, householdId, collectionName) {
  const ref = collection(db, "households", householdId, collectionName);
  const seededQuery = query(ref, where("seeded", "==", true));
  const snapshot = await getDocs(seededQuery);

  if (snapshot.empty) {
    console.log(`No seeded ${collectionName} docs to delete.`);
    return;
  }

  console.log(`Deleting ${snapshot.size} seeded ${collectionName} docs...`);
  let batch = writeBatch(db);
  let count = 0;

  for (const existingDoc of snapshot.docs) {
    batch.delete(existingDoc.ref);
    count += 1;

    if (count % 450 === 0) {
      await batch.commit();
      batch = writeBatch(db);
    }
  }

  await batch.commit();
}

async function main() {
  loadEnv();

  const householdId = process.argv[2];
  const replaceSeeded = process.argv.includes("--replace-seeded");

  if (!householdId) {
    throw new Error("Usage: node scripts/seedQuickstock.js YOUR_HOUSEHOLD_ID [--replace-seeded]");
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

  if (replaceSeeded) {
    await deleteSeededDocs(db, householdId, "stockItems");
    await deleteSeededDocs(db, householdId, "recipes");
  }

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
