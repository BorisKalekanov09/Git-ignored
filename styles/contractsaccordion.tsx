import { Image } from 'expo-image'
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'

interface ContractsAccordionProps {
  contractsData: any
  contractsLoading: boolean
  missionDefinitions: Map<string, any>
}

// Helper functions to parse contracts data
const parseMissionsData = (contractsData: any) => {
  if (!contractsData?.Missions) return null

  const missions = contractsData.Missions.map((mission: any) => {
    const objectiveKey = Object.keys(mission.Objectives)[0]
    const progress = mission.Objectives[objectiveKey]
    return {
      id: mission.ID,
      complete: mission.Complete,
      progress: progress,
      expirationTime: mission.ExpirationTime
    }
  })

  const weeklyRefillTime = contractsData.MissionMetadata?.WeeklyRefillTime
  const dailyCheckpoint = contractsData.BTEMilestone || 0

  return {
    missions,
    weeklyRefillTime,
    dailyCheckpoint
  }
}

const parseBattlepassData = (contractsData: any) => {
  if (!contractsData?.Contracts) return null

  // Find the active battlepass contract (the one with progression)
  const battlepassContract = contractsData.Contracts.find(
    (c: any) => c.ProgressionLevelReached > 0 || c.ProgressionTowardsNextLevel > 0
  )

  if (!battlepassContract) return null

  return {
    level: battlepassContract.ProgressionLevelReached,
    xpTowardsNextLevel: battlepassContract.ProgressionTowardsNextLevel,
    totalXP: battlepassContract.ContractProgression.TotalProgressionEarned,
    contractId: battlepassContract.ContractDefinitionID
  }
}

const getTimeRemaining = (expirationTime: string, currentTime?: number) => {
  const now = currentTime || new Date().getTime()
  const expiration = new Date(expirationTime).getTime()
  const diff = expiration - now

  if (diff <= 0) return '0:00:00'

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((diff % (1000 * 60)) / 1000)

  if (days > 0) {
    return `${days}d ${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export default function ContractsAccordion({ contractsData, contractsLoading, missionDefinitions }: ContractsAccordionProps) {
  const [contractsTab, setContractsTab] = useState<'missions' | 'battlepass'>('missions')
  const [currentTime, setCurrentTime] = useState(Date.now())

  // Update timer every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  if (contractsLoading) {
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

  if (!contractsData) {
    return (
      <View style={{ 
        backgroundColor: '#1C1C1E',
        borderRadius: 20,
        padding: 20,
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Text style={{ color: '#8E8E93', fontSize: 15 }}>
          Unable to load contracts data
        </Text>
      </View>
    )
  }

  return (
    <View style={{ gap: 16 }}>
      {/* Tab Selector */}
      <View style={{
        backgroundColor: '#2C2C2E',
        borderRadius: 16,
        padding: 4,
        flexDirection: 'row',
      }}>
        <TouchableOpacity
          onPress={() => setContractsTab('missions')}
          style={{
            flex: 1,
            paddingVertical: 8,
            borderRadius: 12,
            backgroundColor: contractsTab === 'missions' ? '#3A3A3C' : 'transparent',
          }}
          activeOpacity={0.7}
        >
          <Text style={{
            color: 'white',
            fontSize: 15,
            fontWeight: '600',
            textAlign: 'center',
          }}>
            Missions
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setContractsTab('battlepass')}
          style={{
            flex: 1,
            paddingVertical: 8,
            borderRadius: 12,
            backgroundColor: contractsTab === 'battlepass' ? '#3A3A3C' : 'transparent',
          }}
          activeOpacity={0.7}
        >
          <Text style={{
            color: 'white',
            fontSize: 15,
            fontWeight: '600',
            textAlign: 'center',
          }}>
            Battlepass
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {contractsTab === 'missions' ? (() => {
        const missionsData = parseMissionsData(contractsData)
        if (!missionsData) return <Text style={{ color: '#8E8E93' }}>No missions data</Text>

        const { missions, weeklyRefillTime } = missionsData
        const dailyResetTime = new Date()
        dailyResetTime.setUTCHours(0, 0, 0, 0)
        dailyResetTime.setUTCDate(dailyResetTime.getUTCDate() + 1)

        return (
          <View style={{ gap: 8 }}>
            {/* Daily Checkpoints */}
            <View style={{
              backgroundColor: '#1C1C1E',
              borderRadius: 16,
              padding: 16,
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ color: 'white', fontSize: 17, fontWeight: '600' }}>Daily Checkpoints</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ color: '#8E8E93', fontSize: 17, marginRight:10, }}>{getTimeRemaining(dailyResetTime.toISOString(), currentTime)}</Text>
                  <Image 
                    source={require('@/assets/icons/timer.svg')}
                    style={{ width: 18, height: 18, tintColor: '#8E8E93'}}
                    contentFit="contain"
                  />
                </View>
              </View>
              
              <View style={{ height: 1, backgroundColor: '#2C2C2E', marginBottom: 8 }} />
              
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', }}>
                {[1, 2, 3, 4].map((checkpoint, index) => (
                  <React.Fragment key={checkpoint}>
                    <View style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: 'transparent',
                      justifyContent: 'center',
                      alignItems: 'center',
                      borderWidth: 4,
                      borderColor: '#3A3A3C',
                    }}>
                      <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>{checkpoint}</Text>
                    </View>
                    {index < 3 && (
                      <View style={{ flex: 1, height: 1, backgroundColor: '#707072', marginHorizontal: 4 }} />
                    )}
                  </React.Fragment>
                ))}
              </View>
            </View>

            {/* Weekly Missions */}
            <View style={{
              backgroundColor: '#1C1C1E',
              borderRadius: 16,
              padding: 16,
            }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ color: 'white', fontSize: 17, fontWeight: '600' }}>Weekly Missions</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ color: '#8E8E93', fontSize: 17, marginRight:10 }}>{getTimeRemaining(weeklyRefillTime, currentTime)}</Text>
                  <Image 
                    source={require('@/assets/icons/timer.svg')}
                    style={{ width: 18, height: 18, tintColor: '#8E8E93' }}
                    contentFit="contain"
                  />
                </View>
              </View>
              
              <View style={{ height: 1, backgroundColor: '#2C2C2E', marginBottom: 8 }} />

              {missions.map((mission: any, idx: number) => {
                // Fetch mission details from definitions
                const missionDef = missionDefinitions?.get(mission.id)
                
                // If no definition found, use fallback values
                const title = missionDef?.title || `Mission ${idx + 1}`
                const xp = missionDef?.xpGrant || 0
                const goal = missionDef?.objectives?.[0]?.value || 1
                const progress = mission.progress

                if (mission.complete) {
                  return (
                    <View key={mission.id} style={{ marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: '#8E8E93', fontSize: 15 }}>{title}</Text>
                        <View style={{
                          width: 18,
                          height: 18,
                          borderRadius: 9,
                          borderWidth: 2,
                          borderColor: '#1444BD',
                          backgroundColor: 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <Text style={{ color: '#1444BD', fontSize: 12, fontWeight: '700' }}>✓</Text>
                        </View>
                      </View>
                      <View style={{ height: 2, backgroundColor: '#1444BD', marginTop: 8 }} />
                    </View>
                  )
                }

                const progressPercent = (progress / goal) * 100

                return (
                  <View key={mission.id} style={{  }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={{ color: 'white', fontSize: 15 }}>{title}</Text>
                      <Text style={{ color: '#8E8E93', fontSize: 12, fontWeight:500 }}>+{xp.toLocaleString().replace(',', ' ')} XP</Text>
                    </View>
                    <View style={{ height: 4, backgroundColor: '#2C2C2E', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
                      <View style={{ height: '100%', width: `${progressPercent}%`, backgroundColor: '#1444BD', borderRadius: 2 }} />
                    </View>
                    <Text style={{ color: '#8E8E93', fontSize: 13 }}>{progress}/{goal}</Text>
                  </View>
                )
              })}
            </View>

            {/* Queued Weeklies - Calculate from incomplete missions that aren't currently shown */}
            {(() => {
              // In Valorant, typically 3 weekly missions are active at once
              // Queued missions are those that will become active when current ones complete
              // This is an estimate since Riot API doesn't expose this explicitly
              const activeMissions = missions.length
              const estimatedQueuedWeeklies = Math.max(0, 9 - activeMissions) // Typically 9 missions total per week cycle
              const avgWeeklyXP = 15840 // Average XP per weekly mission
              const estimatedQueuedXP = estimatedQueuedWeeklies * avgWeeklyXP
              
              if (estimatedQueuedWeeklies > 0) {
                return (
                  <TouchableOpacity style={{
                    backgroundColor: '#1C1C1E',
                    borderRadius: 16,
                    padding: 16,
                    paddingVertical: 20,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <Text style={{ color: 'white', fontSize: 15, fontWeight: '600' }}>
                      {estimatedQueuedWeeklies} Queued-Up {estimatedQueuedWeeklies === 1 ? 'Weekly' : 'Weeklies'}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: '#8E8E93', fontSize: 13 }}>
                        +{estimatedQueuedXP.toLocaleString().replace(',', ' ')} XP
                      </Text>
                      <Image 
                        source={require('@/assets/icons/arrow.svg')}
                        style={{ width: 12, height: 12, tintColor: 'white' }}
                        contentFit="contain"
                      />
                    </View>
                  </TouchableOpacity>
                )
              }
              return null
            })()}

            {/* Future Weeklies - Missions from upcoming weeks in the act */}
            {(() => {
              // Valorant acts typically have ~10 weeks, with 3 missions per week
              // This is an estimate of future missions not yet unlocked
              const weeksRemainingInAct = 8 // Estimate, could calculate from act end date if available
              const missionsPerWeek = 3
              const estimatedFutureWeeklies = weeksRemainingInAct * missionsPerWeek
              const avgWeeklyXP = 15840
              const estimatedFutureXP = estimatedFutureWeeklies * avgWeeklyXP
              
              if (estimatedFutureWeeklies > 0) {
                return (
                  <TouchableOpacity style={{
                    backgroundColor: '#1C1C1E',
                    borderRadius: 16,
                    padding: 16,
                    paddingVertical: 20,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <Text style={{ color: 'white', fontSize: 15, fontWeight: '600' }}>
                      {estimatedFutureWeeklies} Future {estimatedFutureWeeklies === 1 ? 'Weekly' : 'Weeklies'}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: '#8E8E93', fontSize: 13 }}>
                        +{estimatedFutureXP.toLocaleString().replace(',', ' ')} XP
                      </Text>
                      <Image 
                        source={require('@/assets/icons/arrow.svg')}
                        style={{ width: 12, height: 12, tintColor: 'white' }}
                        contentFit="contain"
                      />
                    </View>
                  </TouchableOpacity>
                )
              }
              return null
            })()}
          </View>
        )
      })() : (() => {
        const battlepassData = parseBattlepassData(contractsData)
        if (!battlepassData) return <Text style={{ color: '#8E8E93' }}>No battlepass data</Text>

        const { level, xpTowardsNextLevel, totalXP } = battlepassData
        const xpNeededForNextLevel = 11000 // Standard XP per level
        const progressPercent = (xpTowardsNextLevel / xpNeededForNextLevel) * 100
        const maxLevel = 55 // Standard battlepass max level

        // Calculate season end time (approximate)
        const seasonEndDate = new Date('2026-01-08T03:15:00Z')

        return (
          <View style={{ gap: 16 }}>
            {/* Battlepass Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: 'white', fontSize: 17, fontWeight: '600' }}>Battlepass</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: '#8E8E93', fontSize: 15 }}>{getTimeRemaining(seasonEndDate.toISOString(), currentTime)}</Text>
                <Text style={{ color: '#8E8E93', fontSize: 15 }}>⏱</Text>
              </View>
            </View>

            {/* Current Level Display */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 8,
            }}>
              <View style={{
                width: 60,
                height: 60,
                backgroundColor: '#2C2C2E',
                borderRadius: 12,
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <Text style={{ color: 'white', fontSize: 20, fontWeight: '700' }}>{level}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: 'white', fontSize: 17, fontWeight: '600' }}>Battlepass Level</Text>
                <Text style={{ color: '#8E8E93', fontSize: 15 }}>Level {level} / {maxLevel}</Text>
              </View>
            </View>

            {/* XP Progress */}
            <View>
              <View style={{ height: 6, backgroundColor: '#3A3A3C', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                <View style={{ height: '100%', width: `${progressPercent}%`, backgroundColor: '#FF453A' }} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: '#FF453A', fontSize: 13 }}>XP</Text>
                <Text style={{ color: '#8E8E93', fontSize: 13 }}>{xpTowardsNextLevel.toLocaleString()} / {xpNeededForNextLevel.toLocaleString()}</Text>
              </View>
            </View>

            {/* Total XP Display */}
            <View style={{
              backgroundColor: '#2C2C2E',
              borderRadius: 12,
              padding: 12,
            }}>
              <Text style={{ color: '#8E8E93', fontSize: 13 }}>Total XP Earned</Text>
              <Text style={{ color: 'white', fontSize: 17, fontWeight: '600', marginTop: 2 }}>{totalXP.toLocaleString()}</Text>
            </View>
          </View>
        )
      })()}
    </View>
  )
}