import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SessionTimeoutOption = 0 | 15 | 60 | 240

interface SessionState {
  lastActive: number | null
  timeoutMinutes: SessionTimeoutOption
  setTimeoutMinutes: (minutes: SessionTimeoutOption) => void
  touch: () => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      lastActive: null,
      timeoutMinutes: 0,
      setTimeoutMinutes: (timeoutMinutes) => set({ timeoutMinutes }),
      touch: () => set({ lastActive: Date.now() }),
    }),
    {
      name: 'session',
      partialize: (state) => ({
        timeoutMinutes: state.timeoutMinutes,
      }),
    },
  ),
)

export function isSessionExpired(lastActive: number | null, timeoutMinutes: number): boolean {
  if (timeoutMinutes === 0 || lastActive === null) return false
  return Date.now() - lastActive > timeoutMinutes * 60 * 1000
}
