export type LegalPageKey = 'terminos' | 'privacidad' | 'cambios' | 'arrepentimiento'

export const legalPageKeys: LegalPageKey[] = ['terminos', 'privacidad', 'cambios', 'arrepentimiento']

export const legalPageTitles: Record<LegalPageKey, string> = {
  terminos: 'Términos y condiciones',
  privacidad: 'Política de privacidad',
  cambios: 'Cambios y devoluciones',
  arrepentimiento: 'Botón de arrepentimiento',
}
