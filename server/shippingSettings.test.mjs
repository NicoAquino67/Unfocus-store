import assert from 'node:assert/strict'
import test from 'node:test'
import { readCorreoArgentinoConfig } from './correoArgentino.mjs'
import { parseShippingSettings, shippingSettingsEnvironment, shippingSettingsFromRows } from './shippingSettings.mjs'

test('datos guardados prevalecen sobre el entorno sin exponer ni reemplazar credenciales', () => {
  const env = {
    CORREO_SENDER_NAME: 'Anterior', CORREO_ARGENTINO_API_KEY: 'secret-key',
    CORREO_PARCEL_WEIGHT_GRAMS: '600',
  }
  const settings = shippingSettingsFromRows([
    { key: 'shippingIntegration.senderName', value: 'Nuevo' },
    { key: 'shippingIntegration.parcelWeightGrams', value: '800' },
    { key: 'shippingIntegration.CORREO_ARGENTINO_API_KEY', value: 'ignorado' },
  ], env)
  assert.equal(settings.senderName, 'Nuevo')
  assert.equal(settings.parcelWeightGrams, '800')
  assert.equal(JSON.stringify(settings).includes('secret'), false)
  const merged = shippingSettingsEnvironment(settings, env)
  assert.equal(merged.CORREO_ARGENTINO_API_KEY, 'secret-key')
  assert.equal(readCorreoArgentinoConfig(merged).sender.businessName, 'Nuevo')
  assert.equal(readCorreoArgentinoConfig(merged).parcel.weightGrams, 800)
})

test('valida y normaliza datos de remitente y límites del paquete', () => {
  const defaults = shippingSettingsFromRows([], {})
  const valid = parseShippingSettings({ ...defaults, senderProvinceCode: 'b', senderZipCode: 'b1234abc', serviceType: 'cp' })
  assert.equal(valid.senderProvinceCode, 'B')
  assert.equal(valid.senderZipCode, 'B1234ABC')
  assert.equal(valid.serviceType, 'CP')
  assert.throws(() => parseShippingSettings({ ...defaults, senderZipCode: 'abc' }), /código postal/i)
  assert.throws(() => parseShippingSettings({ ...defaults, senderProvinceCode: 'I' }), /provincia/i)
  assert.throws(() => parseShippingSettings({ ...defaults, parcelWeightGrams: '50001' }), /peso/i)
  assert.throws(() => parseShippingSettings({ ...defaults, parcelHeightCm: '200', parcelWidthCm: '100', parcelDepthCm: '1' }), /suma/i)
})
