"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),S=require("../security.cjs");
test("synthetic identity only",()=>{assert(S.validEmail("test@example.test"));assert(!S.validEmail("test@gmail.com"));assert(!S.validEmail("Test@example.test"));});
test("strict profile allowlist",()=>{const b={grade:"11",curriculum:"DEMO-VN",locale:"vi",version:1};assert(S.profilePatch(b));assert(!S.profilePatch({...b,user_id:"other"}));assert(!S.profilePatch({...b,version:0}));assert(!S.profilePatch({...b,grade:"13"}));assert(!S.profilePatch({...b,curriculum:"real school"}));});
test("session token strict and hashed",()=>{const t=S.hex(32);assert.equal(S.readToken("vpo="+t,"vpo"),t);assert.equal(S.readToken("vpo="+t+"; vpo="+t,"vpo"),null);assert.equal(S.readToken("vpo=bad","vpo"),null);assert.notEqual(S.digest(t),t);});
test("CSRF binds session",()=>{const key=Buffer.alloc(32,1),a=S.hex(32),b=S.hex(32);assert(S.eq(S.csrf(a,key),S.csrf(a,key)));assert(!S.eq(S.csrf(a,key),S.csrf(b,key)));assert(!S.eq("a","aa"));});
test("scrypt random salt and correct password",async()=>{const p="A staging passphrase 123!";const h=await S.hashPassword(p);assert(await S.verifyPassword(p,h));assert(!(await S.verifyPassword("another long password",h)));assert.notEqual(await S.hashPassword(p),h);});
test("config fails closed",()=>{assert.throws(()=>S.config({}));const env={VPO_MODE:"synthetic-staging",VPO_ORIGIN:"http://localhost:8080",VPO_CSRF_KEY:"ab".repeat(32),DATABASE_URL:"postgres://localhost/staging"};assert.equal(S.config(env).secure,false);assert.throws(()=>S.config({...env,VPO_ORIGIN:"http://example.test"}));assert.equal(S.config({...env,VPO_ORIGIN:"https://staging.example.test"}).cookie,"__Host-vpo_session");});
 test("Codespaces Host allowlist is opt-in, exact, and restricted to this port",()=>{
 const env={VPO_MODE:"synthetic-staging",VPO_ORIGIN:"https://demo-space-8082.app.github.dev",VPO_PORT:"8082",VPO_CSRF_KEY:"ab".repeat(32),DATABASE_URL:"postgres://localhost/staging",CODESPACES:"true",CODESPACE_NAME:"demo-space",GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:"app.github.dev"};
 const strict=S.config(env);assert(S.hostAllowed("demo-space-8082.app.github.dev",strict));assert(!S.hostAllowed("localhost:8082",strict));
 const proxied=S.config({...env,VPO_CODESPACES_PROXY:"yes"});for(const h of ["demo-space-8082.app.github.dev","localhost:8082","127.0.0.1:8082","[::1]:8082","localhost","127.0.0.1","[::1]"])assert(S.hostAllowed(h,proxied),h);
 for(const h of ["evil.example","localhost:8080","localhost:8082.evil.example","other-space-8082.app.github.dev","demo-space-8082.app.github.dev.evil.example","localhost:8082,evil.example",undefined])assert(!S.hostAllowed(h,proxied),String(h));
 assert.equal(proxied.origin,env.VPO_ORIGIN);
 assert.throws(()=>S.config({...env,VPO_CODESPACES_PROXY:"yes",CODESPACES:"false"}));
 assert.throws(()=>S.config({...env,VPO_CODESPACES_PROXY:"yes",VPO_ORIGIN:"https://other-space-8082.app.github.dev"}));
 const local=S.config({...env,VPO_ORIGIN:"http://localhost:8082"});assert(S.hostAllowed("localhost:8082",local));assert(!S.hostAllowed("127.0.0.1:8082",local));
 });
