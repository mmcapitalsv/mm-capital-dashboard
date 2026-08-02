const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('C:/Users/luisp/.gemini/antigravity-ide/brain/846e0c78-f0a1-453b-a40c-ef7ce7a9fdd0/.system_generated/logs/transcript_full.jsonl');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let bestContent = '';
  let parts = [];

  for await (const line of rl) {
      try {
        const data = JSON.parse(line);
        if (data.type === 'TOOL_RESPONSE' && data.content && typeof data.content === 'string') {
           if (data.content.includes('import React')) {
              parts.push({type: 'TOOL_RESPONSE', content: data.content});
           }
           if (data.content.includes('Dashboard')) {
              parts.push({type: 'TOOL_RESPONSE', content: data.content});
           }
        }
      } catch (e) {}
  }

  parts.sort((a,b) => b.content.length - a.content.length);
  
  if (parts.length > 0) {
    let best = parts[0].content;
    let lines = best.split('\n');
    let output = [];
    let capturing = false;
    for(let l of lines) {
       if (l.includes('import React')) capturing = true;
       if (capturing) {
          let match = l.match(/^\[\d+\]\s(.*)$/);
          if (match) {
             output.push(match[1]);
          } else {
             output.push(l);
          }
       }
    }
    fs.writeFileSync('C:/Users/luisp/Documents/ANTIGRAVITY/MMCAPITAL/best_backup.txt', best);
    console.log("Restored Dashboard.jsx with length: ", best.length);
  } else {
    console.log("No backup found.");
  }
}

processLineByLine();
