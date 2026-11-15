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
        path(item.id);
        if (ids.has(item.id)) {
          fail('設定IDが重複しています。');
        }
        ids.add(item.id);
      }
    }
    if (!Array.isArray(config.filters) || config.filters.length !== 4) {
      fail('4つのフィルタを設定してください。');
    }

    // フィルタは保存キーとSharePoint列内部名の両方を一意にする。
    const keys = new Set(),
      columns = new Set();
    for (const f of config.filters) {
      if (!/^[a-z][a-z0-9_]*$/i.test(f.key) || keys.has(f.key) || columns.has(f.id)) {
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
  } catch (error) {
    notify('設定エラー：' + error.message);
    document.querySelectorAll('button').forEach(b => b.disabled = true);
    return;
  }

  /**
   * 初期選択状態を新規作成する。部門とリストは先頭候補を使用する。
   *
   * @returns {Object} 全フィルタが指定なし、エンコードありの状態。
   */
  function defaults() {
    return {
      department: config.departments[0].id,
      listType: config.listTypes[0].id,
      encode: true,
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
    if (!config.departments.some(o => o.id === value.department) || !config.listTypes.some(o => o
        .id === value.listType)) {
      fail('部門またはリスト種類が現在のconfig.jsに存在しません。');
    }
    const result = {
      department: value.department,
      listType: value.listType,
      encode: value.encode,
      filters: {}
    };
    for (const f of config.filters) {
      const v = value.filters[f.key];
      if (!isObject(v) || !['none', 'preset', 'custom'].includes(v.mode)) {
        fail('フィルタの形式が不正です。');
      }
      text(v.value);
      if (v.mode === 'preset' && !f.options.some(o => o.id === v.value)) {
        fail('履歴の候補値が現在のconfig.jsに存在しません。');
      }
      result.filters[f.key] = {
        mode: v.mode,
        value: v.mode === 'none' ? '' : v.value
      };
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
    if (!isObject(data) || data.app !== 'sharepoint-url-builder' || data.version !== 1 || !Array
      .isArray(data.history) || data.history.length > MAX_HISTORY) {
      fail('対応するエクスポートファイルではありません。');
    }
    return {
      app: data.app,
      version: 1,
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

  // current: department / listType / encode / filters。

  // filtersの各値: { mode: 'none'|'preset'|'custom', value: string }。

  // historyの各項目: { action, url, state, time: ISO日時 }。
  let data = {
    app: 'sharepoint-url-builder',
    version: 1,
    current: defaults(),
    history: []
  };

  // 起動時だけ保存データを読む。復元失敗時は初期値を残し、警告する。
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      data = validateData(JSON.parse(saved));
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
   * 選択状態からAllItems.aspxのURLを組み立てる。通信は行わない。
   *
   * @param {Object} state - 検証済みの選択状態。
   * @returns {string} 指定条件だけを連番で含むURL。
   * @throws {Error} パスやエンコード対象が不正な場合。
   */
  function buildURL(state) {
    const base = new URL(config.baseUrls[0].id).href.replace(/\/+$/, '');
    const target = base + '/' + path(state.department) + '/' + path(state.listType) +
      '/AllItems.aspx';

    // クエリの組と連番カウンタ。未指定の条件には番号を割り当てない。
    const pairs = [];
    let n = 0;

    /**
     * クエリの値だけを選択されたエンコード方針で変換する。
     * @param {string} value - 列内部名またはフィルタ値。
     * @returns {string} クエリへ挿入する文字列。
     */
    const enc = value => state.encode ? encodeURIComponent(value) : value;
    for (const f of config.filters) {
      const v = state.filters[f.key];
      if (v.mode === 'none' || v.value === '') {
        continue;
      }
      n++;
      pairs.push('FilterField' + n + '=' + enc(f.id), 'FilterValue' + n + '=' + enc(v.value));
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
      .find(o => o.id === state.listType).name
    ];
    for (const f of config.filters) {
      const v = state.filters[f.key];
      if (v.mode !== 'none' && v.value !== '') {
        parts.push(f.name + '：' + (v.mode === 'preset' ? f
          .options.find(o => o.id === v.value).name : v.value));
      }
    }
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

  /**
   * 6つの属性列を現在の選択状態から再描画し、入力イベントを登録する。
   *
   * @returns {void}
   */
  function renderColumns() {
    $('columns').replaceChildren();

    // 配列の順番が左から右への表示順となる。先頭2列だけが必須。
    const attributes = [{
      key: 'department',
      name: '部門',
      options: config.departments
    }, {
      key: 'listType',
      name: 'リスト種類',
      options: config.listTypes
    }, ...config.filters];
    attributes.forEach((f, index) => {

      // 属性列の見出しと、選択ボタンを入れる領域を生成する。
      const box = document.createElement('div');
      box.className = 'column';
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
      const current = filter ? data.current.filters[f.key] : null;

      /**
       * この属性の選択値を更新し、保存して画面へ反映する。
       * @param {string} value - 設定IDまたは入力値。
       * @param {string} mode - フィルタの選択方式（必須属性では未使用）。
       * @returns {void}
       */
      const set = (value, mode) => {
        if (filter) {
          data.current.filters[f.key] = {
            mode,
            value
          };
        } else data.current[f.key] = value;
        save();
        renderColumns();
        updateURL();
      };

      // 任意属性は指定なし・候補・直接入力、必須属性は候補のみを並べる。
      if (filter) {
        choices.append(button('指定なし', () => set('', 'none'), current.mode ===
          'none'));
      }
      for (const o of f.options) {
        choices.append(button(o.name, () => set(o.id, 'preset'),
          filter ? current.mode === 'preset' && current.value === o.id : data.current[f
            .key] === o.id));
      }
      if (filter) {
        choices.append(button('直接入力', () => {
          set(current.mode === 'custom' ? current.value : '', 'custom');
          $('input-' + f.key).focus();
        }, current.mode === 'custom'));
      }
      box.append(choices);

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
          data.current.filters[f.key] = {
            mode: 'custom',
            value: input.value
          };
          choices.querySelectorAll('button').forEach((b, i, a) => b.setAttribute(
            'aria-pressed', String(i === a.length - 1)));
          save();
          updateURL();
        });
        box.append(label, input);
      }
      $('columns').append(box);
    });
  }

  /**
   * 生成URL・要約・エンコード警告・操作ボタンの状態を更新する。
   *
   * @returns {void}
   */
  function updateURL() {
    try {
      $('url').value = buildURL(data.current);
      $('copy').disabled = false;
      $('open').disabled = false;
      $('summary').textContent = description(data.current);

      // 未エンコード時にクエリ構造へ影響する文字を検知して注意を表示する。
      const rawRisk = !data.current.encode && config.filters.some(f => {
        const v = data.current.filters[f.key];
        return v.mode !== 'none' && v.value && /[&#%+=\s]/.test(f.id + v.value);
      });
      $('urlWarning').hidden = !rawRisk;
      $('urlWarning').textContent = 'エンコードなしでは &・#・+・%・空白などにより条件が正しく伝わらない場合があります。「あり」を推奨します。';
    } catch (error) {
      $('url').value = '';
      $('copy').disabled = true;
      $('open').disabled = true;
      notify('URL生成エラー：' + error.message);
    }
    document.querySelectorAll('[name=encoding]').forEach(r => r.checked = (r.value === 'yes') ===
      data.current.encode);
  }

  /**
   * 履歴を新しい順に描画し、各行へ条件復元・個別削除ボタンを配置する。
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
      actions.append(button('条件を復元', () => {
        data.current = clone(h.state);
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

  // コピー操作：非同期処理の開始時点で条件を複製し、履歴とのずれを防ぐ。
  $('copy').addEventListener('click', async () => {
    const state = clone(data.current),
      url = buildURL(state);
    try {
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error();
        }
        await navigator.clipboard.writeText(url);
      } catch (_) {

        // Clipboard APIが使えない環境では一時textareaでコピーを試みる。
        const temporary = document.createElement('textarea');
        temporary.value = url;
        document.body.append(temporary);
        temporary.select();
        const copied = document.execCommand('copy');
        temporary.remove();
        if (!copied) {
          throw new Error();
        }
      }

      // コピー成功後だけ履歴を追加する。
      record('copy', url, state);
      notify('URLをコピーしました。');
    } catch (_) {
      $('url').focus();
      $('url').select();
      notify('自動コピーできません。選択されたURLを Ctrl+C でコピーしてください（履歴には未記録）。');
    }
  });

  // 開く操作：ポップアップの生成を確認してからURLを渡す。接続結果は判定しない。
  $('open').addEventListener('click', () => {
    const state = clone(data.current),
      url = buildURL(state);
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
  });

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
