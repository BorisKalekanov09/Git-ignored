import { Ionicons } from '@expo/vector-icons'
import MaskedView from '@react-native-masked-view/masked-view'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import { useRouter } from 'expo-router'
import React from 'react'
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { easeGradient } from 'react-native-easing-gradient'

interface BlurHeaderProps {
  title: string
  paddingTop?: number
  showBackButton?: boolean
  onBackPress?: () => void
}

export default function BlurHeader({ title, paddingTop = 80, showBackButton = false, onBackPress }: BlurHeaderProps) {
  const router = useRouter()
  const { colors, locations } = easeGradient({
    colorStops: {
      1: { color: 'transparent' },
      0: { color: 'rgba(0,0,0,0.99)' },
      0.5: { color: 'black' },
    },
  })

  const handleBackPress = () => {
    if (onBackPress) {
      onBackPress()
    } else {
      router.back()
    }
  }

  return (
    <>
      <View style={[styles.headerBackground]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={colors}
              locations={locations}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <LinearGradient
            colors={['black', 'rgba(0,0,0,0.6)']}
            style={StyleSheet.absoluteFill}
          />
          {Platform.OS === 'ios' ? (
            <BlurView
              intensity={10}
              tint="systemChromeMaterialDark"
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)' }]} />
          )}
        </MaskedView>
      </View>

      <View style={[styles.fixedHeader, { paddingTop }]}>
        {showBackButton && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBackPress}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={28} color="#ffffff" />
          </TouchableOpacity>
        )}
        <View style={styles.fixedHeaderContent}>
          <Text style={styles.headerTitle}>{title}</Text>
        </View>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  headerBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 130,
    zIndex: 10,
  },
  fixedHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 100,
    paddingTop: 80,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 11,
    overflow: 'hidden',
  },
  fixedHeaderContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
  },
  backButton: {
    position: 'absolute',
    left: 16,
    bottom: 8,
    zIndex: 12,
    padding: 4,
  },
})