// js/firebase.js

// v9 の CDN 版を使う想定（import map ではなく <script> で読み込む前提）
// index.html, group.html の <head> でこのファイルより前に
// https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js
// https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js
// を読み込みます（後でHTML側に書きます）。

// ↓↓↓ ここを Firebase コンソールで表示された値に差し替え ↓↓↓
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCLeZt3h6xt2gSuXxk-k-BodY3P48T076I",
  authDomain: "warikan-app-1be39.firebaseapp.com",
  projectId: "warikan-app-1be39",
  storageBucket: "warikan-app-1be39.firebasestorage.app",
  messagingSenderId: "503121772678",
  appId: "1:503121772678:web:9be9b5bf3db63170c9d107",
  measurementId: "G-B4HXYRPJB0"
};


// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Firestoreインスタンスを共通で使えるように
const db = firebase.firestore();
