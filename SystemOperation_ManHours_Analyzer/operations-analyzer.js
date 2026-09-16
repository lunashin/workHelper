'use strict';

/**
 * 運用業務分析ツール
 *
 * 読む順序：共通設定 → 型定義 → 共通関数 → CSV → 集計 → 描画 → 画面制御。
 * HTMLと同じフォルダーに配置する通常の外部スクリプトです。
 * サーバーを使わず file:// から開けるよう、ES Modulesは使用しません。
 * 工数は内部では「時間 × 10」の整数で保持し、表示時だけ時間に戻します。
 */

// =============================================================================
// アプリ全体の定数・共有変数（変更可能な設定はこの節に集約）
// =============================================================================

/** CSVの列名。元ファイルの列名に合わせる場合は、この対応表を変更する。 */
const COLUMNS = Object.freeze({
    status: 'ステータス',
    name: '作業名',
    date: '着手予定日',
    planned: '予定工数',
    actual: '実績工数',
    routine: '定常業務No',
    issue: '気付き番号',
    quarter: '実施時期'
});

/** 入力制限、日付計算、グラフ読込先、サンプル表示の設定。 */
const CONFIG = Object.freeze({
    statuses: Object.freeze(['申請中', '作業中', '取り下げ', '完了']),
    maxBytes: 30 * 1024 * 1024,
    maxSpanDays: 36600,
    millisecondsPerDay: 86400000,
    effortScale: 10,
    graphScriptUrl: 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
    demoBudget: '600'
});

/** 系列の基本色。11種類目以降は旧版と同じ規則で色相を算出する。 */
const COLORS = Object.freeze([
    '#1764ce', '#00847d', '#d08017', '#8455bb', '#ce476b',
    '#446575', '#63a342', '#bb5a24', '#318fb3', '#ac7294'
]);

/** 期間キーと画面上の見出しの対応。 */
const PERIOD_LABELS = Object.freeze({
    all: '全期間',
    quarter: 'クオーター毎',
    week: '週次',
    day: '日次',
    routine: '定常業務No別の実績工数',
    issue: '気付き番号別の実績工数'
});

/** HTMLへデータを挿入するときのエスケープ規則。 */
const HTML_ENTITIES = Object.freeze({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
});

/** 条件変更で画面を再描画する入力要素のID。 */
const FILTER_CONTROL_IDS = Object.freeze([
    'from', 'to', 'status', 'withdraw', 'planStart', 'planEnd',
    'asof', 'budget', 'typeMode', 'completed'
]);

/** 保存先キーと保存対象。基準日は保存対象に含めない。 */
const PLANNING_STORAGE = Object.freeze({
    prefix: 'operations-analyzer.planning.v1.',
    fields: Object.freeze(['planStart', 'planEnd', 'budget'])
});

/** アプリの唯一の共有インスタンス。可変データはこのインスタンス内で管理する。 */
let application = null;

// =============================================================================
// データ型（JSDoc：保守時の参照とエディターの補完用）
// =============================================================================

/**
 * @typedef {Object} Task
 * @property {string} status ステータス。
 * @property {string} name 作業名。
 * @property {number|null} date UTC午前0時のミリ秒値。空欄はnull。
 * @property {number} planned 予定工数（0.1時間を1とする整数）。
 * @property {number} actual 実績工数（0.1時間を1とする整数）。
 * @property {string} routine 定常業務No。空欄または先頭ゼロを除いた数字列。
 * @property {string} issue 気付き番号。空欄可。
 * @property {string} quarter 実施時期。空欄・列なしは「未設定」。
 * @property {string} type 二重計上を避けるための作業種類の組合せ名。
 * @property {number} line CSV内のレコード開始物理行番号。
 */

/**
 * @typedef {Object} Totals
 * @property {number} actual 実績工数合計（0.1時間単位）。
 * @property {number} planned 予定工数合計（0.1時間単位）。
 * @property {number} count アイテム数。
 */

/**
 * @typedef {Object} Bucket
 * @property {string} label 横軸に表示する期間名。
 * @property {Task[]} rows 期間に属する作業。
 * @property {number} actual 実績工数合計（0.1時間単位）。
 * @property {number} planned 予定工数合計（0.1時間単位）。
 * @property {number} count アイテム数。
 */

/**
 * @typedef {Object} ImportResult
 * @property {Task[]} rows 検証・変換済み作業。
 * @property {string[]} warnings 取込を継続できる空欄などの警告。
 * @property {number} min 最初の有効日付。日付がなければInfinity。
 * @property {number} max 最後の有効日付。日付がなければ-Infinity。
 */

/**
 * @typedef {Object} FilterConditions
 * @property {number|null} from 集計開始日。指定なしはnull。
 * @property {number|null} to 集計終了日。指定なしはnull。
 * @property {string} status 対象ステータス。空文字はすべて。
 * @property {boolean} includeWithdrawn 取り下げを含めるか。
 */

/**
 * @typedef {Object} PlanningConditions
 * @property {number|null} start 計画開始日。
 * @property {number|null} end 計画終了日。
 * @property {number|null} asof 消化状況の基準日。
 * @property {number} budget 予算（時間）。空欄は0。
 */

/**
 * @typedef {Object} BudgetMetrics
 * @property {Totals} total 集計条件適用後の全作業合計。
 * @property {boolean} valid 計画日付の指定が有効か。
 * @property {number|null} actual 基準日までの実績（時間）。計画無効時はnull。
 * @property {number} elapsed 経過暦日。計画開始前は0、終了後は全期間日数。
 * @property {number} days 計画期間の暦日数。計画無効時は0。
 * @property {number|null} forecast 均等ペースによる期末見込（時間）。経過0日はnull。
 * @property {PlanningConditions} planning 計算に使用した計画条件。
 */

/**
 * @typedef {Object} ChartModel
 * @property {string} unit 縦軸単位（時間・件・%）。
 * @property {{label:string,color:string}[]} series 系列の名前と色。
 * @property {number[][]} values [期間番号][系列番号]のグラフ値。
 * @property {string[]} headers 集計表の見出し。
 * @property {(string|number)[][]} tableRows 表示・CSV出力用の集計値。
 * @property {boolean} stacked 積み上げ棒グラフか。
 */

// =============================================================================
// 共通関数：DOM参照、文字列、日付
// =============================================================================

/**
 * 指定IDの画面要素を取得する。
 * @param {string} id HTML内で定義済みの要素ID。
 * @returns {HTMLElement} 対象要素。HTMLとのID対応が前提。
 */
function getElement(id)
{
    return document.getElementById(id);
}

/**
 * 数値を日本語ロケール・小数第1位で表示する。
 * @param {number} value 表示する数値。
 * @returns {string} 桁区切りと小数第1位を含む文字列。
 */
function formatNumber(value)
{
    return Number(value).toLocaleString('ja-JP', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    });
}

/**
 * データをHTMLとして解釈させないよう特殊文字を置換する。
 * @param {*} value HTMLへ挿入する値。
 * @returns {string} エスケープ済み文字列。
 */
function escapeHtml(value)
{
    return String(value).replace(/[&<>"']/g, replaceHtmlCharacter);
}

/**
 * 正規表現置換の対象文字に対応するHTMLエンティティを返す。
 * @param {string} character HTML特殊文字1文字。
 * @returns {string} 対応するエンティティ。
 */
function replaceHtmlCharacter(character)
{
    return HTML_ENTITIES[character];
}

/**
 * UTC日付を日付入力欄の形式へ変換する。
 * @param {number} timestamp UTCミリ秒値。
 * @returns {string} yyyy-MM-dd形式。
 */
function toIsoDate(timestamp)
{
    return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * UTC日付をグラフ・表の表示形式へ変換する。
 * @param {number} timestamp UTCミリ秒値。
 * @returns {string} yyyy/MM/dd形式。
 */
function formatDate(timestamp)
{
    return toIsoDate(timestamp).replaceAll('-', '/');
}

/**
 * ブラウザのローカルタイムゾーンでの今日を取得する。
 * @returns {string} yyyy-MM-dd形式。引数なし。
 */
function todayInputValue()
{
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

/**
 * CSVの日付を検証し、時差の影響を受けないUTC値へ変換する。
 * @param {string} text mm/dd/yyyy形式の日付。1桁の月日と空文字も許容。
 * @returns {number|null} UTCミリ秒値。空文字はnull。
 * @throws {Error} 書式不正、1900年未満、存在しない日付。
 */
function parseTaskDate(text)
{
    // 空欄は不正値にせず、日付のない作業として後段で扱う。
    if (!text)
    {
        return null;
    }

    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (!match)
    {
        throw Error('着手予定日は mm/dd/yyyy で入力してください');
    }

    // Dateの自動繰り上がりを使ったあと、年月日を照合して不正日を検出する。
    const year = Number(match[3]);
    const month = Number(match[1]);
    const day = Number(match[2]);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);

    if (year < 1900 || date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    {
        throw Error('着手予定日が存在しない日付です');
    }

    return date.valueOf();
}

/**
 * 日付入力欄をUTCミリ秒値で読み取る。
 * @param {string} id input[type=date]のID。
 * @returns {number|null} UTCミリ秒値。未指定はnull。
 */
function readDateInput(id)
{
    const value = getElement(id).value;
    return value ? Date.parse(value + 'T00:00:00Z') : null;
}

/**
 * 指定日が属する週の月曜日を求める。
 * @param {number} timestamp UTC午前0時のミリ秒値。
 * @returns {number} 月曜日のUTC午前0時のミリ秒値。
 */
function getMonday(timestamp)
{
    const daysSinceMonday = (new Date(timestamp).getUTCDay() + 6) % 7;
    return timestamp - daysSinceMonday * CONFIG.millisecondsPerDay;
}

// =============================================================================
// CSVサービス：構文解析、入力検証、文字コード、出力
// =============================================================================

/** CSVに関係する処理をまとめる。画面やアプリ状態は変更しない。 */
class CsvService
{
    /**
     * 引用符内のカンマ・改行・二重引用符を考慮してCSVを分解する。
     * @param {string} text CSV全文。先頭のUTF-8 BOMを許容。
     * @returns {{cells:string[],line:number}[]} 空白行を除くレコードと開始物理行番号。
     * @throws {Error} 引用符の位置・閉じ方が不正な場合。
     */
    static parse(text)
    {
        text = text.replace(/^\uFEFF/, '');
        const rows = [];
        let cells = [];
        let cell = '';
        let quoted = false;
        let closed = false;
        let line = 1;
        let startLine = 1;

        /**
         * 現在のレコードを確定し、次のレコード用にバッファを初期化する。
         * @returns {void} 引数なし。外側の行バッファと結果配列を更新する。
         */
        function finishRow()
        {
            cells.push(cell);
            if (cells.some(isNonBlankCell))
            {
                rows.push({ cells, line: startLine });
            }
            cells = [];
            cell = '';
            closed = false;
        }

        /**
         * 空白文字だけのセルでないか判定する。
         * @param {string} value セル値。
         * @returns {boolean} 有効な文字があればtrue。
         */
        function isNonBlankCell(value)
        {
            return value.trim() !== '';
        }

        // 引用符内外の状態を切り替えながら、1文字ずつ読む。
        for (let index = 0; index < text.length; index++)
        {
            const character = text[index];
            if (quoted)
            {
                if (character === '"')
                {
                    if (text[index + 1] === '"')
                    {
                        cell += '"';
                        index++;
                    }
                    else
                    {
                        quoted = false;
                        closed = true;
                    }
                }
                else
                {
                    cell += character;
                    if (character === '\n')
                    {
                        line++;
                    }
                }
                continue;
            }

            // 引用符外の区切り文字と改行を処理する。
            if (character === '"')
            {
                if (cell !== '' || closed)
                {
                    throw Error(`${line}行目：引用符の位置が不正です`);
                }
                quoted = true;
            }
            else if (character === ',')
            {
                cells.push(cell);
                cell = '';
                closed = false;
            }
            else if (character === '\n' || character === '\r')
            {
                if (character === '\r' && text[index + 1] === '\n')
                {
                    index++;
                }
                finishRow();
                line++;
                startLine = line;
            }
            else
            {
                if (closed)
                {
                    if (character === ' ' || character === '\t')
                    {
                        continue;
                    }
                    throw Error(`${line}行目：閉じ引用符の後に不正な文字があります`);
                }
                cell += character;
            }
        }

        // ファイル末尾に改行がなくても、最後のレコードを確定する。
        if (quoted)
        {
            throw Error(`${startLine}行目：引用符が閉じられていません`);
        }
        finishRow();
        return rows;
    }

    /**
     * 工数セルを検証し、整数へ変換する。
     * @param {string} text 前後空白を除去済みのセル。空文字は0。
     * @param {string} columnName エラーに表示する列名。
     * @returns {number} 工数×10の整数。桁区切りのカンマは除去する。
     * @throws {Error} 負数、小数第2位以下、不正書式、安全な整数範囲の超過。
     */
    static parseEffort(text, columnName)
    {
        if (!text)
        {
            return 0;
        }
        if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d)?$/.test(text))
        {
            throw Error(`${columnName}は0以上・小数第1位までの数値にしてください`);
        }

        const amount = Math.round(Number(text.replaceAll(',', '')) * CONFIG.effortScale);
        if (!Number.isSafeInteger(amount))
        {
            throw Error(`${columnName}が大きすぎます`);
        }
        return amount;
    }

    /**
     * CSV全文をアプリの作業データへ変換する。不正行があれば全体を拒否する。
     * @param {string} text CSV全文。
     * @returns {ImportResult} 変換結果、空欄警告、日付範囲。
     * @throws {Error} 必須列不足、重複列、不正行、100年を超える日付範囲。
     */
    static normalize(text)
    {
        const rawRows = CsvService.parse(text);
        if (rawRows.length < 2)
        {
            throw Error('ヘッダーと1件以上のデータが必要です');
        }

        // ヘッダーを検証し、列の並び順によらない参照表を作る。
        const headers = rawRows[0].cells.map(trimCell);
        if (new Set(headers).size !== headers.length)
        {
            throw Error('同名の列が重複しています');
        }
        const indexes = {};
        const missing = [];
        for (const [key, columnName] of Object.entries(COLUMNS))
        {
            indexes[key] = headers.indexOf(columnName);
            if (key !== 'quarter' && indexes[key] < 0)
            {
                missing.push(columnName);
            }
        }
        if (missing.length)
        {
            throw Error('必須列がありません：' + missing.join('、'));
        }

        const rows = [];
        const errors = [];
        const warnings = [];
        let blankDates = 0;
        let blankHours = 0;
        let blankQuarters = 0;
        let minimumDate = Infinity;
        let maximumDate = -Infinity;

        // 各行を検証する。エラーはまとめて表示し、途中の行だけを取り込まない。
        for (const rawRow of rawRows.slice(1))
        {
            try
            {
                if (rawRow.cells.length !== headers.length)
                {
                    throw Error(`列数が不一致です（${rawRow.cells.length}列／ヘッダー${headers.length}列）`);
                }
                const task = {};
                for (const key in indexes)
                {
                    task[key] = indexes[key] < 0 ? '' : rawRow.cells[indexes[key]].trim();
                }
                if (!CONFIG.statuses.includes(task.status))
                {
                    throw Error('ステータスが不正です：' + task.status);
                }
                if (!task.name)
                {
                    throw Error('作業名が空欄です');
                }

                // 空欄の工数は0、日付はnullにするという従来の扱いを維持する。
                if (!task.planned)
                {
                    blankHours++;
                }
                task.planned = CsvService.parseEffort(task.planned, COLUMNS.planned);
                if (!task.actual)
                {
                    blankHours++;
                }
                task.actual = CsvService.parseEffort(task.actual, COLUMNS.actual);
                task.date = parseTaskDate(task.date);
                if (task.date === null)
                {
                    blankDates++;
                }

                // 作業種類は番号の組合せにし、同じ行を複数種類へ二重計上しない。
                if (task.routine && !/^\d+$/.test(task.routine))
                {
                    throw Error('定常業務Noは0以上の整数にしてください');
                }
                if (task.routine)
                {
                    task.routine = task.routine.replace(/^0+(?=\d)/, '');
                }
                if (!task.quarter)
                {
                    task.quarter = '未設定';
                    blankQuarters++;
                }
                const typeParts = [];
                if (task.routine)
                {
                    typeParts.push('定常 #' + task.routine);
                }
                if (task.issue)
                {
                    typeParts.push('気付き ' + task.issue);
                }
                task.type = typeParts.join(' / ') || 'その他・未分類';
                task.line = rawRow.line;
                rows.push(task);

                if (task.date !== null)
                {
                    minimumDate = Math.min(minimumDate, task.date);
                    maximumDate = Math.max(maximumDate, task.date);
                }
            }
            catch (error)
            {
                errors.push(`${rawRow.line}行目：${error.message}`);
            }
        }

        // 大量のエラーで画面を埋めないよう、先頭30件まで表示する。
        if (errors.length)
        {
            const suffix = errors.length > 30 ? '\nほか ' + (errors.length - 30) + ' 件' : '';
            throw Error(`取込を中止しました（不正な行：${errors.length}件）。\n` +
                errors.slice(0, 30).join('\n') + suffix);
        }
        if (blankDates)
        {
            warnings.push(`日付空欄 ${blankDates}件（日次・週次、日付指定時、消化状況から除外）`);
        }
        if (blankHours)
        {
            warnings.push(`工数空欄 ${blankHours}セル（0として集計）`);
        }
        if (blankQuarters)
        {
            warnings.push(`実施時期の未設定 ${blankQuarters}件`);
        }
        if ((maximumDate - minimumDate) / CONFIG.millisecondsPerDay > CONFIG.maxSpanDays)
        {
            throw Error('日付の範囲が100年を超えています。日付を確認してください');
        }
        return { rows, warnings, min: minimumDate, max: maximumDate };

        /**
         * ヘッダーセルの前後空白を除去する。
         * @param {string} value 元のセル値。
         * @returns {string} 前後空白を除いた値。
         */
        function trimCell(value)
        {
            return value.trim();
        }
    }

    /**
     * バイト列を選択した文字コードでデコードする。
     * @param {ArrayBuffer} buffer ファイルのバイト列。
     * @param {string} encoding auto、utf-8、shift_jisのいずれか。
     * @returns {string} CSVテキスト。autoはUTF-8を優先し、失敗時だけShift_JISを試す。
     * @throws {TypeError} 指定文字コードで解釈できない場合。
     */
    static decode(buffer, encoding)
    {
        if (encoding === 'auto')
        {
            try
            {
                return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
            }
            catch
            {
                return new TextDecoder('shift_jis', { fatal: true }).decode(buffer);
            }
        }
        return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    }

    /**
     * CSV出力用にセルを引用し、式として評価され得る文字列を保護する。
     * @param {*} value セル値。null・undefinedは空文字。
     * @returns {string} 二重引用符で囲んだ値。負の数値は数値のまま保持する。
     */
    static encodeCell(value)
    {
        let text = String(value ?? '');
        if (/^(?:[\t\r\n]|\s*[=+@\-])/.test(text) && !/^-[\d,.]+$/.test(text))
        {
            text = "'" + text;
        }
        return '"' + text.replaceAll('"', '""') + '"';
    }

    /**
     * 二次元配列をCSVテキストに変換する。
     * @param {Array<Array<*>>} rows 行とセルの配列。
     * @returns {string} CRLF区切りのCSV。BOMは含めない。
     */
    static stringify(rows)
    {
        const lines = [];
        for (const row of rows)
        {
            lines.push(row.map(CsvService.encodeCell).join(','));
        }
        return lines.join('\r\n');
    }

    /**
     * UTF-8 BOM付きCSVとしてブラウザから保存する。
     * @param {string} filename 保存時のファイル名。
     * @param {string} text BOMを含まないCSVテキスト。
     * @returns {void} ダウンロードを開始する。
     */
    static download(filename, text)
    {
        const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();

        // クリック処理直後にURLを解放すると保存に失敗するため、少し待って解放する。
        setTimeout(releaseDownloadUrl, 1000);

        /**
         * 保存用の一時URLを解放する。
         * @returns {void} 引数なし。外側のurlを解放する。
         */
        function releaseDownloadUrl()
        {
            URL.revokeObjectURL(url);
        }
    }
}

// =============================================================================
// 集計サービス：DOMを参照せず、入力値から集計結果だけを返す
// =============================================================================

/** 作業の絞り込み、期間集計、予算計算、グラフ用データの構築を担当する。 */
class AnalysisService
{
    /**
     * 作業一覧の実績・予定・件数を合計する。
     * @param {Task[]} rows 作業一覧。
     * @returns {Totals} 合計。空配列ならすべて0。
     */
    static total(rows)
    {
        const result = { actual: 0, planned: 0, count: 0 };
        for (const task of rows)
        {
            result.actual += task.actual;
            result.planned += task.planned;
            result.count++;
        }
        return result;
    }

    /**
     * 日付・ステータス・取り下げ条件で作業を絞り込む。
     * @param {Task[]} rows 元の作業一覧。
     * @param {FilterConditions} conditions 絞り込み条件。
     * @returns {Task[]} 条件に一致する作業。元の配列と作業は変更しない。
     * @throws {Error} 集計開始日が終了日より後の場合。
     */
    static filter(rows, conditions)
    {
        const { from, to, status, includeWithdrawn } = conditions;
        if (from !== null && to !== null && from > to)
        {
            throw Error('集計開始日は集計終了日以前にしてください');
        }

        const selectedRows = [];
        for (const task of rows)
        {
            // 日付指定時に日付不明の行を除外する挙動は旧版と同じ。
            if (status && task.status !== status)
            {
                continue;
            }
            if (!includeWithdrawn && task.status === '取り下げ')
            {
                continue;
            }
            if (from !== null && (task.date === null || task.date < from))
            {
                continue;
            }
            if (to !== null && (task.date === null || task.date > to))
            {
                continue;
            }
            selectedRows.push(task);
        }
        return selectedRows;
    }

    /**
     * 1作業の集計先キーを決める。
     * @param {Task} task 対象作業。
     * @param {string} period all、quarter、week、dayのいずれか。
     * @returns {string|number|null} 期間名またはUTC日付。日付不明の週・日はnull。
     */
    static periodKey(task, period)
    {
        if (period === 'all')
        {
            return '全期間';
        }
        if (period === 'quarter')
        {
            return task.quarter;
        }
        if (task.date === null)
        {
            return null;
        }
        if (period === 'week')
        {
            return getMonday(task.date);
        }
        return task.date;
    }

    /**
     * 期間キーを旧版と同じ順序で比較する。
     * @param {[string|number,Task[]]} first 比較対象1。
     * @param {[string|number,Task[]]} second 比較対象2。
     * @returns {number} 日付は昇順、文字列は自然順。「未設定」は末尾。
     */
    static comparePeriods(first, second)
    {
        const firstKey = first[0];
        const secondKey = second[0];
        if (typeof firstKey === 'number')
        {
            return firstKey - secondKey;
        }
        if (firstKey === '未設定')
        {
            return 1;
        }
        if (secondKey === '未設定')
        {
            return -1;
        }
        return String(firstKey).localeCompare(String(secondKey), 'ja', { numeric: true });
    }

    /**
     * 作業一覧を指定の期間単位に分けて合計する。
     * @param {Task[]} rows 集計対象の作業。
     * @param {string} period all、quarter、week、dayのいずれか。
     * @returns {Bucket[]} 並べ替え済みの期間一覧。週・日は途中の空白期間も含む。
     */
    static buckets(rows, period)
    {
        const grouped = new Map();
        for (const task of rows)
        {
            const key = AnalysisService.periodKey(task, period);
            if (key === null)
            {
                continue;
            }
            if (!grouped.has(key))
            {
                grouped.set(key, []);
            }
            grouped.get(key).push(task);
        }

        // 元データの最初から最後までの空白日・週を0件として補完する。
        if ((period === 'day' || period === 'week') && grouped.size)
        {
            let minimum = Infinity;
            let maximum = -Infinity;
            for (const timestamp of grouped.keys())
            {
                minimum = Math.min(minimum, timestamp);
                maximum = Math.max(maximum, timestamp);
            }
            const interval = (period === 'week' ? 7 : 1) * CONFIG.millisecondsPerDay;
            for (let timestamp = minimum; timestamp <= maximum; timestamp += interval)
            {
                if (!grouped.has(timestamp))
                {
                    grouped.set(timestamp, []);
                }
            }
        }
        if (period === 'all' && !grouped.size)
        {
            grouped.set('全期間', []);
        }

        const result = [];
        const sortedEntries = Array.from(grouped).sort(AnalysisService.comparePeriods);
        for (const [key, periodRows] of sortedEntries)
        {
            result.push({
                label: typeof key === 'number' ? formatDate(key) : key,
                rows: periodRows,
                ...AnalysisService.total(periodRows)
            });
        }
        return result;
    }

    /**
     * 計画期間と基準日に基づく消化状況を算出する。
     * @param {Task[]} rows 集計条件を適用済みの作業。完了のみの条件は未適用。
     * @param {PlanningConditions} planning 計画期間・基準日・予算。
     * @returns {BudgetMetrics} カードとペース説明に必要な数値。
     */
    static budgetMetrics(rows, planning)
    {
        const { start, end, asof } = planning;
        const valid = start !== null && end !== null && asof !== null && start <= end;
        let actual = null;
        let elapsed = 0;
        let days = 0;

        // 日付不明・計画期間外・基準日より後の作業を消化計算から除外する。
        if (valid)
        {
            const consumedRows = [];
            for (const task of rows)
            {
                if (task.date !== null && task.date >= start && task.date <= Math.min(asof, end))
                {
                    consumedRows.push(task);
                }
            }
            actual = AnalysisService.total(consumedRows).actual / CONFIG.effortScale;
            elapsed = Math.max(0, Math.min(end, asof) - start + CONFIG.millisecondsPerDay) /
                CONFIG.millisecondsPerDay;
            days = (end - start) / CONFIG.millisecondsPerDay + 1;
        }

        // 旧版同様、見込工数自体は予算の入力有無によらず経過日があれば計算する。
        const forecast = elapsed > 0 ? actual / elapsed * days : null;
        return { total: AnalysisService.total(rows), valid, actual, elapsed, days, forecast, planning };
    }

    /**
     * 凡例を定常業務No、気付き番号、未分類の順に並べる。
     * @param {Task[]} rows 集計対象の作業。
     * @returns {string[]} 各分類内を番号の自然順で並べた種類名。
     */
    static sortedTypes(rows)
    {
        const types = new Map();

        // 作業種類ごとに、並べ替えに使用する番号と分類順位を保持する。
        for (const task of rows)
        {
            if (!types.has(task.type))
            {
                // 両方の番号を持つ作業は定常業務側に配置する。
                const rank = task.routine ? 0 : task.issue ? 1 : 2;

                types.set(task.type, {
                    label: task.type,
                    rank,
                    routine: task.routine,
                    issue: task.issue
                });
            }
        }

        const sorted = Array.from(types.values()).sort(compareTypes);
        const labels = [];

        for (const type of sorted)
        {
            labels.push(type.label);
        }

        return labels;

        /**
         * 分類を優先し、番号内の数字を数値として比較する。
         * @param {Object} first 分類順位・番号・名称を持つ比較対象1。
         * @param {Object} second 分類順位・番号・名称を持つ比較対象2。
         * @returns {number} sort用の比較結果。
         */
        function compareTypes(first, second)
        {
            return first.rank - second.rank ||
                first.routine.localeCompare(second.routine, 'ja', { numeric: true }) ||
                first.issue.localeCompare(second.issue, 'ja', { numeric: true }) ||
                first.label.localeCompare(second.label, 'ja', { numeric: true });
        }
    }

    /**
     * 選択条件を適用済みの作業を、指定した番号ごとに集計する。
     * @param {Task[]} rows 日付・ステータス条件で絞り込んだ作業。
     * @param {string} field routine（定常業務No）またはissue（気付き番号）。
     * @returns {Bucket[]} 実績工数の降順で並べた集計。同工数は番号順。対象番号の空欄は除く。
     */
    static numberBuckets(rows, field)
    {
        const grouped = new Map();

        // 他方の番号にかかわらず、指定された番号に実績をまとめる。
        for (const task of rows)
        {
            const number = task[field];
            if (!number)
            {
                continue;
            }
            if (!grouped.has(number))
            {
                grouped.set(number, []);
            }
            grouped.get(number).push(task);
        }

        // 番号ごとに工数・件数を集計する。
        const result = [];
        for (const [number, numberRows] of grouped)
        {
            result.push({
                label: number,
                rows: numberRows,
                ...AnalysisService.total(numberRows)
            });
        }

        // 実績工数が多い順に並べ、同工数の場合は番号の自然順とする。
        return result.sort(compareBuckets);

        /**
         * 実績工数の降順、番号の自然順で集計結果を比較する。
         * @param {Bucket} first 比較対象の集計1。
         * @param {Bucket} second 比較対象の集計2。
         * @returns {number} sort用の比較結果。
         */
        function compareBuckets(first, second)
        {
            return second.actual - first.actual ||
                first.label.localeCompare(second.label, 'ja', { numeric: true });
        }
    }

    /**
     * 作業種類タブのグラフ値と集計表を作る。
     * @param {Bucket[]} buckets 期間別の集計結果。
     * @param {string[]} types 画面全体で統一する種類の順序。
     * @param {boolean} showPercent trueなら構成比、falseなら時間を棒グラフにする。
     * @returns {ChartModel} 積み上げ棒グラフと工数・割合・件数の表。
     */
    static typeChart(buckets, types, showPercent)
    {
        const model = {
            unit: showPercent ? '%' : '時間',
            series: [], values: [],
            headers: ['期間', '作業種類', '実績工数(h)', '割合(%)', '件数'],
            tableRows: [], stacked: true
        };
        for (let index = 0; index < types.length; index++)
        {
            model.series.push({
                label: types[index],
                color: COLORS[index] || `hsl(${Math.round(index * 137.508) % 360} 60% 40%)`
            });
        }

        // 分母は期間ごとの全実績。0時間の種類も件数があれば表に残す。
        for (const bucket of buckets)
        {
            const amounts = new Map();
            const counts = new Map();
            for (const task of bucket.rows)
            {
                amounts.set(task.type, (amounts.get(task.type) || 0) + task.actual);
                counts.set(task.type, (counts.get(task.type) || 0) + 1);
            }
            const values = [];
            for (const type of types)
            {
                const amount = amounts.get(type) || 0;
                const percent = bucket.actual ? amount / bucket.actual * 100 : 0;
                values.push(showPercent ? percent : amount / CONFIG.effortScale);
                if (counts.has(type))
                {
                    model.tableRows.push([
                        bucket.label, type, formatNumber(amount / CONFIG.effortScale),
                        bucket.actual ? formatNumber(percent) : '—', counts.get(type)
                    ]);
                }
            }
            model.values.push(values);
        }
        return model;
    }

    /**
     * 選択中タブに対応するグラフと集計表の値を構築する。
     * @param {Bucket[]} buckets 期間別集計。
     * @param {string} tab hours、types、counts、varianceのいずれか。
     * @param {string[]} types 種類タブの系列順。
     * @param {string} typeMode hoursまたはpercent。
     * @returns {ChartModel} DOMやChart.jsに依存しない描画用データ。
     */
    static chartModel(buckets, tab, types, typeMode)
    {
        if (tab === 'types')
        {
            return AnalysisService.typeChart(buckets, types, typeMode === 'percent');
        }

        const model = { unit: '時間', series: [], values: [], headers: [], tableRows: [], stacked: false };
        if (tab === 'counts')
        {
            model.unit = '件';
            model.series = [{ label: '作業発生回数', color: COLORS[1] }];
            model.headers = ['期間', '件数', '実績工数(h)', '1件当たり工数(h)'];
        }
        else if (tab === 'variance')
        {
            model.series = [
                { label: '予定工数', color: '#9db3cf' },
                { label: '実績工数', color: COLORS[0] }
            ];
            model.headers = ['期間', '予定工数(h)', '実績工数(h)', '差(h)', '差率(%)', '件数'];
        }
        else
        {
            model.series = [{ label: '実績工数', color: COLORS[0] }];
            model.headers = ['期間', '実績工数(h)', '予定工数(h)', '件数'];
        }

        // グラフの数値は生の値、集計表とCSVは従来どおり小数第1位に整形する。
        for (const bucket of buckets)
        {
            const actualHours = bucket.actual / CONFIG.effortScale;
            const plannedHours = bucket.planned / CONFIG.effortScale;
            if (tab === 'counts')
            {
                model.values.push([bucket.count]);
                model.tableRows.push([
                    bucket.label, bucket.count, formatNumber(actualHours),
                    bucket.count ? formatNumber(actualHours / bucket.count) : '—'
                ]);
            }
            else if (tab === 'variance')
            {
                model.values.push([plannedHours, actualHours]);
                model.tableRows.push([
                    bucket.label, formatNumber(plannedHours), formatNumber(actualHours),
                    formatNumber((bucket.actual - bucket.planned) / CONFIG.effortScale),
                    bucket.planned ? formatNumber((bucket.actual - bucket.planned) / bucket.planned * 100) : '—',
                    bucket.count
                ]);
            }
            else
            {
                model.values.push([actualHours]);
                model.tableRows.push([
                    bucket.label, formatNumber(actualHours), formatNumber(plannedHours), bucket.count
                ]);
            }
        }
        return model;
    }
}

// =============================================================================
// グラフ描画：Chart.js固有の設定とインスタンスの寿命をここだけで管理する
// =============================================================================

/** Chart.jsインスタンスを生成し、再描画前に確実に破棄する。 */
class GraphRenderer
{
    /**
     * グラフインスタンスの管理配列を初期化する。
     * @returns {GraphRenderer} 引数なし。新しい描画管理インスタンス。
     */
    constructor()
    {
        /** @type {Object[]} 現在表示中のChart.jsインスタンス。 */
        this.graphs = [];
    }

    /**
     * 表示中のグラフをすべて破棄する。
     * @returns {void} 引数なし。イベント購読とCanvas参照を解放する。
     */
    clear()
    {
        for (const graph of this.graphs)
        {
            graph.destroy();
        }
        this.graphs = [];
    }

    /**
     * 指定要素にCanvasを作成し、棒グラフを描画する。
     * @param {HTMLElement} container .graph要素。
     * @param {Bucket[]} buckets 横軸の項目一覧。
     * @param {ChartModel} model 系列・数値・単位・積み上げ設定。
     * @param {string} period 集計キー。dayの場合のみ横軸ラベルを自動で間引く。
     * @returns {void} CDN未読込・描画失敗時は代替メッセージを表示する。
     */
    draw(container, buckets, model, period)
    {
        if (typeof window.Chart !== 'function')
        {
            container.innerHTML = '<div class="empty">グラフを読み込めません。CDNへの接続を確認して再読込してください。下の集計表は利用できます。</div>';
            return;
        }

        // 全期間を表示領域の幅に収める。期間数による最小幅は設定しない。
        // Chart.jsが親要素の幅に合わせて棒の幅と横軸ラベルを調整する。
        container.style.width = '100%';
        container.style.minWidth = '0';

        const canvas = document.createElement('canvas');
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `棒グラフ（${model.unit}）。数値は下の集計表で確認できます。`);
        container.replaceChildren(canvas);

        // カテゴリ軸に実際の期間名を渡す。仮日付と日付ライブラリは不要。
        const labels = [];
        for (const bucket of buckets)
        {
            labels.push(bucket.label);
        }

        const datasets = [];
        for (let seriesIndex = 0; seriesIndex < model.series.length; seriesIndex++)
        {
            const series = model.series[seriesIndex];
            const values = [];

            for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex++)
            {
                values.push(model.values[bucketIndex][seriesIndex]);
            }

            datasets.push({
                label: series.label,
                data: values,
                backgroundColor: series.color,
                borderColor: series.color,
                borderWidth: 1,

                // 固定幅は指定せず、期間数と表示幅から自動計算する。
                maxBarThickness: 64,
                categoryPercentage: 0.8,
                barPercentage: 0.8
            });
        }

        // 作業種類は積み上げ、予実比較は横並びの棒グラフとする。
        // 構成比は0～100%、件数は整数の目盛り、工数は0始まりにする。
        const options = {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            locale: 'ja-JP',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: tooltipLabel
                    }
                }
            },
            scales: {
                x: {
                    type: 'category',
                    position: 'bottom',
                    stacked: model.stacked,
                    offset: true,
                    grid: {
                        display: false
                    },
                    ticks: {
                        // 標準機能で右上がり45度に固定する。
                        minRotation: 45,
                        maxRotation: 45,
                        align: 'center',
                        crossAlign: 'near',
                        mirror: false,
                        labelOffset: 0,

                        // 日次のみ自動で間引き、それ以外は全項目を表示する。
                        autoSkip: period === 'day',
                        autoSkipPadding: 4,
                        color: '#526780',
                        font: { size: 13 }
                    }
                },
                y: {
                    type: 'linear',
                    stacked: model.stacked,
                    beginAtZero: true,
                    min: 0,
                    title: {
                        display: true,
                        text: model.unit,
                        color: '#526780'
                    },
                    grid: {
                        color: '#eef2f7'
                    },
                    ticks: {
                        color: '#526780',
                        callback: valueLabel
                    }
                }
            }
        };

        if (model.unit === '%')
        {
            options.scales.y.max = 100;
        }

        if (model.unit === '件')
        {
            options.scales.y.ticks.precision = 0;
        }

        // 途中まで生成された場合も含め、失敗したグラフの参照を残さない。
        try
        {
            this.graphs.push(new window.Chart(canvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets
                },
                options
            }));
        }
        catch (error)
        {
            const failedChart = window.Chart.getChart(canvas);
            if (failedChart)
            {
                failedChart.destroy();
            }

            container.innerHTML = '<div class="empty">グラフ描画に失敗しました。集計表をご確認ください。</div>';
            console.error(error);
        }

        /**
         * 縦軸ラベルを整形する。件数は整数の目盛りだけを表示する。
         * @param {number|string} value 目盛りの数値。
         * @returns {string} 表示用文字列。件数の小数目盛りは空文字。
         */
        function valueLabel(value)
        {
            if (model.unit === '件')
            {
                return Number.isInteger(Number(value)) ? String(value) : '';
            }

            return formatNumber(value);
        }

        /**
         * マウスを重ねた棒の系列名・値・単位を表示する。
         * @param {Object} context Chart.jsのTooltipItem。
         * @returns {string} 系列名と単位付きの値。
         */
        function tooltipLabel(context)
        {
            const value = model.unit === '件' ?
                String(context.parsed.y) :
                formatNumber(context.parsed.y);

            return `${context.dataset.label}: ${value} ${model.unit}`;
        }
    }
}

// =============================================================================
// 画面表示：文字列の整形とDOM更新。業務集計やファイル読込は行わない
// =============================================================================

/** カード、説明文、集計表、グラフの外枠を生成する。 */
class DashboardView
{
    /**
     * KPIカード1枚のHTMLを組み立てる。
     * @param {string} label カード名（アプリ定義の文言）。
     * @param {string} value 表示する数値と単位。
     * @param {string} note 補足文。
     * @param {boolean} [isWarning=false] 数値を警告色にするか。
     * @returns {string} カードHTML。
     */
    static card(label, value, note, isWarning = false)
    {
        return `<div class="kpi"><span>${label}</span><strong class="${isWarning ? 'danger' : ''}">${value}</strong><small>${note}</small></div>`;
    }

    /**
     * 予算・実績・残工数など5枚のKPIカードを更新する。
     * @param {BudgetMetrics} metrics 計算済みの消化状況。
     * @returns {void} #kpisと#paceを更新する。
     */
    static renderKpis(metrics)
    {
        const { total, actual, forecast } = metrics;
        const { budget } = metrics.planning;
        const cards = [];

        // 数値・色・補足文の判定は旧版と同じ条件にする。
        cards.push(DashboardView.card(
            '対象データの実績', formatNumber(total.actual / CONFIG.effortScale) + ' h',
            `${total.count.toLocaleString()}件 ／ 予定 ${formatNumber(total.planned / CONFIG.effortScale)} h`
        ));
        cards.push(DashboardView.card(
            '基準日までの消化', actual === null ? '—' : formatNumber(actual) + ' h',
            budget > 0 && actual !== null ? '予算比 ' + formatNumber(actual / budget * 100) + '%' :
                '予算を入力すると消化率を表示'
        ));
        cards.push(DashboardView.card(
            '残り工数', budget > 0 && actual !== null ? formatNumber(budget - actual) + ' h' : '—',
            '期間予算 − 基準日までの実績', budget > 0 && actual > budget
        ));
        cards.push(DashboardView.card(
            '期末の実績見込', forecast === null ? '—' : formatNumber(forecast) + ' h',
            '経過暦日の平均ペースで推計', budget > 0 && forecast > budget
        ));
        cards.push(DashboardView.card(
            '予実差（対象全体）', formatNumber((total.actual - total.planned) / CONFIG.effortScale) + ' h',
            total.planned ? '予定比 ' + formatNumber((total.actual - total.planned) / total.planned * 100) + '%' :
                '予定工数が0のため差率なし',
            total.actual > total.planned
        ));
        getElement('kpis').innerHTML = cards.join('');
        DashboardView.renderPace(metrics);
    }

    /**
     * 計画期間の経過率と予算消化率の比較文を更新する。
     * @param {BudgetMetrics} metrics 計算済みの消化状況。
     * @returns {void} #paceの本文と警告色を更新する。
     */
    static renderPace(metrics)
    {
        const { valid, actual, elapsed, days } = metrics;
        const { start, end, asof, budget } = metrics.planning;
        const element = getElement('pace');
        element.className = 'notice';

        // 計算条件がそろわない場合は、従来の案内を表示する。
        if (!valid)
        {
            element.textContent = '消化状況を算出するには、正しい計画期間と基準日を指定してください。';
        }
        else if (asof < start)
        {
            element.textContent = '基準日が計画開始日前のため、期末見込は算出しません。';
        }
        else if (!(budget > 0))
        {
            element.textContent = '期間予算を入力すると、残り工数と消化ペースを確認できます。';
        }
        else
        {
            const expected = budget * elapsed / days;
            const isOverPace = actual > expected;
            const paceLabel = isOverPace ? '均等消化ペースを超過' : '均等消化ペース以内';
            const periodLabel = asof >= end ? '計画期間終了' : paceLabel;
            element.className = 'notice ' + (isOverPace ? 'warn' : '');
            element.textContent = `計画期間の経過 ${formatNumber(elapsed / days * 100)}% ／ 工数消化 ${formatNumber(actual / budget * 100)}% — ${periodLabel}。均等消化の目安 ${formatNumber(expected)} h、差 ${formatNumber(actual - expected)} h。`;
        }
    }

    /**
     * 集計表のHTMLを生成する。
     * @param {string[]} headers 列見出し。
     * @param {Array<Array<*>>} rows 表に表示する行。
     * @returns {string} エスケープ済みセルを含むスクロール可能な表。
     */
    static table(headers, rows)
    {
        let html = '<div class="table-scroll"><table><thead><tr>';
        for (const heading of headers)
        {
            html += '<th scope="col">' + escapeHtml(heading) + '</th>';
        }
        html += '</tr></thead><tbody>';
        for (const row of rows)
        {
            html += '<tr>';
            for (let index = 0; index < row.length; index++)
            {
                html += `<td${index === 1 ? ' class="wrap"' : ''}>${escapeHtml(row[index])}</td>`;
            }
            html += '</tr>';
        }
        return html + '</tbody></table></div>';
    }

    /**
     * 集計対象が空のときの案内を表示する。
     * @param {boolean} hasData 元データが読み込まれているか。
     * @returns {void} #chartsを更新する。
     */
    static renderEmpty(hasData)
    {
        const title = hasData ? '条件に一致するデータがありません' : 'CSVを読み込んでください';
        const detail = hasData ? '日付・ステータス・完了のみの条件を確認してください。' :
            '「サンプルで試す」から表示を確認できます。';
        getElement('charts').innerHTML = `<div class="empty"><strong>${title}</strong>${detail}</div>`;
    }

    /**
     * 日付条件が不正な場合の画面を表示する。
     * @param {Error} error 検証エラー。
     * @returns {void} グラフ・KPIをクリアし、CSV出力を無効にする。
     */
    static renderConditionError(error)
    {
        getElement('charts').innerHTML = '<div class="empty danger">' + escapeHtml(error.message) + '</div>';
        getElement('kpis').replaceChildren();
        getElement('pace').textContent = '';
        getElement('export').disabled = true;
    }

    /**
     * グラフの見出し・凡例・集計表を画面に追加する。
     * @param {string} period 期間キー、またはroutine・issueの番号別集計キー。
     * @param {Bucket[]} buckets 集計結果。
     * @param {ChartModel} model グラフと集計表のモデル。
     * @returns {HTMLElement} Chart.js用Canvasを配置する.graph要素。
     */
    static appendChartPanel(period, buckets, model)
    {
        // 集計方法に応じた横軸の説明を設定する。
        let description = '横軸：着手予定日';
        if (period === 'quarter')
        {
            description = '実施時期の値ごとに集計';
        }
        else if (period === 'week')
        {
            description = '横軸：週の開始日（月曜日）';
        }
        else if (period === 'all')
        {
            description = '選択条件内の全データ';
        }
        else if (period === 'routine' || period === 'issue')
        {
            description = `横軸：${escapeHtml(COLUMNS[period])} ／ 選択条件内の実績工数（番号空欄を除く）`;
        }

        // ラベルの自動間引きに関する案内は日次だけに表示する。
        if (period === 'day' && buckets.length > 10)
        {
            description += ' ／ 横軸ラベルは表示幅に合わせて間引き（棒はすべて表示）';
        }

        // CSV由来の系列名は、HTMLに挿入する前にエスケープする。
        let legend = '';
        for (const series of model.series)
        {
            legend += `<span><i style="background:${series.color}"></i>${escapeHtml(series.label)}</span>`;
        }

        // グラフ領域・凡例・集計表をまとめて追加する。
        const panel = document.createElement('article');
        panel.className = 'panel';
        panel.innerHTML =
            `<div class="chart-head"><div><h2>${PERIOD_LABELS[period]}</h2>` +
            `<div class="subtle">${description}</div></div><span class="badge">${model.unit}</span></div>` +
            '<div class="chart-scroll"><div class="graph"></div></div>' +
            `<div class="legend">${legend}</div>` +
            `<details><summary>集計値を確認（${model.tableRows.length.toLocaleString()}行）</summary>` +
            DashboardView.table(model.headers, model.tableRows) + '</details>';
        getElement('charts').appendChild(panel);
        return panel.querySelector('.graph');
    }
}

// =============================================================================
// サンプル生成：旧版と同じデータを再現する（実データとは独立）
// =============================================================================

/**
 * 従来版と同じ180日分のサンプルCSVを生成する。
 * @returns {string} 引数なし。BOMを含まないCSVテキスト。
 */
function createSampleCsv()
{
    const rows = [Object.values(COLUMNS)];
    for (let dayIndex = 0; dayIndex < 180; dayIndex++)
    {
        const timestamp = Date.UTC(2026, 3, 1) + dayIndex * CONFIG.millisecondsPerDay;
        if (new Date(timestamp).getUTCDay() === 0)
        {
            continue;
        }

        // 作業種類、取り下げ、一時的な工数増加を含む固定パターンを作る。
        const tasksPerDay = dayIndex % 4 === 0 ? 3 : 1;
        for (let taskIndex = 0; taskIndex < tasksPerDay; taskIndex++)
        {
            const date = new Date(timestamp);
            const routine = (dayIndex + taskIndex) % 4 !== 0 ? String((dayIndex + taskIndex) % 5 + 1) : '';
            const issue = routine ? '' : '4-' + (220 + dayIndex % 8);
            rows.push([
                dayIndex % 19 === 0 ? '取り下げ' : dayIndex > 165 ? '作業中' : '完了',
                routine ? '定例運用 ' + routine : '不具合調査 ' + issue,
                `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`,
                ((dayIndex % 5 + 1) * 0.5).toFixed(1),
                ((dayIndex % 7 + 1) * 0.4 + (dayIndex > 80 && dayIndex < 100 ? 2 : 0)).toFixed(1),
                routine, issue, '2026年度Q' + (date.getUTCMonth() < 6 ? '1' : '2')
            ]);
        }
    }
    return CsvService.stringify(rows);
}

// =============================================================================
// 計画条件の保存：ユーザーが変更した3項目だけをlocalStorageへ保存する
// =============================================================================

/** 計画条件の保存・復元。CSVデータや消化状況の基準日は保存しない。 */
class PlanningSettings
{
    /**
     * 保存済みの計画条件を入力欄に復元する。
     * @returns {Set<string>} 引数なし。復元した項目ID。保存された空欄も含む。
     */
    static restore()
    {
        const restored = new Set();

        try
        {
            for (const id of PLANNING_STORAGE.fields)
            {
                const value = window.localStorage.getItem(
                    PLANNING_STORAGE.prefix + id
                );

                if (value === null)
                {
                    continue;
                }

                // 不正な保存値を復元しない。
                // 空文字は、ユーザーによる意図的なクリアとして復元する。
                if (value !== '')
                {
                    if (id === 'budget')
                    {
                        if (!Number.isFinite(Number(value)) || Number(value) < 0)
                        {
                            continue;
                        }
                    }
                    else
                    {
                        const timestamp = Date.parse(value + 'T00:00:00Z');

                        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
                            !Number.isFinite(timestamp) ||
                            toIsoDate(timestamp) !== value)
                        {
                            continue;
                        }
                    }
                }

                getElement(id).value = value;
                restored.add(id);
            }
        }
        catch (error)
        {
            console.warn('計画条件を復元できませんでした。', error);
        }

        return restored;
    }

    /**
     * 変更された計画条件1項目を保存する。
     * @param {string} id PLANNING_STORAGE.fieldsに定義した入力欄ID。
     * @returns {void} 保存できない環境でも画面操作は継続する。
     */
    static save(id)
    {
        if (!PLANNING_STORAGE.fields.includes(id))
        {
            return;
        }

        try
        {
            // 空文字も保存し、次回のCSV取込で自動補完されることを防ぐ。
            window.localStorage.setItem(
                PLANNING_STORAGE.prefix + id,
                getElement(id).value
            );
        }
        catch (error)
        {
            console.warn('計画条件を保存できませんでした。', error);
        }
    }
}

// =============================================================================
// アプリ制御：共有状態、イベント、取込から再描画までの処理順序
// =============================================================================

/** 画面と各サービスをつなぐ。可変状態はすべてこのクラスで宣言する。 */
class OperationsApp
{
    /**
     * 画面状態と依存する描画管理を初期化する。
     * @returns {OperationsApp} 引数なし。イベント登録はinitialize()で行う。
     */
    constructor()
    {
        /** @type {Task[]} 最後に取込に成功した作業一覧。 */
        this.data = [];
        /** @type {string} 現在の分析タブ。 */
        this.activeTab = 'hours';
        /** @type {Array<Array<*>>} 現在のタブで出力する集計CSVの行。 */
        this.exportRows = [];
        /** @type {string} 取込元のファイル名またはサンプル表示名。 */
        this.fileLabel = '';
        /** @type {number} 非同期取込の世代番号。古い読込完了による上書きを防ぐ。 */
        this.readToken = 0;
        /** @type {HTMLElement[]} タブボタン。initialize()でDOMから取得する。 */
        this.tabs = [];
        /** @type {GraphRenderer} グラフの生成・破棄を担当するオブジェクト。 */
        this.graphRenderer = new GraphRenderer();
        /** @type {Set<string>} 復元済み・手動変更済みの計画項目。自動補完から保護する。 */
        this.planningFields = new Set();
    }

    /**
     * 保存済み条件を復元し、基準日を今日に設定してアプリを起動する。
     * @returns {void} 引数なし。DOM構築後に1回だけ呼ぶ。
     */
    initialize()
    {
        this.tabs = Array.from(document.querySelectorAll('[data-tab]'));
        this.bindEvents();

        // 初回描画の前に、保存された3項目を復元する。
        this.planningFields = PlanningSettings.restore();

        // 基準日は保存値を使用せず、起動時の今日を設定する。
        getElement('asof').value = todayInputValue();

        this.render();
        this.loadGraphLibrary();
    }

    /**
     * CSV、条件変更、タブ、キーボードの各イベントを登録する。
     * @returns {void} 引数なし。各ハンドラーのthisをアプリに固定する。
     */
    bindEvents()
    {
        // ファイル選択とドラッグ＆ドロップ。
        getElement('choose').onclick = this.chooseFile.bind(this);
        getElement('file').onchange = this.onFileChange.bind(this);
        for (const eventName of ['dragenter', 'dragover'])
        {
            getElement('drop').addEventListener(eventName, this.onDragOver.bind(this));
        }
        getElement('drop').addEventListener('dragleave', this.onDragLeave.bind(this));
        getElement('drop').addEventListener('drop', this.onDrop.bind(this));
        window.addEventListener('dragover', this.preventDefaultDrop.bind(this));
        window.addEventListener('drop', this.preventDefaultDrop.bind(this));

        // 集計条件・サンプル・出力。
        getElement('demo').onclick = this.showSample.bind(this);
        getElement('sampleDownload').onclick = this.downloadSample.bind(this);
        getElement('reset').onclick = this.resetFilters.bind(this);
        getElement('export').onclick = this.exportSummary.bind(this);
        for (const id of FILTER_CONTROL_IDS)
        {
            getElement(id).addEventListener('change', this.onConditionChange.bind(this, id));
        }

        // タブは左右矢印・Home・Endでも移動できる。
        for (let index = 0; index < this.tabs.length; index++)
        {
            const button = this.tabs[index];
            button.tabIndex = index === 0 ? 0 : -1;
            button.onclick = this.switchTab.bind(this, button);
            button.onkeydown = this.onTabKeydown.bind(this, index);
        }
    }

    /**
     * ファイル選択ダイアログを開く。
     * @returns {void} 引数なし。
     */
    chooseFile()
    {
        getElement('file').click();
    }

    /**
     * 選択ファイルを読み、同じファイルも再選択できるようinputを戻す。
     * @param {Event} event ファイル入力のchangeイベント。
     * @returns {void} 読込は非同期で進み、readFile内でエラーを処理する。
     */
    onFileChange(event)
    {
        this.readFile(event.target.files[0]);
        event.target.value = '';
    }

    /**
     * ドロップ可能領域を強調表示する。
     * @param {DragEvent} event dragenterまたはdragoverイベント。
     * @returns {void} ブラウザの標準処理を抑止する。
     */
    onDragOver(event)
    {
        event.preventDefault();
        getElement('drop').classList.add('over');
    }

    /**
     * ドロップ領域の強調を解除する。
     * @returns {void} 引数なし。
     */
    onDragLeave()
    {
        getElement('drop').classList.remove('over');
    }

    /**
     * ファイルのドロップでページが遷移する標準動作を抑止する。
     * @param {DragEvent} event ウィンドウのドラッグイベント。
     * @returns {void} 取込処理は行わない。
     */
    preventDefaultDrop(event)
    {
        event.preventDefault();
    }

    /**
     * ドロップされたファイルが1つであることを確認して読み込む。
     * @param {DragEvent} event dropイベント。
     * @returns {void} 複数ファイルの場合は現データを保持して警告する。
     */
    onDrop(event)
    {
        event.preventDefault();
        this.onDragLeave();
        if (event.dataTransfer.files.length !== 1)
        {
            getElement('message').className = 'notice error';
            getElement('message').textContent = 'CSVは1ファイルずつ投入してください。';
            return;
        }
        this.readFile(event.dataTransfer.files[0]);
    }

    /**
     * 集計条件の変更を保存・画面表示に反映する。
     * @param {string} id 変更された入力欄のID。
     * @returns {void} 保存対象の計画項目だけをlocalStorageへ記憶する。
     */
    onConditionChange(id)
    {
        // 保存失敗時も、現在の画面で手動入力した条件は自動補完から保護する。
        if (PLANNING_STORAGE.fields.includes(id))
        {
            this.planningFields.add(id);
            PlanningSettings.save(id);
        }

        // 取り下げを明示選択した場合は、除外チェックも同期する。
        if (id === 'status' && getElement('status').value === '取り下げ')
        {
            getElement('withdraw').checked = true;
        }

        this.render();
    }

    /**
     * 日付・ステータスの集計条件だけを初期値に戻す。
     * @returns {void} 引数なし。予算・タブ・完了のみ条件は維持する。
     */
    resetFilters()
    {
        this.clearFilterInputs();
        this.render();
    }

    /**
     * 日付・ステータス・取り下げの入力値をリセットする。
     * @returns {void} 引数なし。再描画は呼出元に任せる。
     */
    clearFilterInputs()
    {
        getElement('from').value = '';
        getElement('to').value = '';
        getElement('status').value = '';
        getElement('withdraw').checked = false;
    }

    /**
     * 分析タブを切り替え、ARIA属性とキーボードのフォーカス順を更新する。
     * @param {HTMLElement} button 選択するタブボタン。
     * @returns {void} グラフを再描画する。
     */
    switchTab(button)
    {
        this.activeTab = button.dataset.tab;
        for (const tabButton of this.tabs)
        {
            const selected = tabButton === button;
            tabButton.setAttribute('aria-selected', String(selected));
            tabButton.tabIndex = selected ? 0 : -1;
        }
        this.render();
    }

    /**
     * タブの左右矢印・Home・Endキー操作を処理する。
     * @param {number} index 現在のタブ番号。
     * @param {KeyboardEvent} event keydownイベント。
     * @returns {void} 対応キー以外は何もしない。
     */
    onTabKeydown(index, event)
    {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
        {
            return;
        }
        event.preventDefault();
        let nextIndex;
        if (event.key === 'Home')
        {
            nextIndex = 0;
        }
        else if (event.key === 'End')
        {
            nextIndex = this.tabs.length - 1;
        }
        else
        {
            const direction = event.key === 'ArrowRight' ? 1 : -1;
            nextIndex = (index + direction + this.tabs.length) % this.tabs.length;
        }
        this.tabs[nextIndex].focus();
        this.switchTab(this.tabs[nextIndex]);
    }

    /**
     * 画面の集計条件を読み取る。
     * @returns {FilterConditions} 引数なし。作業フィルターへ渡す条件。
     */
    readFilters()
    {
        return {
            from: readDateInput('from'),
            to: readDateInput('to'),
            status: getElement('status').value,
            includeWithdrawn: getElement('withdraw').checked
        };
    }

    /**
     * 画面の計画条件を読み取る。
     * @returns {PlanningConditions} 引数なし。予算計算へ渡す条件。
     */
    readPlanning()
    {
        return {
            start: readDateInput('planStart'),
            end: readDateInput('planEnd'),
            asof: readDateInput('asof'),
            budget: Number(getElement('budget').value)
        };
    }

    /**
     * 現在の状態からKPI・グラフ・集計表・出力用CSVを再生成する。
     * @returns {void} 引数なし。日付条件エラーは画面に表示して終了する。
     */
    render()
    {
        // 前のグラフを破棄してから、同じ画面領域を再利用する。
        this.graphRenderer.clear();
        getElement('charts').replaceChildren();
        this.exportRows = [];
        getElement('typeModeWrap').hidden = this.activeTab !== 'types';
        getElement('completedWrap').hidden = this.activeTab !== 'variance';
        getElement('charts').setAttribute('aria-labelledby', 'tab-' + this.activeTab);

        let rows;
        try
        {
            rows = AnalysisService.filter(this.data, this.readFilters());
        }
        catch (error)
        {
            DashboardView.renderConditionError(error);
            return;
        }

        // KPIはタブ固有の「完了のみ」に連動しないという従来仕様を維持する。
        DashboardView.renderKpis(AnalysisService.budgetMetrics(rows, this.readPlanning()));
        if (this.activeTab === 'variance' && getElement('completed').checked)
        {
            rows = rows.filter(isCompletedTask);
        }
        getElement('scope').textContent = this.data.length ?
            `${this.fileLabel} ｜ 読込 ${this.data.length.toLocaleString()}件 ／ この表示 ${rows.length.toLocaleString()}件 ｜ 日次・週次：着手予定日基準` :
            'データ未読込';
        getElement('export').disabled = !rows.length;
        if (!rows.length)
        {
            DashboardView.renderEmpty(this.data.length > 0);
            return;
        }

        // 種類タブの先頭に番号別の実績工数を追加する。割合表示の切替には連動しない。
        if (this.activeTab === 'types')
        {
            for (const field of ['routine', 'issue'])
            {
                // 上部の集計期間・ステータス条件を適用した作業を番号別に集計する。
                const buckets = AnalysisService.numberBuckets(rows, field);
                const model = AnalysisService.chartModel(buckets, 'hours', [], 'hours');
                model.headers[0] = COLUMNS[field];
                const container = DashboardView.appendChartPanel(field, buckets, model);

                // 対象番号がある場合は描画し、ない場合は案内を表示する。
                if (buckets.length)
                {
                    this.graphRenderer.draw(container, buckets, model, field);
                }
                else
                {
                    container.innerHTML = '<div class="empty">選択条件内に番号が設定された作業はありません。</div>';
                }

                // 画面の集計表と同じ内容を、既存の集計CSV保存にも含める。
                this.exportRows.push([PERIOD_LABELS[field]], model.headers, ...model.tableRows, []);
            }
        }

        // 期間ごとのモデルを、グラフ・表・CSVで共用する。
        const periods = this.activeTab === 'hours' ? ['quarter', 'week', 'day'] : ['all', 'quarter', 'week', 'day'];
        const types = AnalysisService.sortedTypes(rows);
        for (const period of periods)
        {
            const buckets = AnalysisService.buckets(rows, period);
            if (!buckets.length)
            {
                continue;
            }
            const model = AnalysisService.chartModel(buckets, this.activeTab, types, getElement('typeMode').value);
            const container = DashboardView.appendChartPanel(period, buckets, model);
            this.graphRenderer.draw(container, buckets, model, period);
            this.exportRows.push([PERIOD_LABELS[period]], model.headers, ...model.tableRows, []);
        }

        /**
         * 予実比較で完了済み作業だけを選ぶ。
         * @param {Task} task 対象作業。
         * @returns {boolean} ステータスが完了ならtrue。
         */
        function isCompletedTask(task)
        {
            return task.status === '完了';
        }
    }

    /**
     * CSVを検証し、成功したときだけ現在のデータを置き換える。
     * @param {string} text CSV全文。
     * @param {string} label ファイル名またはサンプル表示名。
     * @returns {void} 集計条件をリセットし、未設定の計画条件だけを補完する。
     * @throws {Error} 入力検証エラー。呼出元でメッセージを表示する。
     */
    load(text, label)
    {
        const parsed = CsvService.normalize(text);

        // normalizeが成功するまでは前回のデータを変更しない。
        this.data = parsed.rows;
        this.fileLabel = label;

        // 保存・手動入力のない項目だけ、CSVから初期値を補完する。
        if (!this.planningFields.has('planStart'))
        {
            getElement('planStart').value = Number.isFinite(parsed.min) ?
                toIsoDate(parsed.min) : '';
        }

        if (!this.planningFields.has('planEnd'))
        {
            getElement('planEnd').value = Number.isFinite(parsed.max) ?
                toIsoDate(parsed.max) : '';
        }

        if (!this.planningFields.has('budget'))
        {
            getElement('budget').value = '';
        }

        // 基準日は変更しない。起動時の今日、またはユーザーの指定日を維持する。
        this.clearFilterInputs();

        getElement('message').className =
            'notice ' + (parsed.warnings.length ? 'warn' : '');

        getElement('message').textContent =
            `${label}：${this.data.length.toLocaleString()}件を読み込みました。` +
            (parsed.warnings.length ? '\n' + parsed.warnings.join(' ／ ') : '');

        this.render();
    }

    /**
     * Fileを非同期読込し、文字コード変換とCSV検証を実行する。
     * @param {File|undefined} file 選択またはドロップされたファイル。
     * @returns {Promise<void>} 処理完了。不正入力はrejectせず画面に表示する。
     */
    async readFile(file)
    {
        const token = ++this.readToken;
        try
        {
            if (!file)
            {
                return;
            }
            if (file.size > CONFIG.maxBytes)
            {
                throw Error('CSVは30MB以下にしてください');
            }
            getElement('message').className = 'notice';
            getElement('message').textContent = 'CSVを読み込み中…';
            const buffer = await file.arrayBuffer();

            // 後から選ばれたファイルやサンプルを古い完了通知で上書きしない。
            if (token !== this.readToken)
            {
                return;
            }
            const text = CsvService.decode(buffer, getElement('encoding').value);
            this.load(text, file.name);
        }
        catch (error)
        {
            if (token !== this.readToken)
            {
                return;
            }
            getElement('message').className = 'notice error';
            getElement('message').textContent = error.message + '\n' +
                (this.data.length ? '表示中のデータは前回の読込結果です。' : 'CSVを修正して読み直してください。');
        }
    }

    /**
     * サンプルデータを表示し、未設定の場合だけサンプル予算を補完する。
     * @returns {void} 引数なし。進行中のファイル読込結果を無効にする。
     */
    showSample()
    {
        this.readToken++;
        this.load(createSampleCsv(), 'サンプルデータ');

        // 復元・手動入力した予算と基準日は維持する。
        if (!this.planningFields.has('budget'))
        {
            getElement('budget').value = CONFIG.demoBudget;
        }

        this.render();
    }

    /**
     * サンプルCSVを保存する。
     * @returns {void} 引数なし。現在の読込データを変更しない。
     */
    downloadSample()
    {
        CsvService.download('sample-operations.csv', createSampleCsv());
    }

    /**
     * 現在のタブの集計結果を、使用条件付きCSVとして保存する。
     * @returns {void} 引数なし。列構成、行順、ファイル名は旧版と同じ。
     */
    exportSummary()
    {
        const rows = [
            ['元ファイル', this.fileLabel],
            ['集計開始日', getElement('from').value || '指定なし'],
            ['集計終了日', getElement('to').value || '指定なし'],
            ['ステータス', getElement('status').value || 'すべて'],
            ['取り下げを含む', getElement('withdraw').checked ? 'はい' : 'いいえ'],
            ['完了のみ', this.activeTab === 'variance' && getElement('completed').checked ? 'はい' : 'いいえ'],
            [], ...this.exportRows
        ];
        CsvService.download('operations-summary-' + this.activeTab + '.csv', CsvService.stringify(rows));
    }

    /**
     * CDNからChart.jsを読み込み、成功・失敗時に表示を更新する。
     * @returns {void} 引数なし。CSVデータを送信する処理は含まない。
     */
    loadGraphLibrary()
    {
        const script = document.createElement('script');
        script.src = CONFIG.graphScriptUrl;
        script.onload = this.onGraphLibraryLoaded.bind(this);
        script.onerror = this.onGraphLibraryError.bind(this);
        document.head.appendChild(script);
    }

    /**
     * CDNスクリプトの読込完了を処理する。
     * @returns {void} 引数なし。Chart.jsの公開有無を確認して再描画する。
     */
    onGraphLibraryLoaded()
    {
        getElement('cdn').textContent = '';
        if (typeof window.Chart !== 'function')
        {
            getElement('cdn').textContent =
                'Chart.jsを利用できません。CDNの公開内容をご確認ください。';
        }
        this.render();
    }

    /**
     * CDNスクリプトの読込失敗を通知する。
     * @returns {void} 引数なし。CSV取込・集計表は利用できる状態にする。
     */
    onGraphLibraryError()
    {
        getElement('cdn').textContent = 'グラフライブラリを読み込めません。ネットワークとCDNへの接続を確認してください。CSV取込・集計表は利用できます。';
        this.render();
    }
}

// =============================================================================
// 起動：グローバル変数の宣言は冒頭で済ませ、ここでは初期化のみ行う
// =============================================================================

application = new OperationsApp();
application.initialize();