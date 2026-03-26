import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

const LoginScreen = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = () => {
    // TODO: implement authentication
    router.back();
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
            marginBottom: 32,
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* Login button */}
        <TouchableOpacity
          onPress={handleLogin}
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
          <Text style={{ color: 'white', fontSize: 17, fontWeight: '600' }}>Login</Text>
        </TouchableOpacity>

        {/* Forgot Password */}
        <TouchableOpacity
          onPress={() => {}}
          activeOpacity={0.7}
          style={{ alignItems: 'center', marginTop: 20 }}
        >
          <Text style={{ color: '#8E8E93', fontSize: 15 }}>Forgot Password?</Text>
        </TouchableOpacity>

        {/* Sign Up link */}
        <TouchableOpacity
          onPress={() => router.push('/singup')}
          activeOpacity={0.7}
          style={{ alignItems: 'center', marginTop: 12 }}
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
