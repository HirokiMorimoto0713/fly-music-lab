# 公開と更新

- アプリ: https://hirokimorimoto0713.github.io/fly-music-lab/
- ソース: https://github.com/HirokiMorimoto0713/fly-music-lab
- 配信方法: GitHub ActionsからGitHub Pagesへ静的ファイルを配信

## 配信するファイル

`scripts/build-pages.mjs` が、5画面のHTML、Git管理された `src/` と `docs/` の対象ファイル、歩行ページの明示したファイル、README、全配線データ、LIF実装、必要なThree.jsの2モジュールとライセンスを選びます。再開用の `docs/session-brief.md` はアプリ配信から除外します。配線データは `provenance.json`、身体データ44ファイルは `public/embodied/manifest.json` のSHA-256と一致することを確認します。

歩行用のNeuroMechFlyモデル、MuJoCo 3.9.0、専用のThree.js 0.169.0は約15 MBで、固定された公式gh-pagesコミットから `npm run prepare:body` が取得します。取得先とハッシュはmanifestに記録し、身体関連のライセンスも同梱します。ブラウザは配信された同一オリジンのファイルを使います。

出力先は `artifacts/pages-*` の新しいディレクトリです。`.git`、エージェントの作業ログ、テスト結果、サーバースクリプトはアプリの配信対象に含めません。リポジトリ自体はPublicのため、Git管理された開発資料とコミット履歴もGitHubで閲覧できます。

上流の `vendor/LICENSE` をそのまま保持します。同ファイル中の `licenses/` への参照は上流プロジェクトの構成です。このアプリが使うThree.jsのMITライセンスは `node_modules/three/LICENSE` として配信します。MaleCNSデータの出典とCC BY 4.0は [モデルと出典](model.md) に記載しています。

## 更新手順

1. `npm ci --ignore-scripts`、`npm run prepare:data`、`npm run prepare:body`、`npm test` を実行します。
2. `npm run build:pages` で公開用ファイルを生成します。
3. 変更を `main` へpushします。`.github/workflows/pages.yml` がデータ来歴と11件のテストを検証し、成功した成果物だけを配信します。
4. Actionsの成功、公開URL、`deployment.json` のコミットとアセットのハッシュを確認します。

Actionsは公式アクションのコミットに固定しています。ビルドの権限は `contents: read`、配信ジョブは `pages: write` と `id-token: write` です。追加のAPIキーは不要です。

## 公開URLでの操作確認

既存のChrome / Playwright環境で次を実行します。`PLAYWRIGHT_MODULE` は手元のインストール先に合わせて指定します。

```sh
LAB_URL=https://hirokimorimoto0713.github.io/fly-music-lab node tests/echo-browser.mjs
LAB_URL=https://hirokimorimoto0713.github.io/fly-music-lab node tests/draw-browser.mjs
LAB_URL=https://hirokimorimoto0713.github.io/fly-music-lab node tests/talk-browser.mjs
LAB_URL=https://hirokimorimoto0713.github.io/fly-music-lab node tests/browser.mjs
LAB_URL=https://hirokimorimoto0713.github.io/fly-music-lab node tests/walk-browser.mjs
```

ChromeのPC上での検証と、Mac・スマホ・Safariの実機評価は区別します。初回の配線読み込みは約79 MB、神経計算は各利用者の端末で行います。

## 復元

不具合があれば対象の変更をrevertし、通常のpushで確認済みの構成を再配信します。リポジトリの履歴は書き換えません。

GitHub Pagesの配信停止とリポジトリのPrivate化は別の操作です。公開後に取得されたコピーまで取り消すことはできません。
