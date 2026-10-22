CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, role VARCHAR(10) NOT NULL DEFAULT 'USER' CHECK(role IN ('USER','ADMIN')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), is_active BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS brands (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(100) UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(100) UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS products (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), brand_id UUID NOT NULL REFERENCES brands(id), category_id UUID NOT NULL REFERENCES categories(id), name VARCHAR(150) NOT NULL, series VARCHAR(100), shade VARCHAR(50));
CREATE TABLE IF NOT EXISTS purchases (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), purchase_date DATE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS purchase_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), purchase_id UUID NOT NULL REFERENCES purchases(id), product_id UUID NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL CHECK(quantity>0), unit_price NUMERIC(10,2) NOT NULL CHECK(unit_price>=0));
CREATE TABLE IF NOT EXISTS product_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), product_id UUID NOT NULL REFERENCES products(id), purchase_item_id UUID REFERENCES purchase_items(id), expiry_date DATE, opened_at DATE, pao_months INTEGER CHECK(pao_months>0), status VARCHAR(20) NOT NULL DEFAULT 'UNOPENED' CHECK(status IN ('UNOPENED','OPENED','FINISHED','DISCARDED')), CHECK(status<>'OPENED' OR opened_at IS NOT NULL));
CREATE TABLE IF NOT EXISTS reviews (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), product_id UUID NOT NULL REFERENCES products(id), rating SMALLINT NOT NULL CHECK(rating BETWEEN 1 AND 5), comment VARCHAR(2000), repurchase_intent VARCHAR(10) NOT NULL CHECK(repurchase_intent IN ('YES','NO','UNSURE')), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wishlists (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), product_id UUID NOT NULL REFERENCES products(id), expected_price NUMERIC(10,2) NOT NULL CHECK(expected_price>=0), status VARCHAR(15) NOT NULL DEFAULT 'CONSIDERING' CHECK(status IN ('CONSIDERING','PURCHASED','CANCELLED')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), consideration_date DATE);
CREATE TABLE IF NOT EXISTS budgets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id), year_month CHAR(7) NOT NULL CHECK(year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), amount NUMERIC(10,2) NOT NULL CHECK(amount>=0), UNIQUE(user_id,year_month));
CREATE INDEX IF NOT EXISTS idx_items_user ON product_items(user_id,status);
CREATE INDEX IF NOT EXISTS idx_reviews_user_product ON reviews(user_id,product_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_user_date ON purchases(user_id,purchase_date);

CREATE UNIQUE INDEX IF NOT EXISTS ux_products_identity ON products (brand_id,category_id,name,series,shade) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_wishlists_active ON wishlists(user_id,product_id) WHERE status='CONSIDERING';
CREATE INDEX IF NOT EXISTS idx_items_user_status_expiry ON product_items(user_id,status,expiry_date);
CREATE INDEX IF NOT EXISTS idx_items_user_status_opened ON product_items(user_id,status,opened_at);
