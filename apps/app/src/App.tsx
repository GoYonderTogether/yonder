import { useStore } from '@nanostores/react'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes, Link, useLocation } from 'react-router'
import { PageLoading } from './components/PageLoading'
import { $session } from './store'
import { Toaster } from './ui/Toast'

const Shell = lazy(() => import('./components/Shell').then((m) => ({ default: m.Shell })))
const AddFriend = lazy(() => import('./pages/AddFriend').then((m) => ({ default: m.AddFriend })))
const Contacts = lazy(() => import('./pages/Contacts').then((m) => ({ default: m.Contacts })))
const CardsRedirect = lazy(() => import('./pages/Contacts').then((m) => ({ default: m.CardsRedirect })))
const CardPage = lazy(() => import('./pages/CardPage').then((m) => ({ default: m.CardPage })))
const GroupJoin = lazy(() => import('./pages/GroupJoin').then((m) => ({ default: m.GroupJoin })))
const Conversation = lazy(() => import('./pages/Chat').then((m) => ({ default: m.Conversation })))
const ChatShell = lazy(() => import('./pages/Chat').then((m) => ({ default: m.ChatShell })))
const Connect = lazy(() => import('./pages/Connect').then((m) => ({ default: m.Connect })))
const Install = lazy(() => import('./pages/Install').then((m) => ({ default: m.Install })))
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })))
const WorkRoot = lazy(() => import('./work/WorkRoot'))
const Me = lazy(() => import('./pages/Me').then((m) => ({ default: m.Me })))

function Private({ children }: { children: ReactNode }) {
  const s = useStore($session)
  const loc = useLocation()
  if (s === undefined) return null
  return s && !(s.actor.anonymous && loc.pathname.startsWith('/cards')) ? children : <Navigate to="/login" state={{ next: loc.pathname + loc.search }} replace />
}

export function App() {
  const qc = useQueryClient()
  const session = useStore($session)
  useEffect(() => { if (session) qc.setQueryData(['session', session.actor.id], session) }, [session, qc])
  return (
    <>
    <Toaster />
    <Suspense fallback={<PageLoading />}><Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/u/:id" element={<CardPage />} />
      <Route path="/p/:accountId" element={<CardPage />} />
      <Route path="/g/:token" element={<GroupJoin />} />
      <Route path="/get" element={<Install />} />
      <Route element={<Private><Shell /></Private>}>
        <Route path="/cards/:id?" element={<CardsRedirect />} />
        <Route path="/cards/:id/edit" element={<CardsRedirect />} />
        <Route path="/friends/add" element={<AddFriend />} />
        <Route path="/contacts/:id?" element={<Contacts />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="/me" element={<Me />} />
        <Route path="/work/*" element={<WorkRoot />} />
        <Route element={<ChatShell />}>
          <Route path="/" element={null} />
          <Route path="/c/:id" element={<Conversation />} />
        </Route>
      </Route>
      <Route path="*" element={<div className="flex h-full flex-col items-center justify-center gap-4 p-6"><h1 className="text-title font-semibold">页面不存在</h1><Link to="/" className="text-small underline">回到消息</Link></div>} />
    </Routes></Suspense>
    </>
  )
}
