import mindUnfilteredFront from '../ident/productos/mind-unfiltered-frente.jpg'
import mindUnfilteredBack from '../ident/productos/mind-unfiltered-espalda.jpg'
import noMolestarFront from '../ident/productos/no-molestar-frente.jpg'
import noMolestarBack from '../ident/productos/no-molestar-espalda.jpg'

export type Category = 'Camisetas' | 'Regalos'
export type DisplayCurrency = 'ARS' | 'USD'

export type Product = {
  id: number
  slug: string
  name: string
  category: Category
  price: number
  discountType?: 'none' | 'percent' | 'fixed'
  discountValue?: number
  salePrice?: number
  image?: string
  alt: string
  features: string[]
  composition: string
  description: string
  designDescription: string
  gallery?: { src: string; alt: string; label: string }[]
  badge?: string
  stockBySize?: Record<string, number>
  createdAt?: string
  sold?: number
  isGiftCard?: boolean
}

export const garmentCuts = ['Oversize', 'Regular fit', 'Slim', 'Unisex'] as const
export const productAudiences = ['Niños', 'Adultos'] as const
export const productGenders = ['Mujer', 'Hombre', 'Unisex'] as const

export type GarmentCut = (typeof garmentCuts)[number]
export type ProductAudience = (typeof productAudiences)[number]
export type ProductGender = (typeof productGenders)[number]

export const productFacetTag = (facet: 'cut' | 'audience' | 'gender', value: string) => `${facet}:${value}`

export const getProductFacets = (features: string[]) => ({
  cut: garmentCuts.find((value) => features.includes(productFacetTag('cut', value))) ?? 'Regular fit',
  audience: productAudiences.find((value) => features.includes(productFacetTag('audience', value))) ?? 'Adultos',
  gender: productGenders.find((value) => features.includes(productFacetTag('gender', value))) ?? 'Unisex',
})

export const normalizeProductFacets = (product: Product): Product => {
  const features = Array.isArray(product.features) ? product.features : []
  const facets = getProductFacets(features)
  const generalFeatures = features.filter((feature) => !/^(cut|audience|gender):/.test(feature))

  return {
    ...product,
    features: [
      ...generalFeatures,
      productFacetTag('cut', facets.cut),
      productFacetTag('audience', facets.audience),
      productFacetTag('gender', facets.gender),
    ],
  }
}

export const initialProducts: Product[] = [
  { id: 1, slug: 'mind-unfiltered', name: 'Mind Unfiltered', category: 'Camisetas', price: 45900, alt: 'Camiseta negra UnFocus con diseño Mind Unfiltered', features: ['100% algodón'], composition: '100% algodón', description: 'Camiseta negra con el mensaje «MIND UNFILTERED» en el pecho y una ilustración multicolor en la espalda.', designDescription: 'Una bombilla y una mente llena de ideas acompañan la frase «No hay límites para una mente que piensa diferente».', gallery: [{ src: mindUnfilteredFront, alt: 'Frente de la camiseta Mind Unfiltered con texto pequeño en el pecho', label: 'Frente' }, { src: mindUnfilteredBack, alt: 'Espalda de la camiseta Mind Unfiltered con ilustración colorida', label: 'Espalda' }], badge: 'Diseño UnFocus' },
  { id: 2, slug: 'no-molestar', name: 'No Molestar', category: 'Camisetas', price: 52900, alt: 'Camiseta negra UnFocus con diseño Estado de Hiperfoco', features: ['100% algodón'], composition: '100% algodón', description: 'Camiseta negra con el diseño «Estado de hiperfoco» al frente y un mensaje tipográfico en la espalda.', designDescription: 'Un guiño visual a esos momentos de concentración: «No molestar, por favor».', gallery: [{ src: noMolestarFront, alt: 'Frente de la camiseta No Molestar con el diseño Estado de Hiperfoco', label: 'Frente' }, { src: noMolestarBack, alt: 'Espalda de la camiseta No Molestar con la frase en letras verticales', label: 'Espalda' }], badge: 'Diseño UnFocus' },
]

export const sizes = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']
export const categories = ['Todo', 'Camisetas', 'Regalos'] as const
export type CategoryFilter = (typeof categories)[number]

export const giftCardAmounts = [30000, 50000, 75000, 100000, 150000, 200000, 300000, 400000, 500000]
export const giftCardMinimum = 30000
export const giftCardMaximum = 1000000
export const isValidGiftCardAmount = (value: string) => /^\d+$/.test(value) && Number(value) >= giftCardMinimum && Number(value) <= giftCardMaximum

// En las tarjetas de regalo el "talle" es el monto en ARS y no hay stock que agotar.
export const getDefaultSize = (product: Product) => product.isGiftCard ? '50000' : 'M'
export const getSalePrice = (product: Product) => product.salePrice ?? product.price
export const hasDiscount = (product: Product) => !product.isGiftCard && getSalePrice(product) < product.price

export const getStockForSize = (product: Product, size: string) => product.isGiftCard ? 999 : Number(product.stockBySize?.[size] ?? 0)

export const formatPrice = (price: number, currency: DisplayCurrency = 'ARS', usdArsRate: number | null = null) => {
  const canConvert = currency === 'USD' && usdArsRate !== null && usdArsRate > 0
  const displayCurrency = canConvert ? 'USD' : 'ARS'
  const amount = canConvert ? price / usdArsRate : price
  return new Intl.NumberFormat(displayCurrency === 'ARS' ? 'es-AR' : 'en-US', {
    style: 'currency',
    currency: displayCurrency,
    maximumFractionDigits: displayCurrency === 'ARS' ? 0 : 2,
  }).format(amount)
}

export const getProductImage = (product: Product, viewIndex = 0) =>
  product.gallery?.[viewIndex]?.src ?? (product.image ? `https://images.unsplash.com/${product.image}?auto=format&fit=crop&w=900&q=82` : '')