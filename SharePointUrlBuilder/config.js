/* 設定は未エンコードで指定します。既存IDは履歴との対応のため維持してください。
 * departments: 部門一覧。id: '' はTOPサイトとして1件まで指定可能。
 * listTypes: departmentIdsに利用部門ID、filterKeysに使用するfiltersのkeyを指定。
 * groups: 担当グループ専用設定。各候補のdepartmentIdで所属部門を指定。
 * filters: 一般フィルタの定義。groupsはここへ入れません。0件でも可。
 * リストのdepartmentIds/filterKeysは空配列も可。フィルタはfilterKeysの順に表示。
 */
window.SP_URL_CONFIG = {
  "baseUrls": [
    { "name": "業務システム（サンプル）", "id": "https://sharepoint.example.local/sites/business" }
  ],
  "departments": [
    { "name": "TOP", "id": "" },
    { "name": "品質部", "id": "quality" },
    { "name": "設計部","id": "design" },
    { "name": "生産部","id": "prod" },
    { "name": "生産部2","id": "prod2" },
    { "name": "生産部3","id": "prod3" },
    { "name": "生産部4","id": "prod4" },
    { "name": "生産部5","id": "prod5" },
    { "name": "生産部6","id": "prod6" },
    { "name": "生産部7","id": "prod7" },
    { "name": "生産部8","id": "prod8" },
    { "name": "生産部9","id": "prod9" },
  ],
  "listTypes": [
    {
      "name": "全体管理",
      "id": "Lists/aaa",
      "viewPage": {
        "all": { "name": "すべて", "endpoint": "AllItems.aspx" },
        "filter1": { "name": "絞り込み1", "endpoint": "View001.aspx" },
      },
      "departmentIds": [ "" ],
      "filterKeys": [ "law" ],
    },
    {
      "name": "法律管理",
      "id": "Lists/Regulations",
      "departmentIds": [ "quality", "prod", "prod9" ],
      "filterKeys": [ "law", "category" ],
    },
    {
      "name": "要件管理",
      "id": "Lists/Requirements",
      "departmentIds": [ "quality", "design" ],
      "filterKeys": [ "law", "category", "classification" ],
    },
  ],
  "groups": {
    "name": "担当グループ",
    "id": "ResponsibleGroup",
    "options": [
      { "name": "品質部 Aグループ", "id": "GroupA", "departmentId": "quality" },
      { "name": "品質部 Bグループ", "id": "GroupB", "departmentId": "quality" },
      { "name": "設計部 グループ1", "id": "GroupC", "departmentId": "design" },
      { "name": "設計部 グループ3", "id": "GroupD", "departmentId": "design" },
      { "name": "生産部 1課", "id": "GroupE1", "departmentId": "prod" },
      { "name": "生産部 2課", "id": "GroupE2", "departmentId": "prod" },
    ]
  },
  "filters": [
    {
      "key": "law",
      "name": "法律番号",
      "id": "RegulationNo",
      "options": [
        { "name": "法律001", "id": "001" },
        { "name": "法律002", "id": "002" },
      ]
    },
    {
      "key": "category",
      "name": "区分番号",
      "id": "RequirementCategoryNo",
      "options": [
        { "name": "区分01", "id": "01" },
        { "name": "区分02", "id": "02" },
      ]
    },
    {
      "key": "classification",
      "name": "分類番号",
      "id": "RequirementClassNo",
      "options": [
        { "name": "分類001", "id": "001" },
        { "name": "分類002", "id": "002" },
      ]
    }
  ]
};
