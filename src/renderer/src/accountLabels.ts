import { useMemo } from 'react'
import type { Account } from '@shared/types'
import { useStore } from './store'

/**
 * A short name for each account on an app where you have more than one (two Instagram accounts, say), so a chat
 * shows which one it is on: the @handle where the app has one, the name otherwise (a Facebook handle is a long
 * fb.com/… link). Apps with a single account get none; there is nothing to tell apart.
 */
export function accountLabels(accounts: Account[]): Record<string, string> {
  const real = accounts.filter((a) => !a.demo)
  const labels: Record<string, string> = {}
  for (const account of real) {
    if (real.filter((a) => a.platform === account.platform).length < 2) continue
    labels[account.id] = account.handle?.startsWith('@') ? account.handle : account.displayName
  }
  return labels
}

export function useAccountLabels(): Record<string, string> {
  const accounts = useStore((s) => s.accounts)
  return useMemo(() => accountLabels(Object.values(accounts)), [accounts])
}
