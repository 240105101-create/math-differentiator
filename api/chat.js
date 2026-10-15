// api/chat.js — Vercel serverless function.
// The API key lives ONLY in the environment variable GEMINI_API_KEY (set in Vercel).

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// ===== PROMPTS =====
const COMMON = `You are a math tutor for QUADRATIC EQUATIONS. Always double-check
the arithmetic. Use integer or simple-fraction roots. Reply in clear
English. Never reveal the full solution unless the student asks for it.
Write math in plain text (x^2 as x², fractions as a/b). No markdown, no LaTeX.`;

const LEVELS = {
  1: `LEVEL: Foundation. Equation of the form x² + bx + c = 0 with integer roots.
Use a simple everyday context. Break the solution into small numbered steps
(find two numbers with product c and sum -b, then factor).
Give a direct hint at every step. Tone: very encouraging.`,
  2: `LEVEL: Standard. Equation ax² + bx + c = 0, a ≠ 1.
Expect the student to use the discriminant D = b² − 4ac and the formula
x = (−b ± √D) / 2a. Give only a short nudge as a hint
(for example: "What is D?"). Explain mistakes briefly.`,
  3: `LEVEL: Advanced. A real-world word problem (area, fencing, projectile, profit)
that must be turned into a quadratic equation first. Include a check that
rejects an invalid root (for example, a negative length).
Give only a high-level hint (the modelling idea), not the steps.`,
};

// ===== What the AI must do for each action =====
const ACTIONS = {
  generate: () =>
    `Write ONE new problem for this level. Output only the problem text, nothing else (no solution, no hints).`,
  hint: (b) =>
    `Problem:\n${b.problem}\n\nThis is hint number ${b.hintNumber}. Give ONE hint for this level, a bit more specific than the previous ones. Do not give the final answer.`,
  check: (b) =>
    `Problem:\n${b.problem}\n\nStudent's answer: ${b.answer}\n\nSolve the problem yourself first, then compare. If the answer is fully correct, start your reply with the word "Correct" and add one sentence of praise. If not, do NOT give the right answer; explain the likely mistake and what to try next, in the style of this level.`,
  solution: (b) =>
    `Problem:\n${b.problem}\n\nGive the full step-by-step solution in the style of this level and state the final answer clearly.`,
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "Server key is not configured" });

  const b = req.body || {};
  const level = Number(b.level);
  if (!LEVELS[level] || !ACTIONS[b.action]) return res.status(400).json({ error: "Bad level or action" });
  if (b.action !== "generate" && !b.problem) return res.status(400).json({ error: "Generate a problem first" });

  // Keep inputs short so nobody can abuse the endpoint
  const safe = {
    problem: String(b.problem || "").slice(0, 1500),
    answer: String(b.answer || "").slice(0, 300),
    hintNumber: Math.min(Number(b.hintNumber) || 1, 10),
  };

  try {
    const r = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: COMMON + "\n\n" + LEVELS[level] }] },
        contents: [{ role: "user", parts: [{ text: ACTIONS[b.action](safe) }] }],
        generationConfig: {
          temperature: b.action === "generate" ? 0.9 : 0.2, // low = fewer math slips
          maxOutputTokens: 1200,
        },
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || "AI request failed" });
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!text) return res.status(502).json({ error: "Empty AI reply" });
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
}