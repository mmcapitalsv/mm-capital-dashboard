const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'components', 'ProjectDetails.jsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/userRole === 'Administrador'/g, "userRole === 'admin'");

fs.writeFileSync(file, content, 'utf8');
console.log("ProjectDetails.jsx updated");
