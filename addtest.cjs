const fs=require('fs'); const p='scripts/check-ims-recon.ts'; let s=fs.readFileSync(p,'utf-8');
const anchor=`console.log(\`\n\${passed} passed, \${failed} failed\`);`;
if(!s.includes(anchor)){console.error('MISS anchor');process.exit(1);}
const block=`// The "nothing cached yet" reply must still be SHAPED like a reconciliation.
// It shipped once as { error, needsBuild } alone and the page went straight to
// data.rows.filter(...) on undefined, which took out the whole screen.
{
  const empty = EMPTY_RECON;
  ok("EMPTY_RECON carries a rows array", Array.isArray(empty.rows) && empty.rows.length === 0);
  ok("EMPTY_RECON carries an orphans array", Array.isArray(empty.orphans) && empty.orphans.length === 0);

  // Built against a REAL result, so a summary field added later cannot be
  // forgotten here and quietly render as undefined on the page.
  const real = reconcile(
    [store("A1"), store("A2", { repCode: "R2" })],
    new Map([["A1", 100]]),
    new Set(["A1"]),
    new Map(),
    6
  );
  const missing = Object.keys(real.summary).filter((k) => !(k in empty.summary));
  ok("EMPTY_RECON.summary has every field a real summary has", missing.length === 0,
    missing.join(", "));
  const allNumbers = Object.values(empty.summary).every((v) => typeof v === "number");
  ok("every EMPTY_RECON summary field is a number, never undefined", allNumbers);
}

`;
s=s.replace(anchor, block+anchor);
s=s.replace('  compareCells,\n  type ImsStore,','  compareCells,\n  EMPTY_RECON,\n  type ImsStore,');
fs.writeFileSync(p,s); console.log('ok');
