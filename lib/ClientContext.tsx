import { createContext, useContext, useState } from 'react'

type ClientData = {
  clientId: string
  trainerId: string
  userId: string
}

type ClientCtx = {
  clientData: ClientData | null
  setClientData: (d: ClientData | null) => void
}

const ClientContext = createContext<ClientCtx>({
  clientData: null,
  setClientData: () => {},
})

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const [clientData, setClientData] = useState<ClientData | null>(null)
  return (
    <ClientContext.Provider value={{ clientData, setClientData }}>
      {children}
    </ClientContext.Provider>
  )
}

export const useClient = () => useContext(ClientContext)
