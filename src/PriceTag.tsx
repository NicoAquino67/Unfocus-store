import { formatPrice, getSalePrice, hasDiscount, type DisplayCurrency, type Product } from './catalog'

type PriceTagProps = { product: Product; currency: DisplayCurrency; usdArsRate: number | null; prefix?: string }

// Muestra el precio original tachado junto al precio con descuento; el texto oculto lo anuncia a lectores de pantalla.
function PriceTag({ product, currency, usdArsRate, prefix }: PriceTagProps) {
  if (!hasDiscount(product)) return <>{prefix}{formatPrice(product.price, currency, usdArsRate)}</>
  const percent = Math.round((1 - getSalePrice(product) / product.price) * 100)
  return (
    <span className="price-tag">
      <span className="visually-hidden">Precio original </span><s>{formatPrice(product.price, currency, usdArsRate)}</s>
      <span className="visually-hidden"> Precio con descuento </span><strong>{formatPrice(getSalePrice(product), currency, usdArsRate)}</strong>
      <span className="price-tag__off">-{percent}%</span>
    </span>
  )
}

export default PriceTag