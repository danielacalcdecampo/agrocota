import React, { useRef } from 'react';
import { NavigationContainer, DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationDefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import RegisterConsultorScreen from '../screens/RegisterConsultorScreen';
import ConsultorHomeScreen from '../screens/ConsultorHomeScreen';
import ProfileScreen from '../screens/ProfileScreen';
import NovaCotacaoScreen from '../screens/NovaCotacaoScreen';
import PlanilhaScreen from '../screens/PlanilhaScreen';
import CotacaoGraficosScreen from '../screens/CotacaoGraficosScreen';
import PropriedadesListScreen from '../screens/PropriedadesListScreen';
import CadastrarPropriedadeScreen from '../screens/CadastrarPropriedadeScreen';
import DetalhePropriedadeScreen from '../screens/DetalhePropriedadeScreen';
import TalhoesMapaScreen from '../screens/TalhoesMapaScreen';
import NovaAnotacaoScreen from '../screens/NovaAnotacaoScreen';
import NovoPlantioScreen from '../screens/NovoPlantioScreen';
import NovoPlanoScreen from '../screens/NovoPlanoScreen';
import DetalhePlanoScreen from '../screens/DetalhePlanoScreen';
import NovaCompraScreen from '../screens/NovaCompraScreen';
import CotacoesListScreen from '../screens/CotacoesListScreen';
import NotificacoesScreen from '../screens/NotificationsScreen';
import PropostasFornecedorScreen from '../screens/PropostasFornecedorScreen';
import GestaoFinanceiraScreen from '../screens/GestaoFinanceiraScreen';
import AdminDashboardScreen from '../screens/AdminDashboardScreen';

import { Colors } from '../theme/colors';
import { useThemeMode } from '../context/ThemeContext';

export type RootStackParamList = {
  Login: undefined;
  RegisterConsultor: undefined;
  ConsultorHome: undefined;
  Profile: undefined;
  NovaCotacao: undefined;
  Planilha: { cotacaoId: string; shareToken: string; titulo: string; fazenda?: string; readOnly?: boolean };
  CotacaoGraficos: { cotacaoId: string; shareToken?: string; compareCotacaoIds?: string[] };
  PropriedadesList: undefined;
  CadastrarPropriedade: { fazendaId?: string };
  DetalhePropriedade: { fazendaId: string };
  TalhoesMapa: { fazendaId: string; fazendaNome: string };
  NovaAnotacao: { fazendaId: string; anotacaoId?: string };
  NovoPlantio: { fazendaId: string; plantioId?: string };
  NovoPlano: { fazendaId: string; planoId?: string };
  DetalhePlano: { planoId: string; fazendaId: string };
  NovaCompra: { fazendaId: string; compraId?: string };
  CotacoesList: undefined;
  Notificacoes: undefined;
  PropostasFornecedor: { cotacaoId: string; titulo: string };
  GestaoFinanceira: undefined;
  AdminDashboard: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function AppNavigator() {
  const { session, loading, registering } = useAuth();
  const { isDark } = useThemeMode();

  const navTheme = isDark
    ? { ...NavigationDarkTheme, colors: { ...NavigationDarkTheme.colors, background: '#0F1712', card: '#17241C', text: '#E9F2EC', border: '#24372B', primary: Colors.secondary } }
    : { ...NavigationDefaultTheme, colors: { ...NavigationDefaultTheme.colors, background: Colors.background, card: Colors.surface, text: Colors.textPrimary, border: Colors.border, primary: Colors.primary } };

  if (loading || registering) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: isDark ? '#0F1712' : Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Stack.Navigator id={undefined} screenOptions={{ headerShown: false }}>
        {!session ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="RegisterConsultor" component={RegisterConsultorScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="ConsultorHome" component={ConsultorHomeScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="NovaCotacao" component={NovaCotacaoScreen} />
            <Stack.Screen name="Planilha" component={PlanilhaScreen} />
            <Stack.Screen name="CotacaoGraficos" component={CotacaoGraficosScreen} />
            <Stack.Screen name="PropriedadesList" component={PropriedadesListScreen} />
            <Stack.Screen name="CadastrarPropriedade" component={CadastrarPropriedadeScreen} />
            <Stack.Screen name="DetalhePropriedade" component={DetalhePropriedadeScreen} />
            <Stack.Screen name="TalhoesMapa" component={TalhoesMapaScreen} />
            <Stack.Screen name="NovaAnotacao" component={NovaAnotacaoScreen} />
            <Stack.Screen name="NovoPlantio" component={NovoPlantioScreen} />
            <Stack.Screen name="NovoPlano" component={NovoPlanoScreen} />
            <Stack.Screen name="DetalhePlano" component={DetalhePlanoScreen} />
            <Stack.Screen name="NovaCompra" component={NovaCompraScreen} />
            <Stack.Screen name="CotacoesList" component={CotacoesListScreen} />
            <Stack.Screen name="Notificacoes" component={NotificacoesScreen} />
            <Stack.Screen name="PropostasFornecedor" component={PropostasFornecedorScreen} options={{ headerShown: false }} />
            <Stack.Screen name="GestaoFinanceira" component={GestaoFinanceiraScreen} options={{ headerShown: false }} />
            <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}