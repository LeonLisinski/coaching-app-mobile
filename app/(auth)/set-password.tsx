// set-password.tsx — Used for both:
//   • Password reset (user clicked "Forgot password" email link)
//   • First-time invite (trainer invited the client, user sets their own password)
//
// The deep link handler in _layout.tsx calls supabase.auth.setSession() before
// routing here, so the user will already be authenticated when this screen mounts.

import { supabase } from '@/lib/supabase'
import { UnitLiftLogo } from '@/lib/UnitLiftLogo'
import { useLanguage } from '@/lib/LanguageContext'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'

export default function SetPasswordScreen() {
  const router = useRouter()
  const { t } = useLanguage()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleSet = async () => {
    if (password.length < 8) { setError(t('setpw_err_length')); return }
    if (password !== confirm) { setError(t('setpw_err_match')); return }

    setLoading(true)
    setError('')

    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (err) {
      setError(t('setpw_err_generic'))
    } else {
      setDone(true)
    }
  }

  if (done) {
    return (
      <View style={styles.root}>
        <View style={styles.successContent}>
          <UnitLiftLogo size={80} borderRadius={22} />
          <Text style={styles.successIcon}>✓</Text>
          <Text style={styles.successTitle}>{t('setpw_done_title')}</Text>
          <Text style={styles.successMsg}>{t('setpw_done_msg')}</Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.88}
          >
            <Text style={styles.btnText}>{t('setpw_done_btn')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.logoWrap}>
          <UnitLiftLogo size={64} borderRadius={18} />
        </View>

        <Text style={styles.title}>{t('setpw_title')}</Text>
        <Text style={styles.sub}>{t('setpw_sub')}</Text>

        <View style={styles.card}>
          {/* New password */}
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>{t('setpw_label')}</Text>
            <View style={[styles.inputWrap, !!error && styles.inputWrapError]}>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="#9ca3af"
                value={password}
                onChangeText={v => { setPassword(v); setError('') }}
                secureTextEntry={!showPw}
                returnKeyType="next"
              />
              <TouchableOpacity onPress={() => setShowPw(s => !s)} style={styles.eyeBtn}>
                <Text style={styles.eyeIcon}>{showPw ? '○' : '●'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Confirm password */}
          <View style={styles.fieldWrap}>
            <Text style={styles.label}>{t('setpw_confirm_label')}</Text>
            <View style={[styles.inputWrap, !!error && styles.inputWrapError]}>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="#9ca3af"
                value={confirm}
                onChangeText={v => { setConfirm(v); setError('') }}
                secureTextEntry={!showPw}
                returnKeyType="done"
                onSubmitEditing={handleSet}
              />
            </View>
          </View>

          {!!error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠  {error}</Text>
            </View>
          )}

          <Text style={styles.hint}>{t('setpw_hint')}</Text>

          <TouchableOpacity
            style={[styles.btn, loading && { opacity: 0.7 }]}
            onPress={handleSet}
            disabled={loading}
            activeOpacity={0.88}
          >
            {loading
              ? <ActivityIndicator color="white" size="small" />
              : <Text style={styles.btnText}>{t('setpw_submit')}</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const INDIGO = '#4f46e5'

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f1f5f9' },
  content: {
    flex: 1, paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 72 : 56,
    paddingBottom: 32,
  },
  logoWrap: { alignItems: 'center', marginBottom: 28 },

  title: { fontSize: 26, fontWeight: '800', color: '#111827', marginBottom: 8, textAlign: 'center' },
  sub: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 20, marginBottom: 28 },

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
  eyeBtn: { padding: 4 },
  eyeIcon: { fontSize: 16, opacity: 0.5 },

  errorBanner: {
    backgroundColor: '#fff5f5', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#fecaca', marginBottom: 12,
  },
  errorText: { fontSize: 13, color: '#dc2626', fontWeight: '500' },

  hint: { fontSize: 12, color: '#9ca3af', marginBottom: 16 },

  btn: {
    backgroundColor: INDIGO, borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', marginTop: 4, minHeight: 52,
    shadowColor: INDIGO, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  btnText: { color: 'white', fontSize: 16, fontWeight: '800' },

  successContent: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32,
  },
  successIcon: {
    fontSize: 48, color: '#22c55e', fontWeight: '800',
    marginTop: 16, marginBottom: 8,
  },
  successTitle: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 8, textAlign: 'center' },
  successMsg: { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
})
