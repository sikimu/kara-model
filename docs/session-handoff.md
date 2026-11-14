# セッション引き継ぎ

更新: 2026-11-14。確定仕様は docs/experience.md、ニューラル計算は docs/neural-model.md。

## 今回やったこと

- 頭の中を、1 つの大きな建物の中にある 11 の部屋に作り直した（壁・窓・棚・明かり・看板・開閉するドア・廊下）。コトは机の奥に立ってこちらを向き、ドアを開けて廊下を歩く。
- 部屋ごとに、計算の中身を実データで見せる。①④ 足す、② 虫めがねで見くらべて見る割合の台にのせる、③ 割合のぶんだけすくって混ぜる、⑤ しぼり機（GELU）、⑥ 文字ごとの点、候補の部屋で点を確率に直す、ルーレット。
- 棒には数そのものを書いた札を立て、凡例（金色＝プラス、青＝マイナス、高さ＝大きさ）と、いまの式を机の手前に出す。
- 札はかばんにまとめて運ぶ。2 文字め以降は、出した文字だけを文脈に足す。
- 学習は 6 部屋の重みを 4 個ひと組で動かし、広間の掲示板に、はずれの大きさと「次の文字が当たる確率」を 1 周ごとに記す。
- 見た目: 家・広場・キャラクターの形と光は Codex が改善。床・机・壁・敷物・芝に、その場で描いた模様（src/ui/textures.js）を貼った。重い端末では自動で軽くする。

## 検証

- `node tools/check-neural-view.mjs`: 部屋に出す数が実計算と一致（a + b = 結果、割合の合計 100%、割合 × 数の合計、点から直した確率 = 予測）。
- `node tools/check-neural.mjs` / `node tools/check-model.mjs`: モデルの検証。
- `node tools/check.mjs`（`--mobile`、`--mind-preview`）: 既定で PC の GPU を使う。ソフトウェア描画で試すときは `--software`（頭の中は重く、時間切れになりやすい）。

## 残り（コンセプトに対して足りないところ）

- 学習で「なぜその向きに重みを動かすか」（はずれが後ろの部屋から前の部屋へ伝わる様子）は見せていない。いまは調整の前後と、はずれの大きさ・当たる確率の推移だけ。
- ①〜⑥は「最後の位置」の計算だけを見せている（ほかの位置も同じ計算をしていることは説明文のみ）。
- 実機のスマホでの速さと操作感、音は未確認。

## 環境・公開

C:\work\kara-model。素の ES Modules、three.js、Blender。
Blender: C:/Program Files/Blender Foundation/Blender 5.3/blender.exe
頭の中だけ再生成: `-b -P blender/build_assets.py -- --mind-only`。頭の中以外: `-- --skip-mind`。
ローカル確認: `node tools/serve.mjs` → http://localhost:8765/ （公開サイトとは保存が別）。
公開前: `node tools/stamp-release.mjs`。push 後は Pages 成功、公開 PC/スマホ操作、スクリーンショットを確認。
公開先: https://sikimu.github.io/kara-model/ （sikimu/kara-model）。まずユーザーがローカルで見て調整してから push・公開する（2026-11-14 の指示）。
