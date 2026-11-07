import http from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ethers } from "ethers";
import { PROOFLY_CONTRACTS } from "../dist/contracts.js";

const DEMO_STUDENT = "demo-student-001";
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(JSON.stringify(payload));
}

async function body(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("Request body is too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function createDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, nickname TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wallet_addresses (
      address TEXT PRIMARY KEY COLLATE NOCASE,
      student_id TEXT NOT NULL REFERENCES students(id),
      verified_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wallet_nonces (
      nonce TEXT PRIMARY KEY,
      address TEXT NOT NULL COLLATE NOCASE,
      message TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS app_state (student_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(student_id,key));
    CREATE TABLE IF NOT EXISTS badge_eligibility (
      student_id TEXT NOT NULL,
      badge_id TEXT NOT NULL,
      eligible INTEGER NOT NULL,
      progress INTEGER NOT NULL,
      threshold INTEGER NOT NULL,
      PRIMARY KEY(student_id,badge_id)
    );
    CREATE TABLE IF NOT EXISTS mint_claims (
      nonce TEXT PRIMARY KEY,
      student_id TEXT NOT NULL,
      address TEXT NOT NULL COLLATE NOCASE,
      badge_id TEXT NOT NULL,
      metadata_uri TEXT NOT NULL,
      deadline INTEGER NOT NULL,
      issued_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS forum_claims (
      nonce TEXT PRIMARY KEY, student_id TEXT NOT NULL, address TEXT NOT NULL COLLATE NOCASE,
      action INTEGER NOT NULL, question_id INTEGER NOT NULL, bounty TEXT NOT NULL,
      deadline INTEGER NOT NULL, issued_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT OR IGNORE INTO students(id,nickname) VALUES(?,?)").run(DEMO_STUDENT, "Yuna Tang");
  const eligibility = [
    ["learning-pioneer", 1, 1, 1], ["best-explainer", 0, 3, 5], ["curious-mind", 0, 4, 10],
    ["consensus-guide", 1, 5, 5], ["security-scout", 0, 2, 5], ["course-finisher", 0, 7, 10]
  ];
  const insert = db.prepare("INSERT OR IGNORE INTO badge_eligibility(student_id,badge_id,eligible,progress,threshold) VALUES(?,?,?,?,?)");
  for (const row of eligibility) insert.run(DEMO_STUDENT, ...row);
  return db;
}

export function createDemoServer({ databasePath = resolve(PROJECT_ROOT, "data/proofly-demo.sqlite"), issuerPrivateKey = process.env.DEMO_ISSUER_PRIVATE_KEY || process.env.PRIVATE_KEY } = {}) {
  if (!issuerPrivateKey) throw new Error("DEMO_ISSUER_PRIVATE_KEY is required");
  const db = createDatabase(databasePath);
  const issuer = new ethers.Wallet(issuerPrivateKey);
  const rpcUrl = (process.env.SEPOLIA_RPC_URL || "").replace("$(ALCHEMY_KEY)", process.env.ALCHEMY_KEY || "").replace("${ALCHEMY_KEY}", process.env.ALCHEMY_KEY || "");
  const chainWallet = rpcUrl ? issuer.connect(new ethers.JsonRpcProvider(rpcUrl)) : null;
  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") return json(response, 204, {});
    const url = new URL(request.url, "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/api/health") return json(response, 200, { ok: true, student: DEMO_STUDENT, issuer: issuer.address });
      if (request.method === "GET" && url.pathname === "/api/questions") {
        const row = db.prepare("SELECT value FROM app_state WHERE student_id=? AND key='questions'").get(DEMO_STUDENT);
        return json(response, 200, { questions: row ? JSON.parse(row.value) : null });
      }
      if (request.method === "PUT" && url.pathname === "/api/questions") {
        const payload = await body(request);
        if (!Array.isArray(payload.questions)) return json(response, 400, { error: "questions must be an array" });
        db.prepare("INSERT INTO app_state(student_id,key,value,updated_at) VALUES(?, 'questions', ?, ?) ON CONFLICT(student_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(DEMO_STUDENT, JSON.stringify(payload.questions), new Date().toISOString());
        return json(response, 200, { saved: payload.questions.length });
      }
      if (request.method === "GET" && url.pathname === "/api/wallet/addresses") {
        const addresses = db.prepare("SELECT address,verified_at AS linkedAt FROM wallet_addresses WHERE student_id=? ORDER BY verified_at").all(DEMO_STUDENT);
        return json(response, 200, { addresses });
      }
      if (request.method === "POST" && url.pathname === "/api/wallet/nonce") {
        const payload = await body(request), address = ethers.getAddress(payload.address), nonce = randomUUID(), expiresAt = Date.now() + 5 * 60_000;
        const message = `Proofly address verification\nStudent: ${DEMO_STUDENT}\nAddress: ${address}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}\nThis address can never be removed from this student account.`;
        db.prepare("INSERT INTO wallet_nonces(nonce,address,message,expires_at) VALUES(?,?,?,?)").run(nonce, address, message, expiresAt);
        return json(response, 200, { nonce, message, expiresAt });
      }
      if (request.method === "POST" && url.pathname === "/api/wallet/verify") {
        const payload = await body(request), address = ethers.getAddress(payload.address);
        const nonce = db.prepare("SELECT * FROM wallet_nonces WHERE nonce=? AND address=?").get(payload.nonce, address);
        if (!nonce || nonce.used || nonce.expires_at < Date.now()) return json(response, 400, { error: "Verification nonce is invalid or expired" });
        if (ethers.verifyMessage(nonce.message, payload.signature).toLowerCase() !== address.toLowerCase()) return json(response, 403, { error: "Signature does not match this address" });
        const owner = db.prepare("SELECT student_id FROM wallet_addresses WHERE address=?").get(address);
        if (owner && owner.student_id !== DEMO_STUDENT) return json(response, 409, { error: "Address already belongs to another student" });
        db.prepare("UPDATE wallet_nonces SET used=1 WHERE nonce=?").run(payload.nonce);
        db.prepare("INSERT OR IGNORE INTO wallet_addresses(address,student_id,verified_at) VALUES(?,?,?)").run(address, DEMO_STUDENT, new Date().toISOString());
        const addresses = db.prepare("SELECT address,verified_at AS linkedAt FROM wallet_addresses WHERE student_id=? ORDER BY verified_at").all(DEMO_STUDENT);
        return json(response, 200, { verified: true, address, permanent: true, addresses });
      }
      if (request.method === "GET" && url.pathname === "/api/badges/eligibility") {
        return json(response, 200, { badges: db.prepare("SELECT badge_id AS badgeId,eligible,progress,threshold FROM badge_eligibility WHERE student_id=? ORDER BY badge_id").all(DEMO_STUDENT) });
      }
      if (request.method === "POST" && url.pathname === "/api/forum/claim") {
        const payload = await body(request), address = ethers.getAddress(payload.address), actionNames = { post: 1, answer: 2, edit: 3 }, action = actionNames[payload.action];
        if (!action) return json(response, 400, { error: "Unknown forum action" });
        if (!db.prepare("SELECT 1 FROM wallet_addresses WHERE student_id=? AND address=?").get(DEMO_STUDENT, address)) return json(response, 403, { error: "Verify this wallet address first" });
        if (!ethers.isAddress(PROOFLY_CONTRACTS.forum)) return json(response, 500, { error: "Forum contract is not configured" });
        const questionId = Number(payload.questionId || 0), bounty = ethers.parseEther(String(payload.bounty || 0)), nonce = (BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))).toString(), deadline = Math.floor(Date.now() / 1000) + 10 * 60, studentId = ethers.keccak256(ethers.toUtf8Bytes(DEMO_STUDENT));
        const domain = { name: "ProoflyForum", version: "1", chainId: PROOFLY_CONTRACTS.chainId, verifyingContract: PROOFLY_CONTRACTS.forum };
        const types = { AccountAction: [{name:"wallet",type:"address"},{name:"studentId",type:"bytes32"},{name:"action",type:"uint8"},{name:"questionId",type:"uint256"},{name:"bounty",type:"uint96"},{name:"nonce",type:"uint256"},{name:"deadline",type:"uint256"}] };
        const signature = await issuer.signTypedData(domain, types, { wallet: address, studentId, action, questionId, bounty, nonce, deadline });
        db.prepare("INSERT INTO forum_claims(nonce,student_id,address,action,question_id,bounty,deadline,issued_at) VALUES(?,?,?,?,?,?,?,?)").run(nonce, DEMO_STUDENT, address, action, questionId, bounty.toString(), deadline, new Date().toISOString());
        return json(response, 200, { studentId, action, questionId, bounty: bounty.toString(), nonce, deadline, signature, issuer: issuer.address });
      }
      if (request.method === "POST" && url.pathname === "/api/demo/select-best") {
        if (!chainWallet) return json(response, 500, { error: "Sepolia RPC is not configured" });
        const payload = await body(request), address = ethers.getAddress(payload.address), questionId = BigInt(payload.questionId), answerId = BigInt(payload.answerId);
        if (!db.prepare("SELECT 1 FROM wallet_addresses WHERE student_id=? AND address=?").get(DEMO_STUDENT, address)) return json(response, 403, { error: "Verify this wallet address first" });
        const forum = new ethers.Contract(PROOFLY_CONTRACTS.forum, [
          "function questions(uint256) view returns(address asker,bytes32 askerStudentId,uint96 bounty,bool sponsored,bool finalized,uint64 expiresAt,uint256 answerCount,uint256 selectedAnswerId,address selectedAnswerer)",
          "function answererOf(uint256,uint256) view returns(address)",
          "function selectBestAnswer(uint256,uint256)"
        ], chainWallet);
        const [question, answerer] = await Promise.all([forum.questions(questionId), forum.answererOf(questionId, answerId)]);
        if (question.asker.toLowerCase() !== chainWallet.address.toLowerCase()) return json(response, 403, { error: "The demo service is not the asker for this question" });
        if (answerer.toLowerCase() !== address.toLowerCase()) return json(response, 400, { error: "The selected answer does not belong to the connected address" });
        const tx = await forum.selectBestAnswer(questionId, answerId); await tx.wait();
        return json(response, 200, { selected: true, questionId: questionId.toString(), answerId: answerId.toString(), expiresAt: Number(question.expiresAt), bounty: ethers.formatEther(question.bounty), txHash: tx.hash });
      }
      if (request.method === "POST" && url.pathname === "/api/badges/claim") {
        const payload = await body(request), address = ethers.getAddress(payload.address), badgeId = String(payload.badgeId || ""), metadataURI = String(payload.metadataURI || "");
        if (!db.prepare("SELECT 1 FROM wallet_addresses WHERE student_id=? AND address=?").get(DEMO_STUDENT, address)) return json(response, 403, { error: "Verify this wallet address first" });
        const eligibility = db.prepare("SELECT * FROM badge_eligibility WHERE student_id=? AND badge_id=?").get(DEMO_STUDENT, badgeId);
        if (!eligibility?.eligible) return json(response, 403, { error: "Badge requirement has not been achieved" });
        let metadataPath = ""; try { metadataPath = new URL(metadataURI).pathname; } catch {}
        if (metadataPath !== `/metadata/${badgeId}.json`) return json(response, 400, { error: "Badge metadata URI is not canonical" });
        if (!ethers.isAddress(PROOFLY_CONTRACTS.badge)) return json(response, 500, { error: "Badge contract is not configured" });
        const nonce = (BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))).toString(), deadline = Math.floor(Date.now() / 1000) + 10 * 60;
        const domain = { name: "ProoflyBadge", version: "1", chainId: PROOFLY_CONTRACTS.chainId, verifyingContract: PROOFLY_CONTRACTS.badge };
        const types = { MintClaim: [{ name: "learner", type: "address" }, { name: "badgeKey", type: "bytes32" }, { name: "metadataHash", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
        const value = { learner: address, badgeKey: ethers.keccak256(ethers.toUtf8Bytes(badgeId)), metadataHash: ethers.keccak256(ethers.toUtf8Bytes(metadataURI)), nonce, deadline };
        const signature = await issuer.signTypedData(domain, types, value);
        db.prepare("INSERT INTO mint_claims(nonce,student_id,address,badge_id,metadata_uri,deadline,issued_at) VALUES(?,?,?,?,?,?,?)").run(nonce, DEMO_STUDENT, address, badgeId, metadataURI, deadline, new Date().toISOString());
        return json(response, 200, { badgeId, metadataURI, nonce, deadline, signature, issuer: issuer.address });
      }
      return json(response, 404, { error: "Not found" });
    } catch (error) {
      return json(response, 400, { error: error.message || "Request failed" });
    }
  });
  server.on("close", () => db.close());
  return server;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PROOFLY_API_PORT || 8787);
  createDemoServer().listen(port, "127.0.0.1", () => console.log(`Proofly demo API listening on http://127.0.0.1:${port}`));
}
