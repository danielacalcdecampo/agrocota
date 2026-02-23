import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput,
  StatusBar, Alert, ActivityIndicator, Image, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../navigation/AppNavigator';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'NovaAnotacao'>;
  route: RouteProp<RootStackParamList, 'NovaAnotacao'>;
};

type Bloco = { id?: string; tipo: 'texto' | 'foto'; conteudo: string; ordem: number; uploading?: boolean; };

const NOTE_COLORS = [
  '#FFFFFF','#FFF9C4','#C8E6C9','#BBDEFB',
  '#F8BBD0','#FFE0B2','#E1BEE7','#B2EBF2',
];

export default function NovaAnotacaoScreen({ navigation, route }: Props) {
  const { session } = useAuth();
  const { fazendaId, anotacaoId } = route.params;
  const insets = useSafeAreaInsets();
  const [titulo, setTitulo] = useState('');
  const [blocos, setBlocos] = useState<Bloco[]>([{ tipo: 'texto', conteudo: '', ordem: 0 }]);
  const [cor, setCor] = useState(NOTE_COLORS[0]);
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!anotacaoId);
  const scrollRef = useRef<ScrollView>(null);

  // Load existing note
  useEffect(() => {
    if (!anotacaoId) return;
    (async () => {
      const [aNRes, bNRes] = await Promise.all([
        supabase.from('anotacoes').select('*').eq('id', anotacaoId).single(),
        supabase.from('anotacao_blocos').select('*').eq('anotacao_id', anotacaoId).order('ordem'),
      ]);
      if (aNRes.data) { setTitulo(aNRes.data.titulo ?? ''); setCor(aNRes.data.cor ?? NOTE_COLORS[0]); setPinned(!!aNRes.data.pinned); }
      if (bNRes.data?.length) setBlocos(bNRes.data.map(b => ({ id: b.id, tipo: b.tipo, conteudo: b.conteudo ?? '', ordem: b.ordem })));
      setLoading(false);
    })();
  }, [anotacaoId]);

  const addTextBlock = () => {
    setBlocos(prev => [...prev, { tipo: 'texto', conteudo: '', ordem: prev.length }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const addPhotoBlock = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permissão negada', 'É necessário acesso à galeria.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.7,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const order = blocos.length;
    const tmpId = `tmp-${Date.now()}`;
    setBlocos(prev => [...prev, { tipo: 'foto', conteudo: asset.uri, ordem: order, uploading: true }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    // Upload to Supabase storage
    try {
      const ext = asset.uri.split('.').pop() ?? 'jpg';
      const path = `${session?.user.id}/${fazendaId}/${Date.now()}.${ext}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const { error: upErr } = await supabase.storage.from('anotacoes-fotos').upload(path, blob, { contentType: `image/${ext}` });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('anotacoes-fotos').getPublicUrl(path);
      setBlocos(prev => prev.map(b => b.conteudo === asset.uri ? { ...b, conteudo: publicUrl, uploading: false } : b));
    } catch (e: any) {
      Alert.alert('Erro no upload', e.message ?? 'Tente novamente.');
      setBlocos(prev => prev.filter(b => b.conteudo !== asset.uri));
    }
  };

  const updateBloco = (idx: number, text: string) =>
    setBlocos(prev => prev.map((b, i) => i === idx ? { ...b, conteudo: text } : b));

  const removeBloco = (idx: number) =>
    setBlocos(prev => prev.filter((_, i) => i !== idx).map((b, i) => ({ ...b, ordem: i })));

  const salvar = async () => {
    if (!titulo.trim() && !blocos.some(b => b.conteudo.trim())) {
      Alert.alert('Atenção', 'Adicione um título ou conteúdo antes de salvar.');
      return;
    }
    if (blocos.some(b => b.uploading)) {
      Alert.alert('Aguarde', 'Ainda há fotos sendo enviadas...');
      return;
    }
    setSaving(true);
    try {
      let notaId = anotacaoId;
      if (anotacaoId) {
        const { error } = await supabase.from('anotacoes').update({ titulo: titulo.trim(), cor, pinned }).eq('id', anotacaoId);
        if (error) throw error;
        await supabase.from('anotacao_blocos').delete().eq('anotacao_id', anotacaoId);
      } else {
        const { data, error } = await supabase.from('anotacoes').insert({
          fazenda_id: fazendaId, consultor_id: session?.user.id,
          titulo: titulo.trim(), cor, pinned,
        }).select('id').single();
        if (error) throw error;
        notaId = data.id;
      }
      const blocosPayload = blocos
        .filter(b => b.conteudo.trim())
        .map(b => ({ anotacao_id: notaId, tipo: b.tipo, conteudo: b.conteudo.trim(), ordem: b.ordem }));
      if (blocosPayload.length > 0) {
        const { error } = await supabase.from('anotacao_blocos').insert(blocosPayload);
        if (error) throw error;
      }
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Erro', e.message ?? 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <View style={s.loadRoot}><ActivityIndicator size="large" color="#2E7D32" /></View>;

  return (
    <View style={[s.root, { backgroundColor: cor }]}>
      <StatusBar barStyle="dark-content" backgroundColor={cor} />
      {/* HEADER */}
      <View style={[s.header, { backgroundColor: cor, paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.8}>
          <Text style={s.backTxt}>‹  Voltar</Text>
        </TouchableOpacity>
        <View style={s.headerActions}>
          <TouchableOpacity style={[s.pinBtn, pinned && s.pinActive]} onPress={() => setPinned(!pinned)} activeOpacity={0.8}>
            <Text style={{ fontSize: 18 }}>📌</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.saveBtn} onPress={salvar} disabled={saving} activeOpacity={0.85}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.saveBtnTxt}>Salvar</Text>}
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {/* Title */}
          <TextInput
            style={s.titleInput}
            placeholder="Título da anotação"
            placeholderTextColor="rgba(0,0,0,0.3)"
            value={titulo}
            onChangeText={setTitulo}
            multiline
            returnKeyType="next"
          />

          {/* Blocks */}
          {blocos.map((bloco, idx) => (
            <View key={idx} style={s.blocoWrap}>
              {bloco.tipo === 'texto' ? (
                <TextInput
                  style={s.textoInput}
                  placeholder="Escreva aqui..."
                  placeholderTextColor="rgba(0,0,0,0.25)"
                  value={bloco.conteudo}
                  onChangeText={t => updateBloco(idx, t)}
                  multiline
                  textAlignVertical="top"
                />
              ) : (
                <View style={s.fotoBloco}>
                  {bloco.uploading ? (
                    <View style={s.fotoLoading}><ActivityIndicator color="#2E7D32" /></View>
                  ) : (
                    <Image source={{ uri: bloco.conteudo }} style={s.fotoImg} resizeMode="cover" />
                  )}
                </View>
              )}
              {blocos.length > 1 && (
                <TouchableOpacity style={s.removeBlocoBtn} onPress={() => removeBloco(idx)} activeOpacity={0.7}>
                  <Text style={s.removeBloco}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Toolbar */}
        <View style={[s.toolbar, { backgroundColor: cor === '#FFFFFF' ? '#f5f5f5' : cor + 'cc' }]}>
          {/* Color picker */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
            {NOTE_COLORS.map(c => (
              <TouchableOpacity
                key={c}
                style={[s.colorDot, { backgroundColor: c }, cor === c && s.colorDotActive, c === '#FFFFFF' && { borderWidth: 1, borderColor: '#ddd' }]}
                onPress={() => setCor(c)}
                activeOpacity={0.8}
              />
            ))}
          </ScrollView>
          {/* Block buttons */}
          <View style={s.toolbarBtns}>
            <TouchableOpacity style={s.toolBtn} onPress={addTextBlock} activeOpacity={0.8}>
              <Text style={s.toolBtnTxt}>T+</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.toolBtn} onPress={addPhotoBlock} activeOpacity={0.8}>
              <Text style={s.toolBtnTxt}>📷</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  loadRoot: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    paddingTop: 10, paddingBottom: 10, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.1)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)',
    minWidth: 88, alignItems: 'center',
  },
  backTxt: { color: '#333', fontSize: 14, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pinBtn: { padding: 6, borderRadius: 20, opacity: 0.4 },
  pinActive: { opacity: 1 },
  saveBtn: { backgroundColor: '#2E7D32', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20 },
  saveBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  titleInput: {
    fontSize: 22, fontWeight: '800', color: '#111',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, lineHeight: 30,
  },
  blocoWrap: { marginHorizontal: 16, marginTop: 10, position: 'relative' },
  textoInput: {
    fontSize: 15, color: '#333', lineHeight: 24,
    minHeight: 80, paddingHorizontal: 4, paddingVertical: 4,
  },
  fotoBloco: { borderRadius: 12, overflow: 'hidden' },
  fotoLoading: { height: 180, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 12 },
  fotoImg: { width: '100%', height: 200, borderRadius: 12 },
  removeBlocoBtn: {
    position: 'absolute', top: 0, right: 0, width: 26, height: 26,
    backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: 13, justifyContent: 'center', alignItems: 'center',
  },
  removeBloco: { color: '#444', fontSize: 12, fontWeight: '700' },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)',
    paddingBottom: Platform.OS === 'ios' ? 28 : 10,
  },
  colorDot: { width: 28, height: 28, borderRadius: 14 },
  colorDotActive: { borderWidth: 3, borderColor: '#2E7D32' },
  toolbarBtns: { flexDirection: 'row', gap: 8, marginLeft: 8 },
  toolBtn: {
    backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  toolBtnTxt: { fontSize: 15, fontWeight: '700', color: '#444' },
});
