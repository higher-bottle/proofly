import { ethers } from "ethers";

const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
if (!privateKey) throw new Error("Missing PRIVATE_KEY");
const rpcUrl = (process.env.SEPOLIA_RPC_URL || "")
  .replace("$(ALCHEMY_KEY)", process.env.ALCHEMY_KEY || "")
  .replace("${ALCHEMY_KEY}", process.env.ALCHEMY_KEY || "");
if (!rpcUrl) throw new Error("Missing SEPOLIA_RPC_URL");

const wallet = new ethers.Wallet(privateKey);
const provider = new ethers.JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();
const balance = await provider.getBalance(wallet.address);
const confirmedNonce = await provider.getTransactionCount(wallet.address, "latest");
const pendingNonce = await provider.getTransactionCount(wallet.address, "pending");

console.log("deployer", wallet.address);
console.log("issuer", wallet.address);
console.log("chainId", network.chainId.toString());
console.log("balanceETH", ethers.formatEther(balance));
console.log("confirmedNonce", confirmedNonce);
console.log("pendingNonce", pendingNonce);
if (network.chainId !== 11155111n) throw new Error("RPC is not Sepolia");
if (balance === 0n) throw new Error("Deployer has no Sepolia ETH");
