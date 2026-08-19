import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  orderBy,
  query,
  limit,
} from 'firebase/firestore'
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app  = initializeApp(firebaseConfig)
const db   = getFirestore(app)
const auth = getAuth(app)

export async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password)
  return result.user
}

export async function signOutUser() {
  await signOut(auth)
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback)
}

export { auth }

const SNAPS_COL = 'snapshots'

export async function saveSnapshot(rows, fileName) {
  const now    = new Date()
  const docId  = now.toISOString().slice(0, 10)
  const updatedAt = now.toISOString()
  const snapshotData = { updatedAt, fileName, totalRows: rows.length, rows }
  await setDoc(doc(db, SNAPS_COL, docId), snapshotData)
  await setDoc(doc(db, 'screening', 'latest'), { updatedAt, fileName, totalRows: rows.length, docId })
  return docId
}

export async function loadLatestSnapshot() {
  const metaSnap = await getDoc(doc(db, 'screening', 'latest'))
  if (!metaSnap.exists()) return null
  const { docId } = metaSnap.data()
  const dataSnap  = await getDoc(doc(db, SNAPS_COL, docId))
  if (!dataSnap.exists()) return null
  return dataSnap.data()
}

export async function listSnapshots(n = 10) {
  const q = query(collection(db, SNAPS_COL), orderBy('updatedAt', 'desc'), limit(n))
  const snap = await getDocs(q)
  return snap.docs.map(d => {
    const { rows: _rows, ...meta } = d.data()
    return { docId: d.id, ...meta }
  })
}

export async function loadSnapshot(docId) {
  const snap = await getDoc(doc(db, SNAPS_COL, docId))
  return snap.exists() ? snap.data() : null
}

export async function saveOverviewAtivos(uid, ativos) {
  await setDoc(doc(db, 'overview', uid), { ativos, updatedAt: new Date().toISOString() })
}

export async function loadOverviewAtivos(uid) {
  const snap = await getDoc(doc(db, 'overview', uid))
  return snap.exists() ? snap.data().ativos : []
}

export async function saveCarteiras(uid, carteiras) {
  await setDoc(doc(db, 'carteiras', uid), { carteiras, updatedAt: new Date().toISOString() })
}

export async function loadCarteiras(uid) {
  const snap = await getDoc(doc(db, 'carteiras', uid))
  return snap.exists() ? (snap.data().carteiras || null) : null
}

export async function saveHiloWatchlist(uid, tickers) {
  await setDoc(doc(db, 'hilo', uid), { tickers, updatedAt: new Date().toISOString() })
}

export async function loadHiloWatchlist(uid) {
  const snap = await getDoc(doc(db, 'hilo', uid))
  return snap.exists() ? (snap.data().tickers || []) : []
}

export async function saveOptionsData(uid, data) {
  await setDoc(doc(db, 'options', uid), { ...data, updatedAt: new Date().toISOString() })
}

export async function loadOptionsData(uid) {
  const snap = await getDoc(doc(db, 'options', uid))
  return snap.exists() ? snap.data() : null
}
