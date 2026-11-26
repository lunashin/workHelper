/* 設定は未エンコードで指定します。既存IDは履歴との対応のため維持してください。
 * departments: 部門一覧。id: '' はTOPサイトとして1件まで指定可能。
 * listTypes: departmentIdsに利用部門ID、filterKeysに使用するfiltersのkeyを指定。
 * listTypes.id: 一意な保存・選択用識別子。URLには使用しません。既存値は維持してください。
 * listTypes.path: 部門配下のリスト相対パス（必須・未エンコード）。
 * listTypes.viewPage: ビューIDごとにnameとfilenameを指定。省略時はAllItems.aspx。
 * filters: フィルタの定義。options.departmentIdで所属部門を指定可能。0件でも可。
 * リストのdepartmentIds/filterKeysは空配列も可。フィルタはfilterKeysの順に表示。
 */
window.SP_URL_CONFIG = {
  baseUrls: [
    { name: "業務システム（サンプル）", id: "https://sharepoint.example.local/sites/business" }
  ],
  departments: [
    { name: "TOP", id: "" },
    { name: "品質部", id: "quality" },
    { name: "設計部", id: "design" },
    { name: "生産部", id: "prod" },
    { name: "生産部2", id: "prod2" },
    { name: "生産部3", id: "prod3" },
    { name: "生産部4", id: "prod4" },
    { name: "生産部5", id: "prod5" },
    { name: "生産部6", id: "prod6" },
    { name: "生産部7", id: "prod7" },
    { name: "生産部8", id: "prod8" },
    { name: "生産部9", id: "prod9" },
  ],
  listTypes: [
    {
      name: "全体管理",
      id: "aaa",
      path: "Lists/aaa",
      viewPage: {
        all: { name: "すべて", filename: "AllItems.aspx" },
        filter1: { name: "絞り込み1", filename: "View001.aspx" },
      },
      departmentIds: [ "" ],
      filterKeys: [ "law" ],
    },
    {
      name: "法律管理",
      id: "Regulations",
      path: "Lists/Regulations",
      departmentIds: [ "quality", "prod", "prod9" ],
      filterKeys: [ "law", "category" ],
    },
    {
      name: "要件管理",
      id: "Requirements",
      path: "Lists/Requirements",
      departmentIds: [ "quality", "design" ],
      filterKeys: [ "law", "category", "classification" ],
    },
  ],
  filters: [
    {
      key: "law",
      name: "法律番号",
      id: "RegulationNo",
      options: [
        { name: "法律001", id: "001" },
        { name: "法律002", id: "002" },
        { name: "法律003", id: "003", departmentId: "quality" },
      ]
    },
    {
      key: "category",
      name: "区分番号",
      id: "RequirementCategoryNo",
      options: [
        { name: "区分01", id: "01" },
        { name: "区分02", id: "02" },
      ]
    },
    {
      key: "classification",
      name: "分類番号",
      id: "RequirementClassNo",
      options: [
        { name: "分類001", id: "001" },
        { name: "分類002", id: "002" },
      ]
    }
  ]
};
