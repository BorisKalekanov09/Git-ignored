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
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

type ShapeType = 'circle' | 'rectangle';

const HangarSettings = () => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [shape, setShape] = useState<ShapeType>('circle');
  const [diameter, setDiameter] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [loading, setLoading] = useState(false);

  const validateDimension = (val: string, name: string): number | null => {
    const n = parseFloat(val);
    if (isNaN(n) || n <= 0) {
      Alert.alert('Invalid input', `${name} must be a positive number.`);
      return null;
    }
    return n;
  };

  const handleAdd = async () => {
    if (shape === 'circle') {
      if (!diameter.trim()) { Alert.alert('Missing field', 'Please enter a diameter.'); return; }
      if (validateDimension(diameter, 'Diameter') === null) return;
    }
    if (shape === 'rectangle') {
      if (!width.trim() || !height.trim()) { Alert.alert('Missing fields', 'Please enter both width and height.'); return; }
      if (validateDimension(width, 'Width') === null) return;
      if (validateDimension(height, 'Height') === null) return;
    }

    let user;
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      user = u;
    } catch {
      Alert.alert('Network error', 'Could not reach the server. Check your connection.');
      return;
    }
    if (!user) {
      Alert.alert('Not logged in', 'You must be logged in to add a hangar.');
      return;
    }

    setLoading(true);
    const { data: hangar, error: hError } = await supabase.from('hangars').insert([{
      user_id: user.id,
      shape,
      diameter: shape === 'circle' ? parseFloat(diameter) : null,
      width: shape === 'rectangle' ? parseFloat(width) : null,
      height: shape === 'rectangle' ? parseFloat(height) : null,
    }]).select().single();

    if (hError) {
      setLoading(false);
      Alert.alert('Error', hError.message);
      return;
    }

    // --- Generate Cells (both shapes) ---
    if (hangar) {
      const cellSize = 0.2; // 20 cm per cell
      const cells: { hangar_id: string; index_x: number; index_y: number; status: string }[] = [];

      if (shape === 'circle') {
        const n = Math.ceil(parseFloat(diameter) / cellSize);
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++)
            cells.push({ hangar_id: hangar.id, index_x: x, index_y: y, status: 'pending' });
      } else {
        const cols = Math.ceil(parseFloat(width)  / cellSize);
        const rows = Math.ceil(parseFloat(height) / cellSize);
        for (let y = 0; y < rows; y++)
          for (let x = 0; x < cols; x++)
            cells.push({ hangar_id: hangar.id, index_x: x, index_y: y, status: 'pending' });
      }

      const { error: cError } = await supabase.from('cells').insert(cells);
      if (cError) {
        Alert.alert('Error', 'Failed to generate grid. Please try again.');
        console.error('Cell generation error:', cError);
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    router.push('/robot');
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
          Hangar
        </Text>

        {/* Shape selector */}
        <Text style={{ color: '#8E8E93', fontSize: 15, marginBottom: 8 }}>Shape</Text>
        <View style={{
          backgroundColor: '#1C1C1E',
          borderRadius: 14,
          padding: 4,
          flexDirection: 'row',
          marginBottom: 28,
        }}>
          {(['circle', 'rectangle'] as ShapeType[]).map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setShape(s)}
              activeOpacity={0.7}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: shape === s ? '#3A3A3C' : 'transparent',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: 'white', fontSize: 15, fontWeight: '600', textTransform: 'capitalize' }}>
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Circle fields */}
        {shape === 'circle' && (
          <>
            <Text style={{ color: '#8E8E93', fontSize: 15, marginBottom: 8 }}>Diameter (m)</Text>
            <TextInput
              value={diameter}
              onChangeText={setDiameter}
              placeholder="Diameter"
              placeholderTextColor="#3A3A3C"
              keyboardType="decimal-pad"
              style={{
                backgroundColor: '#1C1C1E',
                borderRadius: 14,
                paddingHorizontal: 16,
                paddingVertical: 14,
                color: 'white',
                fontSize: 16,
                marginBottom: 28,
              }}
            />
          </>
        )}

        {/* Rectangle fields */}
        {shape === 'rectangle' && (
          <>
            <Text style={{ color: '#8E8E93', fontSize: 15, marginBottom: 8 }}>Width (m)</Text>
            <TextInput
              value={width}
              onChangeText={setWidth}
              placeholder="Width"
              placeholderTextColor="#3A3A3C"
              keyboardType="decimal-pad"
              style={{
                backgroundColor: '#1C1C1E',
                borderRadius: 14,
                paddingHorizontal: 16,
                paddingVertical: 14,
                color: 'white',
                fontSize: 16,
                marginBottom: 20,
              }}
            />
            <Text style={{ color: '#8E8E93', fontSize: 15, marginBottom: 8 }}>Height (m)</Text>
            <TextInput
              value={height}
              onChangeText={setHeight}
              placeholder="Height"
              placeholderTextColor="#3A3A3C"
              keyboardType="decimal-pad"
              style={{
                backgroundColor: '#1C1C1E',
                borderRadius: 14,
                paddingHorizontal: 16,
                paddingVertical: 14,
                color: 'white',
                fontSize: 16,
                marginBottom: 28,
              }}
            />
          </>
        )}

        {/* Add button */}
        <TouchableOpacity
          onPress={handleAdd}
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
          {loading
            ? <ActivityIndicator color="white" />
            : <Text style={{ color: 'white', fontSize: 17, fontWeight: '600' }}>Add</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default HangarSettings;