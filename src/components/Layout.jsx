import React from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout({ children, currentView, setCurrentView, onLogout, user }) {
  return (
    <div className="flex h-screen bg-[#F5F6F8] dark:bg-zinc-900 overflow-hidden">
      <Sidebar currentView={currentView} setCurrentView={setCurrentView} onLogout={onLogout} />
      
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <Header user={user} />
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          {children}
        </main>
      </div>
    </div>
  );
}
