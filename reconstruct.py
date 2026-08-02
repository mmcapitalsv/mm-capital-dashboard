import json
import re

lines_dict = {}

with open('C:/Users/luisp/.gemini/antigravity-ide/brain/846e0c78-f0a1-453b-a40c-ef7ce7a9fdd0/.system_generated/logs/transcript_full.jsonl', 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            if data.get('type') == 'VIEW_FILE':
                content = data.get('content', '')
                if 'Dashboard.jsx' in content:
                    # Let's verify it looks like the react file
                    for l in content.split('\n'):
                        match = re.match(r'^(\d+):\s(.*)$', l)
                        if match:
                            line_num = int(match.group(1))
                            text = match.group(2)
                            
                            # Keep only lines from Dashboard.jsx
                            if line_num not in lines_dict:
                                lines_dict[line_num] = text
        except Exception as e:
            pass

print(f"Extracted {len(lines_dict)} lines.")

if len(lines_dict) > 0:
    max_line = max(lines_dict.keys())
    with open('C:/Users/luisp/Documents/ANTIGRAVITY/MMCAPITAL/src/components/Dashboard.jsx', 'w', encoding='utf-8') as out:
        for i in range(1, max_line + 1):
            # Fallback to empty string for missing lines just in case
            out.write(lines_dict.get(i, '') + '\n')
    print(f"Wrote to Dashboard.jsx (max line {max_line})")
