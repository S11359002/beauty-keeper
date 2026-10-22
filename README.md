# Beauty Keeper｜美麗有數（SRS 對照升級版）

本專案以你上傳的舊版網站為基礎，對照《美麗有數：個人美妝保養品管理與消費分析平台》規格書修訂。保留 React 網站介面與原有十張 PostgreSQL 資料表。

## Windows / VS Code 啟動方式

1. **先備份原有 `beauty_keeper` 資料庫**（pgAdmin → Databases → beauty_keeper → Backup）。不要刪除原資料庫。
2. pgAdmin 選擇 `beauty_keeper` → Query Tool，先執行以下**唯讀**查詢，確認沒有重複資料：

```sql
SELECT brand_id,category_id,name,series,shade,COUNT(*)
FROM products GROUP BY brand_id,category_id,name,series,shade HAVING COUNT(*)>1;
SELECT user_id,product_id,COUNT(*)
FROM wishlists WHERE status='CONSIDERING'
GROUP BY user_id,product_id HAVING COUNT(*)>1;
```

3. 如果查詢有任何結果，**先不要執行 migration**：必須先判斷哪些紀錄應合併，避免誤刪。若兩個查詢都沒有資料列，打開 `db/migrate_existing.sql`，在 Query Tool 執行（需要 PostgreSQL 15+，建議 16）。這會新增 `is_active`（若尚無）、產品與願望唯一索引及期限查詢索引，不刪除原有資料。
4. `server/.env` 設定 `DATABASE_URL` 與至少 32 字元的強隨機 `JWT_SECRET`。請保留本機的 `.env`，不要傳給別人或放進 ZIP/Git。
5. 在專案根目錄執行：

```powershell
npm run install:all
npm run dev
```

6. 打開 http://localhost:5173。**註冊完成後請再登入一次**；註冊不直接核發 JWT，符合 FR-01。舊帳號可用原密碼登入，除非原資料庫的密碼雜湊與輸入的密碼本來就不匹配。

### 管理員登入

只有 `role='ADMIN'` 的帳號會出現「管理後台」。既有 ADMIN 帳號可以直接登入。若你要在**自己掌控的本機開發資料庫**指定管理者，可在 pgAdmin 依自己的 Email 執行：

```sql
UPDATE users SET role='ADMIN' WHERE email='你自己的登入Email';
```

登出後重新登入，才能更新畫面角色。不要將公開網站的一般會員任意升權。

## 對照 SRS 功能

- **FR-01** 註冊只回傳會員 ID（201）、登入核發 2 小時 JWT；bcrypt cost=10；每次受保護請求重查 `is_active` 和 `role`，停用立即拒絕。
- **FR-02** 共用產品依五欄複合唯一索引（NULLS NOT DISTINCT）防重複；同款可有多筆庫存；OPENED 必須提供開封日；購買來源需符合本人與產品。
- **FR-03** UNOPENED 只計包裝期限；OPENED 取包裝與 PAO 中可計算的較早日期；FINISHED/DISCARDED 不提醒。提供 `/api/reminders` 的資料缺漏提示。前端顯示即時期限，不使用背景排程。
- **FR-04** 購物前顯示自己的庫存、最新心得、歷史購買與當月預算；另提供 `/api/check/:productId`。
- **FR-05** 購買交易可接收單品或 `items` 明細陣列；建立購買、明細、逐件庫存，並將有效願望改成 PURCHASED，單一交易內提交／回滾；月預算可超支。
- **FR-06** 同會員同產品只允許一筆 CONSIDERING 願望，重複加入更新原筆。
- **FR-07** 曾持有（包括已用完／丟棄）或曾購買才可寫心得；多筆歷史依建立時間排序。
- **FR-08** 管理後台提供聚合統計、會員基本資料與啟停、品牌／分類維護、共用產品修改與刪除保護；不提供會員私人資料。

## 已知限制與驗收狀態

- 前端購買表單目前一次填一種產品；後端已支援同一筆購買多種產品。
- 前端管理員的產品編輯目前提供名稱修改；後端 API 支援品牌、分類、系列、色號完整修改。
- 期限計算的前端日期使用瀏覽器本地日期，正式部署時仍應統一設定時區。
- **尚未執行 SRS 的 16 個完整驗收案例、100 虛擬使用者負載測試或 10,000 筆資料的 P95 測試**；因此不宣稱已通過 NFR-01/NFR-02。
- 正式公開部署仍需 HTTPS、權限／輸入驗證的安全測試、備份、日誌與防暴力登入限制。
- Chrome 的外洩密碼警告來自瀏覽器密碼管理工具，不等同於 API 401；若舊帳號仍 401，應檢查密碼是否正確，勿直接改寫 `password_hash`。
