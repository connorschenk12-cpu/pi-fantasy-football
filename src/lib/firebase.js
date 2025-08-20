// src/firebase.js

// Import the functions you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBWEBHSEPR8JummZhprqMS80DOptQHoYKg",
  authDomain: "pi-fantasy-football.firebaseapp.com",
  projectId: "pi-fantasy-football",
  storageBucket: "pi-fantasy-football.appspot.com", // 👈 corrected `.appspot.com`
  messagingSenderId: "133234554090",
  appId: "1:133234554090:web:254d166d2b13640440d393",
  measurementId: "G-BWFGWS5XWG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const db = getFirestore(app);
export const auth = getAuth(app);
export const analytics = getAnalytics(app);

export default app;
