import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

const SignUpScreen = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSignUp = () => {
    // TODO: implement registration
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#000' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <Text style={{
          color: 'white',
          fontSize: 22,
          fontWeight: '700',
          textAlign: 'center',
          marginBottom: 40,
        }}>
          Sign Up
        </Text>

        {/* Username */}
        <Text style={{ color: '#8E8E93', fontSize: 15, marginBottom: 8 }}>Username</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="Username"
          placeholderTextColor="#3A3A3C"
          style={{
            backgroundColor: '#1C1C1E',
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 14,
            color: 'white',
            fontSize: 16,
            marginBottom: 20,
          }}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* Email */}
        <Text style={{ color: '#8E8E93', fontSize: 15, marginBottom: 8 }}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor="#3A3A3C"
          style={{
            backgroundColor: '#1C1C1E',
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 14,
            color: 'white',
            fontSize: 16,
            marginBottom: 20,
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />

        {/* Password */}
        <Text style={{ color: '#8E8E93', fontSize: 15, marginBottom: 8 }}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="#3A3A3C"
          style={{
            backgroundColor: '#1C1C1E',
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 14,
            color: 'white',
            fontSize: 16,
            marginBottom: 20,
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* Confirm Password */}
        <Text style={{ color: '#8E8E93', fontSize: 15, marginBottom: 8 }}>Confirm Password</Text>
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Confirm Password"
          placeholderTextColor="#3A3A3C"
          style={{
            backgroundColor: '#1C1C1E',
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 14,
            color: 'white',
            fontSize: 16,
            marginBottom: 32,
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* Sign Up button */}
        <TouchableOpacity
          onPress={handleSignUp}
          activeOpacity={0.8}
          style={{
            backgroundColor: '#EA575F',
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: 'center',
            alignSelf: 'center',
            width: '80%',
          }}
        >
          <Text style={{ color: 'white', fontSize: 17, fontWeight: '600' }}>Sign Up</Text>
        </TouchableOpacity>

        {/* Login link */}
        <TouchableOpacity
          onPress={() => router.push('/login')}
          activeOpacity={0.7}
          style={{ alignItems: 'center', marginTop: 20 }}
        >
          <Text style={{ color: '#8E8E93', fontSize: 15 }}>
            Have an account?{' '}
            <Text style={{ color: '#EA575F', fontWeight: '600' }}>Login</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default SignUpScreen;
