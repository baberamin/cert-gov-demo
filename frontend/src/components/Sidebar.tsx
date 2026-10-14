import { NavLink } from 'react-router-dom';

const navItems = [
  { label: 'Overview', to: '/' },
  { label: 'Certificate Inventory', to: '/inventory' },
  { label: 'Findings', to: '/findings' },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-full w-56 bg-gray-950 text-white flex flex-col z-10">
      <div className="px-5 py-5 border-b border-gray-800">
        <span className="text-sm font-bold tracking-widest text-gray-400 uppercase">Zuma</span>
      </div>
      <nav className="flex-1 py-4">
        <div className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Certificates
        </div>
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `block pl-8 pr-4 py-2 text-sm transition-colors ${
                isActive
                  ? 'border-l-2 border-indigo-500 bg-gray-800 text-white'
                  : 'border-l-2 border-transparent text-gray-400 hover:text-white hover:bg-gray-800'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
