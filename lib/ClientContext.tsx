import { createContext, useContext, useState } from 'react'

type ClientData = {
  clientId: string
  trainerId: string
  userId: string
}

export type CachedProfile = { full_name: string; email: string }

export type CachedCheckinConfig = {
  checkin_day: number | null
  photo_frequency: string | null
  photo_positions: string[] | null
}

export type CachedCheckinParam = {
  id: string
  name: string
  type: string
  unit: string | null
  options: string[] | null
  required: boolean
  order_index: number
  frequency: string
}

type ClientCtx = {
  clientData: ClientData | null
  setClientData: (d: ClientData | null) => void
  profile: CachedProfile | null
  setProfile: (p: CachedProfile | null) => void
  checkinConfig: CachedCheckinConfig | null
  setCheckinConfig: (c: CachedCheckinConfig | null) => void
  checkinParams: CachedCheckinParam[]
  setCheckinParams: (p: CachedCheckinParam[]) => void
  clientCreatedAt: string | null
  setClientCreatedAt: (d: string | null) => void
}

const ClientContext = createContext<ClientCtx>({
  clientData: null,
  setClientData: () => {},
  profile: null,
  setProfile: () => {},
  checkinConfig: null,
  setCheckinConfig: () => {},
  checkinParams: [],
  setCheckinParams: () => {},
  clientCreatedAt: null,
  setClientCreatedAt: () => {},
})

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const [clientData, setClientData] = useState<ClientData | null>(null)
  const [profile, setProfile] = useState<CachedProfile | null>(null)
  const [checkinConfig, setCheckinConfig] = useState<CachedCheckinConfig | null>(null)
  const [checkinParams, setCheckinParams] = useState<CachedCheckinParam[]>([])
  const [clientCreatedAt, setClientCreatedAt] = useState<string | null>(null)

  return (
    <ClientContext.Provider value={{
      clientData, setClientData,
      profile, setProfile,
      checkinConfig, setCheckinConfig,
      checkinParams, setCheckinParams,
      clientCreatedAt, setClientCreatedAt,
    }}>
      {children}
    </ClientContext.Provider>
  )
}

export const useClient = () => useContext(ClientContext)
