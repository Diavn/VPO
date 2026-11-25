"use strict";
// A diagnostic gate, not an approval authority. This branch intentionally cannot run production.
const assert=require("node:assert/strict"),r=require("./readiness.json");
const arg=process.argv[2]||"--check";
assert(["--check","--production"].includes(arg));
assert.equal(r.schema_version,1);assert.equal(r.mode,"synthetic-staging");assert.equal(r.production_enabled,false);
assert(r.gates.length>=11);assert.deepEqual([...new Set(r.gates.map(x=>x.gate))].sort(),["G0","G1","G2","G3","G4","G5"]);
const keys=new Set();for(const g of r.gates){assert(["PENDING","PARTIAL","NOT_APPLICABLE_YET"].includes(g.status));assert.equal(g.approval,null);assert(g.requirement&&g.evidence);assert(!keys.has(g.area));keys.add(g.area);}
console.log("VPO RELEASE: PRODUCTION NO-GO");
for(const g of r.gates)console.log(g.gate+" | "+g.area+" | "+g.status);
if(arg==="--production"){console.error("Production disabled: synthetic-only branch, signed approvals and independent evidence missing.");process.exitCode=1;}
else console.log("Release register structure PASS; not release approval.");
