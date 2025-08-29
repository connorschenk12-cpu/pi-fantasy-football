// src/lib/firebaseAdmin.js
/* eslint-disable no-console */
import admin from "firebase-admin";

function clean(s) {
  return (s || "").replace(/\r/g, "").trim(); // remove CR and trim spaces/newlines
}
function cleanKey(s) {
  // Vercel env var typically stores literal \n — convert to real newlines, trim
  return (s || "").replace(/\\n/g, "\n").replace(/\r/g, "").trim();
}

const projectId = clean(process.env.FIREBASE_PROJECT_ID);
const clientEmail = clean(process.env.FIREBASE_CLIENT_EMAIL);
const privateKey = cleanKey(process.env.FIREBASE_PRIVATE_KEY);

// Optional: helpful log once in dev (won't print the key)
if (!projectId || !clientEmail || !privateKey) {
  console.warn("[firebaseAdmin] Missing one or more env vars: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY");
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    // Do NOT pass databaseURL unless you need RTDB; Firestore doesn't need it.
    // databaseURL: undefined,
  });
}

export const adminDb = admin.firestore();
// Avoid undefined field errors in merges
adminDb.settings({ ignoreUndefinedProperties: true });

export default admin;
