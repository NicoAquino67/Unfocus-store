export type LegalPageKey = 'terminos' | 'privacidad' | 'cambios' | 'arrepentimiento' | 'defensa' | 'baja'

export const legalPageKeys: LegalPageKey[] = ['terminos', 'privacidad', 'cambios', 'arrepentimiento', 'defensa', 'baja']

export const legalPageTitles: Record<LegalPageKey, string> = {
  terminos: 'Términos y condiciones',
  privacidad: 'Política de privacidad',
  cambios: 'Cambios y devoluciones',
  arrepentimiento: 'Botón de arrepentimiento',
  defensa: 'Defensa del consumidor',
  baja: 'Botón de baja',
}
