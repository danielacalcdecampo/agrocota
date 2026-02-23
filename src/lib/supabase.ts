import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://fafjknchnibdflpqyssf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3HDU_nViFfOubXqNplV5ow_8FV0Ix0r';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type UserRole = 'consultor' | 'produtor';

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  phone?: string;
  avatar_url?: string;
  company_name?: string;
  cnpj?: string;
  company_logo_url?: string;
  status?: 'active' | 'deleted';
  deleted_at?: string;
  deleted_reason?: string;
  created_at: string;
}
