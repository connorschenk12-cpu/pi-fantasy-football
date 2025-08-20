// src/lib/firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore, getFirestore } from "firebase/firestore";

// ⬇️ use your real values from Firebase Console > Project settings > Web app
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// ✅ WebView-friendly transport; no persistence (sometimes fixes “offline” loops)
let db;
try {
  db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
  });
} catch {
  db = getFirestore(app);
}

export { db };
export default app;
