import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Brain,
  Check,
  ChevronDown,
  Heart,
  ListFilter,
  Minus,
  Plus,
  Search,
  Send,
  ShoppingBag,
  Star,
  Truck,
  UserRound,
  X,
} from 'lucide-react'
import unfocusLogo from '../ident/png full color.png'
import unfocusLogoWhite from '../ident/png blanco.png'
import PriceTag from './PriceTag'
import { categories, getSalePrice, formatPrice, getDefaultSize, getProductImage, getProductFacets, getStockForSize, giftCardAmounts, giftCardMaximum, giftCardMinimum, isValidGiftCardAmount, initialProducts, normalizeProductFacets, garmentCuts, productAudiences, productGenders, sizes, type CategoryFilter, type DisplayCurrency, type GarmentCut, type Product, type ProductAudience, type ProductGender } from './catalog'
import { apiRequest, type AccountNotification, type AccountSummary, type AccountUser, type ProductReview, type StoreConfig } from './api'
import AccountPanel from './AccountPanel'
import ProductAdmin from './ProductAdmin'
import CheckoutForm, { type CheckoutPayload } from './CheckoutForm'
import LegalPages from './LegalPages'
import { legalPageKeys, legalPageTitles, type LegalPageKey } from './legalData'
import './App.css'

type ProductDetailProps = {
  product: Product
  relatedProducts: Product[]
  relatedTitle: string
  selectedSize: string
  selectedView: number
  currentUser: AccountUser | null
  currency: DisplayCurrency
  usdArsRate: number | null
  onBack: () => void
  onSelectRelated: (product: Product) => void
  onSizeChange: (size: string) => void
  onViewChange: (view: number) => void
  onAddToCart: () => void
  onRequestLogin: () => void
  onOpenContact: () => void
}
const argentineSizeEquivalents: Record<string, string> = {
  XS: '36–38',
  S: '40–42',
  M: '44–46',
  L: '48–50',
  XL: '52–54',
  '2XL': '56–58',
  '3XL': '60–62',
}

// Medidas orientativas en cm (ancho de pecho y largo): confirmar con las prendas reales.
const garmentMeasurements: Record<string, { chest: number; length: number }> = {
  XS: { chest: 50, length: 67 },
  S: { chest: 52, length: 69 },
  M: { chest: 54, length: 71 },
  L: { chest: 57, length: 73 },
  XL: { chest: 60, length: 75 },
  '2XL': { chest: 63, length: 77 },
  '3XL': { chest: 66, length: 79 },
}

function ProductDetail({ product, relatedProducts, relatedTitle, selectedSize, selectedView, currentUser, currency, usdArsRate, onBack, onSelectRelated, onSizeChange, onViewChange, onAddToCart, onRequestLogin, onOpenContact }: ProductDetailProps) {
  const [isGalleryHovering, setIsGalleryHovering] = useState(false)
  const [reviewResult, setReviewResult] = useState<{ slug: string; reviews: ProductReview[] } | null>(null)
  const [zoomOrigin, setZoomOrigin] = useState<string | null>(null)
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewMessage, setReviewMessage] = useState('')
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)

  const baseViews = product.gallery && product.gallery.length > 0 ? [...product.gallery] : [{ src: getProductImage(product), alt: product.alt, label: 'Vista principal' }]
  const views = [...baseViews]

  while (views.length < 3) {
    const source = baseViews[views.length % baseViews.length]
    views.push({
      src: source.src,
      alt: source.alt,
      label: `${source.label} ${Math.floor(views.length / baseViews.length) + 1}`,
    })
  }

  useEffect(() => {
    if (selectedView >= views.length) {
      onViewChange(0)
    }
  }, [selectedView, views.length, onViewChange])

  useEffect(() => {
    if (views.length <= 1 || isGalleryHovering) return

    const timer = window.setTimeout(() => {
      onViewChange((selectedView + 1) % views.length)
    }, 10000)

    return () => window.clearTimeout(timer)
  }, [selectedView, views.length, isGalleryHovering, onViewChange])

  useEffect(() => {
    let isCurrent = true
    apiRequest<{ reviews: ProductReview[] }>(`/api/products/${encodeURIComponent(product.slug)}/reviews`)
      .then(({ reviews: productReviews }) => { if (isCurrent) setReviewResult({ slug: product.slug, reviews: productReviews }) })
      .catch(() => {
        if (!isCurrent) return
        setReviewResult({ slug: product.slug, reviews: [] })
        setReviewMessage('No se pudieron cargar las reseñas.')
      })
    return () => { isCurrent = false }
  }, [product.slug])

  const submitReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!currentUser) {
      onRequestLogin()
      return
    }
    setIsSubmittingReview(true)
    setReviewMessage('')
    try {
      await apiRequest<{ ok: true }>(`/api/products/${encodeURIComponent(product.slug)}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ rating: reviewRating, comment: reviewComment }),
      })
      const { reviews: updatedReviews } = await apiRequest<{ reviews: ProductReview[] }>(`/api/products/${encodeURIComponent(product.slug)}/reviews`)
      setReviewResult({ slug: product.slug, reviews: updatedReviews })
      setReviewComment('')
      setReviewMessage('Gracias por compartir tu experiencia.')
    } catch (requestError) {
      setReviewMessage(requestError instanceof Error ? requestError.message : 'No se pudo publicar la reseña.')
    } finally {
      setIsSubmittingReview(false)
    }
  }

  const reviews = reviewResult?.slug === product.slug ? reviewResult.reviews : []
  const isLoadingReviews = reviewResult?.slug !== product.slug
  const averageRating = reviews.length ? reviews.reduce((total, review) => total + review.rating, 0) / reviews.length : null

  const currentView = views[selectedView] ?? views[0]

  return (
    <section className="product-detail" aria-labelledby="product-detail-title">
      <div className="product-detail__breadcrumb"><button type="button" onClick={onBack}>← Volver a la tienda</button><span aria-hidden="true">/</span><span>{product.name}</span></div>
      <div className="product-detail__layout">
        <div className="product-detail__gallery">
          <div
            className={`product-detail__main-image${zoomOrigin ? ' is-zooming' : ''}`}
            onMouseEnter={() => setIsGalleryHovering(true)}
            onMouseLeave={() => { setIsGalleryHovering(false); setZoomOrigin(null) }}
            onMouseMove={(event) => {
              if (!zoomOrigin) return
              const box = event.currentTarget.getBoundingClientRect()
              setZoomOrigin(`${((event.clientX - box.left) / box.width) * 100}% ${((event.clientY - box.top) / box.height) * 100}%`)
            }}
            onClick={(event) => {
              if (zoomOrigin) { setZoomOrigin(null); return }
              const box = event.currentTarget.getBoundingClientRect()
              setZoomOrigin(`${((event.clientX - box.left) / box.width) * 100}% ${((event.clientY - box.top) / box.height) * 100}%`)
            }}
            title="Clic para ampliar"
          >
            <img key={currentView?.src ?? getProductImage(product)} src={currentView?.src ?? getProductImage(product)} alt={currentView?.alt ?? product.alt} style={zoomOrigin ? { transformOrigin: zoomOrigin } : undefined} />
          </div>
          <div className="product-detail__views" role="group" aria-label={`Vistas de ${product.name}`}>
            {views.map((view, index) => <button className={selectedView === index ? 'is-active' : ''} key={`${view.label}-${index}`} type="button" onClick={() => onViewChange(index)} aria-label={`Ver ${view.label}`} aria-pressed={selectedView === index}><img src={view.src} alt="" /></button>)}
          </div>
        </div>
        <div className="product-detail__info">
          <p className="eyebrow">UnFocus · Diseño original</p>
          <h1 id="product-detail-title">{product.name}</h1>
          <p className="product-detail__price"><PriceTag product={product} currency={currency} usdArsRate={usdArsRate} /></p>
          <p className="product-detail__description">{product.description}</p>
          <div className="product-detail__story"><h2>Sobre el diseño</h2><p>{product.designDescription}</p></div>
          {product.isGiftCard ? <p className="product-detail__gift-note">Sin vencimiento. El código llega por correo apenas se confirma el pago y se canjea en el checkout, por partes si quieres.</p> : <dl className="product-detail__specs"><div><dt>Composición</dt><dd>{product.composition}</dd></div><div><dt>Tallas disponibles</dt><dd>XS–3XL</dd></div><div><dt>Estampado</dt><dd>Frente y espalda</dd></div></dl>}
          {product.isGiftCard ? (
            <div className="product-detail__size">
              <div className="product-detail__size-heading"><span id="product-size-label">Elige el monto</span></div>
              <div className="product-detail__size-options product-detail__amount-options" role="group" aria-labelledby="product-size-label">
                {giftCardAmounts.map((amount) => (
                  <button className={selectedSize === String(amount) ? 'is-active' : ''} key={amount} type="button" onClick={() => onSizeChange(String(amount))} aria-pressed={selectedSize === String(amount)}><span><strong>{formatPrice(amount, currency, usdArsRate)}</strong></span></button>
                ))}
              </div>
              <label className="product-detail__custom-amount"><span>O escribe otro monto (ARS, entre {giftCardMinimum.toLocaleString('es-AR')} y {giftCardMaximum.toLocaleString('es-AR')})</span>
                <input type="number" inputMode="numeric" min={giftCardMinimum} max={giftCardMaximum} step="1" value={giftCardAmounts.includes(Number(selectedSize)) ? '' : selectedSize} onChange={(event) => onSizeChange(event.target.value)} placeholder="Ej. 85000" />
              </label>
              {!isValidGiftCardAmount(selectedSize) && <p className="product-detail__size-note" role="alert">El monto debe ser un número entero entre {giftCardMinimum.toLocaleString('es-AR')} y {giftCardMaximum.toLocaleString('es-AR')}.</p>}
            </div>
          ) : (
          <div className="product-detail__size">
            <div className="product-detail__size-heading"><span id="product-size-label">Elige tu talle</span><details className="product-size-guide">
              <summary>Guía de talles</summary>
              <div className="product-size-guide__panel">
                <table><thead><tr><th>Talle</th><th>Argentina*</th><th>Ancho pecho</th><th>Largo</th></tr></thead><tbody>{sizes.map((size) => <tr key={size}><td>{size}</td><td>{argentineSizeEquivalents[size]}</td><td>{garmentMeasurements[size].chest} cm</td><td>{garmentMeasurements[size].length} cm</td></tr>)}</tbody></table>
                <p>* Equivalencia orientativa; el calce puede variar según el corte. Medidas de la prenda apoyada en plano (ancho de pecho de axila a axila, largo desde el hombro); puede haber ±2 cm de diferencia. Si estás entre dos talles, elige el mayor para un calce más holgado.</p>
              </div>
            </details></div>
            <div className="product-detail__size-options" role="group" aria-labelledby="product-size-label">
              {sizes.map((size) => {
                const outOfStock = getStockForSize(product, size) <= 0
                return (
                  <button className={selectedSize === size ? 'is-active' : ''} key={size} type="button" onClick={() => onSizeChange(size)} disabled={outOfStock} aria-pressed={selectedSize === size}>
                    <span><strong>{size}</strong> <small>{argentineSizeEquivalents[size]}</small></span>
                    {outOfStock && <small className="product-detail__size-stock">Sin stock</small>}
                  </button>
                )
              })}
            </div>
            <p className="product-detail__size-note">La equivalencia puede variar según el calce de la prenda.</p>
          </div>
          )}
          <button className="button button--coral product-detail__add" type="button" onClick={onAddToCart} disabled={getStockForSize(product, selectedSize) <= 0 || (product.isGiftCard === true && !isValidGiftCardAmount(selectedSize))}>Añadir a la bolsa <ShoppingBag size={17} aria-hidden="true" /></button>
          <p className="product-detail__note">¿Necesitas ayuda para elegir? <button type="button" onClick={onOpenContact}>Escríbenos</button></p>
        </div>
      </div>
      <section className="product-reviews" aria-labelledby="product-reviews-title">
        <div className="product-reviews__heading">
          <div><p className="eyebrow">Experiencias reales</p><h2 id="product-reviews-title">Reseñas</h2></div>
          <div className="product-reviews__average" aria-label={averageRating ? `Promedio ${averageRating.toFixed(1)} de 5, ${reviews.length} reseñas` : 'Aún no hay reseñas'}>
            {averageRating ? <><Star size={16} fill="currentColor" aria-hidden="true" /><strong>{averageRating.toFixed(1)}</strong><span>({reviews.length})</span></> : <span>{isLoadingReviews ? 'Cargando…' : 'Aún sin reseñas'}</span>}
          </div>
        </div>
        {currentUser ? (
          <form className="product-review-form" onSubmit={submitReview}>
            <label className="product-review-form__rating"><span>Tu valoración</span><span role="group" aria-label="Puntuación de 1 a 5">
              {[1, 2, 3, 4, 5].map((rating) => <button className={rating <= reviewRating ? 'is-selected' : ''} key={rating} type="button" onClick={() => setReviewRating(rating)} aria-label={`${rating} ${rating === 1 ? 'estrella' : 'estrellas'}`} aria-pressed={reviewRating === rating}><Star size={19} fill={rating <= reviewRating ? 'currentColor' : 'none'} aria-hidden="true" /></button>)}
            </span></label>
            <label className="product-review-form__comment"><span>Cuéntanos cómo te resultó</span><textarea required minLength={10} maxLength={500} rows={3} value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder="Ajuste, comodidad y experiencia de uso…" /></label>
            <button className="button button--coral" type="submit" disabled={isSubmittingReview || reviewComment.trim().length < 10}>{isSubmittingReview ? 'Publicando…' : 'Publicar reseña'}</button>
          </form>
        ) : <p className="product-reviews__login">Inicia sesión para dejar tu reseña. <button type="button" onClick={onRequestLogin}>Iniciar sesión</button></p>}
        {reviewMessage && <p className="product-reviews__message" role="status">{reviewMessage}</p>}
        <div className="product-review-list">
          {reviews.map((review) => (
            <article className="product-review" key={review.id}>
              <div className="product-review__meta"><strong>{review.userName}</strong><time dateTime={review.createdAt}>{new Date(`${review.createdAt.replace(' ', 'T')}Z`).toLocaleDateString('es-AR')}</time></div>
              <div className="product-review__stars" aria-label={`${review.rating} de 5 estrellas`}>{Array.from({ length: 5 }, (_, index) => <Star key={index} size={13} fill={index < review.rating ? 'currentColor' : 'none'} aria-hidden="true" />)}</div>
              <p>{review.comment}</p>
            </article>
          ))}
          {!isLoadingReviews && reviews.length === 0 && <p className="product-review-list__empty">Sé la primera persona en compartir su experiencia.</p>}
        </div>
      </section>
      {relatedProducts.length > 0 && (
        <section className="related-products" aria-labelledby="related-products-title">
          <div className="related-products__heading"><p className="eyebrow">Más de UnFocus</p><h2 id="related-products-title">{relatedTitle}</h2></div>
          <div className="related-products__grid">
            {relatedProducts.map((relatedProduct) => (
              <article className="related-product" key={relatedProduct.id}>
                <button className="related-product__image" type="button" onClick={() => onSelectRelated(relatedProduct)} aria-label={`Ver ${relatedProduct.name}`}><img src={getProductImage(relatedProduct)} alt={relatedProduct.gallery?.[0]?.alt ?? relatedProduct.alt} loading="lazy" /></button>
                <div className="related-product__details"><p className="product-card__category">{relatedProduct.category}</p><h3><button type="button" onClick={() => onSelectRelated(relatedProduct)}>{relatedProduct.name}</button></h3><span><PriceTag product={relatedProduct} currency={currency} usdArsRate={usdArsRate} /></span></div>
                <button className="related-product__link" type="button" onClick={() => onSelectRelated(relatedProduct)}>Ver producto <ArrowRight size={15} aria-hidden="true" /></button>
              </article>
            ))}
          </div>
        </section>
      )}
    </section>
  )
}

type ContactPageProps = {
  onBack: () => void
}

function ContactPage({ onBack }: ContactPageProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; isEmailSent?: boolean; isError?: boolean } | null>(null)

  const submitContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setFeedback(null)
    const form = event.currentTarget
    const formData = new FormData(form)
    try {
      const result = await apiRequest<{ message: string; emailSent: boolean }>('/api/contact', {
        method: 'POST',
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          subject: formData.get('subject'),
          message: formData.get('message'),
        }),
      })
      form.reset()
      setFeedback({ message: result.message, isEmailSent: result.emailSent })
    } catch (requestError) {
      setFeedback({ message: requestError instanceof Error ? requestError.message : 'No se pudo enviar el mensaje.', isError: true })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="contact-page" aria-labelledby="contact-title">
      <button className="contact-page__back" type="button" onClick={onBack}>← Volver a la tienda</button>
      <div className="contact-page__layout">
        <header className="contact-page__intro"><p className="eyebrow">UnFocus · Estamos para ayudarte</p><h1 id="contact-title">Hablemos.</h1><p>Dejanos tu consulta y el equipo de UnFocus te responderá por correo.</p></header>
        <form className="contact-form" onSubmit={submitContact}>
          <label><span>Nombre</span><input name="name" required minLength={2} maxLength={80} autoComplete="name" placeholder="Tu nombre" /></label>
          <label><span>Correo electrónico</span><input name="email" type="email" required maxLength={254} autoComplete="email" placeholder="hola@ejemplo.com" /></label>
          <label><span>Asunto</span><input name="subject" required minLength={3} maxLength={120} placeholder="¿En qué podemos ayudarte?" /></label>
          <label><span>Mensaje</span><textarea name="message" required minLength={10} maxLength={4000} rows={6} placeholder="Escribe tu consulta…" /></label>
          {feedback && <p className={`contact-form__feedback${feedback.isError ? ' is-error' : feedback.isEmailSent ? ' is-sent' : ''}`} role="status">{feedback.message}</p>}
          <button className="button button--coral" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Enviando…' : 'Enviar mensaje'} <Send size={16} aria-hidden="true" /></button>
        </form>
      </div>
    </section>
  )
}

type ProductCardProps = {
  product: Product
  index: number
  isFavorite: boolean
  selectedSize: string
  currency: DisplayCurrency
  usdArsRate: number | null
  onOpenProduct: (product: Product) => void
  onToggleFavorite: (product: Product) => void
  onAddToCart: (product: Product) => void
  onSizeChange: (size: string) => void
}

function ProductCard({ product, index, isFavorite, selectedSize, currency, usdArsRate, onOpenProduct, onToggleFavorite, onAddToCart, onSizeChange }: ProductCardProps) {
  const [isHoveringImage, setIsHoveringImage] = useState(false)
  const [viewIndex, setViewIndex] = useState(0)
  const gallery = product.gallery?.length ? product.gallery : [{ src: getProductImage(product), alt: product.alt, label: product.name }]
  const viewCount = gallery.length
  const slides = viewCount > 1 ? [...gallery, gallery[0]] : gallery
  const [isResettingCarousel, setIsResettingCarousel] = useState(false)

  useEffect(() => {
    if (!isHoveringImage || viewCount <= 1) return

    const timer = window.setInterval(() => {
      setViewIndex((current) => current + 1)
    }, 3000)

    return () => window.clearInterval(timer)
  }, [isHoveringImage, viewCount])

  useEffect(() => {
    if (viewIndex !== viewCount || viewCount <= 1) return

    const timer = window.setTimeout(() => {
      setIsResettingCarousel(true)
      setViewIndex(0)
      window.requestAnimationFrame(() => setIsResettingCarousel(false))
    }, 560)

    return () => window.clearTimeout(timer)
  }, [viewIndex, viewCount])

  const resetCarousel = () => {
    setIsHoveringImage(false)
    setIsResettingCarousel(true)
    setViewIndex(0)
    window.requestAnimationFrame(() => setIsResettingCarousel(false))
  }

  return (
    <article className="product-card" style={{ animationDelay: `${index * 45}ms` }}>
      <div
        className={`product-card__media${product.gallery ? ' product-card__media--design' : ''}`}
        onMouseEnter={() => setIsHoveringImage(true)}
        onMouseLeave={resetCarousel}
      >
        <button className="product-card__image-link" type="button" onClick={() => onOpenProduct(product)} aria-label={`Ver detalles de ${product.name}`}>
          <span className="product-card__image-track" style={{ transform: `translateX(-${viewIndex * 100}%)`, transition: isResettingCarousel ? 'none' : undefined }}>
            {slides.map((view, slideIndex) => <img key={`${slideIndex}-${view.src}`} src={view.src} alt={view.alt} loading="lazy" />)}
          </span>
        </button>
        {product.badge && product.badge !== 'Diseño UnFocus' && <span className="product-badge">{product.name}</span>}
        <button className={`favorite-button${isFavorite ? ' is-favorite' : ''}`} type="button" onClick={() => onToggleFavorite(product)} aria-label={isFavorite ? `Quitar ${product.name} de favoritos` : `Guardar ${product.name} en favoritos`} aria-pressed={isFavorite}><Heart size={18} strokeWidth={1.8} fill={isFavorite ? 'currentColor' : 'none'} aria-hidden="true" /></button>
        <button className="quick-add" type="button" onClick={() => onAddToCart(product)} aria-label={`Añadir ${product.name} a la bolsa`}><Plus size={19} strokeWidth={1.8} aria-hidden="true" /></button>
      </div>
      <div className="product-card__details">
        <div>
          <p className="product-card__category">{product.category}</p>
          <h3><button className="product-title-link" type="button" onClick={() => onOpenProduct(product)}><span className="product-card__title-stroke">{product.name}</span></button></h3>
          <div className="product-feature-list"><span>{product.composition}</span></div>
          <label className="product-size"><span>{product.isGiftCard ? 'Monto' : 'Talla'}</span><select value={selectedSize} onChange={(event) => onSizeChange(event.target.value)} aria-label={`${product.isGiftCard ? 'Monto' : 'Talla'} para ${product.name}`}>{product.isGiftCard ? giftCardAmounts.map((amount) => <option key={amount} value={String(amount)}>{formatPrice(amount, currency, usdArsRate)}</option>) : sizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
          <span className="product-card__price">{product.isGiftCard ? `Desde ${formatPrice(product.price, currency, usdArsRate)}` : <PriceTag product={product} currency={currency} usdArsRate={usdArsRate} />}</span>
        </div>
      </div>
    </article>
  )
}

const readLegalPage = (): LegalPageKey | null => {
  const value = new URLSearchParams(window.location.search).get('legal')
  return legalPageKeys.find((key) => key === value) ?? null
}

const recentlyViewedKey = 'unfocus-recently-viewed'
const readRecentlyViewed = (): string[] => {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(recentlyViewedKey) ?? '[]')
    const history = Array.isArray(stored) ? stored.filter((slug): slug is string => typeof slug === 'string') : []
    const current = new URLSearchParams(window.location.search).get('producto')
    return current ? [current, ...history.filter((slug) => slug !== current)].slice(0, 12) : history
  } catch {
    return []
  }
}

function App() {
  const [products, setProducts] = useState<Product[]>(() => initialProducts.map(normalizeProductFacets))
  const [currentUser, setCurrentUser] = useState<AccountUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [isAccountPage, setIsAccountPage] = useState(() => new URLSearchParams(window.location.search).get('cuenta') === '1')
  const [isAdminPage, setIsAdminPage] = useState(() => new URLSearchParams(window.location.search).get('admin') === '1')
  const [isContactPage, setIsContactPage] = useState(() => new URLSearchParams(window.location.search).get('contacto') === '1')
  const [legalPage, setLegalPage] = useState<LegalPageKey | null>(readLegalPage)
  const [storeConfig, setStoreConfig] = useState<StoreConfig | null>(null)
  const [recentSlugs, setRecentSlugs] = useState<string[]>(readRecentlyViewed)
  const [recommendationSeed] = useState(() => Math.random() * 1000 + 1)

  const rememberProduct = (slug: string | null) => {
    if (!slug) return
    setRecentSlugs((current) => {
      const next = [slug, ...current.filter((item) => item !== slug)].slice(0, 12)
      window.localStorage.setItem(recentlyViewedKey, JSON.stringify(next))
      return next
    })
  }
  const [checkoutStep, setCheckoutStep] = useState<'bag' | 'delivery'>('bag')
  const [isCheckingOut, setIsCheckingOut] = useState(false)
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('ARS')
  const [usdArsRate, setUsdArsRate] = useState<number | null>(null)
  const [exchangeSource, setExchangeSource] = useState<string | null>(null)
  const cartDrawerRef = useRef<HTMLElement>(null)
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('Todo')
  const [cutFilter, setCutFilter] = useState<GarmentCut | 'Todas'>('Todas')
  const [audienceFilter, setAudienceFilter] = useState<ProductAudience | 'Todos'>('Todos')
  const [genderFilter, setGenderFilter] = useState<ProductGender | 'Todos'>('Todos')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [sortOrder, setSortOrder] = useState('featured')
  const [selectedSizes, setSelectedSizes] = useState<Record<number, string>>({})
  const [selectedProductViews, setSelectedProductViews] = useState<Record<number, number>>({})
  const [selectedProductSlug, setSelectedProductSlug] = useState(() => new URLSearchParams(window.location.search).get('producto'))
  const [cart, setCart] = useState<Record<string, number>>({})
  const [favorites, setFavorites] = useState<number[]>([])
  const [notifications, setNotifications] = useState<AccountNotification[]>([])
  const [isNotificationMenuOpen, setIsNotificationMenuOpen] = useState(false)
  const [isCartOpen, setIsCartOpen] = useState(false)
  const notificationMenuRef = useRef<HTMLDivElement>(null)
  const notificationsSeenInView = useRef(new Set<number>())
  const [notice, setNotice] = useState(() => {
    const paymentStatus = new URLSearchParams(window.location.search).get('payment')
    if (paymentStatus === 'success') return 'Compra confirmada. Gracias por tu pedido.'
    if (paymentStatus === 'pending') return 'Tu pago está en revisión. Te avisaremos cuando quede confirmado.'
    if (paymentStatus === 'failure') return 'No se pudo completar el pago. Puedes intentarlo nuevamente desde tu cuenta.'
    return ''
  })

  useEffect(() => {
    let isCurrent = true
    apiRequest<{ products: Product[] }>('/api/products')
      .then(({ products: apiProducts }) => { if (isCurrent) setProducts(apiProducts.map(normalizeProductFacets)) })
      .catch(() => undefined)
    return () => { isCurrent = false }
  }, [])

  useEffect(() => {
    let isCurrent = true
    const loadSession = async () => {
      try {
        const { user } = await apiRequest<{ user: AccountUser | null }>('/api/auth/me')
        if (!isCurrent) return
        setCurrentUser(user)
        if (user) {
          const summary = await apiRequest<AccountSummary>('/api/account/summary')
          if (isCurrent) setFavorites(summary.favorites.map((product) => product.id))
        }
      } catch {
        if (isCurrent) setCurrentUser(null)
      } finally {
        if (isCurrent) setAuthLoading(false)
      }
    }
    void loadSession()
    return () => { isCurrent = false }
  }, [])

  useEffect(() => {
    if (!currentUser) return
    let isCurrent = true
    apiRequest<{ notifications: AccountNotification[] }>('/api/account/notifications')
      .then(({ notifications: userNotifications }) => {
        if (isCurrent) setNotifications(userNotifications)
      })
      .catch(() => undefined)
    return () => { isCurrent = false }
  }, [currentUser])

  useEffect(() => {
    if (!currentUser || (!isAccountPage && !isNotificationMenuOpen)) return
    const visibleUnread = notifications.filter((notification) => !notification.isRead && !notificationsSeenInView.current.has(notification.id))
    if (!visibleUnread.length) return
    visibleUnread.forEach((notification) => notificationsSeenInView.current.add(notification.id))

    void Promise.all(visibleUnread.map((notification) => apiRequest(`/api/account/notifications/${notification.id}/read`, { method: 'PATCH' })))
      .then(() => {
        const visibleIds = new Set(visibleUnread.map((notification) => notification.id))
        setNotifications((current) => current.map((notification) => visibleIds.has(notification.id) ? { ...notification, isRead: true } : notification))
      })
      .catch(() => visibleUnread.forEach((notification) => notificationsSeenInView.current.delete(notification.id)))
  }, [currentUser, isAccountPage, isNotificationMenuOpen, notifications])

  useEffect(() => {
    if (!isNotificationMenuOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!notificationMenuRef.current?.contains(event.target as Node)) setIsNotificationMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsNotificationMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isNotificationMenuOpen])

  // Diálogo de la bolsa: foco dentro, Escape para cerrar, Tab atrapado y foco devuelto al abrirlo (WCAG 2.1.2 / 2.4.3).
  useEffect(() => {
    if (!isCartOpen) return
    const opener = document.activeElement as HTMLElement | null
    const drawer = cartDrawerRef.current
    drawer?.focus()
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setIsCartOpen(false); setCheckoutStep('bag'); return }
      if (event.key !== 'Tab' || !drawer) return
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeys)
    return () => { document.removeEventListener('keydown', handleKeys); opener?.focus() }
  }, [isCartOpen])

  useEffect(() => {
    let isCurrent = true
    apiRequest<StoreConfig>('/api/config')
      .then((config) => {
        if (!isCurrent) return
        setStoreConfig(config)
        setUsdArsRate(config.usdArsRate)
        setExchangeSource(config.exchangeSource)
        if (window.localStorage.getItem('unfocus-display-currency') === 'USD' && config.usdArsRate) setDisplayCurrency('USD')
      })
      .catch(() => undefined)
    return () => { isCurrent = false }
  }, [])

  const showNotice = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2600)
  }

  useEffect(() => {
    const syncProductRoute = () => {
      const searchParams = new URLSearchParams(window.location.search)
      setSelectedProductSlug(searchParams.get('producto'))
      rememberProduct(searchParams.get('producto'))
      setIsAdminPage(searchParams.get('admin') === '1')
      setIsAccountPage(searchParams.get('cuenta') === '1')
      setIsContactPage(searchParams.get('contacto') === '1')
      setLegalPage(readLegalPage())
    }
    window.addEventListener('popstate', syncProductRoute)
    return () => window.removeEventListener('popstate', syncProductRoute)
  }, [])

  useEffect(() => {
    const product = products.find((item) => item.slug === selectedProductSlug)
    document.title = isAdminPage ? 'Panel de control | UnFocus' : isAccountPage ? 'Mi cuenta | UnFocus' : isContactPage ? 'Contacto | UnFocus' : legalPage ? `${legalPageTitles[legalPage]} | UnFocus` : product ? `${product.name} | UnFocus` : 'UnFocus Mall — Seeking clarity. Embrace yourself.'
  }, [isAccountPage, isAdminPage, isContactPage, legalPage, products, selectedProductSlug])

  const visibleProducts = products
    .filter((product) => {
      const matchesCategory = activeCategory === 'Todo' || product.category === activeCategory
      const facets = getProductFacets(product.features)
      const matchesCut = cutFilter === 'Todas' || facets.cut === cutFilter
      const matchesAudience = audienceFilter === 'Todos' || facets.audience === audienceFilter
      const matchesGender = genderFilter === 'Todos' || facets.gender === genderFilter
      const matchesSearch = `${product.name} ${product.category} ${product.features.join(' ')}`.toLocaleLowerCase('es').includes(searchQuery.toLocaleLowerCase('es').trim())
      return matchesCategory && matchesCut && matchesAudience && matchesGender && matchesSearch
    })
    .sort((first, second) => {
      if (sortOrder === 'price-asc') return getSalePrice(first) - getSalePrice(second)
      if (sortOrder === 'price-desc') return getSalePrice(second) - getSalePrice(first)
      if (sortOrder === 'newest') return (second.createdAt ?? '').localeCompare(first.createdAt ?? '') || second.id - first.id
      if (sortOrder === 'popular') return (second.sold ?? 0) - (first.sold ?? 0) || first.id - second.id
      return first.id - second.id
    })
  const activeFilterCount = Number(cutFilter !== 'Todas') + Number(audienceFilter !== 'Todos') + Number(genderFilter !== 'Todos')

  const cartItems = Object.entries(cart).flatMap(([cartKey, quantity]) => {
    const [productId, size] = cartKey.split(':')
    const product = products.find((item) => item.id === Number(productId))
    return product ? [{ ...product, price: product.isGiftCard ? Number(size) : getSalePrice(product), size, quantity, cartKey }] : []
  })
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0)
  const cartTotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const activeProduct = products.find((product) => product.slug === selectedProductSlug)
  const activeSlug = activeProduct?.slug

  // Vistos recientemente (sin el producto actual); si no hay historial, productos al azar (también sin el actual).
  const recentProducts = recentSlugs.flatMap((slug) => products.filter((item) => item.slug === slug && item.slug !== activeSlug)).slice(0, 4)
  const hasRecentlyViewed = recentProducts.length > 0
  const relatedProducts = hasRecentlyViewed
    ? recentProducts
    : products.filter((item) => item.id !== activeProduct?.id).sort((first, second) => ((first.id * recommendationSeed * 9301) % 1) - ((second.id * recommendationSeed * 9301) % 1)).slice(0, 4)

  const addToCart = (product: Product) => {
    const size = selectedSizes[product.id] ?? getDefaultSize(product)
    if (product.isGiftCard && !isValidGiftCardAmount(size)) {
      showNotice('Elige un monto válido para la tarjeta de regalo.')
      return
    }
    if (getStockForSize(product, size) <= 0) {
      showNotice(`La talla ${size} de ${product.name} no tiene stock disponible.`)
      return
    }
    const cartKey = `${product.id}:${size}`
    setCart((current) => ({ ...current, [cartKey]: (current[cartKey] ?? 0) + 1 }))
    showNotice(`${product.name}, talla ${size}, añadido a tu bolsa`)
  }

  const changeQuantity = (cartKey: string, change: number) => {
    setCart((current) => {
      const nextQuantity = (current[cartKey] ?? 0) + change
      const nextCart = { ...current }
      if (nextQuantity <= 0) delete nextCart[cartKey]
      else nextCart[cartKey] = nextQuantity
      return nextCart
    })
  }

  const navigateToProduct = (product: Product | null) => {
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.delete('admin')
    nextUrl.searchParams.delete('cuenta')
    nextUrl.searchParams.delete('contacto')
    if (product) nextUrl.searchParams.set('producto', product.slug)
    else nextUrl.searchParams.delete('producto')
    nextUrl.searchParams.delete('legal')
    window.history.pushState({}, '', nextUrl)
    setIsAdminPage(false)
    setIsAccountPage(false)
    setIsContactPage(false)
    setSelectedProductSlug(product?.slug ?? null)
    rememberProduct(product?.slug ?? null)
    setLegalPage(null)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const navigateToAdmin = () => {
    if (!currentUser?.isAdmin) {
      navigateToAccount()
      return
    }
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.delete('producto')
    nextUrl.searchParams.delete('cuenta')
    nextUrl.searchParams.delete('contacto')
    nextUrl.searchParams.set('admin', '1')
    nextUrl.searchParams.delete('legal')
    window.history.pushState({}, '', nextUrl)
    setSelectedProductSlug(null)
    setIsAccountPage(false)
    setIsContactPage(false)
    setIsAdminPage(true)
    setLegalPage(null)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const navigateToContact = () => {
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.delete('producto')
    nextUrl.searchParams.delete('admin')
    nextUrl.searchParams.delete('cuenta')
    nextUrl.searchParams.set('contacto', '1')
    nextUrl.searchParams.delete('legal')
    window.history.pushState({}, '', nextUrl)
    setSelectedProductSlug(null)
    setIsAdminPage(false)
    setIsAccountPage(false)
    setIsContactPage(true)
    setLegalPage(null)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const navigateToLegal = (page: LegalPageKey) => {
    const nextUrl = new URL(window.location.href)
    for (const param of ['producto', 'admin', 'cuenta', 'contacto']) nextUrl.searchParams.delete(param)
    nextUrl.searchParams.set('legal', page)
    window.history.pushState({}, '', nextUrl)
    setSelectedProductSlug(null)
    setIsAdminPage(false)
    setIsAccountPage(false)
    setIsContactPage(false)
    setLegalPage(page)
    setIsCartOpen(false)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const navigateToStore = () => {
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.delete('producto')
    nextUrl.searchParams.delete('admin')
    nextUrl.searchParams.delete('cuenta')
    nextUrl.searchParams.delete('contacto')
    nextUrl.searchParams.delete('legal')
    window.history.pushState({}, '', nextUrl)
    setSelectedProductSlug(null)
    setIsAdminPage(false)
    setIsAccountPage(false)
    setIsContactPage(false)
    setLegalPage(null)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const navigateToAccount = () => {
    const nextUrl = new URL(window.location.href)
    nextUrl.searchParams.delete('producto')
    nextUrl.searchParams.delete('admin')
    nextUrl.searchParams.delete('contacto')
    nextUrl.searchParams.set('cuenta', '1')
    nextUrl.searchParams.delete('legal')
    window.history.pushState({}, '', nextUrl)
    setSelectedProductSlug(null)
    setIsAdminPage(false)
    setIsAccountPage(true)
    setIsContactPage(false)
    setLegalPage(null)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const saveProduct = async (product: Product) => {
    const existing = products.some((item) => item.id === product.id)
    const response = await apiRequest<{ product: Product }>(existing ? `/api/admin/products/${product.id}` : '/api/admin/products', {
      method: existing ? 'PUT' : 'POST',
      body: JSON.stringify(product),
    })
    setProducts((current) => existing ? current.map((item) => item.id === response.product.id ? response.product : item) : [...current, response.product])
  }

  const deleteProduct = async (productId: number) => {
    await apiRequest<{ ok: boolean }>(`/api/admin/products/${productId}`, { method: 'DELETE' })
    setProducts((current) => current.filter((product) => product.id !== productId))
  }

  const handleAuthenticated = (user: AccountUser) => {
    notificationsSeenInView.current.clear()
    setNotifications([])
    setCurrentUser(user)
    void apiRequest<AccountSummary>('/api/account/summary').then((summary) => setFavorites(summary.favorites.map((product) => product.id))).catch(() => setFavorites([]))
  }

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' })
    } finally {
      setCurrentUser(null)
      setFavorites([])
      setNotifications([])
      notificationsSeenInView.current.clear()
      setIsNotificationMenuOpen(false)
      navigateToStore()
    }
  }

  const markNotificationRead = async (notificationId: number) => {
    try {
      await apiRequest(`/api/account/notifications/${notificationId}/read`, { method: 'PATCH' })
      setNotifications((current) => current.filter((notification) => notification.id !== notificationId))
    } catch (requestError) {
      showNotice(requestError instanceof Error ? requestError.message : 'No se pudo actualizar la notificación.')
    }
  }

  const toggleDisplayCurrency = (value: string) => {
    const nextCurrency: DisplayCurrency = value === 'USD' && usdArsRate ? 'USD' : 'ARS'
    setDisplayCurrency(nextCurrency)
    window.localStorage.setItem('unfocus-display-currency', nextCurrency)
  }

  const toggleFavorite = async (product: Product) => {
    const wasFavorite = favorites.includes(product.id)
    setFavorites((current) => wasFavorite ? current.filter((id) => id !== product.id) : [...current, product.id])
    if (!currentUser) {
      showNotice('Inicia sesión para mantener tus favoritos en tu cuenta.')
      return
    }
    try {
      await apiRequest(`/api/account/favorites/${product.id}`, { method: wasFavorite ? 'DELETE' : 'POST' })
      showNotice(wasFavorite ? 'Prenda eliminada de tus favoritos' : 'Prenda guardada en tu cuenta')
    } catch (requestError) {
      setFavorites((current) => wasFavorite ? [...current, product.id] : current.filter((id) => id !== product.id))
      showNotice(requestError instanceof Error ? requestError.message : 'No se pudo guardar el favorito.')
    }
  }

  const startCheckout = () => {
    setCheckoutStep('delivery')
  }

  const handleCheckout = async ({ shipping, acceptTerms, paymentMethod, guest, couponCode, giftCardCode }: CheckoutPayload) => {
    setIsCheckingOut(true)
    try {
      if (paymentMethod === 'transfer') {
        const transferResult = await apiRequest<{ order: { reference: string } }>('/api/orders', {
          method: 'POST',
          body: JSON.stringify({ items: cartItems.map((item) => ({ productId: item.id, size: item.size, quantity: item.quantity })), shipping, acceptTerms, paymentMethod, guest, couponCode, giftCardCode }),
        })
        setCart({})
        setIsCartOpen(false)
        setCheckoutStep('bag')
        if (currentUser) navigateToAccount()
        showNotice(currentUser ? `Pedido ${transferResult.order.reference} registrado. Transfiere el importe con los datos de tu cuenta.` : `Pedido ${transferResult.order.reference} registrado. Te enviamos por correo los datos para transferir.`)
        return
      }
      const result = await apiRequest<{ order: { reference: string }; paymentUrl: string | null }>('/api/payments/create-preference', {
        method: 'POST',
        body: JSON.stringify({ items: cartItems.map((item) => ({ productId: item.id, size: item.size, quantity: item.quantity })), shipping, acceptTerms, guest, couponCode, giftCardCode }),
      })
      setCart({})
      setIsCartOpen(false)
      setCheckoutStep('bag')
      if (!result.paymentUrl) {
        if (currentUser) navigateToAccount()
        showNotice(`Pedido ${result.order.reference} confirmado. No hay nada que cobrar.`)
        return
      }
      window.location.assign(result.paymentUrl)
      showNotice(`Pedido ${result.order.reference} listo para pagar con Mercado Pago.`)
    } catch (requestError) {
      showNotice(requestError instanceof Error ? requestError.message : 'No se pudo registrar el pedido.')
    } finally {
      setIsCheckingOut(false)
    }
  }

  const handleNewsletter = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const email = (new FormData(form).get('newsletter-email') as string | null)?.trim() ?? ''
    if (!email) {
      showNotice('Escribe un correo válido para suscribirte.')
      return
    }
    try {
      const response = await apiRequest<{ message: string }>('/api/newsletter', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      form.reset()
      showNotice(response.message)
    } catch (requestError) {
      showNotice(requestError instanceof Error ? requestError.message : 'No se pudo completar la suscripción.')
    }
  }

  return (
    <div className="storefront">
      <a className="skip-link" href="#inicio">Saltar al contenido principal</a>
      <div className="announcement-bar">
        <span>Ropa cómoda. Información clara. Elige a tu ritmo.</span>
        <span className="announcement-bar__right">Precios en pesos argentinos · USD disponible</span>
      </div>

      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href={selectedProductSlug || isAdminPage || isAccountPage ? '/' : '#inicio'} aria-label="UnFocus, inicio"><span className="brand__logo-wrap"><span className="brand__reveal" aria-hidden="true"><span className="brand__highlight"><img className="brand__logo brand__logo--white" src={unfocusLogoWhite} alt="" /></span></span><img className="brand__logo" src={unfocusLogo} alt="UnFocus" /></span></a>
          <nav className="main-nav" aria-label="Navegación principal"><a href={selectedProductSlug || isAdminPage || isAccountPage || isContactPage ? '/#coleccion' : '#coleccion'}>Tienda</a><a href={selectedProductSlug || isAdminPage || isAccountPage || isContactPage ? '/#historia' : '#historia'}>Nuestra mirada</a><a href={selectedProductSlug || isAdminPage || isAccountPage || isContactPage ? '/#newsletter' : '#newsletter'}>Diario</a><a href="?contacto=1" onClick={(event) => { event.preventDefault(); navigateToContact() }}>Contacto</a></nav>
          <div className="header-actions">
            <div className={`search-box${isSearchOpen ? ' is-open' : ''}`}>
              <Search className="search-box__icon" size={17} strokeWidth={1.8} aria-hidden="true" />
              <input type="search" placeholder="Buscar prendas" value={searchQuery} onChange={(event) => { setSearchQuery(event.target.value); document.getElementById('coleccion')?.scrollIntoView({ behavior: 'smooth' }) }} aria-label="Buscar prendas" />
              <button className="search-toggle" type="button" onClick={() => setIsSearchOpen((open) => !open)} aria-label={isSearchOpen ? 'Cerrar búsqueda' : 'Abrir búsqueda'} aria-expanded={isSearchOpen}><Search size={19} strokeWidth={1.8} aria-hidden="true" /></button>
            </div>
            <label className="currency-selector" title={exchangeSource ? `Cotización: ${exchangeSource}` : 'Tipo de cambio USD no disponible'}><select value={displayCurrency} onChange={(event) => toggleDisplayCurrency(event.target.value)} aria-label="Moneda de visualización"><option value="ARS">ARS $</option><option value="USD" disabled={!usdArsRate}>USD $</option></select></label>
            <button className="account-trigger" type="button" onClick={navigateToAccount} aria-label={currentUser ? 'Mi cuenta' : 'Iniciar sesión o crear cuenta'} title="Mi cuenta"><UserRound size={19} aria-hidden="true" /></button>
            {currentUser && <div className="notification-center" ref={notificationMenuRef}>
              <button className="notification-center__trigger" type="button" onClick={() => setIsNotificationMenuOpen((open) => !open)} aria-label={`Notificaciones, ${notifications.length} avisos`} aria-expanded={isNotificationMenuOpen} aria-controls="notification-menu">
                <Bell size={18} aria-hidden="true" />
                {notifications.length > 0 && <span className="notification-center__count">{notifications.length}</span>}
              </button>
              {isNotificationMenuOpen && <div className="notification-center__panel" id="notification-menu" role="dialog" aria-label="Notificaciones">
                <div className="notification-center__heading"><strong>Notificaciones</strong><span>{notifications.length}</span></div>
                {notifications.length ? <div className="notification-center__list">{notifications.map((notification) => (
                  <article className="notification-center__item" key={notification.id}>
                    <div><p>{notification.kind}</p><strong>{notification.title}</strong></div>
                    <span>{notification.message}</span>
                    <time>{new Date(`${notification.createdAt.replace(' ', 'T')}Z`).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}</time>
                    <button type="button" onClick={() => { void markNotificationRead(notification.id) }} aria-label={`Marcar como leída: ${notification.title}`}><Check size={14} aria-hidden="true" /> Marcar leída</button>
                  </article>
                ))}</div> : <p className="notification-center__empty">No tenés avisos nuevos.</p>}
              </div>}
            </div>}
            <button className="bag-trigger" type="button" onClick={() => setIsCartOpen(true)}> 
              <ShoppingBag size={19} strokeWidth={1.8} aria-hidden="true" /><span>Bolsa</span><span className="bag-count">{cartCount}<span className="visually-hidden"> artículos</span></span>
            </button>
          </div>
        </div>
      </header>

      <main id="inicio" tabIndex={-1}>
        {isAdminPage && currentUser?.isAdmin ? <ProductAdmin products={products} onSave={saveProduct} onDelete={deleteProduct} onClose={navigateToStore} /> : isAccountPage || isAdminPage ? (
          <AccountPanel user={currentUser} authLoading={authLoading} currency={displayCurrency} usdArsRate={usdArsRate} onAuthenticated={handleAuthenticated} onLogout={handleLogout} onOpenProduct={navigateToProduct} onOpenAdmin={navigateToAdmin} onToggleFavorite={toggleFavorite} />
        ) : legalPage ? <LegalPages page={legalPage} store={storeConfig?.store ?? null} onBack={navigateToStore} onOpenPage={navigateToLegal} onOpenContact={navigateToContact} /> : isContactPage ? <ContactPage onBack={navigateToStore} /> : activeProduct ? (
          <ProductDetail
            product={activeProduct}
            relatedProducts={relatedProducts}
            relatedTitle={hasRecentlyViewed ? 'Vistos recientemente' : 'También puede interesarte'}
            selectedSize={selectedSizes[activeProduct.id] ?? getDefaultSize(activeProduct)}
            selectedView={selectedProductViews[activeProduct.id] ?? 0}
            currentUser={currentUser}
            currency={displayCurrency}
            usdArsRate={usdArsRate}
            onBack={() => navigateToProduct(null)}
            onSelectRelated={navigateToProduct}
            onSizeChange={(size) => setSelectedSizes((current) => ({ ...current, [activeProduct.id]: size }))}
            onViewChange={(view) => setSelectedProductViews((current) => ({ ...current, [activeProduct.id]: view }))}
            onAddToCart={() => addToCart(activeProduct)}
            onRequestLogin={navigateToAccount}
            onOpenContact={navigateToContact}
          />
        ) : (
          <>
        <section className="hero" aria-labelledby="hero-title">
          <img className="hero__image" src={getProductImage(initialProducts[0], 1)} alt="Espalda de la camiseta Mind Unfiltered con su ilustración original" />
          <div className="hero__veil" />
          <div className="hero__content">
            <p className="eyebrow hero__eyebrow"><span /> Diseñada desde la experiencia neurodivergente</p>
            <h1 id="hero-title">Vístete para<br />sentirte <em>tú.</em></h1>
            <p className="hero__description">Prendas cómodas, información sensorial clara y espacio para elegir lo que te hace bien.</p>
            <a className="button button--coral" href="#coleccion">Explorar prendas <ArrowRight size={17} aria-hidden="true" /></a>
          </div>
          <div className="hero__caption"><span>UnFocus Mall</span><span>Seeking Clarity &amp; Embrace Yourself</span></div>
          <div className="hero__stamp" aria-hidden="true"><span>SÉ TÚ</span><span>A TU RITMO</span></div>
        </section>

        <section className="promise-strip" aria-label="Características de las prendas UnFocus">
          <div><span className="promise-dot promise-dot--blue" /> 100% algodón</div><div><span className="promise-dot promise-dot--red" /> Diseños originales</div><div><span className="promise-dot promise-dot--dark" /> Tallas XS–3XL</div>
        </section>

        <section className="manifesto-strip" aria-label="Manifiesto UnFocus">
          <span className="manifesto-strip__dots" aria-hidden="true" />
          <p>No hay límites para una mente que <em>piensa diferente.</em></p>
          <span className="manifesto-strip__signature">UnFocus · A tu ritmo</span>
        </section>

        <section className="collection-section" id="coleccion" aria-labelledby="collection-title">
          <div className="section-intro">
            <div><p className="eyebrow">Un armario a tu manera</p><h2 id="collection-title">Comodidad, en tus <em>propios términos.</em></h2></div>
            <p className="section-intro__aside">Cada cuerpo siente distinto.<br />Tu comodidad marca la pauta.</p>
          </div>
          <div className="collection-toolbar">
            <div className="category-tabs" role="group" aria-label="Filtrar por categoría">
              {categories.map((category) => <button className={`category-tab${activeCategory === category ? ' is-active' : ''}`} key={category} type="button" onClick={() => setActiveCategory(category)} aria-pressed={activeCategory === category}>{category}</button>)}
            </div>
            <div className="collection-toolbar__controls">
              <label className="sort-control"><span>Ordenar</span><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} aria-label="Ordenar productos"><option value="featured">Destacados</option><option value="newest">Novedades</option><option value="popular">Más vendidos</option><option value="price-asc">Precio: menor a mayor</option><option value="price-desc">Precio: mayor a menor</option></select></label>
              <details className="filter-menu">
                <summary className="filter-menu__trigger"><ListFilter size={14} aria-hidden="true" /><span>Filtrar</span>{activeFilterCount > 0 && <span className="filter-menu__count">{activeFilterCount}</span>}<ChevronDown className="filter-menu__chevron" size={14} aria-hidden="true" /></summary>
                <div className="filter-menu__panel" aria-label="Filtros de productos">
                  <div className="filter-menu__heading"><span>Filtrar prendas</span>
                    {(cutFilter !== 'Todas' || audienceFilter !== 'Todos' || genderFilter !== 'Todos') && <button type="button" onClick={() => { setCutFilter('Todas'); setAudienceFilter('Todos'); setGenderFilter('Todos') }}>Limpiar</button>}
                  </div>
                  <div className="product-filters">
                    <div className="product-filter-group">
                      <span>Corte y calce</span>
                      <div className="product-filter-options" role="group" aria-label="Filtrar por corte y calce">
                        <button className={`product-filter-option${cutFilter === 'Todas' ? ' is-active' : ''}`} type="button" onClick={() => setCutFilter('Todas')} aria-pressed={cutFilter === 'Todas'}>Todos</button>
                        {garmentCuts.map((cut) => <button className={`product-filter-option${cutFilter === cut ? ' is-active' : ''}`} key={cut} type="button" onClick={() => setCutFilter(cut)} aria-pressed={cutFilter === cut}>{cut}</button>)}
                      </div>
                    </div>
                    <div className="product-filter-group">
                      <span>Edad</span>
                      <div className="product-filter-options" role="group" aria-label="Filtrar por edad">
                        <button className={`product-filter-option${audienceFilter === 'Todos' ? ' is-active' : ''}`} type="button" onClick={() => setAudienceFilter('Todos')} aria-pressed={audienceFilter === 'Todos'}>Todas</button>
                        {productAudiences.map((audience) => <button className={`product-filter-option${audienceFilter === audience ? ' is-active' : ''}`} key={audience} type="button" onClick={() => setAudienceFilter(audience)} aria-pressed={audienceFilter === audience}>{audience}</button>)}
                      </div>
                    </div>
                    <div className="product-filter-group">
                      <span>Género</span>
                      <div className="product-filter-options" role="group" aria-label="Filtrar por género">
                        <button className={`product-filter-option${genderFilter === 'Todos' ? ' is-active' : ''}`} type="button" onClick={() => setGenderFilter('Todos')} aria-pressed={genderFilter === 'Todos'}>Todos</button>
                        {productGenders.map((gender) => <button className={`product-filter-option${genderFilter === gender ? ' is-active' : ''}`} key={gender} type="button" onClick={() => setGenderFilter(gender)} aria-pressed={genderFilter === gender}>{gender}</button>)}
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          </div>
          {visibleProducts.length > 0 ? (
            <div className="product-grid">
              {visibleProducts.map((product, index) => <ProductCard key={product.id} product={product} index={index} isFavorite={favorites.includes(product.id)} selectedSize={selectedSizes[product.id] ?? getDefaultSize(product)} currency={displayCurrency} usdArsRate={usdArsRate} onOpenProduct={navigateToProduct} onToggleFavorite={toggleFavorite} onAddToCart={addToCart} onSizeChange={(size) => setSelectedSizes((current) => ({ ...current, [product.id]: size }))} />)}
            </div>
          ) : (
            <div className="empty-results"><Search size={23} strokeWidth={1.5} aria-hidden="true" /><p>No encontramos prendas con esos filtros.</p><button type="button" onClick={() => { setSearchQuery(''); setActiveCategory('Todo'); setCutFilter('Todas'); setAudienceFilter('Todos'); setGenderFilter('Todos') }}>Ver todas las prendas</button></div>
          )}
          <div className="collection-footnote"><span>{visibleProducts.length} prendas</span><span>Comodidad descrita con claridad</span></div>
        </section>

        <section className="story-section" id="historia">
          <div className="story-image-wrap"><img src={getProductImage(initialProducts[1], 1)} alt="Espalda de la camiseta No Molestar con su diseño original" loading="lazy" /><span className="story-image-label">UNFOCUS · A TU RITMO</span></div>
          <div className="story-copy"><p className="eyebrow">La comodidad también es personal</p><h2>Tu forma de sentir<br />es <em>la medida.</em></h2><p>La textura, las costuras, el ajuste y las etiquetas importan. Por eso describimos cada prenda con claridad: para que puedas decidir cómo se sentirá antes de que llegue a casa. Sin reglas sobre cómo vestirte. Sin prisa.</p><a className="text-link" href="#coleccion">Encuentra tu comodidad <ArrowUpRight size={17} aria-hidden="true" /></a><span className="story-scribble" aria-hidden="true">sé tú, a tu ritmo</span></div>
        </section>

        <section className="newsletter-section" id="newsletter">
          <div className="newsletter-mark" aria-hidden="true"><Brain size={48} strokeWidth={1.5} /></div>
          <div className="newsletter-copy"><p className="eyebrow">Novedades con calma</p><h2>Un correo cuando<br />haya algo <em>nuevo.</em></h2></div>
          <form className="newsletter-form" onSubmit={handleNewsletter}><label htmlFor="newsletter-email">Tu correo electrónico</label><div className="newsletter-form__input"><input id="newsletter-email" name="newsletter-email" type="email" placeholder="hola@ejemplo.com" required /><button type="submit" aria-label="Recibir novedades"><ArrowRight size={19} aria-hidden="true" /></button></div><p>Sin ruido, solo novedades de UnFocus.</p></form>
        </section>
          </>
        )}
      </main>

      <footer className="site-footer">
        <a className="brand brand--footer" href={selectedProductSlug || isAdminPage || isAccountPage || isContactPage ? '/' : '#inicio'} aria-label="UnFocus, inicio"><span className="brand__logo-wrap"><span className="brand__reveal" aria-hidden="true"><span className="brand__highlight"><img className="brand__logo brand__logo--white" src={unfocusLogoWhite} alt="" /></span></span><img className="brand__logo" src={unfocusLogo} alt="UnFocus" /></span></a><span>Seeking clarity. Embrace yourself.</span>
        <div className="footer-links"><a href={selectedProductSlug || isAdminPage || isAccountPage || isContactPage ? '/#coleccion' : '#coleccion'}>Tienda</a><a href={selectedProductSlug || isAdminPage || isAccountPage || isContactPage ? '/#historia' : '#historia'}>Nuestra mirada</a><a href="?contacto=1" onClick={(event) => { event.preventDefault(); navigateToContact() }}>Contacto</a></div>
        <nav className="footer-legal" aria-label="Información legal">{legalPageKeys.map((key) => <a key={key} href={`?legal=${key}`} onClick={(event) => { event.preventDefault(); navigateToLegal(key) }}>{legalPageTitles[key]}</a>)}</nav>
        {storeConfig?.store.legalName && <p className="footer-store">{storeConfig.store.legalName}{storeConfig.store.taxId ? ` · CUIT ${storeConfig.store.taxId}` : '}{storeConfig.store.address ? ` · ${storeConfig.store.address}` : '}</p>}<span className="footer-copyright">© 2026 UnFocus</span>
      </footer>

      {notice && <div className="toast" role="status">{notice}</div>}

      {isCartOpen && (
        <div className="cart-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsCartOpen(false) }}>
          <aside className="cart-drawer" ref={cartDrawerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="cart-title">
            <div className="cart-header"><div><p className="eyebrow">Tu selección</p><h2 id="cart-title">La bolsa <span>({cartCount})</span></h2></div><button className="icon-button" type="button" onClick={() => { setIsCartOpen(false); setCheckoutStep('bag') }} aria-label="Cerrar bolsa"><X size={21} /></button></div>
            {cartItems.length > 0 && checkoutStep === 'delivery' ? (
              <CheckoutForm user={currentUser} subtotal={cartTotal} items={cartItems.map((item) => ({ productId: item.id, size: item.size, quantity: item.quantity }))} shipping={storeConfig?.shipping ?? null} transfer={storeConfig?.transfer ?? null} currency={displayCurrency} usdArsRate={usdArsRate} isSubmitting={isCheckingOut} onBack={() => setCheckoutStep('bag')} onOpenTerms={() => navigateToLegal('terminos')} digitalOnly={cartItems.every((item) => item.isGiftCard)} onRequestLogin={() => { setIsCartOpen(false); setCheckoutStep('bag'); navigateToAccount() }} onSubmit={(payload) => { void handleCheckout(payload) }} />
            ) : cartItems.length === 0 ? (
              <div className="cart-empty"><div className="cart-empty__icon"><ShoppingBag size={26} strokeWidth={1.5} /></div><h3>Tu bolsa está vacía.</h3><p>Elige solo lo que se sienta bien para ti.</p><button className="button button--dark" type="button" onClick={() => setIsCartOpen(false)}>Seguir mirando <ArrowRight size={16} /></button></div>
            ) : (
              <>
                <div className="cart-items">{cartItems.map((item) => (
                  <article className="cart-item" key={item.cartKey}>
                    <img src={getProductImage(item)} alt={item.gallery?.[0]?.alt ?? item.alt} />
                    <div className="cart-item__body"><p className="product-card__category">{item.isGiftCard ? 'Tarjeta de regalo' : `${item.category} · Talla ${item.size}`}</p><h3>{item.name}</h3><strong>{formatPrice(item.price, displayCurrency, usdArsRate)}</strong><div className="quantity-stepper" aria-label={`Cantidad de ${item.name}, talla ${item.size}`}><button type="button" onClick={() => changeQuantity(item.cartKey, -1)} aria-label={`Quitar una unidad de ${item.name}, talla ${item.size}`}><Minus size={13} /></button><span>{item.quantity}</span><button type="button" onClick={() => changeQuantity(item.cartKey, 1)} aria-label={`Añadir una unidad de ${item.name}, talla ${item.size}`}><Plus size={13} /></button></div></div>
                    <button className="cart-item__remove" type="button" onClick={() => changeQuantity(item.cartKey, -item.quantity)} aria-label={`Eliminar ${item.name}, talla ${item.size}`}><X size={16} /></button>
                  </article>
                ))}</div>
                <div className="cart-summary"><p className="shipping-note"><Truck size={17} strokeWidth={1.7} /> {storeConfig?.shipping.freeThresholdArs ? `Envío gratis desde ${formatPrice(storeConfig.shipping.freeThresholdArs, displayCurrency, usdArsRate)}. ` : ''}El costo de envío se calcula en el siguiente paso.</p><div className="cart-subtotal"><span>Subtotal</span><strong>{formatPrice(cartTotal, displayCurrency, usdArsRate)}</strong></div><p className="cart-tax-note">El pago se realiza en ARS con Mercado Pago.</p><button className="button button--coral checkout-button" type="button" onClick={startCheckout}>Continuar <ArrowRight size={17} /></button><button className="continue-shopping" type="button" onClick={() => setIsCartOpen(false)}>Seguir mirando</button></div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

export default App
