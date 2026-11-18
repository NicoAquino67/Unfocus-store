import { randomBytes, randomUUID, scrypt, createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createMysqlDatabase } from './mysql.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import compression from 'compression'
import { MercadoPagoConfig, Preference } from 'mercadopago'
import nodemailer from 'nodemailer'
import { CorreoArgentinoError, buildOrderPayload, createCorreoArgentinoClient, readCorreoArgentinoConfig } from './correoArgentino.mjs'
import { parseShippingSettings, shippingSettingsFields, shippingSettingsFromRows, shippingSettingsEnvironment, shippingSettingsPrefix } from './shippingSettings.mjs'
import { parseProvinceRates, provinceRatesKey, provinces, publicProvinceCosts } from './provinceRates.mjs'
import { paymentAttemptUpsertSql } from './paymentAttemptSql.mjs'
import { buildLlmsTxt, buildMarkdownPage, buildMcpServerCard, buildHomepageJsonLd, buildRobotsTxt, buildSitemapXml, injectAgentContent, injectImagePreload, injectProductMeta, injectSiteMeta, renderAgentContent } from './seo.mjs'

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
const configuredSameAs = (process.env.PUBLIC_SAME_AS || '').split(',').map((url) => url.trim()).filter(Boolean)
const publicSameAs = configuredSameAs.length ? configuredSameAs : ['https://www.instagram.com/unfocus.shop/']
if (publicSameAs.some((url) => !/^https:\/\/\S+$/i.test(url))) throw new Error('PUBLIC_SAME_AS debe contener URLs HTTPS separadas por comas.')
const persistentDataDirectory = isProduction && process.env.HOME ? path.join(process.env.HOME, 'unfocus-data') : projectDirectory
const resolveStoragePath = (configuredPath, defaultPath) => {
  const storagePath = configuredPath || defaultPath
  if (path.isAbsolute(storagePath)) return storagePath
  if (isProduction && !process.env.HOME) throw new Error('HOME es obligatorio en producción para guardar los datos fuera del directorio de despliegue.')
  return path.resolve(persistentDataDirectory, storagePath)
}

const uploadDirectory = resolveStoragePath(process.env.UPLOAD_DIR, 'uploads')
const sessionCookieName = 'unfocus_session'
const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 14
const maximumImageBytes = 4 * 1024 * 1024
const sizes = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']

await mkdir(uploadDirectory, { recursive: true })

const database = createMysqlDatabase()
await database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())

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

const createNotification = async (userId, kind, title, message, orderId = null) => {
  if (!userId) return
  await database.prepare('INSERT INTO notifications (user_id, kind, title, message, order_id) VALUES (?, ?, ?, ?, ?)').run(userId, kind, title, message, orderId)
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
const storeSettings = { ...envSettingDefaults }
for (const row of (await database.prepare('SELECT `key`, value FROM store_settings').all())) {
  if (settingKeys.includes(row.key)) storeSettings[row.key] = integerSettingKeys.has(row.key) ? Number(row.value) || 0 : row.value
}

const loadProvinceRates = async () => {
  const row = await database.prepare('SELECT value FROM store_settings WHERE `key` = ?').get(provinceRatesKey)
  return row ? parseProvinceRates(JSON.parse(row.value)) : {}
}

const calculateShippingCost = (subtotal, method, province, provinceRates) => {
  if (method === 'pickup') return 0
  if (storeSettings.freeShippingThresholdArs > 0 && subtotal >= storeSettings.freeShippingThresholdArs) return 0
  const rate = provinceRates[province]
  return rate ? rate.baseArs + rate.marginArs : storeSettings.shippingCostArs
}

const cleanText = (value, maxLength) => typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength) : ''

const parseShippingDetails = (input, subtotal, provinceRates) => {
  const method = input?.method === 'pickup' ? 'pickup' : 'delivery'
  if (method === 'pickup' && !storeSettings.pickupAddress) throw new Error('El retiro en persona no está disponible.')
  const name = cleanText(input?.name, 80)
  const phone = cleanText(input?.phone, 40)
  if (name.length < 2) throw new Error('Escribe el nombre de quien recibe el pedido.')
  if (!/^[\d+()\s.-]{6,40}$/.test(phone)) throw new Error('Escribe un teléfono de contacto válido.')
  const details = { method, name, phone, street: '', city: '', province: '', postalCode: '', notes: cleanText(input?.notes, 200), costArs: 0 }
  if (method === 'delivery') {
    details.street = cleanText(input?.street, 120)
    details.city = cleanText(input?.city, 80)
    details.province = cleanText(input?.province, 60)
    details.postalCode = cleanText(input?.postalCode, 10).toUpperCase()
    if (details.street.length < 3) throw new Error('Escribe la calle, el número y el piso o departamento.')
    if (details.city.length < 2) throw new Error('Escribe la localidad de entrega.')
    if (!provinces.includes(details.province)) throw new Error('Selecciona una provincia de entrega válida.')
    if (!/^[A-Z0-9 -]{4,10}$/.test(details.postalCode)) throw new Error('Escribe un código postal válido.')
  }
  details.costArs = calculateShippingCost(subtotal, method, details.province, provinceRates)
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

const notifyRestockedCustomers = async (productId, productName, stockBySize) => {
  const productSlug = (await database.prepare('SELECT slug FROM products WHERE id = ?').get(productId))?.slug
  const productUrl = `${publicBaseUrl.replace(/\/+$/, '')}/?producto=${encodeURIComponent(productSlug ?? '')}`
  for (const [size, quantity] of Object.entries(stockBySize)) {
    if (Number(quantity) <= 0) continue
    const subscriptions = (await database.prepare('SELECT id, email FROM restock_subscriptions WHERE product_id = ? AND size = ?').all(productId, size))
    for (const subscription of subscriptions) {
      const sent = await sendMail({
        to: subscription.email,
        subject: `${productName} volvió a tener stock`,
        text: `¡Buenas noticias! ${productName}, talle ${size}, volvió a estar disponible.\n\nVisita la tienda para ver la prenda: ${productUrl}`,
      })
      if (sent) await database.prepare('DELETE FROM restock_subscriptions WHERE id = ?').run(subscription.id)
      else console.warn('Restock notification email could not be delivered; subscription retained.', { productId, size })
    }
  }
}

const formatArs = (value) => `$ ${Number(value).toLocaleString('es-AR')}`
const shippingSummary = (order) => order.shipping_method === 'digital'
  ? 'Producto digital: no requiere envío.'
  : order.shipping_method === 'pickup'
  ? `Retiro en persona${storeSettings.pickupAddress ? `: ${storeSettings.pickupAddress}` : ''}`
  : `Envío a domicilio: ${[order.shipping_street, order.shipping_city, order.shipping_province, order.shipping_postal_code].filter(Boolean).join(', ')}`

const giftCardLines = async (orderId) => {
  const cards = (await database.prepare('SELECT code, initial_ars FROM gift_cards WHERE order_id = ? ORDER BY id').all(orderId))
  if (!cards.length) return ''
  return `Tu tarjeta de regalo${cards.length > 1 ? 's' : ''} (canjeable${cards.length > 1 ? 's' : ''} en el checkout, sin vencimiento):\n${cards.map((card) => `- ${card.code} · ${formatArs(card.initial_ars)}`).join('\n')}\n\n`
}

const sendOrderEmail = async (orderId, kind) => {
  const order = (await database.prepare('SELECT o.*, u.name AS user_name, u.email AS user_email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?').get(orderId))
  if (!order) return false
  const items = (await database.prepare('SELECT oi.product_name, oi.size, oi.quantity, oi.unit_price_ars, COALESCE(p.is_gift_card, 0) AS is_gift_card FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?').all(orderId))
  const itemLines = items.map((item) => `- ${item.quantity} × ${item.product_name} (${item.is_gift_card ? 'tarjeta' : `talle ${item.size}`}): ${formatArs(item.unit_price_ars * item.quantity)}`).join('\n')
  const totals = `${order.discount_ars ? `Descuento (${order.coupon_code}): -${formatArs(order.discount_ars)}\n` : ''}${order.gift_card_ars ? `Pagado con tarjeta de regalo: -${formatArs(order.gift_card_ars)}\n` : ''}Envío: ${order.shipping_cost_ars ? formatArs(order.shipping_cost_ars) : 'Sin cargo'}\nTotal: ${formatArs(order.total_ars)}`
  const greeting = `Hola ${order.user_name.split(' ')[0]},`
  const signature = '\nEquipo UnFocus\nBusca claridad. Abraza tu esencia.'
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
    body = `${greeting}\n\nConfirmamos el pago de tu pedido ${order.reference}.\n\n${itemLines}\n${totals}\n\n${shippingSummary(order)}\n\n${(await giftCardLines(orderId))}Te avisaremos por correo cuando lo despachemos.`
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

const createSession = async (response, userId) => {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + sessionLifetimeMs
  await database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expiresAt)
  response.cookie(sessionCookieName, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge: sessionLifetimeMs,
  })
}

const giftCardPresetAmounts = [30000, 50000, 75000, 100000, 150000, 200000, 300000, 400000, 500000]
const giftCardMinimumArs = 30000
const giftCardMaximumArs = 1000000

const parseExtraImages = (value) => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.filter((image) => typeof image?.src === 'string') : []
  } catch {
    return []
  }
}

// El precio original (price_ars) no se modifica nunca: el descuento se aplica encima.
const computeSalePrice = (price, type, value) => {
  if (type === 'percent') return Math.max(1, Math.round(price * (100 - value) / 100))
  if (type === 'fixed') return Math.max(1, price - value)
  return price
}

const productFromRow = (row) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  category: row.category,
  price: row.price_ars,
  discountType: row.discount_type || 'none',
  discountValue: Number(row.discount_value ?? 0),
  salePrice: computeSalePrice(row.price_ars, row.discount_type, Number(row.discount_value ?? 0)),
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
  colors: JSON.parse(row.colors_json || '[]'),
  badge: row.badge,
  createdAt: row.created_at,
  sold: Number(row.sold ?? 0),
  isGiftCard: Boolean(row.is_gift_card),
})

const adminProductFromRow = (row) => ({
  ...productFromRow(row),
  garmentCostArs: Number(row.garment_cost_ars ?? 0),
  logisticsCostArs: Number(row.logistics_cost_ars ?? 0),
  productionCostArs: Number(row.production_cost_ars ?? 0),
  taxPercent: Number(row.tax_percent ?? 0),
  profitPercent: Number(row.profit_percent ?? 0),
})

// sold = unidades en pedidos pagados; alimenta el orden por popularidad
const productSelect = "SELECT p.*, (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status IN ('paid', 'shipped', 'delivered')) AS sold FROM products p"
const selectProductById = database.prepare(`${productSelect} WHERE p.id = ?`)
const selectProductBySlug = database.prepare(`${productSelect} WHERE p.slug = ?`)
const allProducts = database.prepare(`${productSelect} ORDER BY p.id`)

const seedExtraImages = (product) => product.gallery.slice(2).map((image) => ({ src: image.src, alt: image.alt }))

const insertSeedProducts = async () => {
  if ((await database.prepare('SELECT COUNT(*) AS count FROM products').get()).count > 0) return
  const seed = JSON.parse(await readFile(path.join(serverDirectory, 'seed-products.json'), 'utf8'))
  const insert = database.prepare(`
    INSERT INTO products (id, slug, name, category, price_ars, stock, stock_by_size, composition, features_json, description, design_description, front_image, front_alt, back_image, back_alt, badge, extra_images)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const product of seed) {
    const stockBySize = product.stockBySize && typeof product.stockBySize === 'object' ? product.stockBySize : Object.fromEntries(sizes.map((size) => [size, 0]))
    const totalStock = Object.values(stockBySize).reduce((sum, value) => sum + Number(value || 0), 0)
    await insert.run(product.id, product.slug, product.name, product.category, product.price, totalStock, JSON.stringify(stockBySize), product.composition, JSON.stringify(product.features), product.description, product.designDescription, product.gallery[0].src, product.gallery[0].alt, product.gallery[1].src, product.gallery[1].alt, product.badge ?? '', JSON.stringify(seedExtraImages(product)))
  }
}

const bootstrapAdministrator = async () => {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) return
  if (password.length < 14) throw new Error('ADMIN_PASSWORD debe tener al menos 14 caracteres.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_EMAIL no es una dirección válida.')
  const existing = (await database.prepare('SELECT id FROM users WHERE email = ?').get(email))
  if (existing) {
    await database.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id)
    return
  }
  const passwordHash = await hashPassword(password)
  await database.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run(process.env.ADMIN_NAME?.trim() || 'UnFocus Admin', email, passwordHash)
}

await insertSeedProducts()

// Backfill: productos sembrados antes de existir la galería ampliada reciben su tercera imagen.
const backfillSeedImages = async () => {
  const seed = JSON.parse(await readFile(path.join(serverDirectory, 'seed-products.json'), 'utf8'))
  const update = database.prepare("UPDATE products SET extra_images = ? WHERE slug = ? AND extra_images = '[]'")
  for (const product of seed.products ?? seed) await update.run(JSON.stringify(seedExtraImages(product)), product.slug)
}
await backfillSeedImages()

// La tarjeta de regalo es un producto especial: su "talle" es el monto en ARS y no tiene stock.
const ensureGiftCardProduct = async () => {
  if ((await database.prepare('SELECT id FROM products WHERE is_gift_card = 1').get())) return
  const images = ['/gifts/tarjeta-1.svg', '/gifts/tarjeta-2.svg', '/gifts/tarjeta-3.svg']
  await database.prepare(`
    INSERT INTO products (slug, name, category, price_ars, stock, stock_by_size, composition, features_json, description, design_description, front_image, front_alt, back_image, back_alt, badge, extra_images, is_gift_card)
    VALUES ('tarjeta-de-regalo', 'Tarjeta de regalo', 'Regalos', ?, 0, '{}', 'Saldo digital', '[]', 'Regala libertad de elegir: recibes un código con el saldo que quieras para usar en cualquier compra de UnFocus.', 'Elige un monto entre $30.000 y $1.000.000. El código llega por correo apenas se confirma el pago y no vence.', ?, 'Tarjeta de regalo UnFocus', ?, 'Tarjeta de regalo UnFocus, versión oscura', 'REGALO', ?, 1)
  `).run(giftCardMinimumArs, images[0], images[1], JSON.stringify([{ src: images[2], alt: 'Tarjeta de regalo UnFocus, versión coral' }]))
}
await ensureGiftCardProduct()
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
  return next()
}

app.disable('x-powered-by')
app.set('trust proxy', isProduction ? 1 : false)
app.use(compression())
app.use(express.json({ limit: '6mb', inflate: false }))
app.use((request, response, next) => {
  const origin = request.get('origin')
  const isMcpRequest = request.path === '/mcp'
  const isAllowedOrigin = !origin || isMcpRequest || allowedOrigins.has(origin) || (isProduction ? origin.endsWith('.unfocus.shop') : ['localhost', '127.0.0.1'].includes(new URL(origin || 'http://localhost').hostname))
  if (origin && !isAllowedOrigin) return response.status(403).json({ error: 'Origen no permitido.' })
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', isMcpRequest ? '*' : origin)
    if (!isMcpRequest) response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader('Access-Control-Allow-Methods', isMcpRequest ? 'GET,POST,OPTIONS' : 'GET,POST,PUT,DELETE,OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', isMcpRequest ? 'Content-Type,Accept,MCP-Protocol-Version' : 'Content-Type,Authorization')
  }
  if (request.method === 'OPTIONS') return response.sendStatus(204)
  next()
})

const mcpTools = [{
  name: 'search_products',
  description: 'Busca prendas y tarjetas de regalo del catálogo público de UnFocus por nombre, categoría o descripción.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Texto de búsqueda opcional.' } },
    required: [],
    additionalProperties: false,
  },
}]

app.post('/mcp', (request, response) => applyRateLimit(request, response, async () => {
  const message = request.body
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return response.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Solicitud JSON-RPC inválida.' } })
  }
  const hasId = Object.prototype.hasOwnProperty.call(message, 'id')
  if (!hasId) return response.sendStatus(202)
  const reply = (result) => response.json({ jsonrpc: '2.0', id: message.id, result })
  const fail = (code, errorMessage) => response.json({ jsonrpc: '2.0', id: message.id, error: { code, message: errorMessage } })
  if (message.method === 'initialize') {
    const supportedVersion = ['2025-03-26', '2025-11-25'].includes(message.params?.protocolVersion)
      ? message.params.protocolVersion
      : '2025-11-25'
    response.setHeader('MCP-Protocol-Version', supportedVersion)
    return reply({
      protocolVersion: supportedVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'unfocus-store', version: '1.0.0' },
    })
  }
  if (message.method === 'ping') return reply({})
  if (message.method === 'tools/list') return reply({ tools: mcpTools })
  if (message.method === 'tools/call') {
    if (message.params?.name !== 'search_products') return fail(-32602, 'Herramienta desconocida.')
    const query = message.params?.arguments?.query
    if (query !== undefined && (typeof query !== 'string' || query.length > 120)) return fail(-32602, 'El texto de búsqueda no es válido.')
    const normalizedQuery = String(query ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
    const seoBaseUrl = publicBaseUrl.replace(/\/$/, '')
    const products = (await allProducts.all()).map(productFromRow)
      .filter((product) => !normalizedQuery || `${product.name} ${product.category} ${product.description}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').includes(normalizedQuery))
      .slice(0, 20)
      .map((product) => ({
        name: product.name,
        url: `${seoBaseUrl}/?producto=${encodeURIComponent(product.slug)}`,
        category: product.category,
        priceArs: product.salePrice ?? product.price,
        description: product.description,
      }))
    return reply({ content: [{ type: 'text', text: JSON.stringify(products) }], structuredContent: { products }, isError: false })
  }
  return fail(-32601, 'Método no encontrado.')
}, 60, 60_000))
app.get('/mcp', (_request, response) => response.setHeader('Allow', 'POST').status(405).json({ error: 'El servidor MCP solo acepta solicitudes POST.' }))

app.use('/uploads', express.static(uploadDirectory, { maxAge: '1y', immutable: true, fallthrough: false }))
if (!isProduction) app.use('/ident', express.static(path.join(projectDirectory, 'ident'), { maxAge: '1d' }))

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

app.use('/api', async (request, _response, next) => {
  const token = parseCookies(request.headers.cookie)[sessionCookieName]
  if (token) {
    const session = (await database.prepare(`
      SELECT u.id, u.name, u.email, u.phone, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(sha256(token), Date.now()))
    if (session) request.user = session
    else await database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
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
const restockAttempts = new Map()
const limitAuthAttempts = (request, response, next) => {
  const now = Date.now()
  const key = request.ip || 'unknown'
  const activeAttempts = (authAttempts.get(key) ?? []).filter((time) => now - time < 10 * 60 * 1000)
  if (activeAttempts.length >= 12) return response.status(429).json({ error: 'Demasiados intentos. Espera unos minutos y vuelve a probar.' })
  activeAttempts.push(now)
  authAttempts.set(key, activeAttempts)
  next()
}
const limitRestockRequests = (request, response, next) => {
  const now = Date.now()
  const key = request.ip || 'unknown'
  const activeAttempts = (restockAttempts.get(key) ?? []).filter((time) => now - time < 10 * 60 * 1000)
  if (activeAttempts.length >= 10) return response.status(429).json({ error: 'Demasiadas solicitudes. Espera unos minutos y vuelve a probar.' })
  activeAttempts.push(now)
  restockAttempts.set(key, activeAttempts)
  next()
}

// Permite comprar sin cuenta: crea (o reutiliza) un usuario "invitado" que no puede iniciar sesión.
const resolveCheckoutUser = async (request, response, next) => {
  if (request.user) return next()
  const guest = request.body?.guest
  const name = typeof guest?.name === 'string' ? guest.name.trim() : ''
  const email = typeof guest?.email === 'string' ? guest.email.trim().toLowerCase() : ''
  const phone = typeof guest?.phone === 'string' ? guest.phone.trim().slice(0, 40) : ''
  if (!guest) return response.status(401).json({ error: 'Inicia sesión o continúa como invitado para comprar.' })
  if (name.length < 2 || name.length > 80) return response.status(400).json({ error: 'Escribe tu nombre para continuar como invitado.' })
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Escribe un correo válido para recibir la confirmación.' })
  const existing = (await database.prepare('SELECT id, is_guest FROM users WHERE email = ?').get(email))
  if (existing && !existing.is_guest) return response.status(409).json({ error: 'Ese correo ya tiene una cuenta. Inicia sesión para continuar.' })
  let userId = existing?.id
  if (userId) await database.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, userId)
  else userId = Number((await database.prepare("INSERT INTO users (name, email, phone, password_hash, is_guest) VALUES (?, ?, ?, 'guest', 1)").run(name, email, phone)).lastInsertRowid)
  request.user = { id: userId, name, email, phone, role: 'customer', isGuest: true }
  limitAuthAttempts(request, response, next)
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

const publicStoreConfig = (provinceRates) => ({
  shipping: { costArs: storeSettings.shippingCostArs, freeThresholdArs: storeSettings.freeShippingThresholdArs, pickupAddress: storeSettings.pickupAddress, provinceCostsArs: publicProvinceCosts(provinceRates) },
  transfer: transferDetails(),
  store: { legalName: storeSettings.legalName, taxId: storeSettings.taxId, address: storeSettings.address, email: storeSettings.email, phone: storeSettings.phone },
})

app.get('/api/config', async (_request, response) => {
  const provinceRates = await loadProvinceRates()
  const configuredRate = Number(process.env.USD_ARS_RATE)
  if (Number.isFinite(configuredRate) && configuredRate > 0) {
    return response.json({ defaultCurrency: 'ARS', usdArsRate: configuredRate, exchangeSource: 'configuración', exchangeUpdatedAt: null, ...publicStoreConfig(provinceRates) })
  }
  try {
    const quoteResponse = await fetch('https://dolarapi.com/v1/dolares/oficial', { signal: AbortSignal.timeout(5000) })
    if (!quoteResponse.ok) throw new Error('Cotización temporalmente no disponible.')
    const quote = await quoteResponse.json()
    if (typeof quote.venta !== 'number' || quote.venta <= 0) throw new Error('Cotización inválida.')
    response.json({ defaultCurrency: 'ARS', usdArsRate: quote.venta, exchangeSource: 'Dólar oficial · DolarAPI', exchangeUpdatedAt: quote.fechaActualizacion, ...publicStoreConfig(provinceRates) })
  } catch {
    response.json({ defaultCurrency: 'ARS', usdArsRate: null, exchangeSource: null, exchangeUpdatedAt: null, ...publicStoreConfig(provinceRates) })
  }
})

app.get('/api/products', async (_request, response) => {
  response.json({ products: (await allProducts.all()).map(productFromRow) })
})

app.get('/api/products/:slug', async (request, response) => {
  const product = (await selectProductBySlug.get(request.params.slug))
  if (!product) return response.status(404).json({ error: 'Producto no encontrado.' })
  response.json({ product: productFromRow(product) })
})

const sessionDurationSeconds = Math.floor(sessionLifetimeMs / 1000)
const createUserSession = async (request, response, user) => {
  await createSession(response, user.id)
  request.user = user
  response.json({ user: publicUser(user) })
}

app.get('/api/auth/me', (request, response) => {
  response.json({ user: request.user ? publicUser(request.user) : null })
})

app.post('/api/auth/request-password-reset', async (request, response) => {
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Escribe un correo válido.' })
  const user = (await database.prepare('SELECT id FROM users WHERE email = ?').get(email))
  if (user) {
    const token = randomBytes(32).toString('hex')
    const tokenHash = sha256(token)
    const expiresAt = Date.now() + 1000 * 60 * 30
    await database.prepare('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(user.id, tokenHash, expiresAt)
    const recipient = (await database.prepare('SELECT name FROM users WHERE id = ?').get(user.id))
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
  const user = (await database.prepare('SELECT id FROM users WHERE email = ?').get(email))
  if (!user) return response.status(400).json({ error: 'No se pudo validar la solicitud.' })
  const reset = (await database.prepare('SELECT * FROM password_reset_tokens WHERE user_id = ? AND expires_at > ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1').get(user.id, Date.now()))
  if (!reset || reset.token_hash !== sha256(token)) return response.status(400).json({ error: 'El token de acceso no es válido o ya expiró.' })
  const passwordHash = await hashPassword(password)
  await database.prepare('UPDATE users SET password_hash = ?, is_guest = 0 WHERE id = ?').run(passwordHash, user.id)
  await database.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(Date.now(), reset.id)
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
  const existingUser = (await database.prepare('SELECT id, is_guest FROM users WHERE email = ?').get(email))
  if (existingUser && !existingUser.is_guest) return response.status(409).json({ error: 'Ya existe una cuenta con ese correo.' })
  try {
    const passwordHash = await hashPassword(password)
    // Si el correo ya compró como invitado, la cuenta nueva hereda ese historial de pedidos.
    const userId = existingUser
      ? ((await database.prepare('UPDATE users SET name = ?, phone = ?, password_hash = ?, is_guest = 0 WHERE id = ?').run(name, phone, passwordHash, existingUser.id)), existingUser.id)
      : Number((await database.prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)').run(name, email, phone, passwordHash)).lastInsertRowid)
    const user = (await database.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(userId))
    void sendMail({
      to: email,
      subject: '¡Bienvenido/a a UnFocus!',
      text: `Hola ${name.split(' ')[0]},\n\nTu cuenta en UnFocus ya está lista. Desde ella puedes seguir tus pedidos, guardar favoritos y retomar pagos pendientes.\n\nEquipo UnFocus\nBusca claridad. Abraza tu esencia.`,
      replyTo: storeSettings.email || undefined,
    })
    return (await createUserSession(request, response, user))
  } catch {
    return response.status(500).json({ error: 'No se pudo crear la cuenta.' })
  }
})

app.post('/api/auth/login', limitAuthAttempts, async (request, response) => {
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const password = typeof request.body.password === 'string' ? request.body.password : ''
  const user = (await database.prepare('SELECT id, name, email, phone, password_hash, role FROM users WHERE email = ?').get(email))
  if (!user || !(await verifyPassword(password, user.password_hash))) return response.status(401).json({ error: 'Correo o contraseña incorrectos.' })
  const { password_hash: _passwordHash, ...sessionUser } = user
  return (await createUserSession(request, response, sessionUser))
})

app.post('/api/auth/logout', async (request, response) => {
  const token = parseCookies(request.headers.cookie)[sessionCookieName]
  if (token) await database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
  response.clearCookie(sessionCookieName, { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/' })
  response.json({ ok: true })
})

const persistImage = async (value) => {
  if (typeof value !== 'string') throw new Error('Cada vista necesita una imagen.')
  if (/^\/ident\/productos\/[a-zA-Z0-9_-]+\.jpg$/.test(value)) return value
  if (/^\/gifts\/[a-zA-Z0-9_-]+\.svg$/.test(value)) return value
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
  const garmentCostArs = Number(body.garmentCostArs ?? 0)
  const logisticsCostArs = Number(body.logisticsCostArs ?? 0)
  const productionCostArs = Number(body.productionCostArs ?? 0)
  const taxPercent = Number(body.taxPercent ?? 0)
  const profitPercent = Number(body.profitPercent ?? 0)
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
  const discountType = ['percent', 'fixed'].includes(body.discountType) ? body.discountType : 'none'
  const discountValue = discountType === 'none' ? 0 : Number(body.discountValue)
  const gallery = body.gallery
  const colors = body.colors ?? []
  if (name.length < 2 || name.length > 80) throw new Error('El nombre debe tener entre 2 y 80 caracteres.')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('El enlace del producto no es válido.')
  if (!Number.isSafeInteger(price) || price < 1) throw new Error('El precio debe ser un importe entero en pesos argentinos.')
  if (![garmentCostArs, logisticsCostArs, productionCostArs].every((cost) => Number.isSafeInteger(cost) && cost >= 0)) throw new Error('Los costos deben ser importes enteros mayores o iguales a cero.')
  if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent >= 100) throw new Error('El porcentaje de impuestos debe ser mayor o igual a cero y menor a 100.')
  if (!Number.isFinite(profitPercent) || profitPercent < 0 || profitPercent > 1000) throw new Error('La ganancia porcentual debe estar entre 0 y 1000.')
  if (discountType === 'percent' && (!Number.isInteger(discountValue) || discountValue < 1 || discountValue > 90)) throw new Error('El descuento porcentual debe ser un entero entre 1 y 90.')
  if (discountType === 'fixed' && (!Number.isInteger(discountValue) || discountValue < 1 || discountValue >= price)) throw new Error('El descuento en pesos debe ser un entero menor al precio original.')
  if (hasInvalidSizeStock || !Number.isSafeInteger(stock) || stock < 0) throw new Error('El stock por talle debe contener números enteros mayores o iguales a cero.')
  if (!category || category.length > 50) throw new Error('La categoría no es válida.')
  if (!composition || composition.length > 100) throw new Error('La composición es obligatoria.')
  if (!description || description.length > 500) throw new Error('La descripción debe tener hasta 500 caracteres.')
  if (!designDescription || designDescription.length > 500) throw new Error('La descripción del diseño debe tener hasta 500 caracteres.')
  if (!Array.isArray(gallery) || gallery.length < minimumProductImages || gallery.length > maximumProductImages) throw new Error(`Sube entre ${minimumProductImages} y ${maximumProductImages} imágenes del producto.`)
  if (!Array.isArray(colors) || colors.length > 12) throw new Error('Configura hasta 12 colores por producto.')
  const normalizedColors = colors.map((color) => {
    const colorName = typeof color?.name === 'string' ? color.name.trim() : ''
    const hex = typeof color?.hex === 'string' ? color.hex : ''
    const imageIndexes = color?.imageIndexes
    if (!colorName || colorName.length > 32) throw new Error('Cada color debe tener un nombre de hasta 32 caracteres.')
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`La muestra del color ${colorName} no es válida.`)
    if (!Array.isArray(imageIndexes) || imageIndexes.length < 1 || imageIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= gallery.length)) {
      throw new Error(`Selecciona al menos una imagen válida para el color ${colorName}.`)
    }
    return { name: colorName, hex: hex.toUpperCase(), imageIndexes: [...new Set(imageIndexes)] }
  })
  if (new Set(normalizedColors.map((color) => color.name.toLocaleLowerCase())).size !== normalizedColors.length) throw new Error('Los nombres de color no se pueden repetir.')
  return { name, slug, price, garmentCostArs, logisticsCostArs, productionCostArs, taxPercent, profitPercent, discountType, discountValue, stock, stockBySize, composition, description, designDescription, category, gallery, colors: normalizedColors }
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
    badge: product.discountType === 'none' ? '' : 'PROMO',
    features: Array.isArray(body.features) ? body.features.filter((feature) => typeof feature === 'string').slice(0, 12) : [product.composition],
  }
}

const insertProduct = database.prepare(`
  INSERT INTO products (slug, name, category, price_ars, garment_cost_ars, logistics_cost_ars, production_cost_ars, tax_percent, profit_percent, stock, stock_by_size, composition, features_json, description, design_description, front_image, front_alt, back_image, back_alt, badge, extra_images, discount_type, discount_value, colors_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const updateProduct = database.prepare(`
  UPDATE products SET slug = ?, name = ?, category = ?, price_ars = ?, garment_cost_ars = ?, logistics_cost_ars = ?, production_cost_ars = ?, tax_percent = ?, profit_percent = ?, stock = ?, stock_by_size = ?, composition = ?, features_json = ?, description = ?, design_description = ?, front_image = ?, front_alt = ?, back_image = ?, back_alt = ?, badge = ?, extra_images = ?, discount_type = ?, discount_value = ?, colors_json = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`)

app.post('/api/admin/products', requireAdmin, async (request, response) => {
  try {
    const product = await requireProductBody(request.body)
    const result = (await insertProduct.run(product.slug, product.name, product.category, product.price, product.garmentCostArs, product.logisticsCostArs, product.productionCostArs, product.taxPercent, product.profitPercent, product.stock, JSON.stringify(product.stockBySize || {}), product.composition, JSON.stringify(product.features), product.description, product.designDescription, product.frontImage, product.frontAlt, product.backImage, product.backAlt, product.badge, JSON.stringify(product.extraImages), product.discountType, product.discountValue, JSON.stringify(product.colors)))
    response.status(201).json({ product: productFromRow((await selectProductById.get(Number(result.lastInsertRowid)))) })
  } catch (error) {
    response.status(error.code === 'ER_DUP_ENTRY' ? 409 : 400).json({ error: error.code === 'ER_DUP_ENTRY' ? 'Ya existe un producto con ese enlace.' : error.message })
  }
})

app.put('/api/admin/products/:id', requireAdmin, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || !(await selectProductById.get(id))) return response.status(404).json({ error: 'Producto no encontrado.' })
  try {
    const product = await requireProductBody(request.body)
    await updateProduct.run(product.slug, product.name, product.category, product.price, product.garmentCostArs, product.logisticsCostArs, product.productionCostArs, product.taxPercent, product.profitPercent, product.stock, JSON.stringify(product.stockBySize || {}), product.composition, JSON.stringify(product.features), product.description, product.designDescription, product.frontImage, product.frontAlt, product.backImage, product.backAlt, product.badge, JSON.stringify(product.extraImages), product.discountType, product.discountValue, JSON.stringify(product.colors), id)
    await notifyRestockedCustomers(id, product.name, product.stockBySize || {})
    response.json({ product: productFromRow((await selectProductById.get(id))) })
  } catch (error) {
    response.status(error.code === 'ER_DUP_ENTRY' ? 409 : 400).json({ error: error.code === 'ER_DUP_ENTRY' ? 'Ya existe un producto con ese enlace.' : error.message })
  }
})

app.delete('/api/admin/products/:id', requireAdmin, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id)) return response.status(400).json({ error: 'Identificador inválido.' })
  const result = (await database.prepare('DELETE FROM products WHERE id = ?').run(id))
  if (!result.changes) return response.status(404).json({ error: 'Producto no encontrado.' })
  response.json({ ok: true })
})

app.get('/api/admin/products', requireAdmin, async (_request, response) => {
  response.json({ products: (await allProducts.all()).map(adminProductFromRow) })
})

const serializeOrder = async (order, extra = {}) => ({
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
  couponCode: order.coupon_code ?? '',
  discountArs: order.discount_ars ?? 0,
  giftCardArs: order.gift_card_ars ?? 0,
  giftCards: ['paid', 'shipped', 'delivered'].includes(order.status) ? (await database.prepare('SELECT code, initial_ars AS initialArs, balance_ars AS balanceArs FROM gift_cards WHERE order_id = ? ORDER BY id').all(order.id)) : [],
  trackingUrl: order.tracking_url ?? '',
  shippedAt: order.shipped_at ?? null,
  correoArgentino: Boolean(order.ca_tracking_number),
  miCorreoImported: Boolean(order.mc_imported_at),
  items: (await database.prepare('SELECT product_name AS name, product_slug AS slug, image_url AS image, size, quantity, unit_price_ars AS unitPriceArs FROM order_items WHERE order_id = ?').all(order.id)),
  ...extra,
})

app.get('/api/account/shipping', requireAuth, async (request, response) => {
  const last = (await database.prepare('SELECT * FROM orders WHERE user_id = ? AND shipping_name IS NOT NULL ORDER BY id DESC LIMIT 1').get(request.user.id))
  response.json({ shipping: last ? (await serializeOrder(last)).shipping : null, name: request.user.name, phone: request.user.phone ?? '' })
})

const addressSelect = `SELECT id, label, name, phone, street, city, province, postal_code AS postalCode, is_default AS isDefault FROM saved_addresses WHERE user_id = ?`
const parseAddressBody = (input) => {
  const label = cleanText(input?.label, 50)
  const name = cleanText(input?.name, 80)
  const phone = cleanText(input?.phone, 40)
  const street = cleanText(input?.street, 120)
  const city = cleanText(input?.city, 80)
  const province = cleanText(input?.province, 80)
  const postalCode = cleanText(input?.postalCode, 10).toUpperCase()
  if (label.length < 2 || name.length < 2 || phone.length < 6 || street.length < 3 || city.length < 2 || province.length < 2 || !/^[A-Z0-9 -]{4,10}$/.test(postalCode)) {
    throw new Error('Completa todos los datos de la dirección con información válida.')
  }
  return { label, name, phone, street, city, province, postalCode, isDefault: input?.isDefault === true }
}

const setDefaultAddress = async (userId, addressId) => {
  await database.prepare('UPDATE saved_addresses SET is_default = 0 WHERE user_id = ?').run(userId)
  await database.prepare('UPDATE saved_addresses SET is_default = 1 WHERE id = ? AND user_id = ?').run(addressId, userId)
}

app.get('/api/account/addresses', requireAuth, async (request, response) => {
  response.json({ addresses: (await database.prepare(`${addressSelect} ORDER BY is_default DESC, id DESC`).all(request.user.id)).map((address) => ({ ...address, isDefault: Boolean(address.isDefault) })) })
})

app.post('/api/account/addresses', requireAuth, async (request, response) => {
  try {
    const address = parseAddressBody(request.body)
    const count = (await database.prepare('SELECT COUNT(*) AS count FROM saved_addresses WHERE user_id = ?').get(request.user.id)).count
    const result = (await database.prepare('INSERT INTO saved_addresses (user_id, label, name, phone, street, city, province, postal_code, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(request.user.id, address.label, address.name, address.phone, address.street, address.city, address.province, address.postalCode, Number(address.isDefault || count === 0)))
    if (address.isDefault) await setDefaultAddress(request.user.id, Number(result.lastInsertRowid))
    response.status(201).json({ addresses: (await database.prepare(`${addressSelect} ORDER BY is_default DESC, id DESC`).all(request.user.id)).map((item) => ({ ...item, isDefault: Boolean(item.isDefault) })) })
  } catch (error) {
    response.status(400).json({ error: error.message || 'No se pudo guardar la dirección.' })
  }
})

app.put('/api/account/addresses/:id', requireAuth, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id)) return response.status(400).json({ error: 'Identificador inválido.' })
  try {
    const address = parseAddressBody(request.body)
    const previous = (await database.prepare('SELECT is_default FROM saved_addresses WHERE id = ? AND user_id = ?').get(id, request.user.id))
    const result = (await database.prepare('UPDATE saved_addresses SET label = ?, name = ?, phone = ?, street = ?, city = ?, province = ?, postal_code = ? WHERE id = ? AND user_id = ?').run(address.label, address.name, address.phone, address.street, address.city, address.province, address.postalCode, id, request.user.id))
    if (!result.changes) return response.status(404).json({ error: 'Dirección no encontrada.' })
    if (address.isDefault) await setDefaultAddress(request.user.id, id)
    else if (previous?.is_default) {
      const next = (await database.prepare('SELECT id FROM saved_addresses WHERE user_id = ? AND id != ? ORDER BY id DESC LIMIT 1').get(request.user.id, id))
      await setDefaultAddress(request.user.id, next?.id ?? id)
    }
    response.json({ addresses: (await database.prepare(`${addressSelect} ORDER BY is_default DESC, id DESC`).all(request.user.id)).map((item) => ({ ...item, isDefault: Boolean(item.isDefault) })) })
  } catch (error) {
    response.status(400).json({ error: error.message || 'No se pudo actualizar la dirección.' })
  }
})

app.delete('/api/account/addresses/:id', requireAuth, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id)) return response.status(400).json({ error: 'Identificador inválido.' })
  const existing = (await database.prepare('SELECT is_default FROM saved_addresses WHERE id = ? AND user_id = ?').get(id, request.user.id))
  if (!existing) return response.status(404).json({ error: 'Dirección no encontrada.' })
  await database.prepare('DELETE FROM saved_addresses WHERE id = ? AND user_id = ?').run(id, request.user.id)
  if (existing.is_default) {
    const next = (await database.prepare('SELECT id FROM saved_addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(request.user.id))
    if (next) await setDefaultAddress(request.user.id, next.id)
  }
  response.json({ addresses: (await database.prepare(`${addressSelect} ORDER BY is_default DESC, id DESC`).all(request.user.id)).map((item) => ({ ...item, isDefault: Boolean(item.isDefault) })) })
})

app.post('/api/products/:slug/restock-notifications', limitRestockRequests, async (request, response) => {
  const product = (await database.prepare('SELECT id, name, is_gift_card, stock_by_size FROM products WHERE slug = ?').get(request.params.slug))
  if (!product || product.is_gift_card) return response.status(404).json({ error: 'Producto no encontrado.' })
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  const size = typeof request.body?.size === 'string' ? request.body.size.trim().toUpperCase() : ''
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^(XS|S|M|L|XL|2XL|3XL)$/.test(size)) {
    return response.status(400).json({ error: 'Ingresa un correo válido y selecciona un talle.' })
  }
  const stockBySize = JSON.parse(product.stock_by_size || '{}')
  if (Number(stockBySize[size] ?? 0) > 0) return response.status(409).json({ error: 'Ese talle ya está disponible. Actualiza la página para comprarlo.' })
  await database.prepare('INSERT INTO restock_subscriptions (product_id, size, email) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE product_id = product_id').run(product.id, size, email)
  response.status(201).json({ message: `Te avisaremos por email cuando vuelva ${product.name}, talle ${size}.` })
})

app.get('/api/account/summary', requireAuth, async (request, response) => {
  const favoriteRows = (await database.prepare(`SELECT p.* FROM favorites f JOIN products p ON p.id = f.product_id WHERE f.user_id = ? ORDER BY f.created_at DESC`).all(request.user.id))
  const orderRows = (await database.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 8').all(request.user.id))
  const orders = await Promise.all(orderRows.map((order) => serializeOrder(order)))
  const purchasedIds = new Set((await database.prepare('SELECT DISTINCT oi.product_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = ? AND oi.product_id IS NOT NULL').all(request.user.id)).map((row) => row.product_id))
  const favoriteIds = new Set(favoriteRows.map((product) => product.id))
  let recommendations = (await allProducts.all()).map(productFromRow).filter((product) => !favoriteIds.has(product.id) && !purchasedIds.has(product.id)).slice(0, 4)
  if (!recommendations.length) recommendations = (await allProducts.all()).map(productFromRow).filter((product) => !favoriteIds.has(product.id)).slice(0, 4)
  response.json({ favorites: favoriteRows.map(productFromRow), orders, recommendations })
})

app.post('/api/account/favorites/:productId', requireAuth, async (request, response) => {
  const productId = Number(request.params.productId)
  if (!Number.isSafeInteger(productId) || !(await selectProductById.get(productId))) return response.status(404).json({ error: 'Producto no encontrado.' })
  await database.prepare('INSERT INTO favorites (user_id, product_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id').run(request.user.id, productId)
  response.json({ ok: true })
})

app.delete('/api/account/favorites/:productId', requireAuth, async (request, response) => {
  await database.prepare('DELETE FROM favorites WHERE user_id = ? AND product_id = ?').run(request.user.id, Number(request.params.productId))
  response.json({ ok: true })
})

// Genera los códigos de las tarjetas de regalo compradas (una vez por pedido).
const issueGiftCards = async (orderId) => {
  if ((await database.prepare('SELECT 1 FROM gift_cards WHERE order_id = ?').get(orderId))) return
  const lines = (await database.prepare('SELECT oi.size, oi.quantity FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? AND p.is_gift_card = 1').all(orderId))
  const insert = database.prepare('INSERT INTO gift_cards (code, initial_ars, balance_ars, order_id) VALUES (?, ?, ?, ?)')
  for (const line of lines) {
    for (let index = 0; index < line.quantity; index += 1) {
      const hex = randomBytes(6).toString('hex').toUpperCase()
      await insert.run(`GC-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8)}`, Number(line.size), Number(line.size), orderId)
    }
  }
}

const couponSelect = 'SELECT id, code, type, value, min_subtotal_ars AS minSubtotal, max_uses AS maxUses, uses, expires_at AS expiresAt, active, created_at AS createdAt FROM coupons'

// Devuelve el cupón y el descuento aplicable al subtotal elegible o lanza un error legible.
const evaluateCoupon = async (rawCode, eligibleSubtotal, forUpdate = false) => {
  const code = typeof rawCode === 'string' ? rawCode.trim() : ''
  const coupon = code ? (await database.prepare(`${couponSelect} WHERE code = ?${forUpdate ? ' FOR UPDATE' : ''}`).get(code)) : null
  if (!coupon || !coupon.active) throw new Error('El código de descuento no es válido.')
  if (coupon.expiresAt && new Date(`${coupon.expiresAt}T23:59:59`).getTime() < Date.now()) throw new Error('El código de descuento venció.')
  if (coupon.maxUses > 0 && coupon.uses >= coupon.maxUses) throw new Error('El código de descuento alcanzó su límite de usos.')
  if (eligibleSubtotal < coupon.minSubtotal) throw new Error(`El código requiere una compra mínima de $${coupon.minSubtotal.toLocaleString('es-AR')}.`)
  const raw = coupon.type === 'percent' ? Math.floor(eligibleSubtotal * coupon.value / 100) : coupon.value
  const discount = Math.min(raw, eligibleSubtotal)
  if (discount <= 0) throw new Error('El código no aplica a los productos de la bolsa.')
  return { coupon, discount }
}

const buildOrderFromItems = async (items, userId) => {
  const allowedSizes = new Set(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'])
  if (!Array.isArray(items) || !items.length || items.length > 20) throw new Error('El pedido no tiene productos válidos.')
  const orderItems = []
  const requestedByProductAndSize = new Map()
  let total = 0
  let eligibleSubtotal = 0
  for (const item of items) {
    const productId = Number(item.productId)
    const quantity = Number(item.quantity)
    const productRow = (await selectProductById.get(productId))
    if (!productRow || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || (!productRow.is_gift_card && !allowedSizes.has(item.size))) throw new Error('Revisa los productos, cantidades y tallas del pedido.')
    const product = productFromRow(productRow)
    if (product.isGiftCard) {
      const amount = Number(item.size)
      if (!Number.isInteger(amount) || amount < giftCardMinimumArs || amount > giftCardMaximumArs) throw new Error(`El monto de la tarjeta debe estar entre $${giftCardMinimumArs.toLocaleString('es-AR')} y $${giftCardMaximumArs.toLocaleString('es-AR')}.`)
      total += amount * quantity
      orderItems.push({ product, quantity, size: String(amount), unitPrice: amount })
      continue
    }
    const stockForSize = Number(product.stockBySize?.[item.size] ?? 0)
    const stockKey = `${productId}:${item.size}`
    const requested = (requestedByProductAndSize.get(stockKey) ?? 0) + quantity
    if (stockForSize < requested) throw new Error(`No hay stock suficiente para ${product.name} en talla ${item.size}.`)
    requestedByProductAndSize.set(stockKey, requested)
    total += product.salePrice * quantity
    eligibleSubtotal += product.salePrice * quantity
    orderItems.push({ product, quantity, size: item.size, unitPrice: product.salePrice })
  }
  const reference = `UF-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`
  return { orderItems, total, eligibleSubtotal, reference, userId }
}

const createOrderRecord = async (request, items, shipping, { notify = true, paymentMethod = 'mercadopago' } = {}) => {
  return database.transaction(async () => {
    if (!Array.isArray(items) || !items.length || items.length > 20) throw new Error('El pedido no tiene productos válidos.')
    const ids = [...new Set(items.map((item) => Number(item.productId)))].sort((a, b) => a - b)
    if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new Error('Revisa los productos, cantidades y tallas del pedido.')
    for (const id of ids) await database.prepare('SELECT id FROM products WHERE id = ? FOR UPDATE').get(id)
    const { orderItems, total: subtotal, eligibleSubtotal, reference, userId } = (await buildOrderFromItems(items, request.user.id))
    const digitalOnly = orderItems.every((item) => item.product.isGiftCard)
    const shippingDetails = digitalOnly
      ? { method: 'digital', name: cleanText(shipping?.name, 80) || request.user.name, phone: cleanText(shipping?.phone, 40), street: '', city: '', province: '', postalCode: '', notes: '', costArs: 0 }
      : parseShippingDetails(shipping, subtotal, await loadProvinceRates())
    if (!digitalOnly && request.body?.expectedShippingCostArs !== undefined && request.body.expectedShippingCostArs !== shippingDetails.costArs) {
      throw new Error('El costo de envío cambió. Actualiza la página y revisa el total antes de continuar.')
    }
    const { coupon, discount } = request.body?.couponCode ? (await evaluateCoupon(request.body.couponCode, eligibleSubtotal, true)) : { coupon: null, discount: 0 }
    const payable = subtotal - discount + shippingDetails.costArs
    let giftCard = null
    let giftApplied = 0
    const giftCardCode = typeof request.body?.giftCardCode === 'string' ? request.body.giftCardCode.trim() : ''
    if (giftCardCode) {
      if (orderItems.some((item) => item.product.isGiftCard)) throw new Error('Una tarjeta de regalo no se puede pagar con otra tarjeta de regalo.')
      giftCard = (await database.prepare('SELECT id, code, balance_ars AS balance FROM gift_cards WHERE code = ? FOR UPDATE').get(giftCardCode))
      if (!giftCard || giftCard.balance <= 0) throw new Error('La tarjeta de regalo no es válida o no tiene saldo.')
      giftApplied = Math.min(giftCard.balance, payable)
    }
    const total = payable - giftApplied
    try {
      const result = (await database.prepare('INSERT INTO orders (reference, user_id, total_ars, status, shipping_cost_ars, shipping_method, shipping_name, shipping_phone, shipping_street, shipping_city, shipping_province, shipping_postal_code, shipping_notes, payment_method, coupon_code, discount_ars, gift_card_code, gift_card_ars) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(reference, userId, total, 'pending_payment', shippingDetails.costArs, shippingDetails.method, shippingDetails.name, shippingDetails.phone, shippingDetails.street, shippingDetails.city, shippingDetails.province, shippingDetails.postalCode, shippingDetails.notes, paymentMethod, coupon?.code ?? '', discount, giftCard?.code ?? '', giftApplied))
      const orderId = Number(result.lastInsertRowid)
      if (coupon) {
        const used = (await database.prepare('UPDATE coupons SET uses = uses + 1 WHERE id = ? AND (max_uses = 0 OR uses < max_uses)').run(coupon.id))
        if (!used.changes) throw new Error('coupon-exhausted')
      }
      if (giftCard && giftApplied > 0) {
        const spent = (await database.prepare('UPDATE gift_cards SET balance_ars = balance_ars - ? WHERE id = ? AND balance_ars >= ?').run(giftApplied, giftCard.id, giftApplied))
        if (!spent.changes) throw new Error('giftcard-exhausted')
      }
      const insertItem = database.prepare('INSERT INTO order_items (order_id, product_id, product_name, product_slug, image_url, size, quantity, unit_price_ars) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      for (const item of orderItems) {
        await insertItem.run(orderId, item.product.id, item.product.name, item.product.slug, item.product.gallery?.[0]?.src ?? '', item.size, item.quantity, item.unitPrice)
        if (item.product.isGiftCard) continue
        const existingStock = JSON.parse((await selectProductById.get(item.product.id)).stock_by_size || '{}')
        const nextSizeStock = Number(existingStock[item.size] ?? 0) - item.quantity
        existingStock[item.size] = nextSizeStock
        const nextTotalStock = Number((await selectProductById.get(item.product.id)).stock || 0) - item.quantity
        if (nextSizeStock < 0 || nextTotalStock < 0) throw new Error('Stock inconsistente.')
        await database.prepare('UPDATE products SET stock = ?, stock_by_size = ? WHERE id = ?').run(nextTotalStock, JSON.stringify(existingStock), item.product.id)
      }
      if (notify) await createNotification(userId, 'order_created', 'Pedido registrado', `Tu pedido ${reference} quedó registrado y está pendiente de pago.`, orderId)
      return { order: { id: orderId, reference, totalArs: total, discountArs: discount, giftCardArs: giftApplied, lineItems: orderItems.map((item) => ({ id: String(item.product.id), title: item.product.name, description: item.product.isGiftCard ? 'Tarjeta de regalo' : `Talla ${item.size}`, quantity: item.quantity, unit_price: item.unitPrice, currency_id: 'ARS' })), shippingCostArs: shippingDetails.costArs, status: 'pending_payment' } }
    } catch (error) {
      if (!['coupon-exhausted', 'giftcard-exhausted'].includes(error.message)) console.error('Could not create order:', error)
      throw new Error(error.message === 'coupon-exhausted' ? 'El cupón alcanzó su límite de usos.' : error.message === 'giftcard-exhausted' ? 'La tarjeta de regalo ya no tiene saldo suficiente.' : 'No se pudo registrar el pedido.')
    }
  })
}

class OrderAdjustmentError extends Error {}

// direction: 1 devuelve stock al inventario, -1 lo vuelve a descontar
const adjustOrderStock = async (orderId, direction) => {
  const used = (await database.prepare('SELECT coupon_code, gift_card_code, gift_card_ars FROM orders WHERE id = ?').get(orderId))
  if (used?.coupon_code) {
    const updated = direction === 1
      ? await database.prepare('UPDATE coupons SET uses = GREATEST(0, uses - 1) WHERE code = ?').run(used.coupon_code)
      : await database.prepare('UPDATE coupons SET uses = uses + 1 WHERE code = ? AND (max_uses = 0 OR uses < max_uses)').run(used.coupon_code)
    if (direction === -1 && !updated.changes) throw new OrderAdjustmentError('El cupón ya no está disponible para reactivar el pedido.')
  }
  if (used?.gift_card_code && used.gift_card_ars) {
    const adjustment = direction * used.gift_card_ars
    const updated = await database.prepare('UPDATE gift_cards SET balance_ars = balance_ars + ? WHERE code = ? AND balance_ars + ? >= 0').run(adjustment, used.gift_card_code, adjustment)
    if (!updated.changes) throw new OrderAdjustmentError('La tarjeta de regalo no tiene saldo suficiente para reactivar el pedido.')
  }
  if (direction === 1) {
    const spent = await database.prepare('SELECT id FROM gift_cards WHERE order_id = ? AND balance_ars < initial_ars LIMIT 1 FOR UPDATE').get(orderId)
    if (spent) throw new OrderAdjustmentError('No se puede cancelar un pedido con tarjetas de regalo ya utilizadas.')
    await database.prepare('UPDATE gift_cards SET balance_ars = 0 WHERE order_id = ?').run(orderId)
  }
  else await database.prepare('UPDATE gift_cards SET balance_ars = initial_ars WHERE order_id = ?').run(orderId)
  const items = (await database.prepare('SELECT product_id, size, quantity FROM order_items WHERE order_id = ? ORDER BY product_id').all(orderId))
  for (const item of items) {
    if (!item.product_id) continue
    const product = await database.prepare('SELECT * FROM products WHERE id = ? FOR UPDATE').get(item.product_id)
    if (!product || product.is_gift_card) continue
    const stockBySize = JSON.parse(product.stock_by_size || '{}')
    const delta = direction * Number(item.quantity)
    const sizeStock = Number(stockBySize[item.size] ?? 0) + delta
    const stock = Number(product.stock ?? 0) + delta
    if (sizeStock < 0 || stock < 0) throw new OrderAdjustmentError('No hay stock suficiente para reactivar el pedido.')
    stockBySize[item.size] = sizeStock
    await database.prepare('UPDATE products SET stock = ?, stock_by_size = ? WHERE id = ?').run(stock, JSON.stringify(stockBySize), item.product_id)
  }
}

const cancelPendingOrderAndRestoreStock = async (orderId, { removeOrder = false, reason = 'payment' } = {}) => {
  const cancelledOrder = await database.transaction(async () => {
    const order = (await database.prepare('SELECT id, user_id, reference, status FROM orders WHERE id = ? FOR UPDATE').get(orderId))
    if (!order || order.status !== 'pending_payment') {
      return false
    }
    const cancelled = (await database.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending_payment'").run(order.id))
    if (!cancelled.changes) {
      return false
    }
    await adjustOrderStock(order.id, 1)
    if (removeOrder) {
      await database.prepare('DELETE FROM notifications WHERE user_id = ? AND kind = ? AND message = ?')
        .run(order.user_id, 'order_created', `Tu pedido ${order.reference} quedó registrado y está pendiente de pago.`)
      await database.prepare('DELETE FROM orders WHERE id = ?').run(order.id)
    } else {
      await createNotification(order.user_id, 'order_cancelled', 'Pago no completado', reason === 'expired'
        ? `El pedido ${order.reference} se canceló por falta de pago en ${pendingOrderExpiryDays} días. El stock fue liberado.`
        : `El pago del pedido ${order.reference} no se completó. El stock fue liberado.`, order.id)
    }
    return true
  })
  if (cancelledOrder && !removeOrder) void sendOrderEmail(orderId, 'cancelled').catch((error) => console.error('Could not send order email:', error))
  return cancelledOrder
}

const pendingOrderExpiryDays = Math.max(1, Number(process.env.PENDING_ORDER_EXPIRY_DAYS) || 3)
const utcDaysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
const cancelExpiredPendingOrders = async () => {
  try {
    const expired = (await database.prepare("SELECT id FROM orders WHERE status = 'pending_payment' AND created_at <= ?").all(utcDaysAgo(pendingOrderExpiryDays)))
    for (const { id } of expired) await cancelPendingOrderAndRestoreStock(id, { reason: 'expired' })
    return expired.length
  } catch (error) {
    console.error('Could not cancel expired orders:', error.message)
    return 0
  }
}
await cancelExpiredPendingOrders()
setInterval(cancelExpiredPendingOrders, 60 * 60 * 1000).unref()

app.post('/api/gift-cards/validate', limitAuthAttempts, async (request, response) => {
  const code = typeof request.body?.code === 'string' ? request.body.code.trim() : ''
  const card = code ? (await database.prepare('SELECT code, balance_ars AS balanceArs FROM gift_cards WHERE code = ?').get(code)) : null
  if (!card || card.balanceArs <= 0) return response.status(400).json({ error: 'La tarjeta de regalo no es válida o no tiene saldo.' })
  response.json(card)
})

app.get('/api/admin/gift-cards', requireAdmin, async (_request, response) => {
  response.json({ giftCards: (await database.prepare('SELECT g.id, g.code, g.initial_ars AS initialArs, g.balance_ars AS balanceArs, g.created_at AS createdAt, o.reference AS orderReference FROM gift_cards g LEFT JOIN orders o ON o.id = g.order_id ORDER BY g.id DESC').all()) })
})

// Pedidos cubiertos por descuentos o tarjetas de regalo: no hay nada que cobrar.
const markOrderPaidWithoutCharge = async (order, userId) => {
  await database.transaction(async () => {
    const current = await database.prepare('SELECT status FROM orders WHERE id = ? FOR UPDATE').get(order.id)
    if (!current || current.status !== 'pending_payment') throw new Error('El pedido ya no está pendiente de pago.')
    await database.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(order.id)
    await issueGiftCards(order.id)
    await createNotification(userId, 'order_paid', 'Compra confirmada', `Tu pedido ${order.reference} fue confirmado.`, order.id)
  })
  order.status = 'paid'
  void sendOrderEmail(order.id, 'paid').catch((error) => console.error('Could not send order email:', error))
}

app.post('/api/coupons/validate', async (request, response) => {
  try {
    const { eligibleSubtotal } = (await buildOrderFromItems(request.body.items, null))
    const { coupon, discount } = (await evaluateCoupon(request.body.code, eligibleSubtotal))
    response.json({ code: coupon.code, discountArs: discount })
  } catch (error) {
    response.status(400).json({ error: error.message })
  }
})

app.get('/api/admin/coupons', requireAdmin, async (_request, response) => {
  response.json({ coupons: (await database.prepare(`${couponSelect} ORDER BY id DESC`).all()) })
})

const parseCouponBody = (body) => {
  const code = cleanText(body.code, 30).toUpperCase()
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new Error('El código debe tener 3 a 30 letras, números, guiones o guion bajo.')
  const type = body.type === 'fixed' ? 'fixed' : 'percent'
  const value = Number(body.value)
  if (!Number.isInteger(value) || value < 1 || (type === 'percent' && value > 100)) throw new Error(type === 'percent' ? 'El porcentaje debe estar entre 1 y 100.' : 'El monto debe ser un entero positivo.')
  const minSubtotal = Number(body.minSubtotal ?? 0)
  const maxUses = Number(body.maxUses ?? 0)
  if (!Number.isInteger(minSubtotal) || minSubtotal < 0 || !Number.isInteger(maxUses) || maxUses < 0) throw new Error('Compra mínima y usos máximos deben ser enteros de 0 o más.')
  const expiresAt = typeof body.expiresAt === 'string' && body.expiresAt ? body.expiresAt : null
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) throw new Error('La fecha de vencimiento no es válida.')
  return { code, type, value, minSubtotal, maxUses, expiresAt, active: body.active === false ? 0 : 1 }
}

app.post('/api/admin/coupons', requireAdmin, async (request, response) => {
  try {
    const c = parseCouponBody(request.body)
    await database.prepare('INSERT INTO coupons (code, type, value, min_subtotal_ars, max_uses, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, ?)').run(c.code, c.type, c.value, c.minSubtotal, c.maxUses, c.expiresAt, c.active)
    response.status(201).json({ coupons: (await database.prepare(`${couponSelect} ORDER BY id DESC`).all()) })
  } catch (error) {
    response.status(error.code === 'ER_DUP_ENTRY' ? 409 : 400).json({ error: error.code === 'ER_DUP_ENTRY' ? 'Ya existe un cupón con ese código.' : error.message })
  }
})

app.put('/api/admin/coupons/:id', requireAdmin, async (request, response) => {
  try {
    const c = parseCouponBody(request.body)
    const result = (await database.prepare('UPDATE coupons SET code = ?, type = ?, value = ?, min_subtotal_ars = ?, max_uses = ?, expires_at = ?, active = ? WHERE id = ?').run(c.code, c.type, c.value, c.minSubtotal, c.maxUses, c.expiresAt, c.active, Number(request.params.id)))
    if (!result.changes) return response.status(404).json({ error: 'Cupón no encontrado.' })
    response.json({ coupons: (await database.prepare(`${couponSelect} ORDER BY id DESC`).all()) })
  } catch (error) {
    response.status(error.code === 'ER_DUP_ENTRY' ? 409 : 400).json({ error: error.code === 'ER_DUP_ENTRY' ? 'Ya existe un cupón con ese código.' : error.message })
  }
})

app.delete('/api/admin/coupons/:id', requireAdmin, async (request, response) => {
  await database.prepare('DELETE FROM coupons WHERE id = ?').run(Number(request.params.id))
  response.json({ coupons: (await database.prepare(`${couponSelect} ORDER BY id DESC`).all()) })
})

app.post('/api/orders', resolveCheckoutUser, async (request, response) => {
  try {
    if (request.body.paymentMethod !== 'transfer') throw new Error('Elige un medio de pago válido.')
    if (request.body.acceptTerms !== true) throw new Error('Debes aceptar los términos y condiciones para continuar.')
    if (!transferDetails()) throw new Error('Las transferencias no están disponibles por el momento.')
    const result = (await createOrderRecord(request, request.body.items, request.body.shipping, { paymentMethod: 'transfer' }))
    result.order.paymentMethod = 'transfer'
    if (result.order.totalArs <= 0) {
      await markOrderPaidWithoutCharge(result.order, request.user.id)
      return response.status(201).json(result)
    }
    result.order.transfer = transferDetails()
    void sendOrderEmail(result.order.id, 'created').catch((error) => console.error('Could not send order email:', error))
    response.status(201).json(result)
  } catch (error) {
    response.status(400).json({ error: error.message || 'No se pudo registrar el pedido.' })
  }
})

app.get('/api/account/notifications', requireAuth, async (request, response) => {
  await database.prepare('DELETE FROM notifications WHERE user_id = ? AND is_read = 1').run(request.user.id)
  const notifications = (await database.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(request.user.id))
  response.json({ notifications: notifications.map((notification) => ({
    id: notification.id,
    kind: notification.kind,
    title: notification.title,
    message: notification.message,
    orderId: notification.order_id == null ? null : Number(notification.order_id),
    isRead: Boolean(notification.is_read),
    createdAt: notification.created_at,
  })) })
})

app.patch('/api/account/notifications/:id/read', requireAuth, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Notificación inválida.' })
  const result = (await database.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(id, request.user.id))
  if (!result.changes) return response.status(404).json({ error: 'Notificación no encontrada.' })
  response.json({ ok: true })
})

app.post('/api/newsletter', async (request, response) => {
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Escribe un correo válido.' })
  try {
    await database.prepare('INSERT INTO newsletter_subscribers (email) VALUES (?) ON DUPLICATE KEY UPDATE email = email').run(email)
    response.json({ ok: true, message: 'Gracias. Ya estás en la lista de UnFocus.' })
  } catch {
    response.status(500).json({ error: 'No se pudo completar la suscripción.' })
  }
})

app.post('/api/newsletter/unsubscribe', async (request, response) => {
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : ''
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: 'Escribe un correo válido.' })
  await database.prepare('DELETE FROM newsletter_subscribers WHERE email = ?').run(email)
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

  const result = (await database.prepare('INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)').run(name, email, subject, message))
  const messageId = Number(result.lastInsertRowid)
  const toEmail = process.env.CONTACT_TO_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim()
  const emailSent = await sendMail({
    to: toEmail,
    subject: `Contacto web: ${subject}`,
    text: `Nombre: ${name}\nCorreo: ${email}\nAsunto: ${subject}\n\n${message}`,
    replyTo: email,
    fromName: 'UnFocus · Contacto',
  })
  if (emailSent) await database.prepare('UPDATE contact_messages SET email_sent = 1 WHERE id = ?').run(messageId)

  response.status(201).json({
    ok: true,
    emailSent,
    message: emailSent
      ? 'Tu mensaje fue enviado. Gracias por comunicarte con UnFocus.'
      : 'Recibimos tu mensaje y quedó disponible para el equipo. El envío de email está pendiente de configuración.',
  })
})

app.get('/api/admin/newsletter', requireAdmin, async (_request, response) => {
  const subscribers = (await database.prepare('SELECT id, email, created_at AS createdAt FROM newsletter_subscribers ORDER BY created_at DESC').all())
  response.json({ subscribers })
})

app.delete('/api/admin/newsletter/:id', requireAdmin, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Suscriptor inválido.' })
  const result = (await database.prepare('DELETE FROM newsletter_subscribers WHERE id = ?').run(id))
  if (!result.changes) return response.status(404).json({ error: 'Suscriptor no encontrado.' })
  response.json({ ok: true })
})

app.get('/api/admin/contact-messages', requireAdmin, async (_request, response) => {
  const messages = (await database.prepare('SELECT id, name, email, subject, message, is_read AS isRead, email_sent AS emailSent, created_at AS createdAt FROM contact_messages ORDER BY created_at DESC LIMIT 100').all())
  response.json({ messages: messages.map((message) => ({ ...message, isRead: Boolean(message.isRead), emailSent: Boolean(message.emailSent) })) })
})

app.patch('/api/admin/contact-messages/:id/read', requireAdmin, async (request, response) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Mensaje inválido.' })
  const result = (await database.prepare('UPDATE contact_messages SET is_read = 1 WHERE id = ?').run(id))
  if (!result.changes) return response.status(404).json({ error: 'Mensaje no encontrado.' })
  response.json({ ok: true })
})

app.get('/api/admin/summary', requireAdmin, async (_request, response) => {
  const summary = (await database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM products) AS products,
      (SELECT COUNT(*) FROM orders) AS orders,
      (SELECT COUNT(*) FROM orders WHERE status = 'pending_payment') AS pending,
      (SELECT COUNT(*) FROM orders WHERE status = 'paid') AS paid,
      (SELECT COALESCE(SUM(total_ars), 0) FROM orders WHERE status = 'paid') AS totalRevenue
  `).get())
  response.json({
    products: Number(summary.products),
    orders: Number(summary.orders),
    pending: Number(summary.pending),
    paid: Number(summary.paid),
    totalRevenue: Number(summary.totalRevenue),
  })
})

const lowStockThreshold = 3

app.get('/api/admin/reports', requireAdmin, async (request, response) => {
  const days = [7, 30, 90].includes(Number(request.query.days)) ? Number(request.query.days) : 30
  const since = utcDaysAgo(days)
  const totals = (await database.prepare(`
    SELECT COUNT(*) AS orders, COALESCE(SUM(total_ars), 0) AS revenue
    FROM orders WHERE status IN ('paid', 'shipped', 'delivered') AND created_at >= ?
  `).get(since))
  const daily = (await database.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS orders, SUM(total_ars) AS revenue
    FROM orders WHERE status IN ('paid', 'shipped', 'delivered') AND created_at >= ?
    GROUP BY day ORDER BY day DESC
  `).all(since))
  const topProducts = (await database.prepare(`
    SELECT oi.product_name AS name, SUM(oi.quantity) AS units, SUM(oi.quantity * oi.unit_price_ars) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status IN ('paid', 'shipped', 'delivered') AND o.created_at >= ?
    GROUP BY oi.product_name ORDER BY units DESC, revenue DESC LIMIT 10
  `).all(since))
  const lowStock = (await allProducts.all()).map(productFromRow)
    .filter((product) => !product.isGiftCard)
    .flatMap((product) => Object.entries(product.stockBySize)
      .filter(([, stock]) => Number(stock) <= lowStockThreshold)
      .map(([size, stock]) => ({ productId: product.id, name: product.name, size, stock: Number(stock) })))
    .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name))
  response.json({
    days,
    orders: Number(totals.orders),
    revenue: Number(totals.revenue),
    averageOrder: totals.orders ? Math.round(Number(totals.revenue) / Number(totals.orders)) : 0,
    daily: daily.map((row) => ({ day: row.day, orders: Number(row.orders), revenue: Number(row.revenue) })),
    topProducts: topProducts.map((row) => ({ name: row.name, units: Number(row.units), revenue: Number(row.revenue) })),
    lowStock,
    lowStockThreshold,
  })
})

app.get('/api/admin/orders', requireAdmin, async (_request, response) => {
  const orderRows = (await database.prepare(`
    SELECT o.*, u.name AS user_name, u.email AS user_email
    FROM orders o
    JOIN users u ON u.id = o.user_id
    ORDER BY o.created_at DESC
    LIMIT 50
  `).all())
  const orders = await Promise.all(orderRows.map((order) => serializeOrder(order, { userName: order.user_name, userEmail: order.user_email })))
  response.json({ orders })
})

const orderStatuses = ['pending_payment', 'paid', 'shipped', 'delivered', 'cancelled']

app.get('/api/admin/settings', requireAdmin, (_request, response) => response.json({ settings: storeSettings }))

app.get('/api/admin/province-shipping-rates', requireAdmin, async (_request, response) => {
  response.json({ rates: await loadProvinceRates() })
})

app.put('/api/admin/province-shipping-rates', requireAdmin, async (request, response) => {
  let rates
  try {
    rates = parseProvinceRates(request.body?.rates)
  } catch (error) {
    return response.status(400).json({ error: error.message })
  }
  await database.prepare('INSERT INTO store_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)').run(provinceRatesKey, JSON.stringify(rates))
  response.json({ rates })
})

app.put('/api/admin/settings', requireAdmin, async (request, response) => {
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
  const upsert = database.prepare('INSERT INTO store_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
  for (const key of settingKeys) await upsert.run(key, String(next[key]))
  Object.assign(storeSettings, next)
  response.json({ settings: storeSettings })
})

app.patch('/api/admin/orders/:id/status', requireAdmin, async (request, response) => {
  const id = Number(request.params.id)
  const status = typeof request.body.status === 'string' ? request.body.status : ''
  if (!Number.isSafeInteger(id)) return response.status(400).json({ error: 'Pedido inválido.' })
  if (!orderStatuses.includes(status)) return response.status(400).json({ error: 'Estado de pedido inválido.' })
  let result
  try {
    result = await database.transaction(async () => {
      const order = await database.prepare('SELECT id, user_id, reference, status, tracking_code, carrier, tracking_url FROM orders WHERE id = ? FOR UPDATE').get(id)
      if (!order) return { error: 'Pedido no encontrado.', statusCode: 404 }
      const fulfilled = ['paid', 'shipped', 'delivered']
      if ((status === 'shipped' || status === 'delivered') && !fulfilled.includes(order.status)) return { error: 'Solo se pueden despachar pedidos pagados.', statusCode: 400 }
      const carrier = cleanText(request.body.carrier, 60) || order.carrier || ''
      const trackingCode = cleanText(request.body.trackingCode, 80) || order.tracking_code || ''
      const trackingUrl = cleanText(request.body.trackingUrl, 300) || order.tracking_url || ''
      if (trackingUrl && !/^https?:\/\//i.test(trackingUrl)) return { error: 'El enlace de seguimiento debe comenzar con http:// o https://.', statusCode: 400 }
      const changed = order.status !== status
      if (changed && status === 'cancelled') await adjustOrderStock(id, 1)
      if (changed && order.status === 'cancelled') await adjustOrderStock(id, -1)
      if (status === 'shipped') {
        await database.prepare("UPDATE orders SET status = ?, carrier = ?, tracking_code = ?, tracking_url = ?, shipped_at = COALESCE(shipped_at, CURRENT_TIMESTAMP) WHERE id = ?").run(status, carrier, trackingCode, trackingUrl, id)
      } else {
        await database.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id)
      }
      if (changed && status === 'paid') await issueGiftCards(id)
      if (changed && status === 'paid') await createNotification(order.user_id, 'order_paid', 'Compra confirmada', `Tu pedido ${order.reference} fue confirmado.`, order.id)
      if (changed && status === 'shipped') await createNotification(order.user_id, 'order_shipped', 'Pedido en camino', `Tu pedido ${order.reference} fue despachado.${trackingCode ? ` Seguimiento: ${trackingCode}.` : ''}`, order.id)
      if (changed && status === 'delivered') await createNotification(order.user_id, 'order_delivered', 'Pedido entregado', `Tu pedido ${order.reference} figura como entregado.`, order.id)
      if (changed && status === 'cancelled') await createNotification(order.user_id, 'order_cancelled', 'Pedido cancelado', `Tu pedido ${order.reference} fue cancelado.`, order.id)
      return { carrier, trackingCode, trackingUrl, changed }
    })
  } catch (error) {
    if (error instanceof OrderAdjustmentError) return response.status(409).json({ error: error.message })
    throw error
  }
  if (result.error) return response.status(result.statusCode).json({ error: result.error })
  if (result.changed && ['paid', 'shipped', 'cancelled'].includes(status)) void sendOrderEmail(id, status).catch((error) => console.error('Could not send order email:', error))
  response.json({ ok: true, status, carrier: result.carrier, trackingCode: result.trackingCode, trackingUrl: result.trackingUrl })
})

const loadShippingSettings = async () => {
  const rows = await database.prepare('SELECT `key`, value FROM store_settings WHERE `key` LIKE ?').all(`${shippingSettingsPrefix}%`)
  return shippingSettingsFromRows(rows)
}

let shippingIntegrationsCache
const loadShippingIntegrations = async () => {
  const settings = await loadShippingSettings()
  const cacheKey = JSON.stringify(settings)
  if (shippingIntegrationsCache?.key !== cacheKey) {
    const env = shippingSettingsEnvironment(settings)
    const correoArgentinoConfig = readCorreoArgentinoConfig(env)
    shippingIntegrationsCache = {
      key: cacheKey,
      correoArgentinoConfig,
      correoArgentino: createCorreoArgentinoClient(correoArgentinoConfig),
    }
  }
  return shippingIntegrationsCache
}

app.get('/api/admin/shipping-settings', requireAdmin, async (_request, response) => {
  response.json({ settings: await loadShippingSettings() })
})

app.put('/api/admin/shipping-settings', requireAdmin, async (request, response) => {
  let settings
  try {
    settings = parseShippingSettings(request.body)
  } catch (error) {
    return response.status(400).json({ error: error.message })
  }
  await database.transaction(async () => {
    const upsert = database.prepare('INSERT INTO store_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)')
    for (const key of Object.keys(shippingSettingsFields)) await upsert.run(`${shippingSettingsPrefix}${key}`, settings[key])
  })
  response.json({ settings })
})

const correoArgentinoTrackingUrl = (trackingNumber) => `https://www.correoargentino.com.ar/formularios/e-commerce?id=${encodeURIComponent(trackingNumber)}`

const correoArgentinoRoute = (handler) => async (request, response) => {
  try {
    await handler(request, response)
  } catch (error) {
    if (!(error instanceof CorreoArgentinoError)) throw error
    response.status(error.status).json({ error: error.message })
  }
}

const loadCorreoArgentinoOrder = async (request) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id)) throw new CorreoArgentinoError('Pedido inválido.', 400)
  const order = (await database.prepare('SELECT o.*, u.email AS user_email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?').get(id))
  if (!order) throw new CorreoArgentinoError('Pedido no encontrado.', 404)
  return order
}

app.get('/api/admin/correo-argentino/status', requireAdmin, correoArgentinoRoute(async (request, response) => {
  const { correoArgentinoConfig, correoArgentino } = await loadShippingIntegrations()
  const configured = correoArgentinoConfig.missing.length === 0
  let credentialsValid = null
  if (configured && request.query.check === '1') {
    try { credentialsValid = await correoArgentino.validateCredentials() } catch { credentialsValid = false }
  }
  response.json({ configured, missing: correoArgentinoConfig.missing, environment: correoArgentinoConfig.environment, credentialsValid })
}))

app.get('/api/admin/correo-argentino/agencies', requireAdmin, correoArgentinoRoute(async (request, response) => {
  const { correoArgentino } = await loadShippingIntegrations()
  const flag = (value) => value === 'true' || value === 'false' ? value : undefined
  const stateId = typeof request.query.stateId === 'string' ? request.query.stateId.slice(0, 6) : undefined
  response.json({ agencies: await correoArgentino.getAgencies({ stateId, pickupAvailability: flag(request.query.pickupAvailability), packageReception: flag(request.query.packageReception) }) })
}))

app.post('/api/admin/orders/:id/correo-argentino', requireAdmin, correoArgentinoRoute(async (request, response) => {
  const order = (await loadCorreoArgentinoOrder(request))
  if (order.status !== 'paid') throw new CorreoArgentinoError('Solo se puede generar el envío de pedidos pagados.', 400)
  if (order.shipping_method !== 'delivery') throw new CorreoArgentinoError('El pedido no es un envío a domicilio.', 400)
  if (order.ca_tracking_number) throw new CorreoArgentinoError('El pedido ya tiene un envío generado en Correo Argentino.', 400)
  if (order.mc_imported_at) throw new CorreoArgentinoError('El pedido ya fue importado a MiCorreo. Verifica su envío antes de generar otro.', 400)
  const { correoArgentinoConfig, correoArgentino } = await loadShippingIntegrations()
  const { trackingNumber } = await correoArgentino.createOrder(buildOrderPayload(correoArgentinoConfig, order))
  const trackingUrl = correoArgentinoTrackingUrl(trackingNumber)
  await database.prepare('UPDATE orders SET ca_tracking_number = ?, carrier = ?, tracking_code = ?, tracking_url = ? WHERE id = ?').run(trackingNumber, 'Correo Argentino', trackingNumber, trackingUrl, order.id)
  response.json({ ok: true, carrier: 'Correo Argentino', trackingCode: trackingNumber, trackingUrl })
}))

app.get('/api/admin/orders/:id/correo-argentino/label', requireAdmin, correoArgentinoRoute(async (request, response) => {
  const order = (await loadCorreoArgentinoOrder(request))
  if (!order.ca_tracking_number) throw new CorreoArgentinoError('El pedido no tiene un envío generado en Correo Argentino.', 400)
  const { correoArgentino } = await loadShippingIntegrations()
  const { pdf, fileName } = await correoArgentino.getLabel(order.ca_tracking_number, '', request.query.format === 'label' ? 'label' : '10x15')
  response.setHeader('Content-Type', 'application/pdf')
  response.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/[^\w.-]/g, '_')}"`)
  response.send(pdf)
}))

app.get('/api/admin/orders/:id/correo-argentino/tracking', requireAdmin, correoArgentinoRoute(async (request, response) => {
  const order = (await loadCorreoArgentinoOrder(request))
  if (!order.ca_tracking_number) throw new CorreoArgentinoError('El pedido no tiene un envío generado en Correo Argentino.', 400)
  const { correoArgentino } = await loadShippingIntegrations()
  response.json(await correoArgentino.getTracking(order.ca_tracking_number))
}))

app.post('/api/admin/orders/:id/correo-argentino/cancel', requireAdmin, correoArgentinoRoute(async (request, response) => {
  const order = (await loadCorreoArgentinoOrder(request))
  if (!order.ca_tracking_number) throw new CorreoArgentinoError('El pedido no tiene un envío generado en Correo Argentino.', 400)
  if (order.status === 'shipped' || order.status === 'delivered') throw new CorreoArgentinoError('El pedido ya fue despachado y no se puede cancelar el envío.', 400)
  const { correoArgentino } = await loadShippingIntegrations()
  await correoArgentino.cancelOrder(order.ca_tracking_number)
  await database.prepare("UPDATE orders SET ca_tracking_number = NULL, carrier = '', tracking_code = '', tracking_url = '' WHERE id = ?").run(order.id)
  response.json({ ok: true })
}))

app.get('/api/products/:slug/reviews', async (request, response) => {
  const product = (await selectProductBySlug.get(request.params.slug))
  if (!product) return response.status(404).json({ error: 'Producto no encontrado.' })
  const reviews = (await database.prepare(`
    SELECT pr.id, u.name AS userName, pr.rating, pr.comment, pr.created_at AS createdAt
    FROM product_reviews pr
    JOIN users u ON u.id = pr.user_id
    WHERE pr.product_id = ?
    ORDER BY pr.created_at DESC
    LIMIT 20
  `).all(product.id))
  response.json({ reviews })
})

app.post('/api/products/:slug/reviews', requireAuth, async (request, response) => {
  const product = (await selectProductBySlug.get(request.params.slug))
  if (!product) return response.status(404).json({ error: 'Producto no encontrado.' })
  const rating = Number(request.body.rating)
  const comment = typeof request.body.comment === 'string' ? request.body.comment.trim() : ''
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return response.status(400).json({ error: 'La valoración debe estar entre 1 y 5.' })
  if (comment.length < 10 || comment.length > 500) return response.status(400).json({ error: 'El comentario debe tener entre 10 y 500 caracteres.' })
  try {
    await database.prepare('INSERT INTO product_reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)')
      .run(product.id, request.user.id, rating, comment)
    response.status(201).json({ ok: true })
  } catch {
    response.status(409).json({ error: 'Ya dejaste una reseña para este producto.' })
  }
})

app.post('/api/payments/create-preference', resolveCheckoutUser, async (request, response) => {
  if (!mercadoPagoClient) return response.status(503).json({ error: 'Mercado Pago no está configurado. Define MP_ACCESS_TOKEN en tu entorno.' })
  if (!isProduction && !mercadoPagoIsTestMode) return response.status(503).json({ error: 'Configura MP_ENVIRONMENT=test para usar credenciales de prueba en desarrollo.' })
  let order
  try {
    if (request.body.acceptTerms !== true) throw new Error('Debes aceptar los términos y condiciones para continuar.')
    order = (await createOrderRecord(request, request.body.items, request.body.shipping, { notify: false }))
    if (order.order.totalArs <= 0) {
      await markOrderPaidWithoutCharge(order.order, request.user.id)
      return response.json({ order: order.order, paymentUrl: null, initPoint: null })
    }
    const baseUrl = process.env.MP_RETURN_URL?.trim() || publicBaseUrl
    const webhookUrl = isProduction
      ? new URL('/api/payments/webhook', publicBaseUrl).toString()
      : process.env.MP_WEBHOOK_URL || null
    const preference = new Preference(mercadoPagoClient)
    const items = order.order.lineItems.map((line) => ({ ...line }))
    if (order.order.discountArs > 0 || order.order.giftCardArs > 0) {
      // Mercado Pago no admite precios negativos: se envía un único ítem con el total ya descontado.
      items.splice(0, items.length, { id: order.order.reference, title: `Pedido ${order.order.reference} (con descuentos)`, quantity: 1, unit_price: order.order.totalArs, currency_id: 'ARS' })
    } else if (order.order.shippingCostArs > 0) {
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
    await database.prepare('UPDATE orders SET payment_url = ? WHERE id = ?').run(paymentUrl, order.order.id)
    await createNotification(request.user.id, 'order_created', 'Pedido registrado', `Tu pedido ${order.order.reference} quedó registrado y está pendiente de pago.`, order.order.id)
    void sendOrderEmail(order.order.id, 'created').catch((error) => console.error('Could not send order email:', error))
    response.json({
      order: order.order,
      paymentUrl,
      initPoint: paymentUrl,
    })
  } catch (error) {
    if (order?.order.id) {
      try {
        await cancelPendingOrderAndRestoreStock(order.order.id, { removeOrder: true })
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

const applyMercadoPagoPayment = async (payment, resource) => {
  const reference = payment.external_reference
  if (!reference) return null
  const paymentId = String(payment.id ?? resource)
  const paymentStatus = String(payment.status ?? '').toLowerCase()
  if (!paymentStatus) throw new Error('Mercado Pago no devolvió el estado del pago.')
  const result = await database.transaction(async () => {
    const order = await database.prepare('SELECT id, user_id, total_ars, status FROM orders WHERE reference = ? FOR UPDATE').get(reference)
    if (!order) return null
    const transactionAmount = Number(payment.transaction_amount)
    if (payment.currency_id !== 'ARS' || !Number.isFinite(transactionAmount) || Math.round(transactionAmount * 100) !== Number(order.total_ars) * 100) {
      throw new Error('El importe o la moneda del pago no coincide con el pedido.')
    }
    await database.prepare(paymentAttemptUpsertSql()).run(paymentId, order.id, paymentStatus, payment.status_detail ?? null)
    const attempt = await database.prepare('SELECT order_id FROM payment_attempts WHERE payment_id = ? FOR UPDATE').get(paymentId)
    if (String(attempt.order_id) !== String(order.id)) throw new Error('El pago ya pertenece a otro pedido.')
    let becamePaid = false
    if (paymentStatus === 'approved') {
      if (['pending_payment', 'cancelled'].includes(order.status)) {
        if (order.status === 'cancelled') await adjustOrderStock(order.id, -1)
        await database.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(order.id)
        await issueGiftCards(order.id)
        await createNotification(order.user_id, 'order_paid', 'Compra confirmada', `Tu pedido ${reference} fue confirmado.`, order.id)
        becamePaid = true
      }
    }
    return { orderId: order.id, becamePaid }
  })
  if (!result) return null
  if (result.becamePaid) void sendOrderEmail(result.orderId, 'paid').catch((error) => console.error('Could not send order email:', error))
  if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
    const attempts = (await database.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status IN ('rejected', 'cancelled') THEN 1 ELSE 0 END) AS negative
      FROM payment_attempts WHERE order_id = ?
    `).get(result.orderId))
    if (attempts.total > 3 && Number(attempts.total) === Number(attempts.negative)) await cancelPendingOrderAndRestoreStock(result.orderId)
  }
  const currentOrder = (await database.prepare('SELECT id, status FROM orders WHERE id = ?').get(result.orderId))
  return { orderId: currentOrder.id, orderStatus: currentOrder.status, paymentStatus }
}

app.get('/api/payments/verify-return', async (request, response) => {
  const paymentId = typeof request.query.payment_id === 'string' ? request.query.payment_id : ''
  if (!/^\d{1,30}$/.test(paymentId)) return response.status(400).json({ error: 'Identificador de pago inválido.' })
  if (!mercadoPagoAccessToken) return response.status(503).json({ error: 'La verificación de pagos no está configurada.' })
  try {
    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${mercadoPagoAccessToken}` },
    })
    if (!paymentResponse.ok) {
      console.error(`Mercado Pago rejected return verification (${paymentResponse.status}).`)
      return response.status(502).json({ error: 'No se pudo verificar el pago con Mercado Pago.' })
    }
    const payment = await paymentResponse.json()
    const result = (await applyMercadoPagoPayment(payment, paymentId))
    if (!result) return response.status(404).json({ error: 'No se encontró el pedido asociado al pago.' })
    response.json(result)
  } catch (error) {
    console.error('Could not verify Mercado Pago return:', error)
    response.status(500).json({ error: 'No se pudo actualizar el estado del pago.' })
  }
})
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
    await applyMercadoPagoPayment(payment, resource)
    response.json({ ok: true })
  } catch (error) {
    console.error('Could not process Mercado Pago webhook:', error)
    response.status(500).json({ ok: false })
  }
})

app.use((error, _request, response, _next) => {
  if (response.headersSent) return
  console.error('Unhandled API error:', error)
  const status = error.status === 413 ? 413 : 500
  response.status(status).json({ error: status === 413 ? 'La solicitud supera el tamaño permitido.' : 'Error interno del servidor.' })
})

if (isProduction) {
  const indexHtmlPath = path.join(projectDirectory, 'dist', 'index.html')
  const seoBaseUrl = publicBaseUrl.replace(/\/$/, '')
  const legalPageSlugs = ['terminos', 'privacidad', 'cambios', 'arrepentimiento', 'defensa', 'baja', 'faq']
  const legalPageTitles = {
    terminos: 'Términos y condiciones',
    privacidad: 'Política de privacidad',
    cambios: 'Cambios y devoluciones',
    arrepentimiento: 'Botón de arrepentimiento',
    defensa: 'Defensa del consumidor',
    baja: 'Botón de baja',
    faq: 'Preguntas y respuestas',
  }
  app.get('/robots.txt', (_request, response) => response.type('text/plain').send(buildRobotsTxt(seoBaseUrl)))
  app.get('/sitemap.xml', async (_request, response) => response.type('application/xml').send(buildSitemapXml(seoBaseUrl, (await allProducts.all()).map(productFromRow), legalPageSlugs)))
  app.get('/llms.txt', async (_request, response) => response.type('text/plain').send(buildLlmsTxt(seoBaseUrl, (await allProducts.all()).map(productFromRow))))
  app.get('/.well-known/mcp/server-card.json', (_request, response) => response.json(buildMcpServerCard(seoBaseUrl)))
  app.use(express.static(path.join(projectDirectory, 'dist'), {
    index: false,
    setHeaders: (response, filePath) => {
      if (path.basename(filePath) === 'index.html') {
        response.setHeader('Cache-Control', 'no-cache')
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  }))
  app.get(/^(?!\/api\/).*/, async (request, response) => {
    const products = (await allProducts.all()).map(productFromRow)
    const slug = typeof request.query.producto === 'string' ? request.query.producto : ''
    const row = slug ? (await selectProductBySlug.get(slug)) : null
    const product = row ? productFromRow(row) : null
    const legalPage = typeof request.query.legal === 'string' ? request.query.legal : request.query.contacto === '1' ? 'contact' : null
    const aboutPage = request.query.sobre === '1'
    const diaryPage = request.query.diario === '1'
    const shopPage = request.query.tienda === '1'
    const isInvalidPage = request.path !== '/'
      || (request.query.producto !== undefined && (!slug || !product))
      || (request.query.legal !== undefined && (!legalPage || !legalPageSlugs.includes(legalPage)))
      || (request.query.contacto !== undefined && request.query.contacto !== '1')
      || (request.query.sobre !== undefined && (!aboutPage || slug || request.query.legal !== undefined || request.query.contacto !== undefined || request.query.diario !== undefined || request.query.tienda !== undefined))
      || (request.query.diario !== undefined && (!diaryPage || slug || request.query.legal !== undefined || request.query.contacto !== undefined || request.query.sobre !== undefined || request.query.tienda !== undefined))
      || (request.query.tienda !== undefined && (!shopPage || slug || request.query.legal !== undefined || request.query.contacto !== undefined || request.query.sobre !== undefined || request.query.diario !== undefined))
    const requestsMarkdown = (request.get('accept') || '').split(',').some((entry) => {
      const [mediaType, ...parameters] = entry.trim().split(';')
      return mediaType.toLowerCase() === 'text/markdown' && !parameters.some((parameter) => /^q=0(?:\.0*)?$/i.test(parameter.trim()))
    })
    const html = await readFile(indexHtmlPath, 'utf8')
    response.setHeader('Cache-Control', 'no-cache')
    const publicContact = publicStoreConfig().store
    const linkHeader = `<${seoBaseUrl}/llms.txt>; rel="alternate"; type="text/plain"; title="llms.txt", <${seoBaseUrl}/>; rel="alternate"; type="text/markdown"; title="Markdown"`
    response.setHeader('Link', linkHeader)
    if (requestsMarkdown) {
      response.status(isInvalidPage ? 404 : 200).type('text/markdown')
      if (isInvalidPage) return response.send('# Página no encontrada\n')
      return response.send(buildMarkdownPage(seoBaseUrl, { product, products, contact: publicContact, legalPage, aboutPage, diaryPage, shopPage }))
    }
    if (isInvalidPage) {
      const notFound = injectAgentContent(html, '<main id="agent-content"><h1>Página no encontrada</h1><p>No encontramos la página que buscas.</p><p><a href="/">Volver al inicio</a></p></main>')
      response.status(404).setHeader('X-Robots-Tag', 'noindex')
      const notFoundHtml = injectSiteMeta(notFound, seoBaseUrl, {
        title: 'Página no encontrada | UnFocus',
        description: 'La página solicitada no existe.',
        canonical: '',
      }).replace(/<script type="module"[^>]*><\/script>\s*/g, '')
      return response.type('html').send(notFoundHtml)
    }
    const agentContent = renderAgentContent({ products, product, legalPage, contact: publicContact, aboutPage, diaryPage, shopPage })
    let pageHtml = injectAgentContent(html, agentContent)
    if (product) {
      pageHtml = injectProductMeta(pageHtml, seoBaseUrl, product)
    } else if (aboutPage) {
      const canonical = `${seoBaseUrl}/?sobre=1`
      pageHtml = injectSiteMeta(pageHtml, seoBaseUrl, {
        title: 'Nuestra mirada | UnFocus Mall',
        description: 'Conoce la propuesta de UnFocus Mall: ropa cómoda pensada desde la experiencia neurodivergente e información sensorial clara.',
        canonical,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'AboutPage',
          name: 'Nuestra mirada',
          url: canonical,
          about: { '@id': `${seoBaseUrl}/#organization` },
          inLanguage: 'es-AR',
        },
      })
    } else if (diaryPage) {
      const canonical = `${seoBaseUrl}/?diario=1`
      pageHtml = injectSiteMeta(pageHtml, seoBaseUrl, {
        title: 'Diario | UnFocus Mall',
        description: 'Vlogs, historias y novedades de UnFocus Mall. Suscríbete para recibir las nuevas publicaciones.',
        canonical,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Blog',
          name: 'Diario UnFocus',
          description: 'Vlogs, historias y novedades de UnFocus Mall.',
          url: canonical,
          publisher: { '@id': `${seoBaseUrl}/#organization` },
          inLanguage: 'es-AR',
        },
      })
    } else if (shopPage) {
      const canonical = `${seoBaseUrl}/?tienda=1`
      pageHtml = injectSiteMeta(pageHtml, seoBaseUrl, {
        title: 'Tienda | UnFocus Mall',
        description: 'Explora las prendas y tarjetas de regalo disponibles en UnFocus Mall.',
        canonical,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Tienda UnFocus',
          description: 'Prendas y tarjetas de regalo disponibles en UnFocus Mall.',
          url: canonical,
          mainEntity: {
            '@type': 'ItemList',
            itemListElement: products.slice(0, 100).map((item, index) => ({
              '@type': 'ListItem',
              position: index + 1,
              url: `${seoBaseUrl}/?producto=${encodeURIComponent(item.slug)}`,
              name: item.name,
            })),
          },
          inLanguage: 'es-AR',
        },
      })
    } else if (legalPage === 'contact' || legalPage) {
      const title = legalPage === 'contact' ? 'Contacto | UnFocus' : `${legalPageTitles[legalPage]} | UnFocus`
      const canonical = legalPage === 'contact' ? `${seoBaseUrl}/?contacto=1` : `${seoBaseUrl}/?legal=${encodeURIComponent(legalPage)}`
      pageHtml = injectSiteMeta(pageHtml, seoBaseUrl, {
        title,
        description: legalPage === 'contact' ? 'Contacta con UnFocus Mall para consultas sobre productos y pedidos.' : `${legalPageTitles[legalPage]} de UnFocus Mall.`,
        canonical,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: title,
          url: canonical,
          inLanguage: 'es-AR',
        },
      })
    } else {
      const jsonLd = buildHomepageJsonLd(seoBaseUrl, { products, store: publicContact, sameAs: publicSameAs })
      const hero = products.find((item) => !item.isGiftCard && item.gallery[1]?.src)
      pageHtml = injectSiteMeta(pageHtml, seoBaseUrl, { jsonLd })
      if (hero) pageHtml = injectImagePreload(pageHtml, seoBaseUrl, hero.gallery[1].src)
    }
    response.type('html').send(pageHtml)
  })
}

await new Promise((resolve) => app.listen(port, '0.0.0.0', resolve))
console.log(`UnFocus API listening on http://localhost:${port}`)
console.log('MySQL database connected.')
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) console.log('No admin bootstrap configured. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env to create/promote an administrator.')
const initialShipping = await loadShippingIntegrations()
if (initialShipping.correoArgentinoConfig.missing.length) console.log(`Correo Argentino desactivado. Faltan datos: ${initialShipping.correoArgentinoConfig.missing.join(', ')}`)
else console.log(`Correo Argentino activo (${initialShipping.correoArgentinoConfig.environment}).`)

const shutdown = async () => {
  await database.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
