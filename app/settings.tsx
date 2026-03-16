import { supabase } from '@/lib/supabase'
import { UnitLiftLogo } from '@/lib/UnitLiftLogo'
import { useLanguage } from '@/lib/LanguageContext'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'

const APP_VERSION = '1.0.0'

const LANG_OPTIONS = [
  { value: 'hr' as const, label: 'Hrvatski', flag: '🇭🇷' },
  { value: 'en' as const, label: 'English',  flag: '🇬🇧' },
]

export default function SettingsScreen() {
  const router = useRouter()
  const { lang, setLang, t } = useLanguage()
  const [profile, setProfile] = useState<{ full_name: string; email: string } | null>(null)

  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('profiles').select('full_name, email').eq('id', user.id).single()
    if (data) setProfile(data)
  }

  const handleLogout = () => {
    Alert.alert(t('settings_logout_title'), t('settings_logout_msg'), [
      { text: t('settings_logout_cancel'), style: 'cancel' },
      {
        text: t('settings_logout_confirm'), style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut()
          router.replace('/(auth)/login')
        },
      },
    ])
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <View style={styles.backBtnInner}>
            <Text style={styles.backArrow}>‹</Text>
            <Text style={styles.backText}>{t('back')}</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('settings_title')}</Text>
        <Text style={styles.headerSub}>{t('settings_sub')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Profile card */}
        {profile && (
          <View style={styles.profileCard}>
            <View style={styles.avatarWrap}>
              <UnitLiftLogo size={48} borderRadius={14} />
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{profile.full_name}</Text>
              <Text style={styles.profileEmail}>{profile.email}</Text>
            </View>
          </View>
        )}

        {/* Language */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('settings_language')}</Text>
          <Text style={styles.sectionSub}>{t('settings_language_sub')}</Text>
          <View style={styles.langRow}>
            {LANG_OPTIONS.map(opt => {
              const active = lang === opt.value
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.langChip, active && styles.langChipActive]}
                  onPress={() => setLang(opt.value)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.langFlag}>{opt.flag}</Text>
                  <Text style={[styles.langLabel, active && styles.langLabelActive]}>{opt.label}</Text>
                  {active && <Text style={styles.langCheck}>✓</Text>}
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        {/* App info */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('settings_app')}</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoKey}>{t('settings_version')}</Text>
            <Text style={styles.infoVal}>{APP_VERSION}</Text>
          </View>
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.infoKey}>{t('settings_platform')}</Text>
            <Text style={styles.infoVal}>{Platform.OS === 'ios' ? 'iOS' : 'Android'}</Text>
          </View>
        </View>

        {/* Logout */}
        <View style={styles.section}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
            <Text style={styles.logoutText}>{t('settings_logout')}</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },

  header: {
    backgroundColor: '#1d4ed8',
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingHorizontal: 20,
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  backBtn: { marginBottom: 14, alignSelf: 'flex-start' },
  backBtnInner: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8,
  },
  backArrow: { fontSize: 22, color: 'white', lineHeight: 26, fontWeight: '300' },
  backText: { fontSize: 14, color: 'white', fontWeight: '600' },
  headerTitle: { fontSize: 26, fontWeight: '800', color: 'white', marginBottom: 4 },
  headerSub: { fontSize: 14, color: 'rgba(255,255,255,0.55)' },

  content: { padding: 20 },

  profileCard: {
    backgroundColor: 'white', borderRadius: 20, padding: 18,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  avatarWrap: { borderRadius: 14, overflow: 'hidden' },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 2 },
  profileEmail: { fontSize: 13, color: '#9ca3af' },

  section: {
    backgroundColor: 'white', borderRadius: 20, padding: 18,
    marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4,
  },
  sectionSub: { fontSize: 12, color: '#9ca3af', marginBottom: 16 },

  langRow: { flexDirection: 'row', gap: 10 },
  langChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 14, borderRadius: 14,
    borderWidth: 2, borderColor: '#f3f4f6',
    backgroundColor: '#f9fafb',
  },
  langChipActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#1d4ed8',
  },
  langFlag: { fontSize: 22 },
  langLabel: { flex: 1, fontSize: 14, color: '#374151', fontWeight: '600' },
  langLabelActive: { color: '#1d4ed8' },
  langCheck: { fontSize: 14, fontWeight: '700', color: '#1d4ed8' },

  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
  },
  infoKey: { fontSize: 14, color: '#374151', fontWeight: '500' },
  infoVal: { fontSize: 14, color: '#9ca3af' },

  logoutBtn: {
    backgroundColor: '#fef2f2', borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', borderWidth: 1, borderColor: '#fecaca',
  },
  logoutText: { color: '#dc2626', fontSize: 15, fontWeight: '700' },
})
