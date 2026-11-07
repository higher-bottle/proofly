import { ethers } from "ethers";

const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const wallet = new ethers.Wallet(privateKey);
const query = new URLSearchParams({
  chainid: "11155111",
  module: "account",
  action: "txlist",
  address: wallet.address,
  startblock: "0",
  endblock: "99999999",
  page: "1",
  offset: "12",
  sort: "desc",
  apikey: process.env.ETHERSCAN_API_KEY || ""
});
const response = await fetch(`https://api.etherscan.io/v2/api?${query}`);
const payload = await response.json();
if (payload.status !== "1" || !Array.isArray(payload.result)) throw new Error(payload.result || payload.message || "Could not read Etherscan transactions");
const recent = payload.result.map(transaction => ({
  nonce: Number(transaction.nonce),
  hash: transaction.hash,
  to: transaction.to || null,
  contractAddress: transaction.contractAddress || null,
  status: transaction.isError === "0" ? "success" : "failed",
  timestamp: new Date(Number(transaction.timeStamp) * 1000).toISOString()
}));
console.log(JSON.stringify({ deployer: wallet.address, recent }, null, 2));
