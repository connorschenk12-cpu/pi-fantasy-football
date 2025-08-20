// src/lib/firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore, getFirestore } from "firebase/firestore";

// Your Firebase configuration (from your console)
const firebaseConfig = {
  apiKey: "AIzaSyBWEBHSEPR8JummZhprqMS80DOptQHoYKg",
  authDomain: "pi-fantasy-football.firebaseapp.com",
  projectId: "pi-fantasy-football",
  storageBucket: "pi-fantasy-football.appspot.com", // ✅ corrected domain
  messagingSenderId: "133234554090",
  appId: "1:133234554090:web:254d166d2b13640440d393",
  // measurementId: "G-BWFGWS5XWG" // optional; omit in Pi Browser for stability
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Force long-polling (best for Pi Browser webview) and disable fetch streams
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
