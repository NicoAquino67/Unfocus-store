// Cliente de la API MiCorreo de Correo Argentino. Documentación: ident/Correo Argentino - API MiCorreo.pdf
// Cotiza envíos (/rates) e importa pedidos a la plataforma MiCorreo (/shipping/import).
import https from 'node:https'
import { provinceCodes, splitStreet } from './correoArgentino.mjs'

const hosts = {
  test: 'https://apitest.correoargentino.com.ar/micorreo/v1',
  production: 'https://api.correoargentino.com.ar/micorreo/v1',
}

export class MiCorreoError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.name = 'MiCorreoError'
    this.status = status
  }
}

export const readMiCorreoConfig = (env = process.env) => {
  const text = (name, fallback = '') => env[name]?.trim() || fallback
  const number = (name, fallback) => {
    const value = Number(env[name])
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
  }
  const environment = text('MICORREO_ENVIRONMENT', 'test').toLowerCase() === 'production' ? 'production' : 'test'
  const required = ['MICORREO_USER', 'MICORREO_PASSWORD', 'MICORREO_CUSTOMER_ID', 'MICORREO_ORIGIN_POSTAL_CODE']
  return {
    environment,
    baseUrl: text('MICORREO_BASE_URL') || hosts[environment],
    user: text('MICORREO_USER'),
    password: text('MICORREO_PASSWORD'),
    customerId: text('MICORREO_CUSTOMER_ID'),
    originPostalCode: numericPostalCode(text('MICORREO_ORIGIN_POSTAL_CODE')),
    parcel: {
      weightGrams: number('CORREO_PARCEL_WEIGHT_GRAMS', 400),
      height: number('CORREO_PARCEL_HEIGHT_CM', 5),
      width: number('CORREO_PARCEL_WIDTH_CM', 25),
      length: number('CORREO_PARCEL_DEPTH_CM', 35),
    },
    missing: required.filter((name) => !text(name)),
  }
}

// MiCorreo usa el CP numérico de 4 dígitos; se acepta también el formato CPA (C1000AAA).
export function numericPostalCode(value) {
  const match = String(value ?? '').match(/\d{4}/)
  return match ? match[0] : ''
}

// Las prendas se apilan: peso y alto se multiplican por la cantidad.
// Límites de la API: 50 kg, cada lado <= 200 cm, alto + ancho + largo <= 300 cm.
export const buildDimensions = (config, quantity) => {
  const units = Math.max(1, Math.floor(quantity))
  const { weightGrams, height, width, length } = config.parcel
  const dimensions = { weight: weightGrams * units, height: height * units, width, length }
  const fits = dimensions.weight <= 50_000 && Math.max(dimensions.height, width, length) <= 200 && dimensions.height + width + length <= 300
  if (!fits) throw new MiCorreoError('El pedido supera el tamaño máximo para cotizar el envío. Divídelo en varios pedidos.', 400)
  return dimensions
}

const httpsTransport = (url, { method, headers, body }) => new Promise((resolve, reject) => {
  const request = https.request(url, { method, headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, timeout: 20_000 }, (response) => {
    const chunks = []
    response.on('data', (chunk) => chunks.push(chunk))
    response.on('end', () => resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
  })
  request.on('timeout', () => request.destroy(new Error('timeout')))
  request.on('error', reject)
  request.end(body)
})

const parseJson = (text) => {
  try { return text ? JSON.parse(text) : null } catch { return null }
}

export const createMiCorreoClient = (config, transport = httpsTransport, now = () => Date.now()) => {
  let session = null

  const requireConfig = () => {
    if (config.missing.length) throw new MiCorreoError(`Falta configurar MiCorreo: ${config.missing.join(', ')}.`, 503)
  }

  const send = async (path, { method = 'GET', headers = {}, body, query } = {}) => {
    const url = new URL(`${config.baseUrl}${path}`)
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    try {
      return await transport(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
    } catch {
      throw new MiCorreoError('No se pudo conectar con MiCorreo.')
    }
  }

  // Los errores llegan como { code, message } (code a veces string y a veces número) e incluso como 200 con { error }.
  const unwrap = (result) => {
    const data = parseJson(result.text)
    const isObject = data && typeof data === 'object' && !Array.isArray(data)
    if (!result.ok || (isObject && data.error)) {
      const detail = (isObject && (data.message || data.error)) || (result.status === 401 ? 'Credenciales inválidas.' : `Error ${result.status}`)
      throw new MiCorreoError(`MiCorreo: ${detail}`, [400, 402, 422].includes(result.status) || result.ok ? 400 : 502)
    }
    return data
  }

  const getToken = async () => {
    requireConfig()
    if (session && session.expiresAt - 60_000 > now()) return session.token
    const basic = Buffer.from(`${config.user}:${config.password}`).toString('base64')
    const result = await send('/token', { method: 'POST', headers: { Authorization: `Basic ${basic}` } })
    const data = parseJson(result.text)
    if (!result.ok || !data?.token) throw new MiCorreoError('MiCorreo: no se pudo autenticar con las credenciales configuradas.')
    const expires = Date.parse(String(data.expires ?? '').replace(' ', 'T'))
    session = { token: data.token, expiresAt: Number.isNaN(expires) ? now() + 5 * 60_000 : expires }
    return session.token
  }

  const authorized = async (path, options = {}) => {
    const token = await getToken()
    return unwrap(await send(path, { ...options, headers: { Authorization: `Bearer ${token}` } }))
  }

  return {
    validateCredentials: async () => { await getToken(); return true },
    // deliveredType: 'D' domicilio, 'S' sucursal; sin valor devuelve ambos.
    getRates: async ({ postalCodeDestination, dimensions, deliveredType }) => {
      requireConfig()
      const destination = numericPostalCode(postalCodeDestination)
      if (!destination) throw new MiCorreoError('Escribe un código postal válido para cotizar el envío.', 400)
      const data = await authorized('/rates', {
        method: 'POST',
        body: { customerId: config.customerId, postalCodeOrigin: config.originPostalCode, postalCodeDestination: destination, ...(deliveredType ? { deliveredType } : {}), dimensions },
      })
      return (Array.isArray(data?.rates) ? data.rates : []).map((rate) => ({
        deliveredType: rate.deliveredType,
        productType: rate.productType,
        productName: rate.productName,
        priceArs: Math.ceil(Number(rate.price) || 0),
        deliveryTimeMin: rate.deliveryTimeMin ?? null,
        deliveryTimeMax: rate.deliveryTimeMax ?? null,
      })).filter((rate) => rate.priceArs > 0 && rate.productType)
    },
    getAgencies: async ({ provinceCode, services } = {}) => {
      requireConfig()
      const data = await authorized('/agencies', { query: { customerId: config.customerId, provinceCode, services } })
      return Array.isArray(data) ? data : data?.agencies ?? []
    },
    importShipping: async (payload) => {
      requireConfig()
      return authorized('/shipping/import', { method: 'POST', body: { customerId: config.customerId, ...payload } })
    },
    // La documentación define este GET con cuerpo JSON.
    getTracking: async (shippingId) => {
      requireConfig()
      const data = await authorized('/shipping/tracking', { method: 'GET', body: { shippingId } })
      const entry = Array.isArray(data) ? data[0] : data
      return { trackingNumber: entry?.trackingNumber ?? '', events: Array.isArray(entry?.events) ? entry.events : [] }
    },
  }
}

// Pedido de la tienda -> body de POST /shipping/import. `sender` es el remitente ya configurado con CORREO_SENDER_*.
export const buildImportPayload = (order, { sender, dimensions, productType = 'CP' }) => {
  const province = provinceCodes[String(order.shipping_province ?? '').trim().toLowerCase()]
  if (!province) throw new MiCorreoError('La provincia del pedido no tiene un código de Correo Argentino válido.', 400)
  if (!order.user_email) throw new MiCorreoError('El pedido no tiene email del destinatario, requerido por MiCorreo.', 400)
  const street = splitStreet(order.shipping_street)
  return {
    extOrderId: String(order.reference),
    orderNumber: String(order.reference),
    sender: {
      name: sender.businessName || null,
      phone: [sender.areaCodePhone, sender.phoneNumber].filter(Boolean).join('') || null,
      cellPhone: null,
      email: sender.email || null,
      originAddress: {
        streetName: sender.streetName || null,
        streetNumber: sender.streetNumber || null,
        floor: sender.floor || null,
        apartment: sender.department || null,
        city: sender.cityName || null,
        provinceCode: sender.state || null,
        postalCode: numericPostalCode(sender.zipCode) || null,
      },
    },
    recipient: {
      name: order.shipping_name,
      phone: String(order.shipping_phone ?? '').replace(/[^\d]/g, ''),
      cellPhone: '',
      email: order.user_email,
    },
    shipping: {
      deliveryType: 'D',
      agency: null,
      productType,
      address: {
        streetName: street.streetName,
        streetNumber: street.streetNumber,
        floor: street.floor.slice(0, 3),
        apartment: street.department.slice(0, 3),
        city: order.shipping_city,
        provinceCode: province,
        postalCode: numericPostalCode(order.shipping_postal_code),
      },
      weight: dimensions.weight,
      declaredValue: Math.max(1, Math.round(order.total_ars ?? 1)),
      height: dimensions.height,
      length: dimensions.length,
      width: dimensions.width,
    },
  }
}
