# TreeCarbon EDU Web App 程式設計規劃書（V1）

版本：2026-09-16

## 1. 專案目標

以 iPad Safari 為主要裝置，建立一個不需登入的前端 Web App，讓學生在校園內依序完成：

1. 確認 iPad 相機、定位、動作與方向感測器權限。
2. 取得位置並由使用者確認目前所在學校。
3. 從教育部「校園樹木資訊平臺」匯出資料，再手動上傳本校樹木名冊。
4. 前三項完成後才解鎖 AI 樹種辨識。
5. 人工確認樹種。
6. 在離地 $1.3\text{ m}$ 處直接量測樹徑（直徑），由學生人工輸入。
7. 輸入樹高並推估碳儲量，建立本機調查紀錄。

V1 不建立帳號、不要求登入、不建立雲端學生資料庫，所有調查內容先保存在單一 iPad。

## 2. 必要限制與設計決策

### 2.1 教育部資料的使用方式

- 來源網站：https://edutreemap.moe.edu.tw/
- 教育部平臺可管理照片、座標、樹高、樹圍、樹種等欄位，也可匯出統計報表。
- V1 不假設該網站提供匿名公開 API。
- 使用者先在教育部平臺取得本校資料檔，再於本 App 手動上傳。
- 上傳後必須顯示「檔名、筆數、欄位對應、錯誤筆數、前三筆預覽」，經確認後才算完成。

### 2.2 Gemini API 安全

- GitHub Pages 是公開前端，不能把 Gemini API Key 寫入程式碼、環境檔或 GitHub repository。
- V1 前端先完成相機、位置、資料篩選、辨識互動與候選結果 GUI。
- 正式 AI 連線使用 Cloudflare Worker 或 Vercel Function 作為安全代理。
- 前端只呼叫自有端點，API Key 儲存在 serverless secret。
- 若只部署 GitHub Pages 而尚未部署代理，切換至 `mock` 模式，以固定測試資料驗證完整操作流程。

### 2.3 隱私

- 不蒐集姓名、座號、帳號或學生持續移動軌跡。
- 定位只在使用者按下按鈕後取得。
- 位置用途：確認學校、為樹木紀錄建立單一點位、縮小候選樹種。
- 照片在上傳 AI 前顯示提示；V1 本機模式不自動同步雲端。

## 3. 使用者流程與解鎖條件

```text
首頁：行前確認
  ├─ A. iPad 權限確認
  │    ├─ 相機
  │    ├─ 位置
  │    └─ 動作與方向
  ├─ B. 取得位置並確認學校
  └─ C. 上傳校園樹木名冊並確認資料
          ↓ 三項都完成
第 2 步：AI 拍攝與樹種辨識
          ↓
第 3 步：Top 3 候選與人工確認
          ↓
第 4 步：離地 1.3 m 處直接量樹徑並人工輸入
          ↓
第 5 步：樹高、碳儲量、結果與本機保存
```

首頁的「進入第 2 步」按鈕必須同時符合：

```ts
const canStartAI =
  sensorPermissionChecked &&
  schoolLocationConfirmed &&
  importedTreeCount > 0;
```

## 4. GUI 規格

### 4.1 共用版面

- 頂端：產品名稱與「iPad 現地模式」。
- 五步驟進度列：行前確認、AI 辨識、確認樹種、量測直徑、碳儲量。
- 戶外高可讀性：高對比、最小觸控區 44 px、大按鈕、避免過細文字。
- iPad 橫式三欄；直式改為單欄。

### 4.2 首頁

- 卡片 1：權限狀態與單一觸發按鈕。
- 卡片 2：學校名稱、定位結果、確認本校。
- 卡片 3：教育部平臺連結、檔案上傳區、匯入摘要。
- 底部：未完成原因或進入第 2 步按鈕。
- 頁面明示「不需登入」與「資料暫存在本 iPad」。

### 4.3 AI 辨識頁

- 左側：即時相機畫面與拍攝控制。
- 右側：AI 下一個觀察提示。
- 觀察證據順序：整棵樹、完整葉片與葉柄、樹皮、花或果實。
- AI 查詢上下文：學校位置、日期、上傳名冊中的樹種候選。
- 回傳 Top 3、信心度、判斷依據、尚缺證據。
- 必須顯示「AI 初判不是正式鑑定」。

### 4.4 量測頁（已修正）

- 顯示離地 $1.3\text{ m}$ 胸高位置教學圖。
- 學生使用直徑尺、卡尺或其他指定工具，直接量樹徑。
- 欄位名稱：`胸高直徑 DBH（cm）`。
- 必須由學生人工輸入，不輸入樹圍，也不以 $DBH=C\div\pi$ 自動換算。
- 驗證範圍預設為 $1\text{ cm}$ 至 $300\text{ cm}$，超出範圍須提示複核但不得靜默修改。

## 5. 功能模組

| 模組 | V1 功能 | 儲存位置 |
|---|---|---|
| DeviceCapability | 相機、定位、方向權限檢查 | React state |
| SchoolContext | 學校名稱、經緯度、確認狀態 | IndexedDB |
| TreeImporter | CSV/TSV/XLSX 解析、欄位對應、預覽、驗證 | IndexedDB |
| CameraCapture | 後鏡頭預覽與拍照 | 記憶體／IndexedDB |
| SpeciesIdentifier | mock／secure proxy adapter、Top 3 結果 | IndexedDB |
| SpeciesConfirmation | 學生或老師人工確認 | IndexedDB |
| Measurement | DBH 人工輸入、樹高輸入 | IndexedDB |
| CarbonCalculator | 依已核定公式與係數計算 | 前端純函式 |
| Exporter | 匯出 JSON／CSV | 下載檔案 |

## 6. 建議資料模型

```ts
type CampusTreeReference = {
  sourceId: string;
  speciesCommonName: string;
  speciesScientificName?: string;
  locationText?: string;
  latitude?: number;
  longitude?: number;
  source: "edutreemap";
};

type SurveyRecord = {
  id: string;
  schoolName: string;
  latitude: number;
  longitude: number;
  observedAt: string;
  photoIds: string[];
  aiCandidates: SpeciesCandidate[];
  confirmedSpecies: string;
  confirmedBy: "student" | "teacher";
  dbhCm: number;
  heightM?: number;
  carbonMethodVersion: string;
  estimatedCo2Kg?: number;
  syncState: "local-only" | "exported";
};
```

## 7. 資料匯入規則

第一版優先支援：`.csv`、`.tsv`、`.xlsx`。

欄位自動對應別名：

| 標準欄位 | 可接受名稱範例 |
|---|---|
| sourceId | 編號、樹木編號、序號、ID |
| speciesCommonName | 樹種、中文名稱、樹木名稱 |
| latitude | 緯度、lat、Latitude |
| longitude | 經度、lng、lon、Longitude |
| locationText | 位置、校內位置、地點 |
| heightM | 樹高、樹高公尺 |

匯入時不得直接假設第一欄或固定欄序；若自動對應失敗，顯示人工欄位對應畫面。

## 8. 技術架構

### 8.1 前端

- React + TypeScript。
- 響應式 iPad-first GUI。
- PWA manifest，可加入 iPad 主畫面。
- Camera：`navigator.mediaDevices.getUserMedia()`。
- 定位：`navigator.geolocation.getCurrentPosition()`。
- iOS 動作感測器：必須由使用者點擊後呼叫 `DeviceMotionEvent.requestPermission()`。
- 本機資料：IndexedDB；少量偏好可用 localStorage。
- CSV：正式版採 Papa Parse 或經測試的自有解析器。
- XLSX：採 SheetJS 等前端解析器，並限制檔案大小與列數。

### 8.2 AI 介面合約

```ts
interface SpeciesIdentifier {
  identify(input: {
    imageBlobs: Blob[];
    latitude: number;
    longitude: number;
    observedAt: string;
    campusSpecies: string[];
  }): Promise<SpeciesCandidate[]>;
}
```

實作兩個 adapter：

- `MockSpeciesIdentifier`：GitHub Pages GUI 驗證與離線測試。
- `GeminiProxySpeciesIdentifier`：呼叫安全代理，不接觸 API Key。

### 8.3 部署

- 前端：GitHub repository + GitHub Actions + GitHub Pages。
- AI 代理：Cloudflare Worker 或 Vercel Function。
- GitHub Pages 與相機／定位功能必須使用 HTTPS。

## 9. 專案目錄

```text
tree-carbon-edu/
├─ app/
│  ├─ page.tsx
│  ├─ globals.css
│  └─ manifest.ts
├─ components/
│  ├─ setup/
│  ├─ recognition/
│  ├─ measurement/
│  └─ result/
├─ lib/
│  ├─ device/
│  ├─ import/
│  ├─ ai/
│  ├─ carbon/
│  └─ storage/
├─ docs/
│  └─ WEBAPP_PLAN.md
├─ public/
└─ tests/
```

## 10. 分階段實作清單

### Milestone 1：GUI 與入口鎖定

- [x] iPad-first 首頁 GUI。
- [x] 三項行前確認狀態。
- [x] 未完成不得進 AI 頁。
- [x] AI 拍攝頁 GUI。
- [x] 將第 4 步修正為 DBH 人工輸入。
- [ ] 將目前單頁狀態拆成模組與路由。

### Milestone 2：資料匯入與本機保存

- [ ] 正式 CSV/TSV parser。
- [ ] 正式 XLSX parser。
- [ ] 欄位自動對應與人工修正。
- [ ] 資料品質檢查與預覽。
- [ ] IndexedDB repository。
- [ ] 重開 App 可接續未完成調查。

### Milestone 3：AI 辨識

- [ ] 相機多張證據拍攝。
- [ ] mock adapter。
- [ ] Gemini 安全代理。
- [ ] 根據校園名冊縮小候選。
- [ ] Top 3、依據、缺少特徵。
- [ ] 人工確認與老師修正。

### Milestone 4：量測與碳儲量

- [ ] $1.3\text{ m}$ 胸高教學畫面。
- [ ] DBH（cm）人工輸入與驗證。
- [ ] 樹高人工輸入。
- [ ] 公式、參數來源與版本管理。
- [ ] 結果卡、研究員模式、CSV/JSON 匯出。

### Milestone 5：iPad 實機與發布

- [ ] Safari 權限拒絕／重新開啟指引。
- [ ] iPad 橫式、直式、鎖定畫面測試。
- [ ] 無網路與中斷恢復測試。
- [ ] GitHub Actions 部署 GitHub Pages。
- [ ] 校園現地試用與教師驗收。

## 11. 驗收條件

1. 未登入即可使用首頁。
2. 尚未完成任一必要項目時，AI 按鈕不可按。
3. 權限只能由明確的使用者操作觸發。
4. 學校位置必須由使用者按下「確認是本校」。
5. 樹木資料至少成功匯入一筆才可進下一步。
6. 上傳檔格式錯誤、空檔、缺少樹種欄位時不得假裝成功。
7. AI 結果必須包含人工確認步驟。
8. DBH 必須是離地 $1.3\text{ m}$ 處的直徑人工輸入值。
9. 不得在 GitHub Pages 前端出現 Gemini API Key。
10. iPad Safari 直式與橫式皆可完整操作，主要按鈕觸控區不小於 44 px。

## 12. Codex 執行指令

```text
請依 docs/WEBAPP_PLAN.md 繼續完成 TreeCarbon EDU。

優先完成 Milestone 2，再進入 Milestone 3。不得加入登入功能；不得把任何 AI API Key 放到前端。首頁的三項行前確認必須全部完成，才可進入 AI 辨識。第 4 步必須是在離地 1.3 m 處直接測量 DBH，並由學生人工輸入，不得以樹圍換算。

每完成一個 Milestone：
1. 執行 production build。
2. 測試 iPad 直式與橫式版面。
3. 更新本文件的勾選狀態。
4. 提交一個清楚命名的 Git commit。
```

## 13. 計算備註

V1 的教學重點是「碳儲量」，不是一年吸存量。正式公式與係數必須在 Milestone 4 經教師核定並標示來源、適用樹種與方法版本後才能上線。

```markdown
胸高位置：$1.3\text{ m}$

胸高直徑：$DBH\text{（cm）}$

樹高：$H\text{（m）}$

第 4 步必須是在離地 $1.3\text{ m}$ 處直接量測樹徑（直徑），由學生人工輸入。
```
