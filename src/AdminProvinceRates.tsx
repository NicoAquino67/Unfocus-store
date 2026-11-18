import { useEffect, useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import provinces from '../server/provinces.json'
import { apiRequest, type ProvinceShippingRates } from './api'

type DraftRate = { base: string; margin: string }

export default function AdminProvinceRates() {
  const [province, setProvince] = useState(provinces[0])
  const [draft, setDraft] = useState<Record<string, DraftRate> | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    apiRequest<{ rates: ProvinceShippingRates }>('/api/admin/province-shipping-rates')
      .then(({ rates }) => {
        if (active) setDraft(Object.fromEntries(provinces.map((name) => [name, {
          base: rates[name] ? String(rates[name].baseArs) : '',
          margin: rates[name] ? String(rates[name].marginArs) : '',
        }])))
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las tarifas.') })
    return () => { active = false }
  }, [])

  const update = (field: keyof DraftRate, value: string) => {
    setDraft((current) => current ? { ...current, [province]: { ...current[province], [field]: value, ...(field === 'base' && !value ? { margin: '' } : {}) } } : current)
    setMessage('')
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft) return
    const rates: ProvinceShippingRates = {}
    for (const [name, rate] of Object.entries(draft)) {
      if (!rate.base.trim()) continue
      if (!/^\d+$/.test(rate.base) || (rate.margin && !/^\d+$/.test(rate.margin)) || Number(rate.base) + Number(rate.margin || 0) > 100_000_000) {
        setError(`Revisa la tarifa y el margen de ${name}. Deben ser importes enteros no negativos, con un total máximo de $100.000.000.`)
        return
      }
      rates[name] = { baseArs: Number(rate.base), marginArs: Number(rate.margin || 0) }
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await apiRequest('/api/admin/province-shipping-rates', { method: 'PUT', body: JSON.stringify({ rates }) })
      setMessage('Tarifas por provincia guardadas.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar las tarifas.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="admin-shipping-settings">
      <summary>Tarifas de envío por provincia</summary>
      <p className="admin-hint">Carga manualmente el costo y un margen fijo en pesos para cada provincia. El cliente paga la suma. Si dejas el costo vacío, se usa la tarifa general de la tienda.</p>
      {draft && (
        <form onSubmit={(event) => { void save(event) }}>
          <div className="admin-form-grid">
            <label className="admin-field"><span>Provincia</span><select disabled={saving} value={province} onChange={(event) => setProvince(event.target.value)}>{provinces.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            <label className="admin-field"><span>Costo base (ARS)</span><input disabled={saving} type="number" min="0" max="100000000" step="1" value={draft[province].base} onChange={(event) => update('base', event.target.value)} placeholder="Usar tarifa general" /></label>
            <label className="admin-field"><span>Margen fijo (ARS)</span><input disabled={saving || !draft[province].base} type="number" min="0" max="100000000" step="1" value={draft[province].margin} onChange={(event) => update('margin', event.target.value)} /></label>
          </div>
          <p className="admin-hint">{draft[province].base ? `Total: $${(Number(draft[province].base) + Number(draft[province].margin || 0)).toLocaleString('es-AR')}` : 'Se usará la tarifa general.'}</p>
          {message && <p className="admin-settings-panel__message" role="status">{message}</p>}
          <div className="admin-editor__footer"><button className="button button--coral" type="submit" disabled={saving}><Check size={16} aria-hidden="true" /> {saving ? 'Guardando…' : 'Guardar tarifas'}</button></div>
        </form>
      )}
      {error && <p className="admin-form-error" role="alert">{error}</p>}
    </details>
  )
}
