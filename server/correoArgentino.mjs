// Cliente de la API Paq.ar de Correo Argentino (v1). Documentación: ident/apiPaqAr.pdf
import https from 'node:https'

const hosts = {
  test: 'https://apitest.correoargentino.com.ar/paqar/v1',
  production: 'https://api.correoargentino.com.ar/paqar/v1',
}

export const provinceCodes = {
  'salta': 'A',
  'buenos aires': 'B',
  'provincia de buenos aires': 'B',
  'ciudad autónoma de buenos aires': 'C',
  'ciudad autonoma de buenos aires': 'C',
  'caba': 'C',
  'san luis': 'D',
  'entre ríos': 'E',
  'entre rios': 'E',
  'la rioja': 'F',
  'santiago del estero': 'G',
  'chaco': 'H',
  'san juan': 'J',
  'catamarca': 'K',
  'la pampa': 'L',
  'mendoza': 'M',
  'misiones': 'N',
  'formosa': 'P',
  'neuquén': 'Q',
  'neuquen': 'Q',
  'río negro': 'R',
  'rio negro': 'R',
  'santa fe': 'S',
  'tucumán': 'T',
  'tucuman': 'T',
  'chubut': 'U',
  'tierra del fuego': 'V',
  'corrientes': 'W',
  'córdoba': 'X',
  'cordoba': 'X',
  'jujuy': 'Y',
  'santa cruz': 'Z',
}

export const readCorreoArgentinoConfig = (env = process.env) => {
  const text = (name, fallback = '') => env[name]?.trim() || fallback
  const number = (name, fallback) => {
    const value = Number(env[name])
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
  }
  const environment = text('CORREO_ARGENTINO_ENVIRONMENT', 'test').toLowerCase() === 'production' ? 'production' : 'test'
  const sender = {
    businessName: text('CORREO_SENDER_NAME'),
    email: text('CORREO_SENDER_EMAIL'),
    areaCodePhone: text('CORREO_SENDER_AREA_CODE'),
    phoneNumber: text('CORREO_SENDER_PHONE'),
    streetName: text('CORREO_SENDER_STREET'),
    streetNumber: text('CORREO_SENDER_STREET_NUMBER'),
    cityName: text('CORREO_SENDER_CITY'),
    floor: text('CORREO_SENDER_FLOOR'),
    department: text('CORREO_SENDER_DEPARTMENT'),
    state: text('CORREO_SENDER_PROVINCE_CODE').toUpperCase(),
    zipCode: text('CORREO_SENDER_ZIP_CODE'),
  }
  const required = [
    ['CORREO_ARGENTINO_API_KEY', text('CORREO_ARGENTINO_API_KEY')],
    ['CORREO_ARGENTINO_AGREEMENT', text('CORREO_ARGENTINO_AGREEMENT')],
    ['CORREO_SENDER_NAME', sender.businessName],
    ['CORREO_SENDER_STREET', sender.streetName],
    ['CORREO_SENDER_STREET_NUMBER', sender.streetNumber],
    ['CORREO_SENDER_CITY', sender.cityName],
    ['CORREO_SENDER_PROVINCE_CODE', sender.state],
    ['CORREO_SENDER_ZIP_CODE', sender.zipCode],
  ]
  return {
    environment,
    baseUrl: text('CORREO_ARGENTINO_BASE_URL') || hosts[environment],
    apiKey: text('CORREO_ARGENTINO_API_KEY'),
    agreement: text('CORREO_ARGENTINO_AGREEMENT'),
    serviceType: text('CORREO_SERVICE_TYPE', 'CP').slice(0, 2).toUpperCase(),
    sender,
    parcel: {
      weightGrams: Math.min(number('CORREO_PARCEL_WEIGHT_GRAMS', 400), 99999),
      height: number('CORREO_PARCEL_HEIGHT_CM', 5),
      width: number('CORREO_PARCEL_WIDTH_CM', 25),
      depth: number('CORREO_PARCEL_DEPTH_CM', 35),
      category: text('CORREO_PARCEL_CATEGORY', 'Indumentaria'),
    },
    missing: required.filter(([, value]) => !value).map(([name]) => name),
  }
}

export class CorreoArgentinoError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.name = 'CorreoArgentinoError'
    this.status = status
  }
}

// "Av. Siempre Viva 742 3B" -> calle, altura y piso/depto.
export const splitStreet = (value) => {
  const text = String(value ?? '').trim()
  const match = text.match(/^(.*?)[\s,]+(\d+[A-Za-z]?)\b[\s,]*(.*)$/)
  if (!match) return { streetName: text, streetNumber: 'S/N', floor: '', department: '' }
  const [, streetName, streetNumber, rest] = match
  const floorMatch = rest.match(/(?:piso|p\.?)\s*(\w+)/i)
  const departmentMatch = rest.match(/(?:depto\.?|dpto\.?|departamento|dto\.?)\s*(\w+)/i)
  const bare = rest.match(/^(\w+)\s*[°ºo]?\s*["']?(\w)?["']?$/)
  return {
    streetName: streetName.trim(),
    streetNumber,
    floor: floorMatch?.[1] ?? (!departmentMatch && bare ? bare[1] : ''),
    department: departmentMatch?.[1] ?? (!floorMatch && bare?.[2] ? bare[2] : ''),
  }
}

// El código postal debe validar contra la provincia: si llega solo con 4 dígitos se antepone la letra.
export const normalizeZipCode = (postalCode, provinceCode) => {
  const zip = String(postalCode ?? '').replace(/\s+/g, '').toUpperCase()
  return /^\d{4}$/.test(zip) ? `${provinceCode}${zip}` : zip
}

const splitPhone = (phone) => ({ areaCodeCellphone: '', cellphoneNumber: String(phone ?? '').replace(/[^\d]/g, '') })

const shortId = (value, max = 30) => String(value ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, max)

export const buildOrderPayload = (config, order, { agencyId = '', now = new Date() } = {}) => {
  const province = provinceCodes[String(order.shipping_province ?? '').trim().toLowerCase()]
  if (!province) throw new CorreoArgentinoError('La provincia del pedido no tiene un código de Correo Argentino válido.', 400)
  const street = splitStreet(order.shipping_street)
  const isAgency = Boolean(agencyId)
  const created = new Date(`${String(order.created_at).replace(' ', 'T')}Z`)
  const saleMoment = Number.isNaN(created.getTime()) ? now : created
  const saleDate = `${new Date(saleMoment.getTime() - 3 * 3600_000).toISOString().slice(0, 19)}-03:00`
  return {
    sellerId: shortId(config.agreement),
    trackingNumber: '',
    order: {
      senderData: { id: shortId(config.agreement), ...config.sender, observation: '' },
      shippingData: {
        name: order.shipping_name,
        email: order.user_email ?? '',
        observation: String(order.shipping_notes ?? '').slice(0, 200),
        areaCodePhone: '',
        phoneNumber: '',
        ...splitPhone(order.shipping_phone),
        address: {
          streetName: isAgency ? '' : street.streetName,
          streetNumber: isAgency ? '' : street.streetNumber,
          cityName: order.shipping_city,
          floor: street.floor,
          department: street.department,
          state: province,
          zipCode: normalizeZipCode(order.shipping_postal_code, province),
        },
      },
      parcels: [{
        dimensions: { height: String(config.parcel.height), width: String(config.parcel.width), depth: String(config.parcel.depth) },
        productWeight: String(config.parcel.weightGrams),
        productCategory: config.parcel.category,
        declaredValue: String(Math.max(1, Math.round(order.total_ars ?? 1))),
      }],
      deliveryType: isAgency ? 'agency' : 'homeDelivery',
      agencyId,
      saleDate,
      serviceType: config.serviceType,
      shipmentClientId: shortId(order.reference),
    },
  }
}

// node:https en lugar de fetch porque /tracking es un GET con cuerpo JSON, algo que fetch rechaza.
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

export const createCorreoArgentinoClient = (config, transport = httpsTransport) => {
  const call = async (path, { method = 'GET', body, query } = {}) => {
    if (config.missing.length) throw new CorreoArgentinoError(`Falta configurar Correo Argentino: ${config.missing.join(', ')}.`, 503)
    const url = new URL(`${config.baseUrl}${path}`)
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    let result
    try {
      result = await transport(url, {
        method,
        headers: { Authorization: `Apikey ${config.apiKey}`, agreement: config.agreement, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch {
      throw new CorreoArgentinoError('No se pudo conectar con Correo Argentino.')
    }
    const text = result.text
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    if (!result.ok) {
      const detail = (data && typeof data === 'object' && (data.message || data.error)) || (result.status === 401 ? 'Credenciales inválidas.' : result.status === 403 ? 'Acceso denegado.' : `Error ${result.status}`)
      throw new CorreoArgentinoError(`Correo Argentino: ${detail}`, result.status === 400 ? 400 : 502)
    }
    return data
  }

  return {
    validateCredentials: async () => { await call('/auth'); return true },
    createOrder: async (payload) => {
      const data = await call('/orders', { method: 'POST', body: payload })
      const trackingNumber = data?.trackingNumber
      if (!trackingNumber) throw new CorreoArgentinoError('Correo Argentino no devolvió un número de seguimiento.')
      return { trackingNumber: String(trackingNumber), sellerId: data.idSeller ?? data.sellerId ?? '' }
    },
    cancelOrder: (trackingNumber) => call(`/orders/${encodeURIComponent(trackingNumber)}/cancel`, { method: 'PATCH' }),
    getLabel: async (trackingNumber, sellerId, labelFormat = '10x15') => {
      const data = await call('/labels', { method: 'POST', query: { labelFormat }, body: [{ sellerId: sellerId || config.agreement, trackingNumber }] })
      const entry = Array.isArray(data) ? data[0] : null
      if (!entry || !entry.fileBase64 || (entry.result && entry.result !== 'OK')) throw new CorreoArgentinoError(`Correo Argentino: ${entry?.result || 'no se pudo obtener el rótulo.'}`, 400)
      return { pdf: Buffer.from(entry.fileBase64, 'base64'), fileName: entry.fileName || `${trackingNumber}.pdf` }
    },
    getTracking: async (trackingNumber) => {
      const data = await call('/tracking', { method: 'GET', body: [{ trackingNumber }] })
      const entry = Array.isArray(data) ? data[0] : null
      return { events: Array.isArray(entry?.event) ? entry.event : [] }
    },
    getAgencies: (query = {}) => call('/agencies', { query: { stateId: query.stateId, pickup_availability: query.pickupAvailability, package_reception: query.packageReception } }),
  }
}
