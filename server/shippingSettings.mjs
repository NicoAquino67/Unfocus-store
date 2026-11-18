export const shippingSettingsFields = {
  senderName: 'CORREO_SENDER_NAME',
  senderEmail: 'CORREO_SENDER_EMAIL',
  senderAreaCode: 'CORREO_SENDER_AREA_CODE',
  senderPhone: 'CORREO_SENDER_PHONE',
  senderStreet: 'CORREO_SENDER_STREET',
  senderStreetNumber: 'CORREO_SENDER_STREET_NUMBER',
  senderFloor: 'CORREO_SENDER_FLOOR',
  senderDepartment: 'CORREO_SENDER_DEPARTMENT',
  senderCity: 'CORREO_SENDER_CITY',
  senderProvinceCode: 'CORREO_SENDER_PROVINCE_CODE',
  senderZipCode: 'CORREO_SENDER_ZIP_CODE',
  serviceType: 'CORREO_SERVICE_TYPE',
  parcelWeightGrams: 'CORREO_PARCEL_WEIGHT_GRAMS',
  parcelHeightCm: 'CORREO_PARCEL_HEIGHT_CM',
  parcelWidthCm: 'CORREO_PARCEL_WIDTH_CM',
  parcelDepthCm: 'CORREO_PARCEL_DEPTH_CM',
  parcelCategory: 'CORREO_PARCEL_CATEGORY',
}

export const shippingSettingsPrefix = 'shippingIntegration.'
const defaults = { serviceType: 'CP', parcelWeightGrams: '400', parcelHeightCm: '5', parcelWidthCm: '25', parcelDepthCm: '35', parcelCategory: 'Indumentaria' }

export function shippingSettingsFromRows(rows, env = process.env) {
  const settings = Object.fromEntries(Object.entries(shippingSettingsFields).map(([key, name]) => [key, env[name]?.trim() || defaults[key] || '']))
  for (const row of rows) {
    if (!row.key.startsWith(shippingSettingsPrefix)) continue
    const key = row.key.slice(shippingSettingsPrefix.length)
    if (Object.hasOwn(shippingSettingsFields, key)) settings[key] = row.value
  }
  return settings
}

export function shippingSettingsEnvironment(settings, env = process.env) {
  return { ...env, ...Object.fromEntries(Object.entries(shippingSettingsFields).map(([key, name]) => [name, settings[key]])) }
}

export function parseShippingSettings(input) {
  const settings = {}
  for (const key of Object.keys(shippingSettingsFields)) {
    if (typeof input?.[key] !== 'string') throw new Error('Completa los datos de configuración de envíos.')
    const value = input[key].replace(/[\r\n\t]+/g, ' ').trim()
    if (value.length > 200) throw new Error('Los datos de envío no pueden superar 200 caracteres.')
    settings[key] = value
  }
  settings.senderProvinceCode = settings.senderProvinceCode.toUpperCase()
  settings.senderZipCode = settings.senderZipCode.toUpperCase().replace(/\s+/g, '')
  settings.serviceType = settings.serviceType.toUpperCase()
  if (settings.senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.senderEmail)) throw new Error('Escribe un correo del remitente válido.')
  if (settings.senderProvinceCode && !/^[ABCDEFGHJKLMNPQRSTUVWXYZ]$/.test(settings.senderProvinceCode)) throw new Error('Selecciona un código de provincia válido.')
  if (settings.senderZipCode && !/^(?:\d{4}|[A-Z]\d{4}[A-Z]{3})$/.test(settings.senderZipCode)) throw new Error('El código postal del remitente debe tener 4 dígitos o formato CPA.')
  if (!/^[A-Z]{2}$/.test(settings.serviceType)) throw new Error('El tipo de servicio debe tener dos letras.')
  if (!settings.parcelCategory) throw new Error('Escribe la categoría del paquete.')
  for (const [key, max] of Object.entries({ parcelWeightGrams: 50000, parcelHeightCm: 200, parcelWidthCm: 200, parcelDepthCm: 200 })) {
    if (!/^\d+$/.test(settings[key]) || Number(settings[key]) < 1 || Number(settings[key]) > max) throw new Error('Revisa el peso y las medidas del paquete.')
    settings[key] = String(Number(settings[key]))
  }
  if (Number(settings.parcelHeightCm) + Number(settings.parcelWidthCm) + Number(settings.parcelDepthCm) > 300) throw new Error('La suma de las medidas del paquete no puede superar 300 cm.')
  return settings
}
