# Virtual Employee Experience — Product Roadmap

## Vision
Mission Clawtrol agents should feel like real remote employees — not AI tools. They learn your business, use your tools, follow your processes, and get better over time.

## Phase 1: Employee Onboarding (NOW)
Henry (Manager) guides new users through a structured onboarding — just like onboarding a real employee.

### Step 1 — Company Introduction (conversation)
Henry asks about the business: name, industry, what you do, who your customers are, mission/values.
→ Saves to `/business/PROFILE.md`

### Step 2 — Website Crawl (automatic)
"What's your website?" → Marie crawls it, extracts brand voice, services, messaging, team bios, key pages.
→ Saves to `/business/WEBSITE.md`

### Step 3 — Document Upload (guided)
"Do you have an employee handbook, brand guide, or training materials?"
User uploads docs → stored in `/business/handbook/` and `/business/training/`
→ All agents read these

### Step 4 — Tools & Access (guided)
"What tools do you use?" → Henry walks through each one: name, URL, credentials, how it's used.
→ Saves to `/business/TOOLS.md`

### Step 5 — Examples of Good Work (upload)
"Got examples of work you like? Past proposals, emails, campaigns?"
→ Saves to `/business/examples/`

### Step 6 — Processes & Workflows (conversation)
"Walk me through your key workflows. How does a lead become a customer?"
→ Saves to `/business/PROCESSES.md`

## Phase 2: Working Like Employees
- Agents read `/business/` knowledge base before every task
- Browser access to business tools (CRM, email, accounting)
- File deliverables in organized locations
- Status updates in plain English

## Phase 3: Continuous Learning
- Agents update the knowledge base as they learn new things
- Henry periodically asks "anything changed?"
- New team members (agents) auto-onboard from existing knowledge base
- Feedback loop: user corrects agents → agents remember

## Knowledge Base Structure
```
/business/
  PROFILE.md          — Company overview, mission, values, customers
  WEBSITE.md          — Crawled website content, brand voice, messaging
  BRAND.md            — Voice, tone, colors, logo usage, style guide
  TOOLS.md            — Every tool with URL, credentials, how we use it
  PROCESSES.md        — How you handle leads, onboard customers, etc.
  /handbook/          — Uploaded employee handbook, policies
  /training/          — SOPs, playbooks, training docs
  /examples/          — Past proposals, emails, campaigns that worked
```

## Agent Roster
| Agent | Name | Inspiration | Role |
|-------|------|-------------|------|
| 🎯 Manager | Henry | Henry Ford | Coordinates team, onboards users, delegates |
| 🔨 Builder | Elon | Elon Musk | Websites, apps, automations |
| 🔍 Researcher | Marie | Marie Curie | Market research, analysis |
| ✍️ Writer | Ernest | Hemingway | Content, copy, communications |
| 📊 Analyst | Warren | Warren Buffett | Numbers, data, financial analysis |
| 🎨 Designer | Steve | Steve Jobs | Visual design, branding |
