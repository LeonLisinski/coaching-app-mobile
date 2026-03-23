import { supabase } from '@/lib/supabase'
import { UnitLiftLogo } from '@/lib/UnitLiftLogo'
import { useLanguage } from '@/lib/LanguageContext'
import { Session } from '@supabase/supabase-js'
import { Redirect } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'

type LoginState = 'idle' | 'loading' | 'success' | 'error'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginState, setLoginState] = useState<LoginState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const { t } = useLanguage()

  const fadeAnim  = useRef(new Animated.Value(0)).current
  const slideAnim = useRef(new Animated.Value(32)).current
  const shakeAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session)).catch(() => {})
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setSession(session))
    return () => subscription.unsubscribe()

    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start()
  }, [])

  if (session) return <Redirect href="/(tabs)" />

  const shakeError = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10,  duration: 60,  useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60,  useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6,   duration: 60,  useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6,  duration: 60,  useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,   duration: 60,  useNativeDriver: true }),
    ]).start()
  }

  const handleLogin = async () => {
    if (loginState === 'loading') return
    const trimmedEmail = email.trim().toLowerCase()

    if (!trimmedEmail || !password) {
      setErrorMsg(t('login_err_fields'))
      setLoginState('error')
      shakeError()
      return
    }

    setLoginState('loading')
    setErrorMsg('')

    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    })

    if (error) {
      const msg =
        error.message.includes('Invalid login') || error.message.includes('invalid_credentials')
          ? t('login_err_invalid')
          : t('login_err_generic')
      setErrorMsg(msg)
      setLoginState('error')
      shakeError()
      return
    }

    if (authData.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, deletion_requested_at')
        .eq('id', authData.user.id)
        .single()

      // Role check — only clients can use the mobile app
      if (profile?.role !== 'client') {
        await supabase.auth.signOut()
        setErrorMsg('Ova aplikacija je namijenjena klijentima. Treneri koriste web platformu na app.unitlift.com.')
        setLoginState('error')
        shakeError()
        return
      }

      // Check if account is pending deletion
      if (profile?.deletion_requested_at) {
        const purgeDate = new Date(new Date(profile.deletion_requested_at).getTime() + 30 * 24 * 60 * 60 * 1000)
        Alert.alert(
          '⚠️ Račun označen za brisanje',
          `Tvoj račun bit će trajno obrisan ${purgeDate.toLocaleDateString()}.\n\nAko želiš poništiti brisanje, idi u Postavke → Obriši račun → Poništi zahtjev.`,
          [{ text: 'Razumijem', style: 'default' }],
        )
      }
    }
    // success: _layout will redirect automatically
  }

  const isLoading = loginState === 'loading'

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />

        {/* Background layers */}
        <View style={styles.bgTop} />
        <View style={styles.bgBottom} />

        {/* Decorative circles */}
        <View style={[styles.circle, styles.circleL]} />
        <View style={[styles.circle, styles.circleR]} />

        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <Animated.View
            style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
          >
            {/* Logo area */}
            <View style={styles.logoWrap}>
              <UnitLiftLogo size={80} borderRadius={22} />
              <Text style={styles.appName}>{t('login_brand')}</Text>
              <Text style={styles.tagline}>{t('login_tagline')}</Text>
            </View>

            {/* Card */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('login_welcome')}</Text>
              <Text style={styles.cardSub}>{t('login_welcome_sub')}</Text>

              {/* Email field */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>{t('login_email_label')}</Text>
                <View style={[
                  styles.inputWrap,
                  loginState === 'error' && !password && styles.inputWrapError,
                ]}>
                  <TextInput
                    style={styles.input}
                    placeholder={t('login_email_placeholder')}
                    placeholderTextColor="#9ca3af"
                    value={email}
                    onChangeText={v => { setEmail(v); setLoginState('idle') }}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoCorrect={false}
                    returnKeyType="next"
                  />
                </View>
              </View>

              {/* Password field */}
              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>{t('login_password_label')}</Text>
                <Animated.View
                  style={[
                    styles.inputWrap,
                    loginState === 'error' && styles.inputWrapError,
                    { transform: [{ translateX: shakeAnim }] },
                  ]}
                >
                  <TextInput
                    style={styles.input}
                    placeholder="••••••••"
                    placeholderTextColor="#9ca3af"
                    value={password}
                    onChangeText={v => { setPassword(v); setLoginState('idle') }}
                    secureTextEntry={!showPassword}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(s => !s)}
                    style={styles.eyeBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.eyeIcon}>{showPassword ? '○' : '●'}</Text>
                  </TouchableOpacity>
                </Animated.View>
              </View>

              {/* Error message */}
              {loginState === 'error' && errorMsg ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerIcon}>⚠</Text>
                  <Text style={styles.errorBannerText}>{errorMsg}</Text>
                </View>
              ) : null}

              {/* CTA button */}
              <TouchableOpacity
                style={[styles.btn, isLoading && styles.btnLoading]}
                onPress={handleLogin}
                disabled={isLoading}
                activeOpacity={0.88}
              >
                {isLoading ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text style={styles.btnText}>{t('login_submit')}</Text>
                )}
              </TouchableOpacity>

              {/* Help text */}
              <Text style={styles.helpText}>
                {t('login_no_account')}
              </Text>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </TouchableWithoutFeedback>
  )
}

const INDIGO = '#4f46e5'
const INDIGO_DARK = '#3730a3'

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: INDIGO_DARK },
  bgTop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: INDIGO_DARK,
    height: '50%',
  },
  bgBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: '60%', backgroundColor: '#f1f5f9',
    borderTopLeftRadius: 40, borderTopRightRadius: 40,
  },

  // Decorative background circles
  circle: {
    position: 'absolute', borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  circleL: { width: 300, height: 300, top: -80, left: -100 },
  circleR: { width: 200, height: 200, top: 40, right: -60 },

  kav: { flex: 1 },
  content: {
    flex: 1, justifyContent: 'center',
    paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },

  // Logo
  logoWrap: { alignItems: 'center', marginBottom: 36, gap: 14 },
  appName: {
    fontSize: 32, fontWeight: '900', color: 'white',
    letterSpacing: -0.5, marginBottom: 4,
  },
  tagline: { fontSize: 14, color: 'rgba(255,255,255,0.55)', fontWeight: '500' },

  // Card
  card: {
    backgroundColor: 'white', borderRadius: 28,
    padding: 28,
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12, shadowRadius: 32, elevation: 10,
  },
  cardTitle: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 4 },
  cardSub: { fontSize: 14, color: '#9ca3af', marginBottom: 28 },

  // Fields
  fieldWrap: { marginBottom: 16 },
  fieldLabel: {
    fontSize: 10, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 1.2, marginBottom: 8,
  },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#f9fafb', borderRadius: 14,
    borderWidth: 1.5, borderColor: '#e5e7eb',
    paddingHorizontal: 14,
  },
  inputWrapError: { borderColor: '#ef4444', backgroundColor: '#fff5f5' },
  input: {
    flex: 1, fontSize: 15, color: '#111827',
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
  },
  eyeBtn: { padding: 4 },
  eyeIcon: { fontSize: 16, opacity: 0.5 },

  // Error
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff5f5', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#fecaca', marginBottom: 16,
  },
  errorBannerIcon: { fontSize: 14, color: '#ef4444' },
  errorBannerText: { flex: 1, fontSize: 13, color: '#dc2626', fontWeight: '500' },

  // Button
  btn: {
    backgroundColor: INDIGO, borderRadius: 16,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    marginTop: 4, marginBottom: 18,
    shadowColor: INDIGO, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 5,
    minHeight: 52,
  },
  btnLoading: { opacity: 0.8 },
  btnText: { color: 'white', fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },

  helpText: { fontSize: 12, color: '#9ca3af', textAlign: 'center', lineHeight: 18 },
})
