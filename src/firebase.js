// src/firebase.js
// Works on Vercel and locally via REACT_APP_* env vars

import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
// (Optional) Analytics, only in browsers that support it
// import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
  // measurementId is optional for analytics:
  // measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
};

// Helpful error in dev if a key is missing
if (process.env.NODE_ENV !== "production") {
  for (const [k, v] of Object.entries(firebaseConfig)) {
    if (!v) {
      // eslint-disable-next-line no-console
      console.warn(`[firebase] Missing env var: ${k}. Set REACT_APP_* env vars locally and in Vercel.`);
    }
  }
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);

// Optional analytics support (uncomment if you want it)
/*
export let analytics = null;
if (typeof window !== "undefined") {
  isSupported()
    .then((ok) => { if (ok) analytics = getAnalytics(app); })
    .catch(() => {});
}
*/
