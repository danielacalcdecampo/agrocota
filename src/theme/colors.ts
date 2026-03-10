// Paleta extraída diretamente da logo OAgroCota — fonte única para app e PDFs
export const Colors = {
  // Verde — extraído da logo (dominant: #0f4b1e)
  primary:       '#1a5c25',   // verde médio da logo — botões, links, destaques
  primaryDark:   '#0f4b1e',   // verde escuro da logo — header, fundo
  primaryLight:  '#3c7820',   // verde claro da logo — hover, destaques

  // Amarelo/Dourado — extraído da logo (#ffb400)
  secondary:      '#ffb400',  // amarelo principal da seta da logo
  secondaryLight: '#ffd200',  // amarelo claro da logo

  // Neutros
  background:    '#F3F6F4',
  surface:       '#FFFFFF',
  textPrimary:   '#0f1f13',   // verde quase preto, alinhado com a logo
  textSecondary: '#4a6b53',   // verde acinzentado
  error:         '#D32F2F',
  border:        '#d6e8da',
  inputBg:       '#f5faf6',
  white:         '#FFFFFF',
  black:         '#000000',
  overlay:       'rgba(0,0,0,0.5)',

  // Sucesso/valores (PDFs e badges)
  success:       '#15803d',
  successBg:     '#dcfce7',
  successBorder: '#bbf7d0',
};

/** Cores agrícolas por categoria — paleta distinta baseada em IRAC/FRAC/HRAC e convenções agrícolas
 * Defensivos: tons distintos (violeta, laranja, azul, ciano, vermelho) para evitar confusão em gráficos
 * Fertilizantes: verde (crescimento/NPK); Sementes: marrom (grãos); Adjuvante: dourado; Biológico: teal; Corretivo: cinza
 */
export const CAT_AGRICOLA: Record<string, string> = {
  Fungicida: '#7C3AED',   // violeta — FRAC/defensivos fungicidas
  Herbicida: '#EA580C',   // laranja — HRAC/Take Action
  Inseticida: '#2563EB',  // azul — IRAC/neurotoxinas
  Nematicida: '#0891B2',  // ciano — pragas de solo
  Defensivo: '#DC2626',   // vermelho — perigo genérico (GHS)
  Fertilizantes: '#16A34A', 'Nutricao / Fertilizante Foliar': '#16A34A', 'Fertilizante de Base': '#16A34A',
  Sementes: '#92400E', 'Sementes / Hibridos': '#92400E',
  Adjuvante: '#CA8A04',  // dourado — surfactantes/cautela
  Biologico: '#0D9488',  // teal — natural/orgânico
  'Corretivo de Solo': '#78716C',
};

export const CAT_FALLBACK = ['#6366F1', '#DB2777', '#059669', '#F59E0B', '#64748B'];

const _catColorMap: Record<string, string> = {};
export function getCatColor(categoria: string): string {
  const c = String(categoria ?? '').trim();
  if (CAT_AGRICOLA[c]) return CAT_AGRICOLA[c];
  if (!_catColorMap[c]) _catColorMap[c] = CAT_FALLBACK[Object.keys(_catColorMap).length % CAT_FALLBACK.length];
  return _catColorMap[c];
}
