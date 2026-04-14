import { supabase } from '@/lib/supabase'
import { useLanguage } from '@/lib/LanguageContext'
import { useClient } from '@/lib/ClientContext'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Image, Keyboard, Linking, Modal,
  Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native'

type Message = {
  id: string
  content: string
  sender_id: string
  trainer_id: string
  client_id: string
  created_at: string
  read: boolean
  reaction?: string | null
}

type TrainerProfile = {
  id: string
  full_name: string
  avatar_url: string | null
  bio: string | null
  phone: string | null
  email: string | null
  website: string | null
  instagram: string | null
}

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

// ── Trainer Profile Modal ─────────────────────────────────────────────────────
function TrainerProfileModal({ trainer, onClose }: { trainer: TrainerProfile; onClose: () => void }) {
  const { t } = useLanguage()
  const initials = trainer.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  const openLink = (url: string) => {
    if (!url) return
    const full = url.startsWith('http') ? url : `https://${url}`
    Linking.openURL(full)
  }

  const openInstagram = () => {
    if (!trainer.instagram) return
    const handle = trainer.instagram.replace('@', '').replace('https://instagram.com/', '').replace('https://www.instagram.com/', '')
    Linking.openURL(`https://instagram.com/${handle}`).catch(() =>
      Linking.openURL(`instagram://user?username=${handle}`)
    )
  }

  const openPhone = () => trainer.phone && Linking.openURL(`tel:${trainer.phone}`)
  const openEmail = () => trainer.email && Linking.openURL(`mailto:${trainer.email}`)

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={profileStyles.container}>
        {/* Header */}
        <View style={profileStyles.header}>
          <TouchableOpacity onPress={onClose} style={profileStyles.closeBtn}>
            <Text style={profileStyles.closeText}>{t('chat_close')}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
          {/* Avatar + name */}
          <View style={profileStyles.hero}>
            {trainer.avatar_url ? (
              <Image source={{ uri: trainer.avatar_url }} style={profileStyles.heroAvatar} />
            ) : (
              <View style={profileStyles.heroAvatarFallback}>
                <Text style={profileStyles.heroInitials}>{initials}</Text>
              </View>
            )}
            <Text style={profileStyles.heroName}>{trainer.full_name}</Text>
            <Text style={profileStyles.heroRole}>{t('chat_trainer')}</Text>
          </View>

          {/* Bio */}
          {trainer.bio ? (
            <View style={profileStyles.section}>
              <Text style={profileStyles.sectionLabel}>{t('chat_bio')}</Text>
              <Text style={profileStyles.bioText}>{trainer.bio}</Text>
            </View>
          ) : null}

          {/* Contact buttons */}
          <View style={profileStyles.section}>
            <Text style={profileStyles.sectionLabel}>{t('chat_contact')}</Text>
            <View style={profileStyles.contactGrid}>
              {trainer.phone ? (
                <TouchableOpacity style={profileStyles.contactBtn} onPress={openPhone}>
                  <Text style={profileStyles.contactIcon}>📞</Text>
                  <Text style={profileStyles.contactLabel}>{t('chat_call')}</Text>
                  <Text style={profileStyles.contactValue}>{trainer.phone}</Text>
                </TouchableOpacity>
              ) : null}
              {trainer.email ? (
                <TouchableOpacity style={profileStyles.contactBtn} onPress={openEmail}>
                  <Text style={profileStyles.contactIcon}>✉️</Text>
                  <Text style={profileStyles.contactLabel}>{t('chat_email')}</Text>
                  <Text style={profileStyles.contactValue} numberOfLines={1}>{trainer.email}</Text>
                </TouchableOpacity>
              ) : null}
              {trainer.instagram ? (
                <TouchableOpacity style={[profileStyles.contactBtn, profileStyles.contactBtnIG]} onPress={openInstagram}>
                  <Text style={profileStyles.contactIcon}>📸</Text>
                  <Text style={profileStyles.contactLabel}>{t('chat_instagram')}</Text>
                  <Text style={profileStyles.contactValue} numberOfLines={1}>
                    {trainer.instagram.startsWith('@') ? trainer.instagram : `@${trainer.instagram}`}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {trainer.website ? (
                <TouchableOpacity style={profileStyles.contactBtn} onPress={() => openLink(trainer.website!)}>
                  <Text style={profileStyles.contactIcon}>🌐</Text>
                  <Text style={profileStyles.contactLabel}>{t('chat_website')}</Text>
                  <Text style={profileStyles.contactValue} numberOfLines={1}>{trainer.website}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

const profileStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  header: { backgroundColor: '#1e1b4b', paddingTop: 16, paddingHorizontal: 20, paddingBottom: 16, alignItems: 'flex-end' },
  closeBtn: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 99, paddingHorizontal: 14, paddingVertical: 7 },
  closeText: { color: 'white', fontSize: 14, fontWeight: '600' },
  hero: { backgroundColor: '#1e1b4b', alignItems: 'center', paddingBottom: 32, paddingTop: 8 },
  heroAvatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: 'rgba(255,255,255,0.2)', marginBottom: 12 },
  heroAvatarFallback: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#8b5cf6', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  heroInitials: { color: 'white', fontSize: 28, fontWeight: '800' },
  heroName: { fontSize: 22, fontWeight: '800', color: 'white', marginBottom: 4 },
  heroRole: { fontSize: 13, color: '#a5b4fc' },
  section: { margin: 16, marginBottom: 0 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  bioText: { fontSize: 15, color: '#374151', lineHeight: 22, backgroundColor: 'white', borderRadius: 14, padding: 16 },
  contactGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  contactBtn: {
    backgroundColor: 'white', borderRadius: 14, padding: 14, flex: 1, minWidth: '45%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  contactBtnIG: { backgroundColor: '#fdf2f8' },
  contactIcon: { fontSize: 22, marginBottom: 6 },
  contactLabel: { fontSize: 11, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  contactValue: { fontSize: 13, fontWeight: '600', color: '#111827' },
})

// ── Main Chat Screen ──────────────────────────────────────────────────────────
export default function ChatScreen() {
  const { t } = useLanguage()
  const { clientData } = useClient()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [showEmojis, setShowEmojis] = useState(false)
  const [longPressedId, setLongPressedId] = useState<string | null>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [trainerId, setTrainerId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [trainerProfile, setTrainerProfile] = useState<TrainerProfile | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const PAGE = 50

  const [kbOffset, setKbOffset] = useState(0)

  // Re-run when clientData arrives (context may be null on first render)
  useEffect(() => {
    if (!clientData?.clientId) return
    initChat()
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [clientData?.clientId])

  // Manual keyboard height tracking — more reliable than KeyboardAvoidingView inside tabs
  useEffect(() => {
    const TAB_H = Platform.OS === 'ios' ? 88 : 0
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvt, e => {
      setKbOffset(Math.max(0, e.endCoordinates.height - TAB_H))
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80)
    })
    const hide = Keyboard.addListener(hideEvt, () => setKbOffset(0))
    return () => { show.remove(); hide.remove() }
  }, [])

  const initChat = async () => {
    // Use shared ClientContext — avoids a redundant clients fetch
    const cId = clientData?.clientId
    const tId = clientData?.trainerId
    const uid = clientData?.userId
    if (!cId || !tId || !uid) { setLoading(false); return }

    setClientId(cId)
    setTrainerId(tId)
    setUserId(uid)

    const { data: tp } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, bio, phone, email, website, instagram')
      .eq('id', tId)
      .single()
    if (tp) setTrainerProfile(tp)

    await fetchMessages(cId, tId, uid)
    subscribeToMessages(cId, tId, uid)
  }

  const fetchMessages = async (cId: string, tId: string, uid: string) => {
    // Load newest PAGE messages (descending), then reverse for display
    const { data } = await supabase
      .from('messages').select('*')
      .eq('client_id', cId).eq('trainer_id', tId)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    if (data) {
      setMessages(data.reverse())
      setHasMore(data.length === PAGE)
    }
    await supabase.from('messages').update({ read: true })
      .eq('client_id', cId).eq('trainer_id', tId).neq('sender_id', uid).eq('read', false)
    setLoading(false)
  }

  const loadOlderMessages = async () => {
    if (!clientId || !trainerId || !messages.length || loadingOlder) return
    setLoadingOlder(true)
    const oldest = messages[0].created_at
    const { data } = await supabase
      .from('messages').select('*')
      .eq('client_id', clientId).eq('trainer_id', trainerId)
      .order('created_at', { ascending: false })
      .lt('created_at', oldest)
      .limit(PAGE)
    if (data) {
      setMessages(prev => [...data.reverse(), ...prev])
      setHasMore(data.length === PAGE)
    }
    setLoadingOlder(false)
  }

  const subscribeToMessages = (cId: string, tId: string, uid: string) => {
    // Clean up any existing channel before creating a new one
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    channelRef.current = supabase.channel(`mobile-chat-${cId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as Message
        if (msg.client_id !== cId || msg.trainer_id !== tId) return
        // Skip our own messages — they're already in state via optimistic update
        if (msg.sender_id === uid) return
        setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
        supabase.from('messages').update({ read: true }).eq('id', msg.id).neq('sender_id', uid)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as Message
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...msg } : m))
      })
      .subscribe()
  }

  const sendMessage = async () => {
    if (!input.trim() || !userId || !clientId || !trainerId || sending) return
    const content = input.trim()
    setInput('')
    setSending(true)

    // Optimistic update — message appears instantly
    const tempId = `temp-${Date.now()}`
    const tempMsg: Message = {
      id: tempId, content, sender_id: userId,
      trainer_id: trainerId, client_id: clientId,
      created_at: new Date().toISOString(), read: false, reaction: null,
    }
    setMessages(prev => [...prev, tempMsg])
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50)

    const { data: saved, error } = await supabase
      .from('messages')
      .insert({ trainer_id: trainerId, client_id: clientId, sender_id: userId, content, read: false })
      .select().single()

    if (saved) {
      // Replace temp message with real record from DB
      setMessages(prev => prev.map(m => m.id === tempId ? saved : m))
    } else {
      // Remove optimistic message and restore input so user can retry
      setMessages(prev => prev.filter(m => m.id !== tempId))
      setInput(content)
      if (error) console.warn('Send failed:', error.message)
    }
    setSending(false)
  }

  const addReaction = async (msgId: string, emoji: string) => {
    const current = messages.find(m => m.id === msgId)?.reaction
    const newReaction = current === emoji ? null : emoji
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reaction: newReaction } : m))
    await supabase.from('messages').update({ reaction: newReaction }).eq('id', msgId)
    setLongPressedId(null)
  }

  const formatTime = (t: string) =>
    new Date(t).toLocaleTimeString('hr', { hour: '2-digit', minute: '2-digit' })

  const formatDate = (ts: string) => {
    const d = new Date(ts)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return t('chat_today')
    if (d.toDateString() === yesterday.toDateString()) return t('chat_yesterday')
    return d.toLocaleDateString('hr', { day: '2-digit', month: 'long' })
  }

  const groupedMessages = messages.reduce((acc, msg) => {
    const key = new Date(msg.created_at).toDateString()
    if (!acc[key]) acc[key] = []
    acc[key].push(msg)
    return acc
  }, {} as Record<string, Message[]>)

  const trainerName = trainerProfile?.full_name || 'Trener'
  const initials = trainerName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)

  const TrainerAvatar = ({ size = 40, style = {} }: { size?: number; style?: any }) => (
    trainerProfile?.avatar_url ? (
      <Image source={{ uri: trainerProfile.avatar_url }} style={[{ width: size, height: size, borderRadius: size / 2 }, style]} />
    ) : (
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }, style]}>
        <Text style={[styles.avatarText, { fontSize: size * 0.35 }]}>{initials}</Text>
      </View>
    )
  )

  if (loading) return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#8b5cf6" />
    </View>
  )

  return (
    <View style={[styles.container, { paddingBottom: kbOffset }]}>
      {/* Header — tap opens profile */}
      <TouchableOpacity style={styles.header} onPress={() => setShowProfile(true)} activeOpacity={0.85}>
        <TrainerAvatar size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName}>{trainerName}</Text>
          <Text style={styles.headerSub}>{t('chat_header_sub')}</Text>
        </View>
        <Text style={styles.headerChevron}>›</Text>
      </TouchableOpacity>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        showsVerticalScrollIndicator={false}
      >
        {/* Load older messages */}
        {hasMore && (
          <TouchableOpacity
            onPress={loadOlderMessages}
            disabled={loadingOlder}
            style={styles.loadOlderBtn}
            activeOpacity={0.75}
          >
            {loadingOlder
              ? <ActivityIndicator size="small" color="#6b7280" />
              : <Text style={styles.loadOlderText}>{t('chat_older')}</Text>
            }
          </TouchableOpacity>
        )}

        {messages.length === 0 && (
          <View style={styles.emptyChat}>
            <TouchableOpacity onPress={() => setShowProfile(true)} activeOpacity={0.85}>
              <TrainerAvatar size={64} style={{ marginBottom: 12 }} />
            </TouchableOpacity>
            <Text style={styles.emptyChatName}>{trainerName}</Text>
            <Text style={styles.emptyChatSub}>Početak razgovora</Text>
          </View>
        )}

        {Object.entries(groupedMessages).map(([dateKey, dayMessages]) => (
          <View key={dateKey}>
            <View style={styles.dateSeparator}>
              <View style={styles.dateLine} />
              <Text style={styles.dateText}>{formatDate(dayMessages[0].created_at)}</Text>
              <View style={styles.dateLine} />
            </View>

            {dayMessages.map((msg, i) => {
              const isMe = msg.sender_id === userId
              const nextMsg = dayMessages[i + 1]
              const prevMsg = dayMessages[i - 1]
              const isLast = !nextMsg || nextMsg.sender_id !== msg.sender_id
              const isFirst = !prevMsg || prevMsg.sender_id !== msg.sender_id
              const isLongPressed = longPressedId === msg.id

              return (
                <View key={msg.id}>
                  {isLongPressed && (
                    <View style={[styles.reactionPicker, isMe ? styles.reactionPickerRight : styles.reactionPickerLeft]}>
                      {EMOJIS.map(emoji => (
                        <TouchableOpacity key={emoji} onPress={() => addReaction(msg.id, emoji)} style={styles.reactionBtn}>
                          <Text style={styles.reactionEmoji}>{emoji}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  <View style={[styles.messageRow, isMe ? styles.messageRowRight : styles.messageRowLeft, isLast ? styles.messageRowLastSpacing : styles.messageRowSpacing]}>
                    {!isMe && (
                      <TouchableOpacity
                        style={[{ opacity: isLast ? 1 : 0 }, styles.msgAvatarWrap]}
                        onPress={() => setShowProfile(true)}
                        disabled={!isLast}
                      >
                        <TrainerAvatar size={28} />
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      onLongPress={() => setLongPressedId(isLongPressed ? null : msg.id)}
                      activeOpacity={0.85}
                      style={[
                        styles.bubble,
                        isMe ? styles.bubbleMe : styles.bubbleThem,
                        isMe
                          ? (isFirst && isLast ? styles.bubbleMeOnly : isFirst ? styles.bubbleMeFirst : isLast ? styles.bubbleMeLast : styles.bubbleMeMid)
                          : (isFirst && isLast ? styles.bubbleThemOnly : isFirst ? styles.bubbleThemFirst : isLast ? styles.bubbleThemLast : styles.bubbleThemMid),
                      ]}
                    >
                      <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{msg.content}</Text>
                      <View style={styles.bubbleMeta}>
                        <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
                          {formatTime(msg.created_at)}
                        </Text>
                        {isMe && <Text style={styles.readReceipt}>{msg.read ? '✓✓' : '✓'}</Text>}
                      </View>
                    </TouchableOpacity>
                  </View>

                  {msg.reaction && (
                    <TouchableOpacity
                      onPress={() => addReaction(msg.id, msg.reaction!)}
                      style={[styles.reactionBadge, isMe ? styles.reactionBadgeRight : styles.reactionBadgeLeft]}
                    >
                      <Text style={styles.reactionBadgeText}>{msg.reaction}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            })}
          </View>
        ))}
      </ScrollView>

      {/* Input */}
      <View style={styles.inputArea}>
        <TouchableOpacity onPress={() => setShowEmojis(!showEmojis)} style={styles.emojiBtn}>
          <Text style={styles.emojiBtnText}>😊</Text>
        </TouchableOpacity>

        {showEmojis && (
          <View style={styles.emojiPicker}>
            {EMOJIS.map(emoji => (
              <TouchableOpacity key={emoji} onPress={() => { setInput(p => p + emoji); setShowEmojis(false) }} style={styles.emojiPickerBtn}>
                <Text style={styles.emojiPickerText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={t('chat_input')}
          placeholderTextColor="#9ca3af"
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          onPress={sendMessage}
          disabled={!input.trim() || sending}
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
        >
          <Text style={styles.sendBtnText}>➤</Text>
        </TouchableOpacity>
      </View>

      {/* Trainer profile modal */}
      {showProfile && trainerProfile && (
        <TrainerProfileModal trainer={trainerProfile} onClose={() => setShowProfile(false)} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  avatar: { backgroundColor: '#8b5cf6', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: 'white', fontWeight: '700' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1e1b4b', paddingTop: 60, paddingBottom: 16, paddingHorizontal: 20,
  },
  headerName: { fontSize: 16, fontWeight: '700', color: 'white' },
  headerSub: { fontSize: 12, color: '#a5b4fc' },
  headerChevron: { fontSize: 24, color: 'rgba(255,255,255,0.4)', fontWeight: '300' },
  messageList: { flex: 1 },
  messageContent: { padding: 16, paddingBottom: 8 },
  loadOlderBtn: {
    alignSelf: 'center', marginBottom: 16, marginTop: 4,
    backgroundColor: '#f3f4f6', borderRadius: 99,
    paddingHorizontal: 16, paddingVertical: 8, minWidth: 180, alignItems: 'center',
  },
  loadOlderText: { fontSize: 13, color: '#6b7280', fontWeight: '600' },
  emptyChat: { alignItems: 'center', marginTop: 60, marginBottom: 40 },
  emptyChatName: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 },
  emptyChatSub: { fontSize: 13, color: '#9ca3af' },
  dateSeparator: { flexDirection: 'row', alignItems: 'center', marginVertical: 16, gap: 8 },
  dateLine: { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
  dateText: { fontSize: 12, color: '#9ca3af', backgroundColor: '#f3f4f6', paddingHorizontal: 8 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end' },
  messageRowLeft: { justifyContent: 'flex-start' },
  messageRowRight: { justifyContent: 'flex-end' },
  messageRowSpacing: { marginBottom: 2 },
  messageRowLastSpacing: { marginBottom: 8 },
  msgAvatarWrap: { width: 28, height: 28, marginRight: 8, flexShrink: 0 },
  bubble: { maxWidth: '72%', paddingHorizontal: 14, paddingVertical: 8 },
  bubbleMe: { backgroundColor: '#6366f1' },
  bubbleThem: { backgroundColor: 'white', borderWidth: 1, borderColor: '#f3f4f6' },
  bubbleMeOnly: { borderRadius: 20, borderBottomRightRadius: 6 },
  bubbleMeFirst: { borderRadius: 20, borderBottomRightRadius: 4 },
  bubbleMeMid: { borderRadius: 20, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  bubbleMeLast: { borderRadius: 20, borderTopRightRadius: 4, borderBottomRightRadius: 6 },
  bubbleThemOnly: { borderRadius: 20, borderBottomLeftRadius: 6 },
  bubbleThemFirst: { borderRadius: 20, borderBottomLeftRadius: 4 },
  bubbleThemMid: { borderRadius: 20, borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
  bubbleThemLast: { borderRadius: 20, borderTopLeftRadius: 4, borderBottomLeftRadius: 6 },
  bubbleText: { fontSize: 15, color: '#111827', lineHeight: 21 },
  bubbleTextMe: { color: 'white' },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 3 },
  bubbleTime: { fontSize: 10, color: '#9ca3af' },
  bubbleTimeMe: { color: 'rgba(255,255,255,0.6)' },
  readReceipt: { fontSize: 10, color: 'rgba(255,255,255,0.6)' },
  reactionPicker: {
    flexDirection: 'row', backgroundColor: 'white', borderRadius: 99, padding: 8, gap: 4, marginBottom: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
    position: 'relative', zIndex: 10,
  },
  reactionPickerLeft: { alignSelf: 'flex-start', marginLeft: 36 },
  reactionPickerRight: { alignSelf: 'flex-end' },
  reactionBtn: { padding: 4 },
  reactionEmoji: { fontSize: 20 },
  reactionBadge: {
    backgroundColor: 'white', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#e5e7eb', marginTop: -4, marginBottom: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
  },
  reactionBadgeLeft: { alignSelf: 'flex-start', marginLeft: 36 },
  reactionBadgeRight: { alignSelf: 'flex-end' },
  reactionBadgeText: { fontSize: 14 },
  inputArea: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    padding: 12, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#f3f4f6',
  },
  emojiBtn: { padding: 8, marginBottom: 2 },
  emojiBtnText: { fontSize: 22 },
  emojiPicker: {
    position: 'absolute', bottom: 70, left: 12, flexDirection: 'row', backgroundColor: 'white',
    borderRadius: 99, padding: 8, gap: 4, zIndex: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
    borderWidth: 1, borderColor: '#f3f4f6',
  },
  emojiPickerBtn: { padding: 4 },
  emojiPickerText: { fontSize: 22 },
  input: {
    flex: 1, backgroundColor: '#f9fafb', borderRadius: 24,
    paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: '#111827',
    maxHeight: 100, borderWidth: 1, borderColor: '#f3f4f6',
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: '#e5e7eb' },
  sendBtnText: { color: 'white', fontSize: 16 },
})
