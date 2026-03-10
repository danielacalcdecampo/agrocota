import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  StatusBar, Alert, ActivityIndicator, Image, Platform, Modal, ScrollView,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
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

type Bloco = { id?: string; tipo: 'texto' | 'foto'; conteudo: string; ordem: number; uploading?: boolean; storagePath?: string; };

const FOTO_STORAGE_PREFIX = 'storage://anotacoes-fotos/';

const buildFotoStorageMarker = (path: string) => `${FOTO_STORAGE_PREFIX}${path}`;

const extractFotoStoragePath = (conteudo: string): string | null => {
  if (!conteudo) return null;
  if (conteudo.startsWith(FOTO_STORAGE_PREFIX)) {
    return conteudo.slice(FOTO_STORAGE_PREFIX.length);
  }

  const publicIdx = conteudo.indexOf('/storage/v1/object/public/anotacoes-fotos/');
  if (publicIdx >= 0) {
    return decodeURIComponent(conteudo.slice(publicIdx + '/storage/v1/object/public/anotacoes-fotos/'.length).split('?')[0]);
  }

  const signIdx = conteudo.indexOf('/storage/v1/object/sign/anotacoes-fotos/');
  if (signIdx >= 0) {
    return decodeURIComponent(conteudo.slice(signIdx + '/storage/v1/object/sign/anotacoes-fotos/'.length).split('?')[0]);
  }

  return null;
};

const NOTE_COLORS = [
  '#FFFFFF', '#FDF2F8', '#FFF9C4', '#FFE0B2', '#FFECB3',
  '#C8E6C9', '#DCEDC8', '#B2EBF2', '#BBDEFB', '#C5CAE9',
  '#E1BEE7', '#D1C4E9', '#F8BBD0', '#D7CCC8',
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
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [downloadingPreview, setDownloadingPreview] = useState(false);
  const scrollRef = useRef<KeyboardAwareScrollView>(null);

  const toDisplayFotoUrl = useCallback(async (conteudoRaw: string) => {
    const storagePath = extractFotoStoragePath(conteudoRaw);
    if (!storagePath) {
      return { conteudo: conteudoRaw, storagePath: undefined as string | undefined };
    }

    const { data: signedData, error: signedErr } = await supabase
      .storage
      .from('anotacoes-fotos')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30);

    if (signedErr || !signedData?.signedUrl) {
      const { data } = supabase.storage.from('anotacoes-fotos').getPublicUrl(storagePath);
      return { conteudo: data.publicUrl, storagePath };
    }

    return { conteudo: signedData.signedUrl, storagePath };
  }, []);

  // Load existing note
  useEffect(() => {
    if (!anotacaoId) return;
    (async () => {
      const [aNRes, bNRes] = await Promise.all([
        supabase.from('anotacoes').select('*').eq('id', anotacaoId).single(),
        supabase.from('anotacao_blocos').select('*').eq('anotacao_id', anotacaoId).order('ordem'),
      ]);
      if (aNRes.data) { setTitulo(aNRes.data.titulo ?? ''); setCor(aNRes.data.cor ?? NOTE_COLORS[0]); setPinned(!!aNRes.data.pinned); }
      if (bNRes.data?.length) {
        const loaded = await Promise.all(
          bNRes.data.map(async (b) => {
            if (b.tipo !== 'foto') {
              return { id: b.id, tipo: b.tipo, conteudo: b.conteudo ?? '', ordem: b.ordem } as Bloco;
            }
            const resolved = await toDisplayFotoUrl(b.conteudo ?? '');
            return {
              id: b.id,
              tipo: b.tipo,
              conteudo: resolved.conteudo,
              ordem: b.ordem,
              storagePath: resolved.storagePath,
            } as Bloco;
          }),
        );
        setBlocos(loaded);
      }
      setLoading(false);
    })();
  }, [anotacaoId, toDisplayFotoUrl]);

  const addTextBlock = () => {
    setBlocos(prev => [...prev, { tipo: 'texto', conteudo: '', ordem: prev.length }]);
    setTimeout(() => (scrollRef.current as any)?.scrollToEnd({ animated: true }), 100);
  };

  const addPhotoBlock = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permissão negada', 'É necessário acesso à galeria.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.7,
      allowsEditing: false,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const order = blocos.length;
    const tmpId = `tmp-${Date.now()}`;
    setBlocos(prev => [...prev, { tipo: 'foto', conteudo: asset.uri, ordem: order, uploading: true }]);
    setTimeout(() => (scrollRef.current as any)?.scrollToEnd({ animated: true }), 100);

    // Upload to Supabase storage
    try {
      const mime = (asset.mimeType || '').toLowerCase();
      let ext = 'jpg';
      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else if (mime.includes('heic')) ext = 'heic';
      else if (mime.includes('heif')) ext = 'heif';
      else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';

      const contentType = asset.mimeType || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const path = `${session?.user.id}/${fazendaId}/${Date.now()}.${ext}`;

      let base64Data = asset.base64 ?? null;
      if (!base64Data) {
        base64Data = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const { error: upErr } = await supabase.storage
        .from('anotacoes-fotos')
        .upload(path, bytes.buffer as ArrayBuffer, { contentType, upsert: false });
      if (upErr) throw upErr;

      const resolved = await toDisplayFotoUrl(buildFotoStorageMarker(path));

      setBlocos(prev => prev.map(b => b.conteudo === asset.uri ? {
        ...b,
        conteudo: resolved.conteudo,
        storagePath: path,
        uploading: false,
      } : b));
    } catch (e: any) {
      Alert.alert('Erro no upload', e.message ?? 'Tente novamente.');
      setBlocos(prev => prev.filter(b => b.conteudo !== asset.uri));
    }
  };

  const updateBloco = (idx: number, text: string) =>
    setBlocos(prev => prev.map((b, i) => i === idx ? { ...b, conteudo: text } : b));

  const removeBloco = (idx: number) =>
    setBlocos(prev => prev.filter((_, i) => i !== idx).map((b, i) => ({ ...b, ordem: i })));

  const abrirPreviewFoto = (uri: string) => {
    if (!uri) return;
    setPreviewUri(uri);
    setPreviewVisible(true);
  };

  const baixarFotoPreview = async () => {
    if (!previewUri) return;
    setDownloadingPreview(true);
    try {
      let localUri = previewUri;
      if (previewUri.startsWith('http')) {
        const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
        const targetPath = `${baseDir}nota-foto-${Date.now()}.jpg`;
        const result = await FileSystem.downloadAsync(previewUri, targetPath);
        localUri = result.uri;
      }

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Não foi possível salvar', 'Abra no navegador e salve a imagem manualmente.');
        return;
      }

      await Sharing.shareAsync(localUri, {
        dialogTitle: 'Baixar / salvar foto da anotação',
      });
    } catch (e: any) {
      Alert.alert('Erro ao baixar', e?.message ?? 'Não foi possível baixar a imagem.');
    } finally {
      setDownloadingPreview(false);
    }
  };

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
        .map(b => ({
          anotacao_id: notaId,
          tipo: b.tipo,
          conteudo: b.tipo === 'foto' && b.storagePath
            ? buildFotoStorageMarker(b.storagePath)
            : b.conteudo.trim(),
          ordem: b.ordem,
        }));
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

      <KeyboardAwareScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
      >
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
                    <TouchableOpacity activeOpacity={0.9} onPress={() => abrirPreviewFoto(bloco.conteudo)}>
                      <Image source={{ uri: bloco.conteudo }} style={s.fotoImg} resizeMode="cover" />
                    </TouchableOpacity>
                  )}
                </View>
              )}
              {blocos.length > 1 && (
                <TouchableOpacity style={s.removeBlocoBtn} onPress={() => removeBloco(idx)} activeOpacity={0.7}>
                  <Text style={s.removeBloco}>X</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <View style={{ height: 132 + insets.bottom }} />
      </KeyboardAwareScrollView>

        {/* Toolbar */}
        <View
          style={[
            s.toolbar,
            {
              backgroundColor: cor === '#FFFFFF' ? '#f5f5f5' : cor + 'cc',
              paddingBottom: Math.max(insets.bottom + 8, 16),
              marginBottom: Platform.OS === 'android' ? 6 : 0,
            },
          ]}
        >
          {/* Color picker */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.paletteScroll} contentContainerStyle={s.paletteContent}>
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
              <Text style={s.toolBtnTxt}>Foto</Text>
            </TouchableOpacity>
          </View>
        </View>

      <Modal
        visible={previewVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewVisible(false)}
      >
        <View style={s.previewOverlay}>
          <TouchableOpacity style={s.previewClose} onPress={() => setPreviewVisible(false)} activeOpacity={0.8}>
            <Text style={s.previewCloseTxt}>X</Text>
          </TouchableOpacity>

          {previewUri ? (
            <Image source={{ uri: previewUri }} style={s.previewImage} resizeMode="contain" />
          ) : null}

          <View style={s.previewActions}>
            <TouchableOpacity style={s.previewBtn} onPress={baixarFotoPreview} activeOpacity={0.85} disabled={downloadingPreview}>
              {downloadingPreview ? <ActivityIndicator color="#fff" /> : <Text style={s.previewBtnTxt}>Baixar</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  loadRoot: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    minHeight: 80,
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
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)',
  },
  paletteScroll: { flex: 0, maxWidth: '74%' },
  paletteContent: { gap: 6, paddingHorizontal: 2 },
  colorDot: { width: 30, height: 30, borderRadius: 15 },
  colorDotActive: { borderWidth: 3, borderColor: '#2E7D32' },
  toolbarBtns: { flexDirection: 'row', gap: 6, marginLeft: 6 },
  toolBtn: {
    backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  toolBtnTxt: { fontSize: 15, fontWeight: '700', color: '#444' },

  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  previewClose: {
    position: 'absolute',
    top: 54,
    right: 22,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  previewCloseTxt: { color: '#fff', fontSize: 18, fontWeight: '700' },
  previewImage: { width: '100%', height: '74%' },
  previewActions: {
    position: 'absolute',
    bottom: 42,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  previewBtn: {
    backgroundColor: '#2E7D32',
    paddingHorizontal: 26,
    paddingVertical: 12,
    borderRadius: 24,
    minWidth: 130,
    alignItems: 'center',
  },
  previewBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
