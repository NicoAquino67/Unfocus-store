CREATE TABLE users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name TEXT NOT NULL,
  email VARCHAR(254) COLLATE utf8mb4_general_ci NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT (''),
  password_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_guest BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE products (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  slug VARCHAR(255) COLLATE utf8mb4_bin NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price_ars BIGINT NOT NULL CHECK (price_ars > 0),
  garment_cost_ars BIGINT NOT NULL DEFAULT 0 CHECK (garment_cost_ars >= 0),
  logistics_cost_ars BIGINT NOT NULL DEFAULT 0 CHECK (logistics_cost_ars >= 0),
  production_cost_ars BIGINT NOT NULL DEFAULT 0 CHECK (production_cost_ars >= 0),
  tax_percent DOUBLE NOT NULL DEFAULT 0 CHECK (tax_percent >= 0 AND tax_percent < 100),
  profit_percent DOUBLE NOT NULL DEFAULT 0 CHECK (profit_percent >= 0),
  stock BIGINT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  stock_by_size LONGTEXT NOT NULL DEFAULT ('{}'),
  composition TEXT NOT NULL,
  features_json LONGTEXT NOT NULL DEFAULT ('[]'),
  description TEXT NOT NULL,
  design_description TEXT NOT NULL,
  front_image TEXT NOT NULL,
  front_alt TEXT NOT NULL,
  back_image TEXT NOT NULL,
  back_alt TEXT NOT NULL,
  badge TEXT NOT NULL DEFAULT (''),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_gift_card BIGINT NOT NULL DEFAULT 0,
  discount_type VARCHAR(16) NOT NULL DEFAULT 'none',
  discount_value BIGINT NOT NULL DEFAULT 0,
  extra_images LONGTEXT NOT NULL DEFAULT ('[]'),
  colors_json LONGTEXT NOT NULL DEFAULT ('[]')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE sessions (
  token_hash VARCHAR(128) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY sessions_user_id_idx (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE favorites (
  user_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, product_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  reference VARCHAR(255) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL,
  total_ars BIGINT NOT NULL CHECK (total_ars >= 0),
  status VARCHAR(64) NOT NULL DEFAULT 'pending_payment',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payment_url TEXT,
  shipping_cost_ars BIGINT NOT NULL DEFAULT 0,
  shipping_method VARCHAR(64) NOT NULL DEFAULT 'delivery',
  shipping_name TEXT,
  shipping_phone TEXT,
  shipping_street TEXT,
  shipping_city TEXT,
  shipping_province TEXT,
  shipping_postal_code TEXT,
  shipping_notes TEXT,
  carrier TEXT,
  tracking_code TEXT,
  tracking_url TEXT,
  shipped_at VARCHAR(40),
  ca_tracking_number TEXT,
  mc_imported_at VARCHAR(40),
  payment_method VARCHAR(64) NOT NULL DEFAULT 'mercadopago',
  coupon_code VARCHAR(255) NOT NULL DEFAULT '',
  discount_ars BIGINT NOT NULL DEFAULT 0,
  gift_card_code VARCHAR(255) NOT NULL DEFAULT '',
  gift_card_ars BIGINT NOT NULL DEFAULT 0,
  KEY orders_user_id_idx (user_id, created_at DESC),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE order_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  product_id BIGINT,
  product_name TEXT NOT NULL,
  product_slug TEXT NOT NULL,
  image_url TEXT NOT NULL,
  size VARCHAR(64) NOT NULL,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  unit_price_ars BIGINT NOT NULL CHECK (unit_price_ars > 0),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE notifications (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT,
  kind VARCHAR(64) NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  order_id BIGINT,
  KEY notifications_user_id_idx (user_id, is_read, created_at DESC),
  KEY notifications_order_id_idx (order_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE product_reviews (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  rating BIGINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (product_id, user_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE password_reset_tokens (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  used_at BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE newsletter_subscribers (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(254) COLLATE utf8mb4_general_ci NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE contact_messages (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BIGINT NOT NULL DEFAULT 0,
  email_sent BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY contact_messages_created_at_idx (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE gift_cards (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(255) COLLATE utf8mb4_general_ci NOT NULL UNIQUE,
  initial_ars BIGINT NOT NULL CHECK (initial_ars > 0),
  balance_ars BIGINT NOT NULL CHECK (balance_ars >= 0),
  order_id BIGINT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE coupons (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(255) COLLATE utf8mb4_general_ci NOT NULL UNIQUE,
  type VARCHAR(16) NOT NULL CHECK (type IN ('percent', 'fixed')),
  value BIGINT NOT NULL CHECK (value > 0),
  min_subtotal_ars BIGINT NOT NULL DEFAULT 0,
  max_uses BIGINT NOT NULL DEFAULT 0,
  uses BIGINT NOT NULL DEFAULT 0,
  expires_at VARCHAR(40),
  active BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE payment_attempts (
  payment_id VARCHAR(255) PRIMARY KEY,
  order_id BIGINT NOT NULL,
  status VARCHAR(64) NOT NULL,
  status_detail TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY payment_attempts_order_id_idx (order_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE saved_addresses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  label TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  street TEXT NOT NULL,
  city TEXT NOT NULL,
  province TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  is_default BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY saved_addresses_user_id_idx (user_id, is_default DESC, id DESC),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE restock_subscriptions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  product_id BIGINT NOT NULL,
  size VARCHAR(64) NOT NULL,
  email VARCHAR(254) COLLATE utf8mb4_general_ci NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (product_id, size, email),
  KEY restock_subscriptions_product_size_idx (product_id, size),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE store_settings (
  `key` VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
