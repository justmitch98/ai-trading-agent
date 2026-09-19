// src/services/agent.js
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

// Supported instruments — must match the frontend and DB constraints
const SUPPORTED_SYMBOLS = ["GOLD", "SILVER", "COPPER", "OIL", "BTC"];

// Paper-trading reference prices. In production these come from a market data feed.
// Used only for the mock execution layer right now.
const INSTRUMENTS = {
  GOLD:   { basePrice: 2650,  volatility: 0.015 },
  SILVER: { basePrice: 31,    volatility: 0.025 },
  COPPER: { basePrice: 4.2,   volatility: 0.020 },
  OIL:    { basePrice: 78,    volatility: 0.030 },
  BTC:    { basePrice: 62000, volatility: 0.040 }
};

const MODEL = "claude-sonnet-4-5";
const MAX_PROPOSALS_PER_RUN = 3;
const MAX_NOTIONAL_USD = 50;

// Lazily construct the client so a missing key fails at call time, not import time.
let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

// ---------- Shared helpers ----------

function stripCodeFences(text) {
  // Claude occasionally wraps JSON in ```json ... ``` despite instructions.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text.trim();
}

function extractText(response) {
  const block = response.content.find((c) => c.type === "text");
  return block ? block.text : "";
}

function validateProposal(p) {
  if (!p || typeof p !== "object") return false;
  if (!["BUY", "SELL"].includes(p.action)) return false;
  if (!SUPPORTED_SYMBOLS.includes(p.symbol)) return false;
  if (typeof p.quantity !== "number" || !(p.quantity > 0) || p.quantity > 100) return false;
  if (!["MARKET", "LIMIT"].includes(p.orderType)) return false;
  if (p.orderType === "LIMIT") {
    if (typeof p.limitPrice !== "number" || !(p.limitPrice > 0)) return false;
  } else {
    // Normalize MARKET orders so downstream code always sees the same shape
    p.limitPrice = null;
  }
  if (typeof p.reasoning !== "string" || p.reasoning.trim().length === 0) return false;

  // Enforce max notional using the reference price (paper trading)
  const ref = INSTRUMENTS[p.symbol]?.basePrice ?? 0;
  if (ref > 0 && p.quantity * ref > MAX_NOTIONAL_USD) return false;

  return true;
}

function parseProposalsResponse(text, max) {
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch (err) {
    console.error("[AGENT] Non-JSON response:", text.slice(0, 200));
    return [];
  }

  const list = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  return list.filter(validateProposal).slice(0, max);
}

// ---------- Prompt: scheduled (no user input) ----------

const SCHEDULED_SYSTEM_PROMPT = `You are a trading analyst generating candidate trade proposals for a paper-trading platform.

The user has NOT specified a request. Analyze current market conditions and propose
0 to ${MAX_PROPOSALS_PER_RUN} trades worth considering.

STRICT RULES:
- Respond ONLY with valid JSON. No prose, no markdown fences.
- Shape:
  {
    "proposals": [
      {
        "action": "BUY" | "SELL",
        "symbol": ${SUPPORTED_SYMBOLS.map((s) => `"${s}"`).join(" | ")},
        "quantity": number,
        "orderType": "MARKET" | "LIMIT",
        "limitPrice": number | null,
        "reasoning": string
      }
    ]
  }
- If market conditions do not justify a proposal, return {"proposals": []}.
- Max notional per trade: $${MAX_NOTIONAL_USD} (paper trading).
- Reasoning must be factual and reference the instrument's actual characteristics,
  not invented price levels or news.
- Never mention returns, profit projections, or guaranteed outcomes.`;

// ---------- Prompt: user-triggered ----------

const USER_SYSTEM_PROMPT = `You are a trading analyst. Given a user's request, produce ONE trade proposal.

STRICT RULES:
- Respond ONLY with valid JSON. No prose, no markdown fences.
- Shape:
  {
    "action": "BUY" | "SELL",
    "symbol": ${SUPPORTED_SYMBOLS.map((s) => `"${s}"`).join(" | ")},
    "quantity": number,
    "orderType": "MARKET" | "LIMIT",
    "limitPrice": number | null,
    "reasoning": string (2-4 sentences, plain English)
  }
- Max notional per trade: $${MAX_NOTIONAL_USD} (paper trading).
- If the request cannot be satisfied with the supported symbols, still return a
  valid proposal for the closest supported instrument and explain why in reasoning.
- Never mention returns, profit projections, or guaranteed outcomes.`;

// ---------- Public API ----------

/**
 * Scheduled agent — generates 0..N proposals from market analysis.
 * Does NOT execute anything. Returns validated proposals only.
 */
export async function generateScheduledProposals() {
  const client = getClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SCHEDULED_SYSTEM_PROMPT,
    messages: [{ role: "user", content: "Generate today's candidate proposals." }]
  });

  const text = extractText(response);
  return parseProposalsResponse(text, MAX_PROPOSALS_PER_RUN);
}

/**
 * User-triggered agent — generates exactly ONE proposal from a prompt.
 * Does NOT execute anything. Throws if the LLM output cannot be validated.
 */
export async function generateProposal({ prompt }) {
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error("prompt is required");
  }

  const client = getClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: USER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }]
  });

  const text = extractText(response);

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    console.error("[AGENT] Non-JSON response:", text.slice(0, 200));
    throw new Error("Agent returned malformed JSON");
  }

  if (!validateProposal(parsed)) {
    throw new Error("Agent returned an invalid proposal");
  }

  return parsed;
}

/**
 * Executes an approved trade in the user's paper-trading sandbox.
 * For now this is a mock execution using reference prices.
 * Later this delegates to the sandbox provisioning + broker layer.
 */
export async function executeTrade({ proposal }) {
  const ref = INSTRUMENTS[proposal.symbol]?.basePrice;
  if (!ref) {
    throw new Error(`Unknown symbol: ${proposal.symbol}`);
  }

  const fillPrice = ref * (1 + (Math.random() - 0.5) * 0.002); // ±0.1% slippage

  return {
    status: "FILLED",
    symbol: proposal.symbol,
    action: proposal.action,
    quantity: proposal.quantity,
    fillPrice: Number(fillPrice.toFixed(4)),
    notional: Number((fillPrice * proposal.quantity).toFixed(2)),
    executedAt: new Date().toISOString(),
    venue: "paper",
    note: "Mock fill — no real order placed."
  };
}
