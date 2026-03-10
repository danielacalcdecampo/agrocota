import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  StatusBar,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useThemeMode } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/AppNavigator';
import Svg, { Path, Circle, G } from 'react-native-svg';
import {
  exportarGestaoComparacaoPdf,
  exportarGestaoAnalisePdf,
} from '../services/GestaoFinanceiraPdfService';
import { Colors, getCatColor } from '../theme/colors';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'GestaoFinanceira'>;
};

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface Fazenda { id: string; nome: string; area_total_ha?: number | null; }
interface Talhao  { id: string; nome: string; area_ha: number; fazenda_id: string; }
interface Safra   { id: string; nome: string; ano: string; talhao_id: string; data_inicio?: string; data_fim?: string; }
interface SafraDadosProducao { produtividade_ha: number; preco_soja: number; }
interface InsumoItem {
  id: string; nome: string; categoria: string; valor_ha: number;
  cotacao_id: string; cotacao_titulo: string; comprado: boolean; area_talhao: number;
  fornecedor?: string; dose_ha?: number;
  isAlternativa?: boolean; produtoOriginal?: string; doseOriginal?: number;
}
type UnidadeCusto = 'reais' | 'sacas';
interface CustoOperacional { id: string; descricao: string; valor: number; unidade: UnidadeCusto; valor_original: number; preco_soja_ref: number; talhao_id: string; safra_id?: string; }

// ── HELPERS ───────────────────────────────────────────────────────────────────

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const fmtBRL = (v: number) => `R$ ${fmt(v)}`;
function parseBR(s: string): number {
  const v = parseFloat(s.replace(/[^0-9,.-]/g, '').replace(',', '.'));
  return isNaN(v) ? 0 : v;
}
const toInput = (n: number) => (n > 0 ? n.toString().replace('.', ',') : '');

// ── PIE CHART ─────────────────────────────────────────────────────────────────

function PieChart({ data, size = 160, isDark }: { data: { label: string; value: number; color: string }[]; size?: number; isDark: boolean }) {
  const total = data.reduce((s, i) => s + i.value, 0);
  if (total === 0) return <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 12, color: isDark ? '#3E5A48' : '#8AA898' }}>Sem dados</Text></View>;
  let cur = -90;
  const c = size / 2, r = c * 0.8;
  const paths = data.filter(i => i.value > 0).map((item, idx) => {
    const pct = item.value / total, angle = pct * 360;
    if (pct >= 0.999) return <Circle key={idx} cx={c} cy={c} r={r} fill={item.color} />;
    const sx = c + r * Math.cos((cur * Math.PI) / 180), sy = c + r * Math.sin((cur * Math.PI) / 180);
    const ex = c + r * Math.cos(((cur + angle) * Math.PI) / 180), ey = c + r * Math.sin(((cur + angle) * Math.PI) / 180);
    const el = <Path key={idx} d={`M ${c} ${c} L ${sx} ${sy} A ${r} ${r} 0 ${angle > 180 ? 1 : 0} 1 ${ex} ${ey} Z`} fill={item.color} />;
    cur += angle; return el;
  });
  return <View style={{ alignItems: 'center' }}><Svg width={size} height={size}><G>{paths}</G></Svg></View>;
}

// ── VERTICAL BAR CHART ────────────────────────────────────────────────────────

function VerticalBarChart({ data, isDark }: { data: { label: string; value: number; color: string }[]; isDark: boolean }) {
  const maxV = Math.max(...data.map(d => d.value));
  const H = 180;
  const tc = isDark ? '#C8DDD2' : '#1A2C22', mc = isDark ? '#3E5A48' : '#8AA898';
  return (
    <View style={{ paddingTop: 40, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: H, marginTop: 10 }}>
        {data.map((item, i) => {
          const bh = maxV > 0 ? (item.value / maxV) * (H - 60) : 0;
          const anim = useRef(new Animated.Value(0)).current;
          useEffect(() => { Animated.spring(anim, { toValue: bh, useNativeDriver: false, tension: 20, friction: 7 }).start(); }, [bh]);
          return (
            <View key={i} style={{ alignItems: 'center', width: 60 }}>
              <View style={{ position: 'absolute', top: -30, alignItems: 'center' }}><Text style={{ fontSize: 11, fontWeight: '700', color: tc }}>{fmtBRL(item.value)}</Text></View>
              <Animated.View style={{ width: 50, height: anim, backgroundColor: item.color, borderRadius: 6, marginBottom: 8 }} />
              <Text numberOfLines={2} style={{ fontSize: 11, fontWeight: '600', color: mc, textAlign: 'center' }}>{item.label}</Text>
              <Text style={{ fontSize: 10, color: mc, marginTop: 2 }}>{maxV > 0 ? `${((item.value / maxV) * 100).toFixed(0)}%` : '0%'}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── COMPARISON BAR CHART ──────────────────────────────────────────────────────

function CompBarChart({ labelA, labelB, valueA, valueB, colorA, colorB, title, isDark }: {
  labelA: string; labelB: string; valueA: number; valueB: number; colorA: string; colorB: string; title: string; isDark: boolean;
}) {
  const maxV = Math.max(Math.abs(valueA), Math.abs(valueB), 1);
  const H = 140;
  const animA = useRef(new Animated.Value(0)).current;
  const animB = useRef(new Animated.Value(0)).current;
  const tc = isDark ? '#C8DDD2' : '#1A2C22', mc = isDark ? '#3E5A48' : '#8AA898';
  useEffect(() => {
    Animated.parallel([
      Animated.spring(animA, { toValue: (Math.abs(valueA) / maxV) * (H - 40), useNativeDriver: false, tension: 20, friction: 7 }),
      Animated.spring(animB, { toValue: (Math.abs(valueB) / maxV) * (H - 40), useNativeDriver: false, tension: 20, friction: 7 }),
    ]).start();
  }, [valueA, valueB]);
  const bars = [
    { anim: animA, value: valueA, color: valueA < 0 ? '#E53935' : colorA, label: labelA },
    { anim: animB, value: valueB, color: valueB < 0 ? '#E53935' : colorB, label: labelB },
  ];
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: mc, letterSpacing: 1, marginBottom: 4 }}>{title}</Text>
      <View style={{ height: 1, backgroundColor: isDark ? '#1A2C22' : '#EEF3EF', marginBottom: 14 }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: H }}>
        {bars.map((b, i) => (
          <View key={i} style={{ alignItems: 'center', flex: 1 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: b.value < 0 ? '#E53935' : tc, marginBottom: 6, textAlign: 'center' }}>{fmtBRL(b.value)}</Text>
            <Animated.View style={{ width: 60, height: b.anim, backgroundColor: b.color, borderRadius: 8, marginBottom: 8 }} />
            <Text style={{ fontSize: 11, fontWeight: '600', color: mc, textAlign: 'center' }} numberOfLines={2}>{b.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── TOGGLE ────────────────────────────────────────────────────────────────────

function Toggle({ value, onChange, isDark }: { value: boolean; onChange: (v: boolean) => void; isDark: boolean }) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => { Animated.spring(anim, { toValue: value ? 1 : 0, useNativeDriver: false, speed: 20 }).start(); }, [value]);
  const tx = anim.interpolate({ inputRange: [0, 1], outputRange: [2, 22] });
  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: [isDark ? '#1E3028' : '#D4E4DA', Colors.primary] });
  return (
    <TouchableOpacity onPress={() => onChange(!value)} activeOpacity={0.8}>
      <Animated.View style={{ width: 46, height: 26, borderRadius: 13, backgroundColor: bg, justifyContent: 'center' }}>
        <Animated.View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFF', transform: [{ translateX: tx }] }} />
      </Animated.View>
    </TouchableOpacity>
  );
}

// ── CARD ──────────────────────────────────────────────────────────────────────

function Card({ children, isDark, style }: { children: React.ReactNode; isDark: boolean; style?: any }) {
  return (
    <View style={[{ backgroundColor: isDark ? '#17241C' : '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: isDark ? '#1E3028' : '#E8EFE9', padding: 16, marginBottom: 10 }, style]}>
      {children}
    </View>
  );
}

// ── INSUMO ROW ────────────────────────────────────────────────────────────────

function InsumoRow({ item, isDark, onToggle }: { item: InsumoItem; isDark: boolean; onToggle: (id: string, v: boolean) => void }) {
  const tc = isDark ? '#C8DDD2' : '#1A2C22', mc = isDark ? '#3E5A48' : '#8AA898', sep = isDark ? '#1A2C22' : '#F0F5F1';
  const catColor = getCatColor(item.categoria);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sep, gap: 12 }}>
      <View style={{ width: 4, height: 36, borderRadius: 2, backgroundColor: catColor }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: tc }} numberOfLines={1}>{item.nome}</Text>
        <Text style={{ fontSize: 11, color: mc, marginTop: 2 }}>{item.categoria} · {fmtBRL(item.valor_ha)}/ha · {item.area_talhao} ha</Text>
      </View>
      <View style={{ alignItems: 'flex-end', marginRight: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: tc }}>{fmtBRL(item.valor_ha * item.area_talhao)}</Text>
        <Text style={{ fontSize: 10, fontWeight: '600', marginTop: 2, color: item.comprado ? Colors.success : isDark ? '#C8900A' : '#B07010' }}>{item.comprado ? 'Comprado' : 'Pendente'}</Text>
      </View>
      <Toggle value={item.comprado} onChange={(v) => onToggle(item.id, v)} isDark={isDark} />
    </View>
  );
}

// ── CUSTO ROW ─────────────────────────────────────────────────────────────────

function CustoRow({ item, isDark, onEdit, onDelete, areaHa }: { item: CustoOperacional; isDark: boolean; onEdit: (i: CustoOperacional) => void; onDelete: (id: string) => void; areaHa: number }) {
  const tc = isDark ? '#C8DDD2' : '#1A2C22', mc = isDark ? '#3E5A48' : '#8AA898', sep = isDark ? '#1A2C22' : '#F0F5F1';
  const vha = item.valor;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sep }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: tc }}>{item.descricao}</Text>
        <Text style={{ fontSize: 12, color: mc, marginTop: 2 }}>
          {fmtBRL(vha)}/ha × {fmt(areaHa)} ha = {fmtBRL(vha * areaHa)}
          {item.unidade === 'sacas' ? ` (${fmt(item.valor_original)} sc × R$ ${fmt(item.preco_soja_ref)})` : ''}
        </Text>
        <View style={{ backgroundColor: item.unidade === 'sacas' ? (isDark ? '#1A2C22' : '#EBF5EF') : (isDark ? '#111D16' : '#F4F8F5'), borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginTop: 4 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: item.unidade === 'sacas' ? Colors.success : mc }}>{item.unidade === 'sacas' ? 'Sacas' : 'Reais'}</Text>
        </View>
      </View>
      <TouchableOpacity onPress={() => onEdit(item)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: isDark ? '#1A2C22' : '#EEF6F1', marginRight: 8 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: isDark ? '#7FC49A' : Colors.primary }}>Editar</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => onDelete(item.id)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: isDark ? '#2A1A1A' : '#FEF2F2' }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: isDark ? '#E07070' : '#B82828' }}>Excluir</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── ADD CUSTO MODAL ───────────────────────────────────────────────────────────

function AddCustoModal({ visible, onClose, onSave, editItem, isDark }: {
  visible: boolean;
  onClose: () => void;
  onSave: (item: Omit<CustoOperacional, 'id'>) => void;
  editItem: CustoOperacional | null;
  isDark: boolean;
}) {
  const insets = useSafeAreaInsets();

  const [descricao, setDescricao]   = useState('');
  const [unidade, setUnidade]       = useState<UnidadeCusto>('reais');
  const [valorStr, setValorStr]     = useState('');   // R$/ha  OU  sacas/ha
  const [precoStr, setPrecoStr]     = useState('');   // R$/saca (só no modo sacas)

  const refDescricao = React.useRef<TextInput>(null);
  const refValor     = React.useRef<TextInput>(null);
  const refPreco     = React.useRef<TextInput>(null);

  // Preenche campos ao abrir
  useEffect(() => {
    if (!visible) return;
    if (editItem) {
      setDescricao(editItem.descricao ?? '');
      setUnidade(editItem.unidade ?? 'reais');
      // valor_original = o que o usuário digitou (sacas ou R$)
      setValorStr(editItem.valor_original > 0 ? String(editItem.valor_original).replace('.', ',') : '');
      // preco_soja_ref = R$/saca (só usado no modo sacas)
      setPrecoStr(editItem.preco_soja_ref > 0 ? String(editItem.preco_soja_ref).replace('.', ',') : '');
    } else {
      setDescricao('');
      setUnidade('reais');
      setValorStr('');
      setPrecoStr('');
    }
  }, [visible, editItem]);

  // Parse seguro
  function parse(s: string): number {
    const n = parseFloat(s.replace(/[^0-9,.-]/g, '').replace(',', '.'));
    return isNaN(n) || n < 0 ? 0 : n;
  }

  const vValor = parse(valorStr);   // sacas/ha ou R$/ha
  const vPreco = parse(precoStr);   // R$/saca

  // valor_ha: resultado final em R$/ha
  const valorHa = unidade === 'sacas' ? vValor * vPreco : vValor;

  const descOk   = descricao.trim().length > 0;
  const valorOk  = vValor > 0;
  const precoOk  = unidade === 'reais' || vPreco > 0;
  const formOk   = descOk && valorOk && precoOk;

  function handleSalvar() {
    if (!formOk) return;
    onSave({
      descricao:      descricao.trim(),
      unidade,
      valor:          valorHa,       // valor em R$/ha
      valor_original: vValor,        // o que o usuário digitou (sacas ou R$)
      preco_soja_ref: vPreco,        // R$/saca (0 se modo reais)
      talhao_id:      editItem?.talhao_id ?? '',
      safra_id:       editItem?.safra_id,
    });
  }

  // Tema
  const cardBg  = isDark ? '#17241C' : '#FFFFFF';
  const border  = isDark ? '#1E3028' : '#E8EFE9';
  const tc      = isDark ? '#C8DDD2' : '#1A2C22';
  const mc      = isDark ? '#3E5A48' : '#8AA898';
  const inputBg = isDark ? '#111D16' : '#F4F8F5';
  const inputStyle = {
    backgroundColor: inputBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontWeight: '600' as const,
    color: tc,
    borderWidth: 1,
    borderColor: border,
    marginBottom: 14,
  };
  const labelStyle = {
    fontSize: 11,
    fontWeight: '600' as const,
    color: mc,
    letterSpacing: 0.5,
    marginBottom: 6,
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Tap fora fecha o modal */}
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFillObject} />
        </TouchableWithoutFeedback>

        {/* Sheet — fica acima do teclado */}
        <View
          style={{
            backgroundColor: cardBg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            maxHeight: '92%',
          }}
        >
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: isDark ? '#2E4A38' : '#D4E4DA' }} />
          </View>

          <KeyboardAwareScrollView
            keyboardShouldPersistTaps="handled"
            bounces={false}
            bottomOffset={24}
            contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 32 }}
          >
                  {/* Título */}
                  <Text style={{ fontSize: 17, fontWeight: '800', color: tc, marginBottom: 22 }}>
                    {editItem ? 'Editar custo operacional' : 'Novo custo operacional'}
                  </Text>

                  {/* ── DESCRIÇÃO ── */}
                  <Text style={labelStyle}>DESCRIÇÃO *</Text>
                  <TextInput
                    ref={refDescricao}
                    style={[inputStyle, { fontSize: 14 }]}
                    placeholder="Ex: Mecanização, Combustível, Mão de obra..."
                    placeholderTextColor={mc}
                    value={descricao}
                    onChangeText={setDescricao}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => refValor.current?.focus()}
                    autoFocus={!editItem}
                  />

                  {/* ── TIPO DE UNIDADE ── */}
                  <Text style={[labelStyle, { marginBottom: 10 }]}>TIPO DE LANÇAMENTO *</Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
                    {([
                      { key: 'reais',  label: 'Valor em R$',     sub: 'R$/ha direto' },
                      { key: 'sacas',  label: 'Sacas de soja',   sub: 'converte p/ R$' },
                    ] as const).map(opt => {
                      const ativo = unidade === opt.key;
                      return (
                        <TouchableOpacity
                          key={opt.key}
                          onPress={() => { setUnidade(opt.key); setValorStr(''); setPrecoStr(''); }}
                          style={{
                            flex: 1,
                            paddingVertical: 12,
                            paddingHorizontal: 10,
                            borderRadius: 12,
                            alignItems: 'center',
                            backgroundColor: ativo ? Colors.primary : inputBg,
                            borderWidth: 2,
                            borderColor: ativo ? Colors.primary : border,
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '800', color: ativo ? '#FFF' : tc }}>{opt.label}</Text>
                          <Text style={{ fontSize: 10, color: ativo ? 'rgba(255,255,255,0.7)' : mc, marginTop: 2 }}>{opt.sub}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* ── VALOR ── */}
                  {unidade === 'reais' ? (
                    <>
                      <Text style={labelStyle}>VALOR POR HECTARE (R$/ha) *</Text>
                      <TextInput
                        ref={refValor}
                        style={inputStyle}
                        placeholder="0,00"
                        placeholderTextColor={mc}
                        keyboardType="decimal-pad"
                        value={valorStr}
                        onChangeText={setValorStr}
                        returnKeyType="done"
                        onSubmitEditing={() => Keyboard.dismiss()}
                      />
                    </>
                  ) : (
                    <>
                      {/* sacas/ha */}
                      <Text style={labelStyle}>QUANTIDADE (SACAS/ha) *</Text>
                      <TextInput
                        ref={refValor}
                        style={inputStyle}
                        placeholder="0,00"
                        placeholderTextColor={mc}
                        keyboardType="decimal-pad"
                        value={valorStr}
                        onChangeText={setValorStr}
                        returnKeyType="next"
                        blurOnSubmit={false}
                        onSubmitEditing={() => refPreco.current?.focus()}
                      />

                      {/* R$/saca */}
                      <Text style={labelStyle}>PREÇO DA SACA (R$/saca) *</Text>
                      <TextInput
                        ref={refPreco}
                        style={inputStyle}
                        placeholder="0,00"
                        placeholderTextColor={mc}
                        keyboardType="decimal-pad"
                        value={precoStr}
                        onChangeText={setPrecoStr}
                        returnKeyType="done"
                        onSubmitEditing={() => Keyboard.dismiss()}
                      />
                    </>
                  )}

                  {/* ── PREVIEW ── */}
                  {formOk && (
                    <View
                      style={{
                        backgroundColor: isDark ? '#0D1C13' : '#EBF5EF',
                        borderRadius: 14,
                        padding: 16,
                        marginBottom: 18,
                        borderWidth: 1,
                        borderColor: isDark ? '#1A3028' : '#C8E4D0',
                      }}
                    >
                      <Text style={{ fontSize: 10, fontWeight: '700', color: mc, letterSpacing: 0.5, marginBottom: 6 }}>RESULTADO</Text>
                      <Text style={{ fontSize: 22, fontWeight: '900', color: Colors.primary }}>
                        {fmtBRL(valorHa)}<Text style={{ fontSize: 13, fontWeight: '600', color: mc }}>/ha</Text>
                      </Text>
                      {unidade === 'sacas' && (
                        <Text style={{ fontSize: 11, color: mc, marginTop: 4 }}>
                          {valorStr.replace(',', '.')} sc/ha × {fmtBRL(vPreco)}/saca
                        </Text>
                      )}
                      <Text style={{ fontSize: 11, color: mc, marginTop: 4 }}>
                        Será multiplicado pela área do talhão ao calcular o total
                      </Text>
                    </View>
                  )}

                  {/* ── BOTÕES ── */}
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <TouchableOpacity
                      onPress={onClose}
                      style={{
                        flex: 1,
                        paddingVertical: 14,
                        borderRadius: 12,
                        alignItems: 'center',
                        backgroundColor: isDark ? '#1A2C22' : '#EEF3EF',
                        borderWidth: 1,
                        borderColor: border,
                      }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '700', color: tc }}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleSalvar}
                      disabled={!formOk}
                      style={{
                        flex: 2,
                        paddingVertical: 14,
                        borderRadius: 12,
                        alignItems: 'center',
                        backgroundColor: formOk ? Colors.primary : (isDark ? '#1A2C22' : '#D4E4DA'),
                      }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '700', color: formOk ? '#FFFFFF' : mc }}>
                        {editItem ? 'Salvar alterações' : '+ Adicionar custo'}
                      </Text>
                    </TouchableOpacity>
                  </View>
          </KeyboardAwareScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── NIVELAMENTO INLINE ────────────────────────────────────────────────────────

function NivelamentoInline({ isDark, cardBg, border, tc, mc, custoInsumos, custoOperacional, talhoes, selectedTalhao, safra, uid, mainScrollRef, onExportPdf }: {
  isDark: boolean; cardBg: string; border: string; tc: string; mc: string;
  custoInsumos: number; custoOperacional: number;
  talhoes: Talhao[]; selectedTalhao: Talhao | null;
  safra: Safra | null; uid?: string;
  mainScrollRef: React.RefObject<ScrollView>;
  onExportPdf: (produtividade: number, preco: number) => Promise<void>;
}) {
  const [precoSoja, setPS] = useState('');
  const [produtividade, setProd] = useState('');
  const [custoExtra, setExtra] = useState('');
  const [savedData, setSavedData] = useState<SafraDadosProducao | null>(null);
  const [saving, setSaving] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [loadingDados, setLoadingDados] = useState(false);
  const inputRef1  = useRef<TextInput>(null);
  const inputRef2  = useRef<TextInput>(null);
  const inputRef3  = useRef<TextInput>(null);
  const inputBg = isDark ? '#111D16' : '#F4F8F5';

  function scrollToInput(inputRef: React.RefObject<TextInput>) {
    setTimeout(() => {
      if (!inputRef.current || !mainScrollRef.current) return;
      inputRef.current.measureLayout(
        mainScrollRef.current as any,
        (_x, y) => { mainScrollRef.current?.scrollTo({ y: y - 20, animated: true }); },
        () => { mainScrollRef.current?.scrollToEnd({ animated: true }); }
      );
    }, 150);
  }

  useEffect(() => {
    if (!safra) { setPS(''); setProd(''); setSavedData(null); return; }
    let cancelled = false;
    const load = async () => {
      setLoadingDados(true);
      try {
        const { data } = await supabase
          .from('safra_dados_producao')
          .select('produtividade_ha, preco_soja')
          .eq('safra_id', safra.id)
          .single();
        if (cancelled) return;
        if (data) {
          const d = { produtividade_ha: Number(data.produtividade_ha ?? 0), preco_soja: Number(data.preco_soja ?? 0) };
          setSavedData(d);
          if (d.produtividade_ha > 0) setProd(toInput(d.produtividade_ha));
          if (d.preco_soja > 0) setPS(toInput(d.preco_soja));
        } else {
          setSavedData(null);
        }
      } catch {
        if (!cancelled) setSavedData(null);
      } finally {
        if (!cancelled) setLoadingDados(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [safra?.id]);

  const areaHa = selectedTalhao?.area_ha ?? 0;
  const vP = parseBR(precoSoja), vProd = parseBR(produtividade), vExtra = parseBR(custoExtra);
  const totalC = custoInsumos + custoOperacional + vExtra;
  const cHa = areaHa > 0 ? totalC / areaHa : 0;
  const rec = areaHa * vProd * vP;
  const luc = rec - totalC;
  const lucHa = areaHa > 0 ? luc / areaHa : 0;
  const ptoNivel = vP > 0 ? cHa / vP : 0;
  const podeCalc = vP > 0 && areaHa > 0;
  const canSave = !!(safra && vProd > 0 && vP > 0 && uid);

  async function handleSalvarDados() {
    if (!canSave) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('safra_dados_producao').upsert(
        { safra_id: safra!.id, consultor_id: uid, produtividade_ha: vProd, preco_soja: vP, updated_at: new Date().toISOString() },
        { onConflict: 'safra_id' }
      );
      if (!error) {
        setSavedData({ produtividade_ha: vProd, preco_soja: vP });
        Alert.alert('Salvo', 'Dados salvos — serão usados em Comparação e na próxima vez que abrir esta safra.');
      } else {
        Alert.alert('Erro', 'Não foi possível salvar. Verifique a migration SQL no Supabase.');
      }
    } catch { Alert.alert('Erro', 'Falha ao salvar.'); }
    finally { setSaving(false); }
  }

  return (
    <Card isDark={isDark}>
      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: mc, marginBottom: 4 }}>CALCULADORA DE NIVELAMENTO</Text>
      {selectedTalhao
        ? <Text style={{ fontSize: 11, color: mc, marginBottom: 14 }}>{selectedTalhao.nome} — {fmt(areaHa)} ha · Custos carregados automaticamente</Text>
        : <Text style={{ fontSize: 11, color: mc, marginBottom: 14 }}>Selecione um talhão no cabeçalho para carregar os custos</Text>}

      <View style={{ backgroundColor: isDark ? '#0D1C13' : '#EBF5EF', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: isDark ? '#1A3028' : '#C8E4D0' }}>
        <Text style={{ fontSize: 10, fontWeight: '700', color: mc, letterSpacing: 0.8, marginBottom: 8 }}>CUSTOS REGISTRADOS</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {[
            { label: 'Insumos', val: custoInsumos },
            { label: 'Operacional', val: custoOperacional },
            { label: 'Total', val: custoInsumos + custoOperacional },
          ].map((item, i) => (
            <View key={i} style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 10, color: mc }}>{item.label}</Text>
              <Text style={{ fontSize: 12, fontWeight: '800', color: tc, marginTop: 2 }}>{fmtBRL(item.val)}</Text>
            </View>
          ))}
        </View>
      </View>

      {savedData && (savedData.produtividade_ha > 0 || savedData.preco_soja > 0) && (
        <View style={{ backgroundColor: isDark ? '#0A1A10' : '#EBF5EF', borderRadius: 8, padding: 8, marginBottom: 12, borderWidth: 1, borderColor: isDark ? '#1A3028' : '#C8E4D0', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.primary }} />
          <Text style={{ fontSize: 10, color: isDark ? '#7FC49A' : Colors.primary, fontWeight: '600' }}>Dados salvos desta safra — editáveis abaixo</Text>
        </View>
      )}

      {loadingDados && <ActivityIndicator size="small" color={Colors.primary} style={{ marginBottom: 12 }} />}

      <View style={{ gap: 12, marginBottom: 14 }}>
        <View>
          <Text style={{ fontSize: 10, fontWeight: '600', color: mc, letterSpacing: 0.5, marginBottom: 6 }}>PREÇO DA SOJA (R$/SACA)</Text>
          <TextInput
            ref={inputRef1}
            style={{ backgroundColor: inputBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, fontWeight: '600', color: tc, borderWidth: 1, borderColor: border }}
            placeholder="0,00"
            placeholderTextColor={mc}
            keyboardType="decimal-pad"
            value={precoSoja}
            onChangeText={setPS}
            onFocus={() => scrollToInput(inputRef1)}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => inputRef2.current?.focus()}
          />
        </View>
        <View>
          <Text style={{ fontSize: 10, fontWeight: '600', color: mc, letterSpacing: 0.5, marginBottom: 6 }}>PRODUTIVIDADE COLHIDA (SACAS/HA)</Text>
          <TextInput
            ref={inputRef2}
            style={{ backgroundColor: inputBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, fontWeight: '600', color: tc, borderWidth: 1, borderColor: border }}
            placeholder="0"
            placeholderTextColor={mc}
            keyboardType="decimal-pad"
            value={produtividade}
            onChangeText={setProd}
            onFocus={() => scrollToInput(inputRef2)}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => inputRef3.current?.focus()}
          />
        </View>
        <View>
          <Text style={{ fontSize: 10, fontWeight: '600', color: mc, letterSpacing: 0.5, marginBottom: 6 }}>OUTROS CUSTOS ADICIONAIS (R$) — opcional</Text>
          <TextInput
            ref={inputRef3}
            style={{ backgroundColor: inputBg, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, fontWeight: '600', color: tc, borderWidth: 1, borderColor: border }}
            placeholder="0,00"
            placeholderTextColor={mc}
            keyboardType="decimal-pad"
            value={custoExtra}
            onChangeText={setExtra}
            onFocus={() => scrollToInput(inputRef3)}
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
        </View>
      </View>

      {podeCalc && (
        <View style={{ gap: 8 }}>
          <View style={{ height: 1, backgroundColor: isDark ? '#1E3028' : '#E8EFE9', marginBottom: 4 }} />
          {[
            { label: 'Custo total', value: fmtBRL(totalC), sub: `${fmtBRL(cHa)}/ha`, accent: false },
            { label: 'Ponto de nivelamento', value: `${fmt(ptoNivel)} sc/ha`, sub: 'Mínimo para cobrir custos', accent: true, highlight: isDark ? '#C8900A' : '#B07010' },
            { label: 'Receita bruta', value: fmtBRL(rec), sub: `${fmt(vProd)} sc/ha x R$ ${fmt(vP)}`, accent: false },
            { label: 'Lucro líquido', value: fmtBRL(luc), sub: `${fmtBRL(lucHa)}/ha`, accent: true, highlight: luc >= 0 ? Colors.primary : '#B82828' },
          ].map((r, i) => (
            <View key={i} style={{ backgroundColor: r.accent ? (isDark ? '#0D1C13' : '#EBF5EF') : cardBg, borderRadius: 12, borderWidth: 1, borderColor: r.accent ? (isDark ? '#1A3028' : '#C8E4D0') : border, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: tc }}>{r.label}</Text>
                <Text style={{ fontSize: 11, color: mc, marginTop: 1 }}>{r.sub}</Text>
              </View>
              <Text style={{ fontSize: 15, fontWeight: '800', color: (r as any).highlight ?? tc }}>{r.value}</Text>
            </View>
          ))}
        </View>
      )}

      {safra && (
        <View style={{ marginTop: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#1A2C22' : '#EEF3EF' }} />
            <Text style={{ fontSize: 9, fontWeight: '700', color: mc, letterSpacing: 0.5 }}>SALVAR NA SAFRA</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#1A2C22' : '#EEF3EF' }} />
          </View>
          <TouchableOpacity
            onPress={handleSalvarDados}
            disabled={!canSave || saving}
            style={{
              backgroundColor: canSave ? Colors.primary : (isDark ? '#1A2C22' : '#D4E4DA'),
              borderRadius: 12, paddingVertical: 13,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
            }}
          >
            {saving
              ? <ActivityIndicator size="small" color={canSave ? '#FFF' : mc} />
              : <Text style={{ fontSize: 14, fontWeight: '700', color: canSave ? '#FFFFFF' : mc }}>
                  Salvar dados desta safra
                </Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {/* PDF Export — Análise */}
      <View style={{ marginTop: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#1A2C22' : '#EEF3EF' }} />
          <Text style={{ fontSize: 9, fontWeight: '700', color: mc, letterSpacing: 0.5 }}>EXPORTAR</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: isDark ? '#1A2C22' : '#EEF3EF' }} />
        </View>
        <TouchableOpacity
          onPress={async () => {
            setExportingPdf(true);
            try {
              await onExportPdf(vProd, vP);
            } finally {
              setExportingPdf(false);
            }
          }}
          disabled={exportingPdf}
          style={{
            backgroundColor: isDark ? '#1A2C22' : '#EBF5EF',
            borderRadius: 12, paddingVertical: 13,
            alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8,
            borderWidth: 1, borderColor: isDark ? '#2A4832' : '#C8E4D0',
          }}
        >
          {exportingPdf
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <Text style={{ fontSize: 14, fontWeight: '700', color: isDark ? '#7FC49A' : Colors.primary }}>
                Exportar análise em PDF
              </Text>
          }
        </TouchableOpacity>
      </View>
    </Card>
  );
}

// ── SELECTOR BLOCK (comparison side) ─────────────────────────────────────────

function SelectorBlock({ label, side, selectedTalhao: selTal, selectedSafra: selSafra, safraList, onSelectTalhao, onSelectSafra, loading: ld, allTalhoes, isDark, cardBg, border, tc, mc, dadosProducao, onSaveDados, onValuesChange }: {
  label: string; side: 'A' | 'B';
  selectedTalhao: Talhao | undefined; selectedSafra: Safra | undefined; safraList: Safra[];
  onSelectTalhao: (t: Talhao) => void; onSelectSafra: (s: Safra) => void;
  loading: boolean; allTalhoes: Talhao[]; isDark: boolean; cardBg: string; border: string; tc: string; mc: string;
  dadosProducao: SafraDadosProducao | null;
  onSaveDados: (prod: number, preco: number) => Promise<void>;
  onValuesChange: (prod: number, preco: number) => void;
}) {
  const [showTP, setTP] = useState(false), [showSP, setSP] = useState(false);
  const [prodInput, setProd] = useState(''), [precoInput, setPreco] = useState('');
  const accent = side === 'A' ? Colors.primary : '#2196F3';
  const inputBg = isDark ? '#111D16' : '#F4F8F5';

  useEffect(() => {
    if (dadosProducao) {
      const p = toInput(dadosProducao.produtividade_ha);
      const pr = toInput(dadosProducao.preco_soja);
      setProd(p); setPreco(pr);
      onValuesChange(dadosProducao.produtividade_ha, dadosProducao.preco_soja);
    } else if (selSafra) {
      setProd(''); setPreco('');
      onValuesChange(0, 0);
    }
  }, [dadosProducao, selSafra?.id]);

  const vProd = parseBR(prodInput), vPreco = parseBR(precoInput);
  useEffect(() => { onValuesChange(vProd, vPreco); }, [vProd, vPreco]);

  return (
    <KeyboardAvoidingView
      behavior='padding'
      style={{ flex: 1 }}
    >
      <ScrollView keyboardShouldPersistTaps="always" scrollEnabled={false} showsVerticalScrollIndicator={false}>
        <View style={{ flex: 1 }}>
          <View style={{ backgroundColor: accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFF' }}>{label}</Text>
          </View>

          <TouchableOpacity style={{ backgroundColor: isDark ? '#111D16' : '#F4F8F5', borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }} onPress={() => setTP(true)}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 9, color: mc, fontWeight: '600' }}>TALHÃO</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: tc }} numberOfLines={1}>{selTal?.nome ?? 'Selecionar'}</Text>
              {selTal && <Text style={{ fontSize: 10, color: mc }}>{selTal.area_ha} ha</Text>}
            </View>
            <Text style={{ color: mc, fontSize: 14 }}>›</Text>
          </TouchableOpacity>

          {selTal && (
            <TouchableOpacity style={{ backgroundColor: isDark ? '#111D16' : '#F4F8F5', borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }} onPress={() => setSP(true)}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 9, color: mc, fontWeight: '600' }}>SAFRA</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: tc }} numberOfLines={1}>{selSafra?.nome ?? 'Selecionar'}</Text>
                {selSafra && <Text style={{ fontSize: 10, color: mc }}>Ano {selSafra.ano}</Text>}
              </View>
              <Text style={{ color: mc, fontSize: 14 }}>›</Text>
            </TouchableOpacity>
          )}

          {ld && <ActivityIndicator size="small" color={accent} style={{ marginVertical: 4 }} />}

          {selSafra && !ld && (
            <View style={{ marginTop: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: border }} />
                <Text style={{ fontSize: 9, color: mc, marginHorizontal: 6, fontWeight: '700' }}>DADOS DA SAFRA</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: border }} />
              </View>

              {dadosProducao && (
                <View style={{ backgroundColor: isDark ? '#0A1A10' : '#EBF5EF', borderRadius: 8, padding: 7, marginBottom: 8, borderWidth: 1, borderColor: isDark ? '#1A3028' : '#C8E4D0' }}>
                  <Text style={{ fontSize: 9, color: isDark ? '#7FC49A' : Colors.primary, fontWeight: '600' }}>Dados registrados — atualize abaixo se necessário</Text>
                </View>
              )}

              <Text style={{ fontSize: 9, color: mc, marginBottom: 3, fontWeight: '600' }}>PRODUTIVIDADE COLHIDA (sc/ha)</Text>
              <TextInput
                style={{ backgroundColor: inputBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, fontWeight: '600', color: tc, borderWidth: 1, borderColor: border, marginBottom: 6 }}
                placeholder="0"
                placeholderTextColor={mc}
                keyboardType="decimal-pad"
                value={prodInput}
                onChangeText={setProd}
                returnKeyType="next"
                blurOnSubmit={false}
              />

              <Text style={{ fontSize: 9, color: mc, marginBottom: 3, fontWeight: '600' }}>PREÇO SOJA (R$/saca)</Text>
              <TextInput
                style={{ backgroundColor: inputBg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, fontWeight: '600', color: tc, borderWidth: 1, borderColor: border, marginBottom: 8 }}
                placeholder="0,00"
                placeholderTextColor={mc}
                keyboardType="decimal-pad"
                value={precoInput}
                onChangeText={setPreco}
                returnKeyType="done"
              />
              {/* Sem botão de salvar aqui — apenas inputs para comparar */}
            </View>
          )}

          {/* Talhão picker */}
          <Modal visible={showTP} transparent animationType="fade">
            <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 }} activeOpacity={1} onPress={() => setTP(false)}>
              <View style={{ backgroundColor: cardBg, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: border, maxHeight: 400 }}>
                <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: border }}><Text style={{ fontSize: 13, fontWeight: '700', color: tc }}>Talhão — {label}</Text></View>
                <ScrollView>{allTalhoes.map((t, i) => (
                  <TouchableOpacity key={t.id} style={{ padding: 14, borderBottomWidth: i < allTalhoes.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: border, backgroundColor: selTal?.id === t.id ? (isDark ? '#1A2C22' : '#EBF5EF') : 'transparent' }}
                    onPress={() => { onSelectTalhao(t); setTP(false); }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: tc }}>{t.nome}</Text>
                    <Text style={{ fontSize: 12, color: mc }}>{t.area_ha} ha</Text>
                  </TouchableOpacity>
                ))}</ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>

          {/* Safra picker */}
          <Modal visible={showSP} transparent animationType="fade">
            <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 }} activeOpacity={1} onPress={() => setSP(false)}>
              <View style={{ backgroundColor: cardBg, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: border, maxHeight: 400 }}>
                <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: border }}><Text style={{ fontSize: 13, fontWeight: '700', color: tc }}>Safra — {label}</Text></View>
                <ScrollView>
                  {safraList.length === 0
                    ? <View style={{ padding: 20, alignItems: 'center' }}><Text style={{ color: mc }}>Nenhuma safra encontrada</Text></View>
                    : safraList.map((s, i) => (
                      <TouchableOpacity key={s.id} style={{ padding: 14, borderBottomWidth: i < safraList.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: border, backgroundColor: selSafra?.id === s.id ? (isDark ? '#1A2C22' : '#EBF5EF') : 'transparent' }}
                        onPress={() => { onSelectSafra(s); setSP(false); }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: tc }}>{s.nome}</Text>
                        <Text style={{ fontSize: 12, color: mc }}>Ano: {s.ano}</Text>
                      </TouchableOpacity>
                    ))}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Modal>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── MAIN SCREEN ───────────────────────────────────────────────────────────────

export default function GestaoFinanceiraScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { isDark } = useThemeMode();
  const { session } = useAuth();
  const uid = session?.user?.id;

  const [loading, setLoading] = useState(true);
  const [fazendas, setFazendas] = useState<Fazenda[]>([]);
  const [talhoes, setTalhoes] = useState<Talhao[]>([]);
  const [safras, setSafras] = useState<Safra[]>([]);
  const [selectedFazenda, setSelectedFazenda] = useState<Fazenda | null>(null);
  const [selectedTalhao, setSelectedTalhao] = useState<Talhao | null>(null);
  const [selectedSafra, setSelectedSafra] = useState<Safra | null>(null);
  const [insumos, setInsumos] = useState<InsumoItem[]>([]);
  const [custosOp, setCustosOp] = useState<CustoOperacional[]>([]);
  const [showFazPicker, setShowFazPicker] = useState(false);
  const [showTalhaoPicker, setShowTalhaoPicker] = useState(false);
  const [showSafraPicker, setShowSafraPicker] = useState(false);
  const [showAddCusto, setShowAddCusto] = useState(false);
  const [editCusto, setEditCusto] = useState<CustoOperacional | null>(null);
  const [activeTab, setActiveTab] = useState<'insumos' | 'operacional' | 'analise' | 'comparar'>('insumos');
  const [precoSojaRef, setPrecoSojaRef] = useState('');
  const [expandedCotacoes, setExpandedCotacoes] = useState<Set<string>>(new Set());

  // ── Comparison state ───────────────────────────────────────────────────────
  const [allTalhoes, setAllTalhoes] = useState<Talhao[]>([]);
  const [cmpTalA, setCmpTalA] = useState<Talhao | undefined>(undefined);
  const [cmpSafA, setCmpSafA] = useState<Safra | undefined>(undefined);
  const [cmpSafsA, setCmpSafsA] = useState<Safra[]>([]);
  const [cmpDadosA, setCmpDadosA] = useState<SafraDadosProducao | null>(null);
  const [cmpCostA, setCmpCostA] = useState<{ insumos: number; operacional: number } | null>(null);
  const [cmpLoadA, setCmpLoadA] = useState(false);

  const [cmpTalB, setCmpTalB] = useState<Talhao | undefined>(undefined);
  const [cmpSafB, setCmpSafB] = useState<Safra | undefined>(undefined);
  const [cmpSafsB, setCmpSafsB] = useState<Safra[]>([]);
  const [cmpDadosB, setCmpDadosB] = useState<SafraDadosProducao | null>(null);
  const [cmpCostB, setCmpCostB] = useState<{ insumos: number; operacional: number } | null>(null);
  const [cmpLoadB, setCmpLoadB] = useState(false);

  const [cmpLocalA, setCmpLocalA] = useState<{ prod: number; preco: number }>({ prod: 0, preco: 0 });
  const [cmpLocalB, setCmpLocalB] = useState<{ prod: number; preco: number }>({ prod: 0, preco: 0 });
  const [exportingPdf, setExportingPdf] = useState(false);

  const [cmpInsumosA, setCmpInsumosA] = useState<InsumoItem[]>([]);
  const [cmpInsumosB, setCmpInsumosB] = useState<InsumoItem[]>([]);
  const [cmpCustosOpA, setCmpCustosOpA] = useState<CustoOperacional[]>([]);
  const [cmpCustosOpB, setCmpCustosOpB] = useState<CustoOperacional[]>([]);

  // ── Theme ──────────────────────────────────────────────────────────────────
  const bg = isDark ? '#0F1712' : '#F4F8F5', headerBg = isDark ? '#17241C' : Colors.primary;
  const cardBg = isDark ? '#17241C' : '#FFFFFF', border = isDark ? '#1E3028' : '#E8EFE9';
  const tc = isDark ? '#C8DDD2' : '#1A2C22', mc = isDark ? '#3E5A48' : '#8AA898';

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totalInsumosAceitos   = insumos.reduce((s, i) => s + i.valor_ha * i.area_talhao, 0);
  const totalInsumosComprados = insumos.filter(i => i.comprado).reduce((s, i) => s + i.valor_ha * i.area_talhao, 0);
  const totalInsumosPendentes = totalInsumosAceitos - totalInsumosComprados;
  const areaHaTalhao = selectedTalhao?.area_ha ?? 1;
  const totalCustoOp = custosOp.reduce((s, c) => s + c.valor * areaHaTalhao, 0);
  const totalGeral = totalInsumosAceitos + totalCustoOp;
  const compradosCount = insumos.filter(i => i.comprado).length;
  const pendentesCount = insumos.length - compradosCount;

  const initializedRef    = useRef(false);
  const mainScrollRef     = useRef<ScrollView>(null);
  const selectedTalhaoRef = useRef<Talhao | null>(null);
  const selectedSafraRef  = useRef<Safra  | null>(null);
  useEffect(() => { selectedTalhaoRef.current = selectedTalhao; }, [selectedTalhao]);
  useEffect(() => { selectedSafraRef.current  = selectedSafra;  }, [selectedSafra]);

  useFocusEffect(useCallback(() => {
    if (!uid) return;
    if (initializedRef.current) {
      const tal = selectedTalhaoRef.current;
      const saf = selectedSafraRef.current;
      if (tal && saf) {
        fetchInsumos(tal.id);
        fetchCustosOp(tal.id, saf.id);
      }
      return;
    }
    initializedRef.current = true;
    fetchFazendas();
  }, [uid]));

  // ── Fetches ────────────────────────────────────────────────────────────────
  async function fetchFazendas() {
    setLoading(true);
    try {
      const { data } = await supabase.from('fazendas').select('id, nome, area_total_ha').eq('consultor_id', uid).order('nome');
      const list = (data ?? []) as Fazenda[];
      setFazendas(list);
      if (list.length > 0) { setSelectedFazenda(list[0]); fetchTalhoes(list[0].id, list[0]); }
      else setLoading(false);
    } catch { setLoading(false); }
  }

  async function fetchTalhoes(fazendaId: string, fazendaOverride?: Fazenda) {
    try {
      const { data } = await supabase.from('talhoes').select('id, nome, area_ha, fazenda_id').eq('fazenda_id', fazendaId).order('nome');
      const list = (data ?? []) as Talhao[];
      setTalhoes(list); setAllTalhoes(list);
      if (list.length > 0) { setSelectedTalhao(list[0]); fetchSafras(list[0].id, fazendaOverride, list[0]); }
      else { setTalhoes([]); setSelectedTalhao(null); setSafras([]); setSelectedSafra(null); setInsumos([]); setCustosOp([]); setLoading(false); return; }
    } catch { setLoading(false); }
  }

  async function fetchSafras(talhaoId: string, fazendaOverride?: Fazenda, talhaoOverride?: Talhao) {
    try {
      const { data } = await supabase.from('safras').select('id, nome, ano, talhao_id, data_inicio, data_fim').eq('talhao_id', talhaoId).order('ano', { ascending: false });
      let list = (data ?? []) as Safra[];
      if (list.length === 0) {
        const ano = new Date().getFullYear();
        const { data: nova } = await supabase.from('safras').insert({ nome: `Safra ${ano}`, ano: ano.toString(), talhao_id: talhaoId, data_inicio: `${ano}-01-01` }).select().single();
        if (nova) list = [nova as Safra];
      }
      setSafras(list);
      if (list.length > 0) {
        setSelectedSafra(list[0]);
        // Insumos e custos em paralelo — elimina uma viagem serial ao banco
        await Promise.all([
          fetchInsumos(talhaoId, fazendaOverride, talhaoOverride),
          fetchCustosOp(talhaoId, list[0].id),
        ]);
      } else {
        setSafras([]); setSelectedSafra(null); setInsumos([]); setCustosOp([]); setLoading(false);
      }
    } catch { setLoading(false); }
  }

  async function fetchInsumos(talhaoId: string, fazendaOverride?: Fazenda, talhaoOverride?: Talhao) {
    const fazenda = fazendaOverride ?? selectedFazenda;
    if (!fazenda) { setLoading(false); return; }
    // Área do talhão como fallback quando a cotação não tem area_ha próprio
    const areaFallback = (talhaoOverride ?? selectedTalhao)?.area_ha ?? 1;
    setLoading(true);
    try {
      // Busca TODAS as cotações aprovadas da fazenda (sem filtrar por talhão)
      // e todos os talhões da fazenda em paralelo para área correta por cotação
      const [cotsRes, talhoesRes] = await Promise.all([
        supabase.from('cotacoes').select('id, titulo, area_ha, talhao_id, proposta_aceita_id').eq('fazenda_id', fazenda.id).in('status', ['aprovada', 'aprovado']),
        supabase.from('talhoes').select('id, area_ha').eq('fazenda_id', fazenda.id),
      ]);
      const talhaoAreaMap: Record<string, number> = {};
      (talhoesRes.data ?? []).forEach((t: any) => { talhaoAreaMap[t.id] = Number(t.area_ha ?? 0); });
      const cots = cotsRes.data as any[] | null;
      if (!cots || cots.length === 0) { setInsumos([]); setLoading(false); return; }
      const ids = cots.map(c => c.id);
      const cotsArea = cots.map(c => ({
        id: c.id, titulo: c.titulo ?? '', proposta_aceita_id: c.proposta_aceita_id ?? null,
        area_ha: Number(c.area_ha ?? 0) > 0
          ? Number(c.area_ha)
          : (c.talhao_id && talhaoAreaMap[c.talhao_id] > 0 ? talhaoAreaMap[c.talhao_id] : areaFallback),
      }));
      const propostaIds = cots.filter(c => c.proposta_aceita_id).map(c => c.proposta_aceita_id);
      const [itdRes, propostasRes] = await Promise.all([
        supabase.from('itens_cotacao')
          .select('id, produto_nome, categoria, valor_ha, cotacao_id, comprado, fornecedor, dose_ha')
          .in('cotacao_id', ids).gt('valor_ha', 0),
        propostaIds.length > 0
          ? supabase.from('propostas_fornecedor').select('id, itens_json').in('id', propostaIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const propostaItemMap: Record<string, any> = {};
      ((propostasRes.data ?? []) as any[]).forEach((p: any) => {
        ((p.itens_json ?? []) as any[]).forEach((item: any) => { if (item.id) propostaItemMap[item.id] = item; });
      });
      setInsumos(((itdRes.data ?? []) as any[]).map((i: any) => {
        const cot = cotsArea.find(c => c.id === i.cotacao_id);
        const pi = propostaItemMap[i.id];
        const isAlt = !!(pi && pi.disponivel === false && pi.alternativa?.nome);
        return {
          id: i.id, nome: i.produto_nome ?? 'Produto', categoria: i.categoria ?? 'Insumo',
          valor_ha: i.valor_ha ?? 0, cotacao_id: i.cotacao_id, cotacao_titulo: cot?.titulo ?? '',
          comprado: i.comprado ?? false, area_talhao: cot?.area_ha ?? areaFallback,
          fornecedor: i.fornecedor ?? undefined,
          dose_ha: (i.dose_ha != null && Number(i.dose_ha) > 0) ? Number(i.dose_ha) : undefined,
          isAlternativa: isAlt,
          produtoOriginal: isAlt ? (pi?.produto ?? '') : undefined,
          doseOriginal: isAlt ? (parseFloat(String(pi?.dose_orig || pi?.dose || '').replace(',', '.')) || undefined) : undefined,
        };
      }));
    } catch (e) { console.warn(e); }
    finally { setLoading(false); }
  }

  async function fetchCustosOp(talhaoId: string, safraId: string) {
    try {
      const { data } = await supabase
        .from('gestao_custos_operacionais')
        .select('id, descricao, valor, unidade, valor_original, preco_soja_ref, talhao_id, safra_id')
        .eq('talhao_id', talhaoId)
        .or(`safra_id.eq.${safraId},safra_id.is.null`);

      setCustosOp((data ?? []).map((c: any): CustoOperacional => ({
        id:             c.id,
        descricao:      c.descricao ?? '',
        valor:          Number(c.valor ?? 0),
        unidade:        (c.unidade ?? 'reais') as UnidadeCusto,
        valor_original: Number(c.valor_original ?? 0),
        preco_soja_ref: Number(c.preco_soja_ref ?? 0),
        talhao_id:      c.talhao_id,
        safra_id:       c.safra_id,
      })));
    } catch { /* ignore */ }
  }

  async function fetchSafraDados(safraId: string): Promise<SafraDadosProducao | null> {
    try {
      const { data } = await supabase.from('safra_dados_producao').select('produtividade_ha, preco_soja').eq('safra_id', safraId).single();
      if (!data) return null;
      return { produtividade_ha: Number((data as any).produtividade_ha ?? 0), preco_soja: Number((data as any).preco_soja ?? 0) };
    } catch { return null; }
  }

  async function saveSafraDados(safraId: string, produtividade_ha: number, preco_soja: number): Promise<boolean> {
    try {
      const { error } = await supabase.from('safra_dados_producao').upsert({ safra_id: safraId, consultor_id: uid, produtividade_ha, preco_soja, updated_at: new Date().toISOString() }, { onConflict: 'safra_id' });
      return !error;
    } catch { return false; }
  }

  async function loadCmpCosts(talhaoId: string, safraId: string, areaHa: number): Promise<{ insumos: number; operacional: number }> {
    let ins = 0;
    try {
      const { data: cots } = await supabase.from('cotacoes').select('id, area_ha').eq('talhao_id', talhaoId).in('status', ['aprovada', 'aprovado']);
      if (cots && cots.length > 0) {
        const ids = (cots as any[]).map(c => c.id);
        const { data: it } = await supabase.from('itens_cotacao').select('valor_ha, cotacao_id').in('cotacao_id', ids);
        if (it) ins = (it as any[]).reduce((s, item) => { const cot = (cots as any[]).find(c => c.id === item.cotacao_id); const a = Number(cot?.area_ha ?? areaHa); return s + Number(item.valor_ha ?? 0) * (a > 0 ? a : areaHa); }, 0);
      }
    } catch { /* ignore */ }
    let op = 0;
    try {
      const { data } = await supabase.from('gestao_custos_operacionais').select('valor').eq('talhao_id', talhaoId).or(`safra_id.eq.${safraId},safra_id.is.null`);
      if (data) op = (data as any[]).reduce((s, c) => s + c.valor * areaHa, 0);
    } catch { /* ignore */ }
    return { insumos: ins, operacional: op };
  }

  async function loadCmpInsumosDetalhado(talhaoId: string): Promise<InsumoItem[]> {
    try {
      const { data: cots } = await supabase.from('cotacoes').select('id, titulo, area_ha, talhao_id, proposta_aceita_id').eq('talhao_id', talhaoId).in('status', ['aprovada', 'aprovado']);
      if (!cots || cots.length === 0) return [];
      const ids = (cots as any[]).map(c => c.id);
      const cotsArea = await Promise.all((cots as any[]).map(async (cot) => {
        let a = Number(cot.area_ha ?? 0);
        if (a <= 0 && cot.talhao_id) { const { data: t } = await supabase.from('talhoes').select('area_ha').eq('id', cot.talhao_id).single(); if (t?.area_ha) a = Number(t.area_ha); }
        return { id: cot.id, titulo: cot.titulo, area_ha: a > 0 ? a : 1, proposta_aceita_id: cot.proposta_aceita_id ?? null };
      }));
      const propostaIds = cotsArea.filter(c => c.proposta_aceita_id).map(c => c.proposta_aceita_id);
      const [itdRes, propostasRes] = await Promise.all([
        supabase.from('itens_cotacao').select('id, produto_nome, categoria, valor_ha, cotacao_id, comprado, fornecedor, dose_ha').in('cotacao_id', ids).gt('valor_ha', 0),
        propostaIds.length > 0 ? supabase.from('propostas_fornecedor').select('id, itens_json').in('id', propostaIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const propostaItemMap: Record<string, any> = {};
      ((propostasRes.data ?? []) as any[]).forEach((p: any) => {
        ((p.itens_json ?? []) as any[]).forEach((item: any) => { if (item.id) propostaItemMap[item.id] = item; });
      });
      return ((itdRes.data ?? []) as any[]).map((i: any) => {
        const cot = cotsArea.find(c => c.id === i.cotacao_id);
        const pi = propostaItemMap[i.id];
        const isAlt = !!(pi && pi.disponivel === false && pi.alternativa?.nome);
        return {
          id: i.id, nome: i.produto_nome ?? 'Produto', categoria: i.categoria ?? 'Insumo',
          valor_ha: i.valor_ha ?? 0, cotacao_id: i.cotacao_id, cotacao_titulo: cot?.titulo ?? '',
          comprado: i.comprado ?? false, area_talhao: cot?.area_ha ?? 1,
          fornecedor: i.fornecedor ?? undefined,
          dose_ha: (i.dose_ha != null && Number(i.dose_ha) > 0) ? Number(i.dose_ha) : undefined,
          isAlternativa: isAlt,
          produtoOriginal: isAlt ? (pi?.produto ?? '') : undefined,
          doseOriginal: isAlt ? (parseFloat(String(pi?.dose_orig || pi?.dose || '').replace(',', '.')) || undefined) : undefined,
        };
      });
    } catch { return []; }
  }

  async function loadCmpCustosOpDetalhado(talhaoId: string, safraId: string): Promise<CustoOperacional[]> {
    try {
      const { data } = await supabase.from('gestao_custos_operacionais').select('id, descricao, valor, unidade, valor_original, preco_soja_ref, talhao_id, safra_id').eq('talhao_id', talhaoId).or(`safra_id.eq.${safraId},safra_id.is.null`);
      return ((data ?? []) as any[]).map((c: any): CustoOperacional => ({
        id: c.id,
        descricao: c.descricao ?? '',
        valor: Number(c.valor ?? 0),
        unidade: (c.unidade ?? 'reais') as UnidadeCusto,
        valor_original: Number(c.valor_original ?? 0),
        preco_soja_ref: Number(c.preco_soja_ref ?? 0),
        talhao_id: c.talhao_id,
        safra_id: c.safra_id,
      }));
    } catch { return []; }
  }

  async function handleSelectTalhaoSide(side: 'A' | 'B', t: Talhao) {
    if (side === 'A') { setCmpTalA(t); setCmpSafA(undefined); setCmpCostA(null); setCmpDadosA(null); }
    else              { setCmpTalB(t); setCmpSafB(undefined); setCmpCostB(null); setCmpDadosB(null); }
    const { data } = await supabase.from('safras').select('id, nome, ano, talhao_id').eq('talhao_id', t.id).order('ano', { ascending: false });
    if (side === 'A') setCmpSafsA((data ?? []) as Safra[]);
    else              setCmpSafsB((data ?? []) as Safra[]);
  }

  async function handleSelectSafraSide(side: 'A' | 'B', s: Safra, t: Talhao) {
    const setLoad    = side === 'A' ? setCmpLoadA    : setCmpLoadB;
    const setCosts   = side === 'A' ? setCmpCostA    : setCmpCostB;
    const setDados   = side === 'A' ? setCmpDadosA   : setCmpDadosB;
    const setSafra   = side === 'A' ? setCmpSafA     : setCmpSafB;
    const setInsList = side === 'A' ? setCmpInsumosA : setCmpInsumosB;
    const setCustList= side === 'A' ? setCmpCustosOpA: setCmpCustosOpB;
    setSafra(s); setLoad(true);
    const [costs, dados, insList, custList] = await Promise.all([
      loadCmpCosts(t.id, s.id, t.area_ha),
      fetchSafraDados(s.id),
      loadCmpInsumosDetalhado(t.id),
      loadCmpCustosOpDetalhado(t.id, s.id),
    ]);
    setCosts(costs); setDados(dados);
    setInsList(insList); setCustList(custList);
    setLoad(false);
  }

  async function handleSaveDadosSide(side: 'A' | 'B', prod: number, preco: number) {
    const safra = side === 'A' ? cmpSafA : cmpSafB;
    if (!safra) return;
    const ok = await saveSafraDados(safra.id, prod, preco);
    if (ok) {
      const nd: SafraDadosProducao = { produtividade_ha: prod, preco_soja: preco };
      if (side === 'A') setCmpDadosA(nd); else setCmpDadosB(nd);
    }
  }

  function calcMargin(costs: { insumos: number; operacional: number } | null, prod: number, preco: number, area: number) {
    if (!costs || prod <= 0 || preco <= 0) return null;
    const custo = costs.insumos + costs.operacional;
    const receita = area * prod * preco;
    const lucro = receita - custo;
    const pontoNivelamento = preco > 0 ? (area > 0 ? custo / area : 0) / preco : 0;
    const margemSeguranca = receita > 0 ? (lucro / receita) * 100 : 0;
    return { custo, receita, lucro, custoHa: area > 0 ? custo / area : 0, lucroHa: area > 0 ? lucro / area : 0, pontoNivelamento, margemSeguranca };
  }
  const resA = calcMargin(cmpCostA, cmpLocalA.prod, cmpLocalA.preco, cmpTalA?.area_ha ?? 1);
  const resB = calcMargin(cmpCostB, cmpLocalB.prod, cmpLocalB.preco, cmpTalB?.area_ha ?? 1);

  const handleFazendaChange = (f: Fazenda) => { setSelectedFazenda(f); setSelectedTalhao(null); setSelectedSafra(null); setInsumos([]); setCustosOp([]); setShowFazPicker(false); fetchTalhoes(f.id, f); };
  const handleTalhaoChange  = (t: Talhao)  => { setSelectedTalhao(t); setSelectedSafra(null); setInsumos([]); setCustosOp([]); setShowTalhaoPicker(false); fetchSafras(t.id, undefined, t); };
  const handleSafraChange   = (s: Safra)   => { setSelectedSafra(s); setShowSafraPicker(false); if (selectedTalhao) { fetchInsumos(selectedTalhao.id); fetchCustosOp(selectedTalhao.id, s.id); } };

  async function handleToggleComprado(id: string, comprado: boolean) {
    // Optimistic: atualiza UI imediatamente sem esperar o banco
    setInsumos(prev => prev.map(i => i.id === id ? { ...i, comprado } : i));
    const { error } = await supabase.from('itens_cotacao').update({ comprado }).eq('id', id);
    if (error) {
      // Reverte apenas se falhou
      setInsumos(prev => prev.map(i => i.id === id ? { ...i, comprado: !comprado } : i));
    }
  }

  async function handleSaveCusto(item: Omit<CustoOperacional, 'id'>) {
    if (!selectedTalhao || !selectedSafra) {
      Alert.alert('Atenção', 'Selecione um talhão e uma safra antes de adicionar custos.');
      return;
    }
    try {
      const payload = {
        descricao:      item.descricao,
        valor:          item.valor,         // coluna "valor" = R$/ha
        unidade:        item.unidade,
        valor_original: item.valor_original,
        preco_soja_ref: item.preco_soja_ref,
        talhao_id:      selectedTalhao.id,
        safra_id:       selectedSafra.id,
        consultor_id:   uid,
      };

      if (editCusto) {
        const { error } = await supabase
          .from('gestao_custos_operacionais')
          .update(payload)
          .eq('id', editCusto.id);

        if (error) throw error;

        // Atualiza localmente
        const updated: CustoOperacional = {
          id:             editCusto.id,
          descricao:      item.descricao,
          valor:          item.valor,
          unidade:        item.unidade,
          valor_original: item.valor_original,
          preco_soja_ref: item.preco_soja_ref,
          talhao_id:      selectedTalhao.id,
          safra_id:       selectedSafra.id,
        };
        setCustosOp(prev => prev.map(c => c.id === editCusto.id ? updated : c));
      } else {
        const { data, error } = await supabase
          .from('gestao_custos_operacionais')
          .insert(payload)
          .select('id')
          .single();

        if (error) throw error;

        const newItem: CustoOperacional = {
          id:             (data as any).id,
          descricao:      item.descricao,
          valor:          item.valor,
          unidade:        item.unidade,
          valor_original: item.valor_original,
          preco_soja_ref: item.preco_soja_ref,
          talhao_id:      selectedTalhao.id,
          safra_id:       selectedSafra.id,
        };
        setCustosOp(prev => [...prev, newItem]);
      }

      setShowAddCusto(false);
      setEditCusto(null);
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Não foi possível salvar o custo. Tente novamente.');
    }
  }

  async function handleDeleteCusto(id: string) {
    Alert.alert('Confirmar', 'Excluir este custo?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('gestao_custos_operacionais').delete().eq('id', id);
        if (!error) setCustosOp(prev => prev.filter(c => c.id !== id));
      }},
    ]);
  }

  // ── Fetch consultor info for PDFs ──────────────────────────────────────────
  async function fetchConsultorInfo() {
    try {
      const { data } = await supabase.from('profiles').select('name, company_name, cnpj, phone').eq('id', uid).single();
      if (data) return { consultorNome: (data as any).name, companyName: (data as any).company_name, cnpj: (data as any).cnpj, phone: (data as any).phone };
    } catch { /* ignore */ }
    return undefined;
  }

  async function fetchProdutorNome(fazendaId: string): Promise<string | undefined> {
    try {
      const { data } = await supabase.from('fazendas').select('produtor_nome').eq('id', fazendaId).single();
      return (data as any)?.produtor_nome ?? undefined;
    } catch { return undefined; }
  }

  // ── Export Analise PDF ─────────────────────────────────────────────────────
  async function handleExportAnalisePdf(produtividade: number, preco: number) {
    if (!selectedTalhao) { Alert.alert('Atenção', 'Selecione um talhão antes de exportar.'); return; }
    try {
      const [consultorEmpresa, produtorNome] = await Promise.all([
        fetchConsultorInfo(),
        selectedFazenda ? fetchProdutorNome(selectedFazenda.id) : Promise.resolve(undefined),
      ]);
      const areaHa = selectedTalhao.area_ha;
      const custo = totalInsumosAceitos + totalCustoOp;
      const receita = produtividade > 0 && preco > 0 ? areaHa * produtividade * preco : undefined;
      const lucro = receita != null ? receita - custo : undefined;
      const custoHa = areaHa > 0 ? custo / areaHa : 0;
      const lucroHa = lucro != null && areaHa > 0 ? lucro / areaHa : undefined;
      const ptoNivel = preco > 0 ? custoHa / preco : undefined;
      const margemSeguranca = receita != null && receita > 0 && lucro != null ? (lucro / receita) * 100 : undefined;

      await exportarGestaoAnalisePdf({
        consultorEmpresa,
        fazendaNome: selectedFazenda?.nome,
        produtorNome,
        talhaoNome: selectedTalhao.nome,
        safraNome: selectedSafra?.nome,
        areaHa,
        insumos: insumos.map(i => ({
          nome: i.nome,
          categoria: i.categoria,
          valorHa: i.valor_ha,
          areaHa: i.area_talhao,
          total: i.valor_ha * i.area_talhao,
          comprado: i.comprado,
          cotacaoTitulo: i.cotacao_titulo,
          fornecedor: i.fornecedor,
          dose_ha: i.dose_ha,
          isAlternativa: i.isAlternativa,
          produtoOriginal: i.produtoOriginal,
          doseOriginal: i.doseOriginal,
        })),
        custosOp: custosOp.map(c => ({
          descricao: c.descricao,
          valorHa: c.valor,
          areaHa,
          total: c.valor * areaHa,
          unidade: c.unidade,
          valorOriginal: c.valor_original,
          precoSojaRef: c.preco_soja_ref,
        })),
        totalInsumos: totalInsumosAceitos,
        totalOperacional: totalCustoOp,
        totalGeral: custo,
        totalInsumosComprados,
        totalInsumosPendentes,
        produtividade_ha: produtividade > 0 ? produtividade : undefined,
        preco_soja: preco > 0 ? preco : undefined,
        receita,
        lucro,
        custoHa,
        lucroHa,
        pontoNivelamento: ptoNivel,
        margemSeguranca,
        dataGeracao: new Date(),
      });
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Não foi possível gerar o PDF.');
    }
  }

  // ── Pickers ────────────────────────────────────────────────────────────────
  const renderPicker = (visible: boolean, onClose: () => void, title: string, items: { id: string; line1: string; line2?: string; selected: boolean; onPress: () => void }[]) => (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 }} activeOpacity={1} onPress={onClose}>
        <View style={{ backgroundColor: cardBg, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: border }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: border }}><Text style={{ fontSize: 13, fontWeight: '700', color: tc }}>{title}</Text></View>
          {items.length === 0
            ? <View style={{ padding: 24, alignItems: 'center' }}><Text style={{ fontSize: 14, color: tc }}>Nenhum item cadastrado</Text></View>
            : items.map((item, i) => (
              <TouchableOpacity key={item.id} style={{ paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: i < items.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: border, backgroundColor: item.selected ? (isDark ? '#1A2C22' : '#EBF5EF') : 'transparent' }} onPress={item.onPress}>
                <View>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: tc }}>{item.line1}</Text>
                  {item.line2 ? <Text style={{ fontSize: 12, color: mc, marginTop: 2 }}>{item.line2}</Text> : null}
                </View>
                {item.selected && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary }} />}
              </TouchableOpacity>
            ))}
        </View>
      </TouchableOpacity>
    </Modal>
  );

  // ── Tab renders ────────────────────────────────────────────────────────────
  const renderInsumos = () => {
    // Agrupa insumos por cotação
    const grupos: Record<string, { titulo: string; itens: InsumoItem[]; total: number; totalComprado: number }> = {};
    insumos.forEach(item => {
      const key = item.cotacao_id;
      if (!grupos[key]) grupos[key] = { titulo: item.cotacao_titulo || 'Cotação', itens: [], total: 0, totalComprado: 0 };
      grupos[key].itens.push(item);
      grupos[key].total += item.valor_ha * item.area_talhao;
      if (item.comprado) grupos[key].totalComprado += item.valor_ha * item.area_talhao;
    });
    const gruposList = Object.entries(grupos);
    const multiplosCotacoes = gruposList.length > 1;

    const toggleCotacao = (id: string) => {
      setExpandedCotacoes(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    };

    return (
      <View>
        {/* KPIs */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          {[{ label: 'Total aceito', value: fmtBRL(totalInsumosAceitos), sub: `${insumos.length} itens`, stripe: Colors.primary },
            { label: 'Comprados', value: fmtBRL(totalInsumosComprados), sub: `${compradosCount} itens`, stripe: Colors.success },
            { label: 'Pendentes', value: fmtBRL(totalInsumosPendentes), sub: `${pendentesCount} itens`, stripe: '#C8900A' }].map((s, i) => (
            <View key={i} style={{ flex: 1, backgroundColor: cardBg, borderRadius: 14, borderWidth: 1, borderColor: border, padding: 12, borderTopWidth: 3, borderTopColor: s.stripe }}>
              <Text style={{ fontSize: 10, fontWeight: '600', color: mc, letterSpacing: 0.4 }}>{s.label}</Text>
              <Text style={{ fontSize: 13, fontWeight: '800', color: tc, marginTop: 4 }}>{s.value}</Text>
              <Text style={{ fontSize: 11, color: mc, marginTop: 2 }}>{s.sub}</Text>
            </View>
          ))}
        </View>

        {loading
          ? <Card isDark={isDark}><ActivityIndicator color={Colors.primary} /></Card>
          : insumos.length === 0
            ? (
              <Card isDark={isDark}>
                <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: tc }}>Nenhum insumo encontrado</Text>
                  <Text style={{ fontSize: 13, color: mc, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>Os insumos aparecem quando uma cotação é aprovada para este talhão.</Text>
                </View>
              </Card>
            )
            : multiplosCotacoes
              // ─── Múltiplas cotações: seções expansíveis por cotação ───────────────
              ? (
                <View style={{ gap: 8 }}>
                  {gruposList.map(([cotId, grupo]) => {
                    const isOpen = expandedCotacoes.has(cotId);
                    const pctComprado = grupo.total > 0 ? (grupo.totalComprado / grupo.total) * 100 : 0;
                    return (
                      <View key={cotId} style={{ backgroundColor: cardBg, borderRadius: 14, borderWidth: 1, borderColor: border, overflow: 'hidden' }}>
                        {/* Cabeçalho expansível */}
                        <TouchableOpacity
                          onPress={() => toggleCotacao(cotId)}
                          activeOpacity={0.75}
                          style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: isOpen ? StyleSheet.hairlineWidth : 0, borderBottomColor: border }}
                        >
                          <View style={{ width: 3, height: 36, borderRadius: 2, backgroundColor: Colors.primary, flexShrink: 0 }} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: tc }} numberOfLines={1}>{grupo.titulo}</Text>
                            <Text style={{ fontSize: 11, color: mc, marginTop: 2 }}>{grupo.itens.length} insumo{grupo.itens.length !== 1 ? 's' : ''} · {Math.round(pctComprado)}% comprado</Text>
                            {/* Barra de progresso de compra */}
                            <View style={{ height: 3, backgroundColor: isDark ? '#1A2C22' : '#EEF3EF', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
                              <View style={{ height: '100%', width: `${Math.max(pctComprado, pctComprado > 0 ? 4 : 0)}%`, backgroundColor: Colors.success, borderRadius: 2 }} />
                            </View>
                          </View>
                          <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                            <Text style={{ fontSize: 13, fontWeight: '800', color: tc }}>{fmtBRL(grupo.total)}</Text>
                            <Text style={{ fontSize: 11, color: isOpen ? mc : Colors.primary, fontWeight: '600', marginTop: 3 }}>{isOpen ? 'Recolher ▲' : 'Expandir ▼'}</Text>
                          </View>
                        </TouchableOpacity>
                        {/* Itens expandidos */}
                        {isOpen && (
                          <View style={{ paddingHorizontal: 14 }}>
                            {grupo.itens.map(item => (
                              <InsumoRow key={item.id} item={item} isDark={isDark} onToggle={handleToggleComprado} />
                            ))}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )
              // ─── Cotação única: lista plana (sem cabeçalho expansível) ───────────
              : (
                <Card isDark={isDark}>
                  {gruposList[0] && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? '#1A2C22' : '#EEF3EF' }}>
                      <View style={{ width: 3, height: 30, borderRadius: 2, backgroundColor: Colors.primary }} />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: tc, flex: 1 }} numberOfLines={1}>{gruposList[0][1].titulo}</Text>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: tc }}>{fmtBRL(gruposList[0][1].total)}</Text>
                    </View>
                  )}
                  {insumos.map(item => (
                    <InsumoRow key={item.id} item={item} isDark={isDark} onToggle={handleToggleComprado} />
                  ))}
                </Card>
              )
        }
      </View>
    );
  };

  const renderOperacional = () => (
    <View>
      <View style={{ backgroundColor: isDark ? '#0D1C13' : '#EBF5EF', borderRadius: 14, borderWidth: 1, borderColor: isDark ? '#1A3028' : '#C8E4D0', padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontSize: 12, fontWeight: '600', color: mc }}>Total operacional</Text>
          <Text style={{ fontSize: 22, fontWeight: '800', color: Colors.primary, marginTop: 4 }}>{fmtBRL(totalCustoOp)}</Text>
          {selectedTalhao && <Text style={{ fontSize: 12, color: mc, marginTop: 2 }}>{fmtBRL(totalCustoOp / selectedTalhao.area_ha)}/ha</Text>}
        </View>
        <TouchableOpacity style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 }} onPress={() => { setEditCusto(null); setShowAddCusto(true); }} disabled={!selectedTalhao}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>+ Adicionar</Text>
        </TouchableOpacity>
      </View>

      <Card isDark={isDark}>
        {custosOp.length === 0
          ? <View style={{ alignItems: 'center', paddingVertical: 24 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: tc }}>Nenhum custo registrado</Text>
              <Text style={{ fontSize: 13, color: mc, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>Adicione mecanização, mão de obra, combustível etc.</Text>
            </View>
          : custosOp.map(item => <CustoRow key={item.id} item={item} isDark={isDark} areaHa={areaHaTalhao} onEdit={(i) => { setEditCusto(i); setShowAddCusto(true); }} onDelete={handleDeleteCusto} />)}
      </Card>
    </View>
  );

  const renderAnalise = () => (
    <View>
      <View style={{ backgroundColor: isDark ? '#0D1C13' : '#EBF5EF', borderRadius: 16, borderWidth: 1, borderColor: isDark ? '#1A3028' : '#C8E4D0', padding: 16, marginBottom: 10 }}>
        <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: mc, marginBottom: 10 }}>RESUMO GERAL</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {[{ label: 'Insumos', value: fmtBRL(totalInsumosAceitos) }, { label: 'Operacional', value: fmtBRL(totalCustoOp) }, { label: 'Total', value: fmtBRL(totalGeral) }].map((s, i) => (
            <View key={i} style={{ alignItems: 'center' }}><Text style={{ fontSize: 11, color: mc }}>{s.label}</Text><Text style={{ fontSize: 14, fontWeight: '800', color: tc, marginTop: 4 }}>{s.value}</Text></View>
          ))}
        </View>
      </View>
      <Card isDark={isDark}>
        <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: mc, marginBottom: 16 }}>DISTRIBUIÇÃO DE CUSTOS</Text>
        <VerticalBarChart data={[{ label: 'Insumos', value: totalInsumosAceitos, color: Colors.primary }, { label: 'Operacional', value: totalCustoOp, color: '#2196F3' }, { label: 'Comprados', value: totalInsumosComprados, color: Colors.success }, { label: 'Pendentes', value: totalInsumosPendentes, color: '#FFC107' }]} isDark={isDark} />
      </Card>
      <Card isDark={isDark}>
        <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: mc, marginBottom: 16 }}>COMPOSIÇÃO DOS CUSTOS</Text>
        <View style={{ alignItems: 'center', marginBottom: 16 }}><PieChart data={[{ label: 'Insumos', value: totalInsumosAceitos, color: Colors.primary }, { label: 'Operacional', value: totalCustoOp, color: '#2196F3' }]} size={180} isDark={isDark} /></View>
        {[{ label: 'Insumos', value: totalInsumosAceitos, color: Colors.primary }, { label: 'Operacional', value: totalCustoOp, color: '#2196F3' }].map((seg, i) => {
          const pct = totalGeral > 0 ? (seg.value / totalGeral) * 100 : 0;
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 12 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: seg.color }} />
              <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: tc }}>{seg.label}</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: tc }}>{pct.toFixed(1)}%</Text>
              <Text style={{ fontSize: 12, color: mc, minWidth: 90, textAlign: 'right' }}>{fmtBRL(seg.value)}</Text>
            </View>
          );
        })}
      </Card>
      <Card isDark={isDark}>
        <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: mc, marginBottom: 16 }}>STATUS DE COMPRAS</Text>
        <VerticalBarChart data={[{ label: 'Comprados', value: totalInsumosComprados, color: Colors.success }, { label: 'Pendentes', value: totalInsumosPendentes, color: '#FFC107' }]} isDark={isDark} />
        <View style={{ marginTop: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: isDark ? '#1A2C22' : '#EEF3EF', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: mc }}>{compradosCount}/{insumos.length} itens comprados</Text>
          <View style={{ backgroundColor: compradosCount === insumos.length && insumos.length > 0 ? Colors.success : (isDark ? '#1A2C22' : '#EEF3EF'), borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: compradosCount === insumos.length && insumos.length > 0 ? '#FFF' : mc }}>{insumos.length > 0 ? `${Math.round((compradosCount / insumos.length) * 100)}%` : '-'}</Text>
          </View>
        </View>
      </Card>
      <NivelamentoInline
        isDark={isDark} cardBg={cardBg} border={border} tc={tc} mc={mc}
        custoInsumos={totalInsumosAceitos} custoOperacional={totalCustoOp}
        talhoes={talhoes} selectedTalhao={selectedTalhao}
        safra={selectedSafra} uid={uid}
        mainScrollRef={mainScrollRef}
        onExportPdf={handleExportAnalisePdf}
      />
    </View>
  );

  const renderComparar = () => {
    const canCompare = resA !== null && resB !== null && cmpSafA != null && cmpSafB != null;
    const labelA = cmpSafA ? `${cmpTalA?.nome ?? 'A'}\n${cmpSafA.nome}` : (cmpTalA?.nome ?? 'A');
    const labelB = cmpSafB ? `${cmpTalB?.nome ?? 'B'}\n${cmpSafB.nome}` : (cmpTalB?.nome ?? 'B');

    const areaA = cmpTalA?.area_ha ?? 1;
    const areaB = cmpTalB?.area_ha ?? 1;
    const pontoNivelA = cmpLocalA.preco > 0 && resA ? resA.pontoNivelamento : 0;
    const pontoNivelB = cmpLocalB.preco > 0 && resB ? resB.pontoNivelamento : 0;

    return (
      <View>
        <Card isDark={isDark}>
          <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: mc, marginBottom: 4 }}>COMPARAR CENÁRIOS</Text>
          <Text style={{ fontSize: 11, color: mc, marginBottom: 14, lineHeight: 17 }}>
            Selecione talhão, safra e informe produtividade e preço da soja. Se os dados já foram salvos, serão preenchidos automaticamente.
          </Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <SelectorBlock
              label="Cenário A" side="A"
              selectedTalhao={cmpTalA} selectedSafra={cmpSafA} safraList={cmpSafsA}
              allTalhoes={allTalhoes} loading={cmpLoadA} dadosProducao={cmpDadosA}
              isDark={isDark} cardBg={cardBg} border={border} tc={tc} mc={mc}
              onSelectTalhao={(t) => handleSelectTalhaoSide('A', t)}
              onSelectSafra={(s) => { if (cmpTalA) handleSelectSafraSide('A', s, cmpTalA); }}
              onSaveDados={(p, pr) => handleSaveDadosSide('A', p, pr)}
              onValuesChange={(p, pr) => setCmpLocalA({ prod: p, preco: pr })}
            />
            <View style={{ width: 1, backgroundColor: border }} />
            <SelectorBlock
              label="Cenário B" side="B"
              selectedTalhao={cmpTalB} selectedSafra={cmpSafB} safraList={cmpSafsB}
              allTalhoes={allTalhoes} loading={cmpLoadB} dadosProducao={cmpDadosB}
              isDark={isDark} cardBg={cardBg} border={border} tc={tc} mc={mc}
              onSelectTalhao={(t) => handleSelectTalhaoSide('B', t)}
              onSelectSafra={(s) => { if (cmpTalB) handleSelectSafraSide('B', s, cmpTalB); }}
              onSaveDados={(p, pr) => handleSaveDadosSide('B', p, pr)}
              onValuesChange={(p, pr) => setCmpLocalB({ prod: p, preco: pr })}
            />
          </View>
        </Card>

        {(cmpSafA || cmpSafB) && !canCompare && (
          <View style={{ backgroundColor: isDark ? '#111828' : '#F0F4FF', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: isDark ? '#2028A0' : '#C0C8F0' }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: isDark ? '#8888CC' : '#4455AA', marginBottom: 2 }}>Para mostrar os gráficos:</Text>
            <Text style={{ fontSize: 11, color: isDark ? '#6666AA' : '#5566BB', lineHeight: 17 }}>
              {[
                !cmpSafA                           && '  Selecione talhão e safra no Cenário A',
                cmpSafA && cmpLocalA.prod  <= 0    && '  Informe produtividade no Cenário A',
                cmpSafA && cmpLocalA.preco <= 0    && '  Informe preço da soja no Cenário A',
                !cmpSafB                           && '  Selecione talhão e safra no Cenário B',
                cmpSafB && cmpLocalB.prod  <= 0    && '  Informe produtividade no Cenário B',
                cmpSafB && cmpLocalB.preco <= 0    && '  Informe preço da soja no Cenário B',
              ].filter(Boolean).join('\n')}
            </Text>
          </View>
        )}

        {canCompare && (
          <Card isDark={isDark}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: tc, marginBottom: 2 }}>Comparativo de Margem de Lucro</Text>
            <Text style={{ fontSize: 11, color: mc, marginBottom: 16 }}>
              {cmpTalA?.nome} ({cmpSafA?.nome}) × {cmpTalB?.nome} ({cmpSafB?.nome})
            </Text>

            <CompBarChart title="LUCRO LÍQUIDO (R$)"   labelA={labelA} labelB={labelB} valueA={resA.lucro}   valueB={resB.lucro}   colorA={Colors.primary} colorB="#2196F3" isDark={isDark} />
            <CompBarChart title="CUSTO TOTAL (R$)"     labelA={labelA} labelB={labelB} valueA={resA.custo}   valueB={resB.custo}   colorA="#C8900A" colorB="#9C27B0" isDark={isDark} />
            <CompBarChart title="RECEITA BRUTA (R$)"   labelA={labelA} labelB={labelB} valueA={resA.receita} valueB={resB.receita} colorA="#4CAF50" colorB="#00BCD4" isDark={isDark} />

            <View style={{ borderTopWidth: 1, borderTopColor: isDark ? '#1A2C22' : '#EEF3EF', paddingTop: 14, marginTop: 4 }}>
              <View style={{ flexDirection: 'row', marginBottom: 10 }}>
                <Text style={{ flex: 1.6, fontSize: 11, color: mc, fontWeight: '600' }}>Métrica</Text>
                <Text style={{ flex: 1, fontSize: 11, color: Colors.primary, fontWeight: '700', textAlign: 'right' }}>Cen. A</Text>
                <Text style={{ flex: 1, fontSize: 11, color: '#2196F3', fontWeight: '700', textAlign: 'right' }}>Cen. B</Text>
              </View>
              {[
                { label: 'Insumos',       a: fmtBRL(cmpCostA?.insumos ?? 0),    b: fmtBRL(cmpCostB?.insumos ?? 0)    },
                { label: 'Operacional',   a: fmtBRL(cmpCostA?.operacional ?? 0), b: fmtBRL(cmpCostB?.operacional ?? 0) },
                { label: 'Custo total',   a: fmtBRL(resA.custo),                 b: fmtBRL(resB.custo)                 },
                { label: 'Custo/ha',      a: fmtBRL(resA.custoHa),               b: fmtBRL(resB.custoHa)               },
                { label: 'Produtividade', a: `${fmt(cmpLocalA.prod)} sc/ha`,     b: `${fmt(cmpLocalB.prod)} sc/ha`     },
                { label: 'Preço soja',    a: fmtBRL(cmpLocalA.preco),            b: fmtBRL(cmpLocalB.preco)            },
                { label: 'Pt. nível.',    a: `${fmt(pontoNivelA)} sc/ha`,        b: `${fmt(pontoNivelB)} sc/ha`        },
                { label: 'Receita',       a: fmtBRL(resA.receita),               b: fmtBRL(resB.receita)               },
                { label: 'Lucro liq.',    a: fmtBRL(resA.lucro),                 b: fmtBRL(resB.lucro),   bold: true   },
                { label: 'Lucro/ha',      a: fmtBRL(resA.lucroHa),               b: fmtBRL(resB.lucroHa)               },
                { label: 'Margem seg.',   a: `${resA.margemSeguranca.toFixed(1)}%`, b: `${resB.margemSeguranca.toFixed(1)}%`, bold: true },
              ].map((row, i) => (
                <View key={i} style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? '#1A2C22' : '#F0F5F1' }}>
                  <Text style={{ flex: 1.6, fontSize: 12, color: mc, fontWeight: (row as any).bold ? '700' : '400' }}>{row.label}</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: tc, textAlign: 'right' }}>{row.a}</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: tc, textAlign: 'right' }}>{row.b}</Text>
                </View>
              ))}
            </View>

            {/* Botão Comparar em PDF */}
            <TouchableOpacity
              onPress={async () => {
                try {
                  setExportingPdf(true);
                  const [consultorEmpresa, produtorNome] = await Promise.all([
                    fetchConsultorInfo(),
                    selectedFazenda ? fetchProdutorNome(selectedFazenda.id) : Promise.resolve(undefined),
                  ]);
                  const cenA = {
                    label: 'Cenário A',
                    talhaoNome: cmpTalA?.nome ?? 'A',
                    safraAnome: cmpSafA?.nome ?? '',
                    areaHa: areaA,
                    insumos: cmpInsumosA.map(i => ({ nome: i.nome, categoria: i.categoria, valorHa: i.valor_ha, areaHa: i.area_talhao, total: i.valor_ha * i.area_talhao, comprado: i.comprado, fornecedor: i.fornecedor, dose_ha: i.dose_ha, isAlternativa: i.isAlternativa, produtoOriginal: i.produtoOriginal, doseOriginal: i.doseOriginal })),
                    custosOp: cmpCustosOpA.map(c => ({ descricao: c.descricao, valorHa: c.valor, areaHa: areaA, total: c.valor * areaA, unidade: c.unidade, valorOriginal: c.valor_original, precoSojaRef: c.preco_soja_ref })),
                    produtividade_ha: cmpLocalA.prod,
                    preco_soja: cmpLocalA.preco,
                    totalInsumos: cmpCostA?.insumos ?? 0,
                    totalOperacional: cmpCostA?.operacional ?? 0,
                    totalCusto: resA.custo,
                    receita: resA.receita,
                    lucro: resA.lucro,
                    custoHa: resA.custoHa,
                    lucroHa: resA.lucroHa,
                    pontoNivelamento: pontoNivelA,
                    margemSeguranca: resA.margemSeguranca,
                  };
                  const cenB = {
                    label: 'Cenário B',
                    talhaoNome: cmpTalB?.nome ?? 'B',
                    safraAnome: cmpSafB?.nome ?? '',
                    areaHa: areaB,
                    insumos: cmpInsumosB.map(i => ({ nome: i.nome, categoria: i.categoria, valorHa: i.valor_ha, areaHa: i.area_talhao, total: i.valor_ha * i.area_talhao, comprado: i.comprado, fornecedor: i.fornecedor, dose_ha: i.dose_ha, isAlternativa: i.isAlternativa, produtoOriginal: i.produtoOriginal, doseOriginal: i.doseOriginal })),
                    custosOp: cmpCustosOpB.map(c => ({ descricao: c.descricao, valorHa: c.valor, areaHa: areaB, total: c.valor * areaB, unidade: c.unidade, valorOriginal: c.valor_original, precoSojaRef: c.preco_soja_ref })),
                    produtividade_ha: cmpLocalB.prod,
                    preco_soja: cmpLocalB.preco,
                    totalInsumos: cmpCostB?.insumos ?? 0,
                    totalOperacional: cmpCostB?.operacional ?? 0,
                    totalCusto: resB.custo,
                    receita: resB.receita,
                    lucro: resB.lucro,
                    custoHa: resB.custoHa,
                    lucroHa: resB.lucroHa,
                    pontoNivelamento: pontoNivelB,
                    margemSeguranca: resB.margemSeguranca,
                  };
                  await exportarGestaoComparacaoPdf({
                    consultorEmpresa,
                    fazendaNome: selectedFazenda?.nome,
                    produtorNome,
                    cenarioA: cenA,
                    cenarioB: cenB,
                    dataGeracao: new Date(),
                  });
                } catch (e: any) {
                  Alert.alert('Erro', e?.message ?? 'Não foi possível gerar o PDF.');
                } finally {
                  setExportingPdf(false);
                }
              }}
              disabled={exportingPdf}
              style={{ marginTop: 18, backgroundColor: isDark ? '#1A2C22' : '#EBF5EF', borderRadius: 12, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: isDark ? '#2A4832' : '#C8E4D0' }}
            >
              {exportingPdf
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : <Text style={{ fontSize: 14, fontWeight: '700', color: isDark ? '#7FC49A' : Colors.primary }}>Exportar comparação em PDF</Text>
              }
            </TouchableOpacity>
          </Card>
        )}

        {!cmpTalA && !cmpTalB && (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: tc, textAlign: 'center' }}>Compare safras e talhões</Text>
            <Text style={{ fontSize: 13, color: mc, textAlign: 'center', marginTop: 8, lineHeight: 20, paddingHorizontal: 24 }}>
              Selecione dois cenários e informe produtividade e preço da soja. Se os dados já foram salvos, serão preenchidos automaticamente.
            </Text>
          </View>
        )}
      </View>
    );
  };

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <StatusBar barStyle="light-content" backgroundColor={headerBg} />
      {/* Header */}
      <View style={{ backgroundColor: headerBg, paddingTop: insets.top + 12, paddingHorizontal: 18, paddingBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingRight: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF' }}>Voltar</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF', flex: 1, textAlign: 'center' }} numberOfLines={1}>Gestão Financeira</Text>
          <View style={{ width: 80 }} />
        </View>
        {/* Compact selectors */}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }} onPress={() => setShowFazPicker(true)}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 8, fontWeight: '600', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5 }}>FAZENDA</Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFFFFF', marginTop: 1 }} numberOfLines={1}>{fazendas.length === 0 ? 'Nenhuma' : (selectedFazenda?.nome ?? 'Selecionar')}</Text>
            </View>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>›</Text>
          </TouchableOpacity>
          {selectedFazenda && (
            <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }} onPress={() => setShowTalhaoPicker(true)}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 8, fontWeight: '600', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5 }}>TALHÃO</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFFFFF', marginTop: 1 }} numberOfLines={1}>{talhoes.length === 0 ? 'Nenhum' : (selectedTalhao?.nome ?? 'Selecionar')}</Text>
                {selectedTalhao && <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)' }}>{selectedTalhao.area_ha} ha</Text>}
              </View>
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>›</Text>
            </TouchableOpacity>
          )}
          {selectedTalhao && (
            <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }} onPress={() => setShowSafraPicker(true)}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 8, fontWeight: '600', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5 }}>SAFRA</Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#FFFFFF', marginTop: 1 }} numberOfLines={1}>{selectedSafra?.nome ?? 'Selecionar'}</Text>
                {selectedSafra && <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.55)' }}>{selectedSafra.ano}</Text>}
              </View>
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>›</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={{ flexDirection: 'row', backgroundColor: isDark ? '#111D16' : '#EEF3EF', marginHorizontal: 16, marginTop: 16, borderRadius: 12, padding: 3, marginBottom: 8 }}>
        {([{ key: 'insumos', label: 'Insumos' }, { key: 'operacional', label: 'Operac.' }, { key: 'analise', label: 'Análise' }, { key: 'comparar', label: 'Comparar' }] as const).map(tab => (
          <TouchableOpacity key={tab.key} style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: activeTab === tab.key ? (isDark ? '#1A2C22' : Colors.primary) : 'transparent' }} onPress={() => setActiveTab(tab.key)}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: activeTab === tab.key ? '#FFFFFF' : mc }}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {fazendas.length === 0 && !loading
        ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: tc, textAlign: 'center', marginBottom: 8 }}>Nenhuma fazenda cadastrada</Text>
            <Text style={{ fontSize: 14, color: mc, textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>Cadastre ao menos uma fazenda na seção Propriedades.</Text>
            <TouchableOpacity style={{ backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 13 }} onPress={() => navigation.navigate('PropriedadesList')}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>Ir para Propriedades</Text>
            </TouchableOpacity>
          </View>
        : !selectedTalhao && !loading
          ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: tc, textAlign: 'center', marginBottom: 8 }}>Selecione um talhão</Text>
              <Text style={{ fontSize: 14, color: mc, textAlign: 'center', lineHeight: 22 }}>Escolha uma fazenda e um talhão para visualizar os dados financeiros.</Text>
            </View>
          : (
            <KeyboardAwareScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {activeTab === 'insumos' && renderInsumos()}
              {activeTab === 'operacional' && renderOperacional()}
              {activeTab === 'analise' && renderAnalise()}
              {activeTab === 'comparar' && renderComparar()}
            </KeyboardAwareScrollView>
          )}

      {renderPicker(showFazPicker, () => setShowFazPicker(false), 'Selecionar fazenda', fazendas.map(f => ({ id: f.id, line1: f.nome, line2: f.area_total_ha ? `${f.area_total_ha} ha` : undefined, selected: selectedFazenda?.id === f.id, onPress: () => handleFazendaChange(f) })))}
      {renderPicker(showTalhaoPicker, () => setShowTalhaoPicker(false), 'Selecionar talhão', talhoes.map(t => ({ id: t.id, line1: t.nome, line2: `${t.area_ha} ha`, selected: selectedTalhao?.id === t.id, onPress: () => handleTalhaoChange(t) })))}
      {renderPicker(showSafraPicker, () => setShowSafraPicker(false), 'Selecionar safra', safras.map(s => ({ id: s.id, line1: s.nome, line2: `Ano: ${s.ano}`, selected: selectedSafra?.id === s.id, onPress: () => handleSafraChange(s) })))}

      <AddCustoModal
        visible={showAddCusto}
        onClose={() => { setShowAddCusto(false); setEditCusto(null); }}
        onSave={handleSaveCusto}
        editItem={editCusto}
        isDark={isDark}
      />
    </View>
  );
}