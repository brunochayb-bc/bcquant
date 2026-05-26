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

// ─── Configuração ──────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
const db  = getFirestore(app)
const auth = getAuth(app)

// ─── Auth: Google ──────────────────────────────────────────────
const googleProvider = new GoogleAuthProvider()

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider)
  return result.user
}

export async function signOutUser() {
  await signOut(auth)
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback)
}

export { auth }

// ─── Estrutura no Firestore ────────────────────────────────────
//
//  screening/                   ← coleção
//    latest/                    ← documento com metadados do snapshot mais recente
//      { updatedAt, fileName, totalRows, docId }
//    snapshots/                 ← sub-coleção com histórico
//      {docId}/
//        { updatedAt, fileName, totalRows, rows: [...] }
//
// Cada snapshot armazena todos os rows do XLSX em um único documento.
// O Firestore suporta até 1 MB por documento — 380 rows × ~200 bytes ≈ 76 KB, bem dentro do limite.

const SNAPS_COL  = 'snapshots'

// ─── Salvar snapshot ───────────────────────────────────────────
export async function saveSnapshot(rows, fileName) {
  const now    = new Date()
  const docId  = now.toISOString().slice(0, 10)
  const updatedAt = now.toISOString()

  const snapshotData = {
    updatedAt,
    fileName,
    totalRows: rows.length,
    rows,
  }

  await setDoc(doc(db, SNAPS_COL, docId), snapshotData)
  await setDoc(
    doc(db, 'screening', 'latest'),
    { updatedAt, fileName, totalRows: rows.length, docId }
  )

  return docId
}

// ─── Carregar snapshot mais recente ───────────────────────────
export async function loadLatestSnapshot() {
  const metaSnap = await getDoc(doc(db, 'screening', 'latest'))
  if (!metaSnap.exists()) return null

  const { docId } = metaSnap.data()
  const dataSnap  = await getDoc(doc(db, SNAPS_COL, docId))
  if (!dataSnap.exists()) return null

  return dataSnap.data()
}

// ─── Listar histórico de snapshots ────────────────────────────
export async function listSnapshots(n = 10) {
  const q = query(
    collection(db, SNAPS_COL),
    orderBy('updatedAt', 'desc'),
    limit(n)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => {
    const { rows: _rows, ...meta } = d.data()
    return { docId: d.id, ...meta }
  })
}

// ─── Carregar snapshot específico ─────────────────────────────
export async function loadSnapshot(docId) {
  const snap = await getDoc(doc(db, SNAPS_COL, docId))
  return snap.exists() ? snap.data() : null
}
