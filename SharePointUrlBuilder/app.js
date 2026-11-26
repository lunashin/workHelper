'use strict';
/**
 * SharePoint URLビルダーの初期化。
 * config.js → 本ファイルの順にdeferで読み込む。
 * 即時実行関数内に変数を閉じ込め、グローバル名前空間の衝突を防ぐ。
 * @returns {void}
 */
(() => {

  // 保存スキーマのバージョンを含むlocalStorageのキー。
  const KEY = 'sharepoint-url-builder.v1';

  // 保存件数の上限。超過した古い履歴はrecord()で切り捨てる。
  const MAX_HISTORY = 200;
  const MATCH_LABELS = { Eq: '一致', Contains: '含む', BeginsWith: '始まる' };

  // 履歴の削除演出時間（ミリ秒）と、二重削除・途中再描画を防ぐ処理中フラグ。
  const HISTORY_DELETE_DURATION = 500;
  let historyDeleting = false;

  /**
   * IDから画面要素を取得する。
   *
   * @param {string} id - index.htmlで定義した要素ID。
   * @returns {HTMLElement|null} 対象要素。
   */
  const $ = id => document.getElementById(id);

  // config.jsから受け取る共通設定。実行中は変更しない。
  const config = window.SP_URL_CONFIG;

  /**
   * 保存対象のJSON互換データを複製し、履歴と現在値の参照を分離する。
   *
   * @param {*} value - JSONとして保存できる値。
   * @returns {*} 深いコピー。
   */
  const clone = value => JSON.parse(JSON.stringify(value));

  /**
   * 操作結果を画面の通知領域に表示する。
   *
   * @param {string} message - 表示するメッセージ。
   * @returns {void}
   */
  const notify = message => {
    $('message').textContent = message;
  };

  /**
   * 検証を中断し、呼び出し側のcatchへエラーを渡す。
   *
   * @param {string} message - エラーの説明。
   * @throws {Error} 常に例外を送出する。
   * @returns {never}
   */
  function fail(message) {
    throw new Error(message);
  }

  /**
   * 配列以外のオブジェクトかを判定する。
   *
   * @param {*} value - 判定対象。
   * @returns {*} オブジェクトならtrue。偽の場合はfalseまたは元のfalsy値。
   */
  const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

  /**
   * 外部入力の文字列・長さ・制御文字を検証する。
   *
   * @param {*} value - 検証対象。
   * @param {number} [max=2000] - 文字列長の上限（UTF-16単位）。
   * @returns {string} 検証済みの文字列。
   * @throws {Error} 形式が不正な場合。
   */
  function text(value, max = 2000) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)) {
      fail('文字列の形式または長さが不正です。');
    }
    return value;
  }

  /**
   * 相対パスを検証し、階層区切りを保って各セグメントをエンコードする。
   *
   * @param {string} value - 未エンコードの相対パス。
   * @returns {string} URL用の相対パス。
   * @throws {Error} 空の階層、親階層参照、予約文字などを含む場合。
   */
  function path(value) {
    text(value);
    if (!value || /[?#%\\]/.test(value) || value.split('/').some(p => !p || p === '.' || p ===
        '..')) {
      fail('設定のパスは未エンコードの相対パスにしてください。');
    }
    return value.split('/').map(encodeURIComponent).join('/');
  }

  /**
   * リストの表示ページを取得する。未指定・null・空文字は従来の既定値を使う。
   * @param {Object} list - listTypesの設定要素。
   * @returns {Array<Object>} ビューID・表示名・未エンコードのfilenameの一覧。
   */
  function getViews(list) {
    const value = list.viewPage;
    if (value == null || value === '') {
      return [{ key: '', name: '', filename: 'AllItems.aspx' }];
    }
    // 旧設定の単一ページ文字列も読み込む。
    const views = typeof value === 'string'
      ? [{ key: '', name: '', filename: value }]
      : Object.entries(value).map(([key, view]) => {
          if (!isObject(view) || !key) fail('viewPageはビューIDをキーとする辞書にしてください。');
          text(view.name);
          if (!view.name) fail('ビュー名を指定してください。');
          return { key, name: view.name, filename: view.filename };
        });
    if (!views.length || Array.isArray(value)) fail('viewPageに1件以上のビューを定義してください。');
    for (const view of views) {
      text(view.filename);
      path(view.filename);
      if (!/\.aspx$/i.test(view.filename)) fail('filenameには.aspxで終わるページ名を指定してください。');
    }
    return views;
  }

  /** 保存されたビューIDを解決する。旧データ・削除済みIDは先頭ビューへ移行する。 */
  function getView(list, key) {
    const views = getViews(list);
    return views.find(view => view.key === key) ?? views[0];
  }

  function getViewPage(list, key) {
    return getView(list, key).filename;
  }

  /** リストとビューの組ごとに選択ボタンを用意する。 */
  function listOptions(department) {
    return getLists(department).flatMap(list => getViews(list).map(view => ({
      id: JSON.stringify([list.id, view.key]),
      listId: list.id,
      viewKey: view.key,
      name: list.name,
      viewName: view.name
    })));
  }

  function selectedListOption(state) {
    return JSON.stringify([state.listType, state.viewKey]);
  }

  /**
   * リストの所属部門・使用可能フィルタの参照を検証する。
   * @returns {void}
   */
  function validateListRelations() {
    const departments = new Set(config.departments.map(d => d.id));
    const filters = new Set(config.filters.map(f => f.key));
    for (const list of config.listTypes) {
      getViewPage(list);
      for (const [field, valid] of [['departmentIds', departments], ['filterKeys', filters]]) {
        const values = list[field];
        if (!Array.isArray(values) || new Set(values).size !== values.length ||
            values.some(value => !valid.has(value))) {
          fail('リスト「' + list.name + '」の' + field + 'を確認してください。');
        }
      }
    }
  }

  /** @param {string} departmentId - 部門ID。 @returns {Array<Object>} 所属リストの候補。 */
  function getLists(departmentId) {
    return config.listTypes.filter(list => list.departmentIds.includes(departmentId));
  }

  /** @param {Object} state - 選択状態。 @returns {Array<Object>} 現在のリストで有効な一般フィルタ。 */
  function activeFilters(state) {
    const list = getLists(state.department).find(item => item.id === state.listType);
    return list ? list.filterKeys.map(key => config.filters.find(f => f.key === key)) : [];
  }

  /** @param {Object} state - 選択状態。 @returns {Array<Object>} URLに使うグループと有効フィルタ。 */
  function queryAttributes(state) {
    return activeFilters(state);
  }

  /** @param {Object} state - 選択状態。 @param {string} key - 属性キー。 @returns {Object} 選択値。 */
  function selection(state, key) {
    return state.filters[key];
  }

  /** @param {Object} state - 更新対象。 @param {string} key - 属性キー。 @param {Object} value - 選択値。 @returns {void} */
  function setSelection(state, key, value) {
    state.filters[key] = value;
  }

  /**
   * 部門・リストの連動を正規化する。使用不可になった条件は指定なしへ戻す。
   * @param {Object} state - 更新対象の選択状態。
   * @param {boolean} [departmentChanged=false] - 部門変更なら自由入力グループも照合する。
   * @returns {void}
   */
  function normalizeCurrent(state) {
    const lists = getLists(state.department);
    if (!lists.some(list => list.id === state.listType)) {
      state.listType = lists[0]?.id ?? null;
    }
    const list = lists.find(item => item.id === state.listType);
    state.viewKey = list ? getView(list, state.viewKey).key : '';
    const active = new Set(activeFilters(state).map(f => f.key));
    for (const f of config.filters) {
      const selected = state.filters[f.key];
      const unavailable = selected?.mode === 'preset' &&
        !getOptions(f, state.department).some(option => option.id === selected.value);
      if (!active.has(f.key) || unavailable) {
        state.filters[f.key] = { mode: 'none', value: '' };
      }
    }
    state.matches ??= {};
    for (const key of Object.keys(state.matches)) {
      if (!active.has(key)) delete state.matches[key];
    }
    if (state.sort && !active.has(state.sort.key)) {
      state.sort = null;
    }
  }

  /**
   * config.jsの設定値とIDの一意性を起動時に検証する。
   *
   * @returns {void}
   * @throws {Error} ベースURL・属性・候補の設定が不正な場合。
   */
  function validateConfig() {
    if (!isObject(config) || !Array.isArray(config.baseUrls) || config.baseUrls.length !== 1) {
      fail('config.js の baseUrls に1つのベースURLを設定してください。');
    }

    // HTTP(S)のベースURLだけを許可し、クエリや認証情報の混入を防ぐ。
    const base = new URL(config.baseUrls[0].id);
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      fail('ベースURLはクエリ・認証情報なしのHTTP(S) URLにしてください。');
    }

    // 部門とリストの候補を検証する。IDの一意性は各属性内で判定する。
    for (const items of [config.departments, config.listTypes]) {
      if (!Array.isArray(items) || !items.length) {
        fail('部門・リスト種類の候補が必要です。');
      }
      const ids = new Set();
      for (const item of items) {
        text(item.name);
        // 部門IDはパス、リストIDは保存・選択用の識別子として個別に検証する。
        text(item.id);
        if (items === config.departments) {
          // TOPサイトを表す空IDも、後続の重複チェックの対象にする。
          if (item.id !== '') path(item.id);
        } else {
          if (!item.id.trim()) fail('リストのidには空でない識別子を指定してください。');
          // idへのフォールバックは行わず、URLには必ずpathを使用する。
          if (typeof item.path !== 'string' || !item.path) {
            fail('リスト「' + item.name + '」のpathに相対パスを指定してください。');
          }
          path(item.path);
        }
        if (ids.has(item.id)) {
          fail('設定IDが重複しています。');
        }
        ids.add(item.id);
      }
    }
    if (!Array.isArray(config.filters)) {
      fail('filtersを配列で設定してください（0件でも構いません）。');
    }

    // フィルタは保存キーとSharePoint列内部名の両方を一意にする。
    const keys = new Set(),
      columns = new Set();
    for (const f of config.filters) {
      if (!/^[a-z][a-z0-9_]*$/i.test(f.key) || keys.has(f.key) || columns.has(f.id) ||
          ['department', 'listType', 'constructor', 'prototype'].includes(f.key)) {
        fail('フィルタキー・内部名を一意にしてください。');
      }
      keys.add(f.key);
      columns.add(f.id);
      text(f.name);
      text(f.id);
      if (!f.id || !Array.isArray(f.options)) {
        fail('フィルタ設定が不正です。');
      }
      const ids = new Set();
      for (const o of f.options) {
        text(o.name);
        text(o.id);
        if (!o.id || ids.has(o.id)) {
          fail('候補値が空または重複しています。');
        }
        ids.add(o.id);
      }
    }
  }

  // 不正な設定では操作を停止し、原因を通知する。
  try {
    validateConfig();
    validateOptionDepartments();
    validateListRelations();
  } catch (error) {
    notify('設定エラー：' + error.message);
    document.querySelectorAll('button').forEach(b => b.disabled = true);
    return;
  }

  /** フィルター候補の所属部門を検証する。省略した候補は全部門共通。 */
  function validateOptionDepartments() {
    const departments = new Set(config.departments.map(department => department.id));
    for (const filter of config.filters) {
      for (const option of filter.options) {
        if (option.departmentId !== undefined && !departments.has(option.departmentId)) {
          fail('候補「' + option.name + '」のdepartmentIdを確認してください。');
        }
      }
    }
  }

  /** 部門専用候補と全部門共通候補を定義順に返す。空文字はTOP部門。 */
  function getOptions(attribute, departmentId) {
    return attribute.options.filter(option =>
      option.departmentId === undefined || option.departmentId === departmentId);
  }

  /**
   * 初期選択状態を新規作成する。部門とリストは先頭候補を使用する。
   *
   * @returns {Object} 全フィルタが指定なし、エンコードありの状態。
   */
  function defaults() {
    return {
      department: config.departments[0].id,
      listType: getLists(config.departments[0].id)[0]?.id ?? null,
      viewKey: getLists(config.departments[0].id)[0] ? getViews(getLists(config.departments[0].id)[0])[0].key : '',
      encode: true,
      matches: {},
      sort: null,
      filters: Object.fromEntries(config.filters.map(f => [f.key, {
        mode: 'none',
        value: ''
      }]))
    };
  }

  // ファイルやlocalStorageからの入力はホワイトリストで再構築する。

  /**
   * 選択状態を現在の設定と照合し、許可した項目だけで再構築する。
   *
   * @param {Object} value - 保存データまたはインポート内の選択状態。
   * @returns {Object} 検証済みの新しい選択状態。
   * @throws {Error} 不正形式や現在の設定にないIDを検出した場合。
   */
  function validateState(value) {
    if (!isObject(value) || typeof value.encode !== 'boolean' || !isObject(value.filters)) {
      fail('選択状態の形式が不正です。');
    }
    if (!config.departments.some(o => o.id === value.department) || (value.listType !== null && !config.listTypes.some(o => o.id === value.listType))) {
      fail('部門またはリスト種類が現在のconfig.jsに存在しません。');
    }
    const result = {
      department: value.department,
      listType: value.listType,
      viewKey: text(value.viewKey ?? ''),
      encode: value.encode,
      filters: {},
      matches: {},
      sort: null
    };
    for (const f of config.filters) {
      // 設定に追加したフィルタは、旧保存データに存在しなければ指定なしで補完。
      // 設定から削除したフィルタは、この再構築の対象外となる。
      const v = Object.prototype.hasOwnProperty.call(value.filters, f.key)
        ? value.filters[f.key] : { mode: 'none', value: '' };
      if (!isObject(v) || !['none', 'preset', 'custom'].includes(v.mode)) {
        fail('フィルタの形式が不正です。');
      }
      text(v.value);
      if (v.mode === 'preset' && !f.options.some(o => o.id === v.value)) {
        fail('履歴の候補値が現在のconfig.jsに存在しません。');
      }
      setSelection(result, f.key, {
        mode: v.mode,
        value: v.mode === 'none' ? '' : v.value
      });
    }
    if (value.matches !== undefined && !isObject(value.matches)) {
      fail('一致方法の形式が不正です。');
    }
    const attributes = config.filters;
    for (const f of attributes) {
      const operator = value.matches?.[f.key] ?? 'Eq';
      if (!Object.prototype.hasOwnProperty.call(MATCH_LABELS, operator)) {
        fail('一致方法が不正です。');
      }
      result.matches[f.key] = operator;
    }
    if (value.sort != null) {
      if (!isObject(value.sort) || !['Desc', 'Asc'].includes(value.sort.direction)) {
        fail('ソート条件の形式が不正です。');
      }
      if (attributes.some(f => f.key === value.sort.key)) {
        result.sort = { key: value.sort.key, direction: value.sort.direction };
      }
    }
    return result;
  }

  /**
   * 保存データ全体と履歴を検証する。入力オブジェクトは直接採用しない。
   *
   * @param {Object} data - JSONから読み込んだ保存データ。
   * @returns {Object} 検証済みの現在値と履歴。
   * @throws {Error} バージョン、件数、URL、選択状態などが不正な場合。
   */
  function validateData(data) {
    if (!isObject(data) || data.app !== 'sharepoint-url-builder' || ![1, 2].includes(data.version) || !Array
      .isArray(data.history) || data.history.length > MAX_HISTORY) {
      fail('対応するエクスポートファイルではありません。');
    }
    return {
      app: data.app,
      version: 2,
      current: validateState(data.current),
      history: data.history.map(h => {
        if (!isObject(h) || !['copy', 'open'].includes(h.action) || typeof h.time !==
          'string' || !Number.isFinite(Date.parse(h.time))) {
          fail('履歴の形式が不正です。');
        }
        text(h.url, 20000);
        const url = new URL(h.url);
        if (!['http:', 'https:'].includes(url.protocol)) {
          fail('履歴URLが不正です。');
        }
        return {
          time: h.time,
          action: h.action,
          url: h.url,
          state: validateState(h.state)
        };
      })
    };
  }

  // アプリ全体の可変状態。currentとhistoryをまとめて保存・入出力する。

  // current: department / listType / viewKey / encode / filters / matches / sort。

  // filtersの各値: { mode: 'none'|'preset'|'custom', value: string }。

  // historyの各項目: { action, url, state, time: ISO日時 }。
  let data = {
    app: 'sharepoint-url-builder',
    version: 2,
    current: defaults(),
    history: []
  };

  // 起動時だけ保存データを読む。復元失敗時は初期値を残し、警告する。
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      data = validateData(JSON.parse(saved));
      normalizeCurrent(data.current);
    }
  } catch (error) {
    $('storageWarning').hidden = false;
    $('storageWarning').textContent = '保存データを復元できません：' + error.message +
      ' 設定変更後は対応する設定JSに戻して再読み込みしてください。操作すると現在の内容で保存されます。';
  }

  /**
   * 現在の状態と履歴をlocalStorageへ保存する。失敗時は警告を表示する。
   *
   * @returns {boolean} 保存成功時true、容量制限やアクセス制限などで失敗時false。
   */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      $('storageWarning').hidden = true;
      return true;
    } catch (_) {
      $('storageWarning').hidden = false;
      $('storageWarning').textContent = 'localStorageに保存できません。この画面では利用できますが、閉じる前にエクスポートしてください。';
      return false;
    }
  }

  /**
   * 選択状態とリストごとの表示ページからURLを組み立てる。通信は行わない。
   *
   * @param {Object} state - 検証済みの選択状態。
   * @returns {string} 指定条件だけを連番で含むURL。
   * @throws {Error} パスやエンコード対象が不正な場合。
   */
  function buildURL(state) {
    const list = getLists(state.department).find(item => item.id === state.listType);
    if (!list) {
      fail('この部門で利用できるリスト種類がありません。');
    }
    const base = new URL(config.baseUrls[0].id).href.replace(/\/+$/, '');
    // 空の部門IDでは階層自体を省略し、余分なスラッシュを挿入しない。
    const departmentPath = state.department === '' ? '' : '/' + path(state.department);
    // listTypeは識別子。URL用の相対パスは選択された設定のpathから取得する。
    const target = base + departmentPath + '/' + path(list.path) +
      '/' + path(getViewPage(list, state.viewKey));

    // クエリの組と連番カウンタ。未指定の条件には番号を割り当てない。
    const pairs = [];
    let n = 0;

    /**
     * クエリの値だけを選択されたエンコード方針で変換する。
     * @param {string} value - 列内部名またはフィルタ値。
     * @returns {string} クエリへ挿入する文字列。
     */
    const enc = value => state.encode ? encodeURIComponent(value) : value;
    for (const f of queryAttributes(state)) {
      const v = selection(state, f.key);
      if (v.mode === 'none' || v.value === '') {
        continue;
      }
      n++;
      pairs.push('FilterField' + n + '=' + enc(f.id), 'FilterValue' + n + '=' + enc(v.value));
      const operator = state.matches?.[f.key] ?? 'Eq';
      if (operator !== 'Eq') pairs.push('FilterOp' + n + '=' + operator);
    }
    const sortAttribute = queryAttributes(state).find(f => f.key === state.sort?.key);
    if (sortAttribute) {
      pairs.push('SortField=' + enc(sortAttribute.id), 'SortDir=' + state.sort.direction);
    }
    return target + (pairs.length ? '?' + pairs.join('&') : '');
  }

  /**
   * 部門・リスト・有効なフィルタを人が読める表示名で要約する。
   *
   * @param {Object} state - 現在の設定に対応する選択状態。
   * @returns {string} スラッシュで区切った条件の説明。
   */
  function description(state) {
    const parts = [config.departments.find(o => o.id === state.department).name, config.listTypes
      .find(o => o.id === state.listType)?.name ?? 'リストなし'
    ];
    const list = config.listTypes.find(item => item.id === state.listType);
    if (list && getView(list, state.viewKey).name) parts[1] += '（' + getView(list, state.viewKey).name + '）';
    for (const f of queryAttributes(state)) {
      const v = selection(state, f.key);
      if (v.mode !== 'none' && v.value !== '') {
        parts.push(f.name + '：' + (v.mode === 'preset' ? f
          .options.find(o => o.id === v.value).name : v.value) +
          '（' + MATCH_LABELS[state.matches?.[f.key] ?? 'Eq'] + '）');
      }
    }
    const sorted = queryAttributes(state).find(f => f.key === state.sort?.key);
    if (sorted) parts.push('ソート：' + sorted.name + '・' + (state.sort.direction === 'Desc' ? '降順' : '昇順'));
    return parts.join(' / ');
  }

  /**
   * 表示名とクリック処理を持つボタンを生成する。
   *
   * @param {string} label - ボタンに表示する文字列。
   * @param {Function} action - クリック時の処理。
   * @param {boolean} [selected] - 指定時のみ選択状態をaria-pressedへ反映。
   * @returns {HTMLButtonElement} 未配置のボタン要素。
   */
  function button(label, action, selected) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (selected !== undefined) {
      b.setAttribute('aria-pressed', String(selected));
    }
    b.addEventListener('click', action);
    return b;
  }

  /** トグルの表示のみを更新し、各列のスクロールとフォーカスを維持する。 */
  function updateAttributeToggles() {
    document.querySelectorAll('[data-sort-key]').forEach(b => {
      const key = b.dataset.sortKey;
      const direction = data.current.sort?.key === key ? data.current.sort.direction : null;
      b.textContent = 'ソート：' + (direction === 'Desc' ? '降順 ↓' : direction === 'Asc' ? '昇順 ↑' : '指定なし');
      b.setAttribute('aria-pressed', String(direction !== null));
    });
    document.querySelectorAll('[data-match-key]').forEach(b => {
      const operator = data.current.matches[b.dataset.matchKey] ?? 'Eq';
      b.textContent = '一致方法：' + MATCH_LABELS[operator];
      b.setAttribute('aria-pressed', String(operator !== 'Eq'));
    });
  }

  /** 属性の並べ替えと一致方法を循環切替するボタンを作成する。 */
  function attributeToggles(f) {
    const controls = document.createElement('div');
    controls.className = 'attribute-toggles';
    const sortButton = button('', () => {
      const previous = data.current.sort;
      const direction = previous?.key === f.key ? previous.direction : null;
      const next = { none: 'Desc', Desc: 'Asc', Asc: null }[direction ?? 'none'];
      data.current.sort = next ? { key: f.key, direction: next } : null;
      updateAttributeToggles();
      save();
      updateURL();
    });
    sortButton.dataset.sortKey = f.key;
    sortButton.title = f.name + 'のソート：降順 → 昇順 → 指定なし';
    const matchButton = button('', () => {
      const previous = data.current.matches[f.key] ?? 'Eq';
      data.current.matches[f.key] = { Eq: 'Contains', Contains: 'BeginsWith', BeginsWith: 'Eq' }[previous];
      updateAttributeToggles();
      save();
      updateURL();
    });
    matchButton.dataset.matchKey = f.key;
    matchButton.title = f.name + 'の一致方法：含む → 始まる → 一致';
    controls.append(sortButton, matchButton);
    return controls;
  }

  /**
   * 設定数に応じた属性列を描画する。操作中の列はDOMを維持する。
   * @param {string|null} [preserveKey=null] - 再生成しない属性キー。初回・復元時は全列を更新。
   * @returns {void}
   */
  function renderColumns(preserveKey = null) {
    // 復元・インポート・設定変更後も、現在使用できる条件だけを残す。
    normalizeCurrent(data.current);
    const container = $('columns');
    const horizontalPosition = container.scrollLeft;
    const preserved = Array.from(container.children)
      .find(column => column.getAttribute('data-attribute-key') === preserveKey);
    const verticalPosition = preserved?.scrollTop ?? 0;

    // 操作した列を取り外さず、他の列だけを削除する。フォーカスも維持される。
    for (const column of Array.from(container.children)) {
      if (column !== preserved) {
        column.remove();
      }
    }

    // 配列の順番が左から右への表示順となる。先頭2列だけが必須。
    const attributes = [{
      key: 'department',
      name: '部門',
      options: config.departments
    }, {
      key: 'listType',
      name: 'リスト種類',
      options: listOptions(data.current.department)
    }, ...activeFilters(data.current)];
    attributes.forEach((f, index) => {
      if (preserved && f.key === preserveKey) {
        return;
      }

      // 属性列の見出しと、選択ボタンを入れる領域を生成する。
      const box = document.createElement('div');
      box.className = 'column';
      box.setAttribute('data-attribute-key', f.key);
      const title = document.createElement('h3');
      const step = document.createElement('span');
      step.className = 'step';
      step.textContent = String(index + 1).padStart(2, '0') + (index < 2 ? ' / 必須' : ' / 任意');
      title.append(step, document.createTextNode(f.name));
      box.append(title);
      const choices = document.createElement('div');
      choices.className = 'choices';
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', f.name);
      const filter = index >= 2;
      const current = filter ? selection(data.current, f.key) : null;
      if (filter) box.append(attributeToggles(f));

      /**
       * この属性の選択値を更新し、保存して画面へ反映する。
       * @param {string} value - 設定IDまたは入力値。
       * @param {string} mode - フィルタの選択方式（必須属性では未使用）。
       * @returns {void}
       */
      const set = (value, mode) => {
        if (filter) {
          setSelection(data.current, f.key, { mode, value });
        } else {
          if (f.key === 'listType') {
            [data.current.listType, data.current.viewKey] = JSON.parse(value);
          } else {
            data.current[f.key] = value;
          }
          normalizeCurrent(data.current);
        }
        // 選択した列ではDOMを作り直さず、選択表示と入力欄だけを書き換える。
        const selected = filter ? selection(data.current, f.key) : null;
        const options = getOptions(f, data.current.department);
        choices.querySelectorAll('button').forEach((candidate, buttonIndex) => {
          let pressed;
          if (!filter) {
            pressed = options[buttonIndex].id === (f.key === 'listType' ? selectedListOption(data.current) : data.current[f.key]);
          } else if (buttonIndex === 0) {
            pressed = selected.mode === 'none';
          } else if (buttonIndex === options.length + 1) {
            pressed = selected.mode === 'custom';
          } else {
            pressed = selected.mode === 'preset' && options[buttonIndex - 1].id === selected.value;
          }
          candidate.setAttribute('aria-pressed', String(pressed));
        });
        if (filter) {
          $('input-' + f.key).value = selected.mode === 'custom' ? selected.value : '';
        }

        save();
        renderColumns(f.key);
        updateURL();
      };

      // 任意属性は指定なし・候補・直接入力、必須属性は候補のみを並べる。
      if (filter) {
        choices.append(button('指定なし', () => set('', 'none'), current.mode ===
          'none'));
      }
      for (const o of getOptions(f, data.current.department)) {
        const selected = filter ? current.mode === 'preset' && current.value === o.id
          : o.id === (f.key === 'listType' ? selectedListOption(data.current) : data.current[f.key]);
        const choice = button(o.name, () => set(o.id, 'preset'), selected);
        if (f.key === 'listType' && o.viewName) {
          const viewName = document.createElement('small');
          viewName.className = 'list-view-name';
          viewName.textContent = o.viewName;
          choice.append(viewName);
          choice.classList.add('list-view-choice');
        }
        choices.append(choice);
      }
      if (filter) {
        choices.append(button('直接入力', () => {
          // DOMを維持するため、描画時の値ではなく最新の状態を参照する。
          const latest = selection(data.current, f.key);
          set(latest.mode === 'custom' ? latest.value : '', 'custom');
          $('input-' + f.key).focus();
        }, current.mode === 'custom'));
      }
      box.append(choices);
      if (f.key === 'listType' && f.options.length === 0) {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'この部門で利用できるリストはありません。';
        box.append(hint);
      }

      // 任意属性には自由入力欄を設ける。入力時は自動でcustomへ切り替える。
      if (filter) {
        const label = document.createElement('label');
        label.className = 'custom-label';
        label.htmlFor = 'input-' + f.key;
        label.textContent = 'フィルタ値を入力';
        const input = document.createElement('input');
        input.id = label.htmlFor;
        input.type = 'text';
        input.maxLength = 2000;
        input.placeholder = '番号・文字列';
        input.value = current.mode === 'custom' ? current.value : '';

        // 入力中は列を再描画しないことで、フォーカスとカーソル位置を保つ。
        input.addEventListener('input', () => {
          setSelection(data.current, f.key, { mode: 'custom', value: input.value });
          choices.querySelectorAll('button').forEach((b, i, a) => b.setAttribute(
            'aria-pressed', String(i === a.length - 1)));
          save();
          updateURL();
        });
        box.append(label, input);
      }
      // 操作した列の手前も、取り外さずに新しい列を差し込める。
      container.insertBefore(box, container.children[index] || null);
    });

    // 列数・幅の変化によるブラウザの自動補正も考慮し、操作列と横位置を復元する。
    if (preserved) {
      preserved.scrollTop = verticalPosition;
    }
    container.scrollLeft = horizontalPosition;
    updateAttributeToggles();
  }

  /**
   * 生成URL・要約・エンコード警告・操作ボタンの状態を更新する。
   *
   * @returns {void}
   */
  function updateURL() {
    // 固定ビュー名の表示を避け、選択リストの実際のページ名を表示する。
    const list = getLists(data.current.department).find(item => item.id === data.current.listType);
    const viewLabel = $('viewLabel');
    if (viewLabel) {
      viewLabel.textContent = list ? 'ビュー：' + getViewPage(list, data.current.viewKey) : 'ビュー：未選択';
    }
    try {
      $('url').value = buildURL(data.current);
      $('copy').disabled = false;
      $('open').disabled = false;
      $('summary').textContent = description(data.current);

      // 未エンコード時にクエリ構造へ影響する文字を検知して注意を表示する。
      const rawRisk = !data.current.encode && queryAttributes(data.current).some(f => {
        const v = selection(data.current, f.key);
        return v.mode !== 'none' && v.value && /[&#%+=\s]/.test(f.id + v.value);
      });
      $('urlWarning').hidden = !rawRisk;
      $('urlWarning').textContent = 'エンコードなしでは &・#・+・%・空白などにより条件が正しく伝わらない場合があります。「あり」を推奨します。';
    } catch (error) {
      $('url').value = '';
      $('summary').textContent = description(data.current);
      $('copy').disabled = true;
      $('open').disabled = true;
      notify('URL生成エラー：' + error.message);
    }
    document.querySelectorAll('[name=encoding]').forEach(r => r.checked = (r.value === 'yes') ===
      data.current.encode);
  }

  /**
   * 履歴を新しい順に描画し、各行へコピー・開く・条件復元・個別削除ボタンを配置する。
   *
   * @returns {void}
   */
  function renderHistory() {
    // コピーやインポートが演出中に完了しても、描画は削除処理の終了まで待つ。
    if (historyDeleting) {
      return;
    }
    $('history').replaceChildren();
    $('historyCount').textContent = data.history.length + '件';
    $('clear').disabled = !data.history.length;
    if (!data.history.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'まだ履歴がありません。URLをコピー、または開くとここに記録されます。';
      $('history').append(p);
    }

    // 保存済みURLはtextContentで表示し、HTMLとして解釈させない。
    data.history.forEach(h => {
      const row = document.createElement('div');
      row.className = 'history-item';
      const time = document.createElement('div');
      time.textContent = new Date(h.time).toLocaleString('ja-JP');
      const action = document.createElement('p');
      action.textContent = h.action === 'copy' ? 'コピー' : '開く';
      time.append(action);
      const details = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = description(h.state);
      const url = document.createElement('code');
      url.textContent = h.url;
      const mode = document.createElement('p');
      mode.textContent = 'エンコード：' + (h.state.encode ? 'あり' : 'なし');
      details.append(title, mode, url);

      // 履歴の状態を複製して復元し、現在の設定でURLを再生成する。
      const actions = document.createElement('div');
      actions.className = 'history-actions';

      // 保存当時のURLをそのまま操作する。現在の選択条件は変更しない。
      actions.append(
        button('URLをコピー', () => copyURL(h.url, h.state)),
        button('URLを開く', () => openURL(h.url, h.state))
      );
      actions.append(button('条件を復元', () => {
        data.current = clone(h.state);
        normalizeCurrent(data.current);
        save();
        renderColumns();
        updateURL();
        notify('履歴の条件を復元しました。URLは現在のconfig.jsから再生成しています。');
        $('selectionTitle').scrollIntoView({
          behavior: 'smooth'
        });
      }));
      // URLではなく対象オブジェクトを指定し、同じURLの旧履歴でも1件だけ削除する。
      const removeButton = button('✖︎', () => deleteHistory(h));
      removeButton.className = 'history-delete';
      removeButton.title = 'この履歴を削除';
      removeButton.setAttribute('aria-label', 'この履歴を削除：' + description(h.state));
      actions.append(removeButton);
      row.append(time, details, actions);
      $('history').append(row);
    });
  }

  /**
   * 行を0.5秒かけて透明化・縮小する。データ自体は変更しない。
   * @param {HTMLElement} row - 削除する履歴行。
   * @returns {Promise<void>} アニメーション終了後に解決する。
   */
  async function animateHistoryRemoval(row) {
    const height = row.getBoundingClientRect().height;
    row.classList.add('history-removing');

    const animation = row.animate([
      { height: height + 'px', opacity: 1 },
      { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', borderBottomWidth: '0px' }
    ], {
      duration: HISTORY_DELETE_DURATION,
      easing: 'ease-in-out',
      fill: 'forwards'
    });

    // キャンセル時にも後続の保存・再描画で画面を整える。
    await animation.finished.catch(() => {});
  }

  /**
   * 確認後、対象履歴をアニメーション付きで削除する。
   * @param {Object|null} entry - 1件削除の対象。nullなら現在の履歴を全削除する。
   * @returns {Promise<void>} 削除・保存・再描画の完了時に解決する。
   */
  async function deleteHistory(entry = null) {
    if (historyDeleting || !data.history.length) {
      return;
    }

    const index = entry === null ? 0 : data.history.indexOf(entry);
    if (index < 0) {
      return;
    }

    const message = entry === null
      ? '履歴をすべて削除しますか？'
      : 'この履歴を削除しますか？\n' + description(entry.state);
    if (!confirm(message)) {
      return;
    }

    // 確認時点の対象を固定する。演出中に追加・インポートされた履歴は削除しない。
    const targets = new Set(entry === null ? data.history : [entry]);
    const rows = Array.from($('history').querySelectorAll('.history-item'));
    const removingRows = entry === null ? rows : rows.slice(index, index + 1);
    historyDeleting = true;
    $('clear').disabled = true;
    $('history').setAttribute('aria-busy', 'true');
    $('history').querySelectorAll('button').forEach(b => { b.disabled = true; });

    try {
      // 全削除でも各行を同時に縮めるため、所要時間は合計0.5秒。
      await Promise.all(removingRows.map(animateHistoryRemoval));
      data.history = data.history.filter(item => !targets.has(item));
      save();
      notify(entry === null ? '履歴を削除しました。' : '履歴を1件削除しました。');
    } catch (_) {
      notify('履歴を削除できませんでした。もう一度お試しください。');
    } finally {
      historyDeleting = false;
      $('history').removeAttribute('aria-busy');
      renderHistory();
    }

    // 再描画後、次の行（なければ前の行）の削除ボタンへフォーカスを戻す。
    const remaining = $('history').querySelectorAll('.history-delete');
    const focusTarget = remaining[Math.min(index, remaining.length - 1)] || $('open');
    focusTarget.focus();
  }

  /**
   * 操作したURLを履歴の先頭へ配置し、保存・履歴表示を更新する。
   * 同じURLが存在する場合は重複を除去し、日時・操作・条件を最新化する。
   *
   * @param {"copy"|"open"} action - 操作の種類。
   * @param {string} url - 操作に使用したURL。
   * @param {Object} state - 操作時点の選択状態。
   * @returns {void}
   */
  function record(action, url, state) {
    // URL文字列の完全一致で判定する。旧データに複数の重複がある場合も除去する。
    // 他のURLの並び順は維持し、対象URLだけを最新の記録として先頭へ移す。
    data.history = data.history.filter(item => item.url !== url);

    data.history.unshift({
      action,
      url,
      state: clone(state),
      time: new Date().toISOString()
    });

    // 上限を超えた古い記録を除去してから永続化する。
    data.history = data.history.slice(0, MAX_HISTORY);
    save();
    renderHistory();
  }

  /**
   * 指定URLをコピーし、成功した操作を履歴へ記録する。
   * @param {string} url - 生成URLまたは履歴に保存されたURL。
   * @param {Object} sourceState - 対象URLの選択条件。
   * @returns {Promise<void>} コピー処理完了時に解決する。
   */
  async function copyURL(url, sourceState) {
    // 非同期コピー中に画面の条件が変わっても、操作開始時の条件を記録する。
    const state = clone(sourceState);
    try {
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error();
        }
        await navigator.clipboard.writeText(url);
      } catch (_) {
        // Clipboard APIが利用できない場合は一時textareaでコピーを試みる。
        const temporary = document.createElement('textarea');
        temporary.value = url;
        document.body.append(temporary);
        try {
          temporary.select();
          if (!document.execCommand('copy')) {
            throw new Error();
          }
        } finally {
          temporary.remove();
        }
      }

      record('copy', url, state);
      notify('URLをコピーしました。');
    } catch (_) {
      // 履歴URLと現在の生成URLが異なる場合も、正しい対象を手動コピーできる。
      window.prompt('自動コピーできません。以下のURLを Ctrl+C でコピーしてください。', url);
      notify('自動コピーできませんでした（履歴には未記録）。');
    }
  }

  /**
   * 指定URLを別タブで開き、URL引き渡しに成功した操作を履歴へ記録する。
   * @param {string} url - 生成URLまたは履歴に保存されたURL。
   * @param {Object} sourceState - 対象URLの選択条件。
   * @returns {void}
   */
  function openURL(url, sourceState) {
    const state = clone(sourceState);
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      notify('別タブを開けませんでした。Edgeのポップアップ設定を確認してください。');
      return;
    }

    // 遷移先から元ページを操作できないようopenerを切り離す。
    try {
      tab.opener = null;
      tab.location.replace(url);
      record('open', url, state);
      notify('別タブにURLを渡しました。接続結果は別タブで確認してください。');
    } catch (_) {
      tab.close();
      notify('URLを開けませんでした。');
    }
  }

  // 生成URLのボタンと履歴のボタンで同じ操作処理を使用する。
  $('copy').addEventListener('click', () => copyURL(buildURL(data.current), data.current));
  $('open').addEventListener('click', () => openURL(buildURL(data.current), data.current));

  /**
   * Enterで現在の生成URLを開く。既存のクリック処理を共用する。
   * @param {KeyboardEvent} event - ページで発生したキー入力。
   * @returns {void}
   */
  function handleOpenShortcut(event) {
    // IME確定、長押し、修飾キー付き入力、処理済みイベントは対象外。
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 ||
        event.repeat || event.ctrlKey || event.altKey || event.metaKey ||
        event.shiftKey || event.defaultPrevented) {
      return;
    }

    // ボタン等では標準のEnter操作を維持する。読み取り専用URL欄では利用可能。
    const target = event.target;
    if (target instanceof Element &&
        (target.closest('button, a, select, input[type="file"], input[type="button"], input[type="submit"], input[type="reset"]') ||
         target.isContentEditable || target.closest('textarea:not([readonly])'))) {
      return;
    }

    if ($('open').disabled) {
      return;
    }

    event.preventDefault();
    $('open').click();
  }

  // フィルタ入力欄やページ背景でEnterを押したときにリンクを開く。
  document.addEventListener('keydown', handleOpenShortcut);

  // エンコード設定変更：選択を保存し、URLを即時再生成する。
  document.querySelectorAll('[name=encoding]').forEach(r => r.addEventListener('change', () => {
    data.current.encode = r.value === 'yes';
    save();
    updateURL();
  }));

  // 条件リセット：履歴は保持し、現在の条件だけを初期値へ戻す。
  $('reset').addEventListener('click', () => {
    data.current = defaults();
    save();
    renderColumns();
    updateURL();
    notify('条件を初期状態に戻しました。');
  });

  // 全削除も個別削除と同じ確認・アニメーション処理を使用する。
  $('clear').addEventListener('click', () => deleteHistory());

  // エクスポート：アプリの保存データをJSON化する。config.jsは含めない。
  $('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'sharepoint-url-builder-' + new Date().toISOString().replace(/[:.]/g, '-') +
      '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('現在の条件と履歴をエクスポートしました。');
  });

  // インポートボタンから非表示のファイル選択欄を開く。
  $('import').addEventListener('click', () => $('file').click());

  // ファイル読込：サイズ・形式・現在の設定との整合性を検証してから置き換える。
  $('file').addEventListener('change', async event => {

    // 同じファイルを連続選択できるよう、取得後にinputの値をクリアする。
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    try {
      if (file.size > 10 * 1024 * 1024) {
        fail('ファイルは10MB以下にしてください。');
      }
      const imported = validateData(JSON.parse(await file.text()));
      if (!confirm('現在の選択状態と履歴を置き換えます。履歴 ' + imported.history.length + '件をインポートしますか？')) {
        return;
      }

      // 検証とユーザー確認が完了するまで、現在のデータには触れない。
      data = imported;
      normalizeCurrent(data.current);
      save();
      renderColumns();
      updateURL();
      renderHistory();
      notify('インポートしました。');
    } catch (error) {
      notify('インポートできません。現在の内容は変更していません：' + error.message);
    }
  });

  // 初回描画：復元済みまたは初期状態を画面全体に反映する。
  $('baseLabel').textContent = config.baseUrls[0].name + ' · ' + config.baseUrls[0].id;
  renderColumns();
  updateURL();
  renderHistory();
})();
