import { ethers } from "ethers";

const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const rpcUrl = (process.env.SEPOLIA_RPC_URL || "")
  .replace("$(ALCHEMY_KEY)", process.env.ALCHEMY_KEY || "")
  .replace("${ALCHEMY_KEY}", process.env.ALCHEMY_KEY || "");
const wallet = new ethers.Wallet(privateKey);
const provider = new ethers.JsonRpcProvider(rpcUrl);
const confirmedNonce = await provider.getTransactionCount(wallet.address, "latest");
const candidates = Array.from({ length: confirmedNonce }, (_, nonce) => ({ nonce, address: ethers.getCreateAddress({ from: wallet.address, nonce }) }));
const codes = await Promise.all(candidates.map(candidate => provider.getCode(candidate.address)));
const contracts = candidates.filter((_, index) => codes[index] !== "0x");
const identified = [];
for (const candidate of contracts) {
  let type = "unknown", details = {};
  try {
    const badge = new ethers.Contract(candidate.address, ["function issuer() view returns(address)", "function nextTokenId() view returns(uint256)"], provider);
    details = { issuer: await badge.issuer(), nextTokenId: (await badge.nextTokenId()).toString() };
    type = "ProoflyBadge";
  } catch {}
  if (type === "unknown") try {
    const forum = new ethers.Contract(candidate.address, ["function help() view returns(address)", "function nextQuestionId() view returns(uint256)"], provider);
    details = { help: await forum.help(), nextQuestionId: (await forum.nextQuestionId()).toString() };
    type = "ProoflyForum";
  } catch {}
  if (type === "unknown") try {
    const token = new ethers.Contract(candidate.address, ["function symbol() view returns(string)", "function totalSupply() view returns(uint256)", "function owner() view returns(address)"], provider);
    if (await token.symbol() === "HELP") {
      details = { totalSupply: (await token.totalSupply()).toString(), owner: await token.owner() };
      type = "HelpToken";
    }
  } catch {}
  identified.push({ nonce: candidate.nonce, address: candidate.address, type, ...details });
}
console.log(JSON.stringify({ deployer: wallet.address, confirmedNonce, contracts: identified }, null, 2));
