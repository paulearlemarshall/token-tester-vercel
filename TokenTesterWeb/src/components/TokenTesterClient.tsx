'use client'

import dynamic from 'next/dynamic'

export const TokenTesterClient = dynamic(
  () => import('./TokenTesterApp').then(mod => mod.TokenTesterApp),
  { ssr: false }
)
