import AsyncStorage from '@react-native-async-storage/async-storage'
import { useLanguage } from '@/lib/LanguageContext'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'

const HAS_SEEN_ONBOARDING = 'hasSeenOnboarding'
const { width: SCREEN_W } = Dimensions.get('window')

const SLIDES = [1, 2, 3] as const

export default function OnboardingScreen() {
  const router = useRouter()
  const { t } = useLanguage()
  const scrollRef = useRef<ScrollView>(null)
  const [page, setPage] = useState(0)

  const finish = async () => {
    await AsyncStorage.setItem(HAS_SEEN_ONBOARDING, 'true')
    const { data: { session } } = await supabase.auth.getSession()
    router.replace(session ? '/(tabs)' : '/(auth)/login')
  }

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x
    setPage(Math.round(x / SCREEN_W))
  }

  const goNext = () => {
    if (page < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({ x: (page + 1) * SCREEN_W, animated: true })
    } else {
      void finish()
    }
  }

  const slideCopy = (n: 1 | 2 | 3) => {
    if (n === 1) return { icon: '💪', title: t('onboarding_s1_title'), body: t('onboarding_s1_body') }
    if (n === 2) return { icon: '📋', title: t('onboarding_s2_title'), body: t('onboarding_s2_body') }
    return { icon: '💬', title: t('onboarding_s3_title'), body: t('onboarding_s3_body') }
  }

  return (
    <View style={styles.root}>
      <TouchableOpacity style={styles.skipBtn} onPress={() => void finish()} activeOpacity={0.75}>
        <Text style={styles.skipText}>{t('skip')}</Text>
      </TouchableOpacity>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
        style={styles.scroll}
      >
        {SLIDES.map(n => {
          const { icon, title, body } = slideCopy(n)
          return (
            <View key={n} style={[styles.slide, { width: SCREEN_W }]}>
              <Text style={styles.icon}>{icon}</Text>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.body}>{body}</Text>
            </View>
          )
        })}
      </ScrollView>

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
        ))}
      </View>

      <TouchableOpacity style={styles.cta} onPress={goNext} activeOpacity={0.9}>
        <Text style={styles.ctaText}>
          {page === SLIDES.length - 1 ? t('onboarding_start') : t('onboarding_next')}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  skipBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 52 : 40,
    right: 20,
    zIndex: 2,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  skipText: { fontSize: 15, fontWeight: '600', color: '#6b7280' },
  scroll: { flex: 1 },
  slide: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: { fontSize: 64, marginBottom: 24 },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 30,
  },
  body: {
    fontSize: 16,
    color: '#4b5563',
    textAlign: 'center',
    lineHeight: 24,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#d1d5db',
  },
  dotActive: {
    backgroundColor: '#1d4ed8',
    width: 22,
  },
  cta: {
    marginHorizontal: 24,
    backgroundColor: '#1d4ed8',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaText: { color: 'white', fontSize: 17, fontWeight: '700' },
})
