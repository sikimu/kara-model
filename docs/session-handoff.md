# セッション引き継ぎ

更新: 2026-11-14。最新の確定仕様は docs/experience.md。モデルの仕様は docs/neural-model.md。

## 今回の目的

LLMが学び、使われる過程を、かわいく動くコトを眺めながら理解できるゲーム。
広い3Dの頭の中、自由な神視点と追従、札の運搬、コトによる計算台の操作、家の拡張と散歩、モデル品質の改善。

## 実装済み

- neural-view.jsを実際の3D空間へ変更。OrbitControls、神視点・追従切り替え、6か所の作業台。
- 入力札の位置から運ぶ。拾いに戻る歩行を含む。計算段の実ベクトルと学習の1周前後の重みを可視化。
- 不要な常設の説明コピーを削除。
- 家の幅を5.6から7.0へ変更、家具と対応する立ち位置を移動。
- 待機中の散歩、曲面分割とベベル増加、影の改善。Blenderアセット再生成済み。
- docs/experience.mdに今回合意した方針を整理。

## 検証状況・公開待ち

- 数値微分・モデル保存互換: 成功。
- PC・スマホの通し操作: 成功。旧スクロール確認は3Dカメラ確認に置換。
- 最終運搬・推論6段階プレビュー: 成功。PC/スマホの学習作業台、自由視点、家のスクリーンショット確認済み。
- 家の散歩と入力時停止の専用検証: 成功。低FPS時に待ち時間が延びる問題を修正。操作目印も散歩に追従する。
- 学習表示は1周分の集約更新。全位置・全パラメータの逐一表示は未実装。誇張しない。
- 公開候補の識別子: `d27f81ef896b`。コミット・push→Pages成功→公開PC/スマホ検証を残す。
- この記録時点では今回の変更は未公開。

## 作業環境

C:\work\kara-model。素のES Modules、ビルドなし。three.jsは既存のCDN依存。
Blender: C:/Program Files/Blender Foundation/Blender 5.3/blender.exe
画面テストはChromeとローカルサーバーを使うため、サンドボックス内で停止する場合は権限付きexecで実行する。
node tools/check.mjs / --mobile / --mind-preview、node tools/check-neural.mjs、node tools/check-model.mjs。
公開は https://sikimu.github.io/kara-model/ 。更新時は tools/stamp-release.mjs を実行する。
