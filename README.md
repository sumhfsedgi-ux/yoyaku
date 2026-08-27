# サロン予約管理システム

スタッフ約5名が1つの施術部屋を共同利用するサロン向けの予約管理システム。スタッフごとの専用予約URL、部屋の二重予約防止（DB EXCLUDE制約）、Google Calendar/Gmail連携、顧客個人情報のアクセス制御を備える。

## 技術スタック

- Next.js 16 (App Router) + TypeScript
- PostgreSQL + Prisma 7（driver adapter構成、本番はNeon想定）
- NextAuth v4（Credentials）
- Tailwind CSS + shadcn/ui
- Vitest（ユニット/統合テスト）

## セットアップ（ローカル開発）

### 1. PostgreSQLの用意

`btree_gist` 拡張が使えるPostgreSQL 16以上が必要（予約の二重登録防止に使うEXCLUDE制約のため）。Docker Composeを使う場合:

```bash
docker compose up -d
```

ネイティブインストールの場合は `docker-compose.yml` のユーザー/パスワード/DB名を参考に `yoyaku` と `yoyaku_test` の2つのデータベースを作成すること。

**重要**: データベースの `timezone` セッション設定は必ず `UTC` にすること（`ALTER ROLE <role> SET timezone TO 'UTC';` 等）。`@prisma/adapter-pg` は日時パラメータをタイムゾーンマーカーなしの文字列として送信するため、セッションのタイムゾーンがUTC以外だと保存される日時が実際の値からずれる。`src/lib/db/prisma.ts` はこれに対する多層防御として接続時に `-c TimeZone=UTC` を強制しているが、DB側もUTCにしておくことを推奨する。

### 2. 環境変数

```bash
cp .env.example .env.local
```

`NEXTAUTH_SECRET` と `GOOGLE_TOKEN_ENCRYPTION_KEY` は `openssl rand -base64 32` で生成する。Google関連の値は未取得でもローカル開発は可能（`ALLOW_FAKE_GOOGLE_SERVICES=true` によりフェイク実装が使われる）。

### 3. 依存関係のインストール・DBマイグレーション・シード

```bash
npm install
npx prisma migrate deploy   # 既存マイグレーションを適用（新規DBなら migrate dev でも可）
npm run db:seed             # 部屋1件・スタッフ5件（staff-a〜e、初期パスワード password1234）を投入
```

### 4. 開発サーバー起動

```bash
npm run dev
```

- スタッフ管理画面: http://localhost:3000/login （例: `staff-a@example.com` / `password1234`）
- お客様予約画面: http://localhost:3000/reserve/staff-a 〜 `staff-e`

### テスト

```bash
npm run test              # ユニットテスト（DB不要）
npm run test:integration  # 統合テスト（yoyaku_test データベースが必要、.env.test を参照）
```

## Google Calendar / Gmail連携の有効化

1. Google Cloud Consoleでサロン専用のOAuthクライアント（種類: ウェブアプリケーション）を作成し、リダイレクトURIに `<アプリのURL>/api/google/oauth/callback` を登録する
2. `.env.local`（本番はホスティング先の環境変数）に `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` を設定
3. 本番環境では `ALLOW_FAKE_GOOGLE_SERVICES` を **設定しない**（未設定=Real実装が使われ、未接続時は安全側でエラーになる）
4. スタッフでログイン後、`/settings/google` から「連携を開始」

## 本番デプロイ（Vercel + Neon想定）

- `DATABASE_URL` にNeonのプーリングされた接続文字列、`DIRECT_URL` に直接接続の文字列を設定
- `GOOGLE_TOKEN_ENCRYPTION_KEY` はVercelの環境変数にのみ設定し、他のどこにも保存しない
- デプロイ前に `npx prisma migrate deploy` でマイグレーションを適用すること（`prisma db push` は使用しないこと — EXCLUDE制約が失われる可能性がある）
- Google連携（`/settings/google`）を完了させるまで、本番では予約確定が安全側で失敗する仕様になっている（詳細は `src/lib/google/calendar/factory.ts` のコメントを参照）

### 最初のスタッフアカウント（重要）

新規スタッフの追加はログイン済みスタッフしか行えないため、本番DBが空の状態では誰もログインできず、誰も最初のアカウントを作れないという構造になっている。**`npm run db:seed` は本番へ絶対に使わないこと** — これはローカル開発用で、5件のデモアカウントがソースコードにベタ書きされた同一パスワード (`password1234`) を共有する（`NODE_ENV`/`VERCEL_ENV` が `production` の場合はこのスクリプト自体が実行を拒否する）。

本番では代わりに、部屋と最初の1アカウントだけを作る専用スクリプトを使う:

```bash
BOOTSTRAP_STAFF_EMAIL="owner@example.com" \
BOOTSTRAP_STAFF_NAME="オーナー" \
BOOTSTRAP_STAFF_SLUG="owner" \
npm run db:bootstrap-admin
```

- パスワードは `BOOTSTRAP_STAFF_PASSWORD` で指定するか、省略時は自動生成されコンソールに一度だけ表示される（必ずその場でコピーすること。二度と表示されない）
- 作成されるアカウントは `mustChangePassword=true` になり、初回ログイン後は管理画面のバナーからパスワード変更が促される
- 既に1件以上スタッフが存在する場合は何もせず終了する（誤って複数回実行しても安全）
- ログイン後、`/staff` から残りのスタッフを追加する

## ディレクトリ構成の概要

```
prisma/              スキーマ・マイグレーション・シード
src/lib/availability/  予約可能枠計算エンジン（純粋関数 + Prismaバックエンド）
src/lib/reservations/  予約作成・変更・キャンセルのサービス層
src/lib/google/         Calendar/Gmail連携（ポート/フェイク/実装/factory）
src/lib/auth/           NextAuth設定・セッション・権限ガード
src/actions/            Server Actions（画面から呼ばれるエントリポイント）
src/app/(admin)/        スタッフ管理画面
src/app/reserve/[slug]/ お客様予約画面
tests/unit/             DB不要のユニットテスト
tests/integration/db/   実PostgreSQLを使う統合テスト
```
