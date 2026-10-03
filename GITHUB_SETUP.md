# GitHub設定の解説(学習用メモ)

このアプリは「サーバーを借りない」構成にするため、GitHubの機能だけで自動実行・公開・通知を行っています。ここでは、何が・どこで・なぜ設定されているかをまとめます。

---

## 1. 全体像

```
毎朝7時(JST)
  ↓
GitHub Actions が起動(スケジュール実行)
  ↓
scripts/run-daily.js を実行
  ├─ ニュース・株価を取得
  ├─ Gemini APIで分類
  ├─ data/tiles.json を更新 → git push で保存
  ├─ dist/ にサイトを生成
  └─ Resendで通知メール送信
  ↓
dist/ を GitHub Pages にデプロイ
  ↓
あなたのスマホにメールが届く → リンクを開くと最新のサイトが見られる
```

ポイントは、**「毎日のcron実行」も「Webサイトのホスティング」も「コードの保管」も全部GitHubの中で完結している**ことです。専用サーバーを借りていません。

---

## 2. ファイルの場所と役割

| ファイル | 役割 |
|---|---|
| `.github/workflows/daily.yml` | 「いつ・何を実行するか」を定義する設定ファイル(今回の主役) |
| `scripts/run-daily.js` | 実際に実行されるNode.jsスクリプト(データ収集〜通知まで) |
| `data/tiles.json` | 蓄積データ。毎日の実行結果がここに追記され、**Gitの履歴として残る** |
| `dist/` | 生成された静的サイト。Gitには含めず(`.gitignore`)、ビルドの都度作り直す |
| `.env` / `.env.example` | APIキー等。`.env`は**絶対にGitに含めない**(`.gitignore`で除外済み)。`.env.example`は「何の変数が必要か」を示す空のひな形だけをGitに載せる |

---

## 3. `.github/workflows/daily.yml` の読み方

GitHub Actionsの設定ファイルは「YAML」という形式で書きます。上から順に意味を説明します。

### 3.1 `on:` — いつ実行するか

```yaml
on:
  schedule:
    - cron: "0 22 * * 0-4"
  workflow_dispatch: {}
```

- `schedule`: 定期実行。cron式`0 22 * * 0-4`は「UTCの22:00、日〜木曜日」という意味です。GitHub Actionsのcronは**UTC(世界標準時)基準**なので、JST(UTC+9)に直すと「翌朝7:00、月〜金」になります(ここが初見だとハマりやすいポイントです)。
- `workflow_dispatch`: GitHubの「Actions」タブから手動で「Run workflow」ボタンを押して実行できるようにする設定。動作確認やテストに使えます。

### 3.2 `permissions:` — このワークフローに与える権限

```yaml
permissions:
  contents: write   # data/tiles.json をコミット・pushするため
  pages: write       # GitHub Pagesへデプロイするため
  id-token: write    # Pagesデプロイの認証(OIDC)に必要
```

GitHub Actionsは実行のたびに「GITHUB_TOKEN」という一時的なアクセストークンを自動発行します。このブロックは、そのトークンに何をしてよいかを明示的に許可するものです(最小権限の原則)。

### 3.3 `jobs:` — 実際の処理ステップ

1. **`actions/checkout@v4`**: リポジトリの中身をActionsの実行マシンにダウンロード
2. **`actions/setup-node@v4`**: Node.js(v20)をインストール
3. **`npm ci`**: `package-lock.json`どおりに依存パッケージを再現性ある形でインストール
4. **`Run daily batch`**: 本体の処理(`node scripts/run-daily.js`)。ここでSecrets/Variablesを環境変数として渡す
5. **`Commit updated data`**: `data/tiles.json`の変更をリポジトリにコミット・push。変更が無ければスキップ
6. **`actions/configure-pages@v5`**: GitHub Pagesへのデプロイ準備
7. **`actions/upload-pages-artifact@v3`**: `dist/`フォルダをデプロイ用のアーティファクトとしてアップロード
8. **`actions/deploy-pages@v4`**: アップロードした内容を実際にGitHub Pagesへ公開

---

## 4. Secrets と Variables の違い

GitHubのリポジトリには「Settings → Secrets and variables → Actions」という設定画面があり、**Secrets**と**Variables**という2種類の値を登録できます。

| | Secrets | Variables |
|---|---|---|
| 用途 | APIキーなど**秘密にすべき値** | モデル名・URLなど**公開してよい設定値** |
| ログでの見え方 | 自動的に`***`でマスクされる | そのまま表示される |
| このアプリでの例 | `GEMINI_API_KEY`, `RESEND_API_KEY`, `NOTIFY_EMAIL` | `SITE_URL`, `GEMINI_MODEL` |

ワークフローYAML内では `${{ secrets.XXX }}` / `${{ vars.XXX }}` という書き方で参照します。これらは**コードには一切書かれず**、GitHub側で暗号化保管され、実行時にだけ環境変数として注入されます。これが「NFR-20: APIキーをソースコードに含めず安全に管理する」の実現方法です。

### 登録が必要な項目(初回セットアップ)

**Settings → Secrets and variables → Actions → Secrets タブ → New repository secret**
- `GEMINI_API_KEY`
- `RESEND_API_KEY`
- `NOTIFY_EMAIL`(あなたの受信用メールアドレス)

**同じ画面の Variables タブ → New repository variable**
- `SITE_URL`(例: `https://wakabayashiyuta0209-collab.github.io/hitachi-agent/`)
- `GEMINI_MODEL`(例: `gemini-3.5-flash-lite`。省略するとコード側の既定値が使われる)

---

## 5. GitHub Pages の設定

**Settings → Pages → Build and deployment → Source** を **「GitHub Actions」** に設定します(「Deploy from a branch」ではない点に注意)。これにより、`daily.yml`内の`deploy-pages`ステップが公開を担当するようになります。

設定後、最初のワークフロー実行が成功すると、`https://<ユーザー名>.github.io/<リポジトリ名>/` でサイトが公開されます。

---

## 6. 動作確認の見方

- **Actions タブ**: 実行履歴、ログ、成功/失敗が確認できる場所です。各ステップをクリックすると詳細な出力(このアプリで言えば「記事○件取得」のようなログ)が見られます。
- 失敗した場合は該当ステップが赤色になり、GitHubから登録メールアドレスに失敗通知が届きます(NFR-12はこの仕組みに乗っています)。
- `data/tiles.json`への自動コミットは「daily-bot」という名前で記録されます。Gitの履歴(`git log`)がそのまま更新履歴・バックアップになります。

---

## 7. なぜこの構成なのか(設計意図)

- **コストが原則無料**(NFR-40): GitHub Actions・Pagesはpublicリポジトリなら無料枠が大きく、個人利用の範囲では課金が発生しません。
- **専用インフラ不要**(NFR-30/31): 収集元やGemini/Resendを他のサービスに差し替えても、Actionsの実行基盤自体は変更不要です。
