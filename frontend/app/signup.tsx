import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

const SignUpScreen = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp } = useAuth();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const handleSignUp = async () => {
    setError('');
    setInfo('');

    if (!username || !email || !password || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const { error: signUpError, needsConfirmation } = await signUp(email, username, password);
      if (signUpError) {
        setError(signUpError);
      } else if (needsConfirmation) {
        setInfo('Check your email for a confirmation link, then log in.');
      } else {
        router.replace('/(tabs)/home');
      }
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
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
            marginBottom: 24,
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* Error / Info messages */}
        {error ? (
          <Text style={{ color: '#EA575F', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
            {error}
          </Text>
        ) : null}
        {info ? (
          <Text style={{ color: '#34C759', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
            {info}
          </Text>
        ) : null}

        {/* Sign Up button */}
        <TouchableOpacity
          onPress={handleSignUp}
          activeOpacity={0.8}
          disabled={loading}
          style={{
            backgroundColor: '#EA575F',
            borderRadius: 14,
            paddingVertical: 16,
            alignItems: 'center',
            alignSelf: 'center',
            width: '80%',
          }}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={{ color: 'white', fontSize: 17, fontWeight: '600' }}>Sign Up</Text>
          )}
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
