/* Облако: вход (Google, почта и пароль) и тренировки пользователя в Firestore.
   index.html грузит этот модуль сам; пока в firebase-config.js нет настроек, облако выключено. */
import { firebaseConfig } from './firebase-config.js';

const BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
let fb = null, auth = null, db = null, uid = null, unsubWk = null, unsubCur = null;
/* На своём компьютере (localhost) сайт работает с локальными эмуляторами Firebase, а не с настоящим проектом */
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

export const enabled = !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.projectId);

export async function start({ onUser, onWorkouts, onCurrent, onError, lang }) {
  if (!enabled) return false;
  const mods = await Promise.all([
    import(BASE + 'firebase-app.js'), import(BASE + 'firebase-auth.js'), import(BASE + 'firebase-firestore.js'),
  ]);
  fb = Object.assign({}, ...mods);
  const app = fb.initializeApp(firebaseConfig);
  auth = fb.getAuth(app);
  if (LOCAL) fb.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  if (lang) auth.languageCode = lang;
  try {
    db = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
  } catch (e) {
    db = fb.getFirestore(app);
  }
  if (LOCAL) fb.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  fb.getRedirectResult(auth).catch((e) => onError(e));
  fb.onAuthStateChanged(auth, (u) => {
    if (unsubWk) { unsubWk(); unsubWk = null; }
    if (unsubCur) { unsubCur(); unsubCur = null; }
    uid = u ? u.uid : null;
    onUser(u ? { uid: u.uid, email: u.email || '', name: u.displayName || '' } : null);
    if (!u) return;
    unsubWk = fb.onSnapshot(fb.collection(db, 'users', u.uid, 'workouts'), (snap) => {
      onWorkouts(snap.docs.map((d) => {
        const x = d.data({ serverTimestamps: 'estimate' });
        const at = x.updatedAt && x.updatedAt.toMillis ? x.updatedAt.toMillis() : 0;
        return { id: d.id, name: x.name, prepare: x.prepare, cool: x.cool, list: x.list, updatedAt: at };
      }));
    }, (e) => onError(e));
    // Текущие круги: своё эхо (pending) и пустой кеш до ответа сервера пропускаем
    unsubCur = fb.onSnapshot(fb.doc(db, 'users', u.uid, 'state', 'current'), { includeMetadataChanges: true }, (snap) => {
      const m = snap.metadata;
      if (m.hasPendingWrites) return;
      if (!snap.exists() && m.fromCache) return;
      onCurrent(snap.exists() ? snap.data() : null);
    }, (e) => onError(e));
  });
  return true;
}

export function setLanguage(code) { if (auth) auth.languageCode = code; }

export function signInGoogle(redirect) {
  const p = new fb.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return redirect ? fb.signInWithRedirect(auth, p) : fb.signInWithPopup(auth, p);
}
export const signInEmail = (email, pass) => fb.signInWithEmailAndPassword(auth, email, pass);
export const signUpEmail = (email, pass) => fb.createUserWithEmailAndPassword(auth, email, pass);
export const resetPassword = (email) => fb.sendPasswordResetEmail(auth, email);
export const signOut = () => fb.signOut(auth);

function data(w) {
  return { name: w.name, prepare: w.prepare, cool: w.cool, list: w.list.map((it) => ({ w: it.w, r: it.r })), updatedAt: fb.serverTimestamp() };
}
export const saveWorkout = (w) => fb.setDoc(fb.doc(db, 'users', uid, 'workouts', w.id), data(w));
export function saveCurrent(s) {
  return fb.setDoc(fb.doc(db, 'users', uid, 'state', 'current'), {
    prepare: s.prepare, cool: s.cool, list: s.list.map((it) => ({ w: it.w, r: it.r })),
    active: s.active || null, updatedAt: fb.serverTimestamp(),
  });
}
export const removeWorkout = (id) => fb.deleteDoc(fb.doc(db, 'users', uid, 'workouts', id));
export function importWorkouts(list) {
  const b = fb.writeBatch(db);
  for (const w of list.slice(0, 400)) b.set(fb.doc(db, 'users', uid, 'workouts', w.id), data(w));
  return b.commit();
}
