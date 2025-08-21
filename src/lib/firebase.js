// Firebase init (Firestore configured for Pi Browser)
// Replace config values with YOUR Firebase project values.
import { initializeApp } from "firebase/app";
import { initializeFirestore, getFirestore } from "firebase/firestore";

// --- Your Firebase config (you shared these earlier) ---
const firebaseConfig = {
  apiKey: "AIzaSyBWEBHSEPR8JummZhprqMS80DOptQHoYKg",
  authDomain: "pi-fantasy-football.firebaseapp.com",
  projectId: "pi-fantasy-football",
  storageBucket: "pi-fantasy-football.firebasestorage.app",
  messagingSenderId: "133234554090",
  appId: "1:133234554090:web:254d166d2b13640440d393",
  measurementId: "G-BWFGWS5XWG",
};

const app = initializeApp(firebaseConfig);

// Force long polling so Firestore works reliably in Pi Browser
initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
});

export const db = getFirestore(app);
