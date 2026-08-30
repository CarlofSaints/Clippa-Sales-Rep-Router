const fs=require('fs'); const p='lib/guide.ts';
let lines=fs.readFileSync(p,'utf-8').split('\n');

// 1. the danger note: name BOTH places
const ni=lines.findIndex(l=>l.includes('Store Coverage exists for exactly this'));
if(ni<0){console.error('no note');process.exit(1);}
lines[ni]='        text: "Nothing checks the rep code on a store against the rep list. If a store names a rep who was never loaded, that store is dropped from the map, from every route and from all capacity figures, and no planning screen says so. Two places tell you. Store Coverage lists every rep code that has stores but no rep record, with the stores behind it. Data Health raises the same thing as a blocking issue called Stores allocated to a rep who does not exist, and that one exports to Excel so you can work through it.",';

// 2. the fix, inserted before the coverage screenshot
const si=lines.findIndex(l=>l.includes('slot: "coverage"'));
const open=si-1; // the "{" that opens the shot block
if(!lines[open].trim().startsWith('{')){console.error('unexpected: '+lines[open]);process.exit(1);}
const steps=[
'      {',
'        kind: "steps",',
'        items: [',
'          { do: "Decide what the code actually is", detail: "A person who was never loaded, a branch or house account that is not a person at all, or a typo on the stores." },',
'          { do: "If it is a person, add them on the Reps page", detail: "Add the rep with that exact code and every store carrying it attaches itself immediately. Nothing else is needed." },',
'          { do: "If it is a typo, fix the rep code on the stores", detail: "Edit the rep on each row on the Stores page. Editing by hand always works, even when IMS has been made the source, because a person deciding outranks a spreadsheet." },',
'          { do: "If the account is closed, close the stores instead", detail: "Do not invent a rep for it. Use Closed stores on IMS Reconciliation and they leave the call cycles without pretending to belong to anybody." },',
'          { do: "Regenerate routes", detail: "Nothing you fix here reaches a rep until the plan is generated again." },',
'        ],',
'      },',
];
lines.splice(open,0,...steps);
fs.writeFileSync(p,lines.join('\n'));
console.log('ok: note rewritten, '+steps.length+' lines of fix inserted');
