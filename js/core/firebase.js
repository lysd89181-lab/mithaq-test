// تهيئة Firebase (الإصدار الحديث 10) — ملف واحد يستورده المتجر والدخول ولوحة التحكم
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  sendEmailVerification, sendPasswordResetEmail, updateProfile, setPersistence, browserLocalPersistence, browserSessionPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch, Timestamp, startAfter, getCountFromServer,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { FIREBASE_CONFIG } from './config.js';

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
auth.languageCode = 'ar';
export const db = getFirestore(app);

export {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendEmailVerification,
  sendPasswordResetEmail, updateProfile, setPersistence, browserLocalPersistence, browserSessionPersistence,
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch, Timestamp, startAfter, getCountFromServer,
};
