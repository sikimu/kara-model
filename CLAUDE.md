# からっぽのコト

何も学習していない「空モデル」のキャラクターに話しかけ、聞かせ、眠らせて育てるブラウザゲーム。
コンセプトは、**LLMがどのように作られ、学び、使われるかを、コトがかわいく動く姿として眺められること**。最新の体験方針は `docs/experience.md`。

## 技術方針（変更しない）

- 静的サイト。GitHub Pages で公開する（リポジトリ直下の `index.html` が入口）
- 素の JavaScript（ES Modules）。ビルド工程・フレームワーク・npm は使わない
- three.js は CDN から importmap で読み込む。バージョンは導入時の安定版に固定する
- 機械学習ライブラリは使わない。モデルは自前実装
- ふだんは three.js の3Dの家と広場。ニューラル方式の頭の中も広い3D空間とし、神視点で回転・移動・拡大縮小、コトの追従を切り替える。1画面へ詰め込まない。旧集計方式の廃止範囲は `docs/experience.md` に従う
- HTML は文字入力・タブ・速度切り替えなど最小限にする。「ブラウザゲーム感」のあるパネル UI にしない
- キャラクターや小物は Blender で作る（`blender/build_assets.py` から glb を書き出す。手作業の編集はしない）
- 保存は localStorage
- 音楽と効果音は Web Audio API でその場で合成する（音声ファイルは置かない）。音声の認識や読み上げは扱わない
- PC の大きな画面（横長）を基準にし、スマホの縦長画面にも対応する（S18）

## 設計の原則

1. **計算と演出の分離**: `src/model/` は DOM にも three.js にも触れない。計算結果と一緒に「手順ログ（トレース）」を返し、`src/ui/` がそれを再生する
2. **計算を役割ごとに分ける**: 構成（config）・対応表（vocabulary）・Transformer・教材（corpus）・まとまり探し（study）をモジュールで分ける。チップ機能と旧集計方式は廃止済み。ユーザー向けの方式選択機能を追加しない
3. **最小ステップで進める**: `docs/roadmap.md` の現在のステップだけを実装する。先のステップの機能を先取りしない

## 現在の作業範囲（2026-11-14）

- 実装を再開し、本・バインダー方式と可変構成・語彙追加を取り込んだ。ローカル確認待ち（未公開）。公開はユーザーの確認後。コミットは検証が通った作業の区切りごとに行う。
- 作業開始時は [引き継ぎ](docs/session-handoff.md) で実装済み・仮の値・未完了を確認する。
- 仕様の参照先と更新先は [資料一覧](docs/README.md) に従う。合意済み仕様・実装設計案・独立検証・過去の履歴を区別する。

## フォルダ構成

```
index.html
CLAUDE.md
docs/README.md      資料一覧と参照先
docs/design.md      共通仕様と旧方式の記録
docs/roadmap.md     実装ステップと進捗
src/main.js         起動、コトの作成（構成選択）、画面切り替え、保存
src/model/          モデル本体（UI 非依存）。config / vocabulary / transformer / corpus / study / model
src/ui/             画面と演出（3D の家・広場と頭の中の画面）
src/ui/stage.js     家・広場の演出、頭の中への切り替え、一時停止の理由管理
src/ui/mindview.js  頭の中の再生手順（どの部屋へ行き、何を運び、どこで止まるか）
src/ui/neural-view.js  頭の中の 3D の建物（本・バインダー・棒で計算を見せる）
src/ui/inspector.js  本の中身（作業用バインダー・原本・勉強の結果）の DOM 表示
src/ui/neural-explanation.js / neural-guide.js  部屋ごとの説明文と図（DOM に触れない）
src/ui/items.js     観察ノート・ことばのかご・勉強用の本
src/ui/textures.js  その場で描く木目・しっくい・織物・芝の模様
src/save.js         セーブとロード（1 組をまるごと置換、失敗を返す）
assets/character.glb  Blender から書き出したキャラクター
assets/room.glb       Blender から書き出した家・広場・小物、立ち位置の目印
assets/npc.glb        Blender から書き出した、広場で話す人
assets/mind-space.glb 頭の中の建物、本棚、本・バインダーの小物
blender/build_assets.py  assets/ の glb を作る Blender スクリプト
docs/art/             デザイン画（キャラクターの形の正）
tools/check.mjs       動作確認（ヘッドレス Chrome で通しで動かす）
tools/check-neural.mjs / check-neural-view.mjs  モデルと説明の自動検査（Node）
```

## 作業ルール

- 作業前に `docs/roadmap.md` で現在のステップを確認する
- `docs/design.md` は全部読まず、該当する節だけ読む
- 変更は現在のステップに必要なファイルに限る。頼まれていないリファクタリングはしない
- ステップが終わったら `docs/roadmap.md` のチェックを付ける
- 作業の区切りと仕様変更時に `docs/session-handoff.md` を更新する。確定仕様・実装済み・未完了・検証結果を分け、移行後も継続できる状態にする
- 仕様にない判断が必要になったら、実装せずに質問する
- 返答は日本語で簡潔に。変更点の長い解説は不要。見せ方などの確認が必要なら一問一答で行う
- 用語は「空モデル」。「極小モデル」とは呼ばない

## 動作確認

ES Modules は `file://` では動かない。`node tools/serve.mjs` で起動し、`http://localhost:8765/` を開く（終了は Ctrl+C）。

コードや素材を変更したら `node tools/check-neural.mjs`、`node tools/check-neural-view.mjs`、`node tools/check.mjs` を実行する（`--mobile` で縦長画面とタップ操作、`--slow` でふつうの速度の演出、`--mind-preview` で推論の部屋めぐりを確認できる）。文書だけの整理ではアプリ検証・素材生成・版番号更新は不要。
すべて OK になり、`tools/out/` の画面写真で見た目を確かめてからコミットする。ユーザーに確認手順を頼まない。

公開先は https://sikimu.github.io/kara-model/ 。公開更新時は push だけで完了としない。GitHub Pages のデプロイ成功を確認したあと、`node tools/check.mjs --published` と `node tools/check.mjs --published --mobile` で公開 URL を実際に操作し、`tools/out/published/` の画面写真も確認する。完了時は公開リンクを添える。

glb を作り直すとき: `blender -b -P blender/build_assets.py`（Blender 5.3 で確認）

## 進め方（ユーザーの希望）

- 文字である必要のない演出は、Blenderの立体や適切な画像で表現する。世界観に合わない括弧書きの解説を常設しない。小物のモデル品質も改善してよい。
- まずローカル確認先をユーザーに提示し、見た目と動きを調整してからpush・公開する（2026-11-14の最新指示）。ローカル確認待ちの変更を自動公開しない。

- トークン節約のため Codex CLI を使ってよい（`codex exec --sandbox workspace-write -C . "依頼"`）。監督は Claude が行い、差分と画面を確認してから取り込む
  - 向いている仕事: 画像生成（デザイン画）、範囲の決まった実装（触ってよいファイルを明記する）、ドキュメント更新
  - 並行で走らせるときは、触るファイルが重ならないように分ける。10 分以上変更が出なければ止める
- オープンソースや外部の素材・ツールは、導入前にユーザーへ相談する
- 絵が要るときは、Codex にデザイン画を描かせ、それを見て Blender スクリプトで立体にする
