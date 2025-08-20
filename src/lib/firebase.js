// src/lib/firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

// ⬇️ REPLACE with your real values
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
  // measurementId: "G-XXXXXXX" // optional
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// 🚑 Important for WebViews (Pi Browser): force long-polling + use modern cache
// - experimentalForceLongPolling: avoids WebSocket issues in webviews
// - useFetchStreams: false for compatibility
// - local cache: keeps app usable if network temporarily blips
export const db =
  // If Firestore already created (hot reload), reuse it; otherwise init with options
  (() => {
    try {
      return initializeFirestore(app, {
        experimentalForceLongPolling: true,
        useFetchStreams: false,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch {
      // fallback if already initialized
      return getFirestore(app);
    }
  })();

export default app;
