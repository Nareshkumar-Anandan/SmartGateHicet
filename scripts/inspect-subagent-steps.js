const fs = require('fs');
const readline = require('readline');

async function run() {
  const fileStream = fs.createReadStream('C:\\Users\\Nareshkumar\\.gemini\\antigravity-ide\\brain\\f79f6650-78a2-41b3-8a2d-7e170804ba05\\.system_generated\\logs\\transcript_full.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.includes('upload_praveen_to_turnstiles') && line.includes('BROWSER_SUBAGENT')) {
      const data = JSON.parse(line);
      const matches = [...data.content.matchAll(/### Step (\d+): ([a-zA-Z0-9_]+)\s+Arguments:\s*```json\s*([\s\S]*?)```/g)];
      for (const m of matches) {
        console.log(`Step ${m[1]}: ${m[2]} -> ${m[3].replace(/\s+/g, ' ').slice(0, 250)}`);
      }
    }
  }
}
run();
