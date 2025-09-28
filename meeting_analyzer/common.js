//---------------------------------------
// Define (Common)
//---------------------------------------

// key code
// https://developer.mozilla.org/ja/docs/Web/API/KeyboardEvent/keyCode
const key_enter = 13;
const key_a = 65;
const key_b = 66;
const key_c = 67;
const key_d = 68;
const key_e = 69;
const key_f = 70;
const key_i = 73;
const key_n = 78;
const key_s = 83;
const key_v = 86;
const key_x = 88;
const key_z = 90;
const key_arrow_left = 37;
const key_arrow_up = 38;
const key_arrow_right = 39;
const key_arrow_down = 40;
const key_space = 32;
const key_esc = 27;

const key_0 = 48;
const key_1 = 49;
const key_2 = 50;
const key_3 = 51;
const key_4 = 52;
const key_5 = 53;
const key_6 = 54;
const key_7 = 55;
const key_8 = 56;
const key_9 = 57;

const key_plus = 187;
const key_astar = 222;


//---------------------------------------
// Data (Common)
//---------------------------------------
var g_list_history = [];
const g_list_history_num = 20;






//---------------------------------------
// Function (Common)
//---------------------------------------

//localStorageへ値を保存
function saveStorage(name, val)
{
  localStorage.setItem(name, val);
}

//localStorageから値を取得
function loadStorage(name)
{
  return localStorage.getItem(name);
}

/**
 * @summary テキストコピー
 * @param コピーするテキスト
 */
function copy_text(text) {
  navigator.clipboard.writeText(text);
}

function read_clipboard(func) {
  navigator.clipboard.readText().then(func);
}

// 履歴保存
function pushHistory(json_str) {
  // 先頭へ追加
  // let copy = { ...data };
  g_list_history.splice(0, 0, json_str);

  // 規定要素数以上なら、超過分を削除
  if (g_list_history.length > g_list_history_num) {
    g_list_history.splice(g_list_history_num, g_list_history.length - g_list_history_num);
  }
}

// 履歴取り出し
function popHistory() {
  if (g_list_history.length > 0) {
    // 先頭要素を返し、削除
    // let copy = { ...g_list_history[0] };
    let json_str = g_list_history.splice(0,1);
    return JSON.parse(json_str);
  }
  return null;
}

/**
 * @summary 履歴保存数取得
 * @returns 履歴保存数
 */
function getHistoryNum() {
  return g_list_history.length;
}

// コピーアニメーション
function copy_animation(elem) {
  // アニメーション
  let backgroundColor_org = elem.style.backgroundColor;
  elem.style.transition = undefined;
  elem.style.backgroundColor="green";

  setTimeout(() => {
    elem.style.transition = "background-color 0.5s ease-in-out";
    elem.style.backgroundColor = backgroundColor_org;
  }, 500);
}

/**
 * @summary 内部データソート 比較関数
 * @param 比較対象データ1
 * @param 比較対象データ2
 * @returns 結果(0:変更なし / <0:aをbの前に並べる / >0:aをbの後に並べる )
 */
function compareFn(data1, data2) {
  const period1 = new Date(data1.period);
  const period2 = new Date(data2.period);

  let is_invalid1 = isInvalidDate(period1);
  let is_invalid2 = isInvalidDate(period2);

  // どちらかが無効な日付
  if (is_invalid1 || is_invalid2) {
    if (is_invalid1 && !is_invalid2) {
      return 1;
    }
    if (!is_invalid1 && is_invalid2) {
      return -1;
    }
    // 変動なし
    return 0;
  }

  if (period1 < period2) {
   return -1;
  } else if (period1 > period2) {
    return 1;
  }
  return 0;
}

/**
 * @summary 内部データのキーリストを条件に沿って返す
 * @param ソート指定 false:ソートしない / true:期限の早い順にソートする
 * @return キー一覧
 */
function get_internal_keys(filter, is_no_sort) {
  let keys = Object.keys(g_list_data);
  let ary = [];
  for (let i = 0 ; i < keys.length; i++) {
    if (filter !== '' && filter !== undefined) {
      if (keys[i].indexOf(filter) >= 0) {
        ary.push({ name: keys[i], period: g_list_data[keys[i]].period });
      }
    } else {
      ary.push({ name: keys[i], period: g_list_data[keys[i]].period });
    }
  }

  if (!is_no_sort) {
    ary.sort(compareFn);
  }

  ret = [];
  for (let i = 0 ; i < ary.length; i++) {
    ret.push(ary[i].name);
  }
  return ret;
}


/**
 * @summary 数値をゼロパディングして文字列化
 * @param 数値
 * @param 最大文字列長
 * @returns ゼロパディングされた文字列
 */
function zero_padding(num, len) {
  return ( Array(len).join('0') + num ).slice( -len );
}

/**
 * スクリプトファイルを読み込む
 * @param ファイル名
 * @param コールバック
 */
function load_script(filename, fn) {
  var done = false;
  var head = document.getElementsByTagName('head')[0];
  var script = document.createElement('script');
  script.src = filename;
  head.appendChild(script);
  script.onload = script.onreadystatechange = function() {
    if ( !done && (!this.readyState || this.readyState === "loaded" || this.readyState === "complete") ) {
      done = true;
      if (fn !== undefined) {
        fn();
      }
      // Handle memory leak in IE
      script.onload = script.onreadystatechange = null;
      if ( head && script.parentNode ) {
        head.removeChild( script );
      }
    }
  };
}

/**
 * @summary 現在の状態をJSONファイルとしてダウンロード
 * @param ファイル名
 * @param ダウンロードさせるJSON文字列
 */
function download_json(filename, json_str) {
  // ダウンロード
  const blob = new Blob([json_str], { type: 'application/json' });
  const url = (window.URL || window.webkitURL).createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}



/**
 * @summary 小数点以下切り捨て
 * @param {*} value 値
 * @param {*} base 切り捨て基準位置(10: 小数点第1位, 100:小数点第2位)
 * @return 処理済みの値
 */
function floorEx(value, base) {
  return Math.floor(value * base) / base;
}







//---------------------------------------
// Function (Element)
//---------------------------------------

/**
 * @summary 選択されているoptionを取得
 * @param selectエレメントID
 * @returns エレメントのリスト(配列)
 */
function get_selected_option(elem_id) {
  let ret = [];
  let options = document.getElementById(elem_id).options;
  for (let i = 0; i < options.length; i++) {
    if(options[i].selected) {
      ret.push(options[i]);
    }
  }
  return ret;
}





//---------------------------------------
// Function (Date)
//---------------------------------------

/**
 * @summary 日付文字列を返す
 * @param Dateオブジェクト
 * @param 区切り記号を入れるかどうか(/, :) (true|false)
 * @param 時刻を含めるかどうか (true|false)
 * @param ゼロパディングするかどうか (true|false)
 * @returns 日付文字列 (yyyy/MM/dd or yyyyMMdd)
 */
function get_date_str(d, is_separate, is_include_time, is_zero_padding) {

  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  let date = d.getDate();
  let hour = d.getHours();
  let minute = d.getMinutes();
  // let second = today.getSeconds();

  if (is_zero_padding) {
    month = zero_padding(month, 2);
    date = zero_padding(date, 2);
    hour = zero_padding(hour, 2);
    minute = zero_padding(minute, 2);
    // second = zero_padding(second, 2);
  }

  let sep = '';
  let sep2 = '';
  if (is_separate === true) {
    sep = '/';
    sep2 = ':';
}

  if (is_include_time === true) {
    return `${year}${sep}${month}${sep}${date} ${hour}${sep2}${minute}`;
  }
  return `${year}${sep}${month}${sep}${date}`;
}

/**
 * @summary 今日の日付文字列を返す
 * @param 区切り記号を入れるかどうか(/, :)
 * @param 時刻を含めるかどうか (true|false)
 * @returns 日付文字列 (yyyy/MM/dd or yyyyMMdd)
 */
function get_today_str(is_separate, is_include_time) {
  return get_date_str(new Date(), is_separate, is_include_time, true);
}

/**
 * @summary 平日判定
 * @param 検証対象日
 * @returns true:平日 / false:週末
 */
function is_weekday(date)
{
  day = date.getDay();
  return (day != 0 && day != 6);
}

/**
 * @summary 日を増減する
 * @param 基準日(Date)
 * @param 増減する日数
 * @param 週末を除外するかどうか
 * @returns String
 */
function addDays_s(date, days, exclude_weekend)
{
  let dt = addDays(date, days, exclude_weekend);
  return get_date_str(dt, true, false, true);
}

/**
 * @summary 日を増減する
 * @param 基準日(Date)
 * @param 増減する日数
 * @param 週末を除外するかどうか(true|false)
 * @returns Date
 */
function addDays(target_date, days, exclude_weekend)
{
  let d = new Date(target_date.getTime() + days * 24 * 60 * 60 * 1000);

  // 週末の場合、月曜日まで進める
  if (exclude_weekend)
  {
    // 曜日を取得（0:日曜、1:月曜、... 6:土曜）
    const week = d.getDay();
    if (week == 0)
    {
      return addDays(d, 1, false);
    }
    if (week == 6)
    {
      return addDays(d, 2, false);
    }
  }

  return d;
}

/**
 * @summary 2つの日の差分日数を取得(当日を含める)
 * @param 日付1
 * @param 日付2
 * @param 週末を除外するかどうか
 * @returns 日数
 */
function get_days(target1, target2, exclude_weekend) {
  let d1 = null;
  let d2 = null;
  let dist = 1;

  if (target1 < target2) {
    d1 = new Date(target1.getFullYear(), target1.getMonth(), target1.getDate());
    d2 = new Date(target2.getFullYear(), target2.getMonth(), target2.getDate());
  } else {
    d2 = new Date(target1.getFullYear(), target1.getMonth(), target1.getDate());
    d1 = new Date(target2.getFullYear(), target2.getMonth(), target2.getDate());
    dist = -1;
  }

  let diff_msec = d2.getTime() - d1.getTime();
  let diff_days = diff_msec / 1000 / 60 / 60 / 24;

  if (diff_days > -1 && diff_days < 1) {
    // 今日
    return 0;
  }

  // 週末考慮なしならそのまま返す
  if (!exclude_weekend) {
    return Math.floor(diff_days);
  }

  // 比較対象日が週末なら営業日まで進める
  if (!is_weekday(d1)) {
    d1 = addDays(d1, 1, true);
  }
  if (!is_weekday(d2)) {
    d2 = addDays(d2, 1, true);
  }

  for (let i = 0; i < 50; i++) {
    d1 = addDays(d1, 1, true);
    if (d1 >= d2) {
      return (i + 1) * dist;
    }
  }
  return null;
}

/**
 * 表示用日付文字列取得 (「1日前」とかの表示)
 * @param 日付文字列(yyyy/mm/dd xx:xx)
 * @returns 表示用表示日付文字列
 */
function get_display_date_str(date_str) {
  let diff_days = get_days_from_today(date_str);

  // xx日以内なら、「xx日前」と返す
  if (diff_days === null) {
    return '';
  } else if (diff_days === 0) {
    return '本日';
  } else if (diff_days < 0) {
    // 未来
    return Math.floor(-diff_days)+ "日後";
  } else if (diff_days > 0) {
    if (diff_days <= 15) {
      // 過去 (規定日数まで日数を表示)
      return Math.floor(diff_days) + "日前";
    }
  }
  return date_str;
}

/**
 * @summary 今日との日数差分を取得
 * @param 日付(文字列)
 * @returns 日数(0:当日 / <0:未来 / >0:過去)
 */
function get_days_from_today(date_str) {
  let d = new Date(date_str);
  let d_now = new Date();
  let days = get_days(d, d_now, true);
  return days;
}

// 無効なDate判定
function isInvalidDate(d) {
  return Number.isNaN(d.getTime());
}

/**
 * @summary 日付文字列からDateオブジェクト作成(年を補正)
 * @param 日付文字列
 */
function date_from_str_ex(date_str) {
  // 年が省かれている形式 (MM/dd)
  if (date_str.split('/').length === 2) {
    let d = new Date(date_str);
    d.setFullYear(new Date().getFullYear());
    return get_date_str(d, true, false, true);
  }

  return get_date_str(new Date(date_str), true, false, true);
}

/**
 * @summary 差分時間を取得
 */
function get_diff_minute(d1, d2) {
  let diff_second = d2.getTime() - d1.getTime();
  let diff_min = diff_second / 60 / 1000;
  return diff_min;
}
