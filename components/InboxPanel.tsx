import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { X, ChevronLeft, MessageSquare } from 'lucide-react-native';
import { database } from '@/config/firebase';
import { getDriverConversations, getArchivedMessages } from '@/utils/chat';

const { height } = Dimensions.get('window');

interface InboxPanelProps {
  visible: boolean;
  onClose: () => void;
  driverId: string | null;
}

interface Conversation {
  rideId: string;
  clientName: string;
  pickupAddress: string;
  destinationAddress: string;
  lastMessage: string;
  lastTimestamp: number;
}

export default function InboxPanel({ visible, onClose, driverId }: InboxPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Array<{ id: string; data: any }>>([]);

  // Load the list of past conversations while the panel is open.
  useEffect(() => {
    if (!visible || !driverId) return;
    const unsubscribe = getDriverConversations(database, driverId, setConversations);
    return () => unsubscribe();
  }, [visible, driverId]);

  // Load messages for the conversation the driver tapped into.
  useEffect(() => {
    if (!visible || !driverId || !selected) {
      setMessages([]);
      return;
    }
    const unsubscribe = getArchivedMessages(database, driverId, selected.rideId, setMessages);
    return () => unsubscribe();
  }, [visible, driverId, selected]);

  // Reset to the list whenever the panel is closed.
  useEffect(() => {
    if (!visible) setSelected(null);
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <BlurView intensity={30} style={styles.blurOverlay}>
        <TouchableOpacity style={styles.backdropTouchable} activeOpacity={1} onPress={onClose} />
      </BlurView>

      <View style={styles.panelContainer}>
        <View style={styles.panel}>
          <View style={styles.header}>
            {selected ? (
              <TouchableOpacity onPress={() => setSelected(null)} style={styles.backButton}>
                <ChevronLeft color="#333" size={24} />
              </TouchableOpacity>
            ) : (
              <View style={styles.backButtonPlaceholder} />
            )}
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {selected ? selected.clientName : 'Messages'}
              </Text>
              {selected ? (
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  Past conversation
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X color="#333" size={24} />
            </TouchableOpacity>
          </View>

          {!selected ? (
            <ScrollView
              style={styles.listContainer}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {conversations.length === 0 ? (
                <View style={styles.emptyState}>
                  <MessageSquare color="#CCC" size={40} />
                  <Text style={styles.emptyText}>No past conversations</Text>
                  <Text style={styles.emptySubtext}>
                    Chats with clients will appear here after your trips
                  </Text>
                </View>
              ) : (
                conversations.map((c) => (
                  <TouchableOpacity
                    key={c.rideId}
                    style={styles.convoRow}
                    activeOpacity={0.7}
                    onPress={() => setSelected(c)}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {(c.clientName || 'C').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.convoTextContainer}>
                      <View style={styles.convoTopRow}>
                        <Text style={styles.convoName} numberOfLines={1}>
                          {c.clientName}
                        </Text>
                        {c.lastTimestamp ? (
                          <Text style={styles.convoTime}>
                            {new Date(c.lastTimestamp).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.convoPreview} numberOfLines={1}>
                        {c.lastMessage || 'No messages'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          ) : (
            <ScrollView
              style={styles.messagesContainer}
              contentContainerStyle={styles.messagesContent}
              showsVerticalScrollIndicator={false}
            >
              {messages.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No messages</Text>
                </View>
              ) : (
                messages.map((msg) => {
                  const isDriver = msg.data.sender === 'driver';
                  const senderName = msg.data.senderName || (isDriver ? 'Driver' : 'Client');
                  return (
                    <View
                      key={msg.id}
                      style={[
                        styles.messageBubble,
                        isDriver ? styles.driverBubble : styles.clientBubble,
                      ]}
                    >
                      <Text style={styles.senderName}>{senderName}</Text>
                      <Text style={styles.messageText}>{msg.data.text}</Text>
                      <Text style={styles.timestamp}>
                        {new Date(msg.data.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  },
  blurOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  backdropTouchable: {
    flex: 1,
  },
  panelContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: height * 0.6,
    zIndex: 1001,
  },
  panel: {
    flex: 1,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E8E8E8',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonPlaceholder: {
    width: 40,
    height: 40,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  listContent: {
    paddingVertical: 8,
  },
  convoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F2',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#00C853',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  convoTextContainer: {
    flex: 1,
  },
  convoTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  convoName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginRight: 8,
  },
  convoTime: {
    fontSize: 12,
    color: '#999',
  },
  convoPreview: {
    fontSize: 14,
    color: '#777',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#999',
    marginTop: 12,
    marginBottom: 6,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#BBB',
    textAlign: 'center',
  },
  messagesContainer: {
    flex: 1,
    backgroundColor: '#F9F9F9',
  },
  messagesContent: {
    padding: 16,
  },
  messageBubble: {
    maxWidth: '75%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    marginBottom: 12,
  },
  driverBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#E8E8E8',
    borderBottomLeftRadius: 4,
  },
  clientBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#00C853',
    borderBottomRightRadius: 4,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    opacity: 0.8,
    color: '#333',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 4,
    color: '#000',
  },
  timestamp: {
    fontSize: 11,
    marginTop: 2,
    color: '#888',
    textAlign: 'right',
  },
});
