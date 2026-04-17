import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/LanguageContext'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'

export default function ForgotPasswordScreen() {
  const router = useRouter()
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleReset = async () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) { setError(t('login_err_fields')); return }
    setLoading(true)
    setError('')
    // Custom Resend email + client-auth link (not the trainer Supabase template).
    const { data, error: invokeErr } = await supabase.functions.invoke('send-client-password-reset', {
      body: { email: trimmed },
    })
    setLoading(false)
    const payloadErr =
      data && typeof data === 'object' && data !== null && 'error' in data
        ? (data as { error?: string }).error
        : undefined
    if (invokeErr || payloadErr) {
      setError(t('forgot_err'))
    } else {
      setSent(true)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹  {t('back')}</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{t('forgot_title')}</Text>
        <Text style={styles.sub}>{t('forgot_sub')}</Text>

        {sent ? (
          <View style={styles.successCard}>
            <Text style={styles.successIcon}>✉️</Text>
            <Text style={styles.successTitle}>{t('forgot_sent_title')}</Text>
            <Text style={styles.successMsg}>{t('forgot_sent_msg')}</Text>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Text style={styles.backBtnText}>{t('back_to_login')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.fieldWrap}>
              <Text style={styles.label}>{t('login_email_label')}</Text>
              <View style={[styles.inputWrap, !!error && styles.inputWrapError]}>
                <TextInput
                  style={styles.input}
                  placeholder={t('login_email_placeholder')}
                  placeholderTextColor="#9ca3af"
                  value={email}
                  onChangeText={v => { setEmail(v); setError('') }}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleReset}
                />
              </View>
            </View>

            {!!error && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>⚠  {error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.btn, loading && { opacity: 0.7 }]}
              onPress={handleReset}
              disabled={loading}
              activeOpacity={0.88}
            >
              {loading
                ? <ActivityIndicator color="white" size="small" />
                : <Text style={styles.btnText}>{t('forgot_submit')}</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

const INDIGO = '#4f46e5'

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f1f5f9' },
  content: {
    flex: 1, paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 64 : 48,
    paddingBottom: 32,
  },
  back: { marginBottom: 28 },
  backText: { fontSize: 16, color: INDIGO, fontWeight: '600' },

  title: { fontSize: 26, fontWeight: '800', color: '#111827', marginBottom: 8 },
  sub: { fontSize: 14, color: '#6b7280', lineHeight: 20, marginBottom: 28 },

  card: {
    backgroundColor: 'white', borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 3,
  },

  fieldWrap: { marginBottom: 16 },
  label: { fontSize: 10, fontWeight: '700', color: '#9ca3af', letterSpacing: 1.2, marginBottom: 8 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f9fafb', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#e5e7eb', paddingHorizontal: 14,
  },
  inputWrapError: { borderColor: '#ef4444', backgroundColor: '#fff5f5' },
  input: { flex: 1, fontSize: 15, color: '#111827', paddingVertical: Platform.OS === 'ios' ? 14 : 12 },

  errorBanner: {
    backgroundColor: '#fff5f5', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#fecaca', marginBottom: 16,
  },
  errorText: { fontSize: 13, color: '#dc2626', fontWeight: '500' },

  btn: {
    backgroundColor: INDIGO, borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', marginTop: 4, minHeight: 52,
    shadowColor: INDIGO, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  btnText: { color: 'white', fontSize: 16, fontWeight: '800' },

  successCard: {
    backgroundColor: 'white', borderRadius: 24, padding: 32,
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 3,
  },
  successIcon: { fontSize: 48, marginBottom: 16 },
  successTitle: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 8, textAlign: 'center' },
  successMsg: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  backBtn: {
    backgroundColor: INDIGO, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32,
  },
  backBtnText: { color: 'white', fontWeight: '700', fontSize: 15 },
})
