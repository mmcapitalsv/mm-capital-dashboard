const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'components', 'Dashboard.jsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Import useProyectos
content = content.replace(
  "import ProjectDetails from './ProjectDetails';",
  "import ProjectDetails from './ProjectDetails';\nimport { useProyectos } from '../hooks/useProyectos';"
);

// 2. Remove static PROJECTS
content = content.replace(
  /const PROJECTS = \[\s*\{ id: '1'.*?\}\s*\];/gs,
  "// const PROJECTS_REMOVED = true;"
);

// 3. Add useProyectos to Dashboard
content = content.replace(
  "export default function Dashboard({ user, onLogout }) {",
  `export default function Dashboard({ user, onLogout }) {
  const { proyectos: PROJECTS, gastos, hitos, rol, isAdmin, notificaciones, loading } = useProyectos(user);`
);

// 4. Update activeProject initialization to just read hash, we'll find project later
content = content.replace(
  /const \[activeProject, setActiveProject\] = useState\(\(\) => \{[\s\S]*?return null;\n  \}\);/,
  `const [activeProject, setActiveProject] = useState(null);
  
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    const parts = hash.split('/');
    if (parts[0] === 'project-details' && parts[1] && PROJECTS.length > 0) {
      setActiveProject(PROJECTS.find(p => String(p.id) === parts[1]) || null);
    }
  }, [PROJECTS, window.location.hash]);`
);

// 5. Replace user?.role with rol
content = content.replace(/user\?\.role/g, "rol");
content = content.replace(/rol === 'Administrador'/g, "isAdmin");

// 6. Fix user?.role === 'Administrador' || true
content = content.replace(/\(isAdmin \|\| true\)/g, "(isAdmin)");

// 7. Update Notificaciones
content = content.replace(
  /<div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-white"><\/div>/,
  `{notificaciones && notificaciones.length > 0 && <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-white animate-pulse"></div>}`
);

// Insert dynamic notifications in the dropdown
const notifHtml = `{notificaciones && notificaciones.length > 0 ? notificaciones.map(n => (
                          <div key={n.id} className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                            <p className="text-[11px] font-bold text-red-500 flex items-center gap-1.5"><AlertTriangle size={12}/> Vencimiento Crítico</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{n.tarea} - Proyecto {n.proyecto_id}</p>
                            <p className="text-[9px] text-slate-400 mt-1">Vence: {n.fecha_vencimiento}</p>
                          </div>
                        )) : (
                          <div className="px-4 py-3 border-b border-gray-50 text-center text-xs text-slate-500">No hay notificaciones</div>
                        )}`;

content = content.replace(
  /<div className="max-h-60 overflow-y-auto">[\s\S]*?<\/div>\s*<div className="px-4 py-2 border-t border-gray-100 text-center bg-gray-50">/,
  `<div className="max-h-60 overflow-y-auto">
    ${notifHtml}
  </div>
  <div className="px-4 py-2 border-t border-gray-100 text-center bg-gray-50">`
);

// 8. Financial logic: We use Recharts. We need to pass data to Recharts.
// Since Dashboard.jsx has Recharts, let's find AreaChart.
// Wait, is AreaChart used in Finanzas tab inside ProjectDetails or Dashboard?
// Let's just save for now and we will fix Finanzas after checking where it is.

fs.writeFileSync(file, content, 'utf8');
console.log("Dashboard.jsx updated");
