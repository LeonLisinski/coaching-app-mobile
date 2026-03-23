import { supabase } from '@/lib/supabase'
import { UnitLiftLogo } from '@/lib/UnitLiftLogo'
import { useLanguage } from '@/lib/LanguageContext'
import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native'

const APP_VERSION = '1.0.0'

const LANG_OPTIONS = [
  { value: 'hr' as const, label: 'Hrvatski', flag: '🇭🇷' },
  { value: 'en' as const, label: 'English',  flag: '🇬🇧' },
]

export default function SettingsScreen() {
  const router = useRouter()
  const { lang, setLang, t } = useLanguage()
  const [profile, setProfile] = useState<{ full_name: string; email: string; deletion_requested_at?: string | null } | null>(null)
  const [deleteModalVisible, setDeleteModalVisible] = useState(false)
  const [deleteWord, setDeleteWord] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const deleteInputRef = useRef<TextInput>(null)

  useEffect(() => { loadProfile() }, [])

  const loadProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('profiles')
      .select('full_name, email, deletion_requested_at')
      .eq('id', user.id)
      .single()
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

  // ── Warning 1 ─────────────────────────────────────────────────────────────
  const handleDeleteAccountPress = () => {
    Alert.alert(
      t('settings_delete_warn1_title'),
      t('settings_delete_warn1_msg'),
      [
        { text: t('settings_logout_cancel'), style: 'cancel' },
        {
          text: t('settings_delete_warn1_confirm'),
          style: 'destructive',
          onPress: () => {
            setDeleteWord('')
            setDeleteModalVisible(true)
            setTimeout(() => deleteInputRef.current?.focus(), 400)
          },
        },
      ],
    )
  }

  // ── Warning 2 + actual call ────────────────────────────────────────────────
  const handleDeleteConfirm = async () => {
    const confirmWord = t('settings_delete_confirm_word')
    if (deleteWord.trim() !== confirmWord) {
      Alert.alert('', t('settings_delete_wrong_word'))
      return
    }
    setDeleteLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
        },
      )
      if (!res.ok) throw new Error('Failed')
      setDeleteModalVisible(false)
      Alert.alert('', t('settings_delete_success'), [
        {
          text: 'OK',
          onPress: async () => {
            await supabase.auth.signOut()
            router.replace('/(auth)/login')
          },
        },
      ])
    } catch {
      Alert.alert(t('error'), t('settings_delete_error'))
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleCancelDeletion = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('profiles').update({ deletion_requested_at: null }).eq('id', user.id)
    if (!error) loadProfile()
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

        {/* Danger zone */}
        <View style={[styles.section, styles.dangerSection]}>
          <Text style={styles.dangerLabel}>{t('settings_danger')}</Text>

          {profile?.deletion_requested_at ? (
            <>
              <View style={styles.deletePendingBox}>
                <Text style={styles.deletePendingTitle}>⚠️ {t('settings_delete_pending')}</Text>
                <Text style={styles.deletePendingMsg}>
                  {t('settings_delete_pending_msg').replace(
                    '{date}',
                    new Date(profile.deletion_requested_at).toLocaleDateString(),
                  )}
                </Text>
              </View>
              <TouchableOpacity style={styles.cancelDeleteBtn} onPress={handleCancelDeletion} activeOpacity={0.85}>
                <Text style={styles.cancelDeleteText}>{t('settings_delete_cancel_request')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteAccountPress} activeOpacity={0.85}>
              <Text style={styles.deleteBtnText}>🗑️ {t('settings_delete_account')}</Text>
              <Text style={styles.deleteBtnSub}>{t('settings_delete_sub')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Confirmation modal (Warning 2) */}
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>⚠️ {t('settings_delete_confirm_title')}</Text>
            <Text style={styles.modalMsg}>{t('settings_delete_confirm_msg')}</Text>
            <TextInput
              ref={deleteInputRef}
              style={styles.modalInput}
              value={deleteWord}
              onChangeText={setDeleteWord}
              placeholder={t('settings_delete_confirm_placeholder')}
              placeholderTextColor="#d1d5db"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.modalDeleteBtn, deleteLoading && { opacity: 0.6 }]}
              onPress={handleDeleteConfirm}
              disabled={deleteLoading}
              activeOpacity={0.85}
            >
              <Text style={styles.modalDeleteBtnText}>
                {deleteLoading ? t('loading') : t('settings_delete_confirm_btn')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setDeleteModalVisible(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.modalCancelText}>{t('settings_logout_cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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

  dangerSection: { borderWidth: 1, borderColor: '#fee2e2', backgroundColor: '#fff' },
  dangerLabel: {
    fontSize: 10, fontWeight: '700', color: '#dc2626',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 14,
  },
  deleteBtn: {
    backgroundColor: '#fef2f2', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#fecaca',
  },
  deleteBtnText: { color: '#dc2626', fontSize: 15, fontWeight: '700', marginBottom: 2 },
  deleteBtnSub: { color: '#ef4444', fontSize: 12, opacity: 0.75 },

  deletePendingBox: {
    backgroundColor: '#fffbeb', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#fde68a', marginBottom: 12,
  },
  deletePendingTitle: { fontSize: 14, fontWeight: '700', color: '#92400e', marginBottom: 4 },
  deletePendingMsg: { fontSize: 12, color: '#78350f', lineHeight: 18 },
  cancelDeleteBtn: {
    backgroundColor: '#f3f4f6', borderRadius: 12, paddingVertical: 13,
    alignItems: 'center', borderWidth: 1, borderColor: '#e5e7eb',
  },
  cancelDeleteText: { fontSize: 14, fontWeight: '600', color: '#374151' },

  // Modal styles
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalCard: {
    backgroundColor: 'white', borderRadius: 24, padding: 24,
    width: '100%', maxWidth: 380,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18, shadowRadius: 24, elevation: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 10 },
  modalMsg: { fontSize: 14, color: '#6b7280', lineHeight: 20, marginBottom: 18 },
  modalInput: {
    borderWidth: 2, borderColor: '#fee2e2', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13,
    fontSize: 16, fontWeight: '700', color: '#dc2626',
    letterSpacing: 2, marginBottom: 16,
    backgroundColor: '#fef9f9',
  },
  modalDeleteBtn: {
    backgroundColor: '#dc2626', borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', marginBottom: 10,
  },
  modalDeleteBtnText: { color: 'white', fontSize: 15, fontWeight: '800' },
  modalCancelBtn: {
    paddingVertical: 12, alignItems: 'center',
  },
  modalCancelText: { fontSize: 14, color: '#9ca3af', fontWeight: '600' },
})
