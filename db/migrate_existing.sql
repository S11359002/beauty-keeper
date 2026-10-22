-- Beauty Keeper 升級腳本：請先備份既有 beauty_keeper 資料庫。
-- 本腳本不刪除既有資料。若有重複產品或願望，唯一索引建立會失敗；請先人工檢查並整理。
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- PostgreSQL 15+ (PostgreSQL 16 可使用)：NULL 也視為相同值。
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_identity ON products (brand_id,category_id,name,series,shade) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_wishlists_active ON wishlists(user_id,product_id) WHERE status='CONSIDERING';
CREATE INDEX IF NOT EXISTS idx_items_user_status_expiry ON product_items(user_id,status,expiry_date);
CREATE INDEX IF NOT EXISTS idx_items_user_status_opened ON product_items(user_id,status,opened_at);
COMMIT;
