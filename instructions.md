# WACRM — Complete Product Guide

Welcome to **WACRM**, a unified Omnichannel CRM built to help businesses manage all customer conversations, automate complex workflows, track sales pipelines, and measure campaign ROI — all from a single workspace. This guide covers every feature in the product in full detail.

---

## Roles & Permissions

WACRM uses a three-tier role system. Every user in the workspace has exactly one role, which controls what they can see and do.

| Role | What They Can Do |
|---|---|
| **Owner** | Full access to everything. Manages billing, team, and all settings. Only one Owner per workspace. |
| **Team Leader** | Full operational access: can invite members, manage pipelines, view all conversations, and run broadcasts. Cannot change Owner-level settings. |
| **Team Member** | Can view and reply to assigned conversations, manage their own tasks, and create deals. Cannot access Settings or Broadcasts. |

> Team Leaders and Owners can always see all conversations regardless of assignment. Team Members only see their own assigned conversations.

---

## 1. Inbox (Omnichannel Messaging)

The **Inbox** is the operational core of the CRM. All inbound customer messages from every connected channel are unified here into a single threaded interface.

### Supported Channels
- **WhatsApp** (via WhatsApp Cloud API)
- **Instagram Direct Messaging**
- **Facebook Messenger**

Each conversation displays a coloured channel badge so your team can instantly identify the source: WhatsApp = emerald green, Instagram = pink/purple, Facebook = blue.

### Smart Auto-Profiling
When a new customer messages you on Instagram or Facebook for the first time, WACRM automatically fetches and stores their:
- Profile picture
- Display name
- `@username`

No manual data entry is ever needed for social contacts.

### Conversation Management
- **Assign** conversations to specific Team Members from the sidebar.
- **Status Lifecycle**: Open → Pending → Resolved. Filter conversations by status from the sidebar.
- **Internal Notes**: Send private notes visible only to your team inside the same thread. Toggle the "Internal Note" mode in the composer.
- **Reply Quoting**: Long-press or click the reply icon on any message to quote it in your response, just like WhatsApp native.
- **Media Sending**: Send images, videos, documents, and voice recordings directly from the composer.

### Session Management (WhatsApp Only)
WhatsApp enforces a **24-hour messaging window**. Once a customer's session expires, you cannot send free-form messages. The composer will lock and prompt you to use a pre-approved WhatsApp Template to re-open the window.

### AI Co-Pilot (Draft with AI)
Click the ✨ **Sparkles** button in the message composer to have the AI read the last 10–15 messages and generate a professional draft reply for you. Review it, edit it if needed, and hit Send. Powered by your configured AI Provider (OpenAI or OpenRouter).

### Agent Collision Prevention
If two Team Members open the same conversation at the same time, a **live warning banner** appears at the top of the thread for both agents, showing the name of the other person who is currently viewing or typing. This prevents duplicate replies and confusing customer experiences.

### Canned Responses (Macros)
Type `/` in the message composer to instantly search and insert pre-saved reply templates. Saves your team from typing the same responses repeatedly.

### Contact Sidebar
The right-hand panel in the Inbox gives you full customer context without leaving the chat:
- View and edit contact details (name, phone, email, company).
- See all open Deals linked to the contact.
- View and create Action Items (tasks) for the conversation.
- See the contact's tags and custom fields.

---

## 2. Contact Management

The **Contacts** section is your master database of all leads and customers.

### Contact Profiles
Every contact stores:
- Phone number (deduplicated and normalized — no duplicates for the same phone)
- Email address
- Company name
- Social handles: Instagram username, Facebook PSID
- Avatar / profile picture
- Custom Fields (defined by you)
- Tags
- Notes
- Linked Deals
- Full conversation history

### Global Search — `Cmd + K`
Press `Cmd + K` (Mac) or `Ctrl + K` (Windows) from **anywhere** in the app to open the Global Command Palette. Search across:
- Contacts (by name or phone)
- Deals (by title or value)
- Action Items (by title)
- Navigate directly to any page (Inbox, Dashboard, Settings, etc.)

### Tags & Custom Fields
- **Tags**: Label contacts with coloured tags (e.g., "Hot Lead", "VIP", "Supplier") for filtering and automation targeting.
- **Custom Fields**: Create your own data fields to store business-specific information (e.g., "Industry", "Budget", "Subscription Tier").

### Notes
Leave rich internal notes on any contact profile. Notes are timestamped and attributed to the Team Member who wrote them, making it easy to share context across the team.

### Contact Merging (Omnichannel Deduplication)
If a customer has contacted you from multiple channels (e.g., WhatsApp and Instagram), they may appear as two separate contacts. The **Merge Contact** feature allows you to fuse them into one unified profile.

**How to use:**
1. Open a Contact's detail view.
2. Click the `⋮` dropdown next to the **Message** button.
3. Select **Merge Contact**.
4. Search for the duplicate contact by name, phone, or email.
5. Select the duplicate (the "loser"). The contact you started from is the "survivor" — all data will be moved into them.
6. Confirm the irreversible merge.

**What gets merged:**
- All past conversations and messages
- All linked Deals
- All Action Items and Notes
- Tags and Custom Field values
- Social profile identifiers (Instagram ID, Facebook PSID)

> ⚠️ **Warning:** Merging is permanent and irreversible. The loser contact is deleted after the merge. Only Team Leaders and Owners can perform this action.

---

## 3. Sales Pipelines

The **Pipelines** module gives your team a visual, drag-and-drop board to manage your entire sales process.

### Kanban Board
Each pipeline is displayed as a Kanban board with columns representing stages (e.g., Lead → Qualified → Proposal → Won/Lost). Drag deals between columns to update their stage instantly.

### Pipeline & Stage Configuration
- Create multiple pipelines for different products or sales motions.
- Add, rename, reorder, and colour-code stages to match your exact sales process.

### Deal Cards
Each deal card shows:
- Deal title and associated contact
- Deal value and currency
- Probability of closing
- Current stage
- Linked broadcast campaign (if attributed)

### Broadcast Attribution
When a deal is created for a contact who recently received a broadcast campaign, the CRM **automatically attributes** that deal to the campaign. This means every broadcast's detail page shows a direct **Pipeline ROI** figure — exactly how much revenue the campaign generated.

---

## 4. Planner & Action Items

Keep your team accountable with a structured task and goal management system.

### Personal Planner
Each Team Member has their own **Planner** view with:
- **Goals**: High-level objectives for the day, week, or month.
- **Tasks**: Sub-tasks nested under each goal.
- **Progress Bars**: Visual completion tracking per goal.
- **Hours Tracking**: Log estimated and actual hours per task.

### Team Planner (Team Leaders & Owners)
A consolidated view showing every team member's goals and tasks in one place. Expand each person's card to see their workload, completion rate, and hours.

### SLA Monitoring
Set a **due date** on any Action Item. The CRM monitors these deadlines and flags overdue tasks with a red indicator. Team Members receive alerts, ensuring no follow-up ever falls through the cracks.

### Action Items from Inbox
Create Action Items directly from the Inbox sidebar while viewing a conversation, so tasks are always linked to the correct contact and deal context.

---

## 5. Flows (Visual Bot Builder)

**Flows** is a drag-and-drop visual builder for creating automated chatbot interactions.

### Triggers
| Trigger | Description |
|---|---|
| **First Inbound Message** | Fire when a brand-new contact messages for the first time. |
| **Keyword Match** | Fire when a message contains a specific keyword or phrase. |

### Node Types
| Node | What It Does |
|---|---|
| **Send Message** | Send a plain text message to the customer. |
| **Send Media** | Send an image, video, document, or audio file. |
| **Interactive Buttons** | Present up to 3 clickable button choices. |
| **Interactive List** | Present a scrollable list of menu options. |
| **Collect Input** | Pause and wait for the customer's next message. |
| **Condition** | Branch the flow based on the customer's input. |
| **AI Reply** | Generate a dynamic AI response (optionally from your Knowledge Base). |
| **Add Tag** | Automatically tag the contact. |
| **Assign Agent** | Route the conversation to a specific Team Member. |
| **Handoff** | Transfer control back to a human agent and stop the bot. |
| **Wait / Delay** | Pause the flow for a defined period before continuing. |

### Flow Management
- Flows can be set to **Active** or **Draft** mode.
- Only one flow can be active per trigger type at a time.
- Flow execution history (run logs) is stored per contact.

---

## 6. Automations

**Automations** run silently in the background, executing business logic whenever specific events occur — no manual intervention needed.

### Triggers
- **New Contact Created** — when a new contact is added to the CRM.
- **Tag Added** — when a specific tag is applied to a contact.
- **Conversation Assigned** — when a conversation is assigned to a team member.
- **Keyword Match** — when an inbound message matches a keyword.

### Actions
- Send a WhatsApp Template message
- Assign a conversation to a Team Member
- Add or remove a tag on a contact
- Send a Webhook to an external system
- Create an Action Item / task
- Wait (delay execution for a set time)

### Automation Logs
Every automation execution is logged. You can review logs to confirm that automations fired correctly and to debug any failures.

---

## 7. Knowledge Bases (AI-Powered)

**Knowledge Bases** let you feed your own business documents into the CRM's AI engine, enabling accurate, context-specific automated answers.

### How It Works
1. Upload PDF, TXT, or DOCX documents (FAQs, product manuals, policies).
2. The CRM chunks and embeds the documents using your configured AI provider.
3. The **AI Reply** node in Flows can query the Knowledge Base to answer customer questions using RAG (Retrieval-Augmented Generation).

### Use Cases
- Automatically answer product FAQs 24/7 without human intervention.
- Let the AI reference your return policy or pricing document to answer customer queries.
- Reduce support load by handling repetitive questions at scale.

---

## 8. Broadcasts

The **Broadcasts** tool lets you send bulk proactive messages to your customer base using pre-approved WhatsApp Templates.

### Creating a Broadcast
1. Select a WhatsApp Template (must be pre-approved by Meta).
2. Define your audience — all contacts, or filtered by tag.
3. Schedule immediately or for a later time.
4. Launch. The CRM sends messages individually to each recipient.

### Analytics Dashboard
Each broadcast's detail page shows a real-time funnel:
| Metric | Description |
|---|---|
| **Sent** | Total messages dispatched |
| **Delivered** | Confirmed delivered to device |
| **Read** | Customer opened the message |
| **Replied** | Customer replied |
| **Deals Created** | Number of deals attributed to this campaign |
| **Pipeline Value** | Total monetary value of those attributed deals |

### Broadcast Attribution Engine
WACRM tracks the `last_broadcast_id` on each contact when a broadcast is sent. If a deal is created for that contact within a reasonable timeframe, the deal is **automatically tagged** with the broadcast campaign. This gives you a direct, honest measure of campaign ROI without any manual bookkeeping.

---

## 9. Settings & Configuration

### Social Channels
Connect your Facebook Pages and Instagram Professional accounts under **Settings → Social Channels**. Once connected, all incoming DMs from those channels flow directly into the Inbox.

### WhatsApp Config
Connect your WhatsApp Business account via the Cloud API. You'll need:
- Phone Number ID
- WhatsApp Business Account ID
- Access Token from Meta Developers

### AI Providers
Configure one or more AI providers to power the AI Co-Pilot, Flow AI Reply nodes, and Knowledge Base search. Supported providers:
- **OpenAI** (GPT-4o, GPT-4o-mini)
- **OpenRouter** (Claude, Gemini, Mistral, and more)
- **Cohere** (for embeddings)
- **Sarvam AI** (for voice transcription)

The system automatically selects the best available provider based on the task (e.g., Cohere for document embeddings, OpenAI for chat completions).

### Team Members
- **Invite** new team members by email.
- Assign them a role: **Team Leader** or **Team Member**.
- View who is currently Online, Away, or Offline.
- Remove members from the workspace.

### Canned Responses
Pre-save frequently used reply templates with a short `/shortcut`. Any Team Member can instantly insert them in the Inbox composer by typing `/` and the shortcut name.

### Fields & Tags
- Define **Custom Fields** (text, number, date, dropdown) to attach structured data to contacts.
- Create and manage **Tags** for contact categorization and automation targeting.

---

## Tips for Getting Started

1. **Connect Your Channels First** — Go to Settings → Social Channels and WhatsApp to connect your accounts before doing anything else.
2. **Invite Your Team** — Add Team Leaders and Team Members under Settings → Team Members.
3. **Set Up AI** — Add your OpenAI or OpenRouter API key under Settings → AI Providers to unlock AI features.
4. **Create Your Pipeline** — Go to Pipelines and create at least one pipeline with your deal stages.
5. **Upload Knowledge Bases** — Add your FAQ and product docs so the AI can answer customer questions automatically.
6. **Build a Welcome Flow** — Create a Flow triggered on "First Inbound Message" to greet new contacts automatically.
7. **Write Canned Responses** — Save your top 10 most-used replies as macros to save your team hours every week.
8. **Use Global Search** — Press `Cmd + K` anytime to find any contact, deal, or task instantly.
