import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProvinceRates, publicProvinceCosts } from './provinceRates.mjs'

test('tarifas provinciales suman costo y margen y permiten cero', () => {
  const rates = parseProvinceRates({ 'Buenos Aires': { baseArs: 300, marginArs: 30 }, Chaco: { baseArs: 0, marginArs: 0 } })
  assert.deepEqual(publicProvinceCosts(rates), { 'Buenos Aires': 330, Chaco: 0 })
})

test('rechaza provincias e importes inválidos', () => {
  for (const rates of [
    { Desconocida: { baseArs: 1, marginArs: 0 } },
    { Chaco: { baseArs: -1, marginArs: 0 } },
    { Chaco: { baseArs: 1.5, marginArs: 0 } },
    { Chaco: { baseArs: '1', marginArs: 0 } },
    { Chaco: { baseArs: 100_000_000, marginArs: 1 } },
  ]) assert.throws(() => parseProvinceRates(rates))
})
