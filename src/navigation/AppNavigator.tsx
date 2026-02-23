import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import RegisterConsultorScreen from '../screens/RegisterConsultorScreen';
import ConsultorHomeScreen from '../screens/ConsultorHomeScreen';
import ProfileScreen from '../screens/ProfileScreen';
import NovaCotacaoScreen from '../screens/NovaCotacaoScreen';
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
import { Colors } from '../theme/colors';

export type RootStackParamList = {
  Login: undefined;
  RegisterConsultor: undefined;
  ConsultorHome: undefined;
  Profile: undefined;
  NovaCotacao: undefined;
  CotacaoGraficos: { cotacaoId: string; shareToken: string };
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
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  const { session, loading, registering } = useAuth();

  if (loading || registering) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
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
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
