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

const META_DOC   = 'screening/latest'
const SNAPS_COL  = 'snapshots'

// ─── Salvar snapshot ───────────────────────────────────────────
/**
 * Salva os dados do XLSX no Firestore.
 * @param {Array}  rows      - array de objetos parsed pelo parseUploadedXLSX
 * @param {string} fileName  - nome do arquivo importado
 * @returns {string} docId   - ID do snapshot salvo (data ISO)
 */
export async function saveSnapshot(rows, fileName) {
  const now    = new Date()
  const docId  = now.toISOString().slice(0, 10) // ex: "2026-05-05"
  const updatedAt = now.toISOString()

  const snapshotData = {
    updatedAt,
    fileName,
    totalRows: rows.length,
    rows,
  }

  // Salva o snapshot completo
  await setDoc(
    doc(db, SNAPS_COL, docId),
    snapshotData
  )

  // Atualiza metadados do "latest"
  await setDoc(
    doc(db, 'screening', 'latest'),
    { updatedAt, fileName, totalRows: rows.length, docId }
  )

  return docId
}

// ─── Carregar snapshot mais recente ───────────────────────────
/**
 * Busca os dados do snapshot mais recente salvo no Firestore.
 * @returns {{ rows, updatedAt, fileName, totalRows } | null}
 */
export async function loadLatestSnapshot() {
  // Lê o metadado "latest" para saber qual docId buscar
  const metaSnap = await getDoc(doc(db, 'screening', 'latest'))
  if (!metaSnap.exists()) return null

  const { docId } = metaSnap.data()
  const dataSnap  = await getDoc(doc(db, SNAPS_COL, docId))
  if (!dataSnap.exists()) return null

  return dataSnap.data()
}

// ─── Listar histórico de snapshots ────────────────────────────
/**
 * Retorna os últimos N snapshots (apenas metadados, sem rows).
 * @param {number} n
 * @returns {Array<{ docId, updatedAt, fileName, totalRows }>}
 */
export async function listSnapshots(n = 10) {
  // Firestore não ordena automaticamente por docId string —
  // usamos updatedAt para garantir ordem correta
  const q = query(
    collection(db, SNAPS_COL),
    orderBy('updatedAt', 'desc'),
    limit(n)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => {
    const { rows: _rows, ...meta } = d.data() // omite rows do resultado
    return { docId: d.id, ...meta }
  })
}

// ─── Carregar snapshot específico ─────────────────────────────
export async function loadSnapshot(docId) {
  const snap = await getDoc(doc(db, SNAPS_COL, docId))
  return snap.exists() ? snap.data() : null
}
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback)
}
