import { supabase } from '@/lib/supabase'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

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

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [showEmojis, setShowEmojis] = useState(false)
  const [longPressedId, setLongPressedId] = useState<string | null>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [trainerId, setTrainerId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [trainerName, setTrainerName] = useState('Trener')
  const scrollRef = useRef<ScrollView>(null)

  useEffect(() => { initChat() }, [])

  const initChat = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)

    const { data: clientData } = await supabase
      .from('clients').select('id, trainer_id').eq('user_id', user.id).single()
    if (!clientData) return setLoading(false)

    setClientId(clientData.id)
    setTrainerId(clientData.trainer_id)

    const { data: trainerProfile } = await supabase
      .from('profiles').select('full_name').eq('id', clientData.trainer_id).single()
    if (trainerProfile) setTrainerName(trainerProfile.full_name)

    await fetchMessages(clientData.id, clientData.trainer_id, user.id)
    subscribeToMessages(clientData.id, clientData.trainer_id, user.id)
  }

  const fetchMessages = async (cId: string, tId: string, uid: string) => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('client_id', cId)
      .eq('trainer_id', tId)
      .order('created_at', { ascending: true })

    if (data) setMessages(data)

    // Mark as read
    await supabase.from('messages').update({ read: true })
      .eq('client_id', cId).eq('trainer_id', tId)
      .neq('sender_id', uid).eq('read', false)

    setLoading(false)
  }

  const subscribeToMessages = (cId: string, tId: string, uid: string) => {
    supabase.channel(`mobile-chat-${cId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as Message
        if (msg.client_id === cId && msg.trainer_id === tId) {
          setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg])
          supabase.from('messages').update({ read: true }).eq('id', msg.id).neq('sender_id', uid)
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as Message
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, ...msg } : m))
      })
      .subscribe()
  }

  const sendMessage = async () => {
    if (!input.trim() || !userId || !clientId || !trainerId || sending) return
    setSending(true)
    const content = input.trim()
    setInput('')
    await supabase.from('messages').insert({
      trainer_id: trainerId,
      client_id: clientId,
      sender_id: userId,
      content,
      read: false,
    })
    setSending(false)
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
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

  const formatDate = (t: string) => {
    const d = new Date(t)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return 'Danas'
    if (d.toDateString() === yesterday.toDateString()) return 'Jučer'
    return d.toLocaleDateString('hr', { day: '2-digit', month: 'long' })
  }

  const groupedMessages = messages.reduce((acc, msg) => {
    const key = new Date(msg.created_at).toDateString()
    if (!acc[key]) acc[key] = []
    acc[key].push(msg)
    return acc
  }, {} as Record<string, Message[]>)

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  if (loading) return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#8b5cf6" />
    </View>
  )

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{getInitials(trainerName)}</Text>
        </View>
        <View>
          <Text style={styles.headerName}>{trainerName}</Text>
          <Text style={styles.headerSub}>Tvoj trener</Text>
        </View>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 && (
          <View style={styles.emptyChat}>
            <View style={styles.emptyChatAvatar}>
              <Text style={styles.emptyChatAvatarText}>{getInitials(trainerName)}</Text>
            </View>
            <Text style={styles.emptyChatName}>{trainerName}</Text>
            <Text style={styles.emptyChatSub}>Početak razgovora</Text>
          </View>
        )}

        {Object.entries(groupedMessages).map(([dateKey, dayMessages]) => (
          <View key={dateKey}>
            {/* Date separator */}
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
                  {/* Reaction picker */}
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
                    {/* Trainer avatar */}
                    {!isMe && (
                      <View style={[styles.msgAvatar, { opacity: isLast ? 1 : 0 }]}>
                        <Text style={styles.msgAvatarText}>{getInitials(trainerName)}</Text>
                      </View>
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
                        {isMe && (
                          <Text style={styles.readReceipt}>{msg.read ? '✓✓' : '✓'}</Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  </View>

                  {/* Reaction badge */}
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
              <TouchableOpacity
                key={emoji}
                onPress={() => { setInput(p => p + emoji); setShowEmojis(false) }}
                style={styles.emojiPickerBtn}
              >
                <Text style={styles.emojiPickerText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Napiši poruku..."
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
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1e1b4b', paddingTop: 60, paddingBottom: 16,
    paddingHorizontal: 20,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#8b5cf6', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: 'white', fontWeight: '700', fontSize: 14 },
  headerName: { fontSize: 16, fontWeight: '700', color: 'white' },
  headerSub: { fontSize: 12, color: '#a5b4fc' },

  messageList: { flex: 1 },
  messageContent: { padding: 16, paddingBottom: 8 },

  emptyChat: { alignItems: 'center', marginTop: 60, marginBottom: 40 },
  emptyChatAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#8b5cf6', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyChatAvatarText: { color: 'white', fontWeight: '700', fontSize: 22 },
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

  msgAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#8b5cf6', alignItems: 'center', justifyContent: 'center', marginRight: 8, flexShrink: 0 },
  msgAvatarText: { color: 'white', fontSize: 10, fontWeight: '700' },

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
    flexDirection: 'row', backgroundColor: 'white', borderRadius: 99,
    padding: 8, gap: 4, marginBottom: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
    position: 'relative', zIndex: 10,
  },
  reactionPickerLeft: { alignSelf: 'flex-start', marginLeft: 36 },
  reactionPickerRight: { alignSelf: 'flex-end' },
  reactionBtn: { padding: 4 },
  reactionEmoji: { fontSize: 20 },

  reactionBadge: {
    backgroundColor: 'white', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#e5e7eb', marginTop: -4, marginBottom: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
  },
  reactionBadgeLeft: { alignSelf: 'flex-start', marginLeft: 36 },
  reactionBadgeRight: { alignSelf: 'flex-end' },
  reactionBadgeText: { fontSize: 14 },

  inputArea: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    padding: 12, backgroundColor: 'white',
    borderTopWidth: 1, borderTopColor: '#f3f4f6',
  },
  emojiBtn: { padding: 8, marginBottom: 2 },
  emojiBtnText: { fontSize: 22 },
  emojiPicker: {
    position: 'absolute', bottom: 70, left: 12,
    flexDirection: 'row', backgroundColor: 'white', borderRadius: 99,
    padding: 8, gap: 4, zIndex: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 4,
    borderWidth: 1, borderColor: '#f3f4f6',
  },
  emojiPickerBtn: { padding: 4 },
  emojiPickerText: { fontSize: 22 },
  input: {
    flex: 1, backgroundColor: '#f9fafb', borderRadius: 24,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, color: '#111827', maxHeight: 100,
    borderWidth: 1, borderColor: '#f3f4f6',
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#e5e7eb' },
  sendBtnText: { color: 'white', fontSize: 16 },
})