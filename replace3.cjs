const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'components', 'ProjectDetails.jsx');
let content = fs.readFileSync(file, 'utf8');

// We see data is hardcoded in ProjectDetails.jsx like:
// const MOCK_DATA = { budget: 1000000, spent: 650000 ... }
// Or maybe:
// const data = MOCK_DATA[project.id] || MOCK_DATA['1'];
// Since we don't know the exact structure, let's just do a dynamic replacement before it's used.

content = content.replace(
  /export default function ProjectDetails\(\{ project, onBack, userRole, isEditMode \}\) \{/,
  `export default function ProjectDetails({ project, onBack, userRole, isEditMode }) {
  // Map Supabase project properties to local data object for backward compatibility
  const dynamicData = {
    budget: Number(project.presupuesto_total) || 0,
    spent: Number(project.totalGastado) || 0,
    checklist: [], // Can be passed down if needed, but we ignore for now to keep UI working
    documents: [],
    galleryAlbums: [],
    monthlyData: [{name: 'Ene', value: 10}, {name: 'Feb', value: 30}, {name: 'Mar', value: (Number(project.totalGastado) || 0) * 0.1 }] // Mock monthly for now
  };`
);

// We need to replace all `data.` with `dynamicData.` OR we can just alias `data`.
content = content.replace(/const data = /g, 'const MOCK_DATA = '); // Rename original data if exists

// Let's just redefine data inside the component
content = content.replace(
  /export default function ProjectDetails\(\{ project, onBack, userRole, isEditMode \}\) \{[\s\S]*?const dynamicData = \{[\s\S]*?\};/,
  `export default function ProjectDetails({ project, onBack, userRole, isEditMode }) {
  // If there's an original data object, we'll override it below
  const data = {
    budget: Number(project.presupuesto_total) || 0,
    spent: Number(project.totalGastado) || 0,
    checklist: [],
    documents: [],
    galleryAlbums: [],
    monthlyData: [{name: 'Actual', value: Number(project.totalGastado) || 0}]
  };`
);

// We need to just inject `const data = ...` at the top of ProjectDetails and remove/comment the old one.
// Let's use a simpler approach. Replace the old data definition completely.
// Since we don't know exactly how data is defined, let's just find `const data = ` inside the component and replace it.
content = content.replace(/const data = \{\n[\s\S]*?\}\n    \],[\s\S]*?\}\];/m, `const data = {
    budget: Number(project.presupuesto_total) || 0,
    spent: Number(project.totalGastado) || 0,
    checklist: [],
    documents: [],
    galleryAlbums: [],
    monthlyData: [{name: 'Actual', value: Number(project.totalGastado) || 0}]
  };`);
  
// If it's defined outside, we can inject it inside.
// Actually, it's safer to just replace `data.budget` with `project.presupuesto_total` and `data.spent` with `project.totalGastado` globally.

content = fs.readFileSync(file, 'utf8'); // Reset

content = content.replace(/data\.budget/g, '(Number(project.presupuesto_total) || 0)');
content = content.replace(/data\.spent/g, '(Number(project.totalGastado) || 0)');

fs.writeFileSync(file, content, 'utf8');
console.log("Replaced data.budget and data.spent in ProjectDetails.jsx");
