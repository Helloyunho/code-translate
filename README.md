# Code Translate

Translate your code between programming languages, powered by LLMs.

Before you ask, yes, this project was vibe-coded(except eslint, tsconfig and gitignore) in just about 2 hours. I made this purely because I was bored and wanted to try making my dumb idea come to life.

And since it was vibe-coded and made in a rush, the code quality is... let's just say 'not good'. And it's probably vulnerable to things like prompt injections, etc. But hey, it's fun to play around with it.

> [!IMPORTANT]
> DO NOT USE THIS WITH SENSITIVE OR PROPRIETARY CODE. I SAY AGAIN, DO NOT USE THIS WITH SENSITIVE OR PROPRIETARY CODE. This is a toy project and is not built for security or privacy. Use at your own risk.

Big thanks to [Kagi Translate](https://translate.kagi.com) for inspiring this project.

## Usage

Go to https://translate.helloyunho.xyz, it'll work as long as my $10 token doesn't run out.

## Running locally

1. Clone the repo
2. Make `.dev.vars` based on `.dev.vars.example` and fill in your API keys
3. Install dependencies with `bun install` (yes I use bun btw)
4. Start the dev server with `bun dev`

## Adding new languages

IDK why you would do this when it already has custom language support, but anyway here's how you do it:

- `public/index.html`
    - Add new language option in source and target dropdowns
- `public/script.js`
    - Add new language mapping in `langExtensions` (for tokenization)
    - You can update `indentSizeForLanguage` to set indentation behavior for the new language

## What I used to build this:

- Frontend
    - Pure HTML/CSS/JS (no frameworks, just vanilla)
    - CodeMirror 6 for code editing and syntax highlighting
- Backend
    - Hono for serverless API
        - Deployed on Cloudflare Workers
    - OpenAI and Gemini APIs for LLM calls
    - Bun for runtime and dependency management
- Agents
    - [Impeccable](https://impeccable.style/) for design system and UI guidance (see .impeccable.md and .agents/skills/)
    - GitHub Copilot with GPT-5.3-Codex for doing actual vibe-coding and implementation
