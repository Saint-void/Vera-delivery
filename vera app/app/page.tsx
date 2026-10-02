'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AddMissionDialog } from '@/components/dashboard/add-mission-dialog'
import { AircraftInspector } from '@/components/dashboard/aircraft-inspector'
import { DroneActionsDialog } from '@/components/dashboard/drone-actions-dialog'
import { DroneDetailsDialog } from '@/components/dashboard/drone-details-dialog'
import { Header } from '@/components/dashboard/header'
import { MapClient } from '@/components/dashboard/map-client'
import { MissionRail, type FilterTab } from '@/components/dashboard/tracking-list'
import { deduplicateDrones, deleteDrone, getFleetSnapshot, needsCharging, type FleetSnapshot, type VellaDrone, type VellaMission } from '@/lib/vella'

export default function Page() {
  const [drones, setDrones] = useState<VellaDrone[]>([])
  const [missions, setMissions] = useState<VellaMission[]>([])
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null)
  const [actionDroneId, setActionDroneId] = useState<string | null>(null)
  const [detailsDroneId, setDetailsDroneId] = useState<string | null>(null)
  const [missionPlannerOpen, setMissionPlannerOpen] = useState(false)
  const [missionDroneId, setMissionDroneId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Shared filter state — drives both the Header pills and the MissionRail tabs
  const [filterTab, setFilterTab] = useState<FilterTab>('all')

  // Selected drone — drives map highlight, rail highlight, and inspector panel
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null)

  // Map focus — set by the inspector's "Center on map" button
  const [focusCoords, setFocusCoords] = useState<[number, number] | null>(null)

  const applySnapshot = useCallback((snapshot: FleetSnapshot) => {
    const uniqueDrones = deduplicateDrones(snapshot.drones)
    setDrones(uniqueDrones)
    setMissions(snapshot.missions)
    const liveMissionIds = new Set(uniqueDrones.filter((drone) => drone.connected).map((drone) => drone.current_mission_id).filter(Boolean))
    const liveMissions = snapshot.missions.filter((mission) => liveMissionIds.has(mission.mission_id))
    setSelectedMissionId((current) => current && liveMissionIds.has(current) ? current : liveMissions[0]?.mission_id || null)
    setError(null)
    setLoading(false)
  }, [])

  const loadInitialSnapshot = useCallback(async () => {
    try {
      applySnapshot(await getFleetSnapshot())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Vella could not be reached.')
      setLoading(false)
    }
  }, [applySnapshot])

  useEffect(() => {
    let stream: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let isCancelled = false

    const RECONNECT_DELAY_MS = 1000 // Fast 1-second reconnection timeout

    function scheduleReconnect() {
      if (isCancelled || reconnectTimer) return
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, RECONNECT_DELAY_MS)
    }

    function connect() {
      if (isCancelled) return

      void loadInitialSnapshot().catch(() => {
        scheduleReconnect()
      })

      if (stream) {
        stream.close()
        stream = null
      }

      stream = new EventSource('/api/vella/fleet/stream')

      stream.addEventListener('fleet', (event: Event) => {
        try {
          applySnapshot(JSON.parse((event as MessageEvent<string>).data) as FleetSnapshot)
        } catch {
          setError('Vella sent an unreadable fleet update.')
        }
      })

      stream.onerror = () => {
        setError('Live Vella stream interrupted. Reconnecting…')
        if (stream) {
          stream.close()
          stream = null
        }
        scheduleReconnect()
      }
    }

    connect()

    return () => {
      isCancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (stream) stream.close()
    }
  }, [applySnapshot, loadInitialSnapshot])

  const liveDrones = useMemo(() => drones.filter((drone) => drone.connected), [drones])
  const liveMissionIds = useMemo(() => new Set(liveDrones.map((drone) => drone.current_mission_id).filter(Boolean)), [liveDrones])
  const liveMissions = useMemo(() => missions.filter((mission) => liveMissionIds.has(mission.mission_id)), [liveMissionIds, missions])
  const selectedMission = useMemo(() => liveMissions.find((mission) => mission.mission_id === selectedMissionId) || null, [liveMissions, selectedMissionId])
  const actionDrone = useMemo(() => drones.find((drone) => drone.drone_id === actionDroneId) || null, [drones, actionDroneId])
  const detailsDrone = useMemo(() => drones.find((drone) => drone.drone_id === detailsDroneId) || null, [drones, detailsDroneId])
  const detailsDroneMission = useMemo(() => detailsDrone?.current_mission_id ? missions.find((mission) => mission.mission_id === detailsDrone.current_mission_id) || null : null, [missions, detailsDrone])
  const missionReadyDrones = useMemo(() => liveDrones.filter((drone) => drone.status === 'available' && !needsCharging(drone)), [liveDrones])
  const chargingDrones = useMemo(() => drones.filter(needsCharging).length, [drones])

  // Inspector-selected drone and its active mission (can inspect offline aircraft too)
  const selectedDrone = useMemo(() => drones.find((drone) => drone.drone_id === selectedDroneId) || null, [drones, selectedDroneId])
  const selectedDroneMission = useMemo(() => selectedDrone?.current_mission_id ? missions.find((mission) => mission.mission_id === selectedDrone.current_mission_id) || null : null, [missions, selectedDrone])

  function handleMissionCreated(mission: VellaMission) {
    setMissions((current) => current.some((item) => item.mission_id === mission.mission_id) ? current.map((item) => item.mission_id === mission.mission_id ? mission : item) : [mission, ...current])
    setSelectedMissionId(mission.mission_id)
  }

  function openMissionPlanner(droneId: string | null = null) {
    setMissionDroneId(droneId)
    setMissionPlannerOpen(true)
  }

  // When a drone is selected (from rail or map marker), open the inspector and
  // sync the mission selection so the mission path renders on the map.
  function handleSelectDrone(droneId: string) {
    setSelectedDroneId(droneId)
    setFocusCoords(null)
    const drone = drones.find((d) => d.drone_id === droneId)
    if (drone?.current_mission_id) {
      setSelectedMissionId(drone.current_mission_id)
    }
  }

  function handleCloseInspector() {
    setSelectedDroneId(null)
    setFocusCoords(null)
  }

  async function handleDeleteDrone(droneId: string) {
    try {
      await deleteDrone(droneId)
      setDrones((current) => current.filter((d) => d.drone_id !== droneId))
      if (selectedDroneId === droneId) {
        setSelectedDroneId(null)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Failed to remove drone ${droneId}`)
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <div className="flex h-full flex-col overflow-hidden">
        <Header
          connected={!error && !loading}
          totalDrones={drones.length}
          activeMissions={liveMissions.length}
          chargingDrones={chargingDrones}
          onRefresh={() => void loadInitialSnapshot()}
          onOpenMissionPlanner={() => openMissionPlanner()}
          activeFilter={filterTab}
          onSelectFilter={(f) => setFilterTab(f as FilterTab)}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <MissionRail
            missions={liveMissions}
            drones={drones}
            selectedDroneId={selectedDroneId}
            selectedMissionId={selectedMissionId}
            loading={loading}
            error={error}
            filterTab={filterTab}
            onSelectFilterTab={setFilterTab}
            onSelectDrone={handleSelectDrone}
            onSelectMission={setSelectedMissionId}
            onOpenMissionPlanner={() => openMissionPlanner()}
          />

          {/* Map area with inspector as an absolute overlay on the right */}
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <MapClient
              drones={drones}
              selectedDroneId={selectedDroneId}
              selectedMission={selectedMission}
              focusCoords={focusCoords}
              onSelectDrone={handleSelectDrone}
            />
            <AircraftInspector
              drone={selectedDrone}
              mission={selectedDroneMission}
              onClose={handleCloseInspector}
              onAssignMission={(droneId) => openMissionPlanner(droneId)}
              onFocusOnMap={setFocusCoords}
              onDeleteDrone={handleDeleteDrone}
            />
          </div>
        </div>
      </div>

      <DroneActionsDialog
        drone={actionDrone}
        onClose={() => setActionDroneId(null)}
        onViewDrone={() => {
          setDetailsDroneId(actionDrone?.drone_id || null)
          setActionDroneId(null)
        }}
        onAssignMission={() => {
          openMissionPlanner(actionDrone?.drone_id || null)
          setActionDroneId(null)
        }}
      />
      <DroneDetailsDialog
        drone={detailsDrone}
        mission={detailsDroneMission}
        onClose={() => setDetailsDroneId(null)}
      />
      <AddMissionDialog
        open={missionPlannerOpen}
        initialDroneId={missionDroneId}
        availableDrones={missionReadyDrones}
        onClose={() => {
          setMissionPlannerOpen(false)
          setMissionDroneId(null)
        }}
        onCreated={handleMissionCreated}
      />
    </main>
  )
}
