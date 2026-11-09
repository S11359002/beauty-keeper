import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Package,
  Clock3,
  Search,
  Wallet,
  Heart,
  NotebookPen,
  LogOut,
  ShieldCheck,
  Plus,
  Trash2,
  ShoppingBag,
  Leaf,
  ArrowRight,
  Menu,
  X,
  Star,
  Check,
  AlertTriangle,
} from "lucide-react";
import "./style.css";
const nav = [
  ["dashboard", "總覽", LayoutDashboard],
  ["inventory", "我的美妝庫", Package],
  ["expiry", "期限提醒", Clock3],
  ["check", "購物前檢查", Search],
  ["spending", "消費管理", Wallet],
  ["wishlist", "願望清單", Heart],
  ["reviews", "使用心得", NotebookPen],
];
const statusName = {
  UNOPENED: "未開封",
  OPENED: "使用中",
  FINISHED: "已用完",
  DISCARDED: "已丟棄",
  CONSIDERING: "考慮中",
  PURCHASED: "已購買",
  CANCELLED: "已取消",
};
const intentName = { YES: "願意回購", NO: "不想回購", UNSURE: "還不確定" };
const money = (n) =>
  "NT$ " + Number(n || 0).toLocaleString("zh-TW", { maximumFractionDigits: 0 });
const today = () => new Date().toLocaleDateString("en-CA");
const month = () => today().slice(0, 7);
const api = async (path, opts = {}) => {
  const token = localStorage.getItem("bk_token");
  const r = await fetch("/api" + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...opts.headers,
    },
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "操作失敗");
  return data;
};
const post = (p, d) => api(p, { method: "POST", body: JSON.stringify(d) });
const patch = (p, d) => api(p, { method: "PATCH", body: JSON.stringify(d) });
// 將 PostgreSQL 日期轉換成有效的 JavaScript Date
function parseDBDate(value) {
  if (!value) return null;

  const dateStr = String(value).slice(0, 10);

  // 僅接受 YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return null;
  }

  const date = new Date(`${dateStr}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  // 防止 2026-02-30 等不合法日期被自動修正
  const [year, month, day] = dateStr.split("-").map(Number);

  if (
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

// 計算產品實際到期日
function expiryOf(i) {
  if (["FINISHED", "DISCARDED"].includes(i.status)) {
    return null;
  }

  const expiryDate = parseDBDate(i.expiry_date);

  // 未開封：使用包裝有效期限
  if (i.status === "UNOPENED") {
    return expiryDate;
  }

  // 使用中：比較包裝有效期限與 PAO
  if (i.status === "OPENED") {
    const dates = [];

    if (expiryDate) {
      dates.push(expiryDate);
    }

    const openedDate = parseDBDate(i.opened_at);
    const pao = Number(i.pao_months);

    if (openedDate && Number.isInteger(pao) && pao > 0) {
      const paoDate = new Date(openedDate);

      // 避免月底加月份時跳到錯誤月份
      const originalDay = paoDate.getDate();
      paoDate.setDate(1);
      paoDate.setMonth(paoDate.getMonth() + pao);

      const lastDay = new Date(
        paoDate.getFullYear(),
        paoDate.getMonth() + 1,
        0,
      ).getDate();

      paoDate.setDate(Math.min(originalDay, lastDay));

      dates.push(paoDate);
    }

    if (dates.length === 0) {
      return null;
    }

    return new Date(Math.min(...dates.map((d) => d.getTime())));
  }

  return null;
}
function daysLeft(i) {
  const d = expiryOf(i);
  if (!d) return null;
  const t = new Date(today() + "T12:00:00");
  return Math.round((d - t) / 86400000);
}
function reminderText(i) {
  const days = daysLeft(i);

  if (days === null) return "期限資料不足";
  if (days < 0) return "已過期";
  if (days === 0) return "今天到期";
  if (days <= 30) return `即將到期（剩 ${days} 天）`;

  return `期限 ${expiryOf(i).toLocaleDateString("zh-TW")}`;
}
function missingExpiryInfo(i) {
  if (["FINISHED", "DISCARDED"].includes(i.status)) {
    return "";
  }

  const missing = [];

  if (!parseDBDate(i.expiry_date)) {
    missing.push("包裝有效期限");
  }

  if (i.status === "OPENED") {
    if (!parseDBDate(i.opened_at)) {
      missing.push("開封日期");
    }

    if (
      i.pao_months == null ||
      i.pao_months === "" ||
      Number(i.pao_months) <= 0
    ) {
      missing.push("PAO");
    }
  }

  return missing.length ? "缺少" + missing.join("、") + "資料" : "";
}
function Tag({ children, tone = "neutral" }) {
  return <span className={"tag " + tone}>{children}</span>;
}
function Empty({
  icon: Icon = Package,
  title = "還沒有資料",
  desc = "從新增第一筆紀錄開始吧",
}) {
  return (
    <div className="empty">
      <Icon size={32} strokeWidth={1.4} />
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>
  );
}
function Modal({ title, onClose, children }) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="iconbtn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function CatalogNamePicker({ label, value, onChange, options, placeholder }) {
  const [focused, setFocused] = useState(false);
  const text = (value || "").trim();
  const exact = options.find(
    (x) => x.name.toLocaleLowerCase() === text.toLocaleLowerCase(),
  );
  const matches = options
    .filter((x) =>
      x.name.toLocaleLowerCase().includes(text.toLocaleLowerCase()),
    )
    .slice(0, 8);
  return (
    <div className="field catalog-name-field">
      <span>{label} *</span>
      <input
        required
        autoComplete="off"
        placeholder={placeholder}
        value={value || ""}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => onChange(e.target.value)}
      />
      {focused && (
        <div
          className="catalog-suggestions"
          role="listbox"
          aria-label={label + "建議"}
        >
          {matches.map((x) => (
            <button
              key={x.id}
              type="button"
              role="option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(x.name);
                setFocused(false);
              }}
            >
              {x.name}
            </button>
          ))}
          {text && !exact && (
            <div className="catalog-new">
              <Plus size={14} /> 將新增「{text}」
            </div>
          )}
          {!text && !matches.length && (
            <div className="catalog-new">輸入名稱以新增</div>
          )}
        </div>
      )}
      {text && (
        <small className="catalog-status">
          {exact
            ? "✓ 使用現有" + label + "：" + exact.name
            : "儲存產品時會新增" + label + "：" + text}
        </small>
      )}
    </div>
  );
}
function App() {
  const [token, setToken] = useState(localStorage.getItem("bk_token"));
  const [email, setEmail] = useState(localStorage.getItem("bk_email") || "");
  const [page, setPage] = useState("dashboard");
  const [mobile, setMobile] = useState(false);
  const [modal, setModal] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [catalog, setCatalog] = useState({
    products: [],
    brands: [],
    categories: [],
  });
  const [items, setItems] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [budget, setBudget] = useState({
    amount: 0,
    spent: 0,
    hasBudget: false,
  });
  const [ym, setYm] = useState(month());
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState("");
  const [form, setForm] = useState({});
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [register, setRegister] = useState(false);
  const [role, setRole] = useState("USER");
  const [adminStats, setAdminStats] = useState(null);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminTab, setAdminTab] = useState("users");
  const sessionRef = useRef(0);
  const refresh = useCallback(async () => {
    const requestToken = localStorage.getItem("bk_token");

    if (!requestToken || !token || requestToken !== token) return;

    const requestSession = sessionRef.current;

    const isCurrent = () =>
      sessionRef.current === requestSession &&
      localStorage.getItem("bk_token") === requestToken;

    try {
      const me = await api("/me");
      if (!isCurrent()) return;
      setRole(me.role);
      const [a, b, c, d, e, f] = await Promise.all([
        api("/catalog"),
        api("/items"),
        api("/reviews"),
        api("/purchases"),
        api("/wishlist"),
        api("/budget/" + ym),
      ]);
      if (!isCurrent()) return;
      setCatalog(a);
      setItems(b);
      setReviews(c);
      setPurchases(d);
      setWishlist(e);
      setBudget(f);
    } catch (e) {
      if (!isCurrent()) return;
      if (e.message === "請先登入") {
        localStorage.removeItem("bk_token");
        setToken(null);
      } else setError(e.message);
    }
  }, [token, ym]);
  useEffect(() => {
    sessionRef.current += 1;

    refresh();

    return () => {
      sessionRef.current += 1;
    };
  }, [refresh]);
  const submit = async (e, action) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await action();
      setModal("");
      setForm({});
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  const login = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const d = await post(
        "/auth/" + (register ? "register" : "login"),
        authForm,
      );
      if (register) {
        setRegister(false);
        setAuthForm({ email: authForm.email, password: "" });
        setError("註冊成功，請使用剛剛設定的密碼登入");
        return;
      } // 讓上一個會員尚未完成的請求失效
      sessionRef.current += 1;

      // 清除上一個會員的私人資料
      setItems([]);
      setReviews([]);
      setPurchases([]);
      setWishlist([]);
      setBudget({ amount: 0, spent: 0, hasBudget: false });
      setAdminStats(null);
      setAdminUsers([]);
      setModal("");
      setForm({});

      // 儲存新會員的登入資訊
      localStorage.setItem("bk_token", d.token);
      localStorage.setItem("bk_email", d.email);
      setEmail(d.email);
      setRole(d.role || "USER");
      setAuthForm({ email: "", password: "" });
      setToken(d.token);
    } catch (e) {
      setError(e.message);
    }
  };
  const logout = () => {
    sessionRef.current += 1;
    // 1. 清除登入資訊
    localStorage.removeItem("bk_token");
    localStorage.removeItem("bk_email");

    // 2. 清除上一個會員的私人資料
    setItems([]);
    setReviews([]);
    setPurchases([]);
    setWishlist([]);
    setBudget({ amount: 0, spent: 0, hasBudget: false });

    // 3. 清除管理員資料
    setAdminStats(null);
    setAdminUsers([]);
    setAdminTab("users");

    // 4. 清除畫面與表單狀態
    setModal("");
    setForm({});
    setSearch("");
    setChosen("");
    setMobile(false);
    setError("");
    setLoading(false);

    // 5. 重設登入狀態
    setAuthForm({ email: "", password: "" });
    setEmail("");
    setRole("USER");
    setPage("dashboard");
    setToken(null);
  };
  useEffect(() => {
    if (!token || role !== "ADMIN" || page !== "admin") return;

    const requestSession = sessionRef.current;
    let cancelled = false;

    Promise.all([api("/admin/stats"), api("/admin/users")])
      .then(([stats, users]) => {
        if (
          cancelled ||
          sessionRef.current !== requestSession ||
          localStorage.getItem("bk_token") !== token
        )
          return;

        setAdminStats(stats);
        setAdminUsers(users);
      })
      .catch((e) => {
        if (
          cancelled ||
          sessionRef.current !== requestSession ||
          localStorage.getItem("bk_token") !== token
        )
          return;

        setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [token, role, page]);
  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const open = (m, defaults = {}) => {
    setForm(defaults);
    setError("");
    setModal(m);
  };
  const active = items.filter((i) => ["UNOPENED", "OPENED"].includes(i.status));
  const expiring = active
    .filter((i) => daysLeft(i) !== null && daysLeft(i) <= 30)
    .sort((a, b) => daysLeft(a) - daysLeft(b));
  const filtered = items.filter((i) =>
    (i.brand + " " + i.name + " " + (i.shade || ""))
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const productLabel = (p) =>
    p ? `${p.brand} · ${p.name}${p.shade ? " #" + p.shade : ""}` : "";
  const latestFor = (id) => reviews.find((r) => r.product_id === id);
  const ProductSelect = ({ value, onChange }) => (
    <select
      required
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">選擇產品</option>
      {catalog.products.map((p) => (
        <option key={p.id} value={p.id}>
          {productLabel(p)}
        </option>
      ))}
    </select>
  );
  if (!token)
    return (
      <div className="auth-layout">
        <div className="auth-brand">
          <div className="mark big">
            b<span>✦</span>
          </div>
          <p className="eyebrow">YOUR BEAUTY, BEAUTIFULLY ORGANIZED</p>
          <h1>
            把喜歡的美麗，
            <br />
            <em>好好收藏。</em>
          </h1>
          <p>
            從保存期限、購物紀錄到每一次使用心得，
            <br />
            讓每一件美妝都有屬於自己的位置。
          </p>
          <div className="auth-decoration">✳　✧　✳</div>
        </div>
        <form className="auth-card" onSubmit={login}>
          <div className="mini">BEAUTY KEEPER</div>
          <h2>{register ? "建立你的美妝帳號" : "歡迎回來 ♡"}</h2>
          <p>你的私人美妝整理空間</p>
          <Field label="電子郵件">
            <input
              type="email"
              required
              placeholder="hello@example.com"
              value={authForm.email}
              onChange={(e) =>
                setAuthForm({ ...authForm, email: e.target.value })
              }
            />
          </Field>
          <Field label="密碼">
            <input
              type="password"
              required
              minLength={register ? 8 : 1}
              placeholder="輸入密碼"
              value={authForm.password}
              onChange={(e) =>
                setAuthForm({ ...authForm, password: e.target.value })
              }
            />
          </Field>
          {error && <p className="error">{error}</p>}
          <button className="primary wide">
            {register ? "註冊並開始" : "登入 Beauty Keeper"}{" "}
            <ArrowRight size={17} />
          </button>
          <p className="switch">
            {register ? "已經有帳號？" : "還沒有帳號？"}{" "}
            <button
              type="button"
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "立即登入" : "免費建立帳號"}
            </button>
          </p>
        </form>
      </div>
    );
  const titles = {
    dashboard: ["美妝總覽", "每天一點整理，讓喜歡的東西更值得珍惜。"],
    inventory: ["我的美妝庫", "每一件收藏，都有它自己的位置。"],
    expiry: ["保存期限提醒", "別讓心愛的產品在角落悄悄過期。"],
    check: ["購物前檢查", "下單之前，先看看自己已經擁有什麼。"],
    spending: ["消費與預算", "把每一筆美麗投資，都記得清清楚楚。"],
    wishlist: ["心動願望清單", "先收藏心動，再決定要不要帶回家。"],
    reviews: ["使用心得日記", "今天的心得，會是未來最好的購物指南。"],
    admin: ["管理後台", "帳號、產品主檔與系統統計。"],
  };
  return (
    <div className="app">
      <aside className={"sidebar " + (mobile ? "show" : "")}>
        <div className="logo">
          <div className="mark">
            b<span>✦</span>
          </div>
          <div>
            <strong>Beauty Keeper</strong>
            <small>MY BEAUTY JOURNAL</small>
          </div>
        </div>
        <div className="side-label">MY SPACE</div>
        <nav>
          {(role === "ADMIN"
            ? [...nav, ["admin", "管理後台", ShieldCheck]]
            : nav
          ).map(([id, name, Icon]) => (
            <button
              key={id}
              className={page === id ? "selected" : ""}
              onClick={() => {
                setPage(id);
                setSearch("");
                setMobile(false);
              }}
            >
              <Icon size={19} strokeWidth={1.8} />
              {name}
              {id === "expiry" && expiring.length > 0 && (
                <b className="nav-count">{expiring.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="side-tip">
            <Leaf size={19} />
            <strong>用得剛剛好，就是最好的美麗。</strong>
            <p>珍惜已經擁有的每一件。</p>
          </div>
          <button className="logout" onClick={logout}>
            <LogOut size={17} /> 登出帳號
          </button>
        </div>
      </aside>
      {mobile && <div className="shade" onClick={() => setMobile(false)} />}
      <main className="main">
        <header className="topbar">
          <button className="iconbtn menu" onClick={() => setMobile(true)}>
            <Menu />
          </button>
          <span>MY PERSONAL BEAUTY SPACE</span>
          <div className="profile">
            <span>{email.split("@")[0]}</span>
            <div className="avatar">♡</div>
          </div>
        </header>
        <div className="content">
          <div className="heading">
            <div>
              <p className="eyebrow">BEAUTY KEEPER / {page.toUpperCase()}</p>
              <h1>
                {titles[page][0]}
                <span className="sparkle"> ✳</span>
              </h1>
              <p>{titles[page][1]}</p>
            </div>
            {["inventory", "wishlist", "reviews", "spending"].includes(
              page,
            ) && (
              <button
                className="primary"
                onClick={() =>
                  open(
                    page === "inventory"
                      ? "item"
                      : page === "wishlist"
                        ? "wish"
                        : page === "reviews"
                          ? "review"
                          : "purchase",
                  )
                }
              >
                <Plus size={17} />
                {page === "inventory"
                  ? "新增庫存"
                  : page === "wishlist"
                    ? "加入願望"
                    : page === "reviews"
                      ? "寫心得"
                      : "記錄購買"}
              </button>
            )}
          </div>
          {page === "dashboard" && (
            <>
              <div className="hero">
                <div>
                  <span className="hero-kicker">YOUR BEAUTY COLLECTION</span>
                  <h2>
                    美麗的日常，
                    <br />
                    從了解自己開始。
                  </h2>
                  <p>把已經擁有的好好整理，下一次購物也更安心。</p>
                  <button onClick={() => setPage("inventory")}>
                    整理我的收藏 <ArrowRight size={16} />
                  </button>
                </div>
                <div className="hero-art">
                  <div className="bottle bottle-a" />
                  <div className="bottle bottle-b" />
                  <div className="lipstick" />
                  <span>✦</span>
                </div>
              </div>
              <div className="stats">
                <div>
                  <span>現有美妝</span>
                  <strong>
                    {active.length}
                    <small> 件</small>
                  </strong>
                  <p>未開封與使用中</p>
                </div>
                <div>
                  <span>需注意期限</span>
                  <strong>
                    {expiring.length}
                    <small> 件</small>
                  </strong>
                  <p>30 天內到期／已逾期</p>
                </div>
                <div>
                  <span>本月花費</span>
                  <strong className="money">{money(budget.spent)}</strong>
                  <p>
                    {budget.hasBudget
                      ? "預算 " + money(budget.amount)
                      : "尚未設定月預算"}
                  </p>
                </div>
                <div>
                  <span>願望清單</span>
                  <strong>
                    {wishlist.filter((w) => w.status === "CONSIDERING").length}
                    <small> 件</small>
                  </strong>
                  <p>等待你慢慢考慮</p>
                </div>
              </div>
              <div className="two-col">
                <section className="panel">
                  <div className="panel-head">
                    <h3>期限小提醒</h3>
                    <button className="link" onClick={() => setPage("expiry")}>
                      查看全部 <ArrowRight size={15} />
                    </button>
                  </div>
                  {expiring.length ? (
                    expiring.slice(0, 4).map((i) => (
                      <div className="line-item" key={i.id}>
                        <div className="product-icon">✿</div>
                        <div>
                          <strong>{i.name}</strong>
                          <small>
                            {i.brand} · {i.shade || i.category}
                          </small>
                        </div>
                        <Tag tone={daysLeft(i) < 0 ? "danger" : "warning"}>
                          {reminderText(i)}
                        </Tag>
                      </div>
                    ))
                  ) : (
                    <Empty
                      icon={Clock3}
                      title="目前沒有即將到期的產品"
                      desc="可以放心使用你的收藏 ♡"
                    />
                  )}
                </section>
                <section className="panel">
                  <div className="panel-head">
                    <h3>最近使用心得</h3>
                    <button className="link" onClick={() => setPage("reviews")}>
                      查看全部 <ArrowRight size={15} />
                    </button>
                  </div>
                  {reviews.length ? (
                    reviews.slice(0, 4).map((r) => (
                      <div className="line-item" key={r.id}>
                        <div className="product-icon blush">♡</div>
                        <div>
                          <strong>{r.name}</strong>
                          <small>
                            {r.brand} · {"★".repeat(r.rating)}
                            {"☆".repeat(5 - r.rating)}
                          </small>
                        </div>
                        <Tag
                          tone={
                            r.repurchase_intent === "NO" ? "danger" : "neutral"
                          }
                        >
                          {intentName[r.repurchase_intent]}
                        </Tag>
                      </div>
                    ))
                  ) : (
                    <Empty
                      icon={NotebookPen}
                      title="還沒有使用心得"
                      desc="用過之後，記下真實的感受"
                    />
                  )}
                </section>
              </div>
            </>
          )}
          {page === "inventory" && (
            <>
              <div className="toolbar">
                <div className="searchbox">
                  <Search size={18} />
                  <input
                    placeholder="搜尋品牌、產品名稱或色號..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <button className="secondary" onClick={() => open("product")}>
                  <Plus size={16} /> 建立產品目錄
                </button>
              </div>
              {filtered.length ? (
                <div className="product-grid">
                  {filtered.map((i) => (
                    <div className="product-card" key={i.id}>
                      <div className="product-visual">
                        <span>✿</span>
                        <Tag tone={i.status === "OPENED" ? "pink" : "neutral"}>
                          {statusName[i.status]}
                        </Tag>
                      </div>
                      <div className="product-details">
                        <small>
                          {i.brand} · {i.category}
                        </small>
                        <h3>{i.name}</h3>
                        <p>
                          {i.series || "個人收藏"}{" "}
                          {i.shade ? "· #" + i.shade : ""}
                        </p>
                        <div className="product-bottom">
                          <span>
                            {i.status === "FINISHED"
                              ? "已使用完畢"
                              : i.status === "DISCARDED"
                                ? "已完成丟棄"
                                : daysLeft(i) === null
                                  ? "期限資料不足"
                                  : daysLeft(i) < 0
                                    ? "已過期"
                                    : daysLeft(i) === 0
                                      ? "今天到期"
                                      : daysLeft(i) <= 30
                                        ? "剩 " +
                                          daysLeft(i) +
                                          " 天（即將到期）"
                                        : "期限 " +
                                          expiryOf(i).toLocaleDateString(
                                            "zh-TW",
                                          )}
                          </span>

                          {missingExpiryInfo(i) && (
                            <small className="muted">
                              ⚠ {missingExpiryInfo(i)}
                            </small>
                          )}

                          <select
                            aria-label="修改庫存狀態"
                            value={i.status}
                            onChange={async (e) => {
                              try {
                                const newStatus = e.target.value;
                                const opened_at =
                                  newStatus === "OPENED" && !i.opened_at
                                    ? prompt(
                                        "請輸入開封日期（YYYY-MM-DD）",
                                        today(),
                                      )
                                    : i.opened_at;
                                if (newStatus === "OPENED" && !opened_at)
                                  return;
                                await patch("/items/" + i.id, {
                                  status: newStatus,
                                  opened_at,
                                });
                                refresh();
                              } catch (err) {
                                setError(err.message);
                              }
                            }}
                          >
                            {Object.entries(statusName)
                              .filter(([k]) =>
                                [
                                  "UNOPENED",
                                  "OPENED",
                                  "FINISHED",
                                  "DISCARDED",
                                ].includes(k),
                              )
                              .map(([k, v]) => (
                                <option value={k} key={k}>
                                  {v}
                                </option>
                              ))}
                          </select>
                        </div>
                        <button
                          className="subtle-delete"
                          onClick={async () => {
                            if (confirm("確定刪除這筆庫存？")) {
                              await api("/items/" + i.id, { method: "DELETE" });
                              refresh();
                            }
                          }}
                        >
                          <Trash2 size={14} /> 刪除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title="美妝庫還是空的"
                  desc="先建立產品目錄，再新增你的第一件庫存"
                />
              )}
            </>
          )}
          {page === "expiry" && (
            <section className="panel">
              <div className="panel-head">
                <h3>需要留意的產品</h3>
                <Tag tone="warning">30 天內提醒</Tag>
              </div>
              {expiring.length ? (
                expiring.map((i) => (
                  <div className="line-item" key={i.id}>
                    <div className="product-icon">✿</div>
                    <div>
                      <strong>
                        {i.brand} · {i.name}
                      </strong>
                      <div>
                        <small>
                          期限：{expiryOf(i)?.toLocaleDateString("zh-TW")} ·{" "}
                          {statusName[i.status]}
                        </small>

                        {missingExpiryInfo(i) && (
                          <small
                            className="muted"
                            style={{ display: "block", marginTop: 4 }}
                          >
                            ⚠ {missingExpiryInfo(i)}
                          </small>
                        )}
                      </div>
                    </div>
                    <Tag tone={daysLeft(i) < 0 ? "danger" : "warning"}>
                      {reminderText(i)}
                    </Tag>
                  </div>
                ))
              ) : (
                <Empty
                  icon={Clock3}
                  title="沒有需要提醒的產品"
                  desc="系統會根據有效期限與開封後期限，採用較早日期提醒"
                />
              )}
            </section>
          )}
          {page === "check" && (
            <>
              <section className="panel check-panel">
                <h3>購物前，先查一下 ♡</h3>
                <p>選擇你想買的產品，看看是否已經擁有，以及過去的使用感受。</p>
                <ProductSelect value={chosen} onChange={setChosen} />
                <button className="secondary" onClick={() => open("product")}>
                  找不到產品？先建立目錄
                </button>
              </section>
              {chosen &&
                (() => {
                  const p = catalog.products.find((x) => x.id === chosen),
                    stock = active.filter((i) => i.product_id === chosen),
                    r = latestFor(chosen);
                  return (
                    <div className="two-col result-grid">
                      <section className="panel">
                        <p className="eyebrow">STOCK CHECK</p>
                        <h2>{p?.name}</h2>
                        <p className="muted">
                          {p?.brand} · {p?.shade || p?.category}
                        </p>
                        <div className="result-number">
                          {stock.length}
                          <small> 件現有庫存</small>
                        </div>
                        <p>
                          未開封{" "}
                          {stock.filter((x) => x.status === "UNOPENED").length}{" "}
                          件 · 使用中{" "}
                          {stock.filter((x) => x.status === "OPENED").length} 件
                        </p>
                        {stock.length > 0 && (
                          <Tag tone="warning">你已經擁有這款產品囉</Tag>
                        )}
                      </section>
                      <section className="panel">
                        <p className="eyebrow">YOUR PAST EXPERIENCE</p>
                        <h3>之前的使用心得</h3>
                        {r ? (
                          <>
                            <div className="stars">
                              {"★".repeat(r.rating)}
                              {"☆".repeat(5 - r.rating)}
                            </div>
                            <p>{r.comment || "沒有留下文字心得"}</p>
                            <Tag
                              tone={
                                r.repurchase_intent === "NO" ? "danger" : "pink"
                              }
                            >
                              {intentName[r.repurchase_intent]}
                            </Tag>
                            <p className="muted">
                              共有{" "}
                              {
                                reviews.filter((x) => x.product_id === chosen)
                                  .length
                              }{" "}
                              筆歷史心得
                            </p>
                          </>
                        ) : (
                          <Empty
                            icon={NotebookPen}
                            title="還沒有這款產品的心得"
                            desc="未來可以幫自己留下回購參考"
                          />
                        )}
                      </section>
                      <section className="panel">
                        <h3>歷史購買與當月預算</h3>
                        {purchases.filter((x) => x.product_id === chosen)
                          .length ? (
                          purchases
                            .filter((x) => x.product_id === chosen)
                            .map((x, j) => (
                              <p key={j}>
                                {x.purchase_date?.slice(0, 10)} · {x.quantity}{" "}
                                件 · {money(x.unit_price)}
                              </p>
                            ))
                        ) : (
                          <p>尚無購買紀錄</p>
                        )}
                        <p>
                          本月預算：
                          {budget.hasBudget ? money(budget.amount) : "未設定"}
                        </p>

                        <p>本月已消費：{money(budget.spent)}</p>

                        <p>
                          剩餘預算：
                          {budget.hasBudget
                            ? money(
                                Number(budget.amount) - Number(budget.spent),
                              )
                            : "尚未設定預算"}
                        </p>
                      </section>
                    </div>
                  );
                })()}
            </>
          )}
          {page === "spending" && (
            <>
              <div className="toolbar">
                <Field label="統計月份">
                  <input
                    type="month"
                    value={ym}
                    onChange={(e) => setYm(e.target.value)}
                  />
                </Field>
                <button
                  className="secondary"
                  onClick={() => open("budget", { amount: budget.amount })}
                >
                  設定每月預算
                </button>
              </div>
              <div className="stats spending-stats">
                <div>
                  <span>當月消費</span>
                  <strong className="money">{money(budget.spent)}</strong>
                </div>
                <div>
                  <span>設定預算</span>
                  <strong className="money">
                    {budget.hasBudget ? money(budget.amount) : "尚未設定"}
                  </strong>
                </div>
                <div>
                  <span>剩餘預算</span>

                  <strong
                    className={
                      "money " +
                      (budget.hasBudget && budget.amount - budget.spent < 0
                        ? "negative"
                        : "")
                    }
                  >
                    {budget.hasBudget
                      ? money(budget.amount - budget.spent)
                      : "—"}
                  </strong>

                  {budget.hasBudget &&
                    Number(budget.spent) > Number(budget.amount) && (
                      <small
                        style={{
                          display: "block",
                          color: "#d65f5f",
                          fontSize: "13px",
                          marginTop: "8px",
                        }}
                      >
                        ⓘ 本月已超支{" "}
                        {money(Number(budget.spent) - Number(budget.amount))}
                      </small>
                    )}
                </div>
              </div>
              {budget.hasBudget && (
                <div className="progress">
                  <div
                    style={{
                      width:
                        Math.min(
                          100,
                          budget.amount
                            ? (budget.spent / budget.amount) * 100
                            : 100,
                        ) + "%",
                    }}
                  />
                </div>
              )}
              <section className="panel">
                <div className="panel-head">
                  <h3>購買紀錄</h3>
                  <ShoppingBag size={18} />
                </div>
                {purchases.filter((x) => x.purchase_date?.slice(0, 7) === ym)
                  .length ? (
                  purchases
                    .filter((x) => x.purchase_date?.slice(0, 7) === ym)
                    .map((p, i) => (
                      <div className="line-item" key={p.id + i}>
                        <div className="product-icon">✿</div>
                        <div>
                          <strong>
                            {p.brand} · {p.name}
                          </strong>
                          <small>
                            {p.purchase_date?.slice(0, 10)} · {p.quantity} 件 ×{" "}
                            {money(p.unit_price)}
                          </small>
                        </div>
                        <strong>{money(p.total)}</strong>
                      </div>
                    ))
                ) : (
                  <Empty
                    icon={ShoppingBag}
                    title="這個月還沒有購買紀錄"
                    desc="每筆購買都能自動加入庫存"
                  />
                )}
              </section>
            </>
          )}
          {page === "wishlist" && (
            <>
              <div className="toolbar">
                <button className="secondary" onClick={() => open("product")}>
                  <Plus size={16} /> 建立產品目錄
                </button>
              </div>
              <section className="panel">
                {wishlist.length ? (
                  wishlist.map((w) => (
                    <div className="line-item" key={w.id}>
                      <div className="product-icon blush">♡</div>
                      <div>
                        <strong>
                          {w.brand} · {w.name}
                        </strong>
                        <small>
                          預估 {money(w.expected_price)}{" "}
                          {w.consideration_date
                            ? "· 考慮至 " + w.consideration_date.slice(0, 10)
                            : ""}
                        </small>
                      </div>
                      <select
                        value={w.status}
                        onChange={async (e) => {
                          try {
                            await patch("/wishlist/" + w.id, {
                              status: e.target.value,
                            });
                            refresh();
                          } catch (err) {
                            setError(err.message);
                          }
                        }}
                      >
                        {["CONSIDERING", "PURCHASED", "CANCELLED"].map((k) => (
                          <option key={k} value={k}>
                            {statusName[k]}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))
                ) : (
                  <Empty
                    icon={Heart}
                    title="願望清單還是空的"
                    desc="先記下想買的東西，讓心動有時間沉澱"
                  />
                )}
              </section>
            </>
          )}
          {page === "admin" && role === "ADMIN" && (
            <>
              <div className="stats spending-stats">
                <div>
                  <span>會員總數</span>
                  <strong>{adminStats?.users ?? "—"}</strong>
                </div>
                <div>
                  <span>共用產品</span>
                  <strong>{adminStats?.products ?? "—"}</strong>
                </div>
                <div>
                  <span>庫存總筆數</span>
                  <strong>{adminStats?.items ?? "—"}</strong>
                </div>
                <div>
                  <span>心得總筆數</span>
                  <strong>{adminStats?.reviews ?? "—"}</strong>
                </div>
              </div>
              <div className="toolbar">
                <button
                  className="secondary"
                  onClick={() => setAdminTab("users")}
                >
                  會員管理
                </button>
                <button
                  className="secondary"
                  onClick={() => setAdminTab("products")}
                >
                  產品主檔
                </button>
                <button
                  className="secondary"
                  onClick={() => setAdminTab("brands")}
                >
                  品牌與分類
                </button>
              </div>
              {adminTab === "users" && (
                <section className="panel">
                  <h3>會員帳號（不顯示私人資料）</h3>
                  {adminUsers.map((u) => (
                    <div className="line-item" key={u.id}>
                      <div>
                        <strong>{u.email}</strong>
                        <small>
                          {u.role} ·{" "}
                          {new Date(u.created_at).toLocaleDateString("zh-TW")} ·{" "}
                          {u.is_active ? "啟用" : "停用"}
                        </small>
                      </div>
                      {u.role !== "ADMIN" && (
                        <button
                          className="secondary"
                          onClick={async () => {
                            try {
                              await patch("/admin/users/" + u.id, {
                                is_active: !u.is_active,
                              });
                              setAdminUsers(await api("/admin/users"));
                            } catch (e) {
                              setError(e.message);
                            }
                          }}
                        >
                          {u.is_active ? "停用" : "恢復"}
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              )}
              {adminTab === "products" && (
                <section className="panel">
                  <h3>共用產品主檔</h3>
                  {catalog.products.map((p) => (
                    <div className="line-item" key={p.id}>
                      <div>
                        <strong>
                          {p.brand} · {p.name}
                        </strong>
                        <small>
                          {p.category} · {p.series || "無系列"} ·{" "}
                          {p.shade || "無色號"}
                        </small>
                      </div>
                      <button
                        className="secondary"
                        onClick={async () => {
                          const name = prompt("修改產品名稱", p.name);
                          if (name === null) return;
                          try {
                            await patch("/admin/products/" + p.id, {
                              name,
                              series: p.series,
                              shade: p.shade,
                              brand_id: p.brand_id,
                              category_id: p.category_id,
                            });
                            refresh();
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                      >
                        修改名稱
                      </button>
                      <button
                        className="secondary"
                        onClick={async () => {
                          if (!confirm("確定刪除？有其他資料引用時將拒絕。"))
                            return;
                          try {
                            await api("/admin/products/" + p.id, {
                              method: "DELETE",
                            });
                            refresh();
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                      >
                        刪除
                      </button>
                    </div>
                  ))}
                </section>
              )}
              {adminTab === "brands" && (
                <section className="panel">
                  <h3>品牌管理</h3>
                  <button
                    className="secondary"
                    onClick={async () => {
                      const name = prompt("新品牌名稱");
                      if (!name) return;
                      try {
                        await post("/admin/brands", { name });
                        refresh();
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    新增品牌
                  </button>
                  {catalog.brands.map((b) => (
                    <div className="line-item" key={b.id}>
                      <strong>{b.name}</strong>
                      <button
                        className="secondary"
                        onClick={async () => {
                          const name = prompt("修改品牌", b.name);
                          if (!name) return;
                          try {
                            await patch("/admin/brands/" + b.id, { name });
                            refresh();
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                      >
                        修改
                      </button>
                    </div>
                  ))}
                  <h3>分類管理</h3>
                  <button
                    className="secondary"
                    onClick={async () => {
                      const name = prompt("新分類名稱");
                      if (!name) return;
                      try {
                        await post("/admin/categories", { name });
                        refresh();
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    新增分類
                  </button>
                  {catalog.categories.map((c) => (
                    <div className="line-item" key={c.id}>
                      <strong>{c.name}</strong>
                      <button
                        className="secondary"
                        onClick={async () => {
                          const name = prompt("修改分類", c.name);
                          if (!name) return;
                          try {
                            await patch("/admin/categories/" + c.id, { name });
                            refresh();
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                      >
                        修改
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {page === "reviews" && (
            <>
              <div className="toolbar">
                <button className="secondary" onClick={() => open("product")}>
                  <Plus size={16} /> 建立產品目錄
                </button>
              </div>
              <div className="review-list">
                {reviews.length ? (
                  reviews.map((r) => (
                    <section className="panel review-card" key={r.id}>
                      <div className="review-top">
                        <div>
                          <small>{r.brand}</small>
                          <h3>
                            {r.name} {r.shade ? "#" + r.shade : ""}
                          </h3>
                        </div>
                        <Tag
                          tone={
                            r.repurchase_intent === "NO" ? "danger" : "pink"
                          }
                        >
                          {intentName[r.repurchase_intent]}
                        </Tag>
                      </div>
                      <div className="stars">
                        {"★".repeat(r.rating)}
                        {"☆".repeat(5 - r.rating)}
                      </div>
                      <p>{r.comment || "（未填寫文字心得）"}</p>
                      <small>
                        {new Date(r.created_at).toLocaleDateString("zh-TW")}
                      </small>
                    </section>
                  ))
                ) : (
                  <Empty
                    icon={NotebookPen}
                    title="還沒有使用心得"
                    desc="同一款產品可以記錄不同日期的使用感受"
                  />
                )}
              </div>
            </>
          )}
        </div>
      </main>
      {error && !modal && (
        <div className="toast" onClick={() => setError("")}>
          {error} ✕
        </div>
      )}
      {modal && (
        <Modal
          title={
            {
              product: "建立產品目錄",
              item: "新增美妝庫存",
              purchase: "記錄一筆購買",
              budget: "設定每月預算",
              wish: "加入願望清單",
              review: "新增使用心得",
            }[modal]
          }
          onClose={() => setModal("")}
        >
          <form
            className="modal-form"
            onSubmit={(e) =>
              submit(e, async () => {
                if (modal === "product") await post("/catalog", form);
                if (modal === "item") await post("/items", form);
                if (modal === "purchase") {
                  await post("/purchases", {
                    ...form,
                    purchase_date: form.purchase_date || today(),
                    quantity: form.quantity ?? 1,
                  });
                }
                if (modal === "wish") await post("/wishlist", form);
                if (modal === "review") {
                  await post("/reviews", {
                    ...form,
                    rating: Number(form.rating ?? 5),
                    repurchase_intent: form.repurchase_intent || "UNSURE",
                    comment: form.comment || "",
                  });
                }
                if (modal === "budget")
                  await api("/budget/" + ym, {
                    method: "PUT",
                    body: JSON.stringify(form),
                  });
              })
            }
          >
            {modal === "product" ? (
              <>
                <CatalogNamePicker
                  label="品牌"
                  placeholder="搜尋或輸入品牌，例如 CANMAKE"
                  value={form.brand}
                  onChange={(v) => set("brand", v)}
                  options={catalog.brands}
                />
                <CatalogNamePicker
                  label="分類"
                  placeholder="搜尋或輸入分類，例如 唇膏"
                  value={form.category}
                  onChange={(v) => set("category", v)}
                  options={catalog.categories}
                />
                <Field label="產品名稱 *">
                  <input
                    required
                    placeholder="例如：水潤唇膏"
                    value={form.name || ""}
                    onChange={(e) => set("name", e.target.value)}
                  />
                </Field>
                <Field label="系列">
                  <input
                    value={form.series || ""}
                    onChange={(e) => set("series", e.target.value)}
                  />
                </Field>
                <Field label="色號">
                  <input
                    value={form.shade || ""}
                    onChange={(e) => set("shade", e.target.value)}
                  />
                </Field>
              </>
            ) : modal === "budget" ? (
              <Field label={"預算金額（" + ym + "）"}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.amount ?? ""}
                  onChange={(e) => set("amount", e.target.value)}
                />
              </Field>
            ) : (
              <>
                <Field label="產品 *">
                  <ProductSelect
                    value={form.product_id}
                    onChange={(v) => set("product_id", v)}
                  />
                </Field>
                {modal === "item" && (
                  <>
                    <Field label="有效期限">
                      <input
                        type="date"
                        value={form.expiry_date || ""}
                        onChange={(e) => set("expiry_date", e.target.value)}
                      />
                    </Field>
                    <Field label="開封日期">
                      <input
                        type="date"
                        value={form.opened_at || ""}
                        onChange={(e) => set("opened_at", e.target.value)}
                      />
                    </Field>
                    <Field label="開封後使用月數（PAO）">
                      <input
                        type="number"
                        min="1"
                        value={form.pao_months || ""}
                        onChange={(e) => set("pao_months", e.target.value)}
                      />
                    </Field>
                    <Field label="庫存狀態">
                      <select
                        value={form.status || "UNOPENED"}
                        onChange={(e) => set("status", e.target.value)}
                      >
                        {["UNOPENED", "OPENED", "FINISHED", "DISCARDED"].map(
                          (k) => (
                            <option value={k} key={k}>
                              {statusName[k]}
                            </option>
                          ),
                        )}
                      </select>
                    </Field>
                  </>
                )}
                {modal === "purchase" && (
                  <>
                    <Field label="購買日期 *">
                      <input
                        type="date"
                        required
                        value={form.purchase_date || today()}
                        onChange={(e) => set("purchase_date", e.target.value)}
                      />
                    </Field>
                    <Field label="數量 *">
                      <input
                        type="number"
                        min="1"
                        max="100"
                        required
                        value={form.quantity || 1}
                        onChange={(e) => set("quantity", e.target.value)}
                      />
                    </Field>
                    <Field label="單價（NT$）*">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={form.unit_price ?? ""}
                        onChange={(e) => set("unit_price", e.target.value)}
                      />
                    </Field>
                    <Field label="產品有效期限">
                      <input
                        type="date"
                        value={form.expiry_date || ""}
                        onChange={(e) => set("expiry_date", e.target.value)}
                      />
                    </Field>
                    <p className="hint">儲存後會依數量自動新增庫存。</p>
                  </>
                )}
                {modal === "wish" && (
                  <>
                    <Field label="預估價格（NT$）*">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={form.expected_price ?? ""}
                        onChange={(e) => set("expected_price", e.target.value)}
                      />
                    </Field>
                    <Field label="考慮到哪一天">
                      <input
                        type="date"
                        value={form.consideration_date || ""}
                        onChange={(e) =>
                          set("consideration_date", e.target.value)
                        }
                      />
                    </Field>
                  </>
                )}
                {modal === "review" && (
                  <>
                    <Field label="評分 *">
                      <select
                        value={form.rating || 5}
                        onChange={(e) => set("rating", e.target.value)}
                      >
                        {[5, 4, 3, 2, 1].map((x) => (
                          <option value={x} key={x}>
                            {"★".repeat(x)}（{x} 分）
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="回購意願 *">
                      <select
                        value={form.repurchase_intent || "UNSURE"}
                        onChange={(e) =>
                          set("repurchase_intent", e.target.value)
                        }
                      >
                        {Object.entries(intentName).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="心得內容">
                      <textarea
                        rows="4"
                        maxLength="2000"
                        placeholder="這款產品使用起來怎麼樣？"
                        value={form.comment || ""}
                        onChange={(e) => set("comment", e.target.value)}
                      />
                    </Field>
                    <p className="hint">
                      每次心得都會獨立保存，不會覆蓋舊紀錄。
                    </p>
                  </>
                )}
              </>
            )}
            {error && <p className="error">{error}</p>}
            <button className="primary wide" disabled={loading}>
              {loading ? "儲存中…" : "確認儲存"} <Check size={17} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
