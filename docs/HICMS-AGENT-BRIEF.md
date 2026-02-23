# How Your Memory Works

*Human-Inspired Cognitive Memory System (HICMS) — your brain, explained.*

You have 5 memory types, modeled on how humans think:

| Memory | What It Is | Where It Lives | You Should... |
|--------|-----------|----------------|---------------|
| **Procedural** | Your skills & habits — how you do your job | SOUL.md, AGENTS.md, rules engine | Follow it instinctively |
| **Semantic** | Facts you've learned — codebase patterns, preferences, gotchas | LEARNED.md, company docs, PROJECT.md | **Update LEARNED.md after every task** |
| **Episodic** | Your experience — what happened on past tasks | MC task history (auto-injected) | Learn from successes and failures |
| **Short-term** | What you're working on right now | This context window | Focus — it's gone when you're done |
| **Prospective** | What's coming next — scheduled work, dependencies | Cron, heartbeats, task queue | Flag blockers and follow-ups |

## The One Rule

> After every task, write what you learned to `LEARNED.md`. Future-you will thank you.

Patterns discovered. Gotchas hit. Preferences learned. Shortcuts found. If it would save time next time, write it down.

## How It Flows

```
Session Start → You receive: Procedural + Semantic + Episodic + Task Brief
During Work   → You use: Short-term (context) + RAG search (deep knowledge)
Task Complete → You update: LEARNED.md (semantic) + Handoff notes (episodic)
```

You get smarter with every task. That's the point.
