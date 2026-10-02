'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Layers,
  Plane,
  Plus,
  Radio,
  RotateCw,
  Zap,
} from 'lucide-react'

type HeaderProps = {
  connected: boolean
  totalDrones: number
  activeMissions: number
  chargingDrones: number
  onRefresh: () => void
  onOpenMissionPlanner: () => void
  activeFilter?: string
  onSelectFilter?: (filter: string) => void
}

export function Header({
  connected,
  totalDrones,
  activeMissions,
  chargingDrones,
  onRefresh,
  onOpenMissionPlanner,
  activeFilter = 'all',
  onSelectFilter,
}: HeaderProps) {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefreshClick = () => {
    setRefreshing(true)
    onRefresh()
    setTimeout(() => setRefreshing(false), 700)
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-header px-4 sm:px-6">
      {/* Brand & Airspace Title */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded border border-foreground/20 bg-foreground text-background">
            <Plane size={15} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold tracking-[0.18em] text-foreground">
                VERA
              </span>
              <span className="text-[10px] text-muted-foreground">/</span>
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Fleet Operations
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground/80">
              Autonomous Airspace Monitoring & Dispatch
            </p>
          </div>
        </div>
      </div>

      {/* Fleet Overview Metrics & Actionable Filters */}
      <div className="hidden items-center gap-1.5 md:flex">
        <button
          type="button"
          onClick={() => onSelectFilter?.('all')}
          className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-mono transition-colors ${
            activeFilter === 'all'
              ? 'border-foreground/60 bg-foreground/10 text-foreground'
              : 'border-border/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground'
          }`}
        >
          <Layers size={12} />
          <span>{totalDrones} Aircraft</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectFilter?.('active')}
          className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-mono transition-colors ${
            activeFilter === 'active'
              ? 'border-foreground/60 bg-foreground/10 text-foreground'
              : 'border-border/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground'
          }`}
        >
          <span className="size-1.5 rounded-full bg-foreground" />
          <span>{activeMissions} Active {activeMissions === 1 ? 'Mission' : 'Missions'}</span>
        </button>

        {chargingDrones > 0 && (
          <button
            type="button"
            onClick={() => onSelectFilter?.('charging')}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-[11px] font-mono transition-colors ${
              activeFilter === 'charging'
                ? 'border-critical bg-critical/20 text-foreground'
                : 'border-critical/60 bg-critical/10 text-foreground hover:bg-critical/20'
            }`}
          >
            <Zap size={12} className="text-critical" />
            <span>{chargingDrones} Low Battery</span>
          </button>
        )}
      </div>

      {/* Connection Signal & Global Mission Trigger */}
      <div className="flex items-center gap-3">
        {/* Real-time Connection Badge & Sync Button */}
        <div className="flex items-center rounded border border-border bg-panel text-[11px]">
          <div className="flex items-center gap-2 px-2.5 py-1 text-muted-foreground">
            <span className="relative flex size-2">
              {connected ? (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground opacity-40" />
                  <span className="relative inline-flex size-2 rounded-full bg-foreground" />
                </>
              ) : (
                <span className="relative inline-flex size-2 rounded-full bg-critical" />
              )}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-foreground">
              {connected ? 'Vella Live' : 'Vella Offline'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleRefreshClick}
            title="Sync fleet snapshot"
            aria-label="Refresh telemetry and missions"
            className="border-l border-border px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Global Plan Mission Button */}
        <button
          type="button"
          onClick={onOpenMissionPlanner}
          className="flex items-center gap-1.5 rounded border border-foreground bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/85"
        >
          <Plus size={14} />
          <span className="hidden sm:inline">Plan Mission</span>
          <span className="sm:hidden">Plan</span>
        </button>
      </div>
    </header>
  )
}
