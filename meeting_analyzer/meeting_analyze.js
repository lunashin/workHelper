//---------------------------------------
// Global
//---------------------------------------


//---------------------------------------
// Data
//---------------------------------------

/** 内部データ
{
 "xxxx/xx/xx" {
    elapsed_hour: xx,
    data: [{ comment: [コメント], meeting_name: [会議名], elapsed_hour: [会議時間] }, {...}]
 },
 ...
}
*/
var g_internal = {};

// Canvas Size
const g_canvas_width = 1270;
const g_canvas_height = 400;

// 対象title
const g_target_title = '会議';



//---------------------------------------
// Event
//---------------------------------------



//---------------------------------------
// Key Event
//---------------------------------------



//---------------------------------------
// Function
//---------------------------------------

/**
 * @summary 初期化
 */
function init() {
  // 内部データを作成
  for (let i = 0; i < comments.length; i++) {
    if (comments[i].title !== g_target_title) {
      continue;
    }
    // キーがなければ配列初期化
    let date = comments[i].date.split(' ')[0];
    if (g_internal[date] === undefined) {
      g_internal[date] = {};
      g_internal[date].data = [];
    }

    // コメントをパースして日毎のデータを作成
    // "xxxxxxxxxx (10:30 - 11:00 / 0.5h)"
    let comment = comments[i].comment;
    let name = comment.split(' ')[0];
    let elapsed_hour = 0;
    let elapsed_hour_temp = comment.split('/');
    if (elapsed_hour_temp.length > 1) {
      // コメントから会議時間を抽出
      elapsed_hour = parseFloat(elapsed_hour_temp[elapsed_hour_temp.length - 1].replaceAll('h', '').replaceAll(')', '').replaceAll(' ', ''));
    }
    g_internal[date].data.push({ comment: comment, meeting_name: name, elapsed_hour: elapsed_hour });
  }

  // 作業時間を計算
  let keys = Object.keys(g_internal);
  for (let i = 0; i < keys.length; i++) {
    let item = g_internal[keys[i]];
    let elapsed = 0;
    for (let k = 0; k < item.data.length; k++) {
      if (item.data[k].elapsed_hour !== undefined) {
        elapsed += parseFloat(item.data[k].elapsed_hour);
      }
    }
    g_internal[keys[i]].elapsed_hour = elapsed;
  }

  console.log(g_internal);
}

/**
 * @summary グラフを描画
 */
function draw_chart() {
  // data
  let keys = Object.keys(g_internal);
  keys.sort((a,b) => (a < b ? -1 : 1));     // 昇順

  let data = [];
  for (let i = 0; i < keys.length; i++) {
    data.push(g_internal[keys[i]].elapsed_hour);
  }
  let data_ary = [{label:'会議時間(h)', data:data}];
  draw_chart_ex(keys, data_ary);
}

function draw_chart_ex(keys, data) {
  // draw_chart(canvas_id, title, data_x, data_y, max, min, canvas_width, canvas_height) {
  g_cw.draw_chart_bar('chart_canvas', '会議時間の推移', data, keys, 6, 0, g_canvas_width, g_canvas_height);
}

/**
 * テーブル表示
 */
function draw_table() {
  let html = '';
  html += '<table>';
  html += '<tbody>';
  html += '\n';
  
  let keys = Object.keys(g_internal);
  for (let i = 0; i < keys.length; i++) {
    html += '<tr>\n';
    html += `<td>${keys[i]}</td>`;
    let item = g_internal[keys[i]];
    html += `<td>${item.elapsed_hour}</td>`;

    let content = '';
    for (let k = 0; k < item.data.length; k++) {
      content += item.data[k].comment;
      content += '<br>';
    }
    html += `<td>${content}</td>\n`;
    html += '</tr>\n';
  }
  html += '</tbody>';
  html += '</table>';

  document.getElementById('canvas_table').innerHTML = html;
}





//---------------------------------------
// Class
//---------------------------------------

/**
 * 勤怠時間管理クラス
 */
class worktime_manager {
  dict = [];

  /**
   * @summary 初期化
   */
  init(src) {
    this.init_data(src);
  }

  /**
   * @summary データ初期化
   * @param データ [{title:'', start:'yyyy/MM/dd hh:mm', end:'yyyy/MM/dd hh:mm', start_out:'yyyy/MM/dd hh:mm', end_out:'yyyy/MM/dd hh:mm'}...]
   */
  init_data(src) {
    // 対象データを抽出
    this.dict = [];
    for (let i = 0; i < src.length; i++) {
      // 有給
      if (src[i].dayoff !== undefined) {
        this.dict.push(src[i]);
        continue;
      }

      // 退勤がついているデータを抽出
      if (src[i].end.indexOf('1999') === -1) {
        this.dict.push(src[i]);
      }
    }
  }

  /**
   * @summary 勤怠データ解析し、データを取得する
   * @param 名前一覧(部分一致)
   * @returns dict { '日付': { worktime:勤務時間, over_worktime:残業時間 }... }
   */
  get_worktime_dict(name) {
    let ret = {};
    for (let i = 0; i < this.dict.length; i++) {
      let item = this.dict[i];
      // 該当レコードのみ処理
      if (item.title.indexOf(name) === -1) {
        continue;
      }

      // 有給の場合
      if (item.dayoff !== undefined) {
        ret[item.start.split(' ')[0]] = { worktime:8, over_worktime: 0};
        continue;
      }

      // 勤務時間計算
      let d_start = new Date(item.start);
      let d_end = new Date(item.end);
      let worktime_msec = d_end.getTime() - d_start.getTime();
      let worktime_hour = worktime_msec / 1000 / 60 / 60;
      // 中抜けを除外
      let d_start_out = null;
      let d_end_out = null;
      if (item.end_out.indexOf('1999') === -1 && item.end_out.indexOf('1999') === -1) {
        d_start_out = new Date(item.start_out);
        d_end_out = new Date(item.end_out);
        let out_msec = d_end_out.getTime() - d_start_out.getTime();
        worktime_hour -= out_msec / 1000 / 60 / 60;
      }
      // 昼休憩を差し引き
      if (this.need_exclude_launchtime(d_start, d_end, d_start_out, d_end_out)) {
        worktime_hour = worktime_hour - 1;
      }

      // 残業時間
      let over_worktime = worktime_hour - 8;

      // todo: 半休の場合の処理

      ret[item.start.split(' ')[0]] = { worktime:worktime_hour, over_worktime: over_worktime };
    }
    console.log(ret);
    return ret;
  }
  
  /**
   * @summary 勤怠データをグラフ用データとして取得
   * @param 月指定(指定なしはnull)
   * @param 名前
   * @returns dict { labels: [日時...], worktimes: [勤務時間...], over_worktimes: [残業時間...] }
   */
  get_worktime_chart_dict(d_month, name) {
    let worktime_dict = this.get_worktime_dict(name);
    let keys = Object.keys(worktime_dict);

    // TODO: 日付順を変える場合、ここで keys をソート
    // keys.sort((a,b) => (a > b ? -1 : 1));  // 降順
    keys.sort((a,b) => (a < b ? -1 : 1));     // 昇順

    // 対象となるデータを抽出
    let target_keys = [];
    if (d_month !== null) {
      target_keys = this.getAllDatesInMonth(d_month);
    } else {
      target_keys = keys.concat();
    }

    // 勤怠データからグラフ用データを作成
    // 勤務時間
    let worktimes = [];
    for (let i = 0; i < target_keys.length; i++) {
      if(worktime_dict[target_keys[i]] !== undefined) {
        worktimes.push(worktime_dict[target_keys[i]].worktime);
      }
    }
    // 残業時間
    let over_worktimes = [];
    for (let i = 0; i < target_keys.length; i++) {
      if(worktime_dict[target_keys[i]] !== undefined) {
        over_worktimes.push(worktime_dict[target_keys[i]].over_worktime);
      }
    }
  
    return { labels: target_keys, worktime_data: { label:'勤務時間(h)', data: worktimes}, over_worktime_data: {label:'残業時間(h)', data: over_worktimes}};
  }

  /**
   * @summary 昼休憩を除外する必要があるかどうか
   * @param 勤務開始日時
   * @param 勤務終了日時
   * @returns true:除外必要あり / false:必要なし
   */
  need_exclude_launchtime(d_start, d_end, d_start_out, d_end_out) {
    // 昼休憩 開始時刻 (12:30)
    let d_start_launch = new Date(d_start);
    d_start_launch.setHours(12);
    d_start_launch.setMinutes(30);
    d_start_launch.setSeconds(0);
    // 昼休憩 終了時刻 (13:30)
    let d_end_launch = new Date(d_start);
    d_end_launch.setHours(13);
    d_end_launch.setMinutes(30);
    d_end_launch.setSeconds(0);

    // 中抜け時間が昼を跨いている場合 (昼前に中抜け開始、昼後に中抜け終了)
    if (d_start_out < d_start_launch && d_end_out > d_end_launch) {
      return false;
    }

    return (d_start < d_start_launch && d_end > d_end_launch);
  }

  /**
   * @summary 指定月の日付の一覧を作成(土日含む)
   * @param Date
   * @returns 日付一覧
   */
  getAllDatesInMonth_v0(date) {
    if (!(date instanceof Date)) {
      throw new Error("引数はDate型である必要があります");
    }

    const year = date.getFullYear();
    const month = date.getMonth(); // 0-indexed
    const result = [];

    // 月末の日にちを取得
    const lastDay = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= lastDay; day++) {
      const currentDate = new Date(year, month, day);
      const yyyy = currentDate.getFullYear();
      const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
      const dd = String(currentDate.getDate()).padStart(2, '0');
      result.push(`${yyyy}/${mm}/${dd}`);
    }

    return result;
  }

  /**
   * @summary 指定月の日付の一覧を作成(土日除外)
   * @param Date
   * @returns 日付一覧
   */
  getAllDatesInMonth(date) {
    if (!(date instanceof Date)) {
      throw new Error("引数はDate型である必要があります");
    }

    const year = date.getFullYear();
    const month = date.getMonth(); // 0-indexed
    const result = [];

    const lastDay = new Date(year, month + 1, 0).getDate();

    for (let day = 1; day <= lastDay; day++) {
      const currentDate = new Date(year, month, day);
      const dayOfWeek = currentDate.getDay(); // 0 = 日, 6 = 土

      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const yyyy = currentDate.getFullYear();
        const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
        const dd = String(currentDate.getDate()).padStart(2, '0');
        result.push(`${yyyy}/${mm}/${dd}`);
      }
    }

    return result;
  }



}





//---------------------------------------
// Main
//---------------------------------------

var g_cw = new chartjs_wrapper();

// 会議時間
// 初期化
init();
// 描画
draw_chart();
// 詳細テーブル
draw_table();


// init_worktime();

// let a = get_diff_minute(new Date('2025/1/1 8:30'), new Date('2025/1/1 17:30'));
// console.log(a);


// 勤務時間
let wm  = new worktime_manager();
wm.init(g_worktime);
let worktime_chart_dict = wm.get_worktime_chart_dict(null, ['Mr.A']);

// 日毎の勤務時間/残業時間グラフ
let cw = new chartjs_wrapper();
cw.draw_chart_bar('chart_canvas_worktime', '勤務時間/残業時間', [worktime_chart_dict.worktime_data, worktime_chart_dict.over_worktime_data], worktime_chart_dict.labels, 15, -8, g_canvas_width, g_canvas_height);

// 残業時間の累積推移グラフ
let cw_accm = new chartjs_wrapper();
cw_accm.draw_chart_line_accum('chart_canvas_worktime_accum', '累計 残業時間推移', [worktime_chart_dict.over_worktime_data], worktime_chart_dict.labels, null, 100, 0, g_canvas_width, g_canvas_height);

// 当月の残業時間の累積推移グラフ
let worktime_chart_dict2 = wm.get_worktime_chart_dict(new Date(), ['Mr.A']);
let cw_accm2 = new chartjs_wrapper();
cw_accm2.draw_chart_line_accum('chart_canvas_worktime_accum2', '今月の残業時間推移', [worktime_chart_dict2.over_worktime_data], worktime_chart_dict2.labels, [20,30,40], 45, 0, g_canvas_width, g_canvas_height);
