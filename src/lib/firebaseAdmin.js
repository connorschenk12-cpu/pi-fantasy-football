// src/lib/firebaseAdmin.js
import admin from "firebase-admin";

let app;
if (!admin.apps.length) {
  // Expect a JSON string in env: FIREBASE_SERVICE_ACCOUNT
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  app = admin.initializeApp({
    credential: admin.credential.cert(svc),
  });
} else {
  app = admin.app();
}

export const adminDb = admin.firestore();
