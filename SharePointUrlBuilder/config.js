/* 設定はすべて未エンコードで指定します。id は変更後も履歴と対応する安定したキーです。 */
window.SP_URL_CONFIG = {
  baseUrls: [{ name: '業務システム（サンプル）', id: 'https://sharepoint.example.local' }],
  departments: [
    { name: '品質部', id: 'quality' },
    { name: '設計部', id: 'design' },
    { name: '生産部', id: 'production' }
  ],
  // id は部門サイトからの相対パス。必要に応じ Lists/ を含めてください。
  listTypes: [
    { name: 'A管理', id: 'Lists/Regulations' },
    { name: 'B管理', id: 'Lists/Requirements' }
  ],
  filters: [
    { key: 'group', name: '担当グループ', id: 'ResponsibleGroup', options: [
      { name: 'グループA', id: 'GroupA' }, 
      { name: 'グループB', id: 'GroupB' }
    ] },
    { key: 'law', name: '項目番号', id: 'RegulationNo', options: [
      { name: '項目001', id: '001' }, 
      { name: '項目002', id: '002' }
    ] },
    { key: 'category', name: '要件番号', id: 'RequirementCategoryNo', options: [
      { name: '要件01', id: '01' }, 
      { name: '要件02', id: '02' }
    ] },
    { key: 'classification', name: '分類番号', id: 'RequirementClassNo', options: [
      { name: '分類001', id: '001' }, 
      { name: '分類002', id: '002' }
    ] }
  ]
};
