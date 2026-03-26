import PartySettingsSheet from '@/components/PartySettingsSheet'
import { useAuth } from '@/contexts/AuthContext'
import {
  changeQueue,
  disablePartyCode,
  enterMatchmakingQueue,
  getPlayerCardUrl,
  getRankIconUrl,
  joinPartyByCode,
  leaveMatchmakingQueue,
  leaveParty,
  makePartyAccessible,
  setPartyAccessibility,
  setPlayerReady
} from '@/lib/riot/valorant-api'
import { Ionicons } from '@expo/vector-icons'
import { BottomSheetModal } from '@gorhom/bottom-sheet'
import axios from 'axios'
import { Image } from 'expo-image'
import * as SecureStore from 'expo-secure-store'
import React, { useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native'

interface PartyAccordionProps {
  partyData: any
  loading: boolean
  onRefresh?: (showLoading?: boolean) => void
}

export default function PartyAccordion({ partyData, loading, onRefresh }: PartyAccordionProps) {
  const { userId, region } = useAuth()
  const partySettingsRef = useRef<BottomSheetModal>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [readyLoading, setReadyLoading] = useState(false)
  const [lockLoading, setLockLoading] = useState(false)
  const [queueTimer, setQueueTimer] = useState(0)
  const [playerNames, setPlayerNames] = useState<Map<string, { name: string; tag: string }>>(new Map())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const rotationRef = useRef(0)

  // Fetch player names
  React.useEffect(() => {
    const fetchPlayerNames = async () => {
      if (!partyData?.Members || !region) return

      try {
        const accessToken = await SecureStore.getItemAsync('riot_token')
        const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')

        if (!accessToken || !entitlementsToken) return

        const playerIds = partyData.Members.map((m: any) => m.Subject)
        
        const response = await axios.request<any>({
          url: `https://pd.${region}.a.pvp.net/name-service/v2/players`,
          method: 'PUT',
          headers: {
            'X-Riot-ClientVersion': 'release-11.10-shipping-12-4002057',
            'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'X-Riot-Entitlements-JWT': entitlementsToken,
          },
          data: playerIds,
        })

        const namesMap = new Map()
        response.data.forEach((player: any) => {
          namesMap.set(player.Subject, {
            name: player.GameName || 'Player',
            tag: player.TagLine || '0000',
          })
        })
        setPlayerNames(namesMap)
      } catch (error) {
        console.error('Error fetching player names:', error)
      }
    }

    fetchPlayerNames()
  }, [partyData?.Members, region])

  // Queue timer effect
  React.useEffect(() => {
    const inQueue = partyData?.State === 'MATCHMAKING'
    let interval: NodeJS.Timeout
    if (inQueue) {
      interval = setInterval(() => {
        setQueueTimer(prev => prev + 1)
      }, 1000)
    } else {
      setQueueTimer(0)
    }
    return () => clearInterval(interval)
  }, [partyData?.State])

  // Auto-refresh party data every 4 seconds (background refresh without loading)
  React.useEffect(() => {
    const refreshInterval = setInterval(() => {
      if (onRefresh) {
        setIsRefreshing(true)
        onRefresh(false) // Pass false to prevent loading state
        setTimeout(() => setIsRefreshing(false), 500)
      }
    }, 4000)

    return () => clearInterval(refreshInterval)
  }, [onRefresh])

  if (loading) {
    return (
      <View style={{ 
        backgroundColor: '#1C1C1E',
        borderRadius: 20,
        padding: 20,
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <ActivityIndicator color="#1444BD" />
      </View>
    )
  }

  if (!partyData) {
    return (
      <View style={{ 
        backgroundColor: '#1C1C1E',
        borderRadius: 20,
        padding: 16,
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Text style={{ color: '#8E8E93', fontSize: 17 }}>
          There is currently no party!
        </Text>
      </View>
    )
  }

  const partyId = partyData.ID
  const members = partyData.Members || []
  const isOwner = members.find((m: any) => m.Subject === userId)?.IsOwner || false
  const accessibility = partyData.Accessibility || 'OPEN'
  const isLocked = accessibility === 'CLOSED'
  const queueId = partyData.MatchmakingData?.QueueID || ''
  const inQueue = partyData.State === 'MATCHMAKING'
  const preferredPods = partyData.MatchmakingData?.PreferredGamePods || []
  
  // Get available servers from the first member's pings
  const availableServers = members[0]?.Pings || []
  
  // Get party code if available
  const partyCode = partyData.InviteCode || null

  const handleToggleReady = async (currentReadyState: boolean) => {
    try {
      setReadyLoading(true)
      const accessToken = await SecureStore.getItemAsync('riot_token')
      const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')

      if (!accessToken || !entitlementsToken || !region || !userId) return

      await setPlayerReady(
        accessToken,
        entitlementsToken,
        region,
        partyId,
        userId,
        !currentReadyState
      )

      onRefresh?.(false)
    } catch (error) {
      Alert.alert('Error', 'Failed to toggle ready state')
    } finally {
      setReadyLoading(false)
    }
  }

  const handleToggleLock = async () => {
    try {
      setLockLoading(true)
      const accessToken = await SecureStore.getItemAsync('riot_token')
      const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')

      if (!accessToken || !entitlementsToken || !region) return

      await setPartyAccessibility(
        accessToken,
        entitlementsToken,
        region,
        partyId,
        isLocked ? 'OPEN' : 'CLOSED'
      )

      onRefresh?.(false)
    } catch (error) {
      Alert.alert('Error', 'Failed to toggle party lock')
    } finally {
      setLockLoading(false)
    }
  }

  const handleQueueSelect = async (queueName: string) => {
    try {
      const accessToken = await SecureStore.getItemAsync('riot_token')
      const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')

      if (!accessToken || !entitlementsToken || !region) return

      // Map queue names to queue IDs
      const queueMap: Record<string, string> = {
        'Unrated': 'unrated',
        'Competitive': 'competitive',
        'Swiftplay': 'swiftplay',
        'Spike Rush': 'spikerush',
        'Deathmatch': 'deathmatch',
        'Escalation': 'ggteam',
        'Team Deathmatch': 'hurm',
      }

      await changeQueue(
        accessToken,
        entitlementsToken,
        region,
        partyId,
        queueMap[queueName] || 'unrated'
      )

      onRefresh?.(false)
    } catch (error) {
      Alert.alert('Error', 'Failed to change queue')
    }
  }



  const handleGenerateCode = async () => {
    try {
      const accessToken = await SecureStore.getItemAsync('riot_token')
      const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')
      
      if (!accessToken || !entitlementsToken || !region || !partyId) return

      await makePartyAccessible(accessToken, entitlementsToken, region, partyId)
      await onRefresh?.(false)
    } catch (error) {
      console.error('Error generating party code:', error)
      Alert.alert('Error', 'Failed to generate party code')
    }
  }

  const handleDisableCode = async () => {
    try {
      const accessToken = await SecureStore.getItemAsync('riot_token')
      const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')
      
      if (!accessToken || !entitlementsToken || !region || !partyId) return

      await disablePartyCode(accessToken, entitlementsToken, region, partyId)
      Alert.alert('Success', 'Party code disabled')
      await onRefresh?.(false)
    } catch (error) {
      console.error('Error disabling party code:', error)
      Alert.alert('Error', 'Failed to disable party code')
    }
  }

  const handleJoinPartyByCode = async (code: string) => {
    try {
      const accessToken = await SecureStore.getItemAsync('riot_token')
      const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')
      
      if (!accessToken || !entitlementsToken || !region || !userId) return

      // First, leave current party if in one
      if (partyId) {
        try {
          await axios.request({
            url: `https://glz-${region}-1.${region}.a.pvp.net/parties/v1/players/${userId}/leaveparty/${partyId}`,
            method: 'POST',
            headers: {
              'X-Riot-ClientVersion': 'release-11.10-shipping-12-4002057',
              'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
              'X-Riot-Entitlements-JWT': entitlementsToken,
            },
            data: {},
          })
        } catch (leaveError) {
          console.log('Could not leave party, continuing anyway')
        }
      }

      await joinPartyByCode(accessToken, entitlementsToken, region, userId, code)
      Alert.alert('Success', 'Joined party successfully')
      await onRefresh?.(false)
    } catch (error: any) {
      console.error('Error joining party by code:', error)
      const errorMessage = error.message || 
        (error.response?.data?.errorCode === 'PARTY_DOES_NOT_EXIST' 
          ? 'Party does not exist or code has expired'
          : error.response?.data?.message || 'Failed to join party. The party must be set to "Open" for the code to work.')
      Alert.alert('Error', errorMessage)
    }
  }

  const handleLeaveParty = async () => {
    try {
      setActionLoading(true)
      const accessToken = await SecureStore.getItemAsync('riot_token')
      const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')

      if (!accessToken || !entitlementsToken || !region || !userId) return

      await leaveParty(accessToken, entitlementsToken, region, partyId, userId)
      
      // Close the settings sheet
      partySettingsRef.current?.dismiss()
      
      // Refresh to show updated party state
      await onRefresh?.(false)
      
      Alert.alert('Left Party', 'You have left the party')
    } catch (error) {
      console.error('[PartyAccordion] Error leaving party:', error)
      Alert.alert('Error', 'Failed to leave party')
    } finally {
      setActionLoading(false)
    }
  }

  const handleToggleQueue = async () => {
    try {
      const accessToken = await SecureStore.getItemAsync('riot_token')
      const entitlementsToken = await SecureStore.getItemAsync('entitlements_token')

      if (!accessToken || !entitlementsToken || !region) return

      if (inQueue) {
        await leaveMatchmakingQueue(accessToken, entitlementsToken, region, partyId)
      } else {
        await enterMatchmakingQueue(accessToken, entitlementsToken, region, partyId)
      }

      onRefresh?.(false)
    } catch (error) {
      Alert.alert('Error', inQueue ? 'Failed to leave queue' : 'Failed to start queue')
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <View style={{ gap: 12 }}>
      {/* Party Members - Each in separate card */}
      {members.map((member: any) => {
        const isCurrentUser = member.Subject === userId
        const rankTier = member.SeasonalBadgeInfo?.Rank || 0
        return (
          <View
            key={member.Subject}
            style={{
              backgroundColor: '#1C1C1E',
              borderRadius: 20,
              padding: 18,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            {/* Player Card */}
            <View style={{ width: 45, height: 45, borderRadius: 8, overflow: 'hidden', backgroundColor: '#2C2C2E', marginRight: 12 }}>
              <Image
                source={{ uri: getPlayerCardUrl(member.PlayerIdentity?.PlayerCardID || '') }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
              />
            </View>

            {/* Player Info */}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: '400', color: '#FFFFFF' }}>
                  {playerNames.get(member.Subject)?.name || 'Player'}
                </Text>
                <Text style={{ fontSize: 18, color: '#8E8E93', fontWeight: '400' }}>
                  #{playerNames.get(member.Subject)?.tag || '0000'}
                </Text>
              </View>
              <Text style={{ fontSize: 17, color: '#8E8E93', marginTop: 2 }}>
                {member.IsReady ? 'Ready' : 'Not Ready'}
              </Text>
            </View>

            {/* Right Side Icons/Buttons */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {/* Rank Icon - show for other players only */}
              {!isCurrentUser && rankTier > 0 && (
                <Image
                  source={{ uri: getRankIconUrl(rankTier) }}
                  style={{ width: 34, height: 34 }}
                  contentFit="contain"
                />
              )}

              {/* Ready Toggle for current user */}
              {isCurrentUser && (
                <Pressable
                  onPress={() => handleToggleReady(member.IsReady)}
                  disabled={readyLoading}
                  style={{
                    width: 60,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: member.IsReady ? '#1444BD' : '#2C2C2E',
                    justifyContent: 'center',
                    alignItems: 'center',
                    paddingHorizontal: 4,
                  }}
                >
                  {readyLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <View style={{
                      width: 34,
                      height: 24,
                      borderRadius: 12,
                      backgroundColor: '#FFFFFF',
                      alignSelf: member.IsReady ? 'flex-end' : 'flex-start',
                    }} />
                  )}
                </Pressable>
              )}
            </View>
          </View>
        )
      })}

      {/* Divider */}
      <View style={{ height: 1, backgroundColor: '#2C2C2E' }} />

      {/* Party Controls Section - Three Separate Parts */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 52 }}>
        {/* Left: Lock/Unlock Component */}
        <View style={{
          backgroundColor: '#1C1C1E',
          borderRadius: 20,
          flexDirection: 'row',
          padding: 4,
          gap: 8,
        }}>
          <Pressable
            onPress={() => {
              if (isLocked) handleToggleLock()
            }}
            disabled={lockLoading || !isOwner}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: !isLocked ? '#141414' : 'transparent',
              borderRadius: 16,
            }}
          >
            <Ionicons name="lock-open-outline" size={18} color={!isLocked ? "#1444BD" : "#ffffff"} />
          </Pressable>
          <Pressable
            onPress={() => {
              if (!isLocked) handleToggleLock()
            }}
            disabled={lockLoading || !isOwner}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              backgroundColor: isLocked ? '#141414' : 'transparent',
              borderRadius: 16,
            }}
          >
            <Ionicons name="lock-closed-outline" size={18} color={isLocked ? "#1444BD" : "#ffffff"} />
          </Pressable>
        </View>

        {/* Center: Start Queue Button/Timer */}
        <Pressable
          onPress={handleToggleQueue}
          disabled={!isOwner}
          style={{
            flex: 1,
            backgroundColor: '#1C1C1E',
            borderRadius: 20,
            paddingVertical: 10,
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'row',
            gap: 8,
          }}
        >
          {inQueue ? (
            <>
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#1444BD' }}>
                {formatTime(queueTimer)}
              </Text>
              <Ionicons name="pause" size={18} color="#1444BD" />
            </>
          ) : (
            <Text style={{ fontSize: 18, fontWeight: '500', color: '#1444BD' }}>
              Start
            </Text>
          )}
        </Pressable>

        {/* Right: Settings Component */}
        <Pressable
          onPress={() => partySettingsRef.current?.present()}
          style={{
            backgroundColor: '#1C1C1E',
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Ionicons name="settings-sharp" size={20} color="#1444BD" />
        </Pressable>
      </View>

      {/* Party Settings Bottom Sheet */}
      <PartySettingsSheet
        ref={partySettingsRef}
        queueId={queueId}
        preferredPods={preferredPods}
        availableServers={availableServers}
        partyCode={partyCode}
        isOwner={isOwner}
        onQueueSelect={handleQueueSelect}
        onGenerateCode={handleGenerateCode}
        onDisableCode={handleDisableCode}
        onJoinPartyByCode={handleJoinPartyByCode}
        onLeaveParty={handleLeaveParty}
      />
    </View>
  )
}