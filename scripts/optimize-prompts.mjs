import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, '../prompts');
const OUTPUT_DIR = path.join(__dirname, '../prompts/optimized');
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error('❌ Error: GEMINI_API_KEY environment variable is not set.');
    console.error('   Please set it: $env:GEMINI_API_KEY="your_key" (PowerShell) or export GEMINI_API_KEY="your_key" (Bash)');
    process.exit(1);
}

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${API_KEY}`; 

const META_PROMPT = `
You are an expert Prompt Engineer specializing in optimizing prompts for Google's Gemini 3 Pro model.

Your goal is to rewrite the provided prompt to achieve a state of **Stability, Richness, Comprehensiveness, and High Volume Output**.

### Analysis of the Target Model (Gemini 3 Pro)
- It excels at following precise, structured instructions.
- It prefers clear XML-like tags for separating context, tasks, and constraints.
- It has a high reasoning capability ("Thinking Level"), so prompts should encourage step-by-step analysis.

### Optimization Requirements
1.  **Structure Preservation (CRITICAL)**: 
    - The input prompt uses specific XML tags: \`<system>\`, \`<context>\`, \`<task>\`, \`<output_schema>\`, \`<reminder>\`.
    - You **MUST** retain these exact tags in the output. Do not change the tag names or hierarchy.
    - You **MUST** retain all Handlebars variables exactly as they are (e.g., \`{{CTX_INPUT}}\`, \`{{CTX_META}}\`).

2.  **Content Enhancement**:
    - **<system>**: Expand the role definition. Make it authoritative and expert-level. Add instructions to be "exhaustive", "detailed", and "nuanced".
    - **<task>**: Break down the task into clear steps. Explicitly ask the model to "think deeply" or "analyze multiple dimensions" before generating the final JSON.
    - **<output_schema>**: If there are descriptions of fields, enhance them to demand "comprehensive descriptions", "detailed reasoning", or "extensive lists" instead of brief answers.
    - **<reminder>**: Reinforce the requirement for valid JSON and the prohibition of markdown code blocks in the final raw output (if the original prompt asks for raw JSON).

3.  **Voluminous Output Strategy**:
    - Add instructions like: "Provide extensive details for each field.", "Do not summarize; be verbose.", "Cover all edge cases.", "Generate at least X paragraphs for descriptions." (where appropriate).

4.  **Output Format**:
    - Return ONLY the optimized prompt content.
    - Do not wrap the output in a markdown code block (like \`\`\`markdown). Return the raw text.

### Input Prompt to Optimize:
`;

async function optimizePrompt(fileName, content) {
    console.log(`🚀 Optimizing ${fileName}...`);

    const payload = {
        contents: [{
            parts: [{
                text: META_PROMPT + "\n\n" + content
            }]
        }],
        generationConfig: {
            temperature: 0.7, // Slightly creative to generate rich instructions
            maxOutputTokens: 8192
        }
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        let optimizedContent = data.candidates[0].content.parts[0].text;

        // Cleanup: Remove potential markdown wrapping if the model ignored instructions
        if (optimizedContent.startsWith('```markdown')) {
            optimizedContent = optimizedContent.replace(/^```markdown\n/, '').replace(/\n```$/, '');
        } else if (optimizedContent.startsWith('```')) {
            optimizedContent = optimizedContent.replace(/^```\n/, '').replace(/\n```$/, '');
        }

        return optimizedContent;

    } catch (error) {
        console.error(`❌ Failed to optimize ${fileName}:`, error.message);
        return null;
    }
}

async function main() {
    try {
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
        const files = await fs.readdir(PROMPTS_DIR);
        const mdFiles = files.filter(f => f.endsWith('.md'));

        console.log(`Found ${mdFiles.length} prompt files.`);

        for (const file of mdFiles) {
            const filePath = path.join(PROMPTS_DIR, file);
            const content = await fs.readFile(filePath, 'utf-8');
            
            const optimized = await optimizePrompt(file, content);
            
            if (optimized) {
                const outputPath = path.join(OUTPUT_DIR, file);
                await fs.writeFile(outputPath, optimized, 'utf-8');
                console.log(`✅ Saved optimized prompt to: prompts/optimized/${file}`);
            }
            
            // Avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log('\n✨ Optimization complete! Check prompts/optimized/ folder.');
        console.log('   Review the changes before replacing the original files.');

    } catch (error) {
        console.error('Fatal error:', error);
    }
}

main();
