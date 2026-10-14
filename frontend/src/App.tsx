import { Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { OverviewPage } from './pages/OverviewPage';
import { InventoryPage } from './pages/InventoryPage';
import { FindingsPage } from './pages/FindingsPage';

export default function App() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="ml-56 flex-1 px-8 py-6">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/findings" element={<FindingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
