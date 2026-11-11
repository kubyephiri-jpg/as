import React, { useState } from 'react';
import { router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Bell, Building2, CarFront, ChevronRight, Globe2, Gift, Headphones, LogOut, LockKeyhole, WalletCards } from 'lucide-react-native';
import { signOut } from 'firebase/auth';
import { auth } from '@/config/firebase';

const items = [{ label: 'Security', icon: LockKeyhole }, { label: 'Bank Details', icon: Building2 }, { label: 'Vehicle and Documents', icon: CarFront }, { label: 'Notifications', icon: Bell }, { label: 'Language', icon: Globe2 }, { label: 'Help and Support', icon: Headphones }, { label: 'Referral', icon: Gift }];
export default function DriverSettings({ driverData, onBack, onNavigate, beforeLogout, hasActiveTrip = false }: { driverData: any; onBack?: () => void; onNavigate: (route: string) => void; beforeLogout?: () => Promise<void>; hasActiveTrip?: boolean }) {
  const balance = Number(driverData?.walletBalance ?? driverData?.floatWallet?.balance ?? driverData?.wallet?.balance ?? driverData?.float ?? 0);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const logout = () => setShowLogoutDialog(true);
  const confirmLogout = async () => {
    if (hasActiveTrip) {
      setShowLogoutDialog(false);
      return;
    }
    setShowLogoutDialog(false);
    await beforeLogout?.();
    await signOut(auth);
    router.replace('/');
  };
  return <View style={styles.screen}><View style={styles.header}><Text style={styles.title}>Settings</Text></View><ScrollView contentContainerStyle={styles.content}>
    <TouchableOpacity style={styles.row} onPress={() => onNavigate('security')}><LockKeyhole color="#2675F5" size={40} /><Text style={styles.label}>Security</Text><ChevronRight color="#727987" size={28} /></TouchableOpacity>
    <View style={styles.wallet}><WalletCards color="#2675F5" size={46} /><View style={styles.walletText}><Text style={styles.label}>Float Wallet</Text><Text style={styles.balanceLabel}>Balance</Text><Text style={styles.balance}>ZMW {balance.toFixed(2)}</Text></View><TouchableOpacity style={styles.topUp} onPress={() => Alert.alert('Top Up', 'Top up is not available yet.')}><Text style={styles.topUpText}>Top Up</Text></TouchableOpacity></View>
    {items.slice(1).map(({ label, icon: Icon }) => <TouchableOpacity key={label} style={styles.row} onPress={() => onNavigate(label)}><Icon color={label === 'Referral' ? '#2675F5' : '#2675F5'} size={40} /><Text style={styles.label}>{label}</Text><ChevronRight color="#727987" size={28} /></TouchableOpacity>)}
    <TouchableOpacity style={[styles.row, styles.logout]} onPress={logout}><LogOut color="#E03131" size={40} /><Text style={[styles.label, styles.logoutText]}>Logout</Text><ChevronRight color="#727987" size={28} /></TouchableOpacity>
  </ScrollView>
  <ConfirmDialog visible={showLogoutDialog} title={hasActiveTrip ? 'Active trip' : 'Log out'} message={hasActiveTrip ? 'You have an active trip. Finish it before logging out.' : 'Are you sure you want to log out?'} confirmLabel={hasActiveTrip ? 'OK' : 'Log out'} cancelLabel={hasActiveTrip ? '' : 'Cancel'} onConfirm={confirmLogout} onCancel={() => setShowLogoutDialog(false)} />
  </View>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#F4F5F8' }, header: { height: 105, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, back: { color: '#2675F5', fontSize: 42, lineHeight: 42 }, headerSpacer: { width: 30 }, title: { fontSize: 22, fontWeight: '700', color: '#10131A' }, content: { padding: 16, paddingBottom: 126, gap: 12 }, row: { minHeight: 72, paddingHorizontal: 18, backgroundColor: '#fff', borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 28, shadowColor: '#000', shadowOpacity: .07, shadowRadius: 10, elevation: 2 }, label: { flex: 1, fontSize: 17, color: '#303643' }, wallet: { minHeight: 120, padding: 18, backgroundColor: '#fff', borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 28, shadowColor: '#000', shadowOpacity: .07, shadowRadius: 10, elevation: 2 }, walletText: { flex: 1 }, balanceLabel: { color: '#727987', fontSize: 13, marginTop: 6 }, balance: { color: '#10131A', fontSize: 20, fontWeight: '800', marginTop: 2 }, topUp: { paddingHorizontal: 22, paddingVertical: 14, borderRadius: 14, backgroundColor: '#2675F5' }, topUpText: { color: '#fff', fontSize: 16, fontWeight: '700' }, logout: { marginBottom: 24 }, logoutText: { color: '#E03131' } });
