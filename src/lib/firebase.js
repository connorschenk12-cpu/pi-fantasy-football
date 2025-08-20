// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBWEBHSEPR8JummZhprqMS80DOptQHoYKg",
  authDomain: "pi-fantasy-football.firebaseapp.com",
  projectId: "pi-fantasy-football",
  storageBucket: "pi-fantasy-football.firebasestorage.app",
  messagingSenderId: "133234554090",
  appId: "1:133234554090:web:254d166d2b13640440d393",
  measurementId: "G-BWFGWS5XWG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
