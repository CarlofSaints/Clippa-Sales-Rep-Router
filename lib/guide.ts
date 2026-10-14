/**
 * The user guide, as structured content rather than markup.
 *
 * Kept as data so that one renderer draws it on screen and the same content
 * prints to PDF without a second copy drifting out of step with the first. A
 * guide that describes an older version of the app is worse than no guide, so
 * there is deliberately only one place to edit.
 *
 * Screenshots are referenced by SLOT, not by URL. A slot whose image has not
 * been dropped in yet renders as a labelled placeholder saying what to capture,
 * so a missing picture is visible rather than silent.
 */

export type Block =
  | { kind: "lead"; text: string }
  | { kind: "text"; text: string }
  | { kind: "steps"; items: { do: string; detail?: string }[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "note"; tone: "info" | "warn" | "danger" | "good"; title: string; text: string }
  | { kind: "table"; head: string[]; rows: string[][]; caption?: string }
  | { kind: "shot"; slot: string; caption: string; capture: string }
  | { kind: "diagram"; id: "flow" | "model" | "doors" | "cycle"; caption: string }
  | { kind: "where"; path: string; text: string };

export interface GuideSection {
  id: string;
  number: string;
  title: string;
  blurb: string;
  /** SVG path, drawn beside the heading and in the contents. */
  icon: string;
  blocks: Block[];
}

export const GUIDE_VERSION = "1.2";

export const GUIDE: GuideSection[] = [
  // ─────────────────────────────────────────────────────────────────────
  {
    id: "overview",
    number: "1",
    title: "How it all fits together",
    blurb: "The one rule that explains everything else",
    icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    blocks: [
      {
        kind: "lead",
        text: "The Rep Router turns your store list into a four-week call cycle for every rep: which stores they visit, on which day of which week, and in what order, so the driving between them is as short as it can be.",
      },
      { kind: "diagram", id: "model", caption: "What the system is made of, and what depends on what" },
      {
        kind: "note",
        tone: "info",
        title: "A store belongs to a rep because of the rep code on the store",
        text: "There is no separate screen where you assign stores to reps. Each store record carries a REPRESENTATIVE ID, and that code is the allocation. Change the code on the store and the store moves to that rep. This is the single most important thing to understand about the system, because it explains where allocations come from and why a rep with no matching code has an empty round.",
      },
      {
        kind: "text",
        text: "Everything else follows from four sets of records. Channels say how often a type of store should be visited and for how long. Reps are the people. Stores are the outlets, each carrying its rep code, its channel and its coordinates. Teams group reps under a manager. Once those four are right, generating routes is a single click.",
      },
      { kind: "diagram", id: "flow", caption: "The order to do things in, first time through" },
      {
        kind: "note",
        tone: "warn",
        title: "Routes are a snapshot, not a live view",
        text: "When you generate routes, the plan is saved. It does not update itself. Fix a coordinate, add a rep, change a channel frequency, and the Routes page, the Map and the Rep Capacity page all still show the old plan until you generate again. Whenever you change data, finish by regenerating.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "channels",
    number: "2",
    title: "Channels: how often, and for how long",
    blurb: "The call rules every store inherits",
    icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
    blocks: [
      {
        kind: "lead",
        text: "A channel is a type of outlet: Spar, Pick n Pay, Engen, Independent. Each channel carries two numbers that drive the entire plan: how often a store of that type is visited, and how many minutes a visit takes.",
      },
      { kind: "where", path: "Control Centre → Channels", text: "where the rules live" },
      {
        kind: "table",
        head: ["Frequency", "Visits in a four-week cycle", "Typical use"],
        rows: [
          ["Daily", "20", "A key account with a permanent presence"],
          ["3x weekly", "12", "Very high volume"],
          ["2x weekly", "8", "High volume"],
          ["Weekly", "4", "Major supermarkets"],
          ["3x monthly", "3", "Above average"],
          ["2x monthly", "2", "Regular trade"],
          ["Monthly", "1", "The default: standard call"],
          ["Bi-monthly", "Every second cycle", "Low volume"],
          ["Quarterly", "Every third cycle", "Minimal"],
        ],
        caption: "Frequencies available, and what each means over a four-week cycle",
      },
      {
        kind: "steps",
        items: [
          { do: "Open Control Centre → Channels", detail: "Every channel currently in the system is listed with its frequency and visit length." },
          { do: "Set the frequency and duration for each channel", detail: "You can edit them in the grid, or use Import Excel to set many at once." },
          { do: "Click Apply defaults to stores", detail: "This is the step people miss. Editing a channel changes the RULE. It does not change the stores until you apply it." },
          { do: "Read the preview before confirming", detail: "It tells you exactly how many stores will change and what they will change to." },
        ],
      },
      {
        kind: "shot",
        slot: "channels-grid",
        caption: "The Channels page, with frequency and duration per channel",
        capture: "Control Centre → Channels, full page, showing the grid and the Apply defaults button",
      },
      {
        kind: "note",
        tone: "danger",
        title: "Check the total workload before you apply defaults",
        text: "Applying channel defaults rewrites every store in one go, and the effect compounds. A channel set to weekly with a 90-minute visit means 6 hours a month for every single store of that type. Multiply that across a rep's whole round and it can easily exceed the hours in their month. Before applying, look at Rep Capacity and ask whether the resulting workload is one a person could actually do. If it is not, the frequencies need revisiting with the client rather than loading them anyway.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Overriding a single store",
        text: "If one particular store genuinely needs a different rhythm from the rest of its channel, use Call Overrides. Pick the channel, search for the store, set its frequency and visit length, then Save override. A manager's change is approved straight away; anyone else's waits for a manager to Approve it. A store with an approved override keeps its own values and is left alone when channel defaults are applied. Reset to channel default puts it back.",
      },
      {
        kind: "text",
        text: "Not every channel is one reps visit. Some retailers order automatically and nobody calls on them. The Called on? switch on each channel says which.",
      },
      {
        kind: "table",
        head: ["Called on?", "What happens to the channel's open stores"],
        rows: [
          ["Reps call here (green)", "They are planned into call cycles as normal"],
          ["Not a rep channel (grey)", "They leave every call cycle, and Rep Capacity, Not in a Cycle and Data Health stop counting them"],
        ],
      },
      {
        kind: "steps",
        items: [
          { do: "Check the Stores column first", detail: "It counts the open stores in the channel, so you can see the size of the change before you make it." },
          { do: "Click the switch", detail: "Switching a channel off asks you to confirm and tells you how many stores will leave the cycles. Switching it back on happens straight away." },
          { do: "Regenerate routes", detail: "Nothing reaches a rep until you do." },
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "Sub-channels: when only some formats of a retailer are called on",
        text: "A sub-channel sits under a channel, for example the liquor format of a supermarket chain. Its own Called on? setting beats the channel's in either direction, so one format can be visited while another is not. Use Add sub-channels from IMS to bring in the ones IMS already uses; that also files the stores under them by Place ID. A new sub-channel follows its channel until you set it either way. Sub-channels do not carry a frequency or a visit length: those still come from the channel or from a Call Override.",
      },
      {
        kind: "note",
        tone: "info",
        title: "New channels from IMS",
        text: "Add channels from IMS lists every channel IMS holds that this system does not, and warns you when one looks like a different spelling of a channel you already have, because creating it would split the same shops across two channels. New channels arrive as once a month, 30 minutes, and called on. The Came from column records where each channel originally came from.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Who may change channels and teams",
        text: "Super Admins, Admins and Team Admins can change channels, sub-channels, teams, Store Upload and Duplicate Stores. Team Managers cannot. The buttons still show for everyone, but a save from a role that is not allowed is refused with a message saying so.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "reps",
    number: "3",
    title: "Reps: loading the people",
    blurb: "Codes, names and email addresses",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    blocks: [
      {
        kind: "lead",
        text: "A rep record needs very little: a rep code and a name. The code is what matters, because it is what ties stores to that person.",
      },
      { kind: "where", path: "Reps", text: "the rep list, with import and export" },
      {
        kind: "steps",
        items: [
          { do: "Open the Reps page and click Import Excel", detail: "Your file needs a rep code column. Name and email are optional but worth including." },
          { do: "Read the preview", detail: "It shows how many reps will be created, how many updated, and anything it could not use. Nothing is saved yet." },
          { do: "Click Apply these changes", detail: "Only now is anything written." },
        ],
      },
      {
        kind: "table",
        head: ["Column in your file", "What it does"],
        rows: [
          ["REPCODE or Rep Code", "Required. Matches the rep to their stores."],
          ["REPNAME or Rep Name", "Display name. See the note below about spellings."],
          ["REPEMAILADDRESS or Email", "Needed only if the rep will have their own login."],
          ["Cell Number", "Optional contact detail."],
          ["Home Address", "Optional. See section 8."],
          ["Hours/Day", "Optional. Defaults to 8.5 hours."],
        ],
      },
      {
        kind: "note",
        tone: "good",
        title: "The import will not quietly wipe anything",
        text: "A column your file does not contain is left alone on every rep. A cell that is present but blank is also left alone. So a cut-down file of just codes and email addresses is safe to send: it fills in the emails and touches nothing else. Names are a deliberate exception. If a name in your file differs from the one on record, it is reported to you rather than overwritten, because a changed name on the same code can mean the code was given to somebody new.",
      },
      {
        kind: "shot",
        slot: "reps-import",
        caption: "The import preview, before anything is saved",
        capture: "Reps page after choosing a file: the preview panel showing created, updated and unchanged counts",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Reps also appear by themselves",
        text: "When you upload stores, any rep code the system has not seen before is created automatically with a blank name and no email. That keeps the store allocation intact, but it means the rep list can fill up with codes rather than people. The Data Health page lists reps with no stores and reps with no email so you can tidy them up.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Codes that are not people: Rep Codes",
        text: "The sales data carries codes that are not reps at all: third-party agents, other businesses and house accounts. Control Centre → Rep Codes is where you say so. Mark a single code Not a rep, or add a Starts with rule that covers a whole family of codes at once. A code marked not a rep stops counting as missed coverage, is never turned into a rep record, and Store Upload will not give it stores. It does not change any route, and stores already on that code stay where they are.",
      },
      {
        kind: "text",
        text: "The filter box at the top of the Reps page searches name, code, email, cell and address. Press Esc to clear it.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "stores",
    number: "4",
    title: "Stores: loading the outlets",
    blurb: "Two different doors, and why it matters which you use",
    icon: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z",
    blocks: [
      {
        kind: "lead",
        text: "Stores can be loaded two ways, and they behave differently. Choosing the wrong one is the easiest way to lose data in this system, so it is worth understanding the difference before you upload anything.",
      },
      {
        kind: "table",
        head: ["", "Store Upload", "Import Excel on the Stores page"],
        rows: [
          ["Where", "Control Centre → Store Upload", "Stores → Import Excel"],
          ["Use it for", "The full picture: new stores, their reps, their channels", "Correcting stores that already exist"],
          ["Adds new stores", "Yes", "No, it reports them instead"],
          ["Touches rep allocation", "Yes, when the file has a rep column", "No, never"],
          ["Touches monthly average", "Yes, when the file has a sales column", "No, never"],
          ["Overwrites the store name", "Yes, always", "Only if the file has a name column"],
          ["Best for a coordinates-only fix", "No", "Yes"],
        ],
      },
      { kind: "diagram", id: "doors", caption: "Two ways in, and what each one overwrites" },
      {
        kind: "note",
        tone: "warn",
        title: "Fix existing stores through Import Excel, not Store Upload",
        text: "Store Upload now leaves alone any column your file does not carry, and a blank rep, channel or GPS cell is left alone too. Two things still write over what you have. A blank cell in a sales column is saved as zero. And the store name is always overwritten from the file. When you only want to fix details such as coordinates, Import Excel on the Stores page is still the safe door. Note that Import Excel works the other way round on blanks: a column you keep but leave blank clears that field.",
      },
      {
        kind: "note",
        tone: "danger",
        title: "Replace the allocation for the reps in this file",
        text: "Store Upload has a tick box that turns the file into the complete list of stores for every rep code it contains. Their other stores are un-assigned, not deleted, and reps who are not in the file are not touched. Because it removes stores from reps, it always shows a preview first: which reps are in the file and every store that would be un-assigned. Nothing is saved until you press Apply to stores. A file with no rep column is refused in this mode.",
      },
      {
        kind: "note",
        tone: "info",
        title: "When IMS owns the allocation, uploads cannot move stores",
        text: "If IMS has been made the source of the store-to-rep allocation (section 6), Store Upload cannot change the rep on an existing store. Editing the rep by hand on the Stores page still works.",
      },
      {
        kind: "steps",
        items: [
          { do: "First load, or adding new stores: Control Centre → Store Upload", detail: "It accepts your own column headings or a Repsly Places export." },
          { do: "Fixing existing stores: Stores → Export Excel", detail: "Edit what needs correcting in the file." },
          { do: "Then Stores → Import Excel", detail: "It matches on Place ID, updates only the columns your file carries, and reports any Place ID it does not recognise rather than creating it." },
        ],
      },
      {
        kind: "shot",
        slot: "store-upload",
        caption: "Store Upload, for the full picture",
        capture: "Control Centre → Store Upload, showing the file chooser and the notes about column names",
      },
      {
        kind: "note",
        tone: "warn",
        title: "If you upload a Repsly Places export, check the tag order",
        text: "A Repsly export carries a Tags column such as INDEPENDENT','GAUTENG. The system takes the FIRST tag as the channel. If a store's tags happen to start with the province instead, that store ends up with a province as its channel, which means it inherits no call frequency at all. The Data Health page reports these under stores with a missing or unknown channel.",
      },
      {
        kind: "text",
        text: "The Stores grid shows each store as the router sees it and as IMS sees it. Every column sorts, and you can drag a column edge to widen it.",
      },
      {
        kind: "table",
        head: ["Column", "What it tells you"],
        rows: [
          ["Status", "Active or Closed. A closed store is in no call cycle. Change it with Edit; a change made by hand is never undone by IMS."],
          ["Map Status", "How the store matches IMS: Matched, Matched with missing data, In RR only, In IMS only, or In IMS with no rep. Chips flag No sales, Dormant, Duplicate account, Rep mismatch and Closed in IMS. Needs an IMS snapshot."],
          ["RR Rep", "The rep the router plans this store for. Editable."],
          ["IMS Rep", "The rep IMS bills it through. Read-only, and amber when the two disagree."],
          ["Sub-channel", "Blank means the store follows its channel."],
          ["Avg Monthly Sales, 6-Month Sales", "From IMS."],
          ["Rank Overall, Rank/Rep, Rank/Channel", "Where the store stands by sales. A store with no sales figure is not ranked."],
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "Outlets IMS has that the router does not",
        text: "Tick Show IMS-only outlets to add them to the grid as blue, italic, read-only rows. They are outlets nobody is routed to. Export Excel then includes a sheet called IMS-only outlets with a column saying what is wrong with each one. The fix is made in IMS, and the next snapshot picks the outlet up.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "allocation",
    number: "5",
    title: "Allocating stores to reps",
    blurb: "Where allocation actually happens",
    icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
    blocks: [
      {
        kind: "lead",
        text: "There is no allocation screen, because allocation is not a separate thing. The REPRESENTATIVE ID on the store record is the allocation.",
      },
      {
        kind: "steps",
        items: [
          { do: "In bulk: put the rep code in your store file", detail: "Through Store Upload, the REPRESENTATIVE ID column sets who each store belongs to." },
          { do: "One store at a time: edit it on the Stores page", detail: "Change the RR Rep on the row and it moves immediately." },
          { do: "Confirm the result on Store Coverage", detail: "It tells you how much of the store base can actually be routed." },
        ],
      },
      { kind: "where", path: "Control Centre → Store Coverage", text: "who owns what, and what nobody owns" },
      {
        kind: "note",
        tone: "danger",
        title: "A rep code that matches nobody makes stores disappear",
        text: "Nothing checks the rep code on a store against the rep list. If a store names a rep who was never loaded, that store is dropped from the map, from every route and from all capacity figures, and no planning screen says so. Two places tell you. Store Coverage lists every rep code that has stores but no rep record, with the stores behind it. Data Health raises the same thing as a blocking issue called Stores allocated to a rep who does not exist, and that one exports to Excel so you can work through it.",
      },
      {
        kind: "steps",
        items: [
          { do: "Decide what the code actually is", detail: "A person who was never loaded, a branch or house account that is not a person at all, or a typo on the stores." },
          { do: "If it is a person, add them on the Reps page", detail: "Add the rep with that exact code and every store carrying it attaches itself immediately. Nothing else is needed." },
          { do: "If it is a typo, fix the rep code on the stores", detail: "Edit the rep on each row on the Stores page. Editing by hand always works, even when IMS has been made the source, because a person deciding outranks a spreadsheet." },
          { do: "If the account is closed, close the stores instead", detail: "Do not invent a rep for it. Use Closed stores on IMS Reconciliation and they leave the call cycles without pretending to belong to anybody." },
          { do: "Regenerate routes", detail: "Nothing you fix here reaches a rep until the plan is generated again." },
        ],
      },
      {
        kind: "shot",
        slot: "coverage",
        caption: "Store Coverage: what can be planned, and what is stranded",
        capture: "Control Centre → Store Coverage, showing the stat cards and the table of missing rep codes",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "ims",
    number: "6",
    title: "IMS: checking the router against the invoicing system",
    blurb: "Who really owns a store, what is selling, and what has closed",
    icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
    blocks: [
      {
        kind: "lead",
        text: "The Rep Router knows who is supposed to visit a store. Clippa's invoicing system, IMS, knows who actually bills it and what it has bought. Reconciliation puts the two side by side, and it is the fastest way to find stores nobody visits, reps who have lost their round, and shops that have quietly closed.",
      },
      { kind: "where", path: "Control Centre → IMS Reconciliation", text: "everything on this page" },
      {
        kind: "note",
        tone: "info",
        title: "One button on this page talks to IMS, and it is not the obvious one",
        text: "Refresh snapshot from IMS runs three live queries against the client's SQL server, one of which is the full outlet master of roughly forty thousand rows, and saves the result. Everything else on the page reads that saved copy. Reload cached view re-reads the file and fetches nothing. Every button now carries a line underneath saying whether it touches IMS and whether it saves anything, so you never have to guess before pressing.",
      },
      {
        kind: "steps",
        items: [
          { do: "Press Refresh snapshot from IMS first", detail: "Twenty seconds when the IMS server is responsive, up to two minutes when it is busy. Nothing else on the page is trustworthy until this is current." },
          { do: "Read the four tiles", detail: "Selling, Dormant, No sales in twelve months, and Not in IMS at all. These describe the stores in the router, judged against the same six month window." },
          { do: "Deal with anything the page holds back", detail: "The page refuses to act on a stale snapshot rather than acting on the wrong picture." },
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "The snapshot is a moment in time and says so",
        text: "Every reader of the snapshot shows its age. If you upload stores, close stores or re-assign reps, the snapshot no longer matches the store list and the page will tell you the counts disagree. Refresh it again. Actions that would write something are blocked while it disagrees, on purpose, because a plan computed from an old picture moves the wrong shops.",
      },
      {
        kind: "shot",
        slot: "ims-reconciliation",
        caption: "IMS Reconciliation after a fresh snapshot",
        capture: "Control Centre → IMS Reconciliation, showing the snapshot card, the four status tiles and the stranded value panel",
      },

      {
        kind: "text",
        text: "Four actions live on this page. Each previews before it writes, and each says what it is about to do.",
      },
      {
        kind: "table",
        head: ["Action", "What it changes", "When to use it"],
        rows: [
          ["Refresh snapshot from IMS", "Nothing in your data. Rebuilds the saved copy of what IMS holds.", "First, every time, and again after any change to the store list"],
          ["Write sales to stores", "6-Month Sales and Avg Monthly Sales on every store IMS has a figure for", "After a refresh, to bring sales figures into the router"],
          ["Fill the blank fields", "Blank channel and province only, never a value already held", "When stores arrived from a file that had no channel or province column"],
          ["Close the stores", "Marks stores closed so they leave every call cycle", "When IMS says an account is shut"],
        ],
        caption: "The four IMS actions, and what each one touches",
      },

      {
        kind: "note",
        tone: "info",
        title: "Who decides which rep owns a store",
        text: "By default a Repsly Places export decides: whatever rep code the file carries is written to the store. You can hand that decision to IMS instead, on the card called Who decides which rep owns a store. Switching to IMS does two things, and the second is the one that makes it stick: it offers to move stores onto the rep IMS bills them through, and it stops any future upload from overwriting a rep code. Without that second half, an IMS allocation survives only until somebody loads a spreadsheet.",
      },
      {
        kind: "note",
        tone: "danger",
        title: "IMS is not obeyed blindly, and the held-back number is the reason",
        text: "IMS parks stores on codes that are not people at all: branch accounts, house accounts and closed accounts. A store whose rep code matches no rep vanishes from the map, from every route and from all capacity figures, and nothing on the planning screens says so. Any store that would land on such a code is held back rather than moved, and the codes are listed by name so you can decide whether each one is a real person who needs a rep record or a house account that should be left alone.",
      },

      {
        kind: "text",
        text: "IMS reuses the rep code field to park dead accounts. A store whose IMS rep code is ACCC is a closed account, not a store belonging to a rep called ACCC, which is why those stores turn up in the held-back list. IMS also carries its own separate Closed Status field, and the two do not agree with each other.",
      },
      {
        kind: "note",
        tone: "warn",
        title: "Closing a store is reversible, and it is meant to be",
        text: "A closed store keeps its name, its rep, its coordinates and its history. It is simply dropped from route generation and from the capacity figures, so nobody is sent to a shop that is not there. If IMS later stops calling it closed, the card offers to reopen it and it returns to the call cycles. A store you closed by hand is never reopened automatically, because a person decided that and IMS does not get to overrule it.",
      },
      {
        kind: "note",
        tone: "danger",
        title: "Check anything that is closed but still buying",
        text: "The card counts stores that are marked closed yet have sales in the last six months, and lists the biggest. A shop that is still invoicing is not shut, whatever the flag says. Look at those before you trust a closure, because the cost of wrongly closing a live store is a rep who never visits it again.",
      },
      {
        kind: "shot",
        slot: "ims-closed-stores",
        caption: "Closed stores, previewed before anything is written",
        capture: "Control Centre → IMS Reconciliation, the Closed stores card after pressing Preview the change, showing the counts and the list",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "data-health",
    number: "7",
    title: "Checking the data before you plan",
    blurb: "Fourteen checks in one place",
    icon: "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z",
    blocks: [
      {
        kind: "lead",
        text: "Route quality is decided by data quality. A store with no coordinates cannot be put in a day. A store allocated to nobody cannot be planned at all. Data Health runs every check in one place and exports the lot to one spreadsheet.",
      },
      { kind: "where", path: "Control Centre → Data Health", text: "everything wrong with the data, in one place" },
      {
        kind: "table",
        head: ["Severity", "What it means", "What to do"],
        rows: [
          ["Blocking", "The record cannot appear in a route at all", "Fix before generating"],
          ["Warning", "It will be planned, but probably wrongly", "Fix when you can"],
          ["Info", "Worth knowing, nothing is broken", "Review occasionally"],
        ],
      },
      {
        kind: "bullets",
        items: [
          "Stores with no coordinates, coordinates at 0,0, or coordinates outside South Africa",
          "Stores allocated to a rep who does not exist, or to nobody at all",
          "Stores with a missing or unknown channel",
          "Stores whose call rhythm ignores their channel",
          "Stores more than the configured distance from their rep's area",
          "Duplicate store records",
          "Reps with no stores, no email, or sharing an email address",
          "Reps whose home address never became coordinates",
          "Reps whose call cycle cannot fit their hours: their stores ask for more visit time than they work, before any driving",
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "A rep whose cycle cannot fit is a frequency problem, not a routing one",
        text: "This check adds up the visit time alone, with no travel, and compares it to the rep's working hours. If even that does not fit, no route can fix it. Lower the call frequencies or visit lengths on the channels or stores, or move stores to another rep. The same problem shows as a red Calls / Day figure on Rep Sales & Activity.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Closed stores and non-rep channels are left out",
        text: "Every check runs only on stores reps actually call on. Closed stores, and stores in a channel marked not a rep channel, are counted separately at the top of the page and excluded, because a shop that is never routed cannot have a routing problem. Reopen one and it returns to the checks.",
      },
      {
        kind: "steps",
        items: [
          { do: "Open Data Health and read the blocking items first", detail: "They are sorted worst first. Everything above the warnings stops a store being planned at all." },
          { do: "Click Export all issues", detail: "You get one workbook: a contents page, then one sheet per issue with every affected record." },
          { do: "Fix, then re-run", detail: "The page recalculates every time you open it. There is nothing to refresh." },
        ],
      },
      {
        kind: "shot",
        slot: "data-health",
        caption: "Data Health, worst first",
        capture: "Control Centre → Data Health, with one issue expanded to show its rows",
      },
      {
        kind: "note",
        tone: "good",
        title: "A check that finds nothing still appears",
        text: "Clean checks are listed too, at the bottom of the page and on the contents sheet of the export. That is deliberate: if a clean check simply vanished, you could not tell the difference between a check that passed and a check that stopped running.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Fixing coordinates in bulk",
        text: "Export the Stores grid, fill in the GPS LATITUDE and GPS LONGITUDE columns in Excel, and import it back through Stores → Import Excel. Latitude and longitude must be filled in as a pair. In South Africa the latitude is always negative: a missing minus sign is the most common cause of a store plotting on the wrong continent.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "home",
    number: "8",
    title: "Where each rep starts their day",
    blurb: "Home addresses, and why they save driving",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    blocks: [
      {
        kind: "lead",
        text: "A route has to start somewhere. If the system knows where a rep lives, the day is planned outwards from their front door. If it does not, the day is planned from the middle of their stores, which usually means driving past home to get to the first call.",
      },
      {
        kind: "table",
        head: ["Starts Day At", "What it means"],
        rows: [
          ["Home, with coordinates", "The rep's real starting point is known and used"],
          ["Store centroid", "No home location on file, so the middle of their stores is used instead"],
        ],
      },
      {
        kind: "text",
        text: "There are two ways to capture it, and they are not equally good.",
      },
      {
        kind: "steps",
        items: [
          {
            do: "Typing an address, on the Reps page",
            detail: "Enter the address, then use Set Home GPS to look it up. The system only saves a result it is confident about: an exact building or a numbered point on a known street. Anything vaguer is listed for review rather than saved, because a suburb centre looks identical to a real home address once it is stored, and would quietly move the rep's whole week.",
          },
          {
            do: "The rep capturing it themselves, which is better",
            detail: "Give the rep a login. They sign in, open Account, and use the Where your day starts card. Use my current location, tapped while standing at home, records the exact spot from the phone's GPS. Drop a pin on the map works from anywhere: they click their house, drag the pin to fine-tune, and press Use this location. Either way there is nothing to look up and nothing to get wrong, which makes these the only methods that work reliably for an informal address.",
          },
        ],
      },
      {
        kind: "text",
        text: "A rep can also type their address on that card. If Google finds the exact house, it is saved. If Google only finds the area, the pin map opens on that area so they can drag the pin onto their house. If it finds nothing, they are told to drop a pin or use their location instead.",
      },
      {
        kind: "shot",
        slot: "rep-account",
        caption: "A rep setting where their day starts",
        capture: "The /account page signed in as a rep, showing the Where your day starts card with the Use my current location and Drop a pin on the map buttons",
      },
      {
        kind: "note",
        tone: "info",
        title: "Giving reps their own logins",
        text: "On the Reps page, Create login makes an account for one rep and emails them their sign-in details; Create Logins does it for every rep who has an email address and no login yet. A rep login sees My Route, Guide and Account, and nothing else. Section 14 covers what they see and what the other roles can do.",
      },
      {
        kind: "text",
        text: "Reps who have not set a home are reminded by email every Monday at 08:00. The Home address reminders panel at the top of the Reps page controls it.",
      },
      {
        kind: "table",
        head: ["Who", "What happens on Monday"],
        rows: [
          ["A rep with no usable home, an email address, a login, and a team whose manager has an email", "Emailed a reminder, and their manager is copied with a list of their team's outstanding reps"],
          ["A rep missing any of those", "Held back. The panel says why: no email address, no login yet, or no team manager"],
          ["A rep whose home is pinned", "Nothing. They are done"],
        ],
      },
      {
        kind: "steps",
        items: [
          { do: "Click Show who", detail: "Lists everyone outstanding, who will be emailed, who is held back and why." },
          { do: "Click Email me the list to preview", detail: "Sends the list to you only. No rep is contacted." },
          { do: "Fix the held-back reps", detail: "Most are held back because they are not in a team with a manager. Put them in a team and they join the next run." },
          { do: "Use Turn off to pause it", detail: "The schedule still runs and is still logged; it just sends nothing. Send reminders now sends straight away, after a confirmation." },
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Capturing a home address does not change an existing plan",
        text: "Filling in home addresses updates the rep records. The routes already saved still start wherever the old plan said. When the Starts Day At column changes from Store centroid to Home, that is the signal that regenerating is now worth doing.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "generate",
    number: "9",
    title: "Generating the routes",
    blurb: "The single click that builds the cycle",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
    blocks: [
      {
        kind: "lead",
        text: "With channels, reps and stores in place, generating the call cycle is one action. The system spreads each rep's stores across four weeks according to how often each store needs visiting, groups each week into five days by geography, then orders each day so the driving is as short as possible.",
      },
      { kind: "diagram", id: "cycle", caption: "One rep's four-week cycle: twenty working days" },
      { kind: "where", path: "Routes → Generate Routes", text: "builds the cycle for every rep, or for one" },
      {
        kind: "steps",
        items: [
          { do: "Choose the call cycle type", detail: "Geography plans every store allocated to the rep, clustered by area. Channel Dedicated plans only the channels that rep is assigned to." },
          { do: "Generate for some reps, or for all of them", detail: "Tick reps in the Reps list to rebuild only those; everyone else keeps their saved week. With nobody ticked, Generate Routes covers every rep in view. Admins can narrow the view to one team first." },
          { do: "Wait for it to finish", detail: "Do not navigate away. When it completes, the Routes page shows the new plan." },
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Only admins can change routes",
        text: "Generating, clearing and exporting routes is limited to Super Admins and Admins. Team Managers and Team Admins can read their own team's routes but not change them.",
      },
      {
        kind: "text",
        text: "By default a day is sized by the rep's working hours: it fills until the day, including the drive home, is used up. The Calls per day card on the Routes page sets a fixed number of calls a day instead.",
      },
      {
        kind: "steps",
        items: [
          { do: "Tick one or two reps in the Reps list", detail: "Leave everyone unticked and the number applies to all reps." },
          { do: "Type a number in Calls per day", detail: "The ticked reps are rebuilt on their own, in about a second, so you can see the effect. Nobody else moves." },
          { do: "Press Apply", detail: "It applies to the ticked reps, or to all reps when none are ticked, and regenerates their routes. Only applying to everyone changes the default. Clear goes back to sizing days by working hours." },
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "With a target, the calls win over the clock",
        text: "A day built to a calls-per-day target keeps all its calls even if it runs past the working day, and the Routes page says by how much it overruns. Without a target, the day stops when the hours run out.",
      },
      {
        kind: "note",
        tone: "good",
        title: "When a day is too full, the least valuable stores move first",
        text: "If a day has more stores than it can hold, the lowest-selling stores are taken off it, not whichever happen to fall last on the drive. They are then fitted onto quieter days, best-selling first. A store with no sales figure counts as typical for that rep. Anything that still does not fit is listed under the plan as stores that could not be scheduled, with the reason, and Export all puts that list in Excel.",
      },
      {
        kind: "note",
        tone: "info",
        title: "The drive home counts",
        text: "Each day's hours and kilometres include the drive back home at the end, not only the drives between calls. A day cell turns amber above 85% of the working day and red above 100%.",
      },
      {
        kind: "table",
        head: ["Call cycle type", "Which stores a rep gets"],
        rows: [
          ["Geography", "Every store carrying their rep code, grouped by area"],
          ["Channel Dedicated", "Only stores in the channels assigned to that rep"],
        ],
      },
      {
        kind: "shot",
        slot: "routes-generate",
        caption: "The Routes page, with the generate control",
        capture: "Routes page showing the call cycle type selector and the Generate Routes button",
      },
      {
        kind: "note",
        tone: "info",
        title: "Check the line under the heading after every run",
        text: "The system asks Google for real road distances, which is what makes a day's order genuinely efficient rather than merely tidy on a map. After a run, the Routes page says real road routes, all days in green when every day got one. If it says only some days have a real road route, the rest are straight-line estimates, so their distances and drive times are understated. Regenerate to fix it. Regenerating with no change to the data gives the same week every time.",
      },
      {
        kind: "note",
        tone: "danger",
        title: "Regenerate after every change",
        text: "This is the rule that catches everyone. Saved plans never update themselves. Corrected fifty coordinates? Regenerate. Added a rep? Regenerate. Changed a channel frequency and applied it? Regenerate. Until you do, the Routes page, the Map and Rep Capacity are all describing the world as it was when you last generated.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "reading",
    number: "10",
    title: "Reading the results",
    blurb: "Routes, Map and Rep Capacity",
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
    blocks: [
      {
        kind: "lead",
        text: "Three pages show you the same plan from different angles. All three read the saved plan, so all three are only as current as your last generation.",
      },
      {
        kind: "table",
        head: ["Page", "Answers"],
        rows: [
          ["Routes", "Which stores does this rep visit, on which day of which week"],
          ["Map", "What does that week actually look like on the ground"],
          ["Rep Capacity", "Is this workload realistic, and who has room for more"],
        ],
      },
      {
        kind: "text",
        text: "Rep Capacity is the one to read carefully. It adds up the visit time and the driving time in each rep's plan and compares it to the hours they actually work, then tells you who is over capacity and who has room. It is also where you confirm that a store which looks unusually far away really is part of that rep's round.",
      },
      {
        kind: "shot",
        slot: "capacity",
        caption: "Rep Capacity: scheduled hours against available hours",
        capture: "Rep Capacity page showing the table of reps with utilisation percentages",
      },
      {
        kind: "note",
        tone: "good",
        title: "Tell me why",
        text: "Every rep on Rep Capacity has a Tell me why button. It opens the sum behind their percentage: time in store plus driving, against the hours available. It compares what their stores ask for with what actually made it onto the route, because a rep can look comfortable only because visits fell off. Then it ranks the causes, each with steps to fix it: a home far from the stores, a home added after the plan, no home at all, more store visits than hours, more driving than selling, days stretched to meet a calls-per-day target, or what looks like the same store twice. A day-by-day table shows which days are over.",
      },
      {
        kind: "text",
        text: "Admins can narrow Rep Capacity, Routes, the Map and Not in a Cycle to one team, and Export Excel on Rep Capacity exports only the reps on screen.",
      },
      {
        kind: "shot",
        slot: "map",
        caption: "The Map: one rep's week, in order",
        capture: "Map page with a rep selected, showing numbered stops and the route line",
      },
      {
        kind: "table",
        head: ["On the Map", "What it means"],
        rows: [
          ["home badge beside a rep", "Their day starts and ends at their home"],
          ["centroid badge", "No usable home, so the day starts from the middle of their stores"],
          ["centroid with a warning", "A home was added after the routes were generated. Regenerate to use it"],
          ["8/day or no target badge", "The calls-per-day target their week was built on"],
          ["Solid line", "A real road route"],
          ["Dashed line", "Call order only; no road route was saved for that day"],
          ["Stores not in the cycle", "Shows every store that is not visited, coloured by the reason"],
        ],
      },
      {
        kind: "text",
        text: "Click any store for its card: channel, rep, average monthly and six-month sales, and its rank overall and within the rep's stores, for example 34th of 101. Stops on a route also show arrival, departure and visit time.",
      },
      {
        kind: "note",
        tone: "info",
        title: "Stores that look wrongly placed",
        text: "A store a long way from the rest of a rep's round is flagged rather than silently planned. If it is a genuine outlying call, use Confirm in cycle and it stops being reported. If it is not, either the store belongs to a different rep or its coordinates are wrong. A store whose coordinates put it outside South Africa is never treated as an outlier: it is reported as having no usable coordinates, because the fix is to correct it, not confirm it.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "not-in-cycle",
    number: "11",
    title: "Stores nobody visits",
    blurb: "Not in a Cycle, and fixing coordinates where you find them",
    icon: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636",
    blocks: [
      {
        kind: "lead",
        text: "Not in a Cycle lists every open store that could be visited and is not in anyone's route, with how much it sells and why it was left out. It is sorted by sales, so the most valuable gaps come first.",
      },
      { kind: "where", path: "Not in a Cycle", text: "every store the current plan misses" },
      {
        kind: "table",
        head: ["Why not in a cycle", "What to do"],
        rows: [
          ["Over the calls-per-day target", "Raise the target, or move the store to another rep"],
          ["Over the working day", "The day ran out of hours before this store was reached. Lighten the rep's round"],
          ["Too far outside the rep's area", "Confirm it on the Routes page to force it into the cycle, or move it to a nearer rep"],
          ["No usable coordinates", "Enter them in the row, then regenerate"],
          ["Loaded after these routes were generated", "Regenerate routes"],
          ["In a channel nobody calls on", "Nothing. It is correctly out"],
          ["Closed", "Nothing. It is correctly out"],
        ],
      },
      {
        kind: "text",
        text: "Filter by rep, channel, reason or open and closed, or search by name, ID or rep code. The Map shows the same stores with Stores not in the cycle switched on.",
      },
      {
        kind: "note",
        tone: "good",
        title: "Fixing a coordinate where you find it",
        text: "Rows with no usable coordinates, here and in the could-not-be-scheduled list on the Routes page, carry their own entry boxes. Type or paste the latitude and longitude, or press Drop a pin and click the store's spot on a map that also shows the rep's other stores. The boxes catch the usual mistakes: the two numbers the wrong way round (with a button to swap them), 0,0, and anything outside South Africa. Save GPS, then regenerate routes to bring the store in.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "sales",
    number: "12",
    title: "Rep sales, activity and commission",
    blurb: "What each rep's book is worth, and what it earns",
    icon: "M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
    blocks: [
      {
        kind: "lead",
        text: "Rep Sales & Activity puts each rep's stores, calls and IMS sales in one row, and shows what they would earn in commission, today and under a new call cycle.",
      },
      { kind: "where", path: "Rep Sales & Activity", text: "one row per rep" },
      {
        kind: "table",
        head: ["Column", "What it tells you"],
        rows: [
          ["Stores (Repsly)", "Stores the router allocates to the rep"],
          ["Stores (IMS)", "Outlets IMS bills through the rep. A blue (12 unrouted) means 12 of those are not in the router at all; click it to see them on the Stores page"],
          ["Calls / Month, Week, Day", "The visits their stores ask for. Calls / Day in red is more than a working day holds, and the store frequencies, not the routes, are the cause"],
          ["Portfolio / Month", "Their IMS sales. A grey number in brackets counts stores with no IMS figure"],
          ["Potential Earning", "Commission on that portfolio, using the rules on the Commission page"],
          ["New Cycle columns", "The same figures for the plan chosen in the New cycle filter"],
        ],
      },
      {
        kind: "text",
        text: "Filter by team, by whether the rep earns commission, or by coverage problems such as reps with unrouted IMS outlets. Reading this table, at the bottom of the page, explains every marker.",
      },
      { kind: "where", path: "Control Centre → Commission", text: "the rate and threshold, Super Admins and Admins only" },
      {
        kind: "table",
        head: ["How the threshold works", "What a rep earns"],
        rows: [
          ["Reach the threshold, then earn on the whole portfolio (the default)", "Nothing below the threshold. At or above it, the rate applies to everything"],
          ["Earn only on the amount above the threshold", "The rate applies only to the part above the threshold"],
        ],
      },
      {
        kind: "note",
        tone: "warn",
        title: "Earnings are only as complete as the IMS match",
        text: "Portfolio revenue comes from IMS, so a store that does not match an IMS outlet adds nothing to a rep's portfolio. The Commission page shows what share of the store base currently matches. Use the Worked example box there to check a figure before quoting it to a rep.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "repsly",
    number: "13",
    title: "Sending the cycle to Repsly",
    blurb: "Turning the plan into repeating schedules",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    blocks: [
      {
        kind: "lead",
        text: "The plan is a repeating four-week cycle, and the export hands it to Repsly that way. Each visit becomes one schedule row with a first date that repeats every four weeks with no end date, so the cycle never needs re-exporting just because the calendar moved on. A store visited weekly appears on four rows, one per week of the cycle.",
      },
      { kind: "where", path: "Routes → Repsly, week 1 starts", text: "admins only" },
      {
        kind: "steps",
        items: [
          { do: "Generate routes first", detail: "The export reads the saved plan for the call cycle type selected, so it can only export what has been generated." },
          { do: "Pick the Monday that week 1 starts", detail: "It defaults to next Monday. Any other day you pick moves to the Monday after it." },
          { do: "Click Export all, or Export rep while viewing one rep", detail: "You get one Excel file with four sheets." },
          { do: "Read the Read me sheet, then import only the Repsly Import sheet", detail: "In Repsly: Schedules → Import." },
        ],
      },
      {
        kind: "table",
        head: ["Sheet", "What it is for"],
        rows: [
          ["Repsly Import", "The only sheet you upload: Representative ID, Place ID, From Date, Repeat every (x) week, Time, Duration"],
          ["Check", "The same visits in a readable form: rep name, cycle week, day, stop and store name"],
          ["Not in cycle", "Stores that lost some or all of their visits, and why"],
          ["Read me", "The import steps"],
        ],
      },
      {
        kind: "note",
        tone: "danger",
        title: "End the existing schedules in Repsly first",
        text: "Importing adds schedules; it does not replace them. End or delete the reps' current schedules in Repsly before importing, or every visit is doubled. Every Representative ID and Place ID must already exist in Repsly. Try one rep before importing everyone.",
      },
      {
        kind: "note",
        tone: "info",
        title: "The Repsly page reads from Repsly, it never writes",
        text: "Control Centre → Repsly holds the API connection. Test Connection checks the key and passcode. Each row under Sync Controls has Test, which shows what would be fetched, and Import, which saves it: visits, clients, working time, reps, and Repsly's own call cycles, for comparing what Repsly has scheduled against this plan.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "logins",
    number: "14",
    title: "Logins, roles and what reps see",
    blurb: "Who can do what, and the rep's own screen",
    icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
    blocks: [
      {
        kind: "lead",
        text: "Every login has a role, and the role decides what that person can see and change. A rep sees only their own route. A manager sees only their own team.",
      },
      {
        kind: "table",
        head: ["Role", "Sees", "Can change"],
        rows: [
          ["Super Admin", "Everything", "Everything, including users and other Super Admins"],
          ["Admin", "Everything", "Everything except users: reps, stores, channels, teams, uploads, routes, commission"],
          ["Team Admin", "Their own team's routes", "Stores, store overrides, call cycle types, settings, channels, sub-channels, teams, Store Upload and Duplicate Stores. Not routes"],
          ["Team Manager", "Their own team's routes", "Stores, store overrides, call cycle types and settings. Not routes"],
          ["Viewer", "Dashboards and reports, but no one's routes", "Nothing"],
          ["Rep", "My Route, Guide and Account only", "Their own profile and home"],
        ],
        caption: "A Team Admin or Team Manager with no team linked to them sees no routes at all",
      },
      {
        kind: "note",
        tone: "warn",
        title: "A role change needs a fresh sign-in",
        text: "A person's role is read when they sign in. After promoting or changing someone, ask them to sign out and back in before it takes effect.",
      },
      { kind: "where", path: "User Admin", text: "Super Admins only: add users, set roles, send welcome emails" },
      {
        kind: "text",
        text: "Reps get their logins from the Reps page (section 8). Everyone else is added in User Admin with + Add User. Each row there can force a password change at next sign-in, send a welcome email with a temporary password, or, for a Super Admin, set the password directly.",
      },
      {
        kind: "note",
        tone: "good",
        title: "Forgotten passwords",
        text: "Anyone can reset their own password. On the sign-in page, click Forgot your password?, type the email address they sign in with, and a link arrives by email. The link works once, for one hour. A new password needs at least 8 characters, with a letter and a number. If nothing arrives within a few minutes, check the junk folder and the address typed: for security the page never says whether an account exists.",
      },
      {
        kind: "text",
        text: "When a rep signs in, they land on My Route: their own four-week cycle, read-only.",
      },
      {
        kind: "bullets",
        items: [
          "Week 1 to Week 4 and Mon to Fri buttons pick the day, with the number of calls on each. The page opens on its best guess of the current week from the date and says so, so the rep can change it.",
          "Each day shows the number of calls, the hours, the kilometres and the time on the road, a map of the day, and every call in order with its arrival and departure time.",
          "Open the day in Google Maps gives turn-by-turn directions for the whole day, home to home. Google takes 9 stops at a time, so on a longer day each call also has its own Directions link.",
          "If the rep has not set their home, the page says the day starts from the middle of their stores and links straight to Account to set it.",
          "Until routes have been generated, it says their manager has not planned a route yet.",
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "A rep only ever sees their own route",
        text: "There is no setting a rep could change to see anyone else's week, and the planning pages, the store list and everyone's sales are closed to them. My Route shows the saved plan, so a rep sees changes only after routes are regenerated.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "maintenance",
    number: "15",
    title: "Keeping it up to date",
    blurb: "What to do when something changes",
    icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
    blocks: [
      {
        kind: "table",
        head: ["What changed", "What to do", "Regenerate?"],
        rows: [
          ["A new rep joins", "Reps → Import Excel, or Add Rep", "Yes"],
          ["A rep leaves", "Move their stores to another rep code first", "Yes"],
          ["New stores opened", "Control Centre → Store Upload", "Yes"],
          ["A store closed", "Set its Status to Closed on the Stores page, or close it from IMS Reconciliation", "Yes"],
          ["A channel or sub-channel is no longer visited", "Channels → switch Called on? off", "Yes"],
          ["A code turns out not to be a person", "Rep Codes → Not a rep", "No"],
          ["Stores move between reps", "Change the rep code on those stores", "Yes"],
          ["Coordinates corrected", "Stores → Export, fix, Import", "Yes"],
          ["Call frequency changes", "Channels, then Apply defaults to stores", "Yes"],
          ["A rep's home address captured", "Reps page, or the rep's own profile", "Yes"],
          ["A rep's working hours change", "Edit the rep", "Yes"],
          ["The calls-per-day target changes", "Routes → Calls per day, then Apply", "Apply does it for you"],
        ],
        caption: "If a change reaches the plan, regenerate. Rep codes are the one exception, because they never move a store",
      },
      {
        kind: "note",
        tone: "info",
        title: "A sensible routine",
        text: "Once a month: refresh the IMS snapshot, open Data Health and work the blocking items, look down Not in a Cycle for valuable stores that are being missed, then regenerate routes. If anything changed, export to Repsly again. That is enough to stop the plan drifting away from reality, and takes very little time once the data is clean.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "troubleshooting",
    number: "16",
    title: "When something looks wrong",
    blurb: "The usual causes, in order of likelihood",
    icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    blocks: [
      {
        kind: "table",
        head: ["What you see", "Most likely cause"],
        rows: [
          [
            "A rep has no stores in their route",
            "No store carries their rep code. Check Store Coverage.",
          ],
          [
            "Stores are missing from the plan entirely",
            "Not in a Cycle gives the reason for each one. Otherwise their rep code matches nobody: check Data Health.",
          ],
          [
            "A whole channel has dropped out of the routes",
            "Its Called on? switch is off on the Channels page, or the stores are closed.",
          ],
          [
            "The map shows a rep's day zig-zagging",
            "Some stores have wrong coordinates, so they are not where the plan thinks.",
          ],
          [
            "A rep looks massively over capacity",
            "Click Tell me why on Rep Capacity. Most often the store frequencies ask for more hours than the rep works, or the rep's home is far from their stores.",
          ],
          [
            "A change I made has not appeared",
            "Routes were not regenerated. This is by far the most common one.",
          ],
          [
            "A store appears twice in a cycle",
            "Duplicate store records. Check Data Health, then Duplicate Stores.",
          ],
          [
            "A rep did not receive their login email",
            "Check the address on the rep record, and whether another rep shares it. Only one login can exist per address. If they have a login already, resend their details from User Admin.",
          ],
          [
            "Someone cannot sign in",
            "Send them to Forgot your password? on the sign-in page. The link lasts one hour.",
          ],
          [
            "A rep says there is nothing on their screen",
            "Routes have not been generated for them, or their login is not linked to a rep. A login made with Create login on the Reps page is linked automatically; one made in User Admin is linked only if its email matches the rep record.",
          ],
          [
            "A rep's route ignores their home",
            "The home was set after the routes were generated. The Map shows a warning on their badge. Regenerate.",
          ],
          [
            "Someone was promoted but still sees the old pages",
            "Roles are read at sign-in. Ask them to sign out and back in.",
          ],
          [
            "The route ordering looks less efficient than usual",
            "Look at the line under the Routes heading. Days without a real road route are straight-line estimates. Regenerate.",
          ],
        ],
      },
      {
        kind: "note",
        tone: "info",
        title: "Checking the map service",
        text: "Control Centre → System Health tests the mapping service that turns addresses into coordinates and orders each day along real roads. If route ordering suddenly looks poor across the board, check there first.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────
  {
    id: "glossary",
    number: "17",
    title: "Glossary",
    blurb: "The words this system uses",
    icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.247m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.247",
    blocks: [
      {
        kind: "table",
        head: ["Term", "Meaning"],
        rows: [
          ["Call cycle", "The repeating four-week pattern of visits"],
          ["Channel", "A type of outlet, carrying a call frequency and a visit length"],
          ["Rep code", "The code that ties a store to the rep who calls on it"],
          ["Place ID", "The unique identifier for a store, used to match records on import"],
          ["Store centroid", "The middle of a rep's stores, used as a starting point when no home address is known"],
          ["Outlier", "A store far outside the rest of a rep's round"],
          ["Override", "A deliberate exception to a channel's call rules for one store"],
          ["Utilisation", "Scheduled hours as a percentage of the hours a rep actually works"],
          ["Generation", "Building and saving a new plan from the current data"],
          ["Sub-channel", "A format within a channel whose Called on? setting can differ from its channel's"],
          ["Called on?", "Whether reps visit a channel or sub-channel at all"],
          ["Calls per day", "An optional fixed number of calls in each rep's day, instead of filling it by hours"],
          ["RR Rep / IMS Rep", "The rep the router plans a store for, and the rep IMS bills it through"],
          ["Map Status", "How a store in the router matches its outlet in IMS"],
          ["Unrouted outlet", "An outlet IMS bills that is not in the router, so nobody is routed to it"],
          ["Not a rep", "A code in the sales data that is an agent, business or house account, not a person"],
          ["Snapshot", "The saved copy of IMS that every IMS figure on the site reads"],
        ],
      },
    ],
  },
];

/** Every screenshot the guide expects, for the drop-in checklist. */
export function screenshotSlots(): { slot: string; capture: string; section: string }[] {
  const out: { slot: string; capture: string; section: string }[] = [];
  for (const section of GUIDE) {
    for (const b of section.blocks) {
      if (b.kind === "shot") out.push({ slot: b.slot, capture: b.capture, section: section.title });
    }
  }
  return out;
}
