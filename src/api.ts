import type { Product } from './catalog'

export type AccountUser = {
  id: number
  name: string
  email: string
  phone: string
  isAdmin: boolean
}

export type AccountOrderItem = {
  name: string
  slug: string
  image: string
  size: string
  quantity: number
  unitPriceArs: number
}

export type ShippingDetails = {
  method: 'delivery' | 'pickup'
  name: string
  phone: string
  street: string
  city: string
  province: string
  postalCode: string
  notes: string
}

export type TransferDetails = { holder: string; bank: string; cbu: string; alias: string; taxId: string }

export type OrderStatus = 'pending_payment' | 'paid' | 'shipped' | 'delivered' | 'cancelled'

export type AccountOrder = {
  id: number
  reference: string
  totalArs: number
  shippingCostArs: number
  status: OrderStatus | string
  createdAt: string
  paymentUrl?: string | null
  paymentMethod?: 'mercadopago' | 'transfer'
  transfer?: TransferDetails | null
  shipping: ShippingDetails
  carrier: string
  trackingCode: string
  trackingUrl: string
  shippedAt: string | null
  items: AccountOrderItem[]
  couponCode?: string
  discountArs?: number
  giftCardArs?: number
  giftCards?: { code: string; initialArs: number; balanceArs: number }[]
}

export type AccountNotification = {
  id: number
  kind: string
  title: string
  message: string
  isRead: boolean
  createdAt: string
}

export type ProductReview = {
  id: number
  userName: string
  rating: number
  comment: string
  createdAt: string
}

export type AccountSummary = {
  favorites: Product[]
  orders: AccountOrder[]
  recommendations: Product[]
}

export type AdminOrder = AccountOrder & {
  userName: string
  userEmail: string
}

export type StoreSettings = {
  shippingCostArs: number
  freeShippingThresholdArs: number
  pickupAddress: string
  legalName: string
  taxId: string
  address: string
  email: string
  phone: string
  transferHolder: string
  transferBank: string
  transferCbu: string
  transferAlias: string
  transferTaxId: string
}

export type AdminSummary = {
  products: number
  orders: number
  pending: number
  paid: number
  totalRevenue: number
}

export type NewsletterSubscriber = {
  id: number
  email: string
  createdAt: string
}

export type ContactMessage = {
  id: number
  name: string
  email: string
  subject: string
  message: string
  isRead: boolean
  emailSent: boolean
  createdAt: string
}

export type StoreConfig = {
  defaultCurrency: 'ARS'
  usdArsRate: number | null
  exchangeSource: string | null
  exchangeUpdatedAt: string | null
  shipping: { costArs: number; freeThresholdArs: number; pickupAddress: string }
  transfer: TransferDetails | null
  store: { legalName: string; taxId: string; address: string; email: string; phone: string }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers })
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(payload.error || 'No se pudo completar la solicitud.')
  return payload as T
}