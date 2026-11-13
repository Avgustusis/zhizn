import { lazy, Suspense, useState } from 'react'
import App from './App.tsx'

/** Пробная партия грузится только когда её открыли: просмотрщику колод движок не нужен. */
const Trial = lazy(() => import('./ui/Trial.tsx'))

type Tab = 'колоды' | 'партия'

/** Две вкладки сайта: колоды в цифровом формате и пробная партия на ядре движка. */
export default function Root() {
  const [tab, setTab] = useState<Tab>(() => (location.hash === '#play' ? 'партия' : 'колоды'))
  const go = (t: Tab) => { setTab(t); history.replaceState(null, '', t === 'партия' ? '#play' : location.pathname) }
  return (
    <>
      <nav className="tabs">
        <button className={tab === 'колоды' ? 'on' : ''} onClick={() => go('колоды')}>Колоды</button>
        <button className={tab === 'партия' ? 'on' : ''} onClick={() => go('партия')}>Пробная партия</button>
      </nav>
      {tab === 'колоды' ? <App /> : <main><Suspense fallback={<p className="empty">Загрузка…</p>}><Trial /></Suspense></main>}
    </>
  )
}
