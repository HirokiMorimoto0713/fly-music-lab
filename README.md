# Fly Music Lab

ハエの実際の神経配線から音と動きを生成し、仕組みを観察する日本語のローカルアプリです。

## 起動

Node.js 22以降、Python 3、PC版Chromeを推奨。npm依存のインストールは不要です。

```sh
cd /home/motoha/projects/fly-music-lab
npm run prepare:data
npm start
```

ブラウザで http://127.0.0.1:4389 を開きます。配線データが準備済みなら `npm start` だけで使えます。ポートは `PORT=4390 npm start` のように変更できます。

Macから母艦にSSHする場合、Macのターミナルで以下を実行し、Macのブラウザで同じURLを開きます。`母艦のSSH接続先` は普段接続に使っているホスト名に置き換えてください。

```sh
ssh -N -L 4389:127.0.0.1:4389 motoha@母艦のSSH接続先
```

サーバーは127.0.0.1にのみ接続します。ローカルアプリとして構築しており、公開サービスへのデプロイはしていません。ブラウザには全配線を展開するため数百MB以上の空きメモリが必要です。データ取得時以外の実験計算・音声合成・保存はブラウザ内で実行します。Google Fontsが利用できない場合は端末のフォントへフォールバックします。

## できること

- 166,700神経・25,582,938接続を使ったLIFの実計算
- 名前の付いた神経への刺激、発火の可視化、音楽と身体への変換
- 同じ条件の再実行、伝播あり／なしの比較
- WAV、MIDI、実験JSONのダウンロード
- ブラウザに最新5実験の条件を保存し、再実行
- [実習ガイド](docs/guide.md)、[モデルの仮定と出典](docs/model.md)

## 実装

ES modules、Web Worker、Web Audio、Canvas、Nodeの静的サーバー。ビルド処理、APIキー、AIモデルAPI、DBは不要です。全神経をCPUで計算し、本文や生成データを外部サービスへ送信しません。

`src/mapping.js` が音楽と動きのルール、`src/worker.js` が神経計算との接続、`vendor/brain.js` がLIF実装です。最初に読むなら実習ガイドから進めてください。

## 検証

```sh
npm test
```

実データの準備が必須です。全配線、再現性、伝播対照、無刺激、JSON検証、WAV/MIDI形式を確認します。ブラウザE2Eは `tests/browser.mjs` を参照してください。

## 出典とライセンス

データ: MaleCNS collaboration（FlyEM / HHMI Janelia、University of Cambridge、MRC LMB、Google Research）、CC BY 4.0。圧縮配列とLIF実装は [Xenova](https://huggingface.co/spaces/Xenova/fruit-fly-simulation) の固定版から。上流のライセンスは `vendor/LICENSE`、取得したファイルのハッシュは `public/data/provenance.json` にあります。配布元データの選別方法や簡略化はモデル文書を参照してください。

本アプリは学習するハエ、意識の再現、検証済みの生物学的エミュレーションではありません。音楽・身体への変換は創作上のルールで、保存操作は学習ではありません。
