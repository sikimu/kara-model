# 空モデル育成ゲーム（仮）

何も学習していない「空モデル」のキャラクターに話しかけ、聞かせ、眠らせて育てるブラウザゲーム。
目的は対話の賢さではなく、**推論と学習の計算が目で見えて眺められること**。

## 技術方針（変更しない）

- 静的サイト。GitHub Pages で公開する（リポジトリ直下の `index.html` が入口）
- 素の JavaScript（ES Modules）。ビルド工程・フレームワーク・npm は使わない
- three.js は CDN から importmap で読み込む。バージョンは導入時の安定版に固定する
- 機械学習ライブラリは使わない。モデルは自前実装
- 画面の主役は three.js の 3D の部屋（空モデルの頭の中）。キャラクターが部屋を動き回ってトレースを演じる
- HTML は文字入力・タブ・速度切り替えなど最小限にする。「ブラウザゲーム感」のあるパネル UI にしない
- キャラクターや小物は Blender で作る（`blender/build_assets.py` から glb を書き出す。手作業の編集はしない）
- 保存は localStorage
- 音楽と効果音は Web Audio API でその場で合成する（音声ファイルは置かない）。音声の認識や読み上げは扱わない
- PC の大きな画面（横長）で遊ぶことを優先する。スマホ対応は後回し

## 設計の原則

1. **計算と演出の分離**: `src/model/` は DOM にも three.js にも触れない。計算結果と一緒に「手順ログ（トレース）」を返し、`src/ui/` がそれを再生する
2. **チップは 1 ファイル 1 チップ**: `src/model/chips/` に置き、差し込み口ごとの決まった形を守る
3. **最小ステップで進める**: `docs/roadmap.md` の現在のステップだけを実装する。先のステップの機能を先取りしない

## フォルダ構成

```
index.html
CLAUDE.md
docs/design.md      仕様（必要な節だけ読む）
docs/roadmap.md     実装ステップと進捗
src/main.js         起動と画面切り替え
src/model/          モデル本体・チップ・トレース（UI 非依存）
src/model/chips/    チップ（1 ファイル 1 チップ）
src/ui/             画面と演出（3D の部屋でトレースを再生）
src/save.js         セーブとロード
assets/character.glb  Blender から書き出したキャラクター
assets/room.glb       Blender から書き出した家・広場・小物、立ち位置の目印
assets/npc.glb        Blender から書き出した、広場で話す人
blender/build_assets.py  assets/ の glb を作る Blender スクリプト
```

## 作業ルール

- 作業前に `docs/roadmap.md` で現在のステップを確認する
- `docs/design.md` は全部読まず、該当する節だけ読む
- 変更は現在のステップに必要なファイルに限る。頼まれていないリファクタリングはしない
- ステップが終わったら `docs/roadmap.md` のチェックを付ける
- 仕様にない判断が必要になったら、実装せずに質問する
- 返答は日本語で簡潔に。変更点の長い解説は不要
- 用語は「空モデル」。「極小モデル」とは呼ばない

## 動作確認

ES Modules は `file://` では動かない。VS Code の Live Server で `index.html` を開く。

glb を作り直すとき: `blender -b -P blender/build_assets.py`（Blender 5.3 で確認）
