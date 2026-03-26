import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  LayoutRectangle,
} from 'react-native';
import { CameraView } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

const FINDER_SIZE = 240;
const CORNER_SIZE = 28;
const CORNER_WIDTH = 4;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingBottom: 20,
  },
  title: {
    color: 'white',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#8E8E93',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 32,
  },
  finderWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  finder: {
    width: FINDER_SIZE,
    height: FINDER_SIZE,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: '#EA575F',
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderTopLeftRadius: 4,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderTopRightRadius: 4,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomLeftRadius: 4,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderBottomRightRadius: 4,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingTop: 16,
  },
  button: {
    backgroundColor: '#EA575F',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    width: '80%',
  },
  buttonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '600',
  },
  cancelLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  cancelText: {
    color: '#8E8E93',
    fontSize: 15,
  },
});

export default function ScanRobotScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [scanned, setScanned] = useState(false);
  const finderLayout = useRef<LayoutRectangle | null>(null);
  const isHandling = useRef(false); // synchronous guard against multiple fires

  const handleBarcodeScanned = ({ data, bounds }: { data: string; bounds: { origin: { x: number; y: number }; size: { width: number; height: number } } }) => {
    if (scanned || isHandling.current) return;

    // Only accept scans whose center falls within the finder box
    if (finderLayout.current) {
      const { x, y, width, height } = finderLayout.current;
      const centerX = bounds.origin.x + bounds.size.width / 2;
      const centerY = bounds.origin.y + bounds.size.height / 2;
      if (
        centerX < x ||
        centerX > x + width ||
        centerY < y ||
        centerY > y + height
      ) {
        return; // QR code is outside the finder — ignore
      }
    }

    isHandling.current = true;
    setScanned(true);

    const match = data.match(/lunabotid:\s*(.+)/i);
    const robotId = match ? match[1].trim() : data;

    Alert.alert(
      'Connect Robot',
      `Do you want to connect robot?\n\nID: ${robotId}`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            isHandling.current = false;
            setScanned(false);
          },
        },
        {
          text: 'Approve',
          style: 'destructive',
          onPress: () => {
            // TODO: save robot to Supabase
            router.back();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarcodeScanned}
      />

      <View style={[styles.overlay, { paddingTop: insets.top + 20 }]}>
        <Text style={styles.title}>Scan Robot QR Code</Text>
      </View>

      <View style={styles.finderWrapper}>
        <View
          style={styles.finder}
          onLayout={(e) => { finderLayout.current = e.nativeEvent.layout; }}
        >
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
        </View>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.button}>
          <Text style={styles.buttonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

