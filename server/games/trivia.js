// Game 2: Stellar Trivia. 10 questions, answers validated server-side,
// 2 XLM per correct answer paid out in ONE transaction at the end.
import crypto from "node:crypto";
import * as store from "../store.js";
import { sendXlm } from "../payouts.js";
import {
  ENTRY_FEE_XLM,
  TRIVIA_ANSWER_WINDOW_MS,
  TRIVIA_MAX_PLAYS,
  TRIVIA_SESSION_MAX_MS,
  TRIVIA_XLM_PER_CORRECT,
} from "../config.js";
import { QUESTIONS, publicQuestion } from "./trivia-questions.js";

const ADDRESS_RE = /^[GC][A-Z2-7]{55}$/;
const TOTAL = QUESTIONS.length;

export function mountTrivia(app) {
  app.get("/api/trivia/config", async (req, res) => {
    const address = String(req.query.address || "");
    const playsUsed = ADDRESS_RE.test(address) ? await store.getPlays("trivia", address) : 0;
    res.json({
      totalQuestions: TOTAL,
      xlmPerCorrect: TRIVIA_XLM_PER_CORRECT,
      entryFeeXlm: ENTRY_FEE_XLM,
      maxPlays: TRIVIA_MAX_PLAYS,
      playsUsed,
      answerWindowMs: TRIVIA_ANSWER_WINDOW_MS,
    });
  });

  // PAYWALLED (x402 middleware runs first): start the one-and-only run.
  app.post("/api/trivia/session", async (req, res) => {
    const address = String(req.body?.address || "");
    if (!ADDRESS_RE.test(address)) {
      return res.status(400).json({ error: "Valid Stellar address (G... or C...) required." });
    }
    await store.recordPlay("trivia", address);
    const token = crypto.randomUUID();
    const now = Date.now();
    await store.createSession(token, {
      game: "trivia",
      address,
      current: 0,
      score: 0,
      finished: false,
      startedAt: now,
      askedAt: now,
    });
    res.json({
      token,
      totalQuestions: TOTAL,
      xlmPerCorrect: TRIVIA_XLM_PER_CORRECT,
      question: publicQuestion(QUESTIONS[0], 0, TOTAL),
    });
  });

  app.post("/api/trivia/answer", async (req, res) => {
    const token = String(req.body?.token || "");
    const session = await store.getSession(token);
    if (!session || session.game !== "trivia" || session.finished) {
      return res.status(404).json({ error: "Unknown, expired, or finished session." });
    }
    const now = Date.now();
    if (now - session.startedAt > TRIVIA_SESSION_MAX_MS) {
      session.finished = true;
      await store.updateSession(token, session);
      return res.status(410).json({ error: "Session timed out. This game is fast — 2 minutes!" });
    }

    const idx = session.current;
    const question = QUESTIONS[idx];
    const choiceIndex = Number(req.body?.choiceIndex);
    const tooSlow = now - session.askedAt > TRIVIA_ANSWER_WINDOW_MS;
    const correct = !tooSlow && choiceIndex === question.answerIndex;

    if (correct) session.score += 1;
    session.current = idx + 1;
    session.askedAt = now;

    const base = {
      correct,
      tooSlow,
      correctIndex: question.answerIndex,
      funFact: question.funFact,
      score: session.score,
      questionNumber: idx + 1,
      totalQuestions: TOTAL,
    };

    if (session.current < TOTAL) {
      await store.updateSession(token, session);
      return res.json({ ...base, question: publicQuestion(QUESTIONS[session.current], session.current, TOTAL) });
    }

    // Final question answered: settle up in one payment.
    session.finished = true;
    await store.updateSession(token, session);
    const totalXlm = session.score * TRIVIA_XLM_PER_CORRECT;
    const payout =
      totalXlm > 0
        ? await sendXlm(session.address, totalXlm, "Trivia winnings")
        : { status: "skipped", reason: "zero_score" };
    res.json({ ...base, done: true, totalXlm, payout });
  });
}
