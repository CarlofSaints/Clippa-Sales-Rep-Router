const fs=require('fs'); const p='lib/guide.ts'; let s=fs.readFileSync(p,'utf-8');
function rep(a,b){ if(!s.includes(a)){console.error('MISS: '+a.slice(0,70));process.exit(1);} s=s.split(a).join(b); }

// 1. Name BOTH places, and say how to fix it.
rep(`        text: "Nothing checks the rep code on a store against the rep list. If a store names a rep who was never loaded, that store is dropped from the map, from every route and from all capacity figures, and no screen used to say so. Store Coverage exists for exactly this: it lists every rep code that has stores but no rep record, and the stores behind it. If you see a number there, add the missing reps and the stores attach themselves.",`,
`        text: "Nothing checks the rep code on a store against the rep list. If a store names a rep who was never loaded, that store is dropped from the map, from every route and from all capacity figures, and no planning screen says so. Two places tell you. Store Coverage lists every rep code that has stores but no rep record, with the stores behind it. Data Health raises the same thing as a blocking issue called Stores allocated to a rep who does not exist, and that one exports to Excel so you can work through it.",`);

// 2. Add the fix, right after that note.
rep(`      {
        kind: "shot",
        slot: "coverage",
        caption: "Store Coverage: what can be planned, and what is stranded",`,
`      {
        kind: "steps",
        items: [
          { do: "Decide what the code actually is", detail: "A person who was never loaded, a branch or house account that is not a person, or a typo on the stores." },
          { do: "If it is a person, add them on the Reps page", detail: "Add the rep with that exact code and every store carrying it attaches itself immediately. Nothing else is needed." },
          { do: "If it is a typo, fix the rep code on the stores", detail: "Edit the rep on each row on the Stores page. Editing by hand always works, even when IMS has been made the source, because a person's decision outranks a spreadsheet." },
          { do: "If the account is closed, close the stores instead", detail: "Do not invent a rep for it. Use Closed stores on IMS Reconciliation, and they leave the call cycles without pretending to belong to anybody." },
          { do: "Regenerate routes", detail: "Nothing you fix here reaches a rep until the plan is generated again." },
        ],
      },
      {
        kind: "shot",
        slot: "coverage",
        caption: "Store Coverage: what can be planned, and what is stranded",`);

// 3. Data Health now runs on trading stores only.
rep(`    id: "data-health",`,`    id: "data-health",`);
fs.writeFileSync(p,s); console.log('ok');
