import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  Modal,
  Alert,
  StatusBar,
  Platform,
  ActivityIndicator,
  Share,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Clipboard from '@react-native-clipboard/clipboard'; // ✅ import separado
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeMode } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Planilha'>;
  route: RouteProp<RootStackParamList, 'Planilha'>;
};

// ── TYPES ──────────────────────────────────────────────────────────────────
interface Product {
  id: number;
  cat: string;
  subcat: string;
  nome: string;
  ia: string;
  fonte: string;
  dose: string;
  unid: string;
  aplic: string;
  estadio: string;
  tecnologia: string;
  alvo: string;
  obs: string;
  extras: string[];
  valor_ha: number;
}

interface ExtraField {
  id: number;
  value: string;
}

interface Notif {
  id: number;
  msg: string;
  type: 'success' | 'error' | 'info';
}

// ── DADOS ───────────────────────────────────────────────────────────────────
const CAT_SUBCATS: Record<string, string[]> = {
  'Sementes / Hibridos': ['Soja', 'Milho', 'Feijao', 'Sorgo', 'Cana', 'Pastagem', 'Sorgo Forrageiro', 'Girassol'],
  'Inoculante': ['Bradyrhizobium (Soja)', 'Azospirillum (Milho/Pastagem)', 'Bradyrhizobium + Azospirillum', 'Nematoidicida Biologico'],
  'Tratamento de Semente': ['Inseticida TS', 'Fungicida TS', 'Inseticida + Fungicida TS', 'Inoculante TS', 'Bioestimulante TS', 'Nematicida TS'],
  'Bioestimulante / Enraizador': ['Co+Mo', 'Extrato de Algas', 'Aminoacidos', 'Auxinas / Citocininas', 'Enraizador', 'Bioestimulante Geral'],
  'Herbicida': ['Pre-emergente', 'Pos-emergente Soja', 'Pos-emergente Milho', 'Pos-emergente Feijao', 'Graminicida', 'Dessecante / Manejo'],
  'Inseticida': ['Controle de Mosca-branca', 'Controle de Vaquinha', 'Controle de Lagarta', 'Controle de Percevejos', 'Controle de Percevejo Castanho', 'Controle de Pulgao', 'Controle de Cigarrinha', 'Controle de Acaro', 'Controle de Tripes', 'Inseticida Geral'],
  'Fungicida': ['Ferrugem-asiatica (Soja)', 'Cercospora / Mancha-alvo', 'Mancha-branca (Milho)', 'Podridao Radicular', 'Mofo Branco', 'Antracnose', 'Oidio', 'Fungicida Geral'],
  'Nematicida': ['Nematicida Biologico', 'Nematicida Quimico', 'Nematoidicida TS'],
  'Nutricao / Fertilizante Foliar': ['Boro (B)', 'Zinco (Zn)', 'Manganes (Mn)', 'Molibdenio (Mo)', 'Cobalto (Co)', 'Calcio (Ca)', 'Magnesio (Mg)', 'Enxofre (S)', 'Fosforo (P)', 'NPK Foliar', 'Multimicronutrientes'],
  'Adjuvante': ['Espalhante Adesivo', 'Espalhante Penetrante', 'Oleo Mineral', 'Oleo Vegetal', 'Redutor de pH', 'Antiespumante'],
  'Corretivo de Solo': ['Calcario Calcitico', 'Calcario Dolomitico', 'Gesso Agricola', 'Cal Virgem'],
  'Fertilizante de Base': ['MAP', 'DAP', 'Superfosfato Simples', 'Superfosfato Triplo', 'Cloreto de Potassio', 'KCl', 'Ureia', 'Sulfato de Amonio', 'Nitrato de Amonio', 'NPK Formulado'],
};

const ALVO_TAGS: Record<string, string[]> = {
  'Controle de Lagarta': ['Spodoptera frugiperda', 'Anticarsia gemmatalis', 'Chrysodeixis includens'],
  'Controle de Percevejos': ['Nezara viridula', 'Euschistus heros', 'Piezodorus guildinii'],
  'Controle de Pulgao': ['Rhopalosiphum maidis', 'Aphis glycines'],
  'Ferrugem-asiatica (Soja)': ['Phakopsora pachyrhizi', 'Ferrugem-asiatica'],
  'Cercospora / Mancha-alvo': ['Cercospora sojina', 'Corynespora cassiicola'],
  'Mofo Branco': ['Sclerotinia sclerotiorum'],
  'Pre-emergente': ['Plantas daninhas pre-emergentes', 'Folhas largas', 'Gramineas'],
  'Dessecante / Manejo': ['Manejo de pre-plantio', 'Manejo de colheita'],
};

const DEFAULT_CATS = Object.keys(CAT_SUBCATS);

const PRODUTOS_DB = [
  { nome: 'Roundup Original', ia: 'Glifosato 360 g/L', fonte: 'Herbicida sistemico (Glicinas)' },
  { nome: 'Roundup WG', ia: 'Glifosato 720 g/kg', fonte: 'Herbicida sistemico (Glicinas)' },
  { nome: 'Zapp QI 620', ia: 'Glifosato 620 g/L', fonte: 'Herbicida sistemico (Glicinas)' },
  { nome: 'Crucial', ia: 'Glifosato 540 g/L', fonte: 'Herbicida sistemico (Glicinas)' },
  { nome: 'DMA 806 BR', ia: '2,4-D 806 g/L', fonte: 'Herbicida mimetizador de auxina' },
  { nome: 'Heat', ia: 'Saflufenacil 700 g/kg', fonte: 'Herbicida dessecante (PPO)' },
  { nome: 'Aurora', ia: 'Carfentrazona-etilica 400 g/L', fonte: 'Herbicida dessecante (PPO)' },
  { nome: 'Gramoxone 200', ia: 'Paraquate 200 g/L', fonte: 'Herbicida de contato' },
  { nome: 'Liberty', ia: 'Glufosinato de amonio 200 g/L', fonte: 'Herbicida de contato (GS)' },
  { nome: 'Fox Xpro', ia: 'Trifloxistrobina + Protioconazol + Bixafen', fonte: 'Fungicida (Estrob. + Triazol + Carbox.)' },
  { nome: 'Elatus', ia: 'Azoxistrobina + Benzovindiflupir', fonte: 'Fungicida (Estrob. + Carboxamida)' },
  { nome: 'Amistar Top', ia: 'Azoxistrobina + Difenoconazol', fonte: 'Fungicida (Estrob. + Triazol)' },
  { nome: 'Priori Xtra', ia: 'Azoxistrobina + Ciproconazol', fonte: 'Fungicida (Estrob. + Triazol)' },
  { nome: 'Opera Ultra', ia: 'Piraclostrobina + Metconazol', fonte: 'Fungicida (Estrob. + Triazol)' },
  { nome: 'Orkestra SC', ia: 'Piraclostrobina + Fluxapiroxade', fonte: 'Fungicida (Estrob. + Carboxamida)' },
  { nome: 'Nativo', ia: 'Trifloxistrobina + Tebuconazol', fonte: 'Fungicida (Estrob. + Triazol)' },
  { nome: 'Folicur 200 EC', ia: 'Tebuconazol 200 g/L', fonte: 'Fungicida sistemico (Triazol)' },
  { nome: 'Score', ia: 'Difenoconazol 250 g/L', fonte: 'Fungicida sistemico (Triazol)' },
  { nome: 'Unizeb Gold', ia: 'Mancozebe 750 g/kg', fonte: 'Fungicida protetor multissitio' },
  { nome: 'Bravonil 720', ia: 'Clorotalonil 720 g/L', fonte: 'Fungicida protetor multissitio' },
  { nome: 'Engeo Pleno S', ia: 'Tiametoxam + Lambda-cialotrina', fonte: 'Inseticida (Neonic. + Piretroide)' },
  { nome: 'Connect', ia: 'Imidacloprido + Beta-ciflutrina', fonte: 'Inseticida (Neonic. + Piretroide)' },
  { nome: 'Coragen', ia: 'Clorantraniliprole 200 g/L', fonte: 'Inseticida (Diamida)' },
  { nome: 'Belt', ia: 'Flubendiamida 480 g/L', fonte: 'Inseticida (Diamida)' },
  { nome: 'Ampligo', ia: 'Clorantraniliprole + Lambda-cialotrina', fonte: 'Inseticida (Diamida + Piretroide)' },
  { nome: 'Karate Zeon 50 CS', ia: 'Lambda-cialotrina 50 g/L', fonte: 'Inseticida (Piretroide)' },
  { nome: 'Decis 25 EC', ia: 'Deltametrina 25 g/L', fonte: 'Inseticida (Piretroide)' },
  { nome: 'Vertimec 18 EC', ia: 'Abamectina 18 g/L', fonte: 'Inseticida/Acaricida (Avermectina)' },
  { nome: 'Serenade', ia: 'Bacillus subtilis QST 713', fonte: 'Biologico (Fungicida/Bactericida)' },
  { nome: 'Boveril', ia: 'Beauveria bassiana', fonte: 'Biologico (Inseticida)' },
  { nome: 'Dipel', ia: 'Bacillus thuringiensis kurstaki', fonte: 'Biologico (Inseticida - Lagartas)' },
  { nome: 'Bioforge', ia: 'Antioxidante + Nutrientes', fonte: 'Bioestimulante (Reducao de Estresse)' },
  { nome: 'Stimulate', ia: 'Cinetina + Acido Giberelico + IBA', fonte: 'Fisiologico (Crescimento)' },
  { nome: 'CoMo Platinum', ia: 'Cobalto + Molibdenio', fonte: 'Nutricao (Fixacao de Nitrogenio)' },
  { nome: 'Nodusoja', ia: 'Cobalto + Molibdenio', fonte: 'Nutricao (Semente/Foliar Soja)' },
  { nome: 'Boro Solevel', ia: 'Acido Borico 17% B', fonte: 'Nutricao (Boro)' },
  { nome: 'Zinco Foliar', ia: 'Sulfato de Zinco 20% Zn', fonte: 'Nutricao (Zinco)' },
  { nome: 'Manganes Foliar', ia: 'Sulfato de Manganes 28% Mn', fonte: 'Nutricao (Manganes)' },
  { nome: 'YaraVita Glytrel', ia: 'Manganes + Zinco + Boro', fonte: 'Nutricao (Especifico Soja)' },
  { nome: 'Aureo', ia: 'Oleo Metilado de Soja', fonte: 'Adjuvante (Penetracao)' },
  { nome: 'Nimbus', ia: 'Oleo Mineral', fonte: 'Adjuvante (Espalhante)' },
  { nome: 'Dash HC', ia: 'Mistura de Esteres Metilicos', fonte: 'Adjuvante (Alta Performance)' },
];

// ── STYLESHEET ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  flex1: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a3d1f',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: '#ffffff', flex: 1, textAlign: 'center' },
  backBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  backText: { fontSize: 13, color: '#A5D6A7', fontWeight: '700' },
  headerRight: { width: 70, alignItems: 'flex-end' },
  prodCountText: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },

  // Card
  card: {
    backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1,
    borderColor: '#e5e7eb', marginBottom: 12, overflow: 'hidden',
  },
  cardHead: {
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  cardTitle: { fontSize: 13, fontWeight: '800', color: '#111827' },
  cardBody: { padding: 16 },

  // Section label
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: '#9ca3af',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 10, marginTop: 4,
  },

  // Form
  fieldLabel: { fontSize: 11, fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 },
  input: {
    height: 38, borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 8,
    paddingHorizontal: 11, fontSize: 13, fontWeight: '500', color: '#111827',
    backgroundColor: '#ffffff', marginBottom: 12,
  },
  inputFocused: { borderColor: '#2e7d32' },
  row2: { flexDirection: 'row', marginBottom: 0 },
  col: { flex: 1 },
  colLeft: { flex: 1, marginRight: 6 },
  colRight: { flex: 1, marginLeft: 6 },

  // Select (picker-like button)
  selectBtn: {
    height: 38, borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 8,
    paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', backgroundColor: '#ffffff', marginBottom: 12,
  },
  selectBtnText: { fontSize: 13, fontWeight: '500', color: '#111827', flex: 1 },
  selectBtnPlaceholder: { color: '#9ca3af' },
  selectArrow: { fontSize: 14, color: '#9ca3af' },

  // Dose wrap
  doseWrap: { position: 'relative', marginBottom: 12 },
  doseInput: {
    height: 38, borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 8,
    paddingHorizontal: 11, paddingRight: 75, fontSize: 13, fontWeight: '500', color: '#111827',
    backgroundColor: '#ffffff',
  },
  doseLockBadge: {
    position: 'absolute', right: 0, top: 0, height: 38,
    paddingHorizontal: 9, justifyContent: 'center', alignItems: 'center',
    borderLeftWidth: 1, borderLeftColor: '#e5e7eb', borderRadius: 8,
    backgroundColor: '#fffaf7',
  },
  doseLockText: { fontSize: 9, fontWeight: '800', color: '#d84315', letterSpacing: 0.4 },

  // Chips (alvo tags)
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, marginBottom: 4 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#f9fafb',
    marginRight: 5, marginBottom: 5,
  },
  chipActive: { backgroundColor: '#2e7d32', borderColor: '#2e7d32' },
  chipText: { fontSize: 11, fontWeight: '600', color: '#4b5563' },
  chipTextActive: { color: '#ffffff' },

  // Extras
  extrasSection: {
    backgroundColor: '#f9fafb', borderWidth: 1, borderStyle: 'dashed',
    borderColor: '#e5e7eb', borderRadius: 8, padding: 12, marginBottom: 12,
  },
  extrasHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  extrasTitle: { fontSize: 11, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.6 },
  extrasHint: { fontSize: 11, color: '#9ca3af', marginTop: 4 },
  extraRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  extraInput: {
    flex: 1, height: 38, borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 8,
    paddingHorizontal: 11, fontSize: 13, color: '#111827', backgroundColor: '#ffffff',
  },
  removeExtraBtn: {
    width: 38, height: 38, marginLeft: 8, borderRadius: 8,
    backgroundColor: '#ffebee', borderWidth: 1, borderColor: '#ffcdd2',
    alignItems: 'center', justifyContent: 'center',
  },
  removeExtraText: { fontSize: 16, fontWeight: '700', color: '#c62828' },

  // Buttons
  btnRow: { flexDirection: 'row', marginTop: 4, flexWrap: 'wrap' },
  btnPrimary: {
    height: 38, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#2e7d32',
    alignItems: 'center', justifyContent: 'center', marginRight: 8, marginBottom: 8,
  },
  btnPrimaryText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  btnSecondary: {
    height: 38, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#f3f4f6',
    borderWidth: 1, borderColor: '#e5e7eb',
    alignItems: 'center', justifyContent: 'center', marginRight: 8, marginBottom: 8,
  },
  btnSecondaryText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  btnLink: { paddingVertical: 4, paddingHorizontal: 2 },
  btnLinkText: { fontSize: 12, fontWeight: '700', color: '#2e7d32', textDecorationLine: 'underline' },
  btnDanger: {
    height: 32, paddingHorizontal: 10, borderRadius: 6, backgroundColor: '#ffebee',
    borderWidth: 1, borderColor: '#ffcdd2',
    alignItems: 'center', justifyContent: 'center',
  },
  btnDangerText: { fontSize: 12, fontWeight: '600', color: '#c62828' },
  btnEdit: {
    height: 32, paddingHorizontal: 10, borderRadius: 6, backgroundColor: '#f3f4f6',
    borderWidth: 1, borderColor: '#e5e7eb',
    alignItems: 'center', justifyContent: 'center', marginRight: 6,
  },
  btnEditText: { fontSize: 12, fontWeight: '600', color: '#374151' },

  // Tabs
  tabsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  tab: {
    height: 28, paddingHorizontal: 12, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center', marginRight: 6, marginBottom: 6,
    flexDirection: 'row',
  },
  tabActive: { backgroundColor: '#2e7d32', borderColor: '#2e7d32' },
  tabText: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  tabTextActive: { color: '#ffffff' },
  tabCount: {
    marginLeft: 4, fontSize: 10, fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.1)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 10,
    color: '#6b7280',
  },
  tabCountActive: { backgroundColor: 'rgba(255,255,255,0.25)', color: '#ffffff' },

  // Product list
  emptyBox: { paddingVertical: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: '#374151', marginBottom: 4 },
  emptyText: { fontSize: 13, color: '#9ca3af', textAlign: 'center' },

  prodItem: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 12, marginBottom: 8,
    backgroundColor: '#ffffff',
  },
  prodGroupHeader: {
    backgroundColor: '#e8f5e9', paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 6, marginBottom: 6,
  },
  prodGroupText: { fontSize: 10, fontWeight: '800', color: '#2e6b34', textTransform: 'uppercase', letterSpacing: 0.5 },
  prodName: { fontSize: 13, fontWeight: '700', color: '#111827', marginBottom: 3 },
  pillsRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20, marginRight: 4, marginBottom: 2 },
  pillCat: { backgroundColor: '#f3f4f6' },
  pillCatText: { fontSize: 10, fontWeight: '700', color: '#4b5563' },
  pillAlvo: { backgroundColor: '#fff3e0' },
  pillAlvoText: { fontSize: 10, fontWeight: '700', color: '#d84315' },
  pillTec: { backgroundColor: '#f3e5f5' },
  pillTecText: { fontSize: 10, fontWeight: '700', color: '#7b1fa2' },
  prodMeta: { fontSize: 11, color: '#6b7280', marginBottom: 2 },
  prodExtras: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  doseRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' },
  doseVal: { fontSize: 13, fontWeight: '800', color: '#111827' },
  doseUnit: { fontSize: 11, color: '#6b7280', marginLeft: 3 },
  doseLocked: {
    marginLeft: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    backgroundColor: '#fff3e0', borderWidth: 1, borderColor: '#ffcc80',
  },
  doseLockedText: { fontSize: 9, fontWeight: '800', color: '#d84315', textTransform: 'uppercase' },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  priceVal: { fontSize: 13, fontWeight: '800', color: '#111827' },
  pricePending: { fontSize: 12, color: '#9ca3af', fontStyle: 'italic' },
  actionsRow: { flexDirection: 'row', marginTop: 8 },

  // Sticky footer (Salvar + Compartilhar — sempre visível)
  stickyFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1a3d1f',
    paddingTop: 14,
    paddingHorizontal: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 12,
  },
  stickyFooterInner: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  btnStickySave: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnStickySaveText: { fontSize: 15, fontWeight: '700', color: '#2e7d32' },
  btnStickyShare: {
    paddingHorizontal: 20,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnStickyShareText: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.95)' },
  stickyLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
    gap: 10,
  },
  stickyLinkText: { flex: 1, fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: '500' },
  stickyCopyText: { fontSize: 12, fontWeight: '700', color: '#90caf9' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#ffffff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  modalDone: { fontSize: 15, fontWeight: '700', color: '#2e7d32' },
  modalItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 13 },
  modalItemBorder: { borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  modalItemText: { fontSize: 15, color: '#444444', flex: 1 },
  modalItemTextSel: { color: '#1a3d1f', fontWeight: '700' },
  modalRadio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#cccccc',
    marginRight: 12, alignItems: 'center', justifyContent: 'center',
  },
  modalRadioSel: { borderColor: '#2e7d32' },
  modalRadioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#2e7d32' },

  // Autocomplete drop
  dropContainer: {
    borderWidth: 1, borderColor: '#e0e7e0', borderRadius: 10,
    backgroundColor: '#ffffff', marginTop: 2, marginBottom: 4,
    maxHeight: 200, overflow: 'hidden',
  },
  dropItem: { paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  dropItemFirst: { borderTopWidth: 0 },
  dropItemName: { fontSize: 13, fontWeight: '600', color: '#111827' },
  dropItemSub: { fontSize: 11, color: '#6b7280', marginTop: 1 },

  // Notif
  notif: {
    position: 'absolute', bottom: 24, left: 16, right: 16, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 12, zIndex: 9999,
  },
  notifSuccess: { backgroundColor: '#2e7d32' },
  notifError: { backgroundColor: '#c62828' },
  notifInfo: { backgroundColor: '#1565c0' },
  notifText: { fontSize: 13, fontWeight: '600', color: '#ffffff' },

  // Cat modal chips
  catChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
  catChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#f9fafb',
    marginRight: 6, marginBottom: 6,
  },
  catChipText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  catChipDel: { marginLeft: 5, fontSize: 14, color: '#c62828', fontWeight: '700' },
  catInputRow: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  catInput: {
    flex: 1, height: 38, borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 8,
    paddingHorizontal: 11, fontSize: 13, color: '#111827', backgroundColor: '#ffffff',
    marginRight: 8,
  },
  catAddBtn: {
    height: 38, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#2e7d32',
    alignItems: 'center', justifyContent: 'center',
  },
  catAddBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
});

// ── COMPONENT ────────────────────────────────────────────────────────────────
export default function PlanilhaScreen({ navigation, route }: Props) {
  const { isDark } = useThemeMode();
  const insets = useSafeAreaInsets();

  const cotacaoId: string = route?.params?.cotacaoId ?? '';
  const shareToken: string = route?.params?.shareToken ?? '';
  const tituloParam: string = route?.params?.titulo ?? 'Planilha';
  const readOnly: boolean = route?.params?.readOnly ?? false;

  // ── State ──
  const [products, setProducts] = useState<Product[]>([]);
  const [pid, setPid] = useState(1);
  const [customCats, setCustomCats] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('Todas');
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [savingDB, setSavingDB] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');
  const [loadingItens, setLoadingItens] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Form
  const [fCat, setFCat] = useState('');
  const [fSubcat, setFSubcat] = useState('');
  const [fNome, setFNome] = useState('');
  const [fIa, setFIa] = useState('');
  const [fFonte, setFFonte] = useState('');
  const [fDose, setFDose] = useState('');
  const [fUnidade, setFUnidade] = useState('');
  const [fAplic, setFAplic] = useState('');
  const [fEstadio, setFEstadio] = useState('');
  const [fTecnologia, setFTecnologia] = useState('');
  const [fAlvo, setFAlvo] = useState('');
  const [fObs, setFObs] = useState('');
  const [activeAlvoTags, setActiveAlvoTags] = useState<string[]>([]);
  const [extraFields, setExtraFields] = useState<ExtraField[]>([]);
  const [extraCounter, setExtraCounter] = useState(0);

  // Autocomplete
  const [dropResults, setDropResults] = useState<typeof PRODUTOS_DB>([]);
  const [dropVisible, setDropVisible] = useState(false);

  // Modals
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatVal, setNewCatVal] = useState('');
  const [unidModalOpen, setUnidModalOpen] = useState(false);
  const [catSelectModalOpen, setCatSelectModalOpen] = useState(false);

  const UNIDADES = ['L/ha', 'Kg/ha', 'g/ha', 'mL/ha', 'sem/ha', 'L/100kg semente', 'mL/100kg semente', 'g/100kg semente', 'kg/ha', 'doses/ha', 'sc/ha'];

  const allCats = useCallback(() => [...DEFAULT_CATS, ...customCats], [customCats]);

  // ── Notify ──
  const notify = useCallback((msg: string, type: Notif['type'] = 'info') => {
    const id = Date.now();
    setNotifs(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setNotifs(prev => prev.filter(n => n.id !== id)), 3000);
  }, []);

  // ── Carregar itens existentes (modo edição) ──
  useEffect(() => {
    if (!cotacaoId) return;
    const loadItens = async () => {
      setLoadingItens(true);
      try {
        const { data } = await supabase
          .from('itens_cotacao')
          .select('id, produto_nome, categoria, principio_ativo, fonte, dose_ha, unidade, estagio, n_aplicacoes, obs, valor_ha')
          .eq('cotacao_id', cotacaoId)
          .order('id');

        if (data && data.length > 0) {
          // Converte itens do banco para o formato Product usado na tela
          const loaded: Product[] = data.map((it: any, idx: number) => {
            // obs pode ter extras separados por ' | '
            const obsParts = (it.obs ?? '').split(' | ').map((s: string) => s.trim()).filter(Boolean);
            const obsMain  = obsParts[0] ?? '';
            const extras   = obsParts.slice(1);
            return {
              id:         idx + 1,
              cat:        it.categoria ?? '',
              subcat:     '',
              nome:       it.produto_nome ?? '',
              ia:         it.principio_ativo ?? '',
              fonte:      it.fonte ?? '',
              dose:       it.dose_ha != null ? String(it.dose_ha) : '',
              unid:       it.unidade ?? '',
              aplic:      it.n_aplicacoes != null ? String(it.n_aplicacoes) : '',
              estadio:    it.estagio ?? '',
              tecnologia: '',
              alvo:       '',
              obs:        obsMain,
              extras,
              valor_ha:   it.valor_ha ?? 0,
            };
          });
          setProducts(loaded);
          setPid(loaded.length + 1);
          setEditMode(true);
          notify(`${loaded.length} produto${loaded.length !== 1 ? 's' : ''} carregado${loaded.length !== 1 ? 's' : ''} para edicao`, 'info');
        }
      } catch {
        // sem itens salvos ainda — modo criacao normal
      } finally {
        setLoadingItens(false);
      }
    };
    loadItens();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cotacaoId]);

  // ── Autocomplete ──
  const handleNomeInput = (val: string) => {
    setFNome(val);
    if (!val || val.trim().length < 2) { setDropVisible(false); return; }
    const t = val.trim().toLowerCase();
    const results = PRODUTOS_DB.filter(p =>
      p.nome.toLowerCase().includes(t) || p.ia.toLowerCase().includes(t) || p.fonte.toLowerCase().includes(t)
    ).slice(0, 8);
    setDropResults(results);
    setDropVisible(results.length > 0);
  };

  const selectProduct = (p: typeof PRODUTOS_DB[0]) => {
    setFNome(p.nome);
    setFIa(p.ia);
    setFFonte(p.fonte);
    setDropVisible(false);
    notify('Produto selecionado', 'success');
  };

  // ── Alvo tags ──
  const alvoSuggestions = ALVO_TAGS[fSubcat] || [];

  const toggleAlvoTag = (tag: string) => {
    const parts = fAlvo.split(',').map(s => s.trim()).filter(Boolean);
    const idx = parts.indexOf(tag);
    let newParts: string[];
    if (idx === -1) {
      newParts = [...parts, tag];
      setActiveAlvoTags(prev => [...prev, tag]);
    } else {
      newParts = parts.filter((_, i) => i !== idx);
      setActiveAlvoTags(prev => prev.filter(t => t !== tag));
    }
    setFAlvo(newParts.join(', '));
  };

  // ── Extra fields ──
  const addExtraField = () => {
    const newId = extraCounter + 1;
    setExtraCounter(newId);
    setExtraFields(prev => [...prev, { id: newId, value: '' }]);
  };
  const removeExtraField = (id: number) => setExtraFields(prev => prev.filter(f => f.id !== id));
  const updateExtraField = (id: number, value: string) =>
    setExtraFields(prev => prev.map(f => f.id === id ? { ...f, value } : f));

  // ── Add product ──
  const addProduct = () => {
    if (!fCat || !fNome || !fDose || !fUnidade) {
      notify('Preencha: Categoria, Produto, Dose e Unidade', 'error');
      return;
    }
    const newProd: Product = {
      id: pid, cat: fCat, subcat: fSubcat, nome: fNome, ia: fIa, fonte: fFonte,
      dose: fDose, unid: fUnidade, aplic: fAplic, estadio: fEstadio,
      tecnologia: fTecnologia, alvo: fAlvo, obs: fObs,
      extras: extraFields.filter(f => f.value.trim()).map(f => f.value.trim()),
      valor_ha: 0,
    };
    setProducts(prev => [...prev, newProd]);
    setPid(pid + 1);
    clearForm();
    notify(fNome + ' adicionado', 'success');
  };

  const clearForm = () => {
    setFCat(''); setFSubcat(''); setFNome(''); setFIa(''); setFFonte('');
    setFDose(''); setFUnidade(''); setFAplic(''); setFEstadio('');
    setFTecnologia(''); setFAlvo(''); setFObs('');
    setActiveAlvoTags([]);
    setExtraFields([]);
    setExtraCounter(0);
    setDropVisible(false);
  };

  // ── Edit / Delete ──
  const editProd = (id: number) => {
    const p = products.find(x => x.id === id);
    if (!p) return;
    setFCat(p.cat); setFSubcat(p.subcat || ''); setFNome(p.nome);
    setFIa(p.ia || ''); setFFonte(p.fonte || ''); setFDose(p.dose);
    setFUnidade(p.unid); setFAplic(p.aplic || ''); setFEstadio(p.estadio || '');
    setFTecnologia(p.tecnologia || ''); setFAlvo(p.alvo || ''); setFObs(p.obs || '');
    const newExtras = (p.extras || []).map((v, i) => ({ id: i + 1, value: v }));
    setExtraFields(newExtras);
    setExtraCounter(newExtras.length);
    setActiveAlvoTags((p.alvo || '').split(',').map(s => s.trim()).filter(Boolean));
    setProducts(prev => prev.filter(x => x.id !== id));
    notify('Produto carregado para edicao', 'info');
  };

  const deleteProd = (id: number) => {
    Alert.alert('Remover', 'Remover este produto da lista?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover', style: 'destructive', onPress: () => { setProducts(prev => prev.filter(x => x.id !== id)); notify('Produto removido', 'info'); } },
    ]);
  };

  // ── Categories ──
  const addCustomCat = () => {
    const v = newCatVal.trim();
    if (!v || allCats().includes(v)) { notify('Categoria ja existe ou nome vazio', 'error'); return; }
    setCustomCats(prev => [...prev, v]);
    setNewCatVal('');
    notify('Categoria adicionada', 'success');
  };

  // ── Save to Supabase ──
  const saveToSupabase = async () => {
    if (products.length === 0) { notify('Adicione produtos antes de salvar', 'error'); return; }
    if (!cotacaoId) { notify('ID da cotacao nao encontrado', 'error'); return; }
    setSavingDB(true);
    try {
      // Em modo edicao, apaga os itens antigos antes de reinserir
      if (editMode) {
        const { error: delError } = await supabase
          .from('itens_cotacao')
          .delete()
          .eq('cotacao_id', cotacaoId);
        if (delError) throw delError;
      }

      const itens = products.map(p => ({
        cotacao_id:      cotacaoId,
        produto_nome:    p.nome,
        categoria:       p.cat,
        unidade:         p.unid,
        quantidade:      1,
        preco_unitario:  p.valor_ha || 0,
        dose_ha:         parseFloat(p.dose) || 0,
        estagio:         p.estadio || null,
        n_aplicacoes:    p.aplic ? parseInt(p.aplic) : null,
        valor_ha:        p.valor_ha || 0,
        principio_ativo: p.ia || null,
        fonte:           p.fonte || null,
        obs:             [p.obs, ...(p.extras || [])].filter(Boolean).join(' | ') || null,
      }));

      const { error } = await supabase.from('itens_cotacao').insert(itens);
      if (error) throw error;

      await supabase.from('cotacoes').update({ status: 'em_montagem', excel_itens_json: products }).eq('id', cotacaoId);

      setEditMode(true); // após salvar, permanece em modo edição
      const link = 'https://agrocota64-ctrl.github.io/agrocota-web/?token=' + shareToken;
      setGeneratedLink(link);
      notify(editMode ? 'Planilha atualizada com sucesso!' : 'Cotacao salva com sucesso!', 'success');
    } catch (err: any) {
      Alert.alert('Erro ao salvar', err?.message ?? 'Tente novamente.');
    } finally {
      setSavingDB(false);
    }
  };

  const copyLink = async () => {
    if (!generatedLink) return;
    try {
      await Clipboard.setString(generatedLink);
      notify('Link copiado!', 'success');
    } catch {
      Share.share({ message: generatedLink });
    }
  };

  const shareLink = () => {
    if (!generatedLink) return;
    Share.share({ message: 'Cotacao OAgroCota: ' + generatedLink, url: generatedLink });
  };

  // ── Tabs / filtered / grupos ──
  const cats = [...new Set(products.map(p => p.cat))];
  const tabs = ['Todas', ...cats];
  const currentTab = tabs.includes(activeTab) ? activeTab : 'Todas';
  const filtered = currentTab === 'Todas' ? products : products.filter(p => p.cat === currentTab);
  const grupos: Record<string, Product[]> = {};
  filtered.forEach(p => {
    const g = p.subcat || p.cat;
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push(p);
  });

  const bgPage = isDark ? '#0F1712' : '#eef1ee';

  // ── Loading dos itens existentes ──
  if (loadingItens) {
    return (
      <View style={[s.flex1, { backgroundColor: bgPage, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#2e7d32" />
        <Text style={{ marginTop: 12, fontSize: 13, color: '#6b7280' }}>Carregando planilha...</Text>
      </View>
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  return (
    <View style={[s.flex1, { backgroundColor: bgPage }]}>
      <StatusBar barStyle="light-content" backgroundColor="#1a3d1f" />

      {/* HEADER */}
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={s.backText}>{'< Voltar'}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.headerTitle} numberOfLines={1}>{tituloParam}</Text>
          {readOnly ? (
            <View style={{ backgroundColor: '#e5e7eb', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 3 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#4b5563', letterSpacing: 0.3 }}>SOMENTE LEITURA</Text>
            </View>
          ) : editMode && (
            <View style={{ backgroundColor: '#e0f2fe', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 3 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#0369a1', letterSpacing: 0.3 }}>EDITANDO</Text>
            </View>
          )}
        </View>
        <View style={s.headerRight}>
          <Text style={s.prodCountText}>{products.length} {'produto' + (products.length !== 1 ? 's' : '')}</Text>
        </View>
      </View>

      <KeyboardAwareScrollView
        style={s.flex1}
        contentContainerStyle={{ padding: 12, paddingBottom: readOnly ? 24 : 160 }}
        keyboardShouldPersistTaps="handled"
      >
          {/* ── FORM CARD ── */}
          {!readOnly && (
          <View style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>{'Adicionar Produto'}</Text>
              <TouchableOpacity style={s.btnLink} onPress={() => setCatModalOpen(true)}>
                <Text style={s.btnLinkText}>{'+ Categoria'}</Text>
              </TouchableOpacity>
            </View>
            <View style={s.cardBody}>

              {/* Classificacao */}
              <Text style={s.sectionLabel}>{'Classificacao'}</Text>

              <Text style={s.fieldLabel}>{'Categoria *'}</Text>
              <TouchableOpacity
                style={s.selectBtn}
                onPress={() => setCatSelectModalOpen(true)}
                activeOpacity={0.7}
              >
                <Text style={[s.selectBtnText, !fCat && s.selectBtnPlaceholder]}>
                  {fCat || 'Selecione a categoria...'}
                </Text>
                <Text style={s.selectArrow}>{'v'}</Text>
              </TouchableOpacity>

              <Text style={s.fieldLabel}>{'Cultura'}</Text>
              <TextInput
                style={s.input}
                value={fSubcat}
                onChangeText={setFSubcat}
                placeholder="Ex: Soja, Milho, Feijao..."
                placeholderTextColor="#9ca3af"
              />

              <Text style={s.fieldLabel}>{'Nome do Produto *'}</Text>
              <TextInput
                style={s.input}
                value={fNome}
                onChangeText={handleNomeInput}
                placeholder="Digite para buscar produto..."
                placeholderTextColor="#9ca3af"
                autoCorrect={false}
              />
              {dropVisible && (
                <View style={s.dropContainer}>
                  {dropResults.map((item, i) => (
                    <TouchableOpacity
                      key={item.nome}
                      style={[s.dropItem, i === 0 && s.dropItemFirst]}
                      onPress={() => selectProduct(item)}
                      activeOpacity={0.7}
                    >
                      <Text style={s.dropItemName}>{item.nome}</Text>
                      <Text style={s.dropItemSub}>{item.ia}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Composicao */}
              <Text style={s.sectionLabel}>{'Composicao e Formulacao'}</Text>

              <Text style={s.fieldLabel}>{'Principio Ativo / i.a.'}</Text>
              <TextInput style={s.input} value={fIa} onChangeText={setFIa} placeholder="Ex: Azoxistrobina + Tebuconazol" placeholderTextColor="#9ca3af" />

              <Text style={s.fieldLabel}>{'Fonte Nutricional'}</Text>
              <TextInput style={s.input} value={fFonte} onChangeText={setFFonte} placeholder="Ex: Boro (B), Fosforo (P)" placeholderTextColor="#9ca3af" />

              {/* Dose */}
              <Text style={s.sectionLabel}>{'Dose e Aplicacao'}</Text>

              <View style={s.row2}>
                <View style={s.colLeft}>
                  <Text style={s.fieldLabel}>{'Dose Fixa *'}</Text>
                  <View style={s.doseWrap}>
                    <TextInput
                      style={s.doseInput}
                      value={fDose}
                      onChangeText={setFDose}
                      placeholder="Ex: 0.25"
                      placeholderTextColor="#9ca3af"
                      keyboardType="decimal-pad"
                    />
                    <View style={s.doseLockBadge}>
                      <Text style={s.doseLockText}>{'TRAVADO'}</Text>
                    </View>
                  </View>
                </View>
                <View style={s.colRight}>
                  <Text style={s.fieldLabel}>{'Unidade *'}</Text>
                  <TouchableOpacity style={s.selectBtn} onPress={() => setUnidModalOpen(true)} activeOpacity={0.7}>
                    <Text style={[s.selectBtnText, !fUnidade && s.selectBtnPlaceholder]} numberOfLines={1}>
                      {fUnidade || 'Selecione...'}
                    </Text>
                    <Text style={s.selectArrow}>{'v'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={s.row2}>
                <View style={s.colLeft}>
                  <Text style={s.fieldLabel}>{'No. Aplicacoes'}</Text>
                  <TextInput style={s.input} value={fAplic} onChangeText={setFAplic} placeholder="Ex: 2" placeholderTextColor="#9ca3af" keyboardType="numeric" />
                </View>
                <View style={s.colRight}>
                  <Text style={s.fieldLabel}>{'Estadio'}</Text>
                  <TextInput style={s.input} value={fEstadio} onChangeText={setFEstadio} placeholder="Ex: V4-R1" placeholderTextColor="#9ca3af" />
                </View>
              </View>

              <Text style={s.fieldLabel}>{'Tecnologia / Grupo'}</Text>
              <TextInput style={s.input} value={fTecnologia} onChangeText={setFTecnologia} placeholder="Ex: Estrobilurina" placeholderTextColor="#9ca3af" />

              {/* Alvo */}
              <Text style={s.sectionLabel}>{'Alvo e Controle'}</Text>

              <Text style={s.fieldLabel}>{'Alvo / Controle'}</Text>
              <TextInput style={s.input} value={fAlvo} onChangeText={setFAlvo} placeholder="Ex: Ferrugem-asiatica, Cercospora" placeholderTextColor="#9ca3af" />
              {alvoSuggestions.length > 0 && (
                <View style={s.chipsRow}>
                  {alvoSuggestions.map(tag => (
                    <TouchableOpacity
                      key={tag}
                      style={[s.chip, activeAlvoTags.includes(tag) && s.chipActive]}
                      onPress={() => toggleAlvoTag(tag)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.chipText, activeAlvoTags.includes(tag) && s.chipTextActive]}>{tag}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={s.fieldLabel}>{'Observacoes Tecnicas'}</Text>
              <TextInput style={s.input} value={fObs} onChangeText={setFObs} placeholder="Ex: Aplicar em V4-R5" placeholderTextColor="#9ca3af" />

              {/* Extras */}
              <View style={s.extrasSection}>
                <View style={s.extrasHeader}>
                  <Text style={s.extrasTitle}>{'Informacoes Adicionais'}</Text>
                  <TouchableOpacity style={s.btnLink} onPress={addExtraField}>
                    <Text style={s.btnLinkText}>{'+ Adicionar campo'}</Text>
                  </TouchableOpacity>
                </View>
                {extraFields.map(f => (
                  <View key={f.id} style={s.extraRow}>
                    <TextInput
                      style={s.extraInput}
                      value={f.value}
                      onChangeText={v => updateExtraField(f.id, v)}
                      placeholder="Nome: valor (ex: Modo de Acao: Estrobilurina)"
                      placeholderTextColor="#9ca3af"
                    />
                    <TouchableOpacity style={s.removeExtraBtn} onPress={() => removeExtraField(f.id)}>
                      <Text style={s.removeExtraText}>{'x'}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {extraFields.length === 0 && (
                  <Text style={s.extrasHint}>{'Adicione campos: Modo de Acao, Formulacao, Compatibilidade...'}</Text>
                )}
              </View>

              <View style={s.btnRow}>
                <TouchableOpacity style={s.btnPrimary} onPress={addProduct} activeOpacity={0.85}>
                  <Text style={s.btnPrimaryText}>{'Adicionar a Lista'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.btnSecondary} onPress={clearForm} activeOpacity={0.85}>
                  <Text style={s.btnSecondaryText}>{'Limpar'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          )}

          {/* ── LISTA PRODUTOS ── */}
          <View style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>{'Produtos na Cotacao'}</Text>
              <Text style={{ fontSize: 12, color: '#6b7280' }}>
                {products.length === 0 ? 'Em montagem' : products.length + ' item' + (products.length !== 1 ? 's' : '')}
              </Text>
            </View>
            <View style={s.cardBody}>

              {/* Tabs */}
              {tabs.length > 1 && (
                <View style={s.tabsRow}>
                  {tabs.map(t => {
                    const cnt = t === 'Todas' ? products.length : products.filter(p => p.cat === t).length;
                    const active = t === currentTab;
                    return (
                      <TouchableOpacity
                        key={t}
                        style={[s.tab, active && s.tabActive]}
                        onPress={() => setActiveTab(t)}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.tabText, active && s.tabTextActive]}>{t}</Text>
                        <Text style={[s.tabCount, active && s.tabCountActive]}>{String(cnt)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Empty */}
              {filtered.length === 0 ? (
                <View style={s.emptyBox}>
                  <Text style={s.emptyTitle}>{'Nenhum produto adicionado'}</Text>
                  <Text style={s.emptyText}>{readOnly ? 'Esta cotacao nao possui produtos' : 'Use o formulario acima para montar a lista'}</Text>
                </View>
              ) : (
                Object.entries(grupos).map(([g, list]) => (
                  <View key={g}>
                    {Object.keys(grupos).length > 1 && (
                      <View style={s.prodGroupHeader}>
                        <Text style={s.prodGroupText}>{g}</Text>
                      </View>
                    )}
                    {list.map(p => (
                      <View key={p.id} style={s.prodItem}>
                        <Text style={s.prodName}>{p.nome}</Text>
                        <View style={s.pillsRow}>
                          <View style={[s.pill, s.pillCat]}><Text style={s.pillCatText}>{p.cat}</Text></View>
                          {!!p.subcat && <View style={[s.pill, s.pillAlvo]}><Text style={s.pillAlvoText}>{p.subcat}</Text></View>}
                          {!!p.tecnologia && <View style={[s.pill, s.pillTec]}><Text style={s.pillTecText}>{p.tecnologia}</Text></View>}
                        </View>
                        {!!p.ia && <Text style={s.prodMeta}>{'i.a.: ' + p.ia}</Text>}
                        {!!p.fonte && <Text style={s.prodMeta}>{'Fonte: ' + p.fonte}</Text>}
                        {!!p.alvo && <Text style={s.prodMeta}>{'Alvo: ' + p.alvo}</Text>}
                        {!!p.estadio && <Text style={s.prodMeta}>{'Estadio: ' + p.estadio}</Text>}
                        {!!p.obs && <Text style={s.prodMeta}>{'Obs: ' + p.obs}</Text>}
                        {p.extras && p.extras.length > 0 && (
                          <Text style={s.prodExtras}>{p.extras.join(' | ')}</Text>
                        )}
                        <View style={s.doseRow}>
                          <Text style={s.doseVal}>{p.dose}</Text>
                          <Text style={s.doseUnit}>{p.unid}</Text>
                          <View style={s.doseLocked}><Text style={s.doseLockedText}>{'TRAVADO'}</Text></View>
                          {!!p.aplic && <Text style={[s.prodMeta, { marginLeft: 10 }]}>{p.aplic + 'x'}</Text>}
                        </View>
                        <View style={s.priceRow}>
                          {p.valor_ha > 0
                            ? <Text style={s.priceVal}>{'R$ ' + p.valor_ha.toFixed(2).replace('.', ',')}</Text>
                            : <Text style={s.pricePending}>{'Preco pendente'}</Text>
                          }
                          {!readOnly && (
                          <View style={s.actionsRow}>
                            <TouchableOpacity style={s.btnEdit} onPress={() => editProd(p.id)} activeOpacity={0.7}>
                              <Text style={s.btnEditText}>{'Editar'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.btnDanger} onPress={() => deleteProd(p.id)} activeOpacity={0.7}>
                              <Text style={s.btnDangerText}>{'Remover'}</Text>
                            </TouchableOpacity>
                          </View>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                ))
              )}
            </View>
          </View>

        </KeyboardAwareScrollView>

      {/* ── BARRA FIXA (Salvar + Compartilhar) — sempre visível ───────────────── */}
      {!readOnly && (
      <View style={[s.stickyFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={s.stickyFooterInner}>
          <TouchableOpacity
            style={[s.btnStickySave, { opacity: savingDB ? 0.7 : 1 }]}
            onPress={saveToSupabase}
            disabled={savingDB}
            activeOpacity={0.85}
          >
            {savingDB ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={s.btnStickySaveText}>
                {editMode ? 'Salvar alterações' : 'Salvar e Gerar Link'}
              </Text>
            )}
          </TouchableOpacity>
          {!!generatedLink && (
            <TouchableOpacity style={s.btnStickyShare} onPress={shareLink} activeOpacity={0.85}>
              <Text style={s.btnStickyShareText}>Compartilhar</Text>
            </TouchableOpacity>
          )}
        </View>
        {!!generatedLink && (
          <TouchableOpacity style={s.stickyLinkRow} onPress={copyLink} activeOpacity={0.85}>
            <Text style={s.stickyLinkText} numberOfLines={1}>{generatedLink}</Text>
            <Text style={s.stickyCopyText}>Copiar</Text>
          </TouchableOpacity>
        )}
      </View>
      )}

      {/* ── MODAL: Selecionar Categoria ── */}
      <Modal visible={catSelectModalOpen} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setCatSelectModalOpen(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setCatSelectModalOpen(false)}>
          <View style={[s.modalCard, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{'Categoria'}</Text>
              <TouchableOpacity onPress={() => setCatSelectModalOpen(false)}>
                <Text style={s.modalDone}>{'Feito'}</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={allCats()}
              keyExtractor={item => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item, index }) => {
                const sel = fCat === item;
                return (
                  <TouchableOpacity
                    style={[s.modalItem, index > 0 && s.modalItemBorder]}
                    onPress={() => { setFCat(item); setCatSelectModalOpen(false); }}
                    activeOpacity={0.7}
                  >
                    <View style={[s.modalRadio, sel && s.modalRadioSel]}>
                      {sel && <View style={s.modalRadioDot} />}
                    </View>
                    <Text style={[s.modalItemText, sel && s.modalItemTextSel]}>{item}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── MODAL: Selecionar Unidade ── */}
      <Modal visible={unidModalOpen} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setUnidModalOpen(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setUnidModalOpen(false)}>
          <View style={[s.modalCard, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{'Unidade'}</Text>
              <TouchableOpacity onPress={() => setUnidModalOpen(false)}>
                <Text style={s.modalDone}>{'Feito'}</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={UNIDADES}
              keyExtractor={item => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item, index }) => {
                const sel = fUnidade === item;
                return (
                  <TouchableOpacity
                    style={[s.modalItem, index > 0 && s.modalItemBorder]}
                    onPress={() => { setFUnidade(item); setUnidModalOpen(false); }}
                    activeOpacity={0.7}
                  >
                    <View style={[s.modalRadio, sel && s.modalRadioSel]}>
                      {sel && <View style={s.modalRadioDot} />}
                    </View>
                    <Text style={[s.modalItemText, sel && s.modalItemTextSel]}>{item}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── MODAL: Gerenciar Categorias ── */}
      <Modal visible={catModalOpen} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setCatModalOpen(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setCatModalOpen(false)}>
          <View style={[s.modalCard, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{'Gerenciar Categorias'}</Text>
              <TouchableOpacity onPress={() => setCatModalOpen(false)}>
                <Text style={s.modalDone}>{'Fechar'}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={s.catChipsWrap}>
                {allCats().map((c, i) => (
                  <View key={c} style={s.catChip}>
                    <Text style={s.catChipText}>{c}</Text>
                    {i >= DEFAULT_CATS.length && (
                      <TouchableOpacity onPress={() => setCustomCats(prev => prev.filter(x => x !== c))}>
                        <Text style={s.catChipDel}>{'x'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
              <View style={s.catInputRow}>
                <TextInput
                  style={s.catInput}
                  value={newCatVal}
                  onChangeText={setNewCatVal}
                  placeholder="Nome da nova categoria..."
                  placeholderTextColor="#9ca3af"
                  onSubmitEditing={addCustomCat}
                  returnKeyType="done"
                />
                <TouchableOpacity style={s.catAddBtn} onPress={addCustomCat} activeOpacity={0.85}>
                  <Text style={s.catAddBtnText}>{'Adicionar'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── NOTIFICACOES ── */}
      {notifs.map(n => (
        <View key={n.id} style={[s.notif, n.type === 'success' ? s.notifSuccess : n.type === 'error' ? s.notifError : s.notifInfo]}>
          <Text style={s.notifText}>{n.msg}</Text>
        </View>
      ))}
    </View>
  );
}