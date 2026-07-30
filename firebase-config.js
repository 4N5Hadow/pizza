// 1. Go to https://console.firebase.google.com → create a free project.
// 2. Build > Firestore Database > Create database (start in test mode, then lock down
//    with the rules from README.md before you get real traffic).
// 3. Project settings > General > scroll to "Your apps" > Add app > Web (</>).
// 4. Copy the config object Firebase gives you and paste the values below.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyD6emoeTFLrrFC_fcG86DDwG9ViIjhvKwU",
  authDomain: "pizza-a2630.firebaseapp.com",
  projectId: "pizza-a2630",
  storageBucket: "pizza-a2630.firebasestorage.app",
  messagingSenderId: "1045338924957",
  appId: "1:1045338924957:web:2d59085a5f0fdd5264f174"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// App Check — proves requests come from your real site, not a script hitting
// Firestore directly. Once you complete the App Check setup in the README,
// paste your real reCAPTCHA v3 site key below and this turns on automatically.
const RECAPTCHA_SITE_KEY = "YOUR_RECAPTCHA_V3_SITE_KEY";
if (RECAPTCHA_SITE_KEY !== "YOUR_RECAPTCHA_V3_SITE_KEY") {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
}
