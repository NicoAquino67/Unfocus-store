import { readFile } from 'node:fs/promises'

export const provinces = JSON.parse(await readFile(new URL('./provinces.json', import.meta.url), 'utf8'))
export const provinceRatesKey = 'shippingProvinceRates'

export function parseProvinceRates(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Las tarifas por provincia no son válidas.')
  const rates = {}
  for (const [province, rate] of Object.entries(input)) {
    if (!provinces.includes(province) || !rate || typeof rate !== 'object' || Array.isArray(rate)) throw new Error('La provincia o su tarifa no son válidas.')
    const { baseArs, marginArs } = rate
    if (!Number.isInteger(baseArs) || !Number.isInteger(marginArs) || baseArs < 0 || marginArs < 0 || baseArs + marginArs > 100_000_000) {
      throw new Error('La tarifa base y el margen deben ser importes enteros no negativos, con un total máximo de $100.000.000.')
    }
    rates[province] = { baseArs, marginArs }
  }
  return rates
}

export const publicProvinceCosts = (rates) => Object.fromEntries(
  Object.entries(rates).map(([province, rate]) => [province, rate.baseArs + rate.marginArs]),
)
