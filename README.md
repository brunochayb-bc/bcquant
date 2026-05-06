# BC.QUANT

Screener quantitativo de ações B3 baseado no método Graham.

## Stack

- **React 18 + Vite** — frontend
- **Tailwind CSS** — estilo
- **Firebase Firestore** — persistência dos dados importados
- **Vercel** — deploy automático via GitHub

---

## 1. Configurar Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Crie um projeto (ou use um existente)
3. Em **Build → Firestore Database**, crie um banco no modo **Production**
4. Em **Regras do Firestore**, cole as regras abaixo e publique:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ Essas regras são abertas. Para produção com múltiplos usuários, implemente autenticação Firebase Auth.

5. Em **Project Settings → General → Your apps**, clique em **"Add app" → Web**
6. Copie o objeto `firebaseConfig` exibido

---

## 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite `.env` e preencha com os valores do `firebaseConfig`:

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=seu-projeto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=seu-projeto
VITE_FIREBASE_STORAGE_BUCKET=seu-projeto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

---

## 3. Rodar localmente

```bash
npm install
npm run dev
```

Acesse `http://localhost:5173`

---

## 4. Deploy no Vercel

1. Faça push do repositório para o GitHub
2. Acesse [vercel.com](https://vercel.com) e importe o repositório
3. Em **Settings → Environment Variables**, adicione as mesmas variáveis do `.env`
4. O Vercel detecta automaticamente o Vite — clique em **Deploy**

A partir daí, todo push na branch `main` dispara um novo deploy automático.

---

## Estrutura do projeto

```
bcquant/
├── src/
│   ├── App.jsx          # Aplicação principal
│   ├── lib/
│   │   └── firebase.js  # Configuração e helpers do Firestore
│   ├── main.jsx         # Entry point React
│   └── index.css        # Tailwind base
├── public/
│   └── favicon.svg
├── .env.example         # Template de variáveis
├── .gitignore
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## Como funciona a persistência

Ao importar um arquivo XLSX, os dados são salvos automaticamente no Firestore na coleção `snapshots/`, identificados pela data do dia (`YYYY-MM-DD`). O documento `screening/latest` sempre aponta para o snapshot mais recente.

Ao abrir o app em qualquer dispositivo, ele carrega automaticamente o último snapshot salvo — sem necessidade de re-importar o arquivo.

O botão **Histórico** no header permite carregar qualquer um dos últimos 10 snapshots salvos.
