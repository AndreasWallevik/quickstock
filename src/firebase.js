import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const isIosStandalonePwa = () => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const userAgent = navigator.userAgent || "";
  const isiOS =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.navigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)")?.matches;

  return isiOS && standalone;
};

const getRuntimeAuthDomain = () => {
  if (typeof window === "undefined") return import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;

  const { hostname, protocol } = window.location;
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

  // iOS installed PWAs are stricter about cross-origin storage during redirect auth.
  // When served by Firebase Hosting, using the current host keeps /__/auth same-origin.
  if (isIosStandalonePwa() && protocol === "https:" && hostname && !localHosts.has(hostname)) {
    return hostname;
  }

  return import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: getRuntimeAuthDomain(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseReady = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

const app = firebaseReady ? initializeApp(firebaseConfig) : null;

export const auth = app
  ? initializeAuth(app, {
      // Prefer localStorage for iOS standalone redirect hand-offs, with IndexedDB/session fallbacks.
      persistence: [browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    })
  : null;
export const db = app ? getFirestore(app) : null;
export const googleProvider = new GoogleAuthProvider();
