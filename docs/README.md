# 資料一覧と現在地

更新: 2026-11-14。実装再開後の要約。詳細な仕様は下記の参照先で管理する。

## 現在地

**本・バインダー方式・構成選択・まとまり探しを実装し、ローカル検証まで完了。ユーザーのローカル確認待ち（未コミット・未公開）。** 仮に置いた数値と未実施の項目は [引き継ぎ](session-handoff.md) にまとめてある。

| 区分 | 現状 | 詳細 |
| --- | --- | --- |
| 合意済みの目標 | 原本と作業用バインダーで推論・学習を見せる。閲覧中は停止し、閉じると元の状態へ戻す | [体験方針](experience.md) |
| 合意済みの設定 | 初期構成は文脈128・48次元・3層3ヘッド。文字から開始し、本から手動でまとまりを追加する | [構成・語彙・教材](model-settings.md) |
| 実装設計 | データ構造、系列学習、実トレース、保存・中断、実装順序。実装との差分は引き継ぎに記録 | [実装設計](implementation-design.md) |
| 独立検証済み | 2構成の計算・時間・保存復元、小規模な育成途中の語彙追加 | [モデル拡張](benchmark-results.md)／[語彙追加](vocabulary-growth-results.md) |
| 本体の現状 | 実装済み・検証済み。仮の値（上限候補・しきい値・学習率）は見直し対象 | [引き継ぎ](session-handoff.md) |
| 将来構想 | ファイルで相手を招き、文章を介して会話・学習する。画面と実装時期は未定 | [構成・語彙・教材](model-settings.md) |

## 資料の役割と読む順序

1. [session-handoff.md](session-handoff.md)：実装済み・仮の値・未実施・検証結果。
2. [experience.md](experience.md)：何を体験として作るか。見せ方の合意事項。
3. [model-settings.md](model-settings.md)：構成、文字・まとまりの枠、教材、保存の要件。
4. [implementation-design.md](implementation-design.md)：どう実装するかの設計。
5. [roadmap.md](roadmap.md)：未完了の作業と受け入れ条件。後半は過去の履歴。

必要に応じて読む資料：

| 資料 | 用途・位置づけ |
| --- | --- |
| [neural-model.md](neural-model.md) | 実計算と表示の対応、一般のLLMとの違い |
| [benchmark-results.md](benchmark-results.md) | 固定語彙の独立試作の条件・数値・限界 |
| [vocabulary-growth-results.md](vocabulary-growth-results.md) | 小規模な追加検証。旧番号・重みの保持と予測の変化を区別 |
| [検証コードの説明](../tools/benchmark/README.md) | 独立試作の実行方法と測定値の読み方 |
| [design.md](design.md) | 共通仕様と旧方式の記録。チップ等の旧記述を現在の目標にしない |
| [art/](art/) | デザイン画像と生成時のプロンプト |
| [CLAUDE.md](../CLAUDE.md) | 技術方針と作業ルール |

## 残っている判断・検証

[引き継ぎの「仮の値」](session-handoff.md#実装で決めた仮の値検証で見直す) を実測で確定する。容量・文字の枠到達・処理量・温度設定・Worker の要否が対象。受け入れ条件は [ロードマップ](roadmap.md) と [構成仕様の末尾](model-settings.md#実装再開後の受け入れ条件) を参照する。

## 更新時の扱い

- 体験の変更は `experience.md`、設定・語彙・教材の変更は `model-settings.md` に反映し、設計と作業一覧を合わせる。
- 検証結果には対象・条件・限界を残す。独立試作の成功をゲームの検証済み表示へ流用しない。
- 作業区切りでは `session-handoff.md` を更新する。この一覧は入口として保ち、詳細を重複して増やさない。
