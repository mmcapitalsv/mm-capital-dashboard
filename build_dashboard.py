import os, re

code = """import React, { useState, useEffect } from 'react';
import Layout from './Layout';
import ProjectDetails from './ProjectDetails';
import { useProyectos } from '../hooks/useProyectos';
import { 
  Activity, ArrowUp, Building2, ChevronDown, ChevronLeft, ChevronRight, 
  DollarSign, Edit2, Layers, MapPin, PieChart, Plus, TrendingUp, Wallet, 
  Camera, AlertTriangle, Settings, Users, FileText, LogOut
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const dummyProjects = [
  {
    id: 1,
    name: 'Condado San Martín',
    location: 'San Martín, San Salvador',
    description: 'Complejo residencial de 120 viviendas con amenidades premium.',
    status: 'En Ejecución',
    progress: 75,
    presupuesto: '$5.2M',
    ejecutado: '$3.9M',
    ejecutadoPct: '75%',
    entrega: 'Q4 2024',
    rentabilidad: '18%',
    img: '/images/san-martin.jpg'
  },
  {
    id: 2,
    name: 'Residencial Opico',
    location: 'San Juan Opico, La Libertad',
    description: 'Desarrollo urbano sostenible con áreas recreativas.',
    status: 'Planificación',
    progress: 15,
    presupuesto: '$4.1M',
    ejecutado: '$615K',
    ejecutadoPct: '15%',
    entrega: 'Q2 2025',
    rentabilidad: '22%',
    img: '/images/opico.jpg'
  },
  {
    id: 3,
    name: 'Plaza Chalchuapa',
    location: 'Chalchuapa, Santa Ana',
    description: 'Centro comercial de conveniencia y oficinas.',
    status: 'Entregado',
    progress: 100,
    presupuesto: '$2.8M',
    ejecutado: '$2.8M',
    ejecutadoPct: '100%',
    entrega: 'Q1 2024',
    rentabilidad: '25%',
    img: '/images/chalchuapa.jpg'
  }
];

const chartData = [
  { name: 'Ene', ingresos: 40, egresos: 24 },
  { name: 'Feb', ingresos: 30, egresos: 13 },
  { name: 'Mar', ingresos: 20, egresos: 98 },
  { name: 'Abr', ingresos: 27, egresos: 39 },
  { name: 'May', ingresos: 18, egresos: 48 },
  { name: 'Jun', ingresos: 23, egresos: 38 },
  { name: 'Jul', ingresos: 34, egresos: 43 },
];

function VaultView() { return <div className="p-8"><div className="bg-white p-8 rounded-2xl shadow-sm text-slate-800 font-medium">Bóveda (En desarrollo)</div></div>; }
function ChatView() { return <div className="p-8"><div className="bg-white p-8 rounded-2xl shadow-sm text-slate-800 font-medium">Chat (En desarrollo)</div></div>; }
function AllProjectsView() { return <div className="p-8"><div className="bg-white p-8 rounded-2xl shadow-sm text-slate-800 font-medium">Todos los Proyectos (En desarrollo)</div></div>; }
function ProfileView() { return <div className="p-8"><div className="bg-white p-8 rounded-2xl shadow-sm text-slate-800 font-medium">Perfil (En desarrollo)</div></div>; }

function PortfolioView({ user, isEditMode, setIsEditMode, setCurrentView }) {
  const { proyectos, loading, notificaciones, isAdmin } = useProyectos(user);
  const [featuredIndex, setFeaturedIndex] = useState(0);

  const PROJECTS = dummyProjects;
  const fp = PROJECTS[featuredIndex];

  const statusColor = fp.status === 'En Ejecución' 
    ? 'text-amber-600 border-amber-200 bg-amber-50'
    : fp.status === 'Entregado'
    ? 'text-emerald-600 border-emerald-200 bg-emerald-50'
    : 'text-blue-600 border-blue-200 bg-blue-50';

  const handleCardClick = (p) => {
    // Navigate to details if needed
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-[#F5F6F8] custom-scrollbar pb-20">
      
      {/* Mobile Header (Hidden on Desktop) */}
      <header className="md:hidden px-4 pt-6 pb-4 flex flex-row justify-between items-start w-full">
        <div className="text-left">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-tight">
            Buenas noches,<br />
            <span className="text-mm-gold">Ing. Luis Panameño</span>
          </h1>
          <p className="text-slate-500 text-sm mt-1.5 font-medium">
            Panel ejecutivo • Acceso exclusivo
          </p>
        </div>
      </header>

      {/* KPI Cards (Mobile) */}
      <div className="md:hidden px-4 mb-6">
        <div className="bg-[#0B1B2C] rounded-[20px] p-4 text-white shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-mm-gold flex items-center justify-center">
                <Activity size={16} className="text-[#0B1B2C]" />
              </div>
              <div>
                <h2 className="text-sm font-bold">Resumen Ejecutivo</h2>
                <p className="text-[9px] text-white/50">Estado actual del portafolio</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1.5 mt-2">
            <div className="bg-[#16273B] rounded-xl p-2 flex flex-col items-center text-center border border-white/5">
              <Building2 size={12} className="text-mm-gold mb-1" />
              <p className="text-sm font-bold">3</p>
            </div>
            <div className="bg-[#16273B] rounded-xl p-2 flex flex-col items-center text-center border border-white/5">
              <DollarSign size={12} className="text-mm-gold mb-1" />
              <p className="text-sm font-bold">$14.8M</p>
            </div>
            <div className="bg-[#16273B] rounded-xl p-2 flex flex-col items-center text-center border border-white/5">
              <TrendingUp size={12} className="text-mm-gold mb-1" />
              <p className="text-sm font-bold">62%</p>
            </div>
            <div className="bg-[#16273B] rounded-xl p-2 flex flex-col items-center text-center border border-white/5">
              <Wallet size={12} className="text-mm-gold mb-1" />
              <p className="text-sm font-bold">$245K</p>
            </div>
          </div>
        </div>
      </div>

"""

# Now extract the central content from the backup
backup_path = 'c:/Users/luisp/Documents/ANTIGRAVITY/MMCAPITAL/src/components/Dashboard.jsx.backup'
lines_to_keep = []
with open(backup_path, 'r', encoding='utf-8') as f:
    for line in f:
        match = re.match(r'^\[\d+\]\s(.*)', line)
        if match:
            text = match.group(1)
            lines_to_keep.append(text)

start_idx = -1
end_idx = -1
for i, l in enumerate(lines_to_keep):
    if '{/* Header & KPIs */}' in l:
        start_idx = i
        break

for i, l in enumerate(lines_to_keep):
    if 'Este año <ChevronDown' in l:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    desktop_content = lines_to_keep[start_idx:end_idx+2] # Include up to ChevronDown
    code += '\n'.join(desktop_content)
    
    # Add the Recharts graph and close the tags
    code += """
                  </div>
                  <div className="h-64 mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorIngresos" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorEgresos" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94A3B8' }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94A3B8' }} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
                          labelStyle={{ color: '#64748B', fontSize: '12px', marginBottom: '4px' }}
                        />
                        <Area type="monotone" dataKey="ingresos" stroke="#10B981" strokeWidth={2} fillOpacity={1} fill="url(#colorIngresos)" />
                        <Area type="monotone" dataKey="egresos" stroke="#EF4444" strokeWidth={2} fillOpacity={1} fill="url(#colorEgresos)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
    </div>
  );
}

export default function Dashboard({ user, onLogout }) {
  const [currentView, setCurrentView] = useState('portfolio');
  const [activeProject, setActiveProject] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);

  const handleBack = () => {
    setCurrentView('portfolio');
    setActiveProject(null);
  };

  const renderView = () => {
    switch (currentView) {
      case 'project-details':
        return activeProject ? <ProjectDetails project={activeProject} onBack={handleBack} /> : <PortfolioView user={user} isEditMode={isEditMode} setIsEditMode={setIsEditMode} setCurrentView={setCurrentView} />;
      case 'vault': return <VaultView />;
      case 'chat': return <ChatView />;
      case 'all-projects': return <AllProjectsView />;
      case 'profile': return <ProfileView />;
      case 'portfolio':
      default:
        return <PortfolioView user={user} isEditMode={isEditMode} setIsEditMode={setIsEditMode} setCurrentView={setCurrentView} />;
    }
  };

  return (
    <Layout 
      currentView={currentView} 
      setCurrentView={setCurrentView} 
      onLogout={onLogout} 
      user={user}
    >
      {renderView()}
    </Layout>
  );
}
"""
    with open('c:/Users/luisp/Documents/ANTIGRAVITY/MMCAPITAL/src/components/Dashboard.jsx', 'w', encoding='utf-8') as f:
        f.write(code)
    print('Dashboard written successfully!')
else:
    print('Error: Could not find markers in backup.')
