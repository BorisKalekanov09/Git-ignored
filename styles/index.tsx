import BlurHeader from '@/components/BlurHeader'
import ContractsAccordion from '@/components/accordions/ContractsAccordion'
import LoadoutAccordion from '@/components/accordions/LoadoutAccordion'
import PartyAccordion from '@/components/accordions/PartyAccordion'
import ShopAccordion from '@/components/accordions/ShopAccordion'
import { useAuth } from '@/contexts/AuthContext'
import { getContracts, getMissionDefinitions, getParty, getPlayerLoadout, getStorefront, getWallet } from '@/lib/riot/valorant-api'
import { Image } from 'expo-image'
import * as SecureStore from 'expo-secure-store'
import React, { useEffect, useState } from 'react'
import { ScrollView, Text, TouchableOpacity, View } from 'react-native'
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import Svg, { Circle } from 'react-native-svg'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)

function CircularProgress({ progress }: { progress: Animated.SharedValue<number> }) {
  const radius = 11
  const circumference = 2 * Math.PI * radius

  const animatedProps = useAnimatedProps(() => {
    const strokeDashoffset = circumference - (progress.value * circumference)
    return {
      strokeDashoffset,
    }
  })

  return (
    <Animated.View
      style={{
        width: 26,
        height: 26,
        transform: [{ rotate: '-90deg' }],
      }}
    >
      <Svg width="26" height="26" viewBox="0 0 26 26">
        {/* Background circle */}
        <Circle
          cx="13"
          cy="13"
          r={radius}
          stroke="#3A3A3C"
          strokeWidth="4.5"
          fill="none"
        />
        {/* Progress circle */}
        <AnimatedCircle
          cx="13"
          cy="13"
          r={radius}
          stroke="#1444BD"
          strokeWidth="4.5"
          fill="none"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  )
}

const menuItems = [
  { id: 'party', title: 'Party', icon: 'people' as const },
  { id: 'contracts', title: 'Contracts', icon: 'document-text' as const },
  { id: 'loadout', title: 'Loadout', icon: 'shirt' as const },
  { id: 'shop', title: 'Shop', icon: 'basket' as const },
]

export default function LiveScreen() {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [partyData, setPartyData] = useState<any>(null)
  const [contractsData, setContractsData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [contractsLoading, setContractsLoading] = useState(false)
  const [loadoutData, setLoadoutData] = useState<any>(null)
  const [loadoutLoading, setLoadoutLoading] = useState(false)
  const [shopData, setShopData] = useState<any>(null)
  const [shopLoading, setShopLoading] = useState(false)
  const [walletData, setWalletData] = useState<any>(null)
  const [missionDefinitions, setMissionDefinitions] = useState<Map<string, any>>(new Map())
  const [playerTitles, setPlayerTitles] = useState<Map<string, string>>(new Map())
  const { userId, region } = useAuth()

  const fetchPartyData = React.useCallback(async (showLoading: boolean = true) => {
    try {
      if (showLoading) {
        setLoading(true)
      }
      const accessToken = await SecureStore.getItemAsync('riot_token')
      const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')

      if (!accessToken || !entitlementsToken || !userId || !region) return

      // Get party data directly from party endpoint
      const party = await getParty(accessToken, entitlementsToken, region, userId)
      console.log('Party data:', JSON.stringify(party, null, 2))
      
      setPartyData(party)
    } catch (error) {
      console.error('Error fetching party data:', error)
    } finally {
      if (showLoading) {
        setLoading(false)
      }
    }
  }, [userId, region])

  const fetchContractsData = React.useCallback(async () => {
    try {
      setContractsLoading(true)
      const accessToken = await SecureStore.getItemAsync('riot_token')
      const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')

      if (!accessToken || !entitlementsToken || !userId || !region) return

      const contracts = await getContracts(accessToken, entitlementsToken, region, userId)
      console.log('Contracts data:', JSON.stringify(contracts, null, 2))
      setContractsData(contracts)
    } catch (error) {
      console.error('Error fetching contracts:', error)
      setContractsData(null)
    } finally {
      setContractsLoading(false)
    }
  }, [userId, region])

  const fetchLoadoutData = React.useCallback(async () => {
    try {
      setLoadoutLoading(true)
      const accessToken = await SecureStore.getItemAsync('riot_token')
      const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')

      if (!accessToken || !entitlementsToken || !userId || !region) return

      const loadout = await getPlayerLoadout(accessToken, entitlementsToken, region, userId)
      console.log('Loadout data:', JSON.stringify(loadout, null, 2))
      setLoadoutData(loadout)
    } catch (error) {
      console.error('Error fetching loadout:', error)
      setLoadoutData(null)
    } finally {
      setLoadoutLoading(false)
    }
  }, [userId, region])

  const fetchShopData = React.useCallback(async () => {
    try {
      setShopLoading(true)
      const accessToken = await SecureStore.getItemAsync('riot_token')
      const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')

      if (!accessToken || !entitlementsToken || !userId || !region) return

      const [storefront, wallet] = await Promise.all([
        getStorefront(accessToken, entitlementsToken, region, userId),
        getWallet(accessToken, entitlementsToken, region, userId)
      ])

      console.log('Shop data:', JSON.stringify(storefront, null, 2))
      console.log('Wallet data:', JSON.stringify(wallet, null, 2))
      setShopData(storefront)
      setWalletData(wallet)
    } catch (error) {
      console.error('Error fetching shop:', error)
      setShopData(null)
      setWalletData(null)
    } finally {
      setShopLoading(false)
    }
  }, [userId, region])

  // Fetch mission definitions once on mount
  useEffect(() => {
    const loadMissionDefinitions = async () => {
      const definitions = await getMissionDefinitions()
      const map = new Map()
      definitions.forEach((mission: any) => {
        map.set(mission.uuid, {
          title: mission.title,
          xpGrant: mission.xpGrant,
          objectives: mission.objectives,
          progressToComplete: mission.progressToComplete
        })
      })
      setMissionDefinitions(map)
    }
    loadMissionDefinitions()
  }, [])

  // Fetch player titles once on mount
  useEffect(() => {
    const loadPlayerTitles = async () => {
      try {
        const response = await fetch('https://valorant-api.com/v1/playertitles')
        const data = await response.json()
        const map = new Map()
        data.data.forEach((title: any) => {
          map.set(title.uuid, title.titleText || title.displayName)
        })
        setPlayerTitles(map)
      } catch (error) {
        console.error('Error fetching player titles:', error)
      }
    }
    loadPlayerTitles()
  }, [])

  useEffect(() => {
    if (userId && region) {
      fetchPartyData()
      fetchContractsData()
      fetchLoadoutData()
      fetchShopData()
    }
  }, [userId, region, fetchPartyData, fetchContractsData, fetchLoadoutData, fetchShopData])

  // Auto-expand party accordion when party data is available
  useEffect(() => {
    if (partyData && !expandedItems.has('party')) {
      setExpandedItems(prev => {
        const newSet = new Set(prev)
        newSet.add('party')
        return newSet
      })
    }
  }, [partyData])

  const toggleItem = (itemId: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return newSet
    })
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <BlurHeader title="Live" />

      <ScrollView 
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 120, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Menu Items */}
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          {menuItems.map((item) => {
            const isExpanded = expandedItems.has(item.id)
            
            return (
              <AccordionItem 
                key={item.id} 
                item={item} 
                isExpanded={isExpanded} 
                onToggle={() => toggleItem(item.id)}
                partyData={item.id === 'party' ? partyData : undefined}
                loading={item.id === 'party' ? loading : false}
                fetchPartyData={item.id === 'party' ? fetchPartyData : undefined}
                contractsData={item.id === 'contracts' ? contractsData : undefined}
                contractsLoading={item.id === 'contracts' ? contractsLoading : false}
                fetchContractsData={item.id === 'contracts' ? fetchContractsData : undefined}
                loadoutData={item.id === 'loadout' ? loadoutData : undefined}
                loadoutLoading={item.id === 'loadout' ? loadoutLoading : false}
                fetchLoadoutData={item.id === 'loadout' ? fetchLoadoutData : undefined}
                shopData={item.id === 'shop' ? shopData : undefined}
                shopLoading={item.id === 'shop' ? shopLoading : false}
                fetchShopData={item.id === 'shop' ? fetchShopData : undefined}
                walletData={item.id === 'shop' ? walletData : undefined}
                missionDefinitions={missionDefinitions}
                playerTitles={playerTitles}
              />
            )
          })}
        </View>
      </ScrollView>
    </View>
  )
}

function AccordionItem({ 
  item, 
  isExpanded, 
  onToggle,
  partyData,
  loading,
  fetchPartyData,
  contractsData,
  contractsLoading,
  fetchContractsData,
  loadoutData,
  loadoutLoading,
  fetchLoadoutData,
  shopData,
  shopLoading,
  fetchShopData,
  walletData,
  missionDefinitions,
  playerTitles
}: { 
  item: typeof menuItems[0]
  isExpanded: boolean
  onToggle: () => void
  partyData?: any
  loading?: boolean
  fetchPartyData?: (showLoading?: boolean) => void
  contractsData?: any
  contractsLoading?: boolean
  fetchContractsData?: () => void
  loadoutData?: any
  loadoutLoading?: boolean
  fetchLoadoutData?: () => void
  shopData?: any
  shopLoading?: boolean
  fetchShopData?: () => void
  walletData?: any
  missionDefinitions?: Map<string, any>
  playerTitles?: Map<string, string>
}) {
  const [contentHeight, setContentHeight] = useState(0)
  const progress = useSharedValue(0)

  // Circular progress animation for party refresh (5 seconds)
  React.useEffect(() => {
    if (item.id === 'party' && isExpanded) {
      progress.value = 0
      progress.value = withRepeat(
        withTiming(1, {
          duration: 4000,
          easing: Easing.linear,
        }),
        -1,
        false
      )
    } else {
      progress.value = 0
    }
  }, [item.id, isExpanded])

  const arrowStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { 
          rotate: withTiming(isExpanded ? '90deg' : '0deg', {
            duration: 300,
          })
        }
      ]
    }
  })

  const contentStyle = useAnimatedStyle(() => {
    return {
      height: withTiming(isExpanded ? contentHeight : 0, {
        duration: 300,
      }),
      opacity: withTiming(isExpanded ? 1 : 0, {
        duration: 300,
      }),
    }
  })

  const refreshButtonStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { 
          scale: withTiming(isExpanded ? 1 : 0, {
            duration: 350,
            easing: Easing.bezier(0.25, 0.1, 0.25, 1),
          })
        }
      ],
      opacity: withTiming(isExpanded ? 1 : 0, {
        duration: 500,
      })
    }
  })

  const renderContent = () => {
    if (item.id === 'party') {
      return <PartyAccordion partyData={partyData} loading={loading || false} onRefresh={fetchPartyData} />
    }

    if (item.id === 'contracts') {
      return (
        <ContractsAccordion 
          contractsData={contractsData} 
          contractsLoading={contractsLoading || false}
          missionDefinitions={missionDefinitions || new Map()}
        />
      )
    }

    if (item.id === 'loadout') {
      return (
        <LoadoutAccordion 
          loadoutData={loadoutData} 
          loadoutLoading={loadoutLoading || false}
          playerTitles={playerTitles || new Map()}
        />
      )
    }

    if (item.id === 'shop') {
      return (
        <ShopAccordion 
          shopData={shopData} 
          shopLoading={shopLoading || false}
          walletData={walletData}
        />
      )
    }

    return (
      <Text style={{ color: '#8E8E93', fontSize: 15 }}>
        {item.title} content coming soon...
      </Text>
    )
  }

  return (
    <View style={{ backgroundColor: '#141414', borderRadius: 25, overflow: 'hidden' }}>
      {/* Header */}
      <View
        style={{
          paddingVertical: 17,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <TouchableOpacity
          onPress={onToggle}
          activeOpacity={0.6}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Animated.View style={arrowStyle}>
            <Image 
              source={require('@/assets/icons/arrow.svg')}
              style={{
                width: 20,
                height: 20,
                tintColor: '#1444BD',
              }}
              contentFit="contain"
            />
          </Animated.View>
        </TouchableOpacity>
        <Text style={{ 
          color: 'white', 
          fontSize: 22, 
          fontWeight: '700',
          marginLeft: 12,
          flex: 1
        }}>
          {item.title}
        </Text>
        {item.id === 'party' && (
          <Animated.View style={refreshButtonStyle}>
            <TouchableOpacity
              onPress={() => {
                if (fetchPartyData) {
                  fetchPartyData(true) // Manual refresh with loading
                }
              }}
              activeOpacity={0.6}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <CircularProgress progress={progress} />
            </TouchableOpacity>
          </Animated.View>
        )}
        {item.id === 'contracts' && (
          <Animated.View style={refreshButtonStyle}>
            <TouchableOpacity
              onPress={() => {
                if (fetchContractsData) {
                  fetchContractsData()
                }
              }}
              activeOpacity={0.6}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Image 
                source={require('@/assets/icons/refresh.svg')}
                style={{
                  width: 26,
                  height: 26,
                  tintColor: '#1444BD',
                }}
                contentFit="contain"
              />
            </TouchableOpacity>
          </Animated.View>
        )}
        {item.id === 'loadout' && (
          <Animated.View style={refreshButtonStyle}>
            <TouchableOpacity
              onPress={() => {
                if (fetchLoadoutData) {
                  fetchLoadoutData()
                }
              }}
              activeOpacity={0.6}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Image 
                source={require('@/assets/icons/refresh.svg')}
                style={{
                  width: 26,
                  height: 26,
                  tintColor: '#1444BD',
                }}
                contentFit="contain"
              />
            </TouchableOpacity>
          </Animated.View>
        )}
        {item.id === 'shop' && (
          <Animated.View style={refreshButtonStyle}>
            <TouchableOpacity
              onPress={() => {
                if (fetchShopData) {
                  fetchShopData()
                }
              }}
              activeOpacity={0.6}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Image 
                source={require('@/assets/icons/refresh.svg')}
                style={{
                  width: 26,
                  height: 26,
                  tintColor: '#1444BD',
                }}
                contentFit="contain"
              />
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>

      {/* Hidden measuring container */}
      <View 
        style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
        onLayout={(event) => {
          setContentHeight(event.nativeEvent.layout.height)
        }}
      >
        <View style={{ paddingHorizontal: 16 }}>
          <View style={{ 
            height: 0.4,
            backgroundColor: '#3A3A3D',
            marginHorizontal: 4,
          }} />
        </View>
        <View style={{ 
          padding: 20,
        }}>
          {renderContent()}
        </View>
      </View>

      {/* Expanded Content */}
      <Animated.View style={[contentStyle, { overflow: 'hidden' }]}>
        <View style={{ paddingHorizontal: 16 }}>
          <View style={{ 
            height: 0.4,
            backgroundColor: '#3A3A3D',
            marginHorizontal: 4,
          }} />
        </View>
        <View style={{ 
          padding: 20,
        }}>
          {renderContent()}
        </View>
      </Animated.View>
    </View>
  )
}