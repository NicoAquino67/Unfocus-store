import { useEffect, useState, type FormEvent } from 'react'
import { Check, Pencil, Trash2 } from 'lucide-react'
import { apiRequest } from './api'

type Coupon = {
  id: number
  code: string
  type: 'percent' | 'fixed'
  value: number
  minSubtotal: number
  maxUses: number
  uses: number
  expiresAt: string | null
  active: number
}

type CouponDraft = { id: number | null; code: string; type: 'percent' | 'fixed'; value: string; minSubtotal: string; maxUses: string; expiresAt: string; active: boolean }

const emptyDraft: CouponDraft = { id: null, code: '', type: 'percent', value: '10', minSubtotal: '0', maxUses: '0', expiresAt: '', active: true }

function AdminCoupons() {
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [draft, setDraft] = useState<CouponDraft>(emptyDraft)
  const [message, setMessage] = useState('')

  useEffect(() => {
    apiRequest<{ coupons: Coupon[] }>('/api/admin/coupons').then((payload) => setCoupons(payload.coupons)).catch(() => undefined)
  }, [])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage('')
    const body = JSON.stringify({ ...draft, value: Number(draft.value), minSubtotal: Number(draft.minSubtotal), maxUses: Number(draft.maxUses) })
    try {
      const payload = await apiRequest<{ coupons: Coupon[] }>(draft.id ? `/api/admin/coupons/${draft.id}` : '/api/admin/coupons', { method: draft.id ? 'PUT' : 'POST', body })
      setCoupons(payload.coupons)
      setDraft(emptyDraft)
      setMessage('Cupón guardado.')
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : 'No se pudo guardar el cupón.')
    }
  }

  const remove = async (id: number) => {
    try {
      const payload = await apiRequest<{ coupons: Coupon[] }>(`/api/admin/coupons/${id}`, { method: 'DELETE' })
      setCoupons(payload.coupons)
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : 'No se pudo eliminar el cupón.')
    }
  }

  const edit = (coupon: Coupon) => setDraft({ id: coupon.id, code: coupon.code, type: coupon.type, value: String(coupon.value), minSubtotal: String(coupon.minSubtotal), maxUses: String(coupon.maxUses), expiresAt: coupon.expiresAt ?? '', active: Boolean(coupon.active) })

  return (
    <form className="admin-settings-panel" onSubmit={(event) => { void save(event) }}>
      <div className="admin-order-panel__header"><p className="eyebrow">Promociones</p><h3>Cupones de descuento</h3></div>
      <div className="admin-form-grid">
        <label className="admin-field"><span>Código</span><input required maxLength={30} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase() })} placeholder="BIENVENIDA10" /></label>
        <label className="admin-field"><span>Tipo</span><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as CouponDraft['type'] })}><option value="percent">Porcentaje (%)</option><option value="fixed">Monto fijo (ARS)</option></select></label>
        <label className="admin-field"><span>{draft.type === 'percent' ? 'Porcentaje' : 'Monto (ARS)'}</span><input required type="number" min="1" max={draft.type === 'percent' ? 100 : undefined} step="1" value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></label>
        <label className="admin-field"><span>Compra mínima (ARS)</span><input type="number" min="0" step="1" value={draft.minSubtotal} onChange={(event) => setDraft({ ...draft, minSubtotal: event.target.value })} /></label>
        <label className="admin-field"><span>Usos máximos (0 = sin límite)</span><input type="number" min="0" step="1" value={draft.maxUses} onChange={(event) => setDraft({ ...draft, maxUses: event.target.value })} /></label>
        <label className="admin-field"><span>Vence (opcional)</span><input type="date" value={draft.expiresAt} onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })} /></label>
        <label className="admin-field"><span>Activo</span><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /></label>
      </div>
      {message && <p className="admin-settings-panel__message" role="status">{message}</p>}
      <div className="admin-editor__footer">
        {draft.id && <button className="admin-cancel-button" type="button" onClick={() => setDraft(emptyDraft)}>Cancelar edición</button>}
        <button className="button button--coral" type="submit"><Check size={16} aria-hidden="true" /> {draft.id ? 'Actualizar cupón' : 'Crear cupón'}</button>
      </div>
      {coupons.length > 0 ? (
        <ul className="admin-newsletter-list">
          {coupons.map((coupon) => (
            <li key={coupon.id} className="admin-newsletter-row">
              <div>
                <strong>{coupon.code}</strong>
                <span>{coupon.type === 'percent' ? `${coupon.value}%` : `$${coupon.value.toLocaleString('es-AR')}`} · usos {coupon.uses}{coupon.maxUses ? `/${coupon.maxUses}` : ''}{coupon.minSubtotal ? ` · mín. $${coupon.minSubtotal.toLocaleString('es-AR')}` : ''}{coupon.expiresAt ? ` · vence ${coupon.expiresAt}` : ''}{coupon.active ? '' : ' · inactivo'}</span>
              </div>
              <div className="admin-row-actions">
                <button className="admin-icon-button" type="button" onClick={() => edit(coupon)} aria-label={`Editar ${coupon.code}`} title="Editar"><Pencil size={16} /></button>
                <button className="admin-icon-button admin-icon-button--danger" type="button" onClick={() => { void remove(coupon.id) }} aria-label={`Eliminar ${coupon.code}`} title="Eliminar"><Trash2 size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="admin-empty">Todavía no hay cupones.</p>}
    </form>
  )
}

export default AdminCoupons
