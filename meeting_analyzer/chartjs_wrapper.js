//---------------------------------------
// Global
//---------------------------------------



//---------------------------------------
// Data
//---------------------------------------



//---------------------------------------
// Event
//---------------------------------------




//---------------------------------------
// Class
//---------------------------------------

class chartjs_wrapper {
  chart_obj = null;


  /**
   * @summary グラフを描画
   * @param canvas element id
   * @param グラフタイトル
   * @param データ ([ {label:データ名, data:[x,x,x]}, {...} ])
   * @param Y軸のラベル ([a,b,c])
   * @param X軸のMax値
   * @param X軸のMin値
   * @param Canvasの横幅
   * @param Canvasの縦幅
   */
  draw_chart_line(canvas_id, title, data_x, data_y, max, min, canvas_width, canvas_height) {
    this.draw_chart_common('line', canvas_id, title, data_x, data_y, max, min, canvas_width, canvas_height);
  }

  /**
   * @summary 累積グラフを描画
   */
  draw_chart_line_accum(canvas_id, title, data_x, data_y, guides, max, min, canvas_width, canvas_height) {
    // 累積データを作成
    let data_x_accum = [];
    for (let i = 0; i < data_x.length; i++) {
      let dict = {};
      dict.label = data_x[i].label;

      let val = 0;
      let ary = [];
      for (let k = 0; k < data_x[i].data.length; k++) {
        val += data_x[i].data[k];
        ary.push(val);
      }
      dict.data = ary.concat();
      data_x_accum.push(dict);
    }

    // ガイドデータを作成
    if (guides !== null) {
      for (let i = 0; i < guides.length; i++) {
        // 1データ
        let guide_data_x = guides[i] / data_y.length;
        let ary = [];
        let val = 0;
        for (let k = 0; k < data_y.length; k++) {
          val += guide_data_x;
          ary.push(val);
        }
        data_x_accum.push({label: "guide" + i, data: ary.concat()});
      }
    }

    // 描画
    this.draw_chart_common('line', canvas_id, title, data_x_accum, data_y, max, min, canvas_width, canvas_height);
  }

  draw_chart_bar(canvas_id, title, data_x, data_y, max, min, canvas_width, canvas_height) {
    this.draw_chart_common('bar', canvas_id, title, data_x, data_y, max, min, canvas_width, canvas_height);
  }

  /**
   * @summary グラフを描画
   * @param canvas element id
   * @param グラフタイトル
   * @param データ ([ {label:データ名, data:[x,x,x]}, {...} ])
   * @param Y軸のラベル ([a,b,c])
   * @param X軸のMax値
   * @param X軸のMin値
   * @param Canvasの横幅
   * @param Canvasの縦幅
   */
  draw_chart_common(type, canvas_id, title, data_x, data_y, max, min, canvas_width, canvas_height) {
    // config
    var options = {
      "plugins": {
        "title": {
          "display": true, 
          "text": title
        }
      },
      "responsive": false, 
      "scales": {
        "y": {
          "max": max, 
          "min": min
        }
      }
    };

    // data
    const chart_data = {
      labels: data_y,
      datasets: data_x
    };

    // canvasサイズ調整
    var canvas = document.getElementById(canvas_id);
    canvas.width = canvas_width;
    canvas.height = canvas_height;

    // chart生成
    this.chart_obj = new Chart(canvas,
      {
        type: type,
        data: chart_data,
        options: options
      }
    );
  }
}
