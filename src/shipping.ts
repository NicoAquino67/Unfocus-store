import type { ShippingDetails, StoreConfig } from './api'

export const calculateShipping = (subtotal: number, method: ShippingDetails['method'], shipping: StoreConfig['shipping'] | null) => {
  if (!shipping || method === 'pickup') return 0
  if (shipping.freeThresholdArs > 0 && subtotal >= shipping.freeThresholdArs) return 0
  return shipping.costArs
}
