import "dotenv/config";
import express from "express";
import cors from "cors";
import pg from "pg";
pg.types.setTypeParser(1082, (value) => value);
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw Error("請在 server/.env 設定至少 32 字元的 JWT_SECRET");
if (!process.env.DATABASE_URL) throw Error("請設定 DATABASE_URL");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, args = []) => pool.query(sql, args);
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, msg, status = 400) =>
  res.status(status).json({ error: msg });
const validDate = (x) => {
  if (x === null || x === undefined || x === "") {
    return true;
  }

  // PostgreSQL 回傳 Date 物件
  if (x instanceof Date) {
    return !Number.isNaN(x.getTime());
  }

  // 只接受字串或 Date
  if (typeof x !== "string") {
    return false;
  }

  // PostgreSQL 或前端可能回傳 ISO 日期時間字串
  // 例如：2025-04-29T00:00:00.000Z
  const match = x.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);

  if (!match) {
    return false;
  }

  const datePart = match[1];
  const d = new Date(datePart + "T00:00:00Z");

  return (
    !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === datePart
  );
};
const monthOK = (x) => /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
const statuses = ["UNOPENED", "OPENED", "FINISHED", "DISCARDED"];
const validItem = (x) =>
  statuses.includes(x.status || "UNOPENED") &&
  validDate(x.expiry_date) &&
  validDate(x.opened_at) &&
  (x.pao_months == null ||
    x.pao_months === "" ||
    (Number.isInteger(Number(x.pao_months)) && Number(x.pao_months) > 0)) &&
  ((x.status || "UNOPENED") !== "OPENED" || !!x.opened_at);
const emailOf = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const dateSQL = `CASE WHEN i.status='UNOPENED' THEN i.expiry_date WHEN i.status='OPENED' THEN CASE WHEN i.expiry_date IS NOT NULL AND i.opened_at IS NOT NULL AND i.pao_months IS NOT NULL THEN LEAST(i.expiry_date,(i.opened_at + make_interval(months => i.pao_months))::date) WHEN i.expiry_date IS NOT NULL THEN i.expiry_date WHEN i.opened_at IS NOT NULL AND i.pao_months IS NOT NULL THEN (i.opened_at + make_interval(months => i.pao_months))::date ELSE NULL END ELSE NULL END`;
const itemFields = `i.*,p.name,p.series,p.shade,b.name brand,c.name category,${dateSQL} effective_expiry`;

app.post(
  "/api/auth/register",
  wrap(async (req, res) => {
    const email = emailOf(req.body.email),
      password = req.body.password;
    if (
      !/^\S+@\S+\.\S+$/.test(email) ||
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 72
    )
      return fail(res, "請輸入有效 Email 與 8～72 字元密碼");
    const hash = await bcrypt.hash(password, 10);
    try {
      const r = await q(
        "INSERT INTO users(email,password_hash,role,is_active) VALUES($1,$2,'USER',TRUE) RETURNING id,email",
        [email, hash],
      );
      return res.status(201).json({
        id: r.rows[0].id,
        email: r.rows[0].email,
        message: "註冊成功，請登入",
      });
    } catch (e) {
      if (e.code === "23505") return fail(res, "Email 已被註冊", 409);
      throw e;
    }
  }),
);
app.post(
  "/api/auth/login",
  wrap(async (req, res) => {
    const email = emailOf(req.body.email),
      password = req.body.password;
    if (!email || typeof password !== "string")
      return fail(res, "帳號或密碼錯誤", 401);
    const r = await q(
      "SELECT id,email,password_hash,role,is_active FROM users WHERE lower(email)=lower($1)",
      [email],
    );
    if (
      !r.rows[0] ||
      !(await bcrypt.compare(password, r.rows[0].password_hash))
    )
      return fail(res, "帳號或密碼錯誤", 401);
    if (!r.rows[0].is_active) return fail(res, "此帳號已停用", 403);
    res.json({
      token: jwt.sign({ sub: r.rows[0].id }, secret, { expiresIn: "2h" }),
      email: r.rows[0].email,
      role: r.rows[0].role,
      expiresIn: 7200,
    });
  }),
);
const auth = wrap(async (req, res, next) => {
  let data;
  try {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    data = jwt.verify(token, secret);
  } catch {
    return fail(res, "請先登入", 401);
  }
  const r = await q("SELECT id,email,role,is_active FROM users WHERE id=$1", [
    data.sub,
  ]);
  if (!r.rows[0] || !r.rows[0].is_active)
    return fail(res, "帳號已停用或不存在", 401);
  req.user = r.rows[0].id;
  req.role = r.rows[0].role;
  req.email = r.rows[0].email;
  next();
});
app.use("/api", auth);
const admin = (req, res, next) =>
  req.role === "ADMIN" ? next() : fail(res, "沒有管理員權限", 403);
app.get("/api/me", (req, res) =>
  res.json({ id: req.user, email: req.email, role: req.role }),
);

app.get(
  "/api/catalog",
  wrap(async (req, res) => {
    const [brands, categories, products] = await Promise.all([
      q("SELECT * FROM brands ORDER BY name"),
      q("SELECT * FROM categories ORDER BY name"),
      q(
        "SELECT p.*,b.name brand,c.name category FROM products p JOIN brands b ON b.id=p.brand_id JOIN categories c ON c.id=p.category_id ORDER BY p.name",
      ),
    ]);
    res.json({
      brands: brands.rows,
      categories: categories.rows,
      products: products.rows,
    });
  }),
);
app.post(
  "/api/catalog",
  wrap(async (req, res) => {
    const { brand, category, name, series, shade } = req.body;
    if (!brand?.trim() || !category?.trim() || !name?.trim())
      return fail(res, "品牌、分類與名稱必填");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      // 相同名稱（忽略前後空白及大小寫）使用同一筆主檔；交易鎖避免同時新增造成重複。
      const findOrCreate = async (table, input) => {
        const clean = input.trim();
        await c.query(
          "SELECT pg_advisory_xact_lock(hashtext($1),hashtext(lower($2)))",
          [table, clean],
        );
        const old = await c.query(
          `SELECT id FROM ${table} WHERE lower(btrim(name))=lower($1) ORDER BY id LIMIT 1`,
          [clean],
        );
        if (old.rowCount) return old.rows[0].id;
        const added = await c.query(
          `INSERT INTO ${table}(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
          [clean],
        );
        return added.rows[0].id;
      };
      const brandId = await findOrCreate("brands", brand);
      const categoryId = await findOrCreate("categories", category);
      const args = [
        brandId,
        categoryId,
        name.trim(),
        series?.trim() || null,
        shade?.trim() || null,
      ];
      const p = await c.query(
        "INSERT INTO products(brand_id,category_id,name,series,shade) VALUES($1,$2,$3,$4,$5) ON CONFLICT (brand_id,category_id,name,series,shade) DO NOTHING RETURNING *",
        args,
      );
      const found =
        p.rows[0] ||
        (
          await c.query(
            "SELECT * FROM products WHERE brand_id=$1 AND category_id=$2 AND name=$3 AND series IS NOT DISTINCT FROM $4 AND shade IS NOT DISTINCT FROM $5",
            args,
          )
        ).rows[0];
      await c.query("COMMIT");
      res
        .status(p.rowCount ? 201 : 200)
        .json({ ...found, existing: !p.rowCount });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }),
);
app.get(
  "/api/items",
  wrap(async (req, res) => {
    const r = await q(
      `SELECT ${itemFields} FROM product_items i JOIN products p ON p.id=i.product_id JOIN brands b ON b.id=p.brand_id JOIN categories c ON c.id=p.category_id WHERE i.user_id=$1 ORDER BY i.status,i.expiry_date NULLS LAST`,
      [req.user],
    );
    res.json(r.rows);
  }),
);
app.post(
  "/api/items",
  wrap(async (req, res) => {
    const x = req.body;
    if (!x.product_id || !validItem(x))
      return fail(res, "庫存資料不正確，OPENED 必須提供開封日期");
    if (x.purchase_item_id) {
      const source = await q(
        "SELECT 1 FROM purchase_items pi JOIN purchases pu ON pu.id=pi.purchase_id WHERE pi.id=$1 AND pi.product_id=$2 AND pu.user_id=$3",
        [x.purchase_item_id, x.product_id, req.user],
      );
      if (!source.rowCount) return fail(res, "購買明細與會員或產品不符", 403);
    }
    const r = await q(
      "INSERT INTO product_items(user_id,product_id,purchase_item_id,expiry_date,opened_at,pao_months,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        req.user,
        x.product_id,
        x.purchase_item_id || null,
        x.expiry_date || null,
        x.opened_at || null,
        x.pao_months || null,
        x.status || "UNOPENED",
      ],
    );
    res.status(201).json(r.rows[0]);
  }),
);
app.patch(
  "/api/items/:id",
  wrap(async (req, res) => {
    const old = await q(
      "SELECT * FROM product_items WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user],
    );

    if (!old.rowCount) {
      return fail(res, "找不到庫存", 404);
    }

    const x = { ...old.rows[0], ...req.body };

    if (!validItem(x)) {
      return fail(res, "庫存資料不正確，請檢查狀態、日期與 PAO");
    }

    const r = await q(
      `UPDATE product_items
     SET status=$1, expiry_date=$2, opened_at=$3, pao_months=$4
     WHERE id=$5 AND user_id=$6
     RETURNING *`,
      [
        x.status,
        x.expiry_date || null,
        x.opened_at || null,
        x.pao_months || null,
        req.params.id,
        req.user,
      ],
    );

    res.json(r.rows[0]);
  }),
);
app.delete(
  "/api/items/:id",
  wrap(async (req, res) => {
    const r = await q("DELETE FROM product_items WHERE id=$1 AND user_id=$2", [
      req.params.id,
      req.user,
    ]);
    res.json({ deleted: r.rowCount > 0 });
  }),
);
app.get(
  "/api/reminders",
  wrap(async (req, res) => {
    const r = await q(
      `SELECT ${itemFields} FROM product_items i JOIN products p ON p.id=i.product_id JOIN brands b ON b.id=p.brand_id JOIN categories c ON c.id=p.category_id WHERE i.user_id=$1 AND i.status IN ('UNOPENED','OPENED') ORDER BY effective_expiry NULLS LAST`,
      [req.user],
    );
    res.json(
      r.rows.map((x) => ({
        ...x,
        missing:
          x.status === "UNOPENED"
            ? x.expiry_date
              ? []
              : ["缺少有效期限"]
            : [
                ...(!x.expiry_date ? ["缺少有效期限"] : []),
                ...(!x.opened_at || !x.pao_months
                  ? ["缺少開封後使用期限（PAO）"]
                  : []),
              ],
      })),
    );
  }),
);
app.get(
  "/api/reviews",
  wrap(async (req, res) => {
    const r = await q(
      "SELECT r.*,p.name,b.name brand,p.shade FROM reviews r JOIN products p ON p.id=r.product_id JOIN brands b ON b.id=p.brand_id WHERE r.user_id=$1 ORDER BY r.created_at DESC,r.id DESC",
      [req.user],
    );
    res.json(r.rows);
  }),
);
app.post(
  "/api/reviews",
  wrap(async (req, res) => {
    const { product_id, rating, comment, repurchase_intent } = req.body;
    if (
      !product_id ||
      !Number.isInteger(Number(rating)) ||
      Number(rating) < 1 ||
      Number(rating) > 5 ||
      !["YES", "NO", "UNSURE"].includes(repurchase_intent) ||
      String(comment || "").length > 2000
    )
      return fail(res, "心得資料格式錯誤");
    const owned = await q(
      "SELECT 1 FROM product_items WHERE user_id=$1 AND product_id=$2 UNION SELECT 1 FROM purchases pu JOIN purchase_items pi ON pi.purchase_id=pu.id WHERE pu.user_id=$1 AND pi.product_id=$2 LIMIT 1",
      [req.user, product_id],
    );
    if (!owned.rowCount)
      return fail(res, "需曾購買或持有此產品才能新增心得", 403);
    const r = await q(
      "INSERT INTO reviews(user_id,product_id,rating,comment,repurchase_intent) VALUES($1,$2,$3,$4,$5) RETURNING *",
      [
        req.user,
        product_id,
        Number(rating),
        comment || null,
        repurchase_intent,
      ],
    );
    res.status(201).json(r.rows[0]);
  }),
);
app.get(
  "/api/purchases",
  wrap(async (req, res) => {
    const r = await q(
      "SELECT pu.id,pu.purchase_date,pi.quantity,pi.unit_price,pi.product_id,p.name,b.name brand,(pi.quantity*pi.unit_price) total FROM purchases pu JOIN purchase_items pi ON pi.purchase_id=pu.id JOIN products p ON p.id=pi.product_id JOIN brands b ON b.id=p.brand_id WHERE pu.user_id=$1 ORDER BY pu.purchase_date DESC,pu.created_at DESC",
      [req.user],
    );
    res.json(r.rows);
  }),
);
app.post(
  "/api/purchases",
  wrap(async (req, res) => {
    const date = req.body.purchase_date,
      lines = Array.isArray(req.body.items) ? req.body.items : [req.body];
    if (!date || !validDate(date) || !lines.length || lines.length > 50)
      return fail(res, "購買日期或明細不正確");
    for (const x of lines)
      if (
        !x.product_id ||
        !Number.isInteger(Number(x.quantity)) ||
        Number(x.quantity) < 1 ||
        Number(x.quantity) > 100 ||
        !Number.isFinite(Number(x.unit_price)) ||
        Number(x.unit_price) < 0 ||
        !validDate(x.expiry_date)
      )
        return fail(res, "購買明細格式錯誤");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const p = await c.query(
        "INSERT INTO purchases(user_id,purchase_date) VALUES($1,$2) RETURNING id",
        [req.user, date],
      );
      let total = 0,
        count = 0;
      for (const x of lines) {
        const n = Number(x.quantity),
          price = Number(x.unit_price);
        const pi = await c.query(
          "INSERT INTO purchase_items(purchase_id,product_id,quantity,unit_price) VALUES($1,$2,$3,$4) RETURNING id",
          [p.rows[0].id, x.product_id, n, price],
        );
        await c.query(
          "INSERT INTO product_items(user_id,product_id,purchase_item_id,expiry_date,status) SELECT $1,$2,$3,$4,'UNOPENED' FROM generate_series(1,$5)",
          [req.user, x.product_id, pi.rows[0].id, x.expiry_date || null, n],
        );
        await c.query(
          "UPDATE wishlists SET status='PURCHASED' WHERE user_id=$1 AND product_id=$2 AND status='CONSIDERING'",
          [req.user, x.product_id],
        );

        total += n * price;
        count += n;
      }

      await c.query("COMMIT");
      res.status(201).json({ id: p.rows[0].id, total, created_items: count });
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }),
);
app.get(
  "/api/wishlist",
  wrap(async (req, res) => {
    const r = await q(
      "SELECT w.*,p.name,p.shade,b.name brand FROM wishlists w JOIN products p ON p.id=w.product_id JOIN brands b ON b.id=p.brand_id WHERE w.user_id=$1 ORDER BY w.created_at DESC",
      [req.user],
    );
    res.json(r.rows);
  }),
);
app.post(
  "/api/wishlist",
  wrap(async (req, res) => {
    const { product_id, expected_price, consideration_date } = req.body;
    if (
      !product_id ||
      expected_price === "" ||
      !Number.isFinite(Number(expected_price)) ||
      Number(expected_price) < 0 ||
      !validDate(consideration_date)
    )
      return fail(res, "願望資料不正確");
    const r = await q(
      `INSERT INTO wishlists(user_id,product_id,expected_price,consideration_date,status) VALUES($1,$2,$3,$4,'CONSIDERING') ON CONFLICT (user_id,product_id) WHERE status='CONSIDERING' DO UPDATE SET expected_price=EXCLUDED.expected_price,consideration_date=EXCLUDED.consideration_date RETURNING *`,
      [req.user, product_id, expected_price, consideration_date || null],
    );
    res.status(201).json(r.rows[0]);
  }),
);
app.patch(
  "/api/wishlist/:id",
  wrap(async (req, res) => {
    if (!["CONSIDERING", "PURCHASED", "CANCELLED"].includes(req.body.status))
      return fail(res, "狀態不正確");
    const r = await q(
      "UPDATE wishlists SET status=$1 WHERE id=$2 AND user_id=$3 RETURNING *",
      [req.body.status, req.params.id, req.user],
    );
    if (!r.rowCount) return fail(res, "找不到願望", 404);
    res.json(r.rows[0]);
  }),
);
app.get(
  "/api/budget/:month",
  wrap(async (req, res) => {
    if (!monthOK(req.params.month)) return fail(res, "月份格式不正確");
    const [b, s] = await Promise.all([
      q("SELECT amount FROM budgets WHERE user_id=$1 AND year_month=$2", [
        req.user,
        req.params.month,
      ]),
      q(
        "SELECT COALESCE(SUM(pi.quantity*pi.unit_price),0) spent FROM purchases pu JOIN purchase_items pi ON pi.purchase_id=pu.id WHERE pu.user_id=$1 AND to_char(pu.purchase_date,'YYYY-MM')=$2",
        [req.user, req.params.month],
      ),
    ]);
    res.json({
      amount: Number(b.rows[0]?.amount || 0),
      hasBudget: !!b.rowCount,
      spent: Number(s.rows[0].spent),
    });
  }),
);
app.put(
  "/api/budget/:month",
  wrap(async (req, res) => {
    const amount = Number(req.body.amount);
    if (
      !monthOK(req.params.month) ||
      req.body.amount === "" ||
      !Number.isFinite(amount) ||
      amount < 0
    )
      return fail(res, "預算資料錯誤");
    await q(
      "INSERT INTO budgets(user_id,year_month,amount) VALUES($1,$2,$3) ON CONFLICT(user_id,year_month) DO UPDATE SET amount=EXCLUDED.amount",
      [req.user, req.params.month, amount],
    );
    res.json({ ok: true });
  }),
);
app.get(
  "/api/check/:productId",
  wrap(async (req, res) => {
    const id = req.params.productId;
    const [stock, reviews, purchases, budget] = await Promise.all([
      q(
        "SELECT id,status,expiry_date,opened_at,pao_months FROM product_items WHERE user_id=$1 AND product_id=$2 AND status IN ('UNOPENED','OPENED')",
        [req.user, id],
      ),
      q(
        "SELECT rating,comment,repurchase_intent,created_at FROM reviews WHERE user_id=$1 AND product_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [req.user, id],
      ),
      q(
        "SELECT pu.purchase_date,pi.quantity,pi.unit_price FROM purchases pu JOIN purchase_items pi ON pi.purchase_id=pu.id WHERE pu.user_id=$1 AND pi.product_id=$2 ORDER BY pu.purchase_date DESC",
        [req.user, id],
      ),
      q(
        "SELECT b.amount,(SELECT COALESCE(SUM(pi.quantity*pi.unit_price),0) FROM purchases pu JOIN purchase_items pi ON pi.purchase_id=pu.id WHERE pu.user_id=$1 AND to_char(pu.purchase_date,'YYYY-MM')=to_char(CURRENT_DATE,'YYYY-MM')) spent FROM budgets b WHERE b.user_id=$1 AND b.year_month=to_char(CURRENT_DATE,'YYYY-MM')",
        [req.user],
      ),
    ]);
    res.json({
      stock: stock.rows,
      latest_review: reviews.rows[0] || null,
      purchases: purchases.rows,
      budget: budget.rows[0] || null,
    });
  }),
);

app.get(
  "/api/admin/stats",
  admin,
  wrap(async (req, res) => {
    const r = await q(
      "SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM products) products,(SELECT COUNT(*) FROM product_items) items,(SELECT COUNT(*) FROM reviews) reviews",
    );
    res.json(r.rows[0]);
  }),
);
app.get(
  "/api/admin/users",
  admin,
  wrap(async (req, res) => {
    const r = await q(
      "SELECT id,email,role,is_active,created_at FROM users ORDER BY created_at DESC LIMIT 200",
    );
    res.json(r.rows);
  }),
);
app.patch(
  "/api/admin/users/:id",
  admin,
  wrap(async (req, res) => {
    if (typeof req.body.is_active !== "boolean")
      return fail(res, "請指定啟用狀態");
    if (req.params.id === req.user) return fail(res, "不能停用自己的帳號", 403);
    const r = await q(
      "UPDATE users SET is_active=$1 WHERE id=$2 AND role<>'ADMIN' RETURNING id,email,role,is_active,created_at",
      [req.body.is_active, req.params.id],
    );
    if (!r.rowCount) return fail(res, "找不到可管理的非管理員帳號", 404);
    res.json(r.rows[0]);
  }),
);
app.post(
  "/api/admin/brands",
  admin,
  wrap(async (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 100) return fail(res, "品牌名稱不正確");
    const r = await q("INSERT INTO brands(name) VALUES($1) RETURNING *", [
      name,
    ]);
    res.status(201).json(r.rows[0]);
  }),
);
app.patch(
  "/api/admin/brands/:id",
  admin,
  wrap(async (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 100) return fail(res, "品牌名稱不正確");
    const r = await q("UPDATE brands SET name=$1 WHERE id=$2 RETURNING *", [
      name,
      req.params.id,
    ]);
    if (!r.rowCount) return fail(res, "找不到品牌", 404);
    res.json(r.rows[0]);
  }),
);
app.post(
  "/api/admin/categories",
  admin,
  wrap(async (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 100) return fail(res, "分類名稱不正確");
    const r = await q("INSERT INTO categories(name) VALUES($1) RETURNING *", [
      name,
    ]);
    res.status(201).json(r.rows[0]);
  }),
);
app.patch(
  "/api/admin/categories/:id",
  admin,
  wrap(async (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 100) return fail(res, "分類名稱不正確");
    const r = await q("UPDATE categories SET name=$1 WHERE id=$2 RETURNING *", [
      name,
      req.params.id,
    ]);
    if (!r.rowCount) return fail(res, "找不到分類", 404);
    res.json(r.rows[0]);
  }),
);
app.patch(
  "/api/admin/products/:id",
  admin,
  wrap(async (req, res) => {
    const { name, series, shade, brand_id, category_id } = req.body;
    if (!name?.trim() || !brand_id || !category_id)
      return fail(res, "產品名稱、品牌、分類必填");
    const r = await q(
      "UPDATE products SET name=$1,series=$2,shade=$3,brand_id=$4,category_id=$5 WHERE id=$6 RETURNING *",
      [
        name.trim(),
        series?.trim() || null,
        shade?.trim() || null,
        brand_id,
        category_id,
        req.params.id,
      ],
    );
    if (!r.rowCount) return fail(res, "找不到產品", 404);
    res.json(r.rows[0]);
  }),
);
app.delete(
  "/api/admin/products/:id",
  admin,
  wrap(async (req, res) => {
    try {
      const r = await q("DELETE FROM products WHERE id=$1 RETURNING id", [
        req.params.id,
      ]);
      if (!r.rowCount) return fail(res, "找不到產品", 404);
      res.json({ deleted: true });
    } catch (e) {
      if (e.code === "23503")
        return fail(res, "產品已有庫存、購買或其他紀錄引用，無法刪除", 409);
      throw e;
    }
  }),
);
app.use((err, req, res, next) => {
  console.error(err);
  const status =
    err.code === "23505"
      ? 409
      : err.code === "23503" || err.code === "23514" || err.code === "22P02"
        ? 400
        : 500;
  res.status(status).json({
    error:
      status === 409
        ? "資料已存在"
        : status === 400
          ? "資料違反關聯或欄位限制"
          : "伺服器發生錯誤",
  });
});
app.listen(process.env.PORT || 3001, () =>
  console.log("Beauty Keeper API running"),
);
