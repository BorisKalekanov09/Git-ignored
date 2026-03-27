import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

const LoginScreen = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setError('');
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    try {
      const { error: signInError } = await signIn(email, password);
      if (signInError) {
        setError(signInError);
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
      <View style={{
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: insets.top + 40,
      }}>

        {/* Title */}
        <Text style={{
          color: 'white',
          fontSize: 22,
          fontWeight: '700',
          textAlign: 'center',
          marginBottom: 40,
        }}>
          Login
        </Text>

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
            marginBottom: 24,
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* Error message */}
        {error ? (
          <Text style={{ color: '#EA575F', fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
            {error}
          </Text>
        ) : null}

        {/* Login button */}
        <TouchableOpacity
          onPress={handleLogin}
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
            <Text style={{ color: 'white', fontSize: 17, fontWeight: '600' }}>Login</Text>
          )}
        </TouchableOpacity>

        {/* Sign Up link */}
        <TouchableOpacity
          onPress={() => router.push('/signup')}
          activeOpacity={0.7}
          style={{ alignItems: 'center', marginTop: 20 }}
        >
          <Text style={{ color: '#8E8E93', fontSize: 15 }}>
            Don't have an account?{' '}
            <Text style={{ color: '#EA575F', fontWeight: '600' }}>Sign Up</Text>
          </Text>
        </TouchableOpacity>

      </View>
    </KeyboardAvoidingView>
  );
};

export default LoginScreen;
