const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.jsx', 'utf8');
let lines = code.split('\n');
console.log('Original length:', lines.length);
lines = lines.slice(0, 1559);
fs.writeFileSync('src/components/Dashboard.jsx', lines.join('\n'));
console.log('Truncated to 1559 lines');
