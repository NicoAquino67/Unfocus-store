import { randomBytes, randomUUID, scrypt, createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { MercadoPagoConfig, Preference } from 'mercadopago'
import nodemailer from 'nodemailer'

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(serverDirectory, '..')
const port = Number(process.env.PORT || 3001)
const isProduction = process.env.NODE_ENV === 'production'
const secureCookies = process.env.COOKIE_SECURE === 'true' || (isProduction && process.env.COOKIE_SECURE !== 'false')
const mercadoPagoAccessToken = process.env.MP_ACCESS_TOKEN?.trim()
const mercadoPagoClient = mercadoPagoAccessToken ? new MercadoPagoConfig({ accessToken: mercadoPagoAccessToken }) : null
const mercadoPagoEnvironment = process.env.MP_ENVIRONMENT?.trim().toLowerCase() || (isProduction ? 'production' : 'unconfigured')
const mercadoPagoIsTestMode = mercadoPagoEnvironment === 'test'
const publicBaseUrl = process.env.PUBLIC_BASE_URL || (isProduction ? 'https://localhost' : 'http://localhost:5173')
const databasePath = process.env.DATABASE_PATH || path.join(projectDirectory, 'data', 'unfocus.sqlite')
const uploadDirectory = path.join(projectDirectory, 'uploads')
const sessionCookieName = 'unfocus_session'
const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 14
const maximumImageBytes = 4 * 1024 * 1024
const sizes = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']

await mkdir(path.dirname(databasePath), { recursive: true })
await mkdir(uploadDirectory, { recursive: true })

const database = new DatabaseSync(databasePath)
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price_ars INTEGER NOT NULL CHECK (price_ars > 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    stock_by_size TEXT NOT NULL DEFAULT '{}',
    composition TEXT NOT NULL,
    features_json TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL,
    design_description TEXT NOT NULL,
    front_image TEXT NOT NULL,
    front_alt TEXT NOT NULL,
    back_image TEXT NOT NULL,
    back_alt TEXT NOT NULL,
    badge TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, product_id)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    total_ars INTEGER NOT NULL CHECK (total_ars >= 0),
    status TEXT NOT NULL DEFAULT 'pending_payment',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    product_slug TEXT NOT NULL,
    image_url TEXT NOT NULL,
    size TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_ars INTEGER NOT NULL CHECK (unit_price_ars > 0)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'system',
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS product_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    email_sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS orders_user_id_idx ON orders(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id, is_read, created_at DESC);
  CREATE INDEX IF NOT EXISTS contact_messages_created_at_idx ON contact_messages(created_at DESC);
`)

const runSchemaMigration = () => {
  const columns = new Map()
  for (const row of database.prepare('PRAGMA table_info(products)').all()) columns.set(row.name, true)
  const orderColumns = new Set(database.prepare('PRAGMA table_info(orders)').all().map((row) => row.name))
  const orderColumnDefinitions = {
    payment_url: 'TEXT',
    shipping_cost_ars: 'INTEGER NOT NULL DEFAULT 0',
    shipping_method: "TEXT NOT NULL DEFAULT 'delivery'",
    shipping_name: 'TEXT',
    shipping_phone: 'TEXT',
    shipping_street: 'TEXT',
    shipping_city: 'TEXT',
    shipping_province: 'TEXT',
    shipping_postal_code: 'TEXT',
    shipping_notes: 'TEXT',
    carrier: 'TEXT',
    tracking_code: 'TEXT',
    tracking_url: 'TEXT',
    shipped_at: 'TEXT',
    payment_method: "TEXT NOT NULL DEFAULT 'mercadopago'",
  }
  for (const [column, definition] of Object.entries(orderColumnDefinitions)) {
    if (!orderColumns.has(column)) database.exec(`ALTER TABLE orders ADD COLUMN ${column} ${definition}`)
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      payment_id TEXT PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      status_detail TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS payment_attempts_order_id_idx ON payment_attempts(order_id);
  `)
  if (!columns.has('stock')) database.exec('ALTER TABLE products ADD COLUMN stock INTEGER NOT NULL DEFAULT 0')
  if (!columns.has('extra_images')) database.exec("ALTER TABLE products ADD COLUMN extra_images TEXT NOT NULL DEFAULT '[]'")
  if (!columns.has('stock_by_size')) database.exec("ALTER TABLE products ADD COLUMN stock_by_size TEXT NOT NULL DEFAULT '{}' ")
  database.exec(`
    CREATE TABLE IF NOT EXISTS product_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_id, user_id)
    );
  `)
  const legacyStockUpdate = database.prepare("UPDATE products SET stock = COALESCE(stock, 0), stock_by_size = COALESCE(stock_by_size, '{}') WHERE stock IS NULL OR stock_by_size IS NULL")
  legacyStockUpdate.run()
}

runSchemaMigration()
database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())

const hashPassword = async (password) => {
  const salt = randomBytes(16).toString('hex')
  const derived = await new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key))
  })
  return `${salt}:${Buffer.from(derived).toString('hex')}`
}

const verifyPassword = async (password, savedHash) => {
  const [salt, expectedHex] = savedHash.split(':')
  if (!salt || !expectedHex) return false
  const expected = Buffer.from(expectedHex, 'hex')
  const derived = await new Promise((resolve, reject) => {
    scrypt(password, salt, expected.length, (error, key) => error ? reject(error) : resolve(key))
  })
  const actual = Buffer.from(derived)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const createNotification = (userId, kind, title, message) => {
  if (!userId) return
  database.prepare('INSERT INTO notifications (user_id, kind, title, message) VALUES (?, ?, ?, ?)').run(userId, kind, title, message)
}

const nonNegativeIntegerFromEnv = (name) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}
const textFromEnv = (name) => process.env[name]?.trim() || ''
const settingKeys = ['shippingCostArs', 'freeShippingThresholdArs', 'pickupAddress', 'legalName', 'taxId', 'address', 'email', 'phone', 'transferHolder', 'transferBank', 'transferCbu', 'transferAlias', 'transferTaxId']
const integerSettingKeys = new Set(['shippingCostArs', 'freeShippingThresholdArs'])
const envSettingDefaults = {
  shippingCostArs: nonNegativeIntegerFromEnv('SHIPPING_COST_ARS'),
  freeShippingThresholdArs: nonNegativeIntegerFromEnv('FREE_SHIPPING_THRESHOLD_ARS'),
  pickupAddress: textFromEnv('PICKUP_ADDRESS'),
  legalName: textFromEnv('STORE_LEGAL_NAME'),
  taxId: textFromEnv('STORE_TAX_ID'),
  address: textFromEnv('STORE_ADDRESS'),
  email: textFromEnv('STORE_EMAIL') || textFromEnv('CONTACT_TO_EMAIL'),
  phone: textFromEnv('STORE_PHONE'),
  transferHolder: '',
  transferBank: '',
  transferCbu: '',
  transferAlias: '',
  transferTaxId: '',
}
database.exec('CREATE TABLE IF NOT EXISTS store_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
const storeSettings = { ...envSettingDefaults }
for (const row of database.prepare('SELECT key, value FROM store_settings').all()) {
  if (settingKeys.includes(row.key)) storeSettings[row.key] = integerSettingKeys.has(row.key) ? Number(row.value) || 0 : row.value
}

const calculateShippingCost = (subtotal, method) => {
  if (method === 'pickup') return 0
  if (storeSettings.freeShippingThresholdArs > 0 && subtotal >= storeSettings.freeShippingThresholdArs) return 0
  return storeSettings.shippingCostArs
}

const cleanText = (value, maxLength) => typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength) : ''

const parseShippingDetails = (input, subtotal) => {
  const method = input?.method === 'pickup' ? 'pickup' : 'delivery'
  if (method === 'pickup' && !storeSettings.pickupAddress) throw new Error('El retiro en persona no está disponible.')
  const name = cleanText(input?.name, 80)
  const phone = cleanText(input?.phone, 40)
  if (name.length < 2) throw new Error('Escribe el nombre de quien recibe el pedido.')
  if (!/^[\d+()\s.-]{6,40}$/.test(phone)) throw new Error('Escribe un teléfono de contacto válido.')
  const details = { method, name, phone, street: '', city: '', province: '', postalCode: '', notes: cleanText(input?.notes, 200), costArs: calculateShippingCost(subtotal, method) }
  if (method === 'delivery') {
    details.street = cleanText(input?.street, 120)
    details.city = cleanText(input?.city, 80)
    details.province = cleanText(input?.province, 60)
    details.postalCode = cleanText(input?.postalCode, 10).toUpperCase()
    if (details.street.length < 3) throw new Error('Escribe la calle, el número y el piso o departamento.')
    if (details.city.length < 2) throw new Error('Escribe la localidad de entrega.')
    if (details.province.length < 2) throw new Error('Selecciona la provincia de entrega.')
    if (!/^[A-Z0-9 -]{4,10}$/.test(details.postalCode)) throw new Error('Escribe un código postal válido.')
  }
  return details
}

let mailTransporter
const getMailTransporter = () => {
  const host = process.env.SMTP_HOST?.trim()
  if (!host) return null
  if (!mailTransporter) {
    const port = Number(process.env.SMTP_PORT || 587)
    const user = process.env.SMTP_USER?.trim()
    const pass = process.env.SMTP_PASSWORD
    mailTransporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      ...(user && pass ? { auth: { user, pass } } : {}),
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 8000,
    })
  }
  return mailTransporter
}

const sendMail = async ({ to, subject, text, replyTo, fromName = 'UnFocus' }) => {
  const transporter = getMailTransporter()
  const fromEmail = process.env.CONTACT_FROM_EMAIL?.trim() || process.env.SMTP_USER?.trim()
  if (!transporter || !fromEmail || !to) return false
  try {
    await transporter.sendMail({ from: { name: fromName, address: fromEmail }, to, subject, text, ...(replyTo ? { replyTo } : {}) })
    return true
  } catch (error) {
    console.error('Email delivery failed:', error.message)
    return false
  }
}

const formatArs = (value) => `$ ${Number(value).toLocaleString('es-AR')}`
const shippingSummary = (order) => order.shipping_method === 'pickup'
  ? `Retiro en persona${storeSettings.pickupAddress ? `: ${storeSettings.pickupAddress}` : ''}`
  : `Envío a domicilio: ${[order.shipping_street, order.shipping_city, order.shipping_province, order.shipping_postal_code].filter(Boolean).join(', ')}`

const sendOrderEmail = async (orderId, kind) => {
  const order = database.prepare('SELECT o.*, u.name AS user_name, u.email AS user_email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?').get(orderId)
  if (!order) return false
  const items = database.prepare('SELECT product_name, size, quantity, unit_price_ars FROM order_items WHERE order_id = ?').all(orderId)
  const itemLines = items.map((item) => `- ${item.quantity} × ${item.product_name} (talle ${item.size}): ${formatArs(item.unit_price_ars * item.quantity)}`).join('\n')
  const totals = `Envío: ${order.shipping_cost_ars ? formatArs(order.shipping_cost_ars) : 'Sin cargo'}\nTotal: ${formatArs(order.total_ars)}`
  const greeting = `Hola ${order.user_name.split(' ')[0]},`
  const signature = '\nEquipo UnFocus\nSeeking clarity. Embrace yourself.'
  let subject
  let body
  if (kind === 'created') {
    subject = `Registramos tu pedido ${order.reference}`
    const transfer = order.payment_method === 'transfer' ? transferDetails() : null
    const transferLines = transfer
      ? `Paga por transferencia por ${formatArs(order.total_ars)}:\nTitular: ${transfer.holder}\n${transfer.bank ? `Banco: ${transfer.bank}\n` : ''}${transfer.cbu ? `CBU/CVU: ${transfer.cbu}\n` : ''}${transfer.alias ? `Alias: ${transfer.alias}\n` : ''}${transfer.taxId ? `CUIT/CUIL: ${transfer.taxId}\n` : ''}Indica ${order.reference} como concepto y envíanos el comprobante respondiendo este correo.`
      : 'Puedes retomar el pago desde tu cuenta.'
    body = `${greeting}\n\nRegistramos tu pedido ${order.reference}. Está pendiente de pago${order.status === 'pending_payment' ? ` y se cancelará automáticamente si no se completa en ${pendingOrderExpiryDays} días` : ''}.\n\n${itemLines}\n${totals}\n\n${shippingSummary(order)}\n\n${transferLines}`
  } else if (kind === 'paid') {
    subject = `Recibimos tu pago · Pedido ${order.reference}`
    body = `${greeting}\n\nConfirmamos el pago de tu pedido ${order.reference}.\n\n${itemLines}\n${totals}\n\n${shippingSummary(order)}\n\nTe avisaremos por correo cuando lo despachemos.`
  } else if (kind === 'shipped') {
    subject = `Tu pedido ${order.reference} ya fue despachado`
    const tracking = [order.carrier && `Transporte: ${order.carrier}`, order.tracking_code && `Código de seguimiento: ${order.tracking_code}`, order.tracking_url && `Seguimiento: ${order.tracking_url}`].filter(Boolean).join('\n')
    body = `${greeting}\n\nTu pedido ${order.reference} está en camino.\n\n${shippingSummary(order)}${tracking ? `\n\n${tracking}` : ''}\n\nPuedes ver el estado en tu cuenta.`
  } else if (kind === 'cancelled') {
    subject = `Pedido ${order.reference} cancelado`
    body = `${greeting}\n\nTu pedido ${order.reference} fue cancelado y el stock quedó liberado. Si ya pagaste o crees que es un error, escríbenos respondiendo este correo.`
  } else {
    return false
  }
  return sendMail({ to: order.user_email, subject, text: `${body}\n${signature}`, replyTo: storeSettings.email || undefined })
}

const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  isAdmin: user.role === 'admin',
})

const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((part) => {
  const separator = part.indexOf('=')
  if (separator < 0) return ['', '']
  return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]
}))

const createSession = (response, userId) => {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + sessionLifetimeMs
  database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expiresAt)
  response.cookie(sessionCookieName, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: sessionLifetimeMs,
  })
}

const parseExtraImages = (value) => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter((image) => typeof image?.src === 'string') : []
  } catch {
    return []
  }
}

const productFromRow = (row) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  category: row.category,
  price: row.price_ars,
  stock: Number(row.stock ?? 0),
  stockBySize: (() => {
    try { return JSON.parse(row.stock_by_size || '{}') } catch { return {} }
  })(),
  alt: row.front_alt,
  composition: row.composition,
  features: JSON.parse(row.features_json),
  description: row.description,
  designDescription: row.design_description,
  gallery: [
    { src: row.front_image, alt: row.front_alt, label: 'Frente' },
    { src: row.back_image, alt: row.back_alt, label: 'Espalda' },
    ...parseExtraImages(row.extra_images).map((image, index) => ({ src: image.src, alt: image.alt, label: `Vista ${index + 3}` })),
  ],
  badge: row.badge,
  createdAt: row.created_at,
  sold: Number(row.sold ?? 0),
})

// sold = unidades en pedidos pagados; alimenta el orden por popularidad
const productSelect = "SELECT p.*, (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status IN ('paid', 'shipped', 'delivered')) AS sold FROM products p"
const selectProductById = database.prepare(`${productSelect} WHERE p.id = ?`)
const selectProductBySlug = database.prepare(`${productSelect} WHERE p.slug = ?`)
const allProducts = database.prepare(`${productSelect} ORDER BY p.id`)

const seedExtraImages = (product) => product.gallery.slice(2).map((image) => ({ src: image.src, alt: image.alt }))

const insertSeedProducts = async () => {
  if (database.prepare('SELECT COUNT(*) AS count FROM products').get().count > 0) return
  const seed = JSON.parse(await readFile(path.join(serverDirectory, 'seed-products.json'), 'utf8'))
  const insert = database.prepare(`
    INSERT INTO products (id, slug, name, category, price_ars, stock, stock_by_size, composition, features_json, description, design_description, front_image, front_alt, back_image, back_alt, badge, extra_images)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const product of seed) {
    const stockBySize = product.stockBySize && typeof product.stockBySize === 'object' ? product.stockBySize : Object.fromEntries(sizes.map((size) => [size, 0]))
    const totalStock = Object.values(stockBySize).reduce((sum, value) => sum + Number(value || 0), 0)
    insert.run(product.id, product.slug, product.name, product.category, product.price, totalStock, JSON.stringify(stockBySize), product.composition, JSON.stringify(product.features), product.description, product.designDescription, product.gallery[0].src, product.gallery[0].alt, product.gallery[1].src, product.gallery[1].alt, product.badge ?? '', JSON.stringify(seedExtraImages(product)))
  }
}

const bootstrapAdministrator = async () => {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) return
  if (password.length < 14) throw new Error('ADMIN_PASSWORD debe tener al menos 14 caracteres.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_EMAIL no es una dirección válida.')
  const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) {
    database.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id)
    return
  }
  const passwordHash = await hashPassword(password)
  database.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run(process.env.ADMIN_NAME?.trim() || 'UnFocus Admin', email, passwordHash)
}

await insertSeedProducts()

// Backfill: productos sembrados antes de existir la galería ampliada reciben su tercera imagen.
const backfillSeedImages = async () => {
  const seed = JSON.parse(await readFile(path.join(serverDirectory, 'seed-products.json'), 'utf8'))
  const update = database.prepare("UPDATE products SET extra_images = ? WHERE slug = ? AND extra_images = '[]'")
  for (const product of seed.products ?? seed) update.run(JSON.stringify(seedExtraImages(product)), product.slug)
}
await backfillSeedImages()
await bootstrapAdministrator()

const app = express()
const allowedOrigins = new Set([
  'https://unfocus.shop',
  'https://www.unfocus.shop',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
])
const rateLimitStore = new Map()

const applyRateLimit = (request, response, next, maxRequests = 20, windowMs = 60_000) => {
  const key = `${request.ip ?? 'unknown'}:${request.path}`
  const now = Date.now()
  const attempts = (rateLimitStore.get(key) ?? []).filter((time) => now - time < windowMs)
  if (attempts.length >= maxRequests) return response.status(429).json({ error: 'Demasiados intentos. Inténtalo más tarde.' })
  attempts.push(now)
  rateLimitStore.set(key, attempts)
  next()
}

app.disable('x-powered-by')
app.set('trust proxy', isProduction ? 1 : false)
app.use(express.json({ limit: '6mb' }))
app.use((request, response, next) => {
  const origin = request.get('origin')
  const isAllowedOrigin = !origin || allowedOrigins.has(origin) || (isProduction ? origin.endsWith('.unfocus.shop') : ['localhost', '127.0.0.1'].includes(new URL(origin || 'http://localhost').hostname))
  if (origin && !isAllowedOrigin) return response.status(403).json({ error: 'Origen no permitido.' })
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  }
  if (request.method === 'OPTIONS') return response.sendStatus(204)
  next()
})
app.use('/uploads', express.static(uploadDirectory, { maxAge: '1y', immutable: true, fallthrough: false }))
app.use('/ident', express.static(path.join(projectDirectory, 'ident'), { maxAge: '1d' }))

app.use('/api', (request, response, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    const origin = request.get('origin')
    if (origin) {
      let originUrl
      try {
        originUrl = new URL(origin)
      } catch {
        return response.status(403).json({ error: 'Origen no permitido.' })
      }
      const forwardedHosts = [request.get('host'), request.get('x-forwarded-host')]
      const matchesHost = forwardedHosts.includes(originUrl.host)
      const isLocalProxy = !isProduction
        && ['localhost', '127.0.0.1'].includes(originUrl.hostname)
        && ['localhost', '127.0.0.1'].includes(request.hostname)
      if (!matchesHost && !isLocalProxy) return response.status(403).json({ error: 'Origen no permitido.' })
    }
  }
  next()
})

app.use('/api', (request, _response, next) => {
  const token = parseCookies(request.headers.cookie)[sessionCookieName]
  if (token) {
    const session = database.prepare(`
      SELECT u.id, u.name, u.email, u.phone, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(sha256(token), Date.now())
    if (session) request.user = session
    else database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
  }
  next()
})

const requireAuth = (request, response, next) => {
  if (!request.user) return response.status(401).json({ error: 'Inicia sesión para continuar.' })
  next()
}

const requireAdmin = (request, response, next) => {
  if (!request.user || request.user.role !== 'admin') return response.status(403).json({ error: 'No autorizado.' })
  next()
}

const authAttempts = new Map()
const limitAuthAttempts = (request, response, next) => {
  const now = Date.now()
  const key = request.ip || 'unknown'
  const activeAttempts = (authAttempts.get(key) ?? []).filter((time) => now - time < 10 * 60 * 1000)
  if (activeAttempts.length >= 12) return response.status(429).json({ error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' })
  activeAttempts.push(now)
  authAttempts.set(key, activeAttempts)
  next()
}

const authResponse = (request, response) => response.json({ user: publicUser(request.user) })

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }))
app.use('/api/auth', (request, response, next) => applyRateLimit(request, response, next, 8, 60_000))
app.use('/api/payments', (request, response, next) => applyRateLimit(request, response, next, 12, 60_000))
app.use('/api/orders', (request, response, next) => applyRateLimit(request, response, next, 10, 60_000))
app.use('/api/newsletter', (request, response, next) => applyRateLimit(request, response, next, 20, 60_000))
app.use('/api/contact', (request, response, next) => applyRateLimit(request, response, next, 5, 60_000))

const transferDetails = () => {
  const { transferHolder: holder, transferBank: bank, transferCbu: cbu, transferAlias: alias, transferTaxId: taxId } = storeSettings
  return holder && (cbu || alias) ? { holder, bank, cbu, alias, taxId } : null
}

const publicStoreConfig = () => ({
  shipping: { costArs: storeSettings.shippingCostArs, freeThresholdArs: storeSettings.freeShippingThresholdArs, pickupAddress: storeSettings.pickupAddress },
  transfer: transferDetails(),
  store: { legalName: storeSettings.legalName, taxId: storeSettings.taxId, address: storeSettings.address, email: storeSettings.email, phone: storeSettings.phone },
})

app.get('/api/config', async (_request, response) => {
  const configuredRate = Number(process.env.USD_ARS_RATE)
  if (Number.isFinite(configuredRate) && configuredRate > 0) {
    return response.json({ defaultCurrency: 'ARS', usdArsRate: configuredRate, exchangeSource: 'configuración', exchangeUpdatedAt: null, ...publicStoreConfig() })
  }
  try {
    const quoteResponse = await fetch('https://dolarapi.com/v1/dolares/oficial', { signal: AbortSignal.timeout(5000) })
    if (!quoteResponse.ok) throw new Error('Cotización temporalmente no disponible.')
    const quote = await quoteResponse.json()
    if (typeof quote.venta !== 'number' || quote.venta <= 0) throw new Error('Cotización inválida.')
    response.json({ defaultCurrency: 'ARS', usdArsRate: quote.venta, exchangeSource: 'Dólar oficial · DolarAPI', exchangeUpdatedAt: quote.fechaActualizacion, ...publicStoreConfig() })
  } catch {
    response.json({ defaultCurrency: 'ARS', usdArsRate: null, exchangeSource: null, exchangeUpdatedAt: null, ...publicStoreConfig() })
  }
})

app.get('/api/products', (_request, response) => {
  response.json({ products: allProducts.all().map(productFromRow) })
})

app.get('/api/products/:slug', (request, response) => {
  const product = selectProductBySlug.get(request.params.slug)
  if (!product) return response.status(404).json({ error: 'Producto no encontrado.' })
  response.json({ product: productFromRow(product) })
})

const sessionDurationSeconds = Math.floor(sessionLifetimeMs / 1000)
const createUserSession = (request, response, user) => {
  createSession(response, user.id)
  request.user = user
  response.json({ user: publicUser(user) })
}

app.get('/api/auth/me', (request, response) => {
  response.json({ user: request.user ? publicUser(request.user) : null })
})

app.post('/api/auth/request-password-reset', async (request, response) => {
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Escribe un correo válido.' })
  const user = database.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (user) {
    const token = randomBytes(32).toString('hex')
    const tokenHash = sha256(token)
    const expiresAt = Date.now() + 1000 * 60 * 30
    database.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(user.id, tokenHash, expiresAt)
    const recipient = database.prepare('SELECT name FROM users WHERE id = ?').get(user.id)
    const sent = await sendMail({
      to: email,
      subject: 'Restablece tu contraseña de UnFocus',
      text: `Hola ${recipient.name.split(' ')[0]},\n\nRecibimos una solicitud para restablecer tu contraseña. Copia este código en la pantalla de recuperación:\n\n${token}\n\nEl código vence en 30 minutos. Si no fuiste tú, ignora este correo.\n\nEquipo UnFocus`,
    })
    if (!sent && !isProduction) console.info('Password reset token created for user id', user.id, '(SMTP not configured)')
  }
  response.json({ ok: true, message: 'Si existe una cuenta con ese correo, recibirá instrucciones para restablecer la contraseña.' })
})

app.post('/api/auth/reset-password', async (request, response) => {
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const token = typeof request.body.token === 'string' ? request.body.token.trim() : ''
  const password = typeof request.body.password === 'string' ? request.body.password : ''
  if (!email || !token || password.length < 10) return response.status(400).json({ error: 'Faltan datos para restablecer la contraseña.' })
  const user = database.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (!user) return response.status(400).json({ error: 'No se pudo validar la solicitud.' })
  const reset = database.prepare('SELECT * FROM password_reset_tokens WHERE user_id = ? AND expires_at > ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1').get(user.id, Date.now())
  if (!reset || reset.token_hash !== sha256(token)) return response.status(400).json({ error: 'El token de acceso no es válido o ya expiró.' })
  const passwordHash = await hashPassword(password)
  database.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id)
  database.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(Date.now(), reset.id)
  response.json({ ok: true, message: 'La contraseña fue actualizada correctamente.' })
})

app.post('/api/auth/register', limitAuthAttempts, async (request, response) => {
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : ''
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const phone = typeof request.body.phone === 'string' ? request.body.phone.trim().slice(0, 40) : ''
  const password = typeof request.body.password === 'string' ? request.body.password : ''
  if (name.length < 2 || name.length > 80) return response.status(400).json({ error: 'Escribe un nombre de entre 2 y 80 caracteres.' })
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Escribe un correo válido.' })
  if (password.length < 10 || password.length > 200) return response.status(400).json({ error: 'La contraseña debe tener al menos 10 caracteres.' })
  if (database.prepare('SELECT id FROM users WHERE email = ?').get(email)) return response.status(409).json({ error: 'Ya existe una cuenta con ese correo.' })
  try {
    const passwordHash = await hashPassword(password)
    const result = database.prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)').run(name, email, phone, passwordHash)
    const user = database.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(Number(result.lastInsertRowid))
    void sendMail({
      to: email,
      subject: '¡Bienvenido/a a UnFocus!',
      text: `Hola ${name.split(' ')[0]},\n\nTu cuenta en UnFocus ya está lista. Desde ella puedes seguir tus pedidos, guardar favoritos y retomar pagos pendientes.\n\nEquipo UnFocus\nSeeking clarity. Embrace yourself.`,
      replyTo: storeSettings.email || undefined,
    })
    return createUserSession(request, response, user)
  } catch {
    return response.status(500).json({ error: 'No se pudo crear la cuenta.' })
  }
})

app.post('/api/auth/login', limitAuthAttempts, async (request, response) => {
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const password = typeof request.body.password === 'string' ? request.body.password : ''
  const user = database.prepare('SELECT id, name, email, phone, password_hash, role FROM users WHERE email = ?').get(email)
  if (!user || !(await verifyPassword(password, user.password_hash))) return response.status(401).json({ error: 'Correo o contraseña incorrectos.' })
  const { password_hash: _passwordHash, ...sessionUser } = user
  return createUserSession(request, response, sessionUser)
})

app.post('/api/auth/logout', (request, response) => {
  const token = parseCookies(request.headers.cookie)[sessionCookieName]
  if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
  response.clearCookie(sessionCookieName, { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/' })
  response.json({ ok: true })
})

const persistImage = async (value) => {
  if (typeof value !== 'string') throw new Error('Cada vista necesita una imagen.')
  if (/^\/ident\/productos\/[a-zA-Z0-9_-]+\.jpg$/.test(value)) return value
  if (/^\/uploads\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(value)) return value
  const match = value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new Error('Formato de imagen no válido.')
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > maximumImageBytes) throw new Error('La imagen supera el tamaño permitido.')
  const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
  const filename = `${randomUUID()}.${extension}`
  await writeFile(path.join(uploadDirectory, filename), buffer, { flag: 'wx' })
  return `/uploads/${filename}`
}

const minimumProductImages = 3
const maximumProductImages = 10

const validateProduct = (body) => {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  const price = Number(body.price)
  const hasSizeStock = body.stockBySize !== null && typeof body.stockBySize === 'object' && !Array.isArray(body.stockBySize)
  const stockBySize = hasSizeStock
    ? Object.fromEntries(Object.entries(body.stockBySize).map(([size, value]) => [size, Number(value)]))
    : {}
  const hasInvalidSizeStock = Object.entries(stockBySize).some(([size, value]) => !sizes.includes(size) || !Number.isSafeInteger(value) || value < 0)
  const stock = hasSizeStock ? Object.values(stockBySize).reduce((total, value) => total + value, 0) : Number(body.stock)
  const composition = typeof body.composition === 'string' ? body.composition.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const designDescription = typeof body.designDescription === 'string' ? body.designDescription.trim() : ''
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const gallery = body.gallery
  if (name.length < 2 || name.length > 80) throw new Error('El nombre debe tener entre 2 y 80 caracteres.')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('El enlace del producto no es válido.')
  if (!Number.isSafeInteger(price) || price < 1) throw new Error('El precio debe ser un importe entero en pesos argentinos.')
  if (hasInvalidSizeStock || !Number.isSafeInteger(stock) || stock < 0) throw new Error('El stock por talle debe contener números enteros mayores o iguales a cero.')
  if (!category || category.length > 50) throw new Error('La categoría no es válida.')
  if (!composition || composition.length > 100) throw new Error('La composición es obligatoria.')
  if (!description || description.length > 500) throw new Error('La descripción debe tener hasta 500 caracteres.')
  if (!designDescription || designDescription.length > 500) throw new Error('La descripción del diseño debe tener hasta 500 caracteres.')
  if (!Array.isArray(gallery) || gallery.length < minimumProductImages || gallery.length > maximumProductImages) throw new Error(`Sube entre ${minimumProductImages} y ${maximumProductImages} imágenes del producto.`)
  return { name, slug, price, stock, stockBySize, composition, description, designDescription, category, gallery }
}

const requireProductBody = async (body) => {
  const product = validateProduct(body)
  const frontImage = await persistImage(product.gallery[0].src)
  const backImage = await persistImage(product.gallery[1].src)
  const extraImages = []
  for (const [index, image] of product.gallery.slice(2).entries()) {
    extraImages.push({ src: await persistImage(image?.src), alt: String(image?.alt || `Vista ${index + 3} de ${product.name}`).slice(0, 200) })
  }
  return {
    ...product,
    frontImage,
    frontAlt: String(product.gallery[0].alt || `Frente de ${product.name}`).slice(0, 200),
    backImage,
    backAlt: String(product.gallery[1].alt || `Espalda de ${product.name}`).slice(0, 200),
    extraImages,
    badge: typeof body.badge === 'string' ? body.badge.slice(0, 80) : '',
    features: Array.isArray(body.features) ? body.features.filter((feature) => typeof feature === 'string').slice(0, 12) : [product.composition],
  }
}

const insertProduct = database.prepare(`
  INSERT INTO products (slug, name, category, price_ars, stock, stock_by_size, composition, features_json, description, design_description, front_image, front_alt, back_image, back_alt, badge, extra_images)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const updateProduct = database.prepare(`
  UPDATE products SET slug = ?, name = ?, category = ?, price_ars = ?, stock = ?, stock_by_size = ?, composition = ?, features_json = ?, description = ?, design_description = ?, front_image = ?, front_alt = ?, back_image = ?, back_alt = ?, badge = ?, extra_images = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

app.post('/api/admin/products', requireAdmin, async (request, response) => {
  try {
    const product = await requireProductBody(request.body)
    const result = insertProduct.run(product.slug, product.name, product.category, product.price, product.stock, JSON.stringify(product.stockBySize || {}), product.composition, JSON.stringify(product.features), product.description, product.designDescription, product.frontImage, product.frontAlt, product.backImage, product.backAlt, product.badge, JSON.stringify(product.extraImages))
    response.status(201).json({ product: productFromRow(selectProductById.get(Number(result.lastInsertRowid))) })
  } catch (error) {
    response.status(error.message.includes('UNIQUE') ? 409 : 400).json({ error: error.message.includes('UNIQUE') ? 'Ya existe un producto con ese enlace.' : error.message })
  }
})

app.put('/api/admin/products/:id', requireAdmin, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || !selectProductById.get(id)) return response.status(404).json({ error: 'Producto no encontrado.' })
  try {
    const product = await requireProductBody(request.body)
    updateProduct.run(product.slug, product.name, product.category, product.price, product.stock, JSON.stringify(product.stockBySize || {}), product.composition, JSON.stringify(product.features), product.description, product.designDescription, product.frontImage, product.frontAlt, product.backImage, product.backAlt, product.badge, JSON.stringify(product.extraImages), id)
    response.json({ product: productFromRow(selectProductById.get(id)) })
  } catch (error) {
    response.status(error.message.includes('UNIQUE') ? 409 : 400).json({ error: error.message.includes('UNIQUE') ? 'Ya existe un producto con ese enlace.' : error.message })
  }
})

app.delete('/api/admin/products/:id', requireAdmin, (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id)) return response.status(400).json({ error: 'Identificador inválido.' })
  const result = database.prepare('DELETE FROM products WHERE id = ?').run(id)
  if (!result.changes) return response.status(404).json({ error: 'Producto no encontrado.' })
  response.json({ ok: true })
})

const serializeOrder = (order, extra = {}) => ({
  id: order.id,
  reference: order.reference,
  totalArs: order.total_ars,
  shippingCostArs: order.shipping_cost_ars ?? 0,
  status: order.status,
  createdAt: order.created_at,
  paymentUrl: order.status === 'pending_payment' ? order.payment_url : null,
  paymentMethod: order.payment_method ?? 'mercadopago',
  transfer: order.payment_method === 'transfer' && order.status === 'pending_payment' ? transferDetails() : null,
  shipping: {
    method: order.shipping_method ?? 'delivery',
    name: order.shipping_name ?? '',
    phone: order.shipping_phone ?? '',
    street: order.shipping_street ?? '',
    city: order.shipping_city ?? '',
    province: order.shipping_province ?? '',
    postalCode: order.shipping_postal_code ?? '',
    notes: order.shipping_notes ?? '',
  },
  carrier: order.carrier ?? '',
  trackingCode: order.tracking_code ?? '',
  trackingUrl: order.tracking_url ?? '',
  shippedAt: order.shipped_at ?? null,
  items: database.prepare('SELECT product_name AS name, product_slug AS slug, image_url AS image, size, quantity, unit_price_ars AS unitPriceArs FROM order_items WHERE order_id = ?').all(order.id),
  ...extra,
})

app.get('/api/account/shipping', requireAuth, (request, response) => {
  const last = database.prepare('SELECT * FROM orders WHERE user_id = ? AND shipping_name IS NOT NULL ORDER BY id DESC LIMIT 1').get(request.user.id)
  response.json({ shipping: last ? serializeOrder(last).shipping : null, name: request.user.name, phone: request.user.phone ?? '' })
})

app.get('/api/account/summary', requireAuth, (request, response) => {
  const favoriteRows = database.prepare(`SELECT p.* FROM favorites f JOIN products p ON p.id = f.product_id WHERE f.user_id = ? ORDER BY f.created_at DESC`).all(request.user.id)
  const orderRows = database.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 8').all(request.user.id)
  const orders = orderRows.map((order) => serializeOrder(order))
  const purchasedIds = new Set(database.prepare('SELECT DISTINCT oi.product_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = ? AND oi.product_id IS NOT NULL').all(request.user.id).map((row) => row.product_id))
  const favoriteIds = new Set(favoriteRows.map((product) => product.id))
  let recommendations = allProducts.all().map(productFromRow).filter((product) => !favoriteIds.has(product.id) && !purchasedIds.has(product.id)).slice(0, 4)
  if (!recommendations.length) recommendations = allProducts.all().map(productFromRow).filter((product) => !favoriteIds.has(product.id)).slice(0, 4)
  response.json({ favorites: favoriteRows.map(productFromRow), orders, recommendations })
})

app.post('/api/account/favorites/:productId', requireAuth, (request, response) => {
  const productId = Number(request.params.productId)
  if (!Number.isSafeInteger(productId) || !selectProductById.get(productId)) return response.status(404).json({ error: 'Producto no encontrado.' })
  database.prepare('INSERT OR IGNORE INTO favorites (user_id, product_id) VALUES (?, ?)').run(request.user.id, productId)
  response.json({ ok: true })
})

app.delete('/api/account/favorites/:productId', requireAuth, (request, response) => {
  database.prepare('DELETE FROM favorites WHERE user_id = ? AND product_id = ?').run(request.user.id, Number(request.params.productId))
  response.json({ ok: true })
})

const buildOrderFromItems = (items, userId) => {
  const allowedSizes = new Set(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'])
  if (!Array.isArray(items) || !items.length || items.length > 20) throw new Error('El pedido no tiene productos válidos.')
  const orderItems = []
  let total = 0
  for (const item of items) {
    const productId = Number(item.productId)
    const quantity = Number(item.quantity)
    const productRow = selectProductById.get(productId)
    if (!productRow || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || !allowedSizes.has(item.size)) throw new Error('Revisa los productos, cantidades y tallas del pedido.')
    const product = productFromRow(productRow)
    const stockForSize = Number(product.stockBySize?.[item.size] ?? 0)
    if (stockForSize < quantity) throw new Error(`No hay stock suficiente para ${product.name} en talla ${item.size}.`)
    total += product.price * quantity
    orderItems.push({ product, quantity, size: item.size })
  }
  const reference = `UF-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`
  return { orderItems, total, reference, userId }
}

const createOrderRecord = (request, items, shipping, { notify = true, paymentMethod = 'mercadopago' } = {}) => {
  const { orderItems, total: subtotal, reference, userId } = buildOrderFromItems(items, request.user.id)
  const shippingDetails = parseShippingDetails(shipping, subtotal)
  const total = subtotal + shippingDetails.costArs
  try {
    database.exec('BEGIN IMMEDIATE')
    const result = database.prepare('INSERT INTO orders (reference, user_id, total_ars, status, shipping_cost_ars, shipping_method, shipping_name, shipping_phone, shipping_street, shipping_city, shipping_province, shipping_postal_code, shipping_notes, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(reference, userId, total, 'pending_payment', shippingDetails.costArs, shippingDetails.method, shippingDetails.name, shippingDetails.phone, shippingDetails.street, shippingDetails.city, shippingDetails.province, shippingDetails.postalCode, shippingDetails.notes, paymentMethod)
    const orderId = Number(result.lastInsertRowid)
    const insertItem = database.prepare('INSERT INTO order_items (order_id, product_id, product_name, product_slug, image_url, size, quantity, unit_price_ars) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (const item of orderItems) {
      insertItem.run(orderId, item.product.id, item.product.name, item.product.slug, item.product.gallery?.[0]?.src ?? '', item.size, item.quantity, item.product.price)
      const existingStock = JSON.parse(selectProductById.get(item.product.id).stock_by_size || '{}')
      const nextSizeStock = Math.max(0, Number(existingStock[item.size] ?? 0) - item.quantity)
      existingStock[item.size] = nextSizeStock
      const nextTotalStock = Math.max(0, Number(selectProductById.get(item.product.id).stock || 0) - item.quantity)
      database.prepare('UPDATE products SET stock = ?, stock_by_size = ? WHERE id = ?').run(nextTotalStock, JSON.stringify(existingStock), item.product.id)
    }
    if (notify) createNotification(userId, 'order_created', 'Pedido registrado', `Tu pedido ${reference} quedó registrado y está pendiente de pago.`)
    database.exec('COMMIT')
    return { order: { id: orderId, reference, totalArs: total, shippingCostArs: shippingDetails.costArs, status: 'pending_payment' } }
  } catch {
    database.exec('ROLLBACK')
    throw new Error('No se pudo registrar el pedido.')
  }
}

// direction: 1 devuelve stock al inventario, -1 lo vuelve a descontar
const adjustOrderStock = (orderId, direction) => {
  const items = database.prepare('SELECT product_id, size, quantity FROM order_items WHERE order_id = ?').all(orderId)
  for (const item of items) {
    if (!item.product_id) continue
    const product = selectProductById.get(item.product_id)
    if (!product) continue
    const stockBySize = JSON.parse(product.stock_by_size || '{}')
    const delta = direction * Number(item.quantity)
    stockBySize[item.size] = Math.max(0, Number(stockBySize[item.size] ?? 0) + delta)
    const stock = Math.max(0, Number(product.stock ?? 0) + delta)
    database.prepare('UPDATE products SET stock = ?, stock_by_size = ? WHERE id = ?').run(stock, JSON.stringify(stockBySize), item.product_id)
  }
}

const cancelPendingOrderAndRestoreStock = (orderId, { removeOrder = false, reason = 'payment' } = {}) => {
  database.exec('BEGIN IMMEDIATE')
  try {
    const order = database.prepare('SELECT id, user_id, reference, status FROM orders WHERE id = ?').get(orderId)
    if (!order || order.status !== 'pending_payment') {
      database.exec('COMMIT')
      return false
    }
    const cancelled = database.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending_payment'").run(order.id)
    if (!cancelled.changes) {
      database.exec('COMMIT')
      return false
    }
    adjustOrderStock(order.id, 1)
    if (removeOrder) {
      database.prepare('DELETE FROM notifications WHERE user_id = ? AND kind = ? AND message = ?')
        .run(order.user_id, 'order_created', `Tu pedido ${order.reference} quedó registrado y está pendiente de pago.`)
      database.prepare('DELETE FROM orders WHERE id = ?').run(order.id)
    } else {
      createNotification(order.user_id, 'order_cancelled', 'Pago no completado', reason === 'expired'
        ? `El pedido ${order.reference} se canceló por falta de pago en ${pendingOrderExpiryDays} días. El stock fue liberado.`
        : `El pago del pedido ${order.reference} no se completó. El stock fue liberado.`)
    }
    database.exec('COMMIT')
    if (!removeOrder) void sendOrderEmail(order.id, 'cancelled')
    return true
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

const pendingOrderExpiryDays = Math.max(1, Number(process.env.PENDING_ORDER_EXPIRY_DAYS) || 3)
const cancelExpiredPendingOrders = () => {
  try {
    const expired = database.prepare("SELECT id FROM orders WHERE status = 'pending_payment' AND created_at <= datetime('now', ?)").all(`-${pendingOrderExpiryDays} days`)
    for (const { id } of expired) cancelPendingOrderAndRestoreStock(id, { reason: 'expired' })
    return expired.length
  } catch (error) {
    console.error('Could not cancel expired orders:', error.message)
    return 0
  }
}
cancelExpiredPendingOrders()
setInterval(cancelExpiredPendingOrders, 60 * 60 * 1000).unref()

app.post('/api/orders', requireAuth, (request, response) => {
  try {
    if (request.body.paymentMethod !== 'transfer') throw new Error('Elige un medio de pago válido.')
    if (request.body.acceptTerms !== true) throw new Error('Debes aceptar los términos y condiciones para continuar.')
    if (!transferDetails()) throw new Error('Las transferencias no están disponibles por el momento.')
    const result = createOrderRecord(request, request.body.items, request.body.shipping, { paymentMethod: 'transfer' })
    result.order.paymentMethod = 'transfer'
    result.order.transfer = transferDetails()
    void sendOrderEmail(result.order.id, 'created')
    response.status(201).json(result)
  } catch (error) {
    response.status(400).json({ error: error.message || 'No se pudo registrar el pedido.' })
  }
})

app.get('/api/account/notifications', requireAuth, (request, response) => {
  database.prepare('DELETE FROM notifications WHERE user_id = ? AND is_read = 1').run(request.user.id)
  const notifications = database.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(request.user.id)
  response.json({ notifications: notifications.map((notification) => ({
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    message: notification.message,
    isRead: Boolean(notification.is_read),
    createdAt: notification.created_at,
  })) })
})

app.patch('/api/account/notifications/:id/read', requireAuth, (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Notificación inválida.' })
  const result = database.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, request.user.id)
  if (!result.changes) return response.status(404).json({ error: 'Notificación no encontrada.' })
  response.json({ ok: true })
})

app.post('/api/newsletter', (request, response) => {
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Escribe un correo válido.' })
  try {
    database.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email) VALUES (?)').run(email)
    response.json({ ok: true, message: 'Gracias. Ya estás en la lista de UnFocus.' })
  } catch {
    response.status(500).json({ error: 'No se pudo completar la suscripción.' })
  }
})

app.post('/api/newsletter/unsubscribe', (request, response) => {
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Escribe un correo válido.' })
  database.prepare('DELETE FROM newsletter_subscribers WHERE email = ?').run(email)
  // Misma respuesta exista o no la suscripción, para no revelar qué correos están suscriptos.
  response.json({ ok: true, message: 'Listo. Si el correo estaba suscripto, ya no recibirá novedades de UnFocus.' })
})

app.post('/api/contact', async (request, response) => {
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : ''
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const subject = typeof request.body.subject === 'string' ? request.body.subject.trim().replace(/[\r\n]+/g, ' ') : ''
  const message = typeof request.body.message === 'string' ? request.body.message.trim() : ''
  if (name.length < 2 || name.length > 80) return response.status(400).json({ error: 'Escribe un nombre de entre 2 y 80 caracteres.' })
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Escribe un correo válido.' })
  if (subject.length < 3 || subject.length > 120) return response.status(400).json({ error: 'El asunto debe tener entre 3 y 120 caracteres.' })
  if (message.length < 10 || message.length > 4000) return response.status(400).json({ error: 'El mensaje debe tener entre 10 y 4000 caracteres.' })

  const result = database.prepare('INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)').run(name, email, subject, message)
  const messageId = Number(result.lastInsertRowid)
  const toEmail = process.env.CONTACT_TO_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim()
  const emailSent = await sendMail({
    to: toEmail,
    subject: `Contacto web: ${subject}`,
    text: `Nombre: ${name}\nCorreo: ${email}\nAsunto: ${subject}\n\n${message}`,
    replyTo: email,
    fromName: 'UnFocus · Contacto',
  })
  if (emailSent) database.prepare('UPDATE contact_messages SET email_sent = 1 WHERE id = ?').run(messageId)

  response.status(201).json({
    ok: true,
    emailSent,
    message: emailSent
      ? 'Tu mensaje fue enviado. Gracias por comunicarte con UnFocus.'
      : 'Recibimos tu mensaje y quedó disponible para el equipo. El envío de email está pendiente de configuración.',
  })
})

app.get('/api/admin/newsletter', requireAdmin, (_request, response) => {
  const subscribers = database.prepare('SELECT id, email, created_at AS createdAt FROM newsletter_subscribers ORDER BY created_at DESC').all()
  response.json({ subscribers })
})

app.delete('/api/admin/newsletter/:id', requireAdmin, (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Suscriptor inválido.' })
  const result = database.prepare('DELETE FROM newsletter_subscribers WHERE id = ?').run(id)
  if (!result.changes) return response.status(404).json({ error: 'Suscriptor no encontrado.' })
  response.json({ ok: true })
})

app.get('/api/admin/contact-messages', requireAdmin, (_request, response) => {
  const messages = database.prepare('SELECT id, name, email, subject, message, is_read AS isRead, email_sent AS emailSent, created_at AS createdAt FROM contact_messages ORDER BY created_at DESC LIMIT 100').all()
  response.json({ messages: messages.map((message) => ({ ...message, isRead: Boolean(message.isRead), emailSent: Boolean(message.emailSent) })) })
})

app.patch('/api/admin/contact-messages/:id/read', requireAdmin, (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Mensaje inválido.' })
  const result = database.prepare('UPDATE contact_messages SET is_read = 1 WHERE id = ?').run(id)
  if (!result.changes) return response.status(404).json({ error: 'Mensaje no encontrado.' })
  response.json({ ok: true })
})

app.get('/api/admin/summary', requireAdmin, (_request, response) => {
  const summary = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM products) AS products,
      (SELECT COUNT(*) FROM orders) AS orders,
      (SELECT COUNT(*) FROM orders WHERE status = 'pending_payment') AS pending,
      (SELECT COUNT(*) FROM orders WHERE status = 'paid') AS paid,
      (SELECT COALESCE(SUM(total_ars), 0) FROM orders WHERE status = 'paid') AS totalRevenue
  `).get()
  response.json({
    products: Number(summary.products),
    orders: Number(summary.orders),
    pending: Number(summary.pending),
    paid: Number(summary.paid),
    totalRevenue: Number(summary.totalRevenue),
  })
})

app.get('/api/admin/orders', requireAdmin, (_request, response) => {
  const orderRows = database.prepare(`
    SELECT o.*, u.name AS user_name, u.email AS user_email
    FROM orders o
    JOIN users u ON u.id = o.user_id
    ORDER BY o.created_at DESC
    LIMIT 50
  `).all()
  const orders = orderRows.map((order) => serializeOrder(order, { userName: order.user_name, userEmail: order.user_email }))
  response.json({ orders })
})

const orderStatuses = ['pending_payment', 'paid', 'shipped', 'delivered', 'cancelled']

app.get('/api/admin/settings', requireAdmin, (_request, response) => response.json({ settings: storeSettings }))

app.put('/api/admin/settings', requireAdmin, (request, response) => {
  const next = {}
  for (const key of settingKeys) {
    const raw = request.body?.[key]
    if (integerSettingKeys.has(key)) {
      const value = Number(raw)
      if (!Number.isInteger(value) || value < 0 || value > 100_000_000) return response.status(400).json({ error: 'Los importes deben ser números enteros de 0 en adelante.' })
      next[key] = value
    } else {
      next[key] = cleanText(raw, 200)
    }
  }
  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) return response.status(400).json({ error: 'Escribe un correo de contacto válido.' })
  const upsert = database.prepare('INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  for (const key of settingKeys) upsert.run(key, String(next[key]))
  Object.assign(storeSettings, next)
  response.json({ settings: storeSettings })
})

app.patch('/api/admin/orders/:id/status', requireAdmin, (request, response) => {
  const id = Number(request.params.id)
  const status = typeof request.body.status === 'string' ? request.body.status : ''
  if (!Number.isSafeInteger(id)) return response.status(400).json({ error: 'Pedido inválido.' })
  if (!orderStatuses.includes(status)) return response.status(400).json({ error: 'Estado de pedido inválido.' })
  const order = database.prepare('SELECT id, user_id, reference, status, tracking_code FROM orders WHERE id = ?').get(id)
  if (!order) return response.status(404).json({ error: 'Pedido no encontrado.' })
  const fulfilled = ['paid', 'shipped', 'delivered']
  if ((status === 'shipped' || status === 'delivered') && !fulfilled.includes(order.status)) return response.status(400).json({ error: 'Solo se pueden despachar pedidos pagados.' })
  const carrier = cleanText(request.body.carrier, 60)
  const trackingCode = cleanText(request.body.trackingCode, 80)
  const trackingUrl = cleanText(request.body.trackingUrl, 300)
  if (trackingUrl && !/^https?:\/\//i.test(trackingUrl)) return response.status(400).json({ error: 'El enlace de seguimiento debe comenzar con http:// o https://.' })
  const changed = order.status !== status
  if (changed && status === 'cancelled') adjustOrderStock(id, 1)
  if (changed && order.status === 'cancelled') adjustOrderStock(id, -1)
  if (status === 'shipped') {
    database.prepare("UPDATE orders SET status = ?, carrier = ?, tracking_code = ?, tracking_url = ?, shipped_at = COALESCE(shipped_at, CURRENT_TIMESTAMP) WHERE id = ?").run(status, carrier, trackingCode, trackingUrl, id)
  } else {
    database.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id)
  }
  if (changed && status === 'paid') {
    createNotification(order.user_id, 'order_paid', 'Compra confirmada', `Tu pedido ${order.reference} fue confirmado.`)
    void sendOrderEmail(id, 'paid')
  }
  if (changed && status === 'shipped') {
    createNotification(order.user_id, 'order_shipped', 'Pedido en camino', `Tu pedido ${order.reference} fue despachado.${trackingCode ? ` Seguimiento: ${trackingCode}.` : ''}`)
    void sendOrderEmail(id, 'shipped')
  }
  if (changed && status === 'delivered') createNotification(order.user_id, 'order_delivered', 'Pedido entregado', `Tu pedido ${order.reference} figura como entregado.`)
  if (changed && status === 'cancelled') {
    createNotification(order.user_id, 'order_cancelled', 'Pedido cancelado', `Tu pedido ${order.reference} fue cancelado.`)
    void sendOrderEmail(id, 'cancelled')
  }
  response.json({ ok: true, status, carrier, trackingCode, trackingUrl })
})

app.get('/api/products/:slug/reviews', (request, response) => {
  const product = selectProductBySlug.get(request.params.slug)
  if (!product) return response.status(404).json({ error: 'Producto no encontrado.' })
  const reviews = database.prepare(`
    SELECT pr.id, u.name AS userName, pr.rating, pr.comment, pr.created_at AS createdAt
    FROM product_reviews pr
    JOIN users u ON u.id = pr.user_id
    WHERE pr.product_id = ?
    ORDER BY pr.created_at DESC
    LIMIT 20
  `).all(product.id)
  response.json({ reviews })
})

app.post('/api/products/:slug/reviews', requireAuth, (request, response) => {
  const product = selectProductBySlug.get(request.params.slug)
  if (!product) return response.status(404).json({ error: 'Producto no encontrado.' })
  const rating = Number(request.body.rating)
  const comment = typeof request.body.comment === 'string' ? request.body.comment.trim() : ''
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return response.status(400).json({ error: 'La valoración debe estar entre 1 y 5.' })
  if (comment.length < 10 || comment.length > 500) return response.status(400).json({ error: 'El comentario debe tener entre 10 y 500 caracteres.' })
  try {
    database.prepare('INSERT INTO product_reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)')
      .run(product.id, request.user.id, rating, comment)
    response.status(201).json({ ok: true })
  } catch {
    response.status(409).json({ error: 'Ya dejaste una reseña para este producto.' })
  }
})

app.post('/api/payments/create-preference', requireAuth, async (request, response) => {
  if (!mercadoPagoClient) return response.status(503).json({ error: 'Mercado Pago no está configurado. Define MP_ACCESS_TOKEN en tu entorno.' })
  if (!isProduction && !mercadoPagoIsTestMode) return response.status(503).json({ error: 'Configura MP_ENVIRONMENT=test para usar credenciales de prueba en desarrollo.' })
  let order
  try {
    if (request.body.acceptTerms !== true) throw new Error('Debes aceptar los términos y condiciones para continuar.')
    order = createOrderRecord(request, request.body.items, request.body.shipping, { notify: false })
    const baseUrl = process.env.MP_RETURN_URL?.trim() || publicBaseUrl
    const webhookUrl = process.env.MP_WEBHOOK_URL || (isProduction ? new URL('/api/payments/webhook', publicBaseUrl).toString() : null)
    const preference = new Preference(mercadoPagoClient)
    const items = request.body.items.map((item) => {
      const product = selectProductById.get(Number(item.productId))
      if (!product) throw new Error('Producto no encontrado.')
      return {
        id: String(product.id),
        title: product.name,
        description: `Talla ${item.size}`,
        quantity: Number(item.quantity),
        unit_price: Number(product.price_ars),
        currency_id: 'ARS',
      }
    })
    if (order.order.shippingCostArs > 0) {
      items.push({ id: 'shipping', title: 'Envío a domicilio', quantity: 1, unit_price: order.order.shippingCostArs, currency_id: 'ARS' })
    }
    const preferenceBody = {
      items,
      payer: {
        email: request.user.email,
        name: request.user.name,
      },
      external_reference: order.order.reference,
      ...(/^https:\/\//i.test(baseUrl) ? { auto_return: 'approved' } : {}),
      back_urls: {
        success: `${baseUrl}/?cuenta=1&payment=success`,
        failure: `${baseUrl}/?cuenta=1&payment=failure`,
        pending: `${baseUrl}/?cuenta=1&payment=pending`,
      },
      ...(webhookUrl ? { notification_url: webhookUrl } : {}),
    }
    const formattedPreference = await preference.create({ body: preferenceBody })
    const paymentUrl = mercadoPagoIsTestMode ? formattedPreference.sandbox_init_point : formattedPreference.init_point
    if (!paymentUrl) throw new Error('Mercado Pago no devolvió el enlace de pago esperado para estas credenciales.')
    database.prepare('UPDATE orders SET payment_url = ? WHERE id = ?').run(paymentUrl, order.order.id)
    createNotification(request.user.id, 'order_created', 'Pedido registrado', `Tu pedido ${order.order.reference} quedó registrado y está pendiente de pago.`)
    void sendOrderEmail(order.order.id, 'created')
    response.json({
      order: order.order,
      paymentUrl,
      initPoint: paymentUrl,
    })
  } catch (error) {
    if (order?.order.id) {
      try {
        cancelPendingOrderAndRestoreStock(order.order.id, { removeOrder: true })
      } catch (rollbackError) {
        console.error('Could not release stock after payment preference failure:', rollbackError)
      }
    }
    response.status(400).json({ error: error.message || 'No se pudo crear la preferencia de pago.' })
  }
})

const mercadoPagoWebhookSecret = process.env.MP_WEBHOOK_SECRET?.trim()
if (isProduction && mercadoPagoAccessToken && !mercadoPagoWebhookSecret) console.warn('MP_WEBHOOK_SECRET no está definido: las notificaciones de Mercado Pago no se verifican por firma.')

// Valida la cabecera x-signature (HMAC-SHA256) descrita en la documentación de webhooks de Mercado Pago.
const hasValidWebhookSignature = (request, dataId) => {
  if (!mercadoPagoWebhookSecret) return true
  const signature = String(request.get('x-signature') ?? '')
  const requestId = String(request.get('x-request-id') ?? '')
  const parts = Object.fromEntries(signature.split(',').map((part) => part.trim().split(/=(.*)/s).slice(0, 2)))
  if (!parts.ts || !parts.v1) return false
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId
  const manifest = `${id ? `id:${id};` : ''}${requestId ? `request-id:${requestId};` : ''}ts:${parts.ts};`
  const expected = createHmac('sha256', mercadoPagoWebhookSecret).update(manifest).digest('hex')
  const received = String(parts.v1)
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received))
}

app.post('/api/payments/webhook', async (request, response) => {
  const type = request.body?.type
  const resource = request.body?.data?.id
  if (!type || !resource) return response.status(400).json({ ok: false })
  if (!hasValidWebhookSignature(request, String(request.query['data.id'] ?? resource))) return response.status(401).json({ ok: false })
  if (type !== 'payment') return response.json({ ok: true })
  if (!mercadoPagoAccessToken) return response.json({ ok: true })
  try {
    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${resource}`, {
      headers: {
        Authorization: `Bearer ${mercadoPagoAccessToken}`,
        'Content-Type': 'application/json',
      },
    })
    if (!paymentResponse.ok) throw new Error('No se pudo consultar el pago')
    const payment = await paymentResponse.json()
    const reference = payment.external_reference
    if (!reference) return response.json({ ok: true })
    const order = database.prepare('SELECT id, user_id, status FROM orders WHERE reference = ?').get(reference)
    if (!order) return response.json({ ok: true })
    const paymentId = String(payment.id ?? resource)
    const paymentStatus = String(payment.status ?? '').toLowerCase()
    if (!paymentStatus) return response.status(400).json({ ok: false })
    database.prepare(`
      INSERT INTO payment_attempts (payment_id, order_id, status, status_detail)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(payment_id) DO UPDATE SET
        status = excluded.status,
        status_detail = excluded.status_detail,
        updated_at = CURRENT_TIMESTAMP
      WHERE payment_attempts.order_id = excluded.order_id
    `).run(paymentId, order.id, paymentStatus, payment.status_detail ?? null)

    if (paymentStatus === 'approved') {
      database.exec('BEGIN IMMEDIATE')
      let becamePaid = false
      try {
        const currentOrder = database.prepare('SELECT id, user_id, reference, status FROM orders WHERE id = ?').get(order.id)
        if (currentOrder && ['pending_payment', 'cancelled'].includes(currentOrder.status)) {
          if (currentOrder.status === 'cancelled') adjustOrderStock(order.id, -1)
          database.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(order.id)
          createNotification(order.user_id, 'order_paid', 'Compra confirmada', `Tu pedido ${reference} fue confirmado.`)
          becamePaid = true
        }
        database.exec('COMMIT')
        if (becamePaid) void sendOrderEmail(order.id, 'paid')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    } else if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
      const attempts = database.prepare(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN status IN ('rejected', 'cancelled') THEN 1 ELSE 0 END) AS negative
        FROM payment_attempts WHERE order_id = ?
      `).get(order.id)
      if (attempts.total > 3 && attempts.total === attempts.negative) cancelPendingOrderAndRestoreStock(order.id)
    }
    response.json({ ok: true })
  } catch {
    response.status(500).json({ ok: false })
  }
})

app.use((error, _request, response, _next) => {
  if (response.headersSent) return
  const status = error.status === 413 ? 413 : 500
  response.status(status).json({ error: status === 413 ? 'La solicitud supera el tamaño permitido.' : 'Error interno del servidor.' })
})

if (isProduction) {
  app.use(express.static(path.join(projectDirectory, 'dist')))
  app.get(/^(?!\/api\/).*/, (_request, response) => response.sendFile(path.join(projectDirectory, 'dist', 'index.html')))
}

await new Promise((resolve) => app.listen(port, '0.0.0.0', resolve))
console.log(`UnFocus API listening on http://localhost:${port}`)
console.log(`SQLite database: ${databasePath}`)
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) console.log('No admin bootstrap configured. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env to create/promote an administrator.')

const shutdown = () => {
  database.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
