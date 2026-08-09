# AITuber Maker リファクタリング計画

## 1. 目的

現在の機能と操作感を維持しながら、素材生成・配信・音声・YouTube チャット・プレゼンテーションの責務を分離し、変更しやすくテスト可能な構成へ段階的に移行する。

この計画では、一度に全面改修せず、各フェーズを単独でレビュー・リリース・ロールバックできる単位に分ける。新機能追加や UI の全面刷新は対象外とする。

## 2. 現状と主な課題

2026-08-09 時点のベースラインは `npm run lint` 成功（エラー 0、警告 14）、`npm run build` 成功（NFT のプロジェクト全体 trace 警告 1）である。自動テスト用のスクリプトとテストファイルは未整備。

| 対象 | 現状 | 主な問題 |
| --- | ---: | --- |
| `src/app/page.tsx` | 3,744 行、`useState` 71 個 | 素材生成、設定、チャット、音声、ライブ同期、UI が単一コンポーネントに集中 |
| `src/app/live/page.tsx` | 1,257 行、`useEffect` 17 個 | アセット読込、再生キュー、ポーリング、描画、レイアウト操作が密結合 |
| `src/app/presentation/presentation-console.tsx` | 859 行 | プロジェクト CRUD、PDF、音声準備、ライブ進行、UI が混在 |
| `src/lib/materials/index.ts` | 1,275 行 | 型、幾何計算、画像処理、マスク生成、WebM/EBML 生成が同一モジュール |
| `src/app/api/**/route.ts` | 13 ルート | 入力検証、JSON ファイル読み書き、パス検証、レスポンス生成が各所に分散 |

追加で次の重複と境界の曖昧さがある。

- `Emotion`、YouTube メッセージ、ライブ音声、レイアウトなどの型が複数ファイルで再定義されている。
- IndexedDB、`BroadcastChannel`、ポーリング、音声変換、`fetch` の詳細が画面コンポーネントへ直接埋め込まれている。
- OpenAI API 呼び出しと API キーの扱いがブラウザ側にあり、UI と外部サービス連携の境界が弱い。
- ローカル JSON と `public/` 配下への保存処理に共通の排他・原子的書き込み・エラー形式がない。
- ルート README が初期テンプレート中心で、実際の開発・検証手順を十分に説明していない。
- `react-hooks/immutability` のファイル全体無効化や未使用コードなど、分割時に解消すべき技術的負債が残っている。

## 3. 到達する構成

機能単位の公開 API を薄く保ち、App Router のページは組み立てに専念させる。

```text
src/
  app/
    api/                         # HTTP の変換とレスポンスのみ
    live/page.tsx                # LiveScreen の組み立て
    presentation/                # PresentationConsole の組み立て
    page.tsx                     # MakerShell の組み立て
  features/
    materials/                   # 素材解析・口パク素材生成
    runtime/                     # キャラクター試写・音声再生
    live/                        # OBS 表示、チャット、再生キュー
    presentation/                # プロジェクト編集・発表進行
    settings/                    # ペルソナ・音声・配信設定
  components/                    # 複数 feature で使う表示部品
  hooks/                         # 複数 feature で使うブラウザ連携
  lib/
    client/                      # IndexedDB、BroadcastChannel、API client
    server/                      # ファイルストア、検証、外部 API client
    media/                       # 幾何・画像・マスク・WebM
  types/                         # 境界をまたぐ共有型と定数
```

依存方向は `app -> features -> components/hooks/lib/types` とし、`lib/server` を Client Component から参照しない。feature 間の直接参照は避け、共有が必要な契約は `types` または小さな共通モジュールへ置く。

## 4. 実施方針

- 先に仕様をテストで固定し、その後に移動・分割する。
- 1 PR につき一つの責務または一つの縦断フローを目安にする。
- 公開型と API レスポンスを先に定義し、UI から実装詳細を剥がす。
- 状態は「永続設定」「サーバー状態」「一時 UI 状態」「メディア再生状態」に分類する。
- ポーリング、タイマー、AudioContext、Object URL、Worker は所有者を一つにし、必ず cleanup を持たせる。
- Next.js 16.2.6 の実装前には `node_modules/next/dist/docs/` の該当ガイドを確認し、現行 API を基準にする。
- 各フェーズで `lint`、型チェック、ユニットテスト、build を通し、利用者向けの挙動変更を含めない。

## 5. フェーズ別計画

### Phase 0: ベースラインと安全網

目的は、分割前の挙動を固定して安全に差分を小さくすること。

- `typecheck`、`test`、必要に応じて `test:e2e` スクリプトを追加する。
- Vitest + Testing Library を導入し、純粋関数と hooks のテスト基盤を作る。
- Playwright で主要なスモークテストを作る。
  - アプリ起動と各モードへの遷移
  - 設定の保存・再読込
  - ライブ画面の起動
  - プレゼンプロジェクト一覧の取得
- 現在の lint 警告 14 件を解消し、警告を増やさない CI 条件を設定する。
- `live-assets` ルートから `next.config.ts` まで trace される build 警告を調査し、ファイルアクセスの探索範囲を静的に限定する。
- README に必要サービス、モデル配置、ローカル状態ファイル、検証コマンドを記載する。

完了条件:

- `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` が成功する。
- 外部サービスがなくても主要画面のスモークテストが実行できる。
- 既知の手動確認項目がチェックリスト化されている。

### Phase 1: 共有契約と基盤処理の抽出

目的は、画面と API に散在する重複を先に取り除くこと。

- `Emotion`、音声メッセージ、YouTube チャット、ライブ設定、オーバーレイ配置、プレゼン再生状態を共有型へ統合する。
- `EMOTIONS` などの定数から型を導出し、実行時ガードも同じ定義を使う。
- IndexedDB の初期化・取得・保存を `lib/client` へ移す。
- base64/ArrayBuffer、Object URL、音声長取得などのメディア共通処理を抽出する。
- `fetch` を画面から API client へ移し、成功レスポンスとエラーを型付けする。
- JSON ファイルの読込・原子的書込、safe ID、パス解決、入力正規化を `lib/server` へ統合する。

完了条件:

- 共有型の重複定義がなく、API client の戻り値に `any` を使わない。
- ルートハンドラーは入力変換、サービス呼び出し、HTTP レスポンスに集中している。
- 抽出した純粋関数とストレージ処理にユニットテストがある。

### Phase 2: 素材生成ドメインの分割

目的は、最大の計算モジュールとメイン画面から素材生成を独立させること。

- `src/lib/materials/index.ts` を以下へ分割する。
  - `types.ts` / `config.ts`
  - `geometry.ts` / `track-processing.ts`
  - `sprites.ts` / `image-analysis.ts`
  - `masking.ts` / `inpainting.ts`
  - `webm.ts`
- 既存の barrel export は移行期間だけ互換層として残し、循環依存を検査する。
- 素材生成の状態遷移を `useMaterialGeneration` に集約する。
- ファイル選択、解析条件、プレビュー、口素材、口なし画像、エクスポートを個別コンポーネントへ分ける。
- Worker 通信を専用 adapter に閉じ込め、キャンセル・エラー・進捗の契約を明確にする。

完了条件:

- `src/lib/materials` の各モジュールが一つの責務を持つ。
- 幾何、平滑化、フレーム選択、マスク、EBML の代表ケースと境界値がテストされている。
- 素材生成の成功、キャンセル、失敗、再実行が手動・自動テストで確認できる。

### Phase 3: メイン画面の feature 分割

目的は、`src/app/page.tsx` をページの組み立て役へ縮小すること。

- `MakerShell` とモードナビゲーションを抽出する。
- `materials`、`runtime`、`presentation`、`settings` を feature component として分離する。
- ペルソナ、OpenAI、TTS、YouTube、配信設定を用途別 hooks に分ける。
- チャット応答生成から音声合成・ライブ送信までを明示的な use case にする。
- 71 個の独立した `useState` を、関連する feature state または reducer へ寄せる。
- ファイル全体の ESLint 無効化を外し、必要な箇所だけ局所的かつ理由付きにする。

完了条件:

- `src/app/page.tsx` はルーティングと feature の組み立てを中心とし、目安 300 行以下になる。
- 一つの feature の変更が他モードの内部状態へ直接依存しない。
- チャット送信、TTS 切替、素材同期の回帰テストが通る。

### Phase 4: ライブ画面と再生制御の分割

目的は、非同期イベントが集中するライブ画面を状態機械として理解できる形にすること。

- アセット読込、YouTube ポーリング、音声キュー、プレゼン再生、BroadcastChannel を個別 hooks/services にする。
- 音声状態を `idle -> queued -> playing -> completed/failed` の明示的な遷移にする。
- 通常会話とプレゼン音声の優先順位、重複排除、再試行、停止条件を一箇所で定義する。
- Canvas 描画とリップシンクを `CharacterRenderer` に分離する。
- キャラクター・チャットのドラッグ、ズーム、永続化を `useOverlayLayout` に統合する。
- ポーリング間隔と再試行をテスト可能な scheduler 経由にする。

完了条件:

- 同一音声の二重再生、終了通知欠落、画面アンマウント後の再生がテストで防止されている。
- 全ての timer、animation frame、AudioContext、channel に cleanup がある。
- `src/app/live/page.tsx` は目安 200 行以下になる。

### Phase 5: プレゼンテーション機能の分割

目的は、編集とライブ発表の進行制御を独立させること。

- プロジェクト一覧、インポート、スライド編集、音声準備、発表コントロールをコンポーネント分割する。
- `usePresentationProject` と `usePresentationPlayback` へサーバー同期と状態遷移を集約する。
- 台本正規化・段落分割・感情判定・音声準備をサービス層へ移す。
- PDF レンダリングのライフサイクルと object URL の破棄を一箇所で管理する。
- プロジェクト保存形式に `schemaVersion` を追加し、将来の migration 方針を決める。

完了条件:

- プロジェクト作成、PDF 差替、台本保存、音声準備、開始・一時停止・再開・停止を一連で確認できる。
- 編集状態と再生状態が別のモデルとして扱われる。
- `presentation-console.tsx` は目安 250 行以下になる。

### Phase 6: API・永続化・外部サービス境界の強化

目的は、ローカル開発向けの実装を保ちつつ、破損・競合・秘密情報漏洩を防ぐこと。

- Route Handler のリクエストをスキーマ検証し、エラー形式と status code を統一する。
- OpenAI などの外部 API 呼び出しをサーバー側 adapter に寄せ、API キーをブラウザへ保持・送出しない構成を検討する。
- Aivis/VOICEVOX の URL 許可規則、timeout、レスポンスサイズ、content type を明示する。
- JSON 状態ファイルは一時ファイルへの書込後に rename し、同時更新時の破損を防ぐ。
- `public/` 配下に保存するデータと非公開データを区別し、ファイル名・MIME・容量・パス traversal を検証する。
- 永続化を interface 化し、将来 DB へ移行しても Route Handler を変更しない構成にする。

完了条件:

- 不正 ID、巨大入力、不正 MIME、外部 endpoint、破損 JSON のテストがある。
- 秘密情報が localStorage、IndexedDB、レスポンス、ログ、`public/` に残らない。
- 同一リソースへの並行更新でも読み出し可能な状態が維持される。

### Phase 7: 仕上げと運用整備

目的は、互換層と不要コードを取り除き、今後の変更ルールを固定すること。

- 移行用 barrel、重複 helper、未使用コード、不要な ESLint 抑制を削除する。
- bundle analyzer または build 出力で、PDF・画像処理コードが必要画面だけに読み込まれることを確認する。
- 大きな feature を遅延読込し、初期表示への影響を計測する。
- CI で lint、typecheck、unit、build、主要 E2E を実行する。
- README と設計ドキュメントへ依存方向、状態の保存先、主要フロー、障害時の確認方法を記載する。

完了条件:

- 互換目的だけのコードと既知の lint 警告が残っていない。
- 新しい feature を既存の巨大ページへ追記せず追加できる。
- 開発者が README の手順だけで起動・検証できる。

## 6. 推奨する実施順と PR 単位

依存関係を崩さない推奨順は `Phase 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7`。ただし Phase 4 と Phase 5 は、Phase 1 の共有契約が完了すれば並行可能。

PR は概ね次の粒度に分ける。

1. テスト基盤、スクリプト、README
2. 共有型・定数と browser utility
3. server storage・validation・API error
4. materials の純粋関数分割
5. materials feature UI と hook
6. settings/runtime/chat feature
7. live asset・layout・renderer
8. live speech/playback state machine
9. presentation project editor
10. presentation playback controller
11. security・atomic persistence
12. cleanup・性能・ドキュメント

各 PR は機械的な移動と挙動変更を混在させず、目安 300〜600 行のレビュー可能な差分にする。大きくなる場合は「型・関数の移動」と「呼び出し元の切替」を分ける。

## 7. 検証マトリクス

| 領域 | ユニット | 統合 | E2E / 手動 |
| --- | --- | --- | --- |
| 素材生成 | 幾何、平滑化、マスク、WebM | Worker メッセージとキャンセル | 動画入力から成果物 DL |
| 設定 | sanitize、default、migration | IndexedDB / API 保存 | 再読込後の復元 |
| チャット・音声 | 正規化、キュー遷移 | OpenAI/TTS adapter mock | コメント選択から再生 |
| ライブ | reducer、優先度、重複排除 | polling/channel/audio mock | OBS 相当画面で表示・再生 |
| プレゼン | 段落、状態遷移、manifest | project store / playback API | PDF 取込から発表終了 |
| API | schema、path、error map | 一時ディレクトリで CRUD | Route Handler の主要リクエスト |

外部 API や音声エンジンは通常の CI では mock を使い、実サービスとの疎通は任意の手動チェックとして分離する。

## 8. リスクと対策

- **メディア処理の微妙な出力差**: 代表入力の track、sprite、WebM メタデータを fixture 化して差分比較する。
- **非同期処理の競合**: 状態遷移と所有者を先に定義し、fake timer と mock channel で再現する。
- **ブラウザ API のテスト困難性**: adapter を作り、DOM/IndexedDB/Audio/Worker を差し替え可能にする。
- **保存形式の互換性**: 既存ファイルを fixture として読み込み、schema version と migration を導入する。
- **分割途中の循環依存**: feature の公開 API を `index.ts` に限定し、依存チェックを CI に追加する。
- **長期ブランチ化**: 各 PR で build 可能な状態を維持し、互換層を短期間だけ使う。

## 9. 着手時のチェックリスト

- 対象フェーズの現行挙動と非対象を PR 本文に記載したか。
- Next.js 16.2.6 の該当ローカルドキュメントを確認したか。
- 変更前に回帰テストまたは fixture を追加したか。
- 新しいモジュールの依存方向が到達構成に沿っているか。
- timer、listener、object URL、Worker、AudioContext の cleanup を確認したか。
- API キーや利用者データがクライアント・ログ・公開ディレクトリへ漏れていないか。
- lint、typecheck、unit、build と該当 E2E を実行したか。
- ロールバック時に保存済みデータを壊さないか。
