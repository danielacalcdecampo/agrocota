# PWA OAgroCota no Vercel — Guia completo

## Passo a passo para colocar o PWA no ar

### 1. Pré-requisitos
- Conta no [Vercel](https://vercel.com) (plano gratuito)
- Código no **GitHub** (push do projeto para um repositório)

---

### 2. Envie o código para o GitHub (se ainda não fez)

```bash
cd c:\Users\usuario\Desktop\agrocota
git add .
git commit -m "PWA pronto para Vercel"
git push origin main
```

*(Se usar outra branch, substitua `main` pelo nome dela.)*

---

### 3. Importe o projeto no Vercel

1. Acesse [vercel.com](https://vercel.com) e faça login.
2. Clique em **"Add New..."** → **"Project"**.
3. Em **Import Git Repository**, selecione o repositório **agrocota**.
4. Se o GitHub não estiver conectado, faça a conexão e autorize o Vercel.

---

### 4. Configuração do build

O `vercel.json` já define tudo. Confirme se está assim:

| Campo | Valor |
|-------|-------|
| **Framework Preset** | Other |
| **Build Command** | `npm run build:web` |
| **Output Directory** | `dist` |
| **Root Directory** | *(deixe em branco)* |

---

### 5. Fazer o Deploy

1. Clique em **"Deploy"**.
2. Aguarde o build (2–5 minutos).
3. Ao finalizar, aparecerá o link do PWA.

---

## Como obter e usar o link de distribuição

### Link automático após o deploy

Depois do deploy, o Vercel mostra algo como:

```
https://agrocota-xxx.vercel.app
```

Esse é o link de distribuição do PWA.

---

### Onde encontrar o link

1. No painel do projeto no Vercel.
2. Na aba **Deployments** → clique no último deploy → o domínio aparece no topo.
3. Em **Project Settings** → **Domains** — lá aparecem os domínios do projeto.

---

### Compartilhar com usuários

| Forma | Uso |
|-------|-----|
| **Link direto** | `https://agrocota-xxx.vercel.app` — use em WhatsApp, e-mail, QR Code, site etc. |
| **Domínio personalizado** | Em **Project Settings** → **Domains** adicione, por exemplo, `app.seudominio.com.br` e aponte pelo DNS. |
| **QR Code** | Gere em [qr-code-generator.com](https://www.qr-code-generator.com) usando o link. |

---

### Atualizar o PWA

Toda vez que você der **push** na branch principal no GitHub:

- O Vercel faz um novo deploy.
- O link continua o mesmo.
- Os usuários recebem a nova versão ao recarregar a página.

---

## Deploy pelo terminal (alternativa)

Se preferir deploy direto, sem GitHub:

```bash
npm i -g vercel
cd c:\Users\usuario\Desktop\agrocota
vercel
```

Na primeira vez, faça login com `vercel login` e siga as instruções.

Para produção:

```bash
vercel --prod
```

O link será exibido no final do comando.

---

## Comandos úteis

| Comando | Descrição |
|---------|-----------|
| `npm run build:web` | Gera o build na pasta `dist/` (teste local) |
| `npm run web` | Abre o app em `http://localhost:8081` |

---

## Modo offline

- App e dados já carregados ficam disponíveis offline.
- O usuário precisa abrir o app **uma vez com internet** para popular o cache.

---

## Problemas comuns

| Problema | Solução |
|----------|---------|
| Build falha com "react-native-maps" | Já tratado no `metro.config.js`. |
| Página em branco | Abra o Console (F12) e confira erros. |
| Mapa não aparece | Normal na web; mapa completo só no app mobile. |
