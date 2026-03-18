import { Hono } from 'hono'
import { OpenAI } from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { cors } from 'hono/cors'

type Bindings = {
  ASSETS: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  }
  OPENAI_API_KEY?: string
  GEMINI_API_KEY?: string
  LLM_PROVIDER?: 'auto' | 'openai' | 'gemini'
  OPENAI_MODEL?: string
  GEMINI_MODEL?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

app.get('/*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw)
})

type TranslateBody = {
  sourceLang?: string
  targetLang?: string
  code?: string
}

const OPENAI_DEFAULT_MODEL = 'gpt-5.4'
const GEMINI_DEFAULT_MODEL = 'gemini-3.1-pro-preview'

const stripCodeFences = (text: string): string => {
  return text
    .replace(/^```[\w-]*\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim()
}

const buildSystemPrompt = (sourceLang: string, targetLang: string): string => {
  return [
    'You are an expert programming language translator.',
    'Task: Translate source code to the requested target language while preserving behavior.',
    `Source language: ${sourceLang === 'auto' ? 'Auto-detect from input code' : sourceLang}.`,
    `Target language: ${targetLang}.`,
    'Rules:',
    '- Output only translated code.',
    '- Do not output markdown, code fences, explanations, or notes.',
    '- Keep equivalent runtime behavior and edge-case handling.',
    '- Use idiomatic constructs for the target language.',
    '- Keep imports/includes required by the target language.',
    '- Do not include placeholder text.'
  ].join('\n')
}

const callGemini = async (
  apiKey: string,
  modelName: string,
  systemPrompt: string,
  sourceCode: string
): Promise<string> => {
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: modelName })
  const result = await model.generateContent([
    { text: systemPrompt },
    { text: sourceCode }
  ])
  return stripCodeFences(result.response.text())
}

const callOpenAI = async (
  apiKey: string,
  modelName: string,
  systemPrompt: string,
  sourceCode: string
): Promise<string> => {
  const openai = new OpenAI({ apiKey })
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: sourceCode }
    ],
    temperature: 0.1,
    service_tier: 'flex'
  })
  const content = response.choices[0]?.message?.content ?? ''
  return stripCodeFences(content)
}

app.post('/api/translate', async (c) => {
  let body: TranslateBody
  try {
    body = (await c.req.json()) as TranslateBody
  } catch {
    return c.json({ error: 'Invalid JSON body.' }, 400)
  }

  const sourceLang = (body.sourceLang ?? 'auto').trim().toLowerCase()
  const targetLang = (body.targetLang ?? '').trim().toLowerCase()
  const code = body.code ?? ''

  if (!targetLang) {
    return c.json({ error: 'Target language is required.' }, 400)
  }

  if (!code.trim()) {
    return c.json({ error: 'Source code is required.' }, 400)
  }

  const configuredProvider = (c.env.LLM_PROVIDER ?? 'auto').toLowerCase()

  if (configuredProvider !== 'auto' && configuredProvider !== 'openai' && configuredProvider !== 'gemini') {
    return c.json({ error: 'Invalid LLM_PROVIDER. Use auto, openai, or gemini.' }, 500)
  }

  const providerOrder =
    configuredProvider === 'openai'
      ? ['openai', 'gemini']
      : configuredProvider === 'gemini'
        ? ['gemini', 'openai']
        : ['openai', 'gemini']

  const systemPrompt = buildSystemPrompt(sourceLang, targetLang)

  try {
    for (const provider of providerOrder) {
      if (provider === 'openai' && c.env.OPENAI_API_KEY) {
        const openAIModel = c.env.OPENAI_MODEL ?? OPENAI_DEFAULT_MODEL

        const translatedCode = await callOpenAI(c.env.OPENAI_API_KEY, openAIModel, systemPrompt, code)
        return c.json({ translatedCode, provider: 'openai', model: openAIModel })
      }

      if (provider === 'gemini' && c.env.GEMINI_API_KEY) {
        const geminiModel = c.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL

        const translatedCode = await callGemini(c.env.GEMINI_API_KEY, geminiModel, systemPrompt, code)
        return c.json({ translatedCode, provider: 'gemini', model: geminiModel })
      }
    }

    return c.json(
      {
        error: 'No LLM provider is configured. Set OPENAI_API_KEY or GEMINI_API_KEY.'
      },
      500
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown provider error.'
    return c.json({ error: 'Translation failed.', details: message }, 500)
  }
})

export default app
