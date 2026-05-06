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
  GoogleAuthProvider,
  signInWithPopup,
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

const app      = initializeApp(firebaseConfig)
const db       = getFirestore(app)
const auth     = getAuth(app)
const provider = new GoogleAuthProvider()

export { auth, onAuthStateChanged }
export const loginWithGoogle = () => signInWithPopup(auth, provider)
export const logout          = () => signOut(auth)

const snapCol = (uid) => collection(db, 'users', uid, 'snapshots')
const snapDoc = (uid, id) => doc(db, 'users', uid, 'snapshots', id)
const metaDoc = (uid) => doc(db, 'users', uid, 'screening', 'latest')

export async function saveSnapshot(rows, fileName, uid) {
  const now       = new Date()
  const docId     = now.toISOString().slice(0, 10)
  const updatedAt = now.toISOString()
  await setDoc(snapDoc(uid, docId), { updatedAt, fileName, totalRows: rows.length, rows })
  await setDoc(metaDoc(uid), { updatedAt, fileName, totalRows: rows.length, docId })
  return docId
}

export async function loadLatestSnapshot(uid) {
  const meta = await getDoc(metaDoc(uid))
  if (!meta.exists()) return null
  const { docId } = meta.data()
  const data = await getDoc(snapDoc(uid, docId))
  return data.exists() ? data.data() : null
}

export async function listSnapshots(uid, n = 10) {
  const q    = query(snapCol(uid), orderBy('updatedAt', 'desc'), limit(n))
  const snap = await getDocs(q)
  return snap.docs.map(d => {
    const { rows: _rows, ...meta } = d.data()
    return { docId: d.id, ...meta }
  })
}

export async function loadSnapshot(uid, docId) {
  const snap = await getDoc(snapDoc(uid, docId))
  return snap.exists() ? snap.data() : null
}
